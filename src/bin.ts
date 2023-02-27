#!/usr/bin/env node
import os from "os";
import fs from "fs";
import tty from "tty";
import { join } from "path";
import cp from "child_process";
import readline from "readline";
import { Connection, Events, getRoomPlayInfo, sendDanmaku, testUrl } from "./index.js";

const help = `
Usage: bl <room_id>                      # listen danmaku
          --json                         # print all events in json

       bl <room_id> <message>            # send danmaku

       bl get <room_id>                  # get stream url
          --json                         # print them in json

       bl d <room_id> [--interval=1]     # dd mode
          --interval=<minutes>           # set 0 to disable polling
          --mpv                          # open in mpv instead
          --on-close=<behavior>          # do something on window close
                      default            # restart player
                      ask                # ask quality again
                      quit               # quit DD mode
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
const log = {
  error: (msg: string) => console.error(`${bgRed(black(" ERROR "))} ${red(msg)}`),
  info: (msg: string) => console.error(`${bgCyan(black(" BLIVC "))} ${cyan(msg)}`),
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
        init({ title, live_status, live_start_time }) {
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
        pause: () => repl && repl.pause(),
        resume: () => repl && repl.resume(),
      };

  return new Connection(id, events);
}

async function send(id: number, message: string) {
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
    await sendDanmaku(id, message, env).catch(log.catch_error);
  } else {
    log.error("Invalid cookie.txt");
    example();
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

async function D(id: number, { interval = 1, mpv = false, on_close = "default" } = {}) {
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
    choices.push("Y=1", "max", "n");
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
      }
    }
    return selected;
  }

  function play(url: string, title: string) {
    if (mpv) {
      const args = ["--quiet"];
      args.push("--http-header-fields=" + headers.join(","));
      args.push("--title=" + title);
      args.push("--geometry=50%");
      args.push(url);
      return cp.spawn("mpv", args, { stdio: "ignore", detached: true });
    } else {
      const args = ["-hide_banner", "-loglevel", "error"];
      args.push("-headers", headers.map((e) => e + "\r\n").join(""));
      args.push("-window_title", title);
      args.push("-x", "720", "-y", "405");
      args.push(url);
      return cp.spawn("ffplay", args, { stdio: "ignore" });
    }
  }

  let selected: string | undefined;
  async function replay(initial = true) {
    const info = await poll();
    if (!info) process.exit(0);

    if (initial) {
      selected = await ask(info);
    } else if (on_close === "default") {
      selected ||= await ask(info);
    } else if (on_close === "ask") {
      selected = await ask(info);
    } else if (on_close === "quit" || on_close === "exit") {
      selected = void 0;
    }
    if (!selected) process.exit(0);

    log.info(`Now playing: [${selected}] ${info.title}`);
    child = play(info.streams[selected].url, info.title);
    con ||= listen(id);
    con.resume();
    child.on("exit", () => {
      con.pause();
      log.info('to exit, press "Ctrl+C" in the console');
      setTimeout(replay, 100, false);
    });
  }

  await replay();

  const quit = con.events.quit;
  con.events.quit = () => {
    quit && quit();
    if (process.platform === "win32") {
      cp.execSync("taskkill /pid " + child.pid + " /T /F");
    } else {
      child.kill();
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

if (arg1 === "get" || arg1 === "d" || arg1 === "dd") {
  const id = Number.parseInt(arg2);
  if (Number.isSafeInteger(id) && id > 0) {
    if (arg1 === "get") {
      const json = rest.includes("--json");
      await get(id, { json });
    } else {
      let interval = 1;
      let mpv = false;
      let on_close = "default";
      for (const arg of rest) {
        if (arg.startsWith("--interval=")) {
          const value = Number.parseInt(arg.slice(11));
          if (Number.isFinite(value)) {
            interval = Math.max(0, value);
          } else {
            log.error("Invalid interval, expect a number >= 0");
            process.exit(1);
          }
        }
        if (arg.startsWith("--on-close=")) {
          const value = arg.slice(11);
          if (["default", "ask", "quit", "exit"].includes(value)) {
            on_close = value;
          } else {
            log.error("Invalid on-close option, expect 'default' 'ask' 'quit'");
            process.exit(1);
          }
        }
        if (arg === "--mpv") mpv = true;
      }
      const con = await D(id, { interval, mpv, on_close });
      con && sigint(con);
    }
  } else {
    console.log(help);
  }
} else {
  const id = Number.parseInt(arg1);
  const json = arg2 === "--json";
  if (Number.isSafeInteger(id) && id > 0) {
    if (arg2 && !json) {
      await send(id, arg2);
    } else {
      const con = listen(id, { json });
      sigint(con, { json });
    }
  } else {
    console.log(help);
  }
}
