import type { IncomingMessage, RequestOptions } from 'node:http'

import { Buffer } from 'node:buffer'
import https from 'node:https'

function text(resolve: (value: string) => void) {
  return async (res: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of res) chunks.push(chunk)
    resolve(Buffer.concat(chunks).toString('utf8'))
  }
}

export function get(url: string, options: RequestOptions = {}) {
  return new Promise<string>((resolve, reject) => {
    https.get(url, options, text(resolve)).on('error', reject)
  })
}

export function post(url: string, body: string, options: RequestOptions) {
  return new Promise<string>((resolve, reject) => {
    options = { method: 'POST', timeout: 1000, ...options }
    https.request(url, options, text(resolve)).end(body).on('error', reject)
  })
}

export function json<T = any>(res: string): T {
  const { code, message, data } = JSON.parse(res) as {
    code: number | string
    message: string
    data: unknown
  }

  // "!= 0": the API could return both "0" and 0.
  // eslint-disable-next-line eqeqeq
  if (code != 0)
    throw new Error(message)

  return data as T
}
