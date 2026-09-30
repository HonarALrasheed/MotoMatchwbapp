/**
 * MotoMatch — neue und geänderte Seiten per IndexNow melden (2026-09-30)
 *
 * IndexNow ist das Meldeverfahren von Bing, Yandex, Seznam und Naver. Über den Bing-Index erreicht
 * es auch die ChatGPT-Suche, Copilot und DuckDuckGo. Ohne Meldung finden diese Suchmaschinen neue
 * Seiten erst beim nächsten Crawl, oft Wochen später. Google nimmt an IndexNow nicht teil — dort
 * reicht die Sitemap in der Search Console.
 *
 * Liest die LIVE-Sitemap (nicht dist/), damit nur Adressen gemeldet werden, die wirklich schon
 * ausgeliefert werden. Läuft automatisch nach jedem Produktions-Deploy
 * (.github/workflows/indexnow.yml) und lässt sich von Hand starten:
 *
 *     node scripts/indexnow.mjs
 *
 * Der Schlüssel ist die Datei public/<schlüssel>.txt — IndexNow prüft über sie, dass die Meldung
 * vom Betreiber der Domain kommt. Sie muss ausgeliefert werden und darf nicht umbenannt werden.
 */
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "motomatch.studio";
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const schluesselDatei = readdirSync(join(WURZEL, "public")).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!schluesselDatei) {
  console.error("[indexnow] Kein Schlüssel in public/ (<32 Hex-Zeichen>.txt).");
  process.exit(1);
}
const key = schluesselDatei.replace(/\.txt$/, "");

const antwort = await fetch(`https://${HOST}/sitemap.xml`);
if (!antwort.ok) {
  console.error(`[indexnow] Sitemap nicht abrufbar: HTTP ${antwort.status}`);
  process.exit(1);
}
const adressen = [...(await antwort.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
console.log(`[indexnow] ${adressen.length} Adressen in der Sitemap`);

// Höchstens 10.000 Adressen je Meldung (IndexNow-Vorgabe)
for (let i = 0; i < adressen.length; i += 10000) {
  const r = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList: adressen.slice(i, i + 10000) }),
  });
  // 200 = angenommen, 202 = angenommen, Schlüsselprüfung läuft noch
  console.log(`[indexnow] Adressen ${i + 1}–${Math.min(i + 10000, adressen.length)}: HTTP ${r.status}`);
  if (r.status !== 200 && r.status !== 202) {
    console.error(await r.text());
    process.exit(1);
  }
}
