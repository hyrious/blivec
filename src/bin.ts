#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { getTempDir, Connection, input, sendDanmaku } from "./index.js";

const [raw_id, message] = process.argv.slice(2);
const id = Number.parseInt(raw_id);
const safe = Number.isSafeInteger(id) && id > 0;

if (!safe) {
  console.log("Usage: bl <room_id>");
  console.log('       bl <room_id> "message-to-send" (requires cookie)');
  process.exit(0);
}

async function listen() {
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
        console.log(">", `[${user}]`, message);
      }
    },
    error: console.error,
  });

  process.on("SIGINT", () => {
    console.log("\n[blivec] closing...");
    con.close();
  });
}

async function send_message(message: string) {
  const tmpdir = getTempDir("blivec");
  fs.mkdirSync(tmpdir, { recursive: true });
  const cookie_file = path.join(tmpdir, "cookie.txt");
  let cookie = "";
  try {
    cookie = fs.readFileSync(cookie_file, "utf8");
  } catch {}
  if (!cookie) {
    console.log("Not found cached cookie, please login on bilibili and");
    console.log("find `SESSDATA` and `bili_jct` from cookies.");
    console.log();
    console.log("The `SESSDATA` can only be found through cookies panel.");
    console.log();
    console.log("The `bili_jct` can be copied through this script:");
    console.log("cookieStore.get('bili_jct').then(e=>copy(e.value))");
    console.log();
    const SESSDATA = await input("Paste `SESSDATA` here: ");
    const bili_jct = await input("Paste `bili_jct` here: ");
    cookie = JSON.stringify({ SESSDATA, bili_jct });
    fs.writeFileSync(cookie_file, cookie);
  }
  try {
    const ret = await sendDanmaku(id, message, JSON.parse(cookie));
    const json = JSON.parse(ret);
    if (json.code != 0) {
      throw new Error(json.message);
    }
    console.log("Message sent.");
  } catch (err) {
    console.error(err);
    fs.rmSync(cookie_file, { maxRetries: 3, recursive: true });
    console.log("Deleted cookie. Please try again.");
  }
}

let main: Promise<unknown>;
if (message) {
  main = send_message(message);
} else {
  main = listen();
}
main.catch(console.error);
