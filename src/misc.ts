import type { OutgoingHttpHeaders } from 'node:http'
import { Buffer } from 'node:buffer'
import https from 'node:https'

export function testUrl(url: string, headers: OutgoingHttpHeaders = {}) {
  if (!url)
    return false

  return new Promise<boolean>((resolve) => {
    https
      .get(url, { headers }, (res) => {
        resolve(res.statusCode === 200)
        res.destroy()
      })
      .once('error', () => resolve(false))
  })
}

export function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, '')
}

function protobuf(buffer: Buffer) {
  let pos = 0

  function varint() {
    let shift: number, byte: number, result: number
    shift = result = 0
    do {
      byte = buffer[pos++]
      result += (byte & 0x7F) << shift
      shift += 7
    } while (byte & 0x80)
    return result
  }

  function str(len: number) {
    const result = buffer.subarray(pos, pos + len)
    pos += len
    return result
  }

  const result: [number, any][] = []
  while (pos < buffer.byteLength) {
    const raw = varint()
    const type = raw & 0b111
    const index = raw >> 3

    let value: any

    switch (type) {
      case 0: value = varint()
        break
      case 1: value = str(8)
        break
      case 2: value = str(varint())
        break
      case 5: value = str(4)
        break
      default:
        throw new Error(`Unknown type ${type}`)
    }

    result.push([index, value])
  }

  return result
}

/**
 * If you got `{ "cmd": "DANMU_MSG", "dm_v2": "base64" }`,
 * you can decode "base64" with this function.
 */
export function dm_v2_face(base64: string) {
  const buffer = Buffer.from(base64, 'base64')
  // This buffer is a protobuf message with the structure:
  // { [20]: { [4]: "face-url" } }
  // So here we go

  const user = protobuf(buffer).find(e => e[0] === 20)
  if (user) {
    const face = protobuf(user[1]).find(e => e[0] === 4)
    if (face)
      return face[1].toString() as string
  }

  return null
}
