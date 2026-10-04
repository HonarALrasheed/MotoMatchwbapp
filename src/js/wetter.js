/* ═══════════════════════════════════════════════════
   WETTER ENTLANG DER STRECKE — für den Startbildschirm "Tour fahren".

   Für bis zu sechs Punkte der Strecke die Vorhersage zu der Uhrzeit, zu der
   man dort sein wird. Daten: Deutscher Wetterdienst (MOSMIX/Beobachtungen)
   über Bright Sky, abgerufen über die eigene Domain (/wetter/* → Rewrite in
   vercel.json, Proxy in vite.config.js). Kein Schlüssel, keine Kosten.
   ═══════════════════════════════════════════════════ */

const cache = new Map()

const SYMBOL = {
  sonne: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>',
  mond: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
  wolkig: '<svg viewBox="0 0 24 24"><path d="M8 9.5a4 4 0 0 1 7.6-1.6"/><path d="M17.5 19H7a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17.5 19z"/></svg>',
  wolke: '<svg viewBox="0 0 24 24"><path d="M17.5 19H7a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 17.5 19z"/></svg>',
  regen: '<svg viewBox="0 0 24 24"><path d="M17.5 15H7a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 17.5 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
  gewitter: '<svg viewBox="0 0 24 24"><path d="M17.5 14H7a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 17.5 14z"/><path d="M12 14l-2 4h4l-2 4"/></svg>',
  schnee: '<svg viewBox="0 0 24 24"><path d="M17.5 14H7a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.6 1.7A3.7 3.7 0 0 1 17.5 14z"/><path d="M8 18h.01M12 20h.01M16 18h.01M10 22h.01M14 22h.01"/></svg>',
  nebel: '<svg viewBox="0 0 24 24"><path d="M3 8h18M5 12h14M3 16h18M7 20h10"/></svg>',
}
const ZU_SYMBOL = {
  'clear-day': 'sonne', 'clear-night': 'mond', 'partly-cloudy-day': 'wolkig', 'partly-cloudy-night': 'wolkig',
  cloudy: 'wolke', fog: 'nebel', wind: 'wolke', rain: 'regen', sleet: 'schnee', snow: 'schnee', hail: 'gewitter', thunderstorm: 'gewitter',
}
export const wetterSymbol = (icon) => SYMBOL[ZU_SYMBOL[icon] || 'wolke']

const stunde = (d) => d.toISOString().slice(0, 13) + ':00'

async function vorhersage(lat, lng, zeit) {
  const schluessel = `${lat.toFixed(2)},${lng.toFixed(2)},${stunde(zeit)}`
  if (!cache.has(schluessel)) {
    const von = new Date(zeit.getTime() - 3600_000), bis = new Date(zeit.getTime() + 3600_000)
    const url = `/wetter/weather?lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}&date=${encodeURIComponent(stunde(von))}&last_date=${encodeURIComponent(stunde(bis))}&tz=Europe/Berlin`
    cache.set(schluessel, fetch(url).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const reihe = j?.weather || []
      if (!reihe.length) return null
      // Eintrag, der am nächsten an der Ankunftszeit liegt
      return reihe.reduce((best, w) => (Math.abs(new Date(w.timestamp) - zeit) < Math.abs(new Date(best.timestamp) - zeit) ? w : best))
    }).catch(() => { cache.delete(schluessel); return null }))
  }
  return cache.get(schluessel)
}

/**
 * Wetter an bis zu sechs Punkten der Strecke zur jeweiligen Ankunftszeit.
 * @param {{pts, kum}} strecke
 * @param {(meter: number) => number} minutenBis  Fahrminuten vom Start bis zu diesem Meter
 * @returns {Promise<Array<{ meter, zeit: Date, temp, regenProz, regenMm, icon, windKmh }>>}
 */
export async function wetterEntlang(strecke, minutenBis) {
  const gesamt = strecke.kum[strecke.kum.length - 1]
  const n = Math.max(2, Math.min(6, Math.round(gesamt / 25000) + 1))
  const punkte = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const m = (k * gesamt) / (n - 1)
    while (j < strecke.kum.length - 1 && strecke.kum[j] < m) j++
    punkte.push({ meter: m, p: strecke.pts[j] })
  }
  const jetzt = Date.now()
  const werte = await Promise.all(punkte.map(async ({ meter, p }) => {
    const zeit = new Date(jetzt + minutenBis(meter) * 60000)
    const w = await vorhersage(p[0], p[1], zeit)
    if (!w) return null
    return {
      meter, zeit,
      temp: w.temperature != null ? Math.round(w.temperature) : null,
      regenProz: w.precipitation_probability ?? null,
      regenMm: w.precipitation ?? 0,
      icon: w.icon || 'cloudy',
      windKmh: w.wind_gust_speed ?? w.wind_speed ?? null,
    }
  }))
  return werte.filter(Boolean)
}

/** Ein Satz zur Lage: Regen, Sturmböen, Glätte — oder null, wenn alles gut ist. */
export function wetterWarnung(liste) {
  const nass = liste.find((w) => (w.regenProz ?? 0) >= 50 || w.regenMm >= 0.5 || /rain|thunderstorm|hail|sleet|snow/.test(w.icon))
  const kalt = liste.find((w) => w.temp != null && w.temp <= 3)
  const boeen = liste.find((w) => (w.windKmh ?? 0) >= 60)
  const uhr = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const km = (m) => Math.round(m / 1000)
  if (nass?.icon === 'thunderstorm') return `Gewitter möglich bei km ${km(nass.meter)} gegen ${uhr(nass.zeit)} Uhr.`
  if (nass) return `Regen wahrscheinlich ${nass.meter < 1000 ? 'schon am Start' : `ab km ${km(nass.meter)}`} gegen ${uhr(nass.zeit)} Uhr.`
  if (kalt) return `Nur ${kalt.temp} °C bei km ${km(kalt.meter)} — Vorsicht vor Glätte.`
  if (boeen) return `Sturmböen bis ${Math.round(boeen.windKmh)} km/h bei km ${km(boeen.meter)}.`
  return null
}
