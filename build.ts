/* eslint-disable antfu/no-top-level-await */
import { exit } from 'node:process'
import { external } from '@hyrious/esbuild-plugin-external'
import { build } from 'esbuild'

await build({
  entryPoints: ['cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.',
  banner: { js: '#!/usr/bin/env node' },
  plugins: [external({
    auto: [{
      filter: /\.js$/,
      replace: p => p.replace('./src/', './lib/'),
    }],
  })],
}).catch(() => exit(1))
