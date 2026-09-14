import antfu from '@antfu/eslint-config'

export default antfu({
  jsdoc: false,
  ignores: ['lib', 'cli.js'],
}, {
  rules: {
    'jsdoc/no-unnecessary-type-assertion': 'off',
    'pnpm/yaml-enforce-settings': 'off',
  },
})
