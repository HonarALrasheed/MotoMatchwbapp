import { defineConfig } from 'vite'
import devApi from './vite-plugin-dev-api.js'
import draco from './vite-plugin-draco.js'

const KACHEL_PROXY = {
  target: 'https://tiles.openfreemap.org',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/kacheln/, ''),
}
// Wetter entlang der Strecke (DWD über Bright Sky) — wie der Rewrite in vercel.json
const WETTER_PROXY = {
  target: 'https://api.brightsky.dev',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/wetter/, ''),
}
// Satellitenbild für den Streckenflug (Sentinel-2 cloudless 2016, EOX, CC BY 4.0)
const SATELLIT_PROXY = {
  target: 'https://tiles.maps.eox.at',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/satellit/, '/wmts/1.0.0/s2cloudless_3857/default/g'),
}
// Höhendaten fürs Relief (Terrarium-Kacheln, AWS Open Data) — wie der Rewrite in vercel.json
const HOEHEN_PROXY = {
  target: 'https://s3.amazonaws.com',
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/hoehe/, '/elevation-tiles-prod/terrarium'),
}

export default defineConfig(() => ({
  base: '/',
  server: {
    port: parseInt(process.env.PORT || '5173', 10),
    strictPort: false,
    open: true,
    // Kartenkacheln über die eigene Adresse — wie der Rewrite in vercel.json
    proxy: { '/kacheln': KACHEL_PROXY, '/hoehe': HOEHEN_PROXY, '/wetter': WETTER_PROXY, '/satellit': SATELLIT_PROXY },
  },
  preview: {
    proxy: { '/kacheln': KACHEL_PROXY, '/hoehe': HOEHEN_PROXY, '/wetter': WETTER_PROXY, '/satellit': SATELLIT_PROXY },
  },
  build: {
    outDir: 'dist',
    // esbuild statt terser: terser zerstoert beim Minifizieren die
    // Export-Deklarationen von ATTACH_BUCKET / ATTACH_MAX / ATTACH_MAX_LOCAL
    // aus community-api.js — Nutzung und Export-Eintrag bleiben stehen, die
    // Deklaration faellt weg. Der Browser bricht das Modul-Linking dann mit
    // "Export 'ATTACH_MAX_LOCAL' is not defined in module" ab und die App
    // startet gar nicht. Mit esbuild ist der Build korrekt; er kostet rund
    // 2% Bundlegroesse (community-Chunk 673 -> 689 kB).
    minify: 'esbuild'
  },
  publicDir: 'public',
  plugins: [devApi(), draco()]
}))
