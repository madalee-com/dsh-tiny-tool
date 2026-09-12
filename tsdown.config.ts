import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    client: 'src/client/index.tsx',
  },
  outDir: 'lib',
  format: ['esm'],
  target: 'es2022',
  treeshake: true,
  sourcemap: true,
  dts: false,
  // Force .js extension
  outExtension: () => '.js',
})
