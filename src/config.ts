import type { Cookie } from './api.js'
import fs from 'node:fs'
import os from 'node:os'

import path from 'node:path'

const homedir = os.homedir()

function exists(path: string) {
  return fs.existsSync(path) && fs.statSync(path).isFile()
}

const cookie_paths = [
  'cookie.txt',
  path.join(homedir, 'cookie.txt'),
  path.join(homedir, '.config', 'cookie.txt'),
  path.join(homedir, '.config', 'blivec', 'cookie.txt'),
]

export function read_cookie(): Cookie | undefined {
  const p = cookie_paths.find(exists)
  if (p) {
    const cookie = fs.readFileSync(p, 'utf8')
    const result: Cookie = { SESSDATA: '', bili_jct: '', buvid3: '' }
    for (const line of cookie.split('\n')) {
      if (line.startsWith('SESSDATA='))
        result.SESSDATA = line.slice(9).trimEnd()
      if (line.startsWith('bili_jct='))
        result.bili_jct = line.slice(9).trimEnd()
      if (line.startsWith('buvid3='))
        result.buvid3 = line.slice(7).trimEnd()
    }
    if (result.SESSDATA && result.bili_jct && result.buvid3)
      return result
  }
}

const config_paths = [
  'blivec.json',
  path.join(homedir, 'blivec.json'),
  path.join(homedir, '.config', 'blivec.json'),
]

interface Config { d?: string[], dd?: string[], play?: string[] }

export function read_config(): Config | undefined {
  const p = config_paths.find(exists)
  if (p) {
    const config = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (typeof config === 'object' && config !== null)
      return config
  }
}
