/**
 * ══════════════════════════════════════════════════════════════════
 *  Dev-Shim für die Serverless-Functions unter api/
 *
 *  In Produktion führt Vercel jede Datei in api/ als eigene Function aus.
 *  Der lokale Dev-Server ist aber reines Vite und kennt /api/* nicht —
 *  jeder Aufruf endete dort mit HTTP 404 (z.B. /api/livekit-token, ohne
 *  das kein Sprach-Talk beigetreten werden kann).
 *
 *  Dieses Plugin klinkt sich nur im Dev-Server (`apply: 'serve'`) ein,
 *  lädt den passenden Handler über ssrLoadModule (inkl. HMR: eine
 *  Änderung an api/*.js wirkt beim nächsten Request) und übersetzt
 *  Node-req/res in die Vercel-Signatur (req.body/req.query,
 *  res.status().json()). Der Build bleibt unverändert.
 * ══════════════════════════════════════════════════════════════════
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { loadEnv } from 'vite'

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

/** Request-Body einlesen; JSON wird geparst, wie es die Handler erwarten. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('error', reject)
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(undefined)
      if ((req.headers['content-type'] || '').includes('application/json')) {
        try { return resolve(JSON.parse(raw)) } catch { return resolve(undefined) }
      }
      resolve(raw)
    })
  })
}

/** Node-Response um die Express-/Vercel-Helfer ergänzen, die die Handler nutzen. */
function decorate(res) {
  res.status = code => { res.statusCode = code; return res }
  res.json = obj => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
    return res
  }
  res.send = body => {
    if (typeof body === 'object' && body !== null) return res.json(body)
    res.end(body == null ? '' : String(body))
    return res
  }
  return res
}

export default function devApi() {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root

      // Vite legt nur VITE_*-Variablen in import.meta.env ab. Die Handler laufen
      // serverseitig und lesen process.env (LIVEKIT_API_SECRET, OPENAI_KEY, …),
      // also alles aus den .env-Dateien nachziehen — echte Shell-Variablen
      // behalten dabei Vorrang.
      const env = loadEnv(server.config.mode, root, '')
      for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v
      }

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        const name = url.pathname.slice('/api/'.length)
        // Kein Verzeichnis-Traversal, keine Interna (_shared.js ist kein Endpoint).
        if (!/^[a-z0-9-]+$/i.test(name)) return next()
        const file = join(root, 'api', `${name}.js`)
        if (!existsSync(file)) return next()

        // checkOriginAndRate() verlangt eine ALLOWED_ORIGINS-Allowlist und
        // antwortet sonst mit 403. Lokal steht dort nichts, deshalb den
        // Dev-Origin ergänzen — nur hier im Dev-Server, nie im Build.
        const origin = req.headers.origin || ''
        if (LOCAL_ORIGIN.test(origin)) {
          const allowed = (process.env.ALLOWED_ORIGINS || '')
            .split(',').map(s => s.trim()).filter(Boolean)
          if (!allowed.includes(origin)) {
            process.env.ALLOWED_ORIGINS = [...allowed, origin].join(',')
          }
        }

        try {
          const mod = await server.ssrLoadModule(`/api/${name}.js`)
          req.body = await readBody(req)
          req.query = Object.fromEntries(url.searchParams)
          await mod.default(req, decorate(res))
        } catch (err) {
          server.config.logger.error(`[dev-api] ${name}: ${err?.stack || err}`)
          if (!res.writableEnded) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: String(err?.message || err) }))
          }
        }
      })
    },
  }
}
