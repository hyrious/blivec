#!/usr/bin/env node
import fs from "fs";
import cp from "child_process";
import { Connection, getRoomPlayInfo, sendDanmaku } from "./index.js";

const [arg1, arg2] = process.argv.slice(2);

if (arg1 === "get") {
  const id = Number.parseInt(arg2);
  if (Number.isSafeInteger(id) && id > 0) {
    get(id);
  } else {
    help();
  }
} else {
  const id = Number.parseInt(arg1);
  if (Number.isSafeInteger(id) && id > 0) {
    arg2 ? send(id, arg2) : listen(id);
  } else {
    help();
  }
}

function help() {
  console.log("Usage: bl <room_id>             # listen danmaku");
  console.log("       bl <room_id> <message>   # send danmaku");
  console.log("       bl get <room_id>         # get stream url");
  process.exit(0);
}

function listen(id: number) {
  function is_object(a: any) {
    return typeof a === "object" && a !== null;
  }

  const con = new Connection(id, {
    init({ title, live_status, live_start_time }) {
      console.log(
        `[blivec] listening ${title}`,
        live_status === 1
          ? `(start at ${new Date(live_start_time * 1000).toLocaleString()})`
          : "(offline)"
      );
    },
    message(data) {
      if (is_object(data) && data.cmd === "DANMU_MSG") {
        const message = data.info[1];
        const user = data.info[2][1];
        console.log(`[${user}]`, message);
      }
    },
    error: console.error,
  });

  process.on("SIGINT", () => {
    if (!con.closed) {
      console.log("\n[blivec] closing...");
      con.close();
    }
  });
}

function send(id: number, message: string) {
  function example() {
    console.log("Example content:");
    console.log("");
    console.log("SESSDATA=...");
    console.log("bili_jct=...");
    console.log();
  }

  if (!fs.existsSync("cookie.txt")) {
    console.log('Please create a file "cookie.txt" in current directory.');
    example();
    process.exit(1);
  }

  const cookie = fs.readFileSync("cookie.txt", "utf-8");
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
    sendDanmaku(id, message, env).catch(console.error);
  } else {
    console.log("Invalid cookie.txt");
    example();
    process.exit(1);
  }
}

async function get(id: number) {
  const info = await getRoomPlayInfo(id);
  if (!info.ok) {
    console.log("Error:", info.reason);
    process.exit(1);
  }

  const platurl = info.data.playurl_info.playurl;
  const codec = platurl.stream[0].format[0].codec[0];
  const { base_url, url_info } = codec;
  const { host, extra } = url_info[(Math.random() * url_info.length) | 0];

  const url = host + base_url + extra;
  console.log(url);

  if (process.env.BLIVEC_FFPLAY) {
    const headers = [
      "User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:60.1) Gecko/20100101 Firefox/60.1\r\n",
      "Referer: https://live.bilibili.com/\r\n",
    ];
    const args = [url, "-headers", headers.join(""), "-window_title", "a.flv"];
    cp.spawnSync("ffplay", args, { stdio: "inherit" });
  }
}
