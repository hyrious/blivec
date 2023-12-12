import { exit } from 'node:process'
import { build } from 'esbuild'

await build({
  entryPoints: ['cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: '.',
  banner: { js: '#!/usr/bin/env node' },
  plugins: [{
    name: 'external-src',
    setup({ onResolve }) {
      onResolve({ filter: /^\.\/src/ }, (args) => {
        let path = args.path.replace('./src', './lib')
        path.endsWith('.js') || (path += '.js')
        return { path, external: true, sideEffects: false }
      })
    },
  }],
}).catch(() => exit(1))
