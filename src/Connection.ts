import { type Socket, createConnection } from 'node:net'
import { Buffer } from 'node:buffer'
import { promisify } from 'node:util'
import { brotliDecompress, inflate } from 'node:zlib'

import { type DanmuInfo, type Me, type RoomInfo, getDanmuInfo, getMe, getRoomInfo } from './api.js'
import { read_cookie } from './config.js'

const inflateAsync = /* @__PURE__ */ promisify(inflate)
const brotliDecompressAsync = /* @__PURE__ */ promisify(brotliDecompress)

const EMPTY_BUFFER = /* @__PURE__ */ Buffer.alloc(0)

type TYPE = 'heartbeat' | 'message' | 'welcome' | 'unknown' | 'join'

const op_to_type: Record<number, TYPE> = {
  3: 'heartbeat',
  5: 'message',
  8: 'welcome',
}

const type_to_op: Record<string, number> = {
  heartbeat: 2,
  join: 7,
}

const HEARTBEAT_INTERVAL = 10e3
const CONNECT_TIMEOUT = 15e3

export type ConnectionInfo = Partial<Me> & RoomInfo & DanmuInfo

export interface Events {
  init: (info: ConnectionInfo, host_index: number) => void
  message: (data: any) => void
  error: (err: Error) => void
  quit: () => void
}

export function noop() {}

export class Connection {
  socket: Socket | null = null
  buffer = EMPTY_BUFFER
  info: ConnectionInfo | null = null
  cookie = read_cookie()

  timer_reconnect = setTimeout(noop)
  timer_heartbeat = setTimeout(noop)

  _closed = false
  _connect_index = 0

  events: Events

  constructor(
    readonly roomId: number,
    events_: Partial<Events> = {},
  ) {
    this.events = { init: noop, message: noop, error: noop, quit: noop, ...events_ }
    this.reconnect()
  }

  async connect() {
    const { uname, mid }: Partial<Me> = this.cookie ? await getMe(this.cookie) : {}

    const { room_id, title, ...rest } = await getRoomInfo(this.roomId)
    const { host_list, token } = await getDanmuInfo(room_id, this.cookie)
    this.info = { room_id, title, token, host_list, ...rest, uname, mid }
    this.events.init(this.info, this._connect_index)

    const { host, port } = host_list[this._connect_index]
    this._connect_index = (this._connect_index + 1) % host_list.length

    return createConnection(port, host)
  }

  async reconnect() {
    clearTimeout(this.timer_reconnect)
    this.buffer = EMPTY_BUFFER

    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }

    const socket = await this.connect().catch(() => null)
    if (socket === null) {
      this._on_close()
      return
    }
    this.socket = socket
    this.timer_reconnect = setTimeout(this.reconnect.bind(this), CONNECT_TIMEOUT)

    socket.on('ready', this._on_ready.bind(this))
    socket.on('close', this._on_close.bind(this))
    socket.on('error', this._on_error.bind(this))
    socket.on('data', this._on_data.bind(this))
  }

  get closed() {
    return this._closed
  }

  _on_ready() {
    clearTimeout(this.timer_reconnect)
    if (this.info) {
      const join = this._encode('join', {
        uid: this.info.mid || this.info.uid,
        roomid: this.info.room_id,
        key: this.info.token,
        protover: 3,
        platform: 'web',
        type: 2,
        buvid: this.cookie?.buvid3,
      })
      this.send(join)
    }
  }

  _on_close() {
    if (!this._closed)
      setTimeout(this.reconnect.bind(this), 100)
  }

  _on_error(err: Error) {
    this.events.error(err)
    this.socket = null
  }

  _on_data(buffer: Buffer) {
    let need_realloc = false
    this.buffer = Buffer.concat([this.buffer, buffer])

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length > this.buffer.length)
        break

      const data = this.buffer.subarray(0, length)
      this.buffer = this.buffer.subarray(length)
      need_realloc = true

      this._decode(data).then(this._on_decoded.bind(this))
    }

    if (need_realloc)
      this.buffer = Buffer.from(this.buffer)
  }

  async _decode(buffer: Buffer) {
    const tasks: Promise<{ protocol: number, type: TYPE, data: any }>[] = []
    for (let i = 0, size: number; i < buffer.length; i += size) {
      size = buffer.readUInt32BE(i)
      tasks.push(this._decode2(buffer.subarray(i, i + size)))
    }
    const rs = await Promise.all(tasks)
    return rs.flatMap(r => (r.protocol === 2 || r.protocol === 3 ? r.data : r))
  }

  async _decode2(buffer: Buffer) {
    const protocol = buffer.readInt16BE(6)
    const op = buffer.readInt32BE(8)
    const body = buffer.subarray(16)

    const type = op_to_type[op] || 'unknown'

    let data: any
    if (protocol === 0)
      data = JSON.parse(body.toString('utf8'))

    else if (protocol === 1 && body.length === 4)
      data = body.readUint32BE(0)

    else if (protocol === 2)
      data = await this._decode(await inflateAsync(body))

    else if (protocol === 3)
      data = await this._decode(await brotliDecompressAsync(body))

    return { protocol, type, data }
  }

  _on_decoded(rs: { type: TYPE, data: any }[]) {
    if (this._closed)
      return
    for (const { type, data } of rs) {
      if (type === 'welcome') {
        this.heartbeat()
      }
      else if (type === 'heartbeat') {
        clearTimeout(this.timer_heartbeat)
        this.timer_heartbeat = setTimeout(this.heartbeat.bind(this), HEARTBEAT_INTERVAL)
      }
      else if (type === 'message') {
        this.events.message(data)
      }
    }
  }

  _encode(type: TYPE, body: any = '') {
    if (typeof body !== 'string')
      body = JSON.stringify(body)

    const head = Buffer.allocUnsafe(16)
    const buffer = Buffer.from(body)

    head.writeInt32BE(head.length + buffer.length, 0)
    head.writeInt32BE(0x10_0001, 4)
    head.writeInt32BE(type_to_op[type] || 0, 8)
    head.writeInt32BE(1, 12)

    return Buffer.concat([head, buffer])
  }

  send(data: Buffer) {
    if (this.socket)
      this.socket.write(data)
  }

  close() {
    this._closed = true
    clearTimeout(this.timer_heartbeat)
    clearTimeout(this.timer_reconnect)
    this.events.quit()
    if (this.socket) {
      this.socket.end()
      this.socket = null
    }
  }

  heartbeat() {
    this.send(this._encode('heartbeat'))
    clearTimeout(this.timer_reconnect)
    this.timer_reconnect = setTimeout(this._on_close.bind(this), CONNECT_TIMEOUT)
  }
}
