/* Titelbilder für die Touren — freie Fotos von Wikimedia Commons.

   Je Tour wird ein Foto gesucht, das zu ihren Höhepunkten passt:
     1. die Stichworte aus dem Tournamen ("Wiedener Eck", "Belchenland" …) als
        Artikel der deutschen Wikipedia → Bild aus Wikidata (P18) oder Artikelbild
     2. Artikel mit Bild in der Nähe der Strecke (Berge, Seen, Burgen, Pässe …)
     3. die Wegpunkte, zuletzt die Region
   Genommen werden nur Fotos im Querformat unter freier Lizenz (CC BY, CC BY-SA,
   CC0, gemeinfrei) — keine Karten, Wappen oder Grafiken. Die Bilder werden
   heruntergeladen und von der eigenen Domain ausgeliefert (kein Aufruf bei
   Wikimedia aus dem Browser), Urheber und Lizenz stehen in bilder.json und
   werden am Bild genannt.

   Ausgabe: public/data/touren/bilder/<id>.jpg (960 px), <id>-k.jpg (330 px)
            public/data/touren/bilder.json
   Aufruf:  node scripts/touren/bilder.mjs            fehlende Touren
            node scripts/touren/bilder.mjs --neu      alle neu
            node scripts/touren/bilder.mjs <id> [Datei:Name.jpg]   eine Tour, optional festes Bild
   Danach nachpressen (spart ~40 %), z. B. mit Pillow:
            python3 -c "import glob;from PIL import Image;[Image.open(f).convert('RGB').save(f,'JPEG',quality=76,optimize=True,progressive=True) for f in glob.glob('public/data/touren/bilder/*.jpg')]"
*/

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ZIEL = path.join(HIER, '..', '..', 'public', 'data', 'touren')
const ORDNER = path.join(ZIEL, 'bilder')
const UA = 'MotoMatch-Tourenbilder/1.0 (https://motomatch.studio; kontakt@motomatch.studio)'

/* Feste Wahl, wo die Automatik danebenliegt (Dateiname auf Commons). */
const FEST = {
  'bergische-talsperren': 'Hückeswagen (DE), Bevertalsperre -- 2022 -- 0044.jpg',
  rureifel: 'Rurtalsperre from Schöne Aussicht Schmidt 10.jpg',
  moselschleifen: 'Moselschleife Bremm, Rheinland-Pfalz, Germany (21476475103).jpg',
  hunsrueckhoehenstrasse: 'Landschaft zwischen Brauweiler und Heinzenberg - panoramio.jpg',
  'lahn-westerwald': '2017 Dausenau Herrenlei.jpg',
  rhoen: 'Sommer auf dem Simmelsberg.jpg',
  bergstrasse: '200904071114a Heppenheim Weinberge.JPG',
  pfaelzerwald: '2008.05.30.094433 Aussicht Hohe Loog.jpg',
  'schwarzwald-taelerstrasse': 'Obertsrot im Murgtal - panoramio.jpg',
  'alpenstrasse-west': 'Alpsee, Schwangau, Alemania, 2012-10-06, DD 01.jpg',
  'romantische-strasse': 'Plönlein, Rothenburg ob der Tauber, Alemania, 2023-06-17, DD 36.jpg',
  oberharz: 'Oderteich Harz.jpg',
  'holsteinische-schweiz': 'Plöner Schloss.jpg',
  elbuferstrasse: 'Hitzacker- Altstadt und Elbaue vom Weinberg-2.jpg',
  ruegen: 'Beach north of Königsstuhl Jasmund 2021-09-14 03.jpg',
  'saechsische-weinstrasse': 'Radebeul Weinberge Hoflössnitz Bismarckturm Spitzhaus.jpg',
}

const NICHT_FOTO = /wappen|coat[_ ]of[_ ]arms|karte|map\b|_map|lage|locator|logo|flagge|flag[_ ]of|übersicht|plan\b|grundriss|schema|diagramm|relief|topograph|signet|siegel|emblem|schild|briefmarke|stamp/i
const NATUR = /berg|see|tal\b|tal$|burg|schloss|pass\b|felsen|turm|kloster|wasserfall|aussicht|schlucht|höhe|kopf|eck\b|stein|kamm|kuppe|joch|sattel|klamm|alm|gebirge|wald|maar|talsperre|stausee|schleife|bucht|kreidefelsen|ruine|panorama|blick/i
const FREI = /^(cc[- ]by|cc[- ]by[- ]sa|cc0|public domain|pd|gemeinfrei)/i

const warte = (ms) => new Promise((ok) => setTimeout(ok, ms))
async function api(host, params) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  for (let versuch = 0; versuch < 4; versuch++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    if (r.ok) return r.json()
    await warte(2000 * (versuch + 1))
  }
  throw new Error(`${host} ${params.action}: keine Antwort`)
}

const km = (a, b, c, d) => {
  const r = Math.PI / 180, x = (d - b) * r * Math.cos(((a + c) / 2) * r), y = (c - a) * r
  return Math.sqrt(x * x + y * y) * 6371
}

/** Stichworte aus dem Tournamen: "Münstertal, Wiedener Eck & Belchenland" → 3 Artikel. */
function stichworte(t) {
  return t.name
    .split(/[:,&–]| und | ab | über | im | in der | B\d+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && !/runde|rundtour|tour|kurven|südlich|nördlich|^\d/i.test(s))
}

/** Artikel → mögliche Bilder (Wikidata-Bild zuerst, dann Artikelbild). */
async function bilderVonArtikeln(titel) {
  if (!titel.length) return []
  const j = await api('de.wikipedia.org', {
    action: 'query', titles: titel.join('|'), redirects: '1',
    prop: 'pageimages|coordinates|pageprops', piprop: 'name', ppprop: 'wikibase_item|disambiguation',
  })
  const seiten = (j.query?.pages || []).filter((p) => !p.missing && !p.pageprops?.disambiguation)
  const qids = seiten.map((p) => p.pageprops?.wikibase_item).filter(Boolean)
  const p18 = {}
  if (qids.length) {
    const w = await api('www.wikidata.org', { action: 'wbgetentities', ids: qids.join('|'), props: 'claims' })
    for (const [q, e] of Object.entries(w.entities || {})) {
      const c = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value
      if (c) p18[q] = c
    }
  }
  // Reihenfolge der Titel beibehalten (Weiterleitungen umgerechnet)
  const umleitung = Object.fromEntries([...(j.query?.normalized || []), ...(j.query?.redirects || [])].map((r) => [r.from, r.to]))
  const ziel = (t) => { let x = t; for (let i = 0; i < 3 && umleitung[x]; i++) x = umleitung[x]; return x }
  const out = []
  for (const t of titel) {
    const p = seiten.find((s) => s.title === ziel(t))
    if (!p) continue
    const lage = p.coordinates?.[0]
    for (const datei of [p18[p.pageprops?.wikibase_item], p.pageimage]) {
      if (datei) out.push({ datei: datei.replace(/ /g, '_'), artikel: p.title, lat: lage?.lat, lng: lage?.lon })
    }
  }
  return out
}

/** Artikel mit Bild nahe der Strecke, nur Landschaft und Sehenswertes. */
async function bilderInDerNaehe(t) {
  const punkte = t.wp.filter((w) => w[1] != null)
  const out = []
  for (const w of punkte.slice(0, 6)) {
    const j = await api('de.wikipedia.org', {
      action: 'query', generator: 'geosearch', ggscoord: `${w[1]}|${w[2]}`, ggsradius: '10000', ggslimit: '40',
      prop: 'pageimages|coordinates', piprop: 'name',
    })
    for (const p of j.query?.pages || []) {
      if (p.pageimage && NATUR.test(p.title)) out.push({ datei: p.pageimage, artikel: p.title, lat: p.coordinates?.[0]?.lat, lng: p.coordinates?.[0]?.lon })
    }
  }
  return out
}

/** Commons-Angaben prüfen: Foto, Querformat, groß genug, freie Lizenz. */
async function pruefe(kandidaten) {
  const dateien = [...new Set(kandidaten.map((k) => k.datei))]
  const info = {}
  for (let i = 0; i < dateien.length; i += 40) {
    const j = await api('commons.wikimedia.org', {
      action: 'query', titles: dateien.slice(i, i + 40).map((d) => `File:${d}`).join('|'),
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '960',
    })
    for (const p of j.query?.pages || []) {
      const ii = p.imageinfo?.[0]
      if (ii) info[p.title.replace(/^File:/, '').replace(/ /g, '_')] = ii
    }
  }
  return info
}

const ohneHtml = (s = '') => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()

function taugt(ii, datei) {
  if (!ii || ii.mime !== 'image/jpeg' || NICHT_FOTO.test(datei)) return false
  if (ii.width < 1000 || ii.width / ii.height < 1.2 || ii.width / ii.height > 2.6) return false
  const m = ii.extmetadata || {}
  return FREI.test(m.LicenseShortName?.value || '') && !/nonderivative|-nd|noncommercial|-nc/i.test(m.LicenseShortName?.value || '')
}

const LANDSCHAFT = /see\b|see$|talsperre|stausee|berg|tal\b|tal$|pass\b|joch|kopf|höhe|eck\b|felsen|schlucht|klamm|wasserfall|maar|kamm|kuppe|gebirge|wald|bucht|schleife|heide|küste|ufer|aussicht/i
const BAUWERK = /burg|schloss|ruine|kloster|turm|brücke|kirche|dom\b|mühle|hütte/i
const AUSBLICK = /panorama|blick|view|aussicht|landschaft|luftbild|aerial|herbst|sommer|autumn|summer|sunset|sonnen|nebel|tal|valley|see|lake/i
// Gebäude, Ämter, Verkehrsbauten — kein Titelbild für eine Motorradtour
const UNPASSEND = /kirche|church|innen|interior|altar|orgel|portal|grab|denkmal|statue|haus(?![a-zäöü])|house|gebäude|building|bahnhof|station|flugplatz|airfield|airport|kreis(?![a-zäöü])|rathaus|amt(?![a-zäöü])|gewerbe|industrie|krankenhaus|schule|parkplatz|tankstelle|supermarkt|wappen/i
function wertung(k, ii) {
  let p = 0
  if (LANDSCHAFT.test(k.artikel)) p += 3
  else if (BAUWERK.test(k.artikel)) p += 1.5
  if (AUSBLICK.test(k.datei)) p += 1.5
  if (UNPASSEND.test(k.datei) || UNPASSEND.test(k.artikel)) p -= 10
  return p + Math.min(ii.width, 4000) / 4000
}

async function lade(url, datei) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`Download ${r.status}`)
  await fs.writeFile(datei, Buffer.from(await r.arrayBuffer()))
}

async function bildFuer(t, schonGenutzt, fest) {
  const mitte = [(t.box[0] + t.box[2]) / 2, (t.box[1] + t.box[3]) / 2] // box: [s, w, n, o]
  const nahGenug = (k) => k.lat == null || km(mitte[0], mitte[1], k.lat, k.lng) < 25 + km(t.box[0], t.box[1], t.box[2], t.box[3]) / 2
  // Stufen der Reihe nach — die nächste wird erst abgefragt, wenn die vorige nichts liefert
  const stufen = fest
    ? [async () => [{ datei: fest.replace(/^(Datei|File):/, '').replace(/ /g, '_'), artikel: '' }]]
    : [
        () => bilderVonArtikeln(stichworte(t)),
        () => bilderInDerNaehe(t),
        () => bilderVonArtikeln(t.wp.map((w) => w[0])),
        () => bilderVonArtikeln([t.region]),
      ]
  for (const holen of stufen) {
    const stufe = (await holen()).filter((k) => fest || nahGenug(k))
    if (!stufe.length) continue
    const info = await pruefe(stufe)
    // Landschaft vor Bauwerk, Ausblick im Dateinamen zählt, dann die Größe
    const passend = stufe
      .filter((k) => !schonGenutzt.has(k.datei) && taugt(info[k.datei], k.datei))
      .map((k) => ({ ...k, punkte: fest ? 0 : wertung(k, info[k.datei]) }))
      .filter((k) => k.punkte >= 0)
      .sort((x, y) => y.punkte - x.punkte)
    if (passend.length) return { ...passend[0], ii: info[passend[0].datei] }
  }
  return null
}

/** Liste aller Tourenfotos mit Urheber und Lizenz in public/bildnachweis.html. */
async function bildnachweis(index, bilder) {
  const datei = path.join(HIER, '..', '..', 'public', 'bildnachweis.html')
  const html = await fs.readFile(datei, 'utf8')
  const e = (x = '') => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const zeilen = index.touren.filter((t) => bilder[t.id]).map((t) => {
    const b = bilder[t.id]
    const lizenz = b.lizenzUrl ? `<a href="${e(b.lizenzUrl)}" target="_blank" rel="noopener">${e(b.lizenz)}</a>` : e(b.lizenz)
    return `        <li>${e(t.name)}: <a href="${e(b.seite)}" target="_blank" rel="noopener">Foto</a> von ${e(b.autor)}, ${lizenz}</li>`
  })
  const neu = html.replace(/<!-- TOURENFOTOS:START -->[\s\S]*<!-- TOURENFOTOS:ENDE -->/, `<!-- TOURENFOTOS:START -->\n${zeilen.join('\n')}\n<!-- TOURENFOTOS:ENDE -->`)
  await fs.writeFile(datei, neu)
}

async function main() {
  const args = process.argv.slice(2)
  const neu = args.includes('--neu')
  const nur = args.find((a) => !a.startsWith('--') && !/\.(jpe?g)$/i.test(a))
  const fest = args.find((a) => /\.(jpe?g)$/i.test(a)) || (nur && FEST[nur])
  const index = JSON.parse(await fs.readFile(path.join(ZIEL, 'index.json'), 'utf8'))
  let bilder = {}
  try { bilder = JSON.parse(await fs.readFile(path.join(ZIEL, 'bilder.json'), 'utf8')) } catch {}
  await fs.mkdir(ORDNER, { recursive: true })
  const genutzt = new Set(Object.entries(bilder).filter(([id]) => id !== nur && !neu).map(([, b]) => b.datei))

  for (const t of index.touren) {
    if (nur ? t.id !== nur : !neu && bilder[t.id]) continue
    try {
      const b = await bildFuer(t, genutzt, nur ? fest : FEST[t.id])
      if (!b) { console.log(`${t.id}: kein passendes Foto`); delete bilder[t.id]; continue }
      const m = b.ii.extmetadata || {}
      const klein = b.ii.thumburl.replace(/\/960px-/, '/330px-')
      await lade(b.ii.thumburl, path.join(ORDNER, `${t.id}.jpg`))
      await lade(klein, path.join(ORDNER, `${t.id}-k.jpg`))
      bilder[t.id] = {
        datei: b.datei,
        motiv: b.artikel || ohneHtml(m.ObjectName?.value) || '',
        autor: ohneHtml(m.Artist?.value) || 'unbekannt',
        lizenz: m.LicenseShortName?.value || '',
        lizenzUrl: m.LicenseUrl?.value || '',
        seite: b.ii.descriptionurl,
      }
      genutzt.add(b.datei)
      console.log(`${t.id}: ${b.datei} (${b.artikel}) · ${bilder[t.id].autor} · ${bilder[t.id].lizenz}`)
    } catch (err) {
      console.log(`${t.id}: Fehler ${err.message}`)
    }
    await fs.writeFile(path.join(ZIEL, 'bilder.json'), JSON.stringify(bilder))
  }
  // Bilder verwaister Touren entfernen
  const ids = new Set(index.touren.map((t) => t.id))
  for (const id of Object.keys(bilder)) if (!ids.has(id)) delete bilder[id]
  await fs.writeFile(path.join(ZIEL, 'bilder.json'), JSON.stringify(bilder))
  await bildnachweis(index, bilder)
  console.log(`${Object.keys(bilder).length} von ${index.touren.length} Touren mit Foto`)
}

main()
