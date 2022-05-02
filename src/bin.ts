#!/usr/bin/env node
import { Connection } from "./index.js";

const [raw_id] = process.argv.slice(2);
const id = Number.parseInt(raw_id);
const safe = Number.isSafeInteger(id) && id > 0;

if (!safe) {
  console.log("Usage: bl <room_id>");
  process.exit(0);
}

const con = new Connection(id, {
  init({ title }) {
    console.log(`listening ${title}`);
  },
  message(data) {
    if (typeof data === "object" && data !== null && data.cmd === "DANMU_MSG") {
      const message = data.info[1];
      const user = data.info[2][1];
      console.log(">", `[${user}]`, message);
    }
  },
  error: console.error,
});

process.on("SIGINT", () => {
  console.log("closing...");
  con.close();
});
