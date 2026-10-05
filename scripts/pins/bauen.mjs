/**
 * MotoMatch — Pinterest-Pins aus den Studiobildern (2026-10-04)
 *
 * Für jedes Bike mit freigegebenem Studiobild entsteht ein Pin im Pinterest-Format
 * (1000 × 1500, JPEG) unter public/pins/<slug>.jpg, dazu Upload-Dateien für
 * "Pins gesammelt erstellen" (Pinterest Business → Erstellen → Pins gesammelt erstellen):
 * höchstens 100 Zeilen je CSV, zeitversetzt 12 Pins am Tag. Wer alles auf einmal hochlädt,
 * landet beim Spamfilter; verteilt sieht Pinterest ein aktives Konto.
 *
 * Jeder Pin verlinkt direkt auf die Bike-Seite in der App (?motorrad=<slug>, siehe app.js),
 * mit utm_source=pinterest für die Statistik.
 *
 * Gerendert wird mit Chromium (playwright-core), damit Schrift und Satz wie auf der Seite sind:
 * Ab dem 13.10. übernimmt der RSS-Feed (api/pins-feed.js, /pins/feed/<bauart>.xml): er gibt
 * die Pins aus api/_pins-plan.js zu ihrer Zeit frei, Pinterest holt sie selbst ab. Der Plan
 * behält Reihenfolge und Zeiten schon geplanter Bikes; neue Bikes reihen sich hinten an.
 *
 *   PLAYWRIGHT=/pfad/zu/playwright-core node scripts/pins/bauen.mjs [--start 2026-10-05] [--csv <ordner>] [--nur <slug,…>] [--ohne-bilder]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASIS = "https://motomatch.studio";
const ZIEL = join(WURZEL, "public/pins");
const JE_TAG = 12;
const JE_DATEI = 100;
const UHRZEITEN = ["07:30", "08:45", "10:00", "11:15", "12:30", "13:45", "15:00", "16:15", "17:30", "18:45", "20:00", "21:15"];

const arg = (name, vorgabe) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : vorgabe; };
const morgen = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const START = arg("--start", morgen);
const CSV_ORDNER = arg("--csv", join(WURZEL, "dist-pins"));
const NUR = arg("--nur", "")?.split(",").filter(Boolean);
const OHNE_BILDER = process.argv.includes("--ohne-bilder");
const PLAN = join(WURZEL, "api/_pins-plan.js");
const PER_CSV = 100; // so viele gingen per pinterest-1.csv raus — der Feed lässt sie aus


const katalog = JSON.parse(readFileSync(join(WURZEL, "public/data/katalog-de.json"), "utf8"));
let bikes = katalog.bikes.filter((b) => b.studio && b.freigegeben !== false && existsSync(join(WURZEL, "public", b.studio)));
if (NUR?.length) bikes = bikes.filter((b) => NUR.includes(b.slug));

const SCHRIFT = Object.fromEntries([500, 600, 800].map((w) => [w, `data:font/woff2;base64,${readFileSync(join(WURZEL, `public/fonts/barlow-${w}.woff2`)).toString("base64")}`]));
const schrift = (w) => SCHRIFT[w];
const zahl = (n) => Math.round(n).toLocaleString("de-DE");
const kurzSlug = (b) => b.slug.toLowerCase().replace(/_/g, "-");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const csvFeld = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;

const BOARD = {
  Enduro: "Reiseenduros & Adventure-Bikes",
  Naked: "Naked Bikes",
  Sportbike: "Sportmotorräder",
  Roller: "Motorroller",
  Cruiser: "Cruiser & Chopper",
  Touring: "Tourer & Reisemotorräder",
  Klassiker: "Retro & Klassiker",
  Supermoto: "Supermoto",
};
const BAUART = { Enduro: "Reiseenduro", Naked: "Naked Bike", Sportbike: "Sportler", Roller: "Roller", Cruiser: "Cruiser", Touring: "Tourer", Klassiker: "Klassiker", Supermoto: "Supermoto" };

const fuehrerschein = (b) => (b.license === "A" ? (b.a2 ? "A, als A2 drosselbar" : "Führerschein A") : `Führerschein ${b.license}`);
const jahre = (b) => (b.jahre?.length === 2 && b.jahre[0] !== b.jahre[1] ? `${b.jahre[0]}–${b.jahre[1]}` : b.model || "");
function preis(b) {
  if (b.priceNew) return `neu ab ca. ${zahl(b.priceNew)} €`;
  if (b.priceUsed) return `gebraucht ca. ${zahl(b.priceUsed)} €`;
  if (b.price) return `ca. ${zahl(b.price)} €`;
  return "";
}
function fakten(b) {
  return [
    b.ps && `${b.ps} PS`,
    b.seat_height && `${String(b.seat_height).replace(".0", "").replace(".", ",")} cm Sitzhöhe`,
    b.weight && `${b.weight} kg`,
    b.license && fuehrerschein(b),
  ].filter(Boolean);
}

/** Pinterest durchsucht Titel und Beschreibung wie eine Suchmaschine — echte Daten statt Floskeln. */
function texte(b) {
  const f = [];
  if (b.ps) f.push(`${b.ps} PS`);
  if (b.cc) f.push(`${zahl(b.cc)} ccm`);
  if (b.seat_height) f.push(`${String(b.seat_height).replace(".0", "").replace(".", ",")} cm Sitzhöhe`);
  if (b.weight) f.push(`${b.weight} kg`);
  const p = preis(b);
  const titel = `${b.name} – ${BAUART[b.style] || "Motorrad"}${b.license ? `, ${fuehrerschein(b)}` : ""}`.slice(0, 100);
  const beschr = [
    `${b.name}${jahre(b) ? ` (${jahre(b)})` : ""}: ${f.join(", ")}.`,
    b.license ? `${fuehrerschein(b)}${b.beginner ? ", gut für Einsteiger" : ""}.` : "",
    p ? `Preis: ${p}.` : "",
    "Passt sie zu dir? Das kostenlose Motorrad-Quiz von MotoMatch vergleicht über 1.000 Modelle nach Führerschein, Budget und Körpergröße.",
  ].filter(Boolean).join(" ").slice(0, 500);
  const stichworte = [b.brand, b.name, BAUART[b.style], "Motorrad", b.license && `Führerschein ${b.license}`, b.a2 || b.license === "A2" ? "A2 Motorrad" : null, b.beginner ? "Einsteiger Motorrad" : null]
    .filter(Boolean).join(", ");
  return { titel, beschr, stichworte };
}

function html(b) {
  // Als data:-URL: eine Seite aus setContent darf keine file://-Adressen laden
  const bild = `data:image/webp;base64,${readFileSync(join(WURZEL, "public", b.studio)).toString("base64")}`;
  const name = b.name.length > 22 ? "lang" : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:B;font-weight:500;src:url(${schrift(500)})}
  @font-face{font-family:B;font-weight:600;src:url(${schrift(600)})}
  @font-face{font-family:B;font-weight:800;src:url(${schrift(800)})}
  *{margin:0;box-sizing:border-box}
  body{width:1000px;height:1500px;background:#0d0d0e;font-family:B,sans-serif;color:#fff;overflow:hidden;position:relative}
  .kopf{position:absolute;top:54px;left:64px;right:64px;display:flex;justify-content:space-between;align-items:center;z-index:3}
  .marke{font-weight:800;font-size:30px;letter-spacing:.32em}
  .art{font-weight:600;font-size:22px;letter-spacing:.14em;text-transform:uppercase;padding:10px 20px;border:1.5px solid rgba(255,255,255,.35);border-radius:99px;color:rgba(255,255,255,.85)}
  .bild{position:absolute;top:175px;left:-70px;width:1140px;height:855px;background:url("${bild}") center/cover;z-index:2;
    -webkit-mask-image:linear-gradient(#0000 0,#000 14%,#000 80%,#0000 100%),linear-gradient(90deg,#0000 0,#000 16%,#000 84%,#0000 100%);-webkit-mask-composite:source-in}
  .text{position:absolute;left:64px;right:64px;top:1030px;z-index:3}
  h1{font-weight:800;font-size:${name ? 70 : 88}px;line-height:.98;letter-spacing:-.015em}
  .preis{margin-top:16px;font-weight:500;font-size:32px;color:rgba(255,255,255,.72)}
  .fakten{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}
  .fakten span{font-weight:600;font-size:25px;padding:11px 20px;border-radius:14px;background:rgba(255,255,255,.1)}
  .los{position:absolute;left:64px;right:64px;bottom:58px;height:96px;border-radius:99px;background:#fff;color:#0d0d0e;display:flex;align-items:center;justify-content:center;gap:16px;font-weight:800;font-size:34px;z-index:3}
  .los em{font-style:normal;font-weight:500;color:#555}
  </style></head><body>
  <div class="kopf"><span class="marke">MOTOMATCH</span><span class="art">${esc(BAUART[b.style] || b.style || "")}</span></div>
  <div class="bild"></div>
  <div class="text"><h1>${esc(b.name)}</h1><div class="preis">${esc([jahre(b), preis(b)].filter(Boolean).join(" · "))}</div>
  <div class="fakten">${fakten(b).map((f) => `<span>${esc(f)}</span>`).join("")}</div></div>
  <div class="los">Passt sie zu dir? <em>motomatch.studio</em></div>
  </body></html>`;
}

/** Beliebte zuerst, Bauarten abwechselnd — sonst kämen 30 Enduros am Stück. */
function reihenfolge(liste) {
  const nachArt = {};
  for (const b of [...liste].sort((x, y) => (y.pop || 0) - (x.pop || 0))) (nachArt[b.style] ??= []).push(b);
  const aus = [];
  const toepfe = Object.values(nachArt).sort((a, c) => c.length - a.length);
  while (toepfe.some((t) => t.length)) for (const t of toepfe) if (t.length) aus.push(t.shift());
  return aus;
}

mkdirSync(ZIEL, { recursive: true });
mkdirSync(CSV_ORDNER, { recursive: true });
// Bisheriger Plan zuerst, neue Bikes dahinter — sonst verschöben sich schon geplante Pins
let alterPlan = [];
if (existsSync(PLAN) && !NUR?.length) alterPlan = (await import(`${PLAN}?${Date.now()}`)).default;
const bekannt = new Map(bikes.map((b) => [kurzSlug(b), b]));
const sortiert = [
  ...alterPlan.map((e) => bekannt.get(e.s)).filter(Boolean),
  ...reihenfolge(bikes.filter((b) => !alterPlan.some((e) => e.s === kurzSlug(b)))),
];
let n = 0;
const { chromium } = OHNE_BILDER ? {} : await import(process.env.PLAYWRIGHT || "playwright-core");
const browser = OHNE_BILDER ? null : await chromium.launch();
const seite = await browser?.newPage({ viewport: { width: 1000, height: 1500 } });
for (const b of OHNE_BILDER ? [] : sortiert) {
  await seite.setContent(html(b), { waitUntil: "load" });
  await seite.evaluate(() => document.fonts.ready);
  await seite.screenshot({ path: join(ZIEL, `${kurzSlug(b)}.jpg`), type: "jpeg", quality: 84 });
  if (++n % 50 === 0) console.log(`[pins] ${n}/${sortiert.length}`);
}
await browser?.close();

// Upload-Dateien (Spalten wie in Pinterests Vorlage)
const KOPF = ["Title", "Media URL", "Pinterest board", "Thumbnail", "Description", "Link", "Publish date", "Keywords"];
const tag0 = new Date(`${START}T00:00:00`);
const zeilen = sortiert.map((b, i) => {
  const t = texte(b);
  const d = new Date(tag0.getTime() + Math.floor(i / JE_TAG) * 864e5);
  const datum = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${UHRZEITEN[i % JE_TAG]}:00`;
  const link = `${BASIS}/?motorrad=${kurzSlug(b)}&utm_source=pinterest&utm_medium=pin&utm_campaign=bikes`;
  return [t.titel, `${BASIS}/pins/${kurzSlug(b)}.jpg`, BOARD[b.style] || "Motorräder", "", t.beschr, link, datum, t.stichworte];
});
for (let i = 0; i * JE_DATEI < zeilen.length; i++) {
  const teil = zeilen.slice(i * JE_DATEI, (i + 1) * JE_DATEI);
  const datei = join(CSV_ORDNER, `pinterest-${i + 1}.csv`);
  writeFileSync(datei, [KOPF, ...teil].map((z) => z.map(csvFeld).join(",")).join("\n") + "\n");
  console.log(`[pins] ${datei}: ${teil.length} Pins, ${teil[0][6].slice(0, 10)} bis ${teil.at(-1)[6].slice(0, 10)}`);
}

// Plan für den Feed: gleiche Reihenfolge, gleiche Zeiten wie die CSV-Zeilen
if (!NUR?.length) {
  const plan = sortiert.map((b, i) => {
    const t = texte(b);
    return { s: kurzSlug(b), art: b.style, t: t.titel, d: t.beschr, ab: new Date(zeilen[i][6]).getTime(), csv: i < PER_CSV };
  });
  // Pinterest nimmt beim Verknüpfen keinen leeren Feed: je Bauart ist der erste Feed-Pin
  // schon ab Planbeginn frei (bleibt beim Neubau so, weil alte Einträge ihre Zeit behalten)
  for (const e of alterPlan) { const p = plan.find((x) => x.s === e.s); if (p) p.ab = e.ab; }
  for (const art of new Set(plan.map((e) => e.art))) {
    const erster = plan.find((e) => e.art === art && !e.csv);
    if (erster && !alterPlan.length) erster.ab = new Date(`${START}T00:00:00`).getTime() - 864e5;
  }
  writeFileSync(PLAN, `// Erzeugt von scripts/pins/bauen.mjs — nicht von Hand ändern.\n// s = Slug, art = Bauart, t = Titel, d = Beschreibung, ab = Freigabe (ms), csv = schon per CSV hochgeladen\nexport default ${JSON.stringify(plan)};\n`);
  console.log(`[pins] Plan: ${plan.length} Einträge, davon ${plan.filter((e) => !e.csv).length} für den Feed`);
}
console.log(`[pins] fertig: ${n} Bilder in public/pins/`);
