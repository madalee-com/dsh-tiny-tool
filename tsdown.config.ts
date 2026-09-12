import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    client: 'src/client/index.tsx',
  },
  outDir: 'lib',
  format: ['cjs'],
  target: 'es2022',
  treeshake: true,
  sourcemap: true,
  dts: false,
  // Prevent ESM wrapper at the end
  banner: { js: '' },
  footer: { js: '' },
})
