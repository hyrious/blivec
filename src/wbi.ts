import crypto from 'node:crypto'

export const WTS = 'wts'
export const W_RID = 'w_rid'

const KEY_MAP = /* #__PURE__ */ Uint8Array.from([46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52])

const decoder = /* #__PURE__ */ new TextDecoder()

export class Wbi {
  key: string | null = null

  updateKey(img: string, sub: string) {
    const length = 32
    const full = img + sub
    const key = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
      key[i] = full.charCodeAt(KEY_MAP[i])
    }
    this.key = decoder.decode(key)
    return this
  }

  sign(query: URLSearchParams, ts = Date.now() / 1000 | 0): [ts: string, sign: string] {
    if (!this.key)
      throw new Error('key not set')

    const tsStr = ts.toString()

    const q = [...query].map(([key, value]) => [key, value.replace(/[!'()*]/g, '')])
    q.push([WTS, tsStr])
    q.sort((a, b) => a[0].localeCompare(b[0]))

    const content = new URLSearchParams(q).toString()
    const hash = crypto.createHash('md5').update(content + this.key).digest('hex')
    const sign = hash.replace(/-/g, '').toLowerCase()

    return [tsStr, sign]
  }
}
