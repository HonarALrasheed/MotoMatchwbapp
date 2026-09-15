/**
 * MotoMatch — DRACO-Decoder aus dem npm-Paket ausliefern
 *
 * Vorher stand in bike-detail.js, garage.js und quiz.js dreimal
 * setDecoderPath('https://www.gstatic.com/draco/...'). Damit ging bei jedem
 * Aufruf der 3D-Ansicht ein Request an Google — mit IP, User-Agent und
 * Referrer des Besuchers, ohne Einwilligung. Der Decoder liegt aber ohnehin
 * im three-Paket; er muss nur ins Ausgabeverzeichnis.
 *
 * Kopiert wird in `public/draco/`, nicht direkt nach `dist/`: so liefert der
 * Dev-Server dieselben Dateien wie der Build, ohne Sonderweg. Das Verzeichnis
 * ist erzeugt und steht deshalb in .gitignore.
 *
 * Aus dem Unterordner `gltf/` — die fuer glTF gebaute Variante ist die
 * richtige (alle Modelle sind GLB) und dazu die kleinere: 245 KB statt 336 KB.
 * draco_decoder.js kommt mit, weil DRACOLoader darauf zurueckfaellt, wenn ein
 * Browser kein WebAssembly kann; geladen wird es nur dann.
 */
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, 'node_modules/three/examples/jsm/libs/draco/gltf')
const DST = join(HERE, 'public/draco')
const FILES = ['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js']

export default function draco() {
  return {
    name: 'motomatch-draco',
    buildStart() {
      if (!existsSync(SRC)) {
        this.error(
          `DRACO-Decoder nicht gefunden: ${SRC}\n` +
          `Fehlt three im node_modules? "npm install" ausfuehren.`
        )
      }
      mkdirSync(DST, { recursive: true })
      for (const f of FILES) {
        const from = join(SRC, f), to = join(DST, f)
        // Nur kopieren, wenn nicht schon aktuell — sonst laeuft das bei jedem
        // Neustart des Dev-Servers unnoetig.
        if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue
        copyFileSync(from, to)
      }
    },
  }
}
