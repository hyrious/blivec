import https from "https";
import { IncomingMessage, RequestOptions } from "http";
import { createConnection, Socket } from "net";
import { promisify } from "util";
import { brotliDecompress, inflate } from "zlib";

const noop = () => {};

const text =
  (resolve: (value: string) => void) => async (res: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of res) chunks.push(chunk);
    resolve(Buffer.concat(chunks).toString("utf8"));
  };

const get = (url: string) =>
  new Promise<string>((resolve, reject) =>
    https.get(url, text(resolve)).on("error", reject)
  );

const inflateAsync = /* @__PURE__ */ promisify(inflate);
const brotliDecompressAsync = /* @__PURE__ */ promisify(brotliDecompress);

const EMPTY_BUFFER = /* @__PURE__ */ Buffer.alloc(0);

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
  room_id: number;
  title: string;
  /** 0: offline, 1: online, 2: playing_uploaded_videos */
  live_status: 0 | 1 | 2;
  /** start_time = new Date(live_start_time * 1000) */
  live_start_time: number;
}

export async function getRoomInfo(id: number) {
  const info = await get(`${api_index}/getInfoByRoom?room_id=${id}`);
  const { code, message, data } = JSON.parse(info);
  if (code != 0) throw new Error(message);
  return (data as { room_info: RoomInfo }).room_info;
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

export type ConnectionInfo = RoomInfo & DanmuInfo;
export interface Events {
  init?: (info: ConnectionInfo) => void;
  message?: (data: any) => void;
  error?: (err: Error) => void;
  quit?: () => void;
  pause?: () => void;
  resume?: () => void;
}

export class Connection {
  socket: Socket | null = null;
  buffer = EMPTY_BUFFER;
  info: ConnectionInfo | null = null;

  timer_reconnect = /* @__PURE__ */ setTimeout(noop);
  timer_heartbeat = /* @__PURE__ */ setTimeout(noop);

  constructor(readonly roomId: number, readonly events: Events = {}) {
    this.reconnect();
  }

  _temp: any[] | null = null;
  pause() {
    this._temp || (this._temp = []);
    (this.events.pause || noop)();
  }
  resume() {
    (this.events.resume || noop)();
    const temp = this._temp;
    if (temp) {
      this._temp = null;
      for (const data of temp) {
        (this.events.message || noop)(data);
      }
    }
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

    const socket = await this.connect().catch(() => null);
    if (socket === null) {
      this._on_close();
      return;
    }
    this.socket = socket;
    this.timer_reconnect = setTimeout(this.reconnect.bind(this), 45e3);

    socket.on("ready", this._on_ready.bind(this));
    socket.on("close", this._on_close.bind(this));
    socket.on("error", this._on_error.bind(this));
    socket.on("data", this._on_data.bind(this));
  }

  get closed() {
    return this._closed;
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

  _on_error(err: Error) {
    (this.events.error || noop)(err);
    this.socket = null;
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
    if (this._closed) return;
    for (const { type, data } of rs) {
      if (type === "welcome") {
        this.heartbeat();
      } else if (type === "heartbeat") {
        clearTimeout(this.timer_heartbeat);
        this.timer_heartbeat = setTimeout(this.heartbeat.bind(this), 30e3);
      } else if (type === "message") {
        if (this._temp) {
          this._temp.push(data);
        } else {
          (this.events.message || noop)(data);
        }
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
    return rs.flatMap((r) =>
      r.protocol === 2 || r.protocol === 3 ? r.data : r
    );
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
    (this.events.quit || noop)();
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }

  heartbeat() {
    this.send(this._encode("heartbeat"));
  }
}

const post = (url: string, body: string, params: RequestOptions) =>
  new Promise<string>((resolve, reject) => {
    const options = { method: "POST", timeout: 1000, ...params };
    https.request(url, options, text(resolve)).end(body).on("error", reject);
  });

export interface Env {
  SESSDATA: string;
  bili_jct: string;
}

export function sendDanmaku(id: number, message: string, env: Env) {
  const { SESSDATA, bili_jct } = env;
  const t = Math.floor(Date.now() / 1000);
  const headers = {
    "Cookie": `SESSDATA=${SESSDATA}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  const body =
    `color=16777215&fontsize=25&mode=1` +
    `&msg=${encodeURIComponent(message)}` +
    `&rnd=${t}&roomid=${id}&csrf=${bili_jct}&csrf_token=${bili_jct}`;
  return post("https://api.live.bilibili.com/msg/send", body, { headers });
}

interface PlayUrlInfo {
  playurl_info: {
    playurl: {
      // quality number desc: [{ qn: 150, desc: '高清' }]
      g_qn_desc: Array<{ qn: number; desc: string }>;
      stream: Array<{
        protocol_name: string;
        format: Array<{
          format_name: string;
          codec: Array<{
            codec_name: string;
            current_qn: number;
            accept_qn: number[];
            // full url = host + base_url + extra
            base_url: string;
            url_info: Array<{
              host: string;
              extra: string;
            }>;
          }>;
        }>;
      }>;
    };
  };
}

interface PlayInfo {
  container: string;
  url: string;
  qn: number;
  desc: string;
}

export async function getRoomPlayInfo(id: number) {
  let code: string | number, message: string, data: any;

  const room_v1 = "https://api.live.bilibili.com/room/v1/room";
  const room_init = `${room_v1}/room_init`;
  ({ code, message, data } = JSON.parse(await get(`${room_init}?id=${id}`)));
  if (code != 0) throw new Error(message);

  const { uid, room_id, live_status, is_locked, encrypted } = data;
  if (is_locked) throw new Error("room is locked");
  if (encrypted) throw new Error("room is encrypted");
  if (live_status !== 1) throw new Error("room is offline");

  const status = `${room_v1}/get_status_info_by_uids`;
  ({ code, message, data } = JSON.parse(await get(`${status}?uids[]=${uid}`)));
  if (code != 0) throw new Error(message);
  const title = data[uid].title + " - " + data[uid].uname;

  const api_index_v2 = "https://api.live.bilibili.com/xlive/web-room/v2/index";

  const streams: Record<string, PlayInfo> = {};
  const queue_of_qn = [1];
  const visited = new Set<number>();
  while (queue_of_qn.length > 0) {
    const qn = queue_of_qn.shift()!;
    if (visited.has(qn)) continue;
    visited.add(qn);

    const url =
      `${api_index_v2}/getRoomPlayInfo?room_id=${room_id}&qn=${qn}` +
      `&platform=web&protocol=0,1&format=0,1,2&codec=0,1&ptype=8&dolby=5`;
    ({ code, message, data } = JSON.parse(await get(url)));
    if (code != 0) throw new Error(message);

    const { g_qn_desc, stream } = (data as PlayUrlInfo).playurl_info.playurl;
    const qn_desc = Object.fromEntries(g_qn_desc.map((e) => [e.qn, e.desc]));

    let desc: string, container: string;
    for (const { protocol_name, format } of stream) {
      for (const { format_name, codec } of format) {
        for (const e of codec) {
          queue_of_qn.push(...e.accept_qn);
          desc = qn_desc[e.current_qn];
          if (protocol_name.includes("http_hls")) {
            container = "m3u8";
            desc += "-hls";
          } else {
            container = format_name;
          }
          if (e.codec_name === "hevc") {
            desc += "-h265";
          }
          const { host, extra } = sample(e.url_info);
          streams[desc] = {
            container,
            url: host + e.base_url + extra,
            qn,
            desc: qn_desc[e.current_qn],
          };
        }
      }
    }
  }

  function sample<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  return { title, streams };
}

export function testUrl(url: string, headers: string[] = []) {
  if (!url) return false;
  const options: https.RequestOptions = {};
  options.headers = Object.fromEntries(headers.map((e) => e.split(": ")));
  return new Promise<boolean>((resolve) => {
    https
      .get(url, options, (res) => {
        resolve(res.statusCode === 200 ? true : false);
        res.destroy();
      })
      .once("error", () => resolve(false));
  });
}
