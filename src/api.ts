import type { OutgoingHttpHeaders } from 'node:http'
import crypto from 'node:crypto'
import { get, json, post } from './utils.js'

const User_Agent = 'Mozilla/5.0 (X11; Linux x86_64; rv:60.1) Gecko/20100101 Firefox/60.1'
const Referer_Home = 'https://www.bilibili.com/'

const api_nav = 'https://api.bilibili.com/x/web-interface/nav'

export interface Cookie {
  SESSDATA: string
  bili_jct: string
  buvid3: string
}

export interface Me { uname: string; mid: number }

export async function getMe({ SESSDATA, bili_jct }: Cookie) {
  const headers: OutgoingHttpHeaders = {
    'User-Agent': User_Agent,
    'Referer': Referer_Home,
    'Cookie': `SESSDATA=${SESSDATA}; bili_jct=${bili_jct}`,
  }
  const res = await get(api_nav, { headers })
  return json<Me>(res)
}

const live_v1 = 'https://api.live.bilibili.com/xlive/web-room/v1/index'
const Referer_Live = 'https://live.bilibili.com'

export interface DanmuInfo {
  token: string
  host_list: { host: string; port: number }[]
}

export async function getDanmuInfo(id: number, { SESSDATA, bili_jct }: Partial<Cookie> = {}) {
  const headers = {
    'User-Agent': User_Agent,
    'Referer': `${Referer_Live}/${id}`,
    'Cookie': `SESSDATA=${SESSDATA}; bili_jct=${bili_jct}`,
  }
  const res = await get(`${live_v1}/getDanmuInfo?id=${id}`, { headers })
  return json<DanmuInfo>(res)
}

export interface RoomInfo {
  room_id: number
  title: string
  uid: number
  cover: string
  background: string
  description: string
  /** 0: offline, 1: online, 2: playing_uploaded_videos */
  live_status: 0 | 1 | 2
  /** start_time = new Date(live_start_time * 1000) */
  live_start_time: number
}

export async function getRoomInfo(id: number) {
  const res = await get(`${live_v1}/getInfoByRoom?room_id=${id}`)
  return json<{ room_info: RoomInfo }>(res).room_info
}

const live_send = 'https://api.live.bilibili.com/msg/send'

export function sendDanmaku(id: number, message: string, { SESSDATA, bili_jct }: Cookie) {
  const t = Math.floor(Date.now() / 1000)
  const headers = {
    'Cookie': `SESSDATA=${SESSDATA}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  const body
    = `color=16777215&fontsize=25&mode=1`
    + `&msg=${encodeURIComponent(message)}`
    + `&rnd=${t}&roomid=${id}&csrf=${bili_jct}&csrf_token=${bili_jct}`
  return post(live_send, body, { headers })
}

const live_feed = 'https://api.live.bilibili.com/relation/v1/feed'

export interface FeedListItem {
  cover: string
  face: string
  uname: string
  title: string
  roomid: string
  pic: string
  online: number
  link: string
  uid: number
  watched_show: {
    switch: boolean
    num: number
    text_small: string
    text_large: string
    icon: string
    icon_location: number
    icon_web: string
  }
}

export interface FeedListResult {
  results: number
  page: number
  pagesize: number
  list: Array<FeedListItem>
}

export async function getFeedList({ SESSDATA, bili_jct }: Cookie): Promise<FeedListItem[]> {
  const headers = {
    'User-Agent': User_Agent,
    'Referer': Referer_Home,
    'Cookie': `SESSDATA=${SESSDATA}; bili_jct=${bili_jct}`,
  }
  let items: FeedListItem[] = []
  for (let page = 1; page <= 10; ++page) {
    const url = `${live_feed}/feed_list?page=${page}`
    const res = await get(url, { headers })
    const { results, list } = json<FeedListResult>(res)
    items = items.concat(list)
    if (items.length >= results)
      break
  }
  return items
}

const room_v1 = 'https://api.live.bilibili.com/room/v1/room'
const live_v2 = 'https://api.live.bilibili.com/xlive/web-room/v2/index'

interface PlayUrlInfo {
  playurl_info: {
    playurl: {
      // quality number desc: [{ qn: 150, desc: '高清' }]
      g_qn_desc: Array<{ qn: number; desc: string }>
      stream: Array<{
        protocol_name: string
        format: Array<{
          format_name: string
          codec: Array<{
            codec_name: string
            current_qn: number
            accept_qn: number[]
            // full url = host + base_url + extra
            base_url: string
            url_info: Array<{
              host: string
              extra: string
            }>
          }>
        }>
      }>
    }
  }
}

export interface PlayInfo {
  container: string
  url: string
  qn: number
  desc: string
}

export async function getRoomPlayInfo(id: number) {
  const res = await get(`${room_v1}/room_init?id=${id}`)
  const { uid, room_id, live_status, is_locked, encrypted } = json(res)
  if (is_locked)
    throw new Error('room is locked')
  if (encrypted)
    throw new Error('room is encrypted')
  if (live_status !== 1)
    throw new Error('room is offline')

  const res2 = await get(`${room_v1}/get_status_info_by_uids?uids[]=${uid}`)
  const data = json(res2)
  const title = `${data[uid].title} - ${data[uid].uname}`

  const streams: Record<string, PlayInfo> = {}
  const queue_of_qn = [1]
  const visited = new Set<number>()
  while (queue_of_qn.length > 0) {
    const qn = queue_of_qn.shift()!
    if (visited.has(qn))
      continue
    visited.add(qn)

    const url
      = `${live_v2}/getRoomPlayInfo?room_id=${room_id}&qn=${qn}`
      + `&platform=web&protocol=0,1&format=0,1,2&codec=0,1&ptype=8&dolby=5`
    const res = await get(url)
    const { g_qn_desc, stream } = json<PlayUrlInfo>(res).playurl_info.playurl
    const qn_desc = Object.fromEntries(g_qn_desc.map(e => [e.qn, e.desc]))

    let desc: string, container: string
    for (const { protocol_name, format } of stream) {
      for (const { format_name, codec } of format) {
        for (const e of codec) {
          queue_of_qn.push(...e.accept_qn)
          desc = qn_desc[e.current_qn]
          if (protocol_name.includes('http_hls')) {
            container = 'm3u8'
            desc += '-hls'
          }
          else {
            container = format_name
          }
          if (e.codec_name === 'hevc')
            desc += '-h265'

          const { host, extra } = sample(e.url_info)
          streams[desc] = {
            container,
            url: host + e.base_url + extra,
            qn,
            desc: qn_desc[e.current_qn],
          }
        }
      }
    }
  }

  function sample<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)]
  }

  return { title, streams }
}

const search = 'https://api.bilibili.com/x/web-interface/search'
const Referer_Search = 'https://search.bilibili.com/live'

export type SerachResult = {
  roomid: number
  // player name
  uname: string
  // may include html tags
  title: string
  // start time
  live_time: string
  // screen shot
  cover: string
}[]

export async function searchRoom(keyword: string) {
  keyword = encodeURIComponent(keyword)
  const params = '&order=online&coverType=user_cover&page=1'
  const headers: OutgoingHttpHeaders = {
    'User-Agent': User_Agent,
    'Referer': `${Referer_Search}?keyword=${keyword}${params}&search_type=live`,
    'Cookie': `buvid3=${crypto.randomUUID()}infoc;`,
  }
  const url = `${search}/type?search_type=live_room&keyword=${keyword}${params}`
  const res = await get(url, { headers })
  return json<{ result: SerachResult }>(res).result
}

const live_history = 'https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory'

export type HistoryResult = {
  uid: number
  nickname: string
  text: string
  timeline: string // "YYYY-MM-DD HH:MM:SS"
}[]

export async function danmakuHistory(roomid: number) {
  const headers: OutgoingHttpHeaders = {
    'User-Agent': User_Agent,
    'Referer': `${Referer_Live}/${roomid}`,
  }
  const res = await get(`${live_history}?roomid=${roomid}&room_type=0`, { headers })
  return json<{ room: HistoryResult }>(res).room
}
