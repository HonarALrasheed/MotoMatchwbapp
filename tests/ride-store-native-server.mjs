import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Ausschliesslich die isolierte Testseite und die zwei Standalone-Module ausliefern.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = new Map([
  ['/tests/ride-store-native.html', 'tests/ride-store-native.html'],
  ['/tests/ride-store-native-frame.html', 'tests/ride-store-native-frame.html'],
  ['/src/js/ride-store.js', 'src/js/ride-store.js'],
  ['/src/js/ride-store-migration.js', 'src/js/ride-store-migration.js'],
])
const server = http.createServer(async (request, response) => {
  const file = files.get(new URL(request.url, 'http://127.0.0.1').pathname)
  if (!file) { response.writeHead(404); response.end(); return }
  try {
    const body = await readFile(path.join(root, file))
    response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store' })
    response.end(body)
  } catch { response.writeHead(500); response.end() }
})
server.listen(5174, '127.0.0.1', () => {
  process.stdout.write('http://127.0.0.1:5174/tests/ride-store-native.html\n')
})
