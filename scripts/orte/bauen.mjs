/* Baut die Daten des Orte-Bereichs der Karte aus OpenStreetMap (ODbL):
     public/data/orte/index.json            Kategorien, Stand, vorhandene Kacheln
     public/data/orte/<kat>/<lat>_<lng>.json Orte je 1°-Kachel (lädt nur die Umgebung)
     public/data/orte/suche.json            Städte, Gemeinden, Ortsteile + PLZ für die Ortssuche

   Ersetzt Google Places: keine Kosten je Suche, keine Daten an Google, und die
   Treffer gehören zur eigenen Karte (Places-Inhalte dürften laut Google-AGB nur
   auf einer Google-Karte stehen).

   Aufruf: node scripts/orte/bauen.mjs [kategorie …]   ohne Argument alle */

import { writeFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = dirname(fileURLToPath(import.meta.url))
const ZIEL = join(HIER, '..', '..', 'public', 'data', 'orte')
const UA = 'MotoMatch-Orte/1.0 (kontakt@motomatch.studio)'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const DE = 'area["ISO3166-1"="DE"][admin_level=2]->.de;'

/* Kategorien = die Kacheln im Orte-Reiter (Schlüssel wie data-query im Markup).
   Werkstätten: eigens getaggte Motorradwerkstätten und Motorradhändler, an
   denen eine Werkstatt vermerkt ist — reine Autowerkstätten nur, wenn sie
   ausdrücklich Motorräder machen. */
const NAME_MOTO = 'Motorrad|Zweirad|Moto|Bike|Biker|Krad|Roller|Harley|Ducati|Triumph|Yamaha|Kawasaki|Suzuki|Honda|KTM|BMW Motorrad'
const KATEGORIEN = {
  werkstatt: {
    query: `nwr["shop"="motorcycle_repair"](area.de);
      nwr["shop"="motorcycle"]["service:vehicle:repair"="yes"](area.de);
      nwr["shop"="motorcycle"]["motorcycle:repair"="yes"](area.de);
      nwr["shop"="motorcycle"]["repair"="yes"](area.de);
      nwr["shop"="motorcycle"]["name"~"Werkstatt|Service|Reparatur|[Tt]echnik|Schrauber|Tuning",i](area.de);
      nwr["shop"="car_repair"]["service:vehicle:motorcycle"="yes"](area.de);
      nwr["shop"="car_repair"]["motorcycle"="yes"](area.de);
      nwr["shop"="car_repair"]["name"~"Motorrad|Zweirad|Krad",i](area.de);
      nwr["craft"="motorcycle_repair"](area.de);
      nwr["shop"="car_repair"]["name"~"Harley|Ducati|Triumph|Yamaha|Kawasaki|Suzuki|KTM|Husqvarna|Aprilia|Moto Guzzi|Royal Enfield|Vespa|Piaggio",i](area.de);
      nwr["shop"="tyres"]["service:vehicle:motorcycle"="yes"](area.de);
      nwr["shop"="tyres"]["name"~"Motorrad|Zweirad",i](area.de);`,
    /* Motorradhändler haben in Deutschland fast immer eine Werkstatt, in OSM
       ist das aber selten vermerkt — ohne sie fehlten die meisten Werkstätten. */
    mitHaendlern: true,
  },
  haendler: {
    query: `nwr["shop"="motorcycle"](area.de);
      nwr["shop"="motorcycle_parts"](area.de);
      nwr["shop"="motorcycle_accessories"](area.de);
      nwr["shop"="clothes"]["clothes"~"motorcycle"](area.de);`,
  },
  fahrschule: { query: 'nwr["amenity"="driving_school"](area.de);' },
  tankstelle: { query: 'nwr["amenity"="fuel"]["access"!~"private|customers"](area.de);' },
  parkplatz: {
    query: `nwr["amenity"="motorcycle_parking"](area.de);
      nwr["amenity"="parking"]["motorcycle"="designated"](area.de);`,
  },
  treff: {
    // Je Lokal-Art eine eigene Abfrage: zusammen lief die Namenssuche über alle
    // Lokale Deutschlands in das Speicherlimit der Overpass-Server.
    teile: ['cafe', 'restaurant', 'biergarten', 'pub', 'fast_food', 'bar'].map((a) =>
      `nwr["amenity"="${a}"]["name"~"Motorrad|Biker|Kradfahrer|Moped|Moto|Bike"](area.de);
      nwr["amenity"="${a}"]["name"~"motorrad|biker|bike"](area.de);
      nwr["amenity"="${a}"]["motorcycle"="designated"](area.de);`),
    // "Bike" allein trifft hier Fahrradcafés — die fliegen unten über den Namen raus
    ausschluss: /fahrrad|rad[- ]?caf|bicycle|e-?bike|mountainbike|\bmtb\b/i,
    // Ausdrücklich biker-freundliche Lokale und Unterkünfte (OSM-Merkmale)
    dazu: `nwr["motorcycle_friendly"="yes"](area.de);
      nwr["bikers"="yes"](area.de);
      nwr["biker"="yes"](area.de);
      nwr["motorcycle"="welcome"](area.de);`,
  },
  // Aussichtspunkte mit Namen — beliebte Ziele und Pausen auf Touren
  aussicht: { query: 'nwr["tourism"="viewpoint"]["name"](area.de);' },
}

const SERVER = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
/* Mit Wiederholung und Ausweichserver: der Hauptserver antwortet unter Last
   mit 504, mit HTTP 200 + "remark" oder bricht die Verbindung ab (ETIMEDOUT). */
async function overpass(q) {
  for (let i = 1; ; i++) {
    const server = SERVER[(i - 1) % SERVER.length]
    let grund
    try {
      const r = await fetch(server, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      })
      if (r.ok) {
        const j = await r.json()
        if (!j.remark || !/error|timed out|out of memory/i.test(j.remark)) return j.elements
        grund = j.remark.slice(0, 80)
      } else grund = `HTTP ${r.status}`
    } catch (err) {
      grund = err.cause?.code || err.message
    }
    if (i >= 6) throw new Error(`Overpass: ${grund}`)
    console.log(`  ${new URL(server).host}: ${grund} — neuer Versuch in ${20 * i} s`)
    await pause(20000 * i)
  }
}

const adresse = (t) => {
  const strasse = [t['addr:street'] || t['addr:place'], t['addr:housenumber']].filter(Boolean).join(' ')
  const ort = [t['addr:postcode'], t['addr:city'] || t['addr:suburb']].filter(Boolean).join(' ')
  return [strasse, ort].filter(Boolean).join(', ')
}
const url = (t) => {
  const w = t.website || t['contact:website'] || t.url || ''
  if (!w) return ''
  return /^https?:\/\//i.test(w) ? w : `https://${w}`
}

/** Gleiche Stelle doppelt (Knoten + Gebäude, Tankstelle + Shop): zusammenlegen. */
function entdoppeln(liste) {
  const raster = new Map()
  const aus = []
  for (const o of liste) {
    const k = `${Math.round(o.lat * 400)}_${Math.round(o.lng * 400)}`
    const nachbarn = [-1, 0, 1].flatMap((a) => [-1, 0, 1].map((b) => `${Math.round(o.lat * 400) + a}_${Math.round(o.lng * 400) + b}`))
    const doppelt = nachbarn.some((nk) => (raster.get(nk) || []).some((x) =>
      Math.abs(x.lat - o.lat) < 0.0015 && Math.abs(x.lng - o.lng) < 0.0022 &&
      (x.name.toLowerCase() === o.name.toLowerCase() || !x.name || !o.name || x.marke && x.marke === o.marke)))
    if (doppelt) continue
    if (!raster.has(k)) raster.set(k, [])
    raster.get(k).push(o)
    aus.push(o)
  }
  return aus
}

async function kategorie(kat, def) {
  process.stdout.write(`${kat} … `)
  const roh = []
  for (const teil of [...(def.teile || [def.query]), ...(def.dazu ? [def.dazu] : []), ...(def.mitHaendlern ? ['nwr["shop"="motorcycle"](area.de);'] : [])]) {
    roh.push(...await overpass(`[out:json][timeout:600];${DE}(${teil});out center tags;`))
    await pause(3000)
  }
  let liste = roh.map((e) => {
    const t = e.tags || {}
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon
    if (lat == null) return null
    const marke = t.brand || ''
    const name = t.name || t['name:de'] || (kat === 'tankstelle' ? marke || t.operator || '' : '') || ''
    return {
      id: `${e.type[0]}${e.id}`, name, lat: +lat.toFixed(5), lng: +lng.toFixed(5), marke,
      adresse: adresse(t), tel: t.phone || t['contact:phone'] || '', web: url(t), zeiten: t.opening_hours || '',
    }
  }).filter(Boolean)
  if (def.ausschluss) liste = liste.filter((o) => !def.ausschluss.test(o.name))
  // Ohne Namen ist ein Händler oder eine Fahrschule nicht auffindbar — Parkplätze und Tankstellen schon
  if (!['parkplatz', 'tankstelle'].includes(kat)) liste = liste.filter((o) => o.name)
  liste = entdoppeln(liste)

  const kacheln = new Map()
  for (const o of liste) {
    const k = `${Math.floor(o.lat)}_${Math.floor(o.lng)}`
    if (!kacheln.has(k)) kacheln.set(k, [])
    // Kompakt als Feld: [id, name, lat, lng, adresse, tel, web, zeiten, marke]
    kacheln.get(k).push([o.id, o.name, o.lat, o.lng, o.adresse, o.tel, o.web, o.zeiten, o.marke].map((v, i) => (i > 3 && !v ? 0 : v)))
  }
  await rm(join(ZIEL, kat), { recursive: true, force: true })
  await mkdir(join(ZIEL, kat), { recursive: true })
  for (const [k, l] of kacheln) await writeFile(join(ZIEL, kat, `${k}.json`), JSON.stringify(l))
  console.log(`${roh.length} roh → ${liste.length} Orte in ${kacheln.size} Kacheln`)
  return { anzahl: liste.length, kacheln: [...kacheln.keys()].sort() }
}

/* Ortssuche: Städte, Gemeinden, Dörfer, Stadtteile + Postleitzahlen. Rang
   ordnet gleichnamige Treffer (Stadt vor Dorf). */
async function suchindex() {
  process.stdout.write('suche … ')
  const RANG = { city: 1, town: 2, suburb: 3, village: 4 }
  const orte = await overpass(`[out:json][timeout:600];${DE}(node["place"~"^(city|town|village|suburb)$"]["name"](area.de););out qt;`)
  const plz = await overpass(`[out:json][timeout:600];${DE}(relation["boundary"="postal_code"]["postal_code"](area.de););out center tags qt;`)
  const liste = orte.map((e) => {
    const t = e.tags
    const zusatz = t['is_in:county'] || t['is_in:state'] || ''
    return [t.name, +e.lat.toFixed(4), +e.lon.toFixed(4), RANG[t.place] || 5, zusatz]
  })
  const plzListe = plz.filter((e) => e.center).map((e) => [e.tags.postal_code, +e.center.lat.toFixed(4), +e.center.lon.toFixed(4), e.tags.note || e.tags.name || ''])
  await writeFile(join(ZIEL, 'suche.json'), JSON.stringify({ orte: liste, plz: plzListe }))
  console.log(`${liste.length} Orte, ${plzListe.length} PLZ`)
}

await mkdir(ZIEL, { recursive: true })
const nur = process.argv.slice(2)
const index = { stand: new Date().toISOString().slice(0, 10), quelle: '© OpenStreetMap-Mitwirkende (ODbL)', kategorien: {} }
try {
  Object.assign(index, JSON.parse(await (await import('node:fs/promises')).readFile(join(ZIEL, 'index.json'), 'utf8')), { stand: index.stand })
} catch {}
for (const [kat, def] of Object.entries(KATEGORIEN)) {
  if (nur.length && !nur.includes(kat)) continue
  index.kategorien[kat] = await kategorie(kat, def)
  await writeFile(join(ZIEL, 'index.json'), JSON.stringify(index))
  await pause(5000)
}
if (!nur.length || nur.includes('suche')) await suchindex()
