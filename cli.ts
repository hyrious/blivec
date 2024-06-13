import type { OutgoingHttpHeaders } from 'node:http'

import fs from 'node:fs'
import tty from 'node:tty'
import process from 'node:process'
import cp from 'node:child_process'
import readline from 'node:readline'
import * as bl from './src/blivec.js'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const hasColors = tty.WriteStream.prototype.hasColors()

function format_(s: number, e: number) {
  return hasColors
    ? (m: string) => `\x1B[${s}m${m}\x1B[${e}m`
    : (m: string) => m
}

const bold = format_(1, 0)

const black = format_(30, 39)
const red = format_(31, 39)
const cyan = format_(36, 39)
const bgRed = format_(41, 49)
const bgCyan = format_(46, 49)
const gray = format_(90, 39)
const bgGray = format_(100, 49)
const bgWhite = format_(107, 49)

const blackBgWhite = (s: string) => bgWhite(black(s))
const blackBgGray = (s: string) => bgGray(black(s))
const blackBgRed = (s: string) => bgRed(black(s))
const blackBgCyan = (s: string) => bgCyan(black(s))

const log = {
  error: (msg: string) => console.error(blackBgRed(' ERROR '), red(msg)),
  info: (msg: string) => console.error(blackBgCyan(' BLIVC '), cyan(msg)),
  debug: (msg: string) => console.error(blackBgGray(' DEBUG '), gray(msg)),
  catchError: (error: Error) => {
    if (process.env.DEBUG)
      console.error(error)
    else log.error(error.message)
  },
}

const help = `
${blackBgWhite('Usage:')} bl <command> [arguments]
  ${bold('bl <room_id>')}            listen danmaku (need cookie to show names)
  ${bold('   --json')}               print all events in json

  ${bold('bl <room_id> <message>')}  send danmaku (requires cookie)

  ${bold('bl get <room_id>')}        get stream url
  ${bold('   --video')}              assume the keyword is not live but video
  ${bold('   --json')}               print streams in json

  ${bold('bl play <url>')}           get video url and play it
  ${bold('   --format=mp4')}         mp4, dash (1080p), av1
  ${bold('   --quality=480p')}       240p, 360p, 480p, 720p, 720p60, 1080p

  ${bold('bl feed')}                 get feed list (requires cookie)
  ${bold('   --json')}               print feeds in json
  ${bold('   --d')}                  ask for dd mode

  ${bold('bl d <room_id>')}          dd mode
  ${bold('   --interval=1')}         polling interval in minutes, 0 means once
  ${bold('   --mpv')}                open in mpv instead of ffplay
  ${bold('   --on-close=default')}   do somthing on player close
  ${bold('              default')}   restart player    (alias: --default)
  ${bold('              ask')}       ask quality again (alias: --ask)
  ${bold('              quit')}      quit player       (alias: --quit)
  ${bold('   -- [...arguments]')}    pass arguments to ffplay or mpv

${blackBgWhite('Global flags:')}
  ${bold('-y, --yes')}               answer 'y' to all prompts
  ${bold('-h, --help')}              show this help, then quit
  ${bold('-v')}                      show version, then turn on verbose mode

${blackBgWhite('Config:')}
  put a file '${bold('blivec.json')}' at ~/ or ~/.config to set default flags,
  example: ${bold(`{
    "dd": ["--mpv", "--quit", "--", "--volume=50"]
  }`)}

${blackBgWhite('Examples:')}
  ${bold('bl 123456')}
  ${bold('bl 123456 "Hello, world!"')}
  ${bold('bl get 123456')}
  ${bold('bl d 123456 --mpv --quit -- --volume=50')}
`.trim()

// Reuse this repl during the whole program
let repl_: readline.Interface | undefined
function repl() {
  if (!repl_) {
    repl_ = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
    })
    repl_.on('SIGINT', () => {
      repl_ && repl_.close()
      process.exit(0) // trigger process event 'exit'
    })
  }
  return repl_
}

function closeRepl() {
  if (repl_) {
    repl_.close()
    repl_ = undefined
  }
}

function formatInterval(minutes: number) {
  if (minutes === 1)
    return '1 minute'
  if (minutes < 1) {
    const seconds = Math.round(minutes * 60)
    if (seconds === 1)
      return '1 second'
    if (seconds > 1)
      return `${seconds | 0} seconds`
  }
  return `${minutes.toFixed(2)} minutes`
}

function formatDuration(seconds: number) {
  const minutes = seconds / 60 | 0
  return `${String(minutes).padStart(2, '0')}:${String(seconds - minutes * 60).padStart(2, '0')}`
}

function formatChoices(choices: (string | number)[]) {
  let n = 0
  while (choices[n] === n + 1) n++
  if (n <= 5)
    return choices.join('/')
  else
    return `1/2/../${n - 1}/${n}/${choices.slice(n).join('/')}`
}

function firstKey(obj: object): string {
  return Object.keys(obj)[0] || ''
}

function first(obj: object): any {
  return Object.values(obj)[0] || {}
}

function getCookie() {
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

async function feed({ json = false, d = false, yes = false } = {}) {
  const env = getCookie()

  const list = await bl.getFeedList(env).catch((err) => {
    log.catchError(err)
    process.exitCode = 1
    return null
  })

  if (!list)
    return ''

  if (json) {
    console.log(JSON.stringify(list, null, 2))
  }
  else {
    log.info(`Found ${list.length} rooms:`)
    for (let i = 0; i < list.length; i++) {
      const { roomid, uname, title } = list[i]
      log.info(`  [${String(i + 1).padStart(2)}] ${String(roomid).padStart(8)}: ${uname} - ${title}`)
    }
  }

  if (d && list.length > 0) {
    let answer = 'Y'
    if (yes) {
      log.info('Chooses [1] because of --yes')
    }
    else {
      const choices: (string | number)[] = list.map((_, i) => i + 1)
      choices.push('Y=1', 'n')
      answer = await new Promise<string>((resolve) => {
        repl().question(`Choose a room, or give up: (${formatChoices(choices)}) `, a => resolve(a || 'Y'))
      })
    }
    if (answer[0].toLowerCase() === 'n')
      return ''

    let selected = list[0]
    const i = Number.parseInt(answer)
    if (Number.isSafeInteger(i) && i >= 1 && i <= list.length)
      selected = list[i - 1]
    return selected.roomid
  }
  else {
    return ''
  }
}

const headers: OutgoingHttpHeaders = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:60.1) Gecko/20100101 Firefox/60.1',
  'Referer': 'https://live.bilibili.com/',
}

const headersCmdline = Object.entries(headers).map(([k, v]) => `${k}: ${v}`)

function spawnPlayer(mpv: boolean, url: string, title: string, extra: string[]) {
  if (mpv) {
    const args = ['--quiet']
    args.push(`--http-header-fields=${headersCmdline.join(',')}`)
    args.push(`--title=${title}`)
    args.push('--geometry=50%')
    args.push(...extra)
    args.push(url)
    return cp.spawn('mpv', args, { stdio: 'ignore', detached: true })
  }
  else {
    const args = ['-hide_banner', '-loglevel', 'error']
    args.push('-headers', headersCmdline.map(e => `${e}\r\n`).join(''))
    args.push('-window_title', title)
    args.push('-x', '720', '-y', '405')
    args.push(...extra)
    args.push(url)
    return cp.spawn('ffplay', args, { stdio: 'ignore' })
  }
}

async function getVideo(url: string, { play = false, json = false, yes = false, mpv = false, format = 'mp4', quality = '480p', args = [] as string[] } = {}) {
  let desc!: string, video_title!: string, video_url!: string[], data!: bl.PlayVideoInfo

  if (!(quality in bl.QN)) {
    log.error(`Invalid quality: ${JSON.stringify(quality)}, should be one of ${Object.keys(bl.QN)}`)
    process.exit(1)
  }

  if (quality.startsWith('1080') && !format.includes('dash')) {
    log.info('Turned on --format=dash because of 1080p')
    format = 'dash'
  }

  try {
    const videos = await bl.extractVideos(url, {
      format: format.split(',') as (keyof typeof bl.FNVAL)[],
      quality: quality as keyof typeof bl.QN,
      cookie: getCookie(),
    })
    if (videos && videos.length > 0) {
      const width = videos.length > 9 ? 2 : 1
      const choices: (string | number)[] = []
      for (let i = 0; i < videos.length; i++) {
        const { title, duration } = videos[i]
        log.info(`  ${String(i + 1).padStart(width)}: ${title} (${formatDuration(duration)})`)
        choices.push(i + 1)
      }
      video_title = videos[0].title
      choices.push('Y=1', 'n')
      let answer = 'Y'
      if (yes || videos.length === 1) {
        yes && log.info(`Chooses [${videos[0].title}] because of --yes`)
      }
      else {
        answer = await new Promise((resolve) => {
          repl().question(`Choose a part, or give up: (${formatChoices(choices)}) `, a => resolve(a || 'Y'))
        })
      }
      let selected = videos[0]
      const i = Number.parseInt(answer)
      if (Number.isSafeInteger(i) && i >= 1 && i <= videos.length)
        selected = videos[i - 1]
      else if (answer[0].toLowerCase() === 'n')
        process.exit(0)

      data = await selected.get()
      const { quality, durl } = data
      if (json) {
        console.log(JSON.stringify(data, null, 2))
      }
      else {
        desc = Object.keys(bl.QN).find(e => bl.QN[e as keyof typeof bl.QN] === quality)!
        video_url = durl ? durl.map(d => d.url) : []
        if (!play) {
          const width = video_url.length > 9 ? 2 : 1
          for (let i = 0; i < video_url.length; ++i)
            console.log(`  ${String(i + 1).padStart(width)}: ${video_url[i]}`)
        }
      }
    }
  }
  catch (err) {
    log.catchError(err)
    process.exitCode = 1
  }

  if (data.dash) {
    const v = data.dash.video[0]?.base_url
    const a = data.dash.audio?.[0]?.base_url
    if (!v && !a) {
      log.info('Not found any video')
      return
    }
    if (play) {
      // 1. Merge 2 streams with ffmpeg, and stream the result to HTTP endpoint
      const temp_port = 1145 + Math.floor(Math.random() * 14191)
      const temp_address = `http://localhost:${temp_port}`
      const temp_args = ['-headers', headersCmdline.map(e => `${e}\r\n`).join('')]
      v && temp_args.push('-i', v)
      a && temp_args.push('-i', a)
      temp_args.push('-codec', 'copy')
      temp_args.push('-f', 'mp4')
      temp_args.push('-listen', '1')
      temp_args.push('-movflags', 'frag_keyframe+empty_moov')
      temp_args.push(temp_address)
      if (process.env.DEBUG) {
        log.debug('spawn ffmpeg with args:')
        console.log(temp_args)
      }
      cp.spawn('ffmpeg', temp_args, { detached: true }) // will show a window, never mind
      log.info('DASH may not always work, set a lower quality if failed')
      // 2. Play it
      log.info(`Now Playing: [${desc}] ${video_title}`)
      const child = spawnPlayer(mpv, temp_address, video_title, args)
      child.on('exit', () => process.exit(0))
    }
    else {
      v && console.log(`  video: ${v}`)
      a && console.log(`  audio: ${a}`)
    }
    return
  }

  if (play && video_url && video_url.length > 0) {
    log.info(`Now Playing: [${desc}] ${video_title}`)
    const child = spawnPlayer(mpv, video_url[0], video_title, args)
    child.on('exit', () => process.exit(0))
  }

  if (!video_url || video_url.length === 0)
    log.info('Not found any video')
}

function listen(id: number, { json = false } = {}) {
  let count = 0
  let con: bl.Connection

  const events: Partial<bl.Events> = json
    ? {
        init: data => console.log(JSON.stringify({ cmd: 'init', data })),
        message: data => console.log(JSON.stringify(data)),
        error: log.catchError,
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

            repl().on('line', (line) => {
              line = line.trim()
              if (line === 'rs') {
                con.reconnect()
              }
              else if (line.startsWith('> ') && line.length > 2) {
                readline.moveCursor(process.stdout, 0, -1) // move up
                readline.clearLine(process.stdout, 0) // clear the user input
                line = line.slice(2)
                bl.sendDanmaku(id, line, getCookie()).catch(log.catchError)
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
          if (typeof a === 'object' && a && a.cmd.startsWith('DANMU_MSG')) {
            const time = new Date(a.info[0][4]).toLocaleString('zh-CN').slice(-8, -3)
            const message = a.info[1]
            const user = a.info[2][1]
            console.log(`[${time}] [${user}]`, message)
          }
        },
        error: log.catchError,
        quit: closeRepl,
      }

  con = new bl.Connection(id, events)

  return con
}

function sigint(con: bl.Connection, { json = false } = {}) {
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

async function get(id: number, { json = false } = {}) {
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
    log.catchError(err)
  }
}

async function D(id: number, { interval = 1, mpv = false, on_close = 'default', yes = false, args = [] as string[] } = {}) {
  log.info(`DD ${id} ${interval > 0 ? `every ${formatInterval(interval)}` : 'once'}`)

  let con!: bl.Connection
  let child: cp.ChildProcess

  async function poll() {
    let info: Awaited<ReturnType<typeof bl.getRoomPlayInfo>> | null = null
    while (info === null) {
      info = await bl.getRoomPlayInfo(id).catch(() => null)
      if (info && !(await bl.testUrl(first(info.streams).url, headers)))
        info = null
      if (info || interval === 0)
        break
      await delay(interval * 60 * 1000)
    }
    return info
  }

  // returns undefined if user inputs 'n'
  async function ask(info: NonNullable<Awaited<ReturnType<typeof poll>>>) {
    const { title, streams } = info
    log.info('====='.repeat(12))
    log.info(`Title: ${title}`)
    log.info('====='.repeat(12))
    log.info('Available streams:')
    const names = Object.keys(streams)
    const width = names.length > 9 ? 2 : 1
    const choices: (string | number)[] = []
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      log.info(`  ${String(i + 1).padStart(width)}: ${name}`)
      choices.push(i + 1)
    }
    choices.push('Y=1', 'max', 'n', 'retry')
    let answer = 'Y'
    if (yes) {
      log.info(`Chooses [${names[0]}] because of --yes`)
    }
    else {
      answer = await new Promise((resolve) => {
        repl().question(`Choose a stream, or give up: (${formatChoices(choices)}) `, a => resolve(a || 'Y'))
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

  let selected: string | undefined
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
      if (!selected || !(selected in info.streams))
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
    child = spawnPlayer(mpv, info.streams[selected].url, info.title, args)
    con ||= listen(id)
    child.on('exit', () => {
      if (!(on_close === 'quit' || on_close === 'exit'))
        log.info('to exit, press "Ctrl+C" in the console')
      setTimeout(replay, 100, false)
    })
  }

  await replay()

  const quit = con.events.quit
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

  return con
}

const args = process.argv.slice(2)
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  console.log(help)
  process.exit(0)
}

if (args.includes('-v') || args.includes('--version')) {
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  console.log(`${pkg.name}, ${pkg.version}`)
  process.exit(0)
}

function apply_config(dd: string[] | undefined) {
  if (dd == null)
    return
  const i = dd.indexOf('--')
  if (i === -1) {
    args.unshift(...dd)
  }
  else {
    const x = dd.slice(0, i)
    const y = dd.slice(i + 1)
    const j = args.indexOf('--')
    if (j === -1) {
      args.unshift(...x)
      args.push('--', ...y)
    }
    else {
      const a = args.slice(0, j)
      const b = args.slice(j + 1)
      args.splice(0, args.length, ...x, ...a, '--', ...y, ...b)
    }
  }
}

const config = bl.read_config()
if (config) {
  if (args[0] === 'play')
    apply_config(config.play || config.d || config.dd)
  else if (args[0] === 'feed' || args[0] === 'd' || args[0] === 'dd')
    apply_config(config.d || config.dd)
}

let d = false
let yes = false
let video = false
let json = false
let mpv = false
let interval = 1
let format = 'mp4'
let quality = '480p'
let on_close = 'default'
let playerArgs: string[] = []
const rest: string[] = []

for (let i = 0; i < args.length; ++i) {
  if (args[i] === '-y' || args[i] === '--yes') {
    yes = true
    continue
  }
  if (args[i] === '--json') {
    json = true
    continue
  }
  if (args[i] === '--mpv') {
    mpv = true
    continue
  }
  if (args[i] === '--video') {
    video = true
    continue
  }
  if (args[i] === '--interval' || args[i].startsWith('--interval=')) {
    if (args[i] === '--interval')
      interval = Number(args[++i])
    else
      interval = Number(args[i].slice('--interval='.length))
    if (Number.isNaN(interval) || interval < 0) {
      log.error(`Invalid interval: ${args[i]}, expect a number >= 0`)
      process.exit(1)
    }
    continue
  }
  if (args[i] === '--format' || args[i].startsWith('--format=')) {
    if (args[i] === '--format')
      format = (args[++i])
    else
      format = (args[i].slice('--format='.length))
    continue
  }
  if (args[i] === '--quality' || args[i].startsWith('--quality=')) {
    if (args[i] === '--quality')
      quality = (args[++i])
    else
      quality = (args[i].slice('--quality='.length))
    continue
  }
  if (args[i] === '--on-close' || args[i].startsWith('--on-close=')) {
    if (args[i] === '--on-close')
      on_close = (args[++i])
    else
      on_close = (args[i].slice('--on-close='.length))
    continue
  }
  if (args[i] === '--default') {
    on_close = 'default'
    continue
  }
  if (args[i] === '--ask') {
    on_close = 'ask'
    continue
  }
  if (args[i] === '--quit' || args[i] === '--exit') {
    on_close = 'quit'
    continue
  }
  if (args[i] === '-d' || args[i] === '--d' || args[i] === '--dd') {
    d = true
    continue
  }
  if (args[i] === '--') {
    playerArgs = args.slice(i + 1)
    break
  }
  else {
    rest.push(args[i])
  }
}

// Choose action by first command string
let action = rest.shift()

let roomId: string
const commands = new Set(['listen', 'get', 'play', 'd', 'dd', 'feed'])
if (action && commands.has(action)) {
  roomId = rest.shift()!
}
else if (action) {
  roomId = action
  action = 'listen'
}
else {
  console.log(help)
  process.exit(0)
}

if (action !== 'feed' && !roomId) {
  console.log(help)
  process.exit(0)
}

// the feed command do not need room id, so handle it here
if (action === 'feed') {
  roomId = await feed({ json, d, yes })
  if (!roomId)
    process.exit()
}

// If "get <?> --video", assume the keyword is used for searching video
if (action === 'get' && video && !roomId.includes('://')) {
  const videos = await bl.searchVideo(roomId)
  if (videos.length === 0) {
    log.error(`Not found video with keyword "${roomId}"`)
    process.exit(1)
  }
  else if (videos.length === 1 || yes) {
    roomId = videos[0].arcurl
  }
  else {
    log.info(`Found ${videos.length} videos:`)
    const choices: (string | number)[] = []
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i]
      const title = bl.stripTags(video.title)
      log.info(`  ${String(i + 1).padStart(2)}: ${video.author} - ${title}`)
      choices.push(i + 1)
    }
    choices.push('Y=1', 'n')
    const answer = await new Promise<string>((resolve) => {
      repl().question(`Choose a video, or give up: (${formatChoices(choices)}) `, a => resolve(a || 'Y'))
    })
    let selected = videos[0]
    const i = Number.parseInt(answer)
    if (Number.isSafeInteger(i) && i >= 1 && i <= videos.length)
      selected = videos[i - 1]
    else if (answer[0].toLowerCase() === 'n')
      process.exit(0)
    roomId = selected.arcurl
  }
  // now roomId is a video URL
}

// handle "get <url>" here
if ((action === 'get' || action === 'play') && roomId.includes('://')) {
  await getVideo(roomId, { json, yes, play: action === 'play', mpv, format, quality, args: playerArgs })
  process.exit()
}

// handle "play <keyword>" here
if (action === 'play') {
  const videos = await bl.searchVideo(roomId)
  if (videos.length === 0) {
    log.error(`Not found video with keyword "${roomId}"`)
    process.exit(1)
  }
  else if (videos.length === 1 || yes) {
    roomId = videos[0].arcurl
  }
  else {
    log.info(`Found ${videos.length} videos:`)
    const choices: (string | number)[] = []
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i]
      const title = bl.stripTags(video.title)
      log.info(`  ${String(i + 1).padStart(2)}: ${video.author} - ${title}`)
      choices.push(i + 1)
    }
    choices.push('Y=1', 'n')
    const answer = await new Promise<string>((resolve) => {
      repl().question(`Choose a video, or give up: (${formatChoices(choices)}) `, a => resolve(a || 'Y'))
    })
    let selected = videos[0]
    const i = Number.parseInt(answer)
    if (Number.isSafeInteger(i) && i >= 1 && i <= videos.length)
      selected = videos[i - 1]
    else if (answer[0].toLowerCase() === 'n')
      process.exit(0)
    roomId = selected.arcurl
  }
  await getVideo(roomId, { json, yes, play: true, mpv, format, quality })
  process.exit()
}

// search(roomId)
let id: number
const maybeId = Number.parseInt(roomId)
if (Number.isSafeInteger(maybeId) && maybeId > 0) {
  id = maybeId
}
else {
  const rooms = await bl.searchRoom(roomId)
  if (rooms.length === 0) {
    log.error(`Not found room with keyword ${JSON.stringify(roomId)}`)
    process.exit(1)
  }
  else if (rooms.length === 1 || yes) {
    id = rooms[0].roomid
  }
  else {
    log.info(`Found ${rooms.length} rooms:`)
    const choices: (string | number)[] = []
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i]
      const title = bl.stripTags(room.title)
      log.info(`  ${String(i + 1).padStart(2)}: ${room.uname} - ${title}`)
      choices.push(i + 1)
    }
    choices.push('Y=1', 'n')
    const answer = await new Promise<string>((resolve) => {
      repl().question(`Choose a room, or give up: (${formatChoices(choices)}) `, a => resolve(a || 'Y'))
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

// listen | get | dd
if (action === 'listen') {
  if (!json && rest.length > 0)
    await bl.sendDanmaku(id, rest.join(' '), getCookie()).catch(log.catchError)
  else
    sigint(listen(id, { json }), { json })
}
else if (action === 'get') {
  await get(id, { json })
}
else {
  sigint(await D(id, { interval, mpv, on_close, args: playerArgs, yes }))
}
