#!/usr/bin/env node
import os from "os";
import fs from "fs";
import tty from "tty";
import { join } from "path";
import cp from "child_process";
import readline from "readline";
import {
  Connection,
  Events,
  getFeedList,
  getRoomPlayInfo,
  searchRoom,
  sendDanmaku,
  stripTags,
  testUrl,
} from "./index.js";

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
                default             # restart player
                ask                 # ask quality again
                quit                # quit DD mode
     -- [...player_args]            # pass args to ffplay or mpv

Examples:
  bl 123456
  bl 123456 "Hello, world!"
  bl get 123456
  bl d 123456 --mpv --on-close=quit -- --volume=50
`.trim();

const has_colors = tty.WriteStream.prototype.hasColors();

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const format = (s: number, e: number) =>
  has_colors ? (m: string) => "\x1B[" + s + "m" + m + "\x1B[" + e + "m" : (m: string) => m;
const red = format(31, 39);
const cyan = format(36, 39);
const black = format(30, 39);
const bgRed = format(41, 49);
const bgCyan = format(46, 49);
const gray = format(90, 39);
const bgGray = format(100, 49);
const log = {
  error: (msg: string) => console.error(`${bgRed(black(" ERROR "))} ${red(msg)}`),
  info: (msg: string) => console.error(`${bgCyan(black(" BLIVC "))} ${cyan(msg)}`),
  debug: (msg: string) => console.error(`${bgGray(black(" DEBUG "))} ${gray(msg)}`),
  catch_error: (error: Error) => log.error(error.message),
};

// Reuse this repl during the whole program
// 1. Listen 'line' event in danmaku mode to send message
// 2. Question about the stream quality in DD mode, this will temporarily eat the next 'line' event,
//    @see https://github.com/nodejs/node/blob/-/lib/internal/readline/interface.js#L408
let repl: readline.Interface | undefined;
function setup_repl() {
  if (!repl) {
    repl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "",
    });
    repl.on("SIGINT", () => {
      repl && repl.close();
      process.exit(0); // trigger process event 'exit'
    });
  }
  return repl;
}
function quit_repl() {
  if (repl) {
    repl.close();
    repl = void 0;
  }
}

function listen(id: number, { json = false } = {}) {
  let count = 0;

  const events: Events = json
    ? {
        init: (data) => console.log(JSON.stringify({ cmd: "init", data })),
        message: (data) => console.log(JSON.stringify(data)),
        error: log.catch_error,
      }
    : {
        init({ title, live_status, live_start_time, host_list }, index) {
          if (count === 0) {
            if (live_status === 1) {
              const time = new Date(live_start_time * 1000).toLocaleString();
              log.info(`listening ${title} (start at ${time})`);
            } else {
              log.info(`listening ${title} (offline)`);
            }
            const repl = setup_repl();
            repl.on("line", (line) => {
              line = line.trim();
              if (line.startsWith("> ") && line.length > 2) {
                readline.moveCursor(process.stdout, 0, -1); // move up
                readline.clearLine(process.stdout, 0); // clear the user input
                line = line.slice(2);
                send(id, line).catch(log.catch_error);
              } else {
                log.info('message needs to start with "> " (space is required)');
              }
            });
          } else {
            log.info(`reconnected (x${count})`);
          }
          count++;
          const { host, port } = host_list[index];
          log.debug(`connecting tcp://${host}:${port}`);
        },
        message(a) {
          if (typeof a === "object" && a !== null && a.cmd === "DANMU_MSG") {
            const message = a.info[1];
            const user = a.info[2][1];
            console.log(`[${user}]`, message);
          }
        },
        error: log.catch_error,
        quit: quit_repl,
      };

  return new Connection(id, events);
}

function example() {
  console.error("Example content:");
  console.error("");
  console.error("SESSDATA=...");
  console.error("bili_jct=...");
  console.error();
}

function cookiePath(path?: string | undefined) {
  if (fs.existsSync("cookie.txt")) return "cookie.txt";
  path = join(os.homedir(), "cookie.txt");
  if (fs.existsSync(path)) return path;
  path = join(os.homedir(), ".config", "cookie.txt");
  if (fs.existsSync(path)) return path;
  path = join(os.homedir(), ".config", "blivec", "cookie.txt");
  if (fs.existsSync(path)) return path;
}

function get_cookie() {
  const path = cookiePath();
  if (!path) {
    log.error('Please create a file "cookie.txt" in current directory.');
    example();
    process.exit(1);
  }

  const cookie = fs.readFileSync(path, "utf-8");
  let env = { SESSDATA: "", bili_jct: "" };
  for (const line of cookie.split("\n")) {
    if (line.startsWith("SESSDATA=")) {
      env.SESSDATA = line.slice(9).trimEnd();
    }
    if (line.startsWith("bili_jct=")) {
      env.bili_jct = line.slice(9).trimEnd();
    }
  }

  if (env.SESSDATA && env.bili_jct) {
    return env;
  } else {
    log.error("Invalid cookie.txt");
    example();
    process.exit(1);
  }
}

async function send(id: number, message: string) {
  const env = get_cookie();
  await sendDanmaku(id, message, env).catch(log.catch_error);
}

async function feed({ json = false } = {}) {
  const env = get_cookie();
  let res;

  try {
    res = await getFeedList(env);
  } catch (err) {
    log.catch_error(err);
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(JSON.stringify(res.list, null, 2));
    return;
  }

  log.info(`Found ${res.results} rooms:`);
  for (let i = 0; i < res.list.length; i++) {
    const { roomid, uname, title } = res.list[i];
    log.info(`  [${String(i + 1).padStart(2)}] ${String(roomid).padStart(8)}: ${uname} - ${title}`);
  }
}

async function get(id: number, { json = false } = {}) {
  try {
    const info = await getRoomPlayInfo(id);
    if (!json) {
      console.log("Title:", info.title);
      console.log();
    }
    for (const name in info.streams) {
      const stream = info.streams[name];
      if (!json) {
        console.log(`  ${name}: ${stream.url}`);
        console.log();
      }
    }
    if (json) {
      console.log(JSON.stringify(info, null, 2));
    }
  } catch (err) {
    log.catch_error(err);
  }
}

async function D(id: number, { interval = 1, mpv = false, on_close = "default", args = <string[]>[] } = {}) {
  log.info(`DD ${id} ${interval > 0 ? `every ${interval} minutes` : "once"}`);

  let con!: Connection;
  let child!: cp.ChildProcess;

  const headers = [
    "User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:60.1) Gecko/20100101 Firefox/60.1",
    "Referer: https://live.bilibili.com/",
  ];

  type RoomPlayInfo = Awaited<ReturnType<typeof getRoomPlayInfo>>;
  async function poll() {
    let info: RoomPlayInfo | null = null;
    while (info === null) {
      info = await getRoomPlayInfo(id).catch(() => null);
      if (info && !(await testUrl(first(info.streams).url, headers))) info = null;
      if (info || interval === 0) break;
      await delay(interval * 60 * 1000);
    }
    function first<T extends {}>(obj: T): T[keyof T] {
      for (const key in obj) return obj[key];
      return {} as any;
    }
    return info;
  }

  // returns undefined if user inputs 'n'
  async function ask(info: RoomPlayInfo): Promise<string | undefined> {
    const { title, streams } = info;
    log.info("=====".repeat(12));
    log.info("Title: " + title);
    log.info("=====".repeat(12));
    log.info("Available streams:");
    const names = Object.keys(streams);
    const width = names.length > 9 ? 2 : 1;
    const choices: Array<number | string> = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      log.info(`  ${String(i + 1).padStart(width)}: ${name}`);
      choices.push(i + 1);
    }
    choices.push("Y=1", "max", "n", "retry");
    const repl = setup_repl();
    const answer = await new Promise<string>((resolve) => {
      repl.question(`Choose a stream, or give up: (${choices.join("/")}) `, (a) => resolve(a || "Y"));
    });
    let selected = names[0];
    let i = Number.parseInt(answer);
    if (Number.isSafeInteger(i) && 1 <= i && i <= names.length) {
      selected = names[i - 1];
    } else {
      switch (answer[0].toLowerCase()) {
        case "n":
          return;
        case "m":
          selected = names.reduce((a, b) => (streams[a].qn > streams[b].qn ? a : b));
          break;
        case "r":
          return "retry";
      }
    }
    return selected;
  }

  function play(url: string, title: string, extra: string[]) {
    if (mpv) {
      const args = ["--quiet"];
      args.push("--http-header-fields=" + headers.join(","));
      args.push("--title=" + title);
      args.push("--geometry=50%");
      args.push(...extra);
      args.push(url);
      return cp.spawn("mpv", args, { stdio: "ignore", detached: true });
    } else {
      const args = ["-hide_banner", "-loglevel", "error"];
      args.push("-headers", headers.map((e) => e + "\r\n").join(""));
      args.push("-window_title", title);
      args.push("-x", "720", "-y", "405");
      args.push(...extra);
      args.push(url);
      return cp.spawn("ffplay", args, { stdio: "ignore" });
    }
  }

  function firstKey<T extends {}>(obj: T): keyof T {
    for (const key in obj) return key;
    return "" as any;
  }

  let selected: string | undefined;
  async function replay(initial = true) {
    if (!initial && (on_close === "quit" || on_close === "exit")) {
      process.exit(0);
    }

    const info = await poll();
    if (!info) process.exit(0);

    if (initial) {
      selected = await ask(info);
    } else if (on_close === "default") {
      selected ||= await ask(info);
      // It is possible that the selected quality is missing now
      // in which case we fallback to the first available one
      if (!(selected! in info.streams)) {
        selected = firstKey(info.streams);
      }
    } else if (on_close === "ask") {
      selected = await ask(info);
    } else if (on_close === "quit" || on_close === "exit") {
      selected = void 0;
    }
    if (selected === "retry") {
      await replay(initial);
      return;
    }
    if (!selected) process.exit(0);

    log.info(`Now playing: [${selected}] ${info.title}`);
    child = play(info.streams[selected].url, info.title, args);
    con ||= listen(id);
    con.resume();
    child.on("exit", () => {
      con.pause();
      if (!(on_close === "quit" || on_close === "exit")) {
        log.info('to exit, press "Ctrl+C" in the console');
      }
      setTimeout(replay, 100, false);
    });
  }

  await replay();

  const quit = con.events.quit;
  con.events.quit = () => {
    quit && quit();
    try {
      if (process.platform === "win32") {
        cp.execSync("taskkill /pid " + child.pid + " /T /F", { stdio: "ignore" });
      } else {
        child.kill();
      }
    } catch {
      // ignore killing error
    }
  };

  return con;
}

function sigint(con: Connection, { json = false } = {}) {
  process.on("SIGINT", () => {
    process.exit(0);
  });
  // note: both process.on(SIGINT) and repl.on(SIGINT) finally go here
  process.on("exit", () => {
    if (json) console.log(JSON.stringify({ cmd: "exit" }));
    else log.info("closing...");
    con.close();
  });
}

const [arg1, arg2, ...rest] = process.argv.slice(2);
if (arg1 === void 0 || arg1 === "--help" || arg2 === "--help" || rest.includes("--help")) {
  console.log(help);
  process.exit(0);
}

let action = "listen";
let id_or_keyword: string;
let id: number;

if (arg1 === "get" || arg1 === "d" || arg1 === "dd" || arg1 === "feed") {
  action = arg1;
  id_or_keyword = arg2;
} else {
  id_or_keyword = arg1;
}

if (arg1 !== "feed" && !id_or_keyword) {
  console.log(help);
  process.exit(0);
}

// the feed command do not need room id, so handle it here
if (action === "feed") {
  await feed({ json: arg2 === "--json" });
  process.exit();
}

// resolve keyword to room id
let maybe_id = Number.parseInt(id_or_keyword);
if (Number.isSafeInteger(maybe_id) && maybe_id > 0) {
  id = maybe_id;
} else {
  let rooms = await searchRoom(id_or_keyword);
  if (rooms.length === 0) {
    log.error("Not found room with keyword " + JSON.stringify(id_or_keyword));
    process.exit(1);
  } else if (rooms.length === 1) {
    id = rooms[0].roomid;
  } else {
    log.info("Found multiple rooms:");
    const choices: Array<number | string> = [];
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i];
      const title = stripTags(room.title);
      log.info(`  ${String(i + 1).padStart(2)}: ${room.uname} - ${title}`);
      choices.push(i + 1);
    }
    choices.push("Y=1", "n");
    const repl = setup_repl();
    const answer = await new Promise<string>((resolve) => {
      repl.question(`Choose a room, or give up: (${choices.join("/")}) `, (a) => resolve(a || "Y"));
    });
    let selected = rooms[0];
    let i = Number.parseInt(answer);
    if (Number.isSafeInteger(i) && 1 <= i && i <= rooms.length) {
      selected = rooms[i - 1];
    } else if (answer[0].toLowerCase() === "n") {
      process.exit(0);
    }
    id = selected.roomid;
  }
}

if (action === "listen") {
  const json = arg2 === "--json";
  if (arg2 && !json) {
    await send(id, arg2);
  } else {
    const con = listen(id, { json });
    sigint(con, { json });
  }
} else if (action === "get") {
  const json = rest.includes("--json");
  await get(id, { json });
} else {
  let interval = 1;
  let mpv = false;
  let on_close = "default";
  let args: string[] | undefined;
  for (const arg of rest) {
    if (arg.startsWith("--interval=")) {
      const value = Number.parseInt(arg.slice(11));
      if (Number.isFinite(value)) {
        interval = Math.max(0, value);
      } else {
        log.error("Invalid interval, expect a number >= 0");
        process.exit(1);
      }
    } else if (arg.startsWith("--on-close=")) {
      const value = arg.slice(11);
      if (["default", "ask", "quit", "exit"].includes(value)) {
        on_close = value;
      } else {
        log.error("Invalid on-close option, expect 'default' 'ask' 'quit'");
        process.exit(1);
      }
    } else if (arg === "--mpv") {
      mpv = true;
    } else if (arg === "--") {
      args = [];
    } else if (args) {
      args.push(arg);
    }
  }
  const con = await D(id, { interval, mpv, on_close, args });
  con && sigint(con);
}
