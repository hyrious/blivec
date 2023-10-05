#!/usr/bin/env node
// @ts-check
import fs from 'node:fs'
import tty from 'node:tty'
import process from 'node:process'
import cp from 'node:child_process'
import readline from 'node:readline'
import * as bl from './lib/blivec.js'

const help = `
Usage:
  bl <room_id>                      # listen danmaku
     --json                         # print all events in json

  bl <room_id> <message>            # send danmaku (requires cookie)

  bl get <room_id>                  # get stream url
     --json                         # print them in json

  bl feed                           # get feed list (requires cookie)
     --json                         # print them in json

  bl d <room_id> [--interval=1]     # dd mode
     --interval=<minutes>           # set 0 to disable polling
     --mpv                          # open in mpv instead
     --on-close=<behavior>          # do something on window close
                default             # restart player    (alias: --default)
                ask                 # ask quality again (alias: --ask)
                quit                # quit DD mode      (alias: --quit)
     -- [...player_args]            # pass args to ffplay or mpv

Global flags:
     -y, --yes                      # answer 'y' to all prompts (select quality, etc.)

Examples:
  bl 123456
  bl 123456 "Hello, world!"
  bl get 123456
  bl d 123456 --mpv --on-close=quit -- --volume=50
`.trim()

const has_colors = tty.WriteStream.prototype.hasColors()

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const format = (s, e) => has_colors ? m => `\x1B[${s}m${m}\x1B[${e}m` : m => m
const red = format(31, 39)
const cyan = format(36, 39)
const black = format(30, 39)
const bgRed = format(41, 49)
const bgCyan = format(46, 49)
const gray = format(90, 39)
const bgGray = format(100, 49)
const log = {
  error: msg => console.error(`${bgRed(black(' ERROR '))} ${red(msg)}`),
  info: msg => console.error(`${bgCyan(black(' BLIVC '))} ${cyan(msg)}`),
  debug: msg => console.error(`${bgGray(' DEBUG ')} ${gray(msg)}`),
  catch_error: error => log.error(error.message),
}

// Reuse this repl during the whole program
// 1. Listen 'line' event in danmaku mode to send message
// 2. Question about the stream quality in DD mode, this will temporarily eat the next 'line' event,
//    @see https://github.com/nodejs/node/blob/-/lib/internal/readline/interface.js#L408
/** @type {readline.Interface | undefined} */
let repl
function setup_repl() {
  if (!repl) {
    repl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
    })
    repl.on('SIGINT', () => {
      repl && repl.close()
      process.exit(0) // trigger process event 'exit'
    })
  }
  return repl
}
function quit_repl() {
  if (repl) {
    repl.close()
    repl = undefined
  }
}

/**
 * @param {number} id room id
 */
function listen(id, { json = false } = {}) {
  let count = 0
  /** @type {bl.Connection} */
  let con

  /** @type {Partial<bl.Events>} */
  const events = json
    ? {
        init: data => console.log(JSON.stringify({ cmd: 'init', data })),
        message: data => console.log(JSON.stringify(data)),
        error: log.catch_error,
      }
    : {
        init({ title, live_status, live_start_time, host_list }, index) {
          if (count === 0) {
            if (live_status === 1) {
              const time = new Date(live_start_time * 1000).toLocaleString()
              log.info(`listening ${title} (start at ${time})`)
            }
            else {
              log.info(`listening ${title} (offline)`)
            }

            bl.danmakuHistory(id)
              .then((messages) => {
                for (const { timeline, nickname, text } of messages) {
                  const time = timeline.slice(-8, -3)
                  console.log(`[${time}] [${nickname}]`, text)
                }
                log.info('history end')
              })
              .catch(bl.noop)

            const repl = setup_repl()
            repl.on('line', (line) => {
              line = line.trim()
              if (line === 'rs') {
                con.reconnect()
              }
              else if (line.startsWith('> ') && line.length > 2) {
                readline.moveCursor(process.stdout, 0, -1) // move up
                readline.clearLine(process.stdout, 0) // clear the user input
                line = line.slice(2)
                send(id, line).catch(log.catch_error)
              }
              else {
                log.info('message needs to start with "> " (space is required)')
              }
            })
          }
          else {
            log.info(`reconnected (x${count})`)
          }
          count++
          const { host, port } = host_list[index]
          log.debug(`connecting tcp://${host}:${port}`)
        },
        message(a) {
          if (typeof a === 'object' && a !== null && a.cmd === 'DANMU_MSG') {
            const time = new Date(a.info[0][4]).toLocaleString('zh-CN').slice(-8, -3)
            const message = a.info[1]
            const user = a.info[2][1]
            console.log(`[${time}] [${user}]`, message)
          }
        },
        error: log.catch_error,
        quit: quit_repl,
      }

  con = new bl.Connection(id, events)

  return con
}

function get_cookie() {
  const cookie = bl.read_cookie()
  if (cookie)
    return cookie

  log.error('Please create a file "cookie.txt" in your home dir.')
  console.error('Example content:')
  console.error('')
  console.error('SESSDATA=...')
  console.error('bili_jct=...')
  console.error('buvid3=...')
  console.error()

  process.exit(1)
}

/**
 * @param {number} id room id
 * @param {string} message message
 */
async function send(id, message) {
  await bl.sendDanmaku(id, message, get_cookie()).catch(log.catch_error)
}

async function feed({ json = false } = {}) {
  const env = get_cookie()
  let list

  try {
    list = await bl.getFeedList(env)
  }
  catch (err) {
    log.catch_error(err)
    process.exitCode = 1
    return
  }

  if (json) {
    console.log(JSON.stringify(list, null, 2))
    return
  }

  log.info(`Found ${list.length} rooms:`)
  for (let i = 0; i < list.length; i++) {
    const { roomid, uname, title } = list[i]
    log.info(`  [${String(i + 1).padStart(2)}] ${String(roomid).padStart(8)}: ${uname} - ${title}`)
  }
}

/**
 * @param {number} id room id
 */
async function get(id, { json = false } = {}) {
  try {
    const info = await bl.getRoomPlayInfo(id)
    if (!json) {
      console.log('Title:', info.title)
      console.log()
    }
    for (const name in info.streams) {
      const stream = info.streams[name]
      if (!json) {
        console.log(`  ${name}: ${stream.url}`)
        console.log()
      }
    }
    if (json)
      console.log(JSON.stringify(info, null, 2))
  }
  catch (err) {
    log.catch_error(err)
  }
}

/**
 * @param {number} minutes
 */
function format_interval(minutes) {
  if (minutes === 1)
    return '1 minute'
  if (minutes < 1) {
    const seconds = Math.round(minutes * 60)
    if (seconds === 1)
      return '1 second'
    if (seconds > 1)
      return `${seconds} seconds`
  }
  return `${minutes} minutes`
}

/**
 * @param {Array<number | string>} choices
 */
function format_choices(choices) {
  // choices must be [1,2,3,...,'other','options']
  // truncate the first continuous numbers to range format
  let n = 0
  while (choices[n] === n + 1) n++
  if (n <= 5)
    return choices.join('/')
  else
    return `1/2/../${n - 1}/${n}/${choices.slice(n).join('/')}`
}

/**
 * @param {number} id room id
 */
async function D(id, { interval = 1, mpv = false, on_close = 'default', yes = false, args = [] } = {}) {
  log.info(`DD ${id} ${interval > 0 ? `every ${format_interval(interval)}` : 'once'}`)

  /** @type {bl.Connection} */
  let con
  /** @type {cp.ChildProcess} */
  let child

  /** @type {import('node:http').OutgoingHttpHeaders} */
  const headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:60.1) Gecko/20100101 Firefox/60.1',
    'Referer': 'https://live.bilibili.com/',
  }

  async function poll() {
    let info = null
    while (info === null) {
      info = await bl.getRoomPlayInfo(id).catch(() => null)
      if (info && !(await bl.testUrl(first(info.streams).url, headers)))
        info = null
      if (info || interval === 0)
        break
      await delay(interval * 60 * 1000)
    }
    function first(obj) {
      // eslint-disable-next-line no-unreachable-loop
      for (const key in obj) return obj[key]
      return {}
    }
    return info
  }

  // returns undefined if user inputs 'n'
  async function ask(info) {
    const { title, streams } = info
    log.info('====='.repeat(12))
    log.info(`Title: ${title}`)
    log.info('====='.repeat(12))
    log.info('Available streams:')
    const names = Object.keys(streams)
    const width = names.length > 9 ? 2 : 1
    const choices = []
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      log.info(`  ${String(i + 1).padStart(width)}: ${name}`)
      choices.push(i + 1)
    }
    choices.push('Y=1', 'max', 'n', 'retry')
    const repl = setup_repl()
    let answer = 'Y'
    if (yes) {
      log.info(`Chooses [${names[0]}] because of --yes`)
    }
    else {
      answer = await new Promise((resolve) => {
        repl.question(`Choose a stream, or give up: (${format_choices(choices)}) `, a => resolve(a || 'Y'))
      })
    }
    let selected = names[0]
    const i = Number.parseInt(answer)
    if (Number.isSafeInteger(i) && i >= 1 && i <= names.length) {
      selected = names[i - 1]
    }
    else {
      switch (answer[0].toLowerCase()) {
        case 'n':
          return
        case 'm':
          selected = names.reduce((a, b) => (streams[a].qn > streams[b].qn ? a : b))
          break
        case 'r':
          return 'retry'
      }
    }
    return selected
  }

  const headers_cmdline = Object.entries(headers).map(([k, v]) => `${k}: ${v}`)
  /**
   * @param {string} url
   * @param {string} title
   * @param {string[]} extra
   */
  function play(url, title, extra) {
    if (mpv) {
      const args = ['--quiet']
      args.push(`--http-header-fields=${headers_cmdline.join(',')}`)
      args.push(`--title=${title}`)
      args.push('--geometry=50%')
      args.push(...extra)
      args.push(url)
      return cp.spawn('mpv', args, { stdio: 'ignore', detached: true })
    }
    else {
      const args = ['-hide_banner', '-loglevel', 'error']
      args.push('-headers', headers_cmdline.map(e => `${e}\r\n`).join(''))
      args.push('-window_title', title)
      args.push('-x', '720', '-y', '405')
      args.push(...extra)
      args.push(url)
      return cp.spawn('ffplay', args, { stdio: 'ignore' })
    }
  }

  function firstKey(obj) {
    // eslint-disable-next-line no-unreachable-loop
    for (const key in obj) return key
    return ''
  }

  let selected
  async function replay(initial = true) {
    if (!initial && (on_close === 'quit' || on_close === 'exit'))
      process.exit(0)

    const info = await poll()
    if (!info)
      process.exit(0)

    if (initial) {
      selected = await ask(info)
    }
    else if (on_close === 'default') {
      selected ||= await ask(info)
      // It is possible that the selected quality is missing now
      // in which case we fallback to the first available one
      if (!(selected in info.streams))
        selected = firstKey(info.streams)
    }
    else if (on_close === 'ask') {
      selected = await ask(info)
    }
    else if (on_close === 'quit' || on_close === 'exit') {
      selected = undefined
    }
    if (selected === 'retry') {
      await replay(initial)
      return
    }
    if (!selected)
      process.exit(0)

    log.info(`Now playing: [${selected}] ${info.title}`)
    child = play(info.streams[selected].url, info.title, args)
    con ||= listen(id)
    child.on('exit', () => {
      if (!(on_close === 'quit' || on_close === 'exit'))
        log.info('to exit, press "Ctrl+C" in the console')

      setTimeout(replay, 100, false)
    })
  }

  await replay()

  // @ts-expect-error 'con' will be available after replay()
  const quit = con.events.quit
  // @ts-expect-error 'con' will be available after replay()
  con.events.quit = () => {
    quit && quit()
    try {
      if (process.platform === 'win32')
        cp.execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
      else
        child.kill()
    }
    catch {
      // ignore killing error
    }
  }

  // @ts-expect-error 'con' will be available after replay()
  return con
}

/**
 * @param {string[]} cmd
 * @param {string[] | undefined} config
 */
function modify_dd_args(cmd, config) {
  if (!config)
    return

  // config = [...x, '--', ...y]
  // cmd    = [...a, '--', ...b]
  // return = [...x, ...a, '--', ...y, ...b]
  const i = config.indexOf('--')
  if (i === -1) {
    cmd.unshift(...config)
    return
  }
  const x = config.slice(0, i)
  const y = config.slice(i + 1)

  const j = cmd.indexOf('--')
  if (j === -1) {
    cmd.unshift(...x)
    cmd.push('--', ...y)
    return
  }

  const a = cmd.slice(0, j)
  const b = cmd.slice(j + 1)
  cmd.splice(0, cmd.length, ...x, ...a, '--', ...y, ...b)
}

/**
 * @param {bl.Connection} con
 */
function sigint(con, { json = false } = {}) {
  process.on('SIGINT', () => {
    process.exit(0)
  })
  // note: both process.on(SIGINT) and repl.on(SIGINT) finally go here
  process.on('exit', () => {
    if (json)
      console.log(JSON.stringify({ cmd: 'exit' }))
    else log.info('closing...')
    con.close()
  })
}

/**
 * @param {string[]} args
 */
function check_yes(args) {
  let index = -1
  for (let i = 0; i < args.length; ++i) {
    if (args[i] === '-y' || args[i] === '--yes') {
      index = i
      break
    }
    if (args[i] === '--')
      break
  }
  if (index >= 0) {
    args.splice(index, 1)
    return true
  }
  return false
}

const [arg1, arg2, ...rest] = process.argv.slice(2)
if (arg1 == null || arg1 === '--help' || arg2 === '--help' || rest.includes('--help')) {
  console.log(help)
  process.exit(0)
}

if (arg1 === '-v' || arg1 === '--version') {
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  console.log(`${pkg.name}, ${pkg.version}`)
  process.exit(0)
}

const yes = check_yes(rest)

let action = 'listen'
let id_or_keyword
let id

if (arg1 === 'get' || arg1 === 'd' || arg1 === 'dd' || arg1 === 'feed') {
  action = arg1
  id_or_keyword = arg2
}
else {
  id_or_keyword = arg1
}

if (arg1 !== 'feed' && !id_or_keyword) {
  console.log(help)
  process.exit(0)
}

// the feed command do not need room id, so handle it here
if (action === 'feed') {
  await feed({ json: arg2 === '--json' })
  process.exit()
}

// resolve keyword to room id
const maybe_id = Number.parseInt(id_or_keyword)
if (Number.isSafeInteger(maybe_id) && maybe_id > 0) {
  id = maybe_id
}
else {
  const rooms = await bl.searchRoom(id_or_keyword)
  if (rooms.length === 0) {
    log.error(`Not found room with keyword ${JSON.stringify(id_or_keyword)}`)
    process.exit(1)
  }
  else if (rooms.length === 1 || yes) {
    id = rooms[0].roomid
  }
  else {
    log.info(`Found ${rooms.length} rooms:`)
    const choices = []
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i]
      const title = bl.stripTags(room.title)
      log.info(`  ${String(i + 1).padStart(2)}: ${room.uname} - ${title}`)
      choices.push(i + 1)
    }
    choices.push('Y=1', 'n')
    const repl = setup_repl()
    const answer = await new Promise((resolve) => {
      repl.question(`Choose a room, or give up: (${format_choices(choices)}) `, a => resolve(a || 'Y'))
    })
    let selected = rooms[0]
    const i = Number.parseInt(answer)
    if (Number.isSafeInteger(i) && i >= 1 && i <= rooms.length)
      selected = rooms[i - 1]
    else if (answer[0].toLowerCase() === 'n')
      process.exit(0)

    id = selected.roomid
  }
}

if (action === 'listen') {
  const json = arg2 === '--json'
  if (arg2 && !json) {
    await send(id, arg2)
  }
  else {
    const con = listen(id, { json })
    sigint(con, { json })
  }
}
else if (action === 'get') {
  const json = rest.includes('--json')
  await get(id, { json })
}
else {
  const config = bl.read_config()
  modify_dd_args(rest, config.d || config.dd)
  let interval = 1
  let mpv = false
  let on_close = 'default'
  let args
  for (const arg of rest) {
    if (arg.startsWith('--interval=')) {
      const value = +arg.slice(11)
      if (Number.isFinite(value)) {
        interval = Math.max(0, value)
      }
      else {
        log.error('Invalid interval, expect a number >= 0')
        process.exit(1)
      }
    }
    else if (arg.startsWith('--on-close=')) {
      const value = arg.slice(11)
      if (['default', 'ask', 'quit', 'exit'].includes(value)) {
        on_close = value
      }
      else {
        log.error("Invalid on-close option, expect 'default' 'ask' 'quit'")
        process.exit(1)
      }
    }
    else if (arg === '--mpv') {
      mpv = true
    }
    else if (arg === '--default') {
      on_close = 'default'
    }
    else if (arg === '--ask') {
      on_close = 'ask'
    }
    else if (arg === '--quit' || arg === '--exit') {
      on_close = 'quit'
    }
    else if (arg === '--') {
      args = []
    }
    else if (args) {
      args.push(arg)
    }
  }
  const con = await D(id, { interval, mpv, on_close, args, yes })
  con && sigint(con)
}
