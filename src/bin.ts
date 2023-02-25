#!/usr/bin/env node
import os from "os";
import fs from "fs";
import { join } from "path";
import rl from "readline";
import cp, { ChildProcess } from "child_process";
import { setTimeout } from "timers/promises";
import {
  Connection,
  Events,
  getRoomPlayInfo,
  sendDanmaku,
  testUrl,
} from "./index.js";

const help_text = `
Usage: bl <room_id>                      # listen danmaku
          --json                         # print all events in json

       bl <room_id> <message>            # send danmaku

       bl get <room_id>                  # get stream url
          --json                         # print them in json

       bl d <room_id> [--interval=1]     # dd mode
          --interval=<minutes>           # set 0 to disable polling
          --mpv                          # open in mpv instead
`.trim();

function help() {
  console.log(help_text);
}

function listen(id: number, { json = false } = {}) {
  let repl: rl.Interface | undefined;

  function setup_repl() {
    if (process.stdout.isTTY) {
      console.log('[blivec] type "> message" to send danmaku');
      repl = rl.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "",
      });
      repl.on("line", (line) => {
        line = line.trim();
        if (line.startsWith("> ") && line.length > 2) {
          rl.moveCursor(process.stdout, 0, -1); // move up
          rl.clearLine(process.stdout, 0); // clear the user input
          line = line.slice(2);
          send(id, line).catch(console.error);
        } else {
          console.log(
            '[blivec] message needs to start with "> " (space is required)'
          );
        }
      });
      repl.on("SIGINT", () => {
        repl && repl.close();
        process.exit(0);
      });
    }
  }

  const events: Events = json
    ? {
        init: (data) => console.log(JSON.stringify({ cmd: "init", data })),
        message: (data) => console.log(JSON.stringify(data)),
        error: console.error,
      }
    : {
        init({ title, live_status, live_start_time }) {
          if (live_status === 1) {
            const time = new Date(live_start_time * 1000).toLocaleString();
            console.log(`[blivec] listening ${title} (start at ${time})`);
          } else {
            console.log(`[blivec] listening ${title} (offline)`);
          }
          setup_repl();
        },
        message(a) {
          if (typeof a === "object" && a !== null && a.cmd === "DANMU_MSG") {
            const message = a.info[1];
            const user = a.info[2][1];
            console.log(`[${user}]`, message);
          }
        },
        error: console.error,
        quit: () => repl && repl.close(),
      };

  return new Connection(id, events);
}

async function send(id: number, message: string) {
  function example() {
    console.log("Example content:");
    console.log("");
    console.log("SESSDATA=...");
    console.log("bili_jct=...");
    console.log();
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
    console.log('Please create a file "cookie.txt" in current directory.');
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
    await sendDanmaku(id, message, env).catch(console.error);
  } else {
    console.log("Invalid cookie.txt");
    example();
    process.exit(1);
  }
}

async function get(id: number, { json = false } = {}) {
  try {
    const info = await getRoomPlayInfo(id);
    const title = info.title;
    if (!json) {
      console.log("Title:", title);
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
  } catch (err: any) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

async function D(id: number, { interval = 1, mpv = false } = {}) {
  const headers = [
    "User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:60.1) Gecko/20100101 Firefox/60.1",
    "Referer: https://live.bilibili.com/",
  ];

  type RoomPlayInfo = Awaited<ReturnType<typeof getRoomPlayInfo>>;
  let info: RoomPlayInfo | null = null;
  console.log(
    `[blivec] DD ${id}`,
    interval > 0 ? `every ${interval} minutes` : "once"
  );
  while (info === null) {
    info = await getRoomPlayInfo(id).catch(() => null);
    if (info && !(await testUrl(fst(info.streams).url, headers))) info = null;
    if (info || interval === 0) break;
    await setTimeout(interval * 60 * 1000);
  }
  function fst<T extends {}>(obj: T): T[keyof T] {
    for (const key in obj) return obj[key];
    return {} as any;
  }

  if (info === null) {
    return;
  }

  const { title, streams } = info;
  console.log("[blivec] " + "=====".repeat(10));
  console.log("[blivec] Title:", title);
  console.log("[blivec] " + "=====".repeat(10));

  console.log("[blivec] Available streams:");
  const names = Object.keys(streams);
  names.forEach((name, index) => {
    console.log(`  ${index + 1}: ${name}`);
  });
  const input = rl.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const choices = Array.from({ length: names.length }, (_, i) => i + 1);
  const hint = [...choices, "Y=1", "max", "n"].join("/");
  const choice = await new Promise<string>((resolve) => {
    input.question(`[blivec] Choose a stream, or give up: (${hint}) `, (a) => {
      input.close();
      resolve(a || "Y");
    });
  });
  const i = Number.parseInt(choice);
  let selected = names[0];
  if (Number.isSafeInteger(i) && 1 <= i && i <= names.length) {
    selected = names[i - 1];
  } else {
    const a = choice[0].toLowerCase();
    if (a === "n") {
      return;
    } else if (a === "m") {
      selected = names.reduce((a, b) =>
        streams[a].qn > streams[b].qn ? a : b
      );
    }
  }

  console.log("[blivec] Now playing:", `[${selected}] ${title}`);
  const url = streams[selected].url;

  let child: ChildProcess;
  if (mpv) {
    const args = ["--quiet"];
    args.push("--http-header-fields=" + headers.join(","));
    args.push("--title=" + title);
    args.push("--geometry=50%");
    args.push(url);
    child = cp.spawn("mpv", args, { stdio: "inherit", detached: true });
    child.unref();
  } else {
    const args = ["-hide_banner", "-loglevel", "error"];
    args.push("-headers", headers.map((e) => e + "\r\n").join(""));
    args.push("-window_title", title);
    args.push("-x", "1280", "-y", "720");
    args.push(url);
    child = cp.spawn("ffplay", args, { stdio: "inherit" });
  }

  const con = listen(id);
  child.once("exit", () => con.close());
  return con;
}

function sigint(con: Connection, { json = false } = {}) {
  process.on("SIGINT", () => {
    process.exit(0);
  });
  // note: both process.on(SIGINT) and repl.on(SIGINT) finally go here
  process.on("exit", () => {
    if (json) console.log(JSON.stringify({ cmd: "exit" }));
    else console.log("\n[blivec] closing...");
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
      for (const arg of rest) {
        if (arg.startsWith("--interval=")) {
          const value = Number.parseInt(arg.slice(11));
          if (Number.isFinite(value)) {
            interval = Math.max(0, value);
          } else {
            console.error("Invalid interval, expect a number >= 0");
            process.exit(1);
          }
        }
        if (arg === "--mpv") mpv = true;
      }
      const con = await D(id, { interval, mpv });
      con && sigint(con);
    }
  } else {
    help();
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
    help();
  }
}
