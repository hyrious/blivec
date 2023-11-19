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
    = `bubble=0&color=16777215&fontsize=25&mode=1`
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

const valid_url = /https?:\/\/(?:(?:www|bangumi)\.)?bilibili\.(?:tv|com)\/(?:(?:video\/[aA][vV]|anime\/(?<anime_id>\d+)\/play\#)(?<id_bv>\d+)|video\/[bB][vV](?<id>[^/?#&]+))/
const pagelist = 'https://api.bilibili.com/x/player/pagelist'
const playurl = 'https://api.bilibili.com/x/player/playurl'

/** `qn=64` = request 720p video */
export const QN = {
  /** need MP4 + platform=html5, see {@link FNVAL} */
  '240p': 6,
  '360p': 16,
  '480p': 32,
  /** default */
  '720p': 64,
  '720p60': 74,
  '1080p': 80,
  /** need svip */
  '1080p+': 112,
  /** need svip */
  '1080p60': 116,
  /** need svip and fnval=128 and fourk=1 */
  '4K': 120,
  /** need svip, only DASH and fnval=64 */
  'HDR': 125,
  /** need svip, only DASH and fnval=512 */
  'Dolby': 126,
  /** need svip, only DASH and fnval=1024 */
  '8K': 127,
} as const

/** `fnval=80` = 16|64 = DASH + HDR */
export const FNVAL = {
  /** @deprecated */
  flv: 0,
  mp4: 1,
  dash: 16,
  /** need `qn=125` */
  hdr: 64,
  /** need `qn=120` */
  fourk: 128,
  /** need DASH */
  dolby_audio: 256,
  /** need DASH */
  dolby_video: 512,
  eightk: 1024,
  av1: 2048,
} as const

export const CODEC = {
  avc: 7,
  hevc: 12,
  av1: 13,
} as const

export const FLAC = {
  '64K': 30216,
  '132K': 30232,
  '192K': 30280,
  'Dolby': 30250,
  'Hi-Res': 30251,
}

export type PageList = {
  cid: number
  page: number
  part: string
  duration: number
  dimension: {
    width: number
    height: number
    rotate: number
  }
}[]

export type VideosInfo = {
  title: string
  /** seconds */
  duration: number
  cid: number
  size: {
    width: number
    height: number
  }
  get(): Promise<PlayVideoInfo>
}[]

export interface ExtractVideoOptions {
  /** Default `"480p"` */
  quality?: Extract<keyof typeof QN, string>
  /** Default `["mp4"]` */
  format?: Extract<keyof typeof FNVAL, string>[]
  fourk?: boolean
  cookie?: Cookie
}

/**
 * @param url "https://www.bilibili.com/video/BVxxxxxxxx"
 */
export async function extractVideos(url: string, options: ExtractVideoOptions = {}): Promise<VideosInfo | null> {
  const match = url.match(valid_url)
  if (match == null)
    return null

  const aid = match.groups!.id_bv
  const bvid = match.groups!.id
  if (aid == null && bvid == null)
    return null

  const headers: OutgoingHttpHeaders = {
    'User-Agent': User_Agent,
    'Referer': Referer_Home,
  }
  const res = await get(`${pagelist}?${aid ? `aid=${aid}` : `bvid=${bvid}`}`, { headers })

  const fnval = (options.format || ['mp4']).reduce((sum, e) => sum | FNVAL[e], 0)

  let prefix = `${playurl}?fnval=${fnval}&fnver=0`
  prefix += aid ? `&avid=${aid}` : `&bvid=${bvid}`
  prefix += `&fourk=${options.fourk ? 1 : 0}`
  prefix += `&qn=${QN[options.quality || '480p']}`

  const videos = json<PageList>(res).map(p => ({
    title: p.part,
    duration: p.duration,
    cid: p.cid,
    size: p.dimension,
    get: () => playVideo(`${prefix}&cid=${p.cid}`, options.cookie),
  }))

  return videos
}

export interface PlayVideoInfo {
  quality: typeof QN[keyof typeof QN]
  format: string
  timelength: number
  /** split by `,` */
  accept_format: string
  accept_description: string[]
  accept_quality: number[]
  video_codecid: typeof CODEC[keyof typeof CODEC]
  /** only when NOT DASH */
  durl: {
    order: number
    length: number
    size: number
    url: string
    backup_url: string[]
  }[]
  /** TODO: */
  dash?: any
  support_formats: {
    quality: typeof QN[keyof typeof QN]
    format: string
    new_description: string
    display_desc: string
    superscript: string
    codecs: string[] | null
  }[]
  last_play_time: number
  last_play_cid: number
}

/**
 * The `url` comes from {@link extractVideos}().
 */
export async function playVideo(url: string, { SESSDATA, bili_jct }: Partial<Cookie> = {}): Promise<PlayVideoInfo> {
  const headers: OutgoingHttpHeaders = {
    'User-Agent': User_Agent,
    'Referer': Referer_Home,
    'Cookie': `SESSDATA=${SESSDATA}; bili_jct=${bili_jct}`,
  }
  const res = await get(url, { headers })
  return json<PlayVideoInfo>(res)
}
