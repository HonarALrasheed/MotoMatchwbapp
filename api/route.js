/**
 * ══════════════════════════════════════════════════════════════════
 *  Routing für Karte und Navi — Weiterleitung an OpenRouteService
 *
 *  POST /api/route   { punkte: [[lng, lat], …] }   (2–50 Punkte)
 *                     { punkte: [[lng, lat]], rundtour: { km, seed } }
 *                     → Rundtour ab dem einen Punkt (ORS round_trip)
 *  → { linie: [[lat, lng, höhe], …], meter, sekunden, auf, ab,
 *      schritte: [[meter, art, richtung, straße, ausfahrt], …] }
 *
 *  Der Schlüssel (ORS_KEY) bleibt auf dem Server, der Browser spricht nur
 *  mit unserer Domain. Die Schritte kommen im selben Format wie die der
 *  vorberechneten Touren (OSRM-Begriffe), damit das Navi beide gleich liest.
 *
 *  Schutz: Origin-Allowlist (fängt fremde Webseiten ab, s. _shared.js) und
 *  eine Burst-Bremse je Instanz. Das kostenlose ORS-Kontingent (2.000/Tag,
 *  40/Minute) ist die harte Grenze dahinter; Antworten werden kurz gecacht.
 * ══════════════════════════════════════════════════════════════════
 */
import { sendError, report } from "./_shared.js";

const ORS_URL = "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson";
const MAX_PUNKTE = 50;
const RATE_MAX = 40;
const RATE_FENSTER_MS = 60_000;
// Eigene Frist vor der 12-s-Browserfrist; nicht auf die Plattformfrist verlassen.
const ORS_TIMEOUT_MS = 8_000;

const hits = new Map();
const cache = new Map(); // Schlüssel → { zeit, daten }
const CACHE_MS = 10 * 60_000;

/* ORS-Schritttypen → [art, richtung] wie bei OSRM */
const TYP = {
  0: ["turn", "left"], 1: ["turn", "right"], 2: ["turn", "sharp left"], 3: ["turn", "sharp right"],
  4: ["turn", "slight left"], 5: ["turn", "slight right"], 6: ["continue", "straight"],
  7: ["roundabout", ""], 8: ["exit roundabout", ""], 9: ["turn", "uturn"], 10: ["arrive", ""],
  11: ["depart", ""], 12: ["fork", "slight left"], 13: ["fork", "slight right"],
};

function erlaubt(req) {
  const liste = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin || "";
  // Vercel-Testversionen haben je Deploy eine eigene Adresse (und sind per
  // Vercel-Anmeldung geschützt): dort die eigene Herkunft zulassen.
  if (process.env.VERCEL_ENV === "preview" && origin && origin === `https://${req.headers.host}`) return true;
  return liste.includes(origin);
}

function gebremst(req) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unbekannt";
  const jetzt = Date.now();
  const e = hits.get(ip);
  if (!e || jetzt >= e.bis) { hits.set(ip, { n: 1, bis: jetzt + RATE_FENSTER_MS }); return false; }
  e.n += 1;
  if (hits.size > 5000) for (const [k, v] of hits) if (jetzt >= v.bis) hits.delete(k);
  return e.n > RATE_MAX;
}

function gueltig(punkte, min = 2) {
  return Array.isArray(punkte) && punkte.length >= min && punkte.length <= MAX_PUNKTE &&
    punkte.every((p) => Array.isArray(p) && p.length === 2 &&
      Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
      p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90);
}

class AntwortFehler extends Error {}

function gueltigeRoute(f) {
  const coords = f?.geometry?.coordinates;
  const props = f?.properties;
  const segs = props?.segments;
  const summary = props?.summary;
  return f?.geometry?.type === "LineString" && Array.isArray(coords) && coords.length >= 2 &&
    coords.every((p) => Array.isArray(p) && p.length >= 2 &&
      Number.isFinite(p[0]) && p[0] >= -180 && p[0] <= 180 &&
      Number.isFinite(p[1]) && p[1] >= -90 && p[1] <= 90 &&
      (p[2] == null || Number.isFinite(p[2]))) &&
    coords.some((p) => p[0] !== coords[0][0] || p[1] !== coords[0][1]) &&
    Array.isArray(segs) && segs.length > 0 &&
    segs.every((seg) => Array.isArray(seg?.steps) && seg.steps.every((s) =>
      Number.isFinite(s?.distance) && s.distance >= 0 && Number.isInteger(s.type) &&
      (s.name == null || typeof s.name === "string") &&
      (s.exit_number == null || typeof s.exit_number === "string" || Number.isFinite(s.exit_number)))) &&
    segs.some((seg) => seg.steps.length > 0) &&
    (summary?.distance == null || (Number.isFinite(summary.distance) && summary.distance > 0)) &&
    (summary?.duration == null || (Number.isFinite(summary.duration) && summary.duration >= 0)) &&
    (props.ascent == null || (Number.isFinite(props.ascent) && props.ascent >= 0)) &&
    (props.descent == null || (Number.isFinite(props.descent) && props.descent >= 0));
}

export default async function handler(req, res) {
  if (!erlaubt(req)) return sendError(res, 403, "forbidden_origin", "Zugriff von dieser Herkunft nicht erlaubt.");
  if (req.method !== "POST") return sendError(res, 405, "method_not_allowed", "Method Not Allowed");
  if (gebremst(req)) {
    res.setHeader("Retry-After", "30");
    return sendError(res, 429, "rate_limited", "Zu viele Routen auf einmal. Bitte kurz warten.");
  }
  const punkte = req.body?.punkte;
  const rt = req.body?.rundtour;
  const rundtour = rt && Number.isFinite(rt.km) && rt.km >= 10 && rt.km <= 300
    ? { length: Math.round(rt.km * 1000), points: 5, seed: Math.max(0, Math.min(99, Math.round(rt.seed || 0))) }
    : null;
  if (!gueltig(punkte, rundtour ? 1 : 2) || (rundtour && punkte.length !== 1)) return sendError(res, 400, "invalid_input", "Ungültige Wegpunkte.");
  const KEY = process.env.ORS_KEY;
  if (!KEY) {
    report(new Error("ORS_KEY not configured"));
    return sendError(res, 500, "not_configured", "Routing ist noch nicht eingerichtet.");
  }

  const schluessel = punkte.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(";") + (rundtour ? `|r${rundtour.length}-${rundtour.seed}` : "");
  if (req.signal?.aborted) return sendError(res, 499, "aborted", "Die Routenberechnung wurde abgebrochen.");
  const treffer = cache.get(schluessel);
  if (treffer && Date.now() - treffer.zeit < CACHE_MS) return res.status(200).json(treffer.daten);

  const controller = new AbortController();
  let grund = null;
  let timer;
  let beiAbbruch;
  const frist = new Promise((_, reject) => {
    timer = setTimeout(() => {
      grund = "timeout";
      controller.abort();
      reject(new Error("ORS timeout"));
    }, ORS_TIMEOUT_MS);
  });
  const abbruch = req.signal?.addEventListener && new Promise((_, reject) => {
    beiAbbruch = () => {
      grund = "aborted";
      controller.abort();
      reject(new Error("Client aborted"));
    };
    req.signal.addEventListener("abort", beiAbbruch, { once: true });
    if (req.signal.aborted) beiAbbruch();
  });
  const warten = (promise) => Promise.race([promise, frist, ...(abbruch ? [abbruch] : [])]);
  try {
    const r = await warten(fetch(ORS_URL, {
      method: "POST",
      headers: { Authorization: KEY, "Content-Type": "application/json", Accept: "application/geo+json" },
      signal: controller.signal,
      body: JSON.stringify({
        coordinates: punkte,
        elevation: true,
        instructions: true,
        language: "de",
        units: "m",
        // Wegpunkte auf Straßen bis 1 km Entfernung einrasten (Klick neben die Straße)
        radiuses: punkte.map(() => 1000),
        ...(rundtour ? { options: { round_trip: rundtour } } : {}),
      }),
    }));
    if (!r.ok) {
      let text = "";
      try { text = await warten(r.text()); }
      catch (err) { if (grund) throw err; }
      report(new Error(`ORS ${r.status}`), { text: text.slice(0, 300) });
      if (r.status === 404 || r.status === 400) return sendError(res, 422, "no_route", "Zwischen diesen Punkten wurde keine Straße gefunden.");
      if (r.status === 429) return sendError(res, 503, "quota", "Das Routing ist gerade ausgelastet. Bitte gleich noch einmal.");
      return sendError(res, 502, "upstream", "Die Route konnte gerade nicht berechnet werden.");
    }
    const j = await warten(r.json());
    const f = j?.features?.[0];
    if (!f) return sendError(res, 422, "no_route", "Keine Route gefunden.");
    if (!gueltigeRoute(f)) throw new AntwortFehler("Ungültige ORS-Route");
    const coords = f.geometry.coordinates; // [lng, lat, höhe]
    const segs = f.properties.segments;
    const schritte = [];
    let meter = 0;
    segs.forEach((seg, si) => {
      for (const s of seg.steps || []) {
        const [art, richtung] = TYP[s.type] || ["turn", ""];
        // Zwischenziele: "arrive" nur am Ende der ganzen Route, "depart" nur am Anfang
        if ((art === "arrive" && si < segs.length - 1) || (art === "depart" && si > 0)) { meter += s.distance; continue; }
        schritte.push([Math.round(meter), art, richtung, s.name && s.name !== "-" ? s.name : "", s.exit_number || 0]);
        meter += s.distance;
      }
    });
    const sum = f.properties.summary || {};
    const daten = {
      linie: coords.map(([lng, lat, z]) => [+lat.toFixed(6), +lng.toFixed(6), Math.round(z ?? 0)]),
      meter: Math.round(sum.distance || meter),
      sekunden: Math.round(sum.duration || 0),
      auf: Math.round(f.properties.ascent || 0),
      ab: Math.round(f.properties.descent || 0),
      schritte,
    };
    if (!(daten.meter > 0) || !Number.isFinite(daten.sekunden) || !schritte.length) throw new AntwortFehler("Ungültiges ORS-Ergebnis");
    cache.set(schluessel, { zeit: Date.now(), daten });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return res.status(200).json(daten);
  } catch (err) {
    if (grund === "timeout") return sendError(res, 504, "timeout", "Die Routenberechnung dauert zu lange. Bitte versuch es erneut.");
    if (grund === "aborted" || err?.name === "AbortError") return sendError(res, 499, "aborted", "Die Routenberechnung wurde abgebrochen.");
    report(err);
    if (err instanceof AntwortFehler || err?.name === "SyntaxError") return sendError(res, 502, "invalid_response", "Der Routingdienst hat keine gültige Route geliefert.");
    return sendError(res, 502, "upstream_network", "Der Routingdienst ist gerade nicht erreichbar.");
  } finally {
    clearTimeout(timer);
    if (beiAbbruch) req.signal.removeEventListener("abort", beiAbbruch);
  }
}
