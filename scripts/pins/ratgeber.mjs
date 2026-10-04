/**
 * MotoMatch — Pinterest-Pins für die Ratgeber-Artikel (2026-10-05)
 *
 * Liest dist/ratgeber/pins.json (schreibt scripts/seo-seiten.mjs beim Build), rendert je Artikel
 * einen Pin (1000 × 1500) nach public/pins/ratgeber/<slug>.jpg und schreibt den Freigabeplan
 * api/_ratgeber-pins.js für den Feed /pins/feed/ratgeber.xml: ein Artikel pro Tag, der erste sofort.
 * Schon geplante Artikel behalten ihre Zeit, neue reihen sich hinten an.
 *
 *   npm run build && PLAYWRIGHT=/pfad/zu/playwright-core node scripts/pins/ratgeber.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "../..");
const QUELLE = join(WURZEL, "dist/ratgeber/pins.json");
const ZIEL = join(WURZEL, "public/pins/ratgeber");
const PLAN = join(WURZEL, "api/_ratgeber-pins.js");
const TAG = 864e5;

if (!existsSync(QUELLE)) {
  console.error("[ratgeber-pins] dist/ratgeber/pins.json fehlt — erst `npm run build`.");
  process.exit(1);
}
const artikel = JSON.parse(readFileSync(QUELLE, "utf8"));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const daten = (p, typ) => `data:${typ};base64,${readFileSync(p).toString("base64")}`;
const schrift = Object.fromEntries([500, 600, 800].map((w) => [w, daten(join(WURZEL, `public/fonts/barlow-${w}.woff2`), "font/woff2")]));

function html(a) {
  const bild = a.bild ? daten(join(WURZEL, "public", a.bild), "image/webp") : null;
  // Kurzer Titel fürs Bild: der Teil vor dem Doppelpunkt/Gedankenstrich, sonst die Überschrift
  const teile = a.h1.split(/ — |: /);
  const titel = teile[0].length >= 12 ? teile[0] : a.h1;
  const unter = titel === a.h1 ? "" : teile.slice(1).join(": ");
  const fakten = a.fakten.slice(0, 3);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:B;font-weight:500;src:url(${schrift[500]})}
  @font-face{font-family:B;font-weight:600;src:url(${schrift[600]})}
  @font-face{font-family:B;font-weight:800;src:url(${schrift[800]})}
  *{margin:0;box-sizing:border-box}
  body{width:1000px;height:1500px;background:#0d0d0e;font-family:B,sans-serif;color:#fff;overflow:hidden;position:relative}
  .kopf{position:absolute;top:54px;left:64px;right:64px;display:flex;justify-content:space-between;align-items:center}
  .marke{font-weight:800;font-size:30px;letter-spacing:.32em}
  .art{font-weight:600;font-size:22px;letter-spacing:.14em;text-transform:uppercase;padding:10px 20px;border:1.5px solid rgba(255,255,255,.35);border-radius:99px;color:rgba(255,255,255,.85)}
  .oben{position:absolute;top:150px;left:64px;right:64px}
  h1{font-weight:800;font-size:${titel.length > 40 ? 72 : 88}px;line-height:1.02;letter-spacing:-.015em}
  .oben p{margin-top:22px;font-weight:500;font-size:38px;line-height:1.25;color:rgba(255,255,255,.72)}
  .bild{position:absolute;top:470px;left:-60px;width:1120px;height:620px;background:${bild ? `url("${bild}") center/cover` : "none"};
    -webkit-mask-image:linear-gradient(#0000 0,#000 16%,#000 80%,#0000 100%),linear-gradient(90deg,#0000 0,#000 14%,#000 86%,#0000 100%);-webkit-mask-composite:source-in}
  .fakten{position:absolute;left:64px;right:64px;top:1080px;display:grid;grid-template-columns:repeat(${fakten.length},1fr);gap:12px}
  .fakten div{background:rgba(255,255,255,.08);border-radius:18px;padding:18px 20px}
  .fakten strong{display:block;font-weight:800;font-size:38px;line-height:1.05}
  .fakten span{display:block;margin-top:6px;font-weight:500;font-size:20px;color:rgba(255,255,255,.7);line-height:1.2}
  .los{position:absolute;left:64px;right:64px;bottom:58px;height:96px;border-radius:99px;background:#fff;color:#0d0d0e;display:flex;align-items:center;justify-content:center;gap:16px;font-weight:800;font-size:34px}
  .los em{font-style:normal;font-weight:500;color:#555}
  </style></head><body>
  <div class="kopf"><span class="marke">MOTOMATCH</span><span class="art">Ratgeber</span></div>
  <div class="oben"><h1>${esc(titel)}</h1>${unter ? `<p>${esc(unter[0].toUpperCase() + unter.slice(1))}</p>` : ""}</div>
  <div class="bild"></div>
  ${fakten.length ? `<div class="fakten">${fakten.map(([z, t]) => `<div><strong>${esc(z)}</strong><span>${esc(t)}</span></div>`).join("")}</div>` : ""}
  <div class="los">Jetzt lesen <em>motomatch.studio</em></div>
  </body></html>`;
}

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright-core");
mkdirSync(ZIEL, { recursive: true });
const browser = await chromium.launch();
const seite = await browser.newPage({ viewport: { width: 1000, height: 1500 } });
for (const a of artikel) {
  await seite.setContent(html(a), { waitUntil: "load" });
  await seite.evaluate(() => document.fonts.ready);
  await seite.screenshot({ path: join(ZIEL, `${a.slug}.jpg`), type: "jpeg", quality: 82 });
}
await browser.close();

// Freigabeplan: bestehende Zeiten behalten, neue Artikel je einen Tag später
let alt = [];
if (existsSync(PLAN)) alt = (await import(`${PLAN}?${Date.now()}`)).default;
const bekannt = new Map(alt.map((e) => [e.s, e.ab]));
let naechste = Math.max(Date.now() - 60e3, ...alt.map((e) => e.ab + TAG));
const plan = artikel.map((a) => {
  let ab = bekannt.get(a.slug);
  if (ab == null) { ab = naechste; naechste += TAG; }
  return { s: a.slug, t: a.titel.slice(0, 100), d: a.beschreibung.slice(0, 500), ab };
});
writeFileSync(PLAN, `// Erzeugt von scripts/pins/ratgeber.mjs — nicht von Hand ändern.\n// s = Artikel-Slug, t = Titel, d = Beschreibung, ab = Freigabe (ms)\nexport default ${JSON.stringify(plan)};\n`);
console.log(`[ratgeber-pins] ${artikel.length} Pins in public/pins/ratgeber/, Plan: erster ${new Date(Math.min(...plan.map((e) => e.ab))).toISOString().slice(0, 10)}, letzter ${new Date(Math.max(...plan.map((e) => e.ab))).toISOString().slice(0, 10)}`);
