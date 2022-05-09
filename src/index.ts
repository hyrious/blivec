import os from "os";
import path from "path";
import https from "https";
import { Socket, createConnection } from "net";
import { inflate, brotliDecompress } from "zlib";
import { promisify } from "util";

const inflateAsync = /** @__PURE__ */ promisify(inflate);
const brotliDecompressAsync = /** @__PURE__ */ promisify(brotliDecompress);

const EMPTY_BUFFER = /** @__PURE__ */ Buffer.alloc(0);

function noop(_arg0: any) {}

const get = (url: string) =>
  new Promise<string>((resolve, reject) =>
    https
      .get(url, res => {
        const chunks: Buffer[] = [];
        res.on("data", chunks.push.bind(chunks));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject)
  );

const post = (url: string, body: string, params: any) =>
  new Promise<string>((resolve, reject) =>
    https
      .request(url, { method: "POST", timeout: 1000, ...params }, res => {
        const chunks: Buffer[] = [];
        res.on("data", chunks.push.bind(chunks));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .end(body)
      .on("error", reject)
  );

export function getTempDir(name: string) {
  const tmpdir = os.tmpdir();
  const platform = process.platform;
  if (platform === "darwin" || platform === "win32") {
    return path.join(tmpdir, name);
  }
  const username = path.basename(os.homedir());
  return path.join(tmpdir, username, name);
}

export function sendDanmaku(
  id: number,
  message: string,
  { SESSDATA, bili_jct }: { SESSDATA: string; bili_jct: string }
) {
  const t = (Date.now() / 1000) | 0;
  const headers = {
    Cookie: `SESSDATA=${SESSDATA}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const body =
    `color=16777215&fontsize=25&mode=1` +
    `&msg=${encodeURIComponent(message)}` +
    `&rnd=${t}&roomid=${id}&csrf=${bili_jct}&csrf_token=${bili_jct}`;
  return post("https://api.live.bilibili.com/msg/send", body, { headers });
}

export function input(prompt: string) {
  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    stdin.setEncoding("utf8");
    stdin.on("data", data => {
      stdin.resume();
      resolve(String(data).trim());
    });
    stdin.on("error", reject);
    process.stdout.write(prompt);
  });
}

const api_index = "https://api.live.bilibili.com/xlive/web-room/v1/index";

export interface DanmuInfo {
  token: string;
  host_list: { host: string; port: number }[];
}

export async function getDanmuInfo(id: number) {
  const info = await get(`${api_index}/getDanmuInfo?id=${id}`);
  const { code, message, data } = JSON.parse(info);
  // "!= 0": the API could return both "0" and 0.
  if (code != 0) throw new Error(message);
  return data as DanmuInfo;
}

export interface RoomInfo {
  room_info: {
    room_id: number;
    title: string;
    /** 0: offline, 1: online, 2: playing_uploaded_videos */
    live_status: 0 | 1 | 2;
    /** start_time = new Date(live_start_time * 1000) */
    live_start_time: number;
  };
}

export async function getRoomInfo(id: number) {
  const info = await get(`${api_index}/getInfoByRoom?room_id=${id}`);
  const { code, message, data } = JSON.parse(info);
  if (code != 0) throw new Error(message);
  return (data as RoomInfo).room_info;
}

type TYPE = "heartbeat" | "message" | "welcome" | "unknown" | "join";
const OP_TYPE_MAP: Record<number, TYPE> = {
  3: "heartbeat",
  5: "message",
  8: "welcome",
};
const TYPE_OP_MAP: Record<string, number> = {
  heartbeat: 2,
  join: 7,
};

export type ConnectionInfo = RoomInfo["room_info"] & DanmuInfo;

export class Connection {
  socket: Socket | null = null;
  buffer = EMPTY_BUFFER;
  info: ConnectionInfo | null = null;

  timer_reconnect = /** @__PURE__ */ setTimeout(noop);
  timer_heartbeat = /** @__PURE__ */ setTimeout(noop);

  constructor(
    readonly roomId: number,
    readonly events: {
      init?: (info: ConnectionInfo) => void;
      message?: (data: any) => void;
      error?: (err: any) => void;
    } = {}
  ) {
    this.reconnect();
  }

  _closed = false;
  _connect_index = 0;
  async connect() {
    const { room_id, title, ...rest } = await getRoomInfo(this.roomId);
    const { host_list, token } = await getDanmuInfo(room_id);
    this.info = { room_id, title, token, host_list, ...rest };
    (this.events.init || noop)(this.info);

    const { host, port } = host_list[this._connect_index];
    this._connect_index = (this._connect_index + 1) % host_list.length;

    return createConnection(port, host);
  }

  async reconnect() {
    clearTimeout(this.timer_reconnect);
    this.buffer = EMPTY_BUFFER;

    const socket = await this.connect();
    this.socket = socket;
    this.timer_reconnect = setTimeout(this.reconnect.bind(this), 45e3);

    socket.on("ready", this._on_ready.bind(this));
    socket.on("close", this._on_close.bind(this));
    socket.on("error", this._on_error.bind(this));
    socket.on("data", this._on_data.bind(this));
  }

  _on_ready() {
    clearTimeout(this.timer_reconnect);
    if (this.info) {
      this.send(
        this._encode("join", {
          uid: 0,
          roomid: this.info.room_id,
          key: this.info.token,
          protover: 2,
          platform: "web",
          clientver: "2.0.11",
          type: 2,
        })
      );
    }
  }

  _on_close() {
    if (!this._closed) {
      setTimeout(this.reconnect.bind(this), 100);
    }
  }

  _on_error(err: any) {
    this.close();
    (this.events.error || noop)(err);
  }

  _on_data(buffer: Buffer) {
    let need_realloc = false;
    this.buffer = Buffer.concat([this.buffer, buffer]);

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length > this.buffer.length) break;

      const data = this.buffer.subarray(0, length);
      this.buffer = this.buffer.subarray(length);
      need_realloc = true;

      this._decode(data).then(this._on_decoded.bind(this));
    }

    if (need_realloc) {
      this.buffer = Buffer.from(this.buffer);
    }
  }

  _on_decoded(rs: { type: TYPE; data: any }[]) {
    for (const { type, data } of rs) {
      if (type === "welcome") {
        this.heartbeat();
      } else if (type === "heartbeat") {
        clearTimeout(this.timer_heartbeat);
        this.timer_heartbeat = setTimeout(this.heartbeat.bind(this), 30e3);
      } else if (type === "message") {
        (this.events.message || noop)(data);
      }
    }
  }

  async _decode(buffer: Buffer) {
    const tasks: Promise<{ protocol: number; type: TYPE; data: any }>[] = [];
    let size: number;
    for (let i = 0; i < buffer.length; i += size) {
      size = buffer.readUInt32BE(i);
      tasks.push(this._decode2(buffer.subarray(i, i + size)));
    }
    let rs = await Promise.all(tasks);
    return rs.flatMap(r => (r.protocol === 2 || r.protocol === 3 ? r.data : r));
  }

  async _decode2(buffer: Buffer) {
    const protocol = buffer.readInt16BE(6);
    const op = buffer.readInt32BE(8);
    const body = buffer.subarray(16);

    const type = OP_TYPE_MAP[op] || "unknown";

    let data: any;
    if (protocol === 0) {
      data = JSON.parse(body.toString("utf8"));
    } else if (protocol === 1 && body.length === 4) {
      data = body.readUint32BE(0);
    } else if (protocol === 2) {
      data = await this._decode(await inflateAsync(body));
    } else if (protocol === 3) {
      data = await this._decode(await brotliDecompressAsync(body));
    }

    return { protocol, type, data };
  }

  _encode(type: TYPE, body: any = "") {
    if (typeof body !== "string") {
      body = JSON.stringify(body);
    }

    const head = Buffer.allocUnsafe(16);
    const buffer = Buffer.from(body);

    head.writeInt32BE(head.length + buffer.length, 0);
    head.writeInt32BE(0x10_0001, 4);
    head.writeInt32BE(TYPE_OP_MAP[type] || 0, 8);
    head.writeInt32BE(1, 12);

    return Buffer.concat([head, buffer]);
  }

  send(data: Buffer) {
    if (this.socket) {
      this.socket.write(data);
    }
  }

  close() {
    this._closed = true;
    clearTimeout(this.timer_heartbeat);
    clearTimeout(this.timer_reconnect);
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }

  heartbeat() {
    this.send(this._encode("heartbeat"));
  }
}
