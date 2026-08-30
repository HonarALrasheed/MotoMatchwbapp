/**
 * ══════════════════════════════════════════════════════════════════
 *  Gemeinsame Schutzschicht für die Serverless-Functions unter api/
 *
 *  Reihenfolge in jedem geschützten Endpoint:
 *    1. checkOriginAndRate()  — Versehens-Bremse, KEIN Schutz (s. u.)
 *    2. Methodenprüfung
 *    3. requireUser()         — der eigentliche Riegel: gültige Session
 *    4. checkDailyLimit()     — persistente Kostenbremse pro Nutzer
 *    5. Eingabevalidierung    — vor jeder Interpolation in Prompt/Query
 * ══════════════════════════════════════════════════════════════════
 */
import * as Sentry from "@sentry/node";
import { createClient } from "@supabase/supabase-js";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const hits = new Map();

if (process.env.SENTRY_DSN && !Sentry.getClient()) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0, sendDefaultPii: false });
}

/** Fehlerdetail an Sentry, nie an den Client. */
export function report(err, extra) {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, { extra });
  }
}

/**
 * Einheitliches Fehlerformat: { error: { code, message } }.
 * `code` ist für den Client zum Verzweigen da (stabil), `message` für Menschen.
 * Niemals Upstream-Text (OpenAI/Tavily/Supabase) durchreichen — der landet
 * über report() in Sentry, nicht in der Antwort.
 */
export function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.length > 0) {
    return real.trim();
  }
  return "unknown";
}

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Origin-Allowlist + Burst-Bremse pro Instanz.
 *
 * ACHTUNG — das ist KEIN Zugriffsschutz:
 * `Origin` ist eine Browser-Konvention. Der Browser setzt den Header selbst und
 * lässt ihn nicht überschreiben; jeder andere HTTP-Client (curl, ein Skript, ein
 * anderer Server) setzt ihn frei auf jeden beliebigen Wert. Wer den erlaubten
 * Wert kennt — er steht in jeder Netzwerkanfrage der öffentlichen Seite — kommt
 * durch. Nachweisbar mit einer Zeile:
 *     curl -X POST .../api/ai-match -H 'Origin: <erlaubt>' -d '{...}'
 * Die Prüfung bleibt trotzdem: sie fängt fremde Webseiten ab, die den Endpoint
 * aus dem Browser heraus mitbenutzen wollen, und hält Versehen (falsche
 * Preview-URL, vergessene Env-Var) früh auf. Der echte Riegel vor den
 * kostenpflichtigen Upstream-APIs ist requireUser() + checkDailyLimit().
 *
 * Ebenso ist das Rate-Limit hier nur eine Burst-Bremse: `hits` ist eine Map im
 * Modul-Scope, und auf Vercel hat jede Lambda-Instanz ihren eigenen Speicher.
 * Instanzen skalieren hoch und starten kalt — 10/Minute gilt damit pro Instanz,
 * nicht pro IP. Die belastbare Grenze ist checkDailyLimit() in der Datenbank.
 *
 * @returns {boolean} true = bereits geantwortet, Handler muss sofort return'en.
 */
export function checkOriginAndRate(req, res) {
  const allowed = getAllowedOrigins();
  const origin = req.headers.origin || "";
  if (allowed.length === 0 || !allowed.includes(origin)) {
    sendError(res, 403, "forbidden_origin", "Zugriff von dieser Herkunft nicht erlaubt.");
    return true;
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now >= entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  } else {
    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      sendError(res, 429, "rate_limited", "Zu viele Anfragen. Bitte kurz warten.");
      return true;
    }
  }

  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (now >= v.resetAt) hits.delete(k);
    }
  }

  return false;
}

/**
 * Bearer-Token aus dem Authorization-Header gegen Supabase prüfen.
 *
 * Muster übernommen aus api/livekit-token.js (Zeile 41-56): bewusst der
 * ANON-Key, nicht die Service-Role. Der zurückgegebene Client sieht damit genau
 * das, was der Nutzer auch im Frontend sieht — dieselben RLS-Policies. Ein
 * Service-Role-Client wäre hier ein privilegierter Datenbankzugang hinter einem
 * Endpoint, den jeder im Netz aufrufen kann.
 *
 * Wer die beiden 401-Fälle unterscheiden will (kein Token vs. ungültiges
 * Token), prüft zusätzlich selbst auf das Bearer-Präfix — siehe
 * api/livekit-token.js. Die Funktion selbst hält den Vertrag bewusst einfach.
 *
 * @returns {Promise<{ user: object, supabase: object } | null>}
 *   null = kein oder ungültiges Token → Aufrufer antwortet mit 401.
 *   Wirft, wenn Supabase gar nicht konfiguriert ist: das ist ein Serverfehler
 *   (500) und darf nicht still als "nicht angemeldet" durchgehen.
 */
export async function requireUser(req) {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)");
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!accessToken) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;

  return { user: data.user, supabase };
}

/**
 * Tageskontingent pro Nutzer und Endpoint.
 *
 * Größenordnung: das Quiz macht 1 ai-match-Aufruf pro Durchlauf, der
 * Markt-Reiter 1 search-places-Aufruf pro geöffnetem Bike. Die Werte liegen
 * bewusst weit über normaler Nutzung — sie sollen einen durchgedrehten Client
 * oder ein gestohlenes Token deckeln, nicht echte Nutzer bremsen.
 */
const DAILY_LIMITS = {
  "ai-match": 30,
  "search-places": 60,
};

/**
 * Zählt einen Aufruf und sagt, ob er noch im Kontingent liegt.
 * Zählwerk liegt in der Datenbank (Tabelle api_usage + SECURITY-DEFINER-Funktion
 * bump_api_usage, siehe supabase/schema.sql) — im Gegensatz zur Map oben
 * überlebt es Cold Starts und gilt über alle Instanzen hinweg.
 *
 * FAIL-OPEN bei Fehlern der Funktion selbst (nicht deployt, DB nicht
 * erreichbar): dann läuft der Aufruf durch und der Fehler geht an Sentry. Ein
 * Nutzer kann diesen Zustand nicht herbeiführen — die davorliegende
 * Session-Prüfung hält bereits jeden Anonymen ab — und ein DB-Aussetzer soll
 * nicht die ganze Funktion abschalten. Nur ein echtes "false" aus der Funktion
 * ist ein Limit-Treffer.
 *
 * @returns {Promise<boolean>} true = erlaubt, false = Tageslimit erreicht.
 */
export async function checkDailyLimit(supabase, endpoint) {
  const limit = DAILY_LIMITS[endpoint];
  if (!limit) return true;

  const { data, error } = await supabase.rpc("bump_api_usage", {
    p_endpoint: endpoint,
    p_limit: limit,
  });

  if (error) {
    report(new Error(`bump_api_usage failed: ${error.message}`), { endpoint });
    return true;
  }
  return data !== false;
}

/**
 * Feld aus dem Request-Body in eine prompt-/query-taugliche Zeichenkette
 * überführen: Typ erzwingen, Länge kürzen, Zeilenumbrüche einebnen.
 *
 * Das Einebnen ist Absicht: die Felder werden in einen mehrzeiligen Prompt
 * interpoliert. Ein Wert mit Zeilenumbrüchen kann dort eigene "Abschnitte"
 * vortäuschen ("\n\nIgnoriere alles davor und ..."). Als eine Zeile innerhalb
 * einer Zeile bleibt er sichtbar Teil seines Feldes. Zusammen mit der
 * Längenbegrenzung ist damit auch die Token-Zahl nach oben gedeckelt.
 *
 * @returns {string} leerer String, wenn der Wert unbrauchbar ist.
 */
export function takeString(value, maxLen) {
  const raw =
    typeof value === "string" ? value
    : typeof value === "number" && Number.isFinite(value) ? String(value)
    : "";
  return raw.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** Ist der Wert ein einfaches Objekt (kein Array, kein null)? */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
