import { defineConfig } from 'vite'
import devApi from './vite-plugin-dev-api.js'

export default defineConfig(() => ({
  base: '/',
  server: {
    port: parseInt(process.env.PORT || '5173', 10),
    strictPort: false,
    open: true,
  },
  build: {
    outDir: 'dist',
    minify: 'terser'
  },
  publicDir: 'public',
  plugins: [devApi()]
}))
