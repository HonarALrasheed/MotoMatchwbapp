/**
 * MotoMatch — feste Seiten für Suchmaschinen (2026-09-30)
 *
 * Die App läuft komplett unter einer Adresse (siehe nav.js). Für Google gibt es damit genau eine
 * Seite, und die ist ohne JavaScript leer. Dieses Skript erzeugt nach `vite build` aus dem Katalog
 * (public/data/katalog-de.json) statische HTML-Seiten in dist/:
 *
 *   /motorrad/<slug>/        eine Seite je Bike: Preis, Technik, Führerschein, ähnliche Modelle
 *   /motorraeder/            Übersicht aller Themenseiten
 *   /motorraeder/<thema>/    Führerschein, Bauart, Budget, Einsteiger, Sitzhöhe, Marke …
 *   /sitemap.xml             alle Adressen (ersetzt die Fassung aus public/)
 *
 * Jede Seite trägt echte Katalogdaten und führt ins Quiz. Das ist Absicht: Seiten, die nur
 * Suchbegriffe wiederholen, stuft Google als Spam ein ("doorway pages") — Seiten mit Daten, die
 * sonst niemand so zusammenstellt, nicht.
 *
 *     node tools/seo-seiten.mjs            (läuft automatisch in `npm run build`)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setCatalog, findSimilarBikes } from "../src/js/matching.js";
import { bikeBild, hatFoto } from "../src/js/bike-bild.js";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(WURZEL, "dist");
const BASIS = "https://motomatch.studio";
const MAX_LISTE = 120; // Karten je Themenseite; die Kennzahlen rechnen trotzdem mit allen

if (!existsSync(DIST)) {
  console.error("[seo] dist/ fehlt — erst `vite build` laufen lassen.");
  process.exit(1);
}

const katalog = JSON.parse(readFileSync(join(WURZEL, "public/data/katalog-de.json"), "utf8"));
const bikes = katalog.bikes;
setCatalog(bikes);
const STAND = katalog.stand || "";

// ── Helfer ─────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const zahl = (n) => Math.round(n).toLocaleString("de-DE");
/* Kommazahl deutsch: 76.1 → "76,1" (Sitzhöhe, Tank, Verbrauch) */
const dez = (n) => String(n).replace(".", ",");
const url = (pfad) => BASIS + pfad;
const slugify = (s) =>
  String(s).toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* Wie preisText() in matching.js: price=1 ist der Platzhalter der Katalogpipeline für "kein echter
   Preis" und darf nie als "ca. 1 €" erscheinen. */
function preis(b) {
  if (b.price > 1) return b.price;
  if (b.priceNew && b.priceUsed) return (b.priceNew + b.priceUsed) / 2;
  return b.priceUsed || b.priceNew || null;
}
const preisText = (b) => (preis(b) ? `ca. ${zahl(preis(b))} €` : "Preis folgt");

const darfA2 = (b) => b.license === "A1" || b.license === "A2" || b.a2 === true;
const klasseText = (b) =>
  b.license === "A" ? (b.a2 ? "A (auf A2 drosselbar)" : "A") : b.license;

/* Faustregel aus dem Matching-Wachhund (tools/matching-wachhund.mjs): sicher ist eine Sitzhöhe bis
   etwa 45 % der Körpergröße, plus 3 %. Umgekehrt: ab welcher Größe kommt man gut auf den Boden? */
const abGroesse = (sitz) => Math.round(sitz / (0.45 * 1.03));

const bikePfad = new Map();
for (const b of bikes) {
  let p = `/motorrad/${b.slug.replace(/_/g, "-")}/`;
  while ([...bikePfad.values()].includes(p)) p = p.replace(/\/$/, "-2/");
  bikePfad.set(b, p);
}

const STIL = {
  Sportbike: { slug: "sportmotorrad", mehrzahl: "Sportmotorräder", einzahl: "Sportmotorrad" },
  Naked: { slug: "naked-bike", mehrzahl: "Naked Bikes", einzahl: "Naked Bike" },
  Cruiser: { slug: "cruiser", mehrzahl: "Cruiser", einzahl: "Cruiser" },
  Enduro: { slug: "enduro", mehrzahl: "Enduros & Reiseenduros", einzahl: "Enduro" },
  Touring: { slug: "tourer", mehrzahl: "Tourer", einzahl: "Tourer" },
  Klassiker: { slug: "retro-klassiker", mehrzahl: "Retro-Bikes & Klassiker", einzahl: "Retro-Bike" },
  Supermoto: { slug: "supermoto", mehrzahl: "Supermotos", einzahl: "Supermoto" },
  Roller: { slug: "motorroller", mehrzahl: "Motorroller", einzahl: "Motorroller" },
};
const EINSATZ = { Touring: "lange Touren", Gelande: "Gelände", Pendeln: "Pendeln", Sport: "sportliches Fahren", Rennstrecke: "Rennstrecke", Cruisen: "Cruisen" };

// ── Themenseiten ───────────────────────────────────────────────────────────

const themen = [];
const thema = (t) => { if (t.liste.length >= (t.min ?? 6)) themen.push(t); };
const hat = (f) => bikes.filter(f);

thema({ slug: "fuehrerschein-a1", gruppe: "Führerschein",
  h1: "Motorräder für den A1-Führerschein",
  titel: "A1 Motorrad: alle 125er mit Preis & Daten",
  intro: "Mit dem A1-Führerschein (ab 16) fährst du Motorräder bis 125 ccm und 11 kW (15 PS).",
  liste: hat((b) => b.license === "A1") });
thema({ slug: "fuehrerschein-b196", gruppe: "Führerschein",
  h1: "125er für den Autoführerschein (B196)",
  titel: "B196 Motorrad: 125er mit Autoführerschein – Modelle & Preise",
  intro: "Mit der Schlüsselzahl B196 darfst du mit dem Autoführerschein Leichtkrafträder fahren — dieselben 125er wie mit A1 (bis 125 ccm und 11 kW). Voraussetzung: mindestens 25 Jahre alt und fünf Jahre Klasse B.",
  liste: hat((b) => b.license === "A1") });
thema({ slug: "fuehrerschein-a2", gruppe: "Führerschein",
  h1: "Motorräder für den A2-Führerschein",
  titel: "A2 Motorrad: alle A2-tauglichen Modelle mit Preis",
  intro: "Mit A2 (ab 18) fährst du Motorräder bis 35 kW (48 PS). Dazu zählen auch stärkere Modelle, die sich auf 35 kW drosseln lassen — sofern die ungedrosselte Leistung höchstens 70 kW beträgt.",
  liste: hat(darfA2) });
thema({ slug: "fuehrerschein-a", gruppe: "Führerschein",
  h1: "Motorräder für den offenen A-Führerschein",
  titel: "Führerschein A: Motorräder ohne Leistungsgrenze",
  intro: "Diese Modelle brauchen den unbeschränkten Führerschein A (ab 24, oder ab 20 nach zwei Jahren A2).",
  liste: hat((b) => b.license === "A") });
thema({ slug: "einsteiger", gruppe: "Für wen",
  h1: "Motorräder für Anfänger und Einsteiger",
  titel: "Anfänger-Motorrad: die besten Einsteiger-Bikes",
  intro: "Handlich, gutmütig, nicht zu schwer: Diese Modelle eignen sich für den Einstieg — auch für Wiedereinsteiger nach langer Pause.",
  liste: hat((b) => b.beginner) });
thema({ slug: "niedrige-sitzhoehe", gruppe: "Für wen",
  h1: "Motorräder mit niedriger Sitzhöhe",
  titel: "Motorrad mit niedriger Sitzhöhe: Modelle bis 78 cm",
  intro: "Sitzhöhe bis 78 cm — für kleinere Fahrerinnen und Fahrer, die mit beiden Füßen sicher auf den Boden kommen wollen.",
  liste: hat((b) => b.seat_height > 0 && b.seat_height <= 78) });
thema({ slug: "leichte-motorraeder", gruppe: "Für wen",
  h1: "Leichte Motorräder bis 180 kg",
  titel: "Leichtes Motorrad: Modelle bis 180 kg fahrfertig",
  intro: "Wenig Gewicht heißt: leichter rangieren, leichter aufheben, weniger Respekt beim Wenden. Alle Modelle hier wiegen höchstens 180 kg.",
  liste: hat((b) => b.weight > 0 && b.weight <= 180) });

for (const [stil, s] of Object.entries(STIL)) {
  thema({ slug: s.slug, gruppe: "Bauart", h1: s.mehrzahl, stil,
    titel: `${s.mehrzahl}: alle Modelle mit Preis & Führerschein`,
    intro: `Alle ${s.mehrzahl} im deutschen Markt — mit Gebrauchtpreis, Leistung und passendem Führerschein.`,
    liste: hat((b) => b.style === stil) });
  thema({ slug: `${s.slug}-a2`, gruppe: "Bauart × Führerschein", h1: `${s.mehrzahl} für den A2-Führerschein`,
    titel: `${s.einzahl} A2: A2-taugliche ${s.mehrzahl} mit Preis`,
    intro: `${s.mehrzahl}, die du mit A2 fahren darfst — offen oder auf 35 kW gedrosselt.`,
    liste: hat((b) => b.style === stil && darfA2(b)) });
  thema({ slug: `${s.slug}-125`, gruppe: "Bauart × Führerschein", h1: `${s.mehrzahl} mit 125 ccm (A1/B196)`,
    titel: `${s.einzahl} 125 ccm: für A1 und B196`,
    intro: `${s.mehrzahl} bis 125 ccm — für den A1-Führerschein und für B196 mit dem Autoführerschein.`,
    liste: hat((b) => b.style === stil && b.license === "A1") });
}

for (const grenze of [2000, 3000, 5000, 8000, 10000, 15000]) {
  thema({ slug: `unter-${grenze}-euro`, gruppe: "Budget", h1: `Motorräder unter ${zahl(grenze)} €`,
    titel: `Motorrad unter ${zahl(grenze)} Euro: gebrauchte Modelle mit Preis`,
    intro: `Diese Modelle bekommst du gebraucht für bis zu ${zahl(grenze)} € (mittlerer Marktpreis).`,
    liste: hat((b) => preis(b) && preis(b) <= grenze) });
  if (grenze <= 8000) {
    thema({ slug: `a2-unter-${grenze}-euro`, gruppe: "Budget", h1: `A2-Motorräder unter ${zahl(grenze)} €`,
      titel: `A2 Motorrad unter ${zahl(grenze)} Euro`,
      intro: `A2-taugliche Motorräder, die gebraucht höchstens ${zahl(grenze)} € kosten.`,
      liste: hat((b) => darfA2(b) && preis(b) && preis(b) <= grenze) });
  }
}

const marken = [...new Set(bikes.map((b) => b.brand))].sort((a, b) => a.localeCompare(b, "de"));
for (const marke of marken) {
  thema({ slug: `marke-${slugify(marke)}`, gruppe: "Marke", min: 3, marke,
    h1: `${marke} Motorräder`,
    titel: `${marke} Motorräder: alle Modelle mit Preis & Daten`,
    intro: `Alle ${marke}-Modelle in unserem Katalog des deutschen Markts — mit Gebrauchtpreis, Leistung und Führerscheinklasse.`,
    liste: hat((b) => b.brand === marke) });
}
for (const t of themen) {
  t.pfad = `/motorraeder/${t.slug}/`;
  t.liste.sort((a, b) => (b.pop || 0) - (a.pop || 0));
}
const themaPfad = (slug) => themen.find((t) => t.slug === slug)?.pfad;

// ── Bausteine ──────────────────────────────────────────────────────────────

function kopf({ titel, beschreibung, pfad, bild, krumen }) {
  const og = bild ? url(bild) : url("/bikes/sportbikes_trio.webp");
  const ld = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: krumen.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: url(p) })),
  };
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(titel)} | MotoMatch</title>
  <meta name="description" content="${esc(beschreibung)}" />
  <link rel="canonical" href="${url(pfad)}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta name="theme-color" content="#0a0a0a" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="MotoMatch" />
  <meta property="og:locale" content="de_DE" />
  <meta property="og:url" content="${url(pfad)}" />
  <meta property="og:title" content="${esc(titel)}" />
  <meta property="og:description" content="${esc(beschreibung)}" />
  <meta property="og:image" content="${og}" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="stylesheet" href="/seo.css" />
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
  <header class="kopf">
    <a class="logo" href="/">MOTOMATCH</a>
    <nav><a href="/motorraeder/">Motorräder</a><a class="knopf klein" href="/">Quiz starten</a></nav>
  </header>
  <nav class="krumen" aria-label="Brotkrumen">${krumen.map(([n, p], i) =>
    i === krumen.length - 1 ? `<span>${esc(n)}</span>` : `<a href="${p}">${esc(n)}</a>`).join(" › ")}</nav>
  <main>`;
}

const fuss = () => `
    <section class="cta">
      <h2>Welches Motorrad passt zu dir?</h2>
      <p>Acht Fragen zu Führerschein, Budget, Körpergröße und Fahrstil — MotoMatch sucht aus über 1.000 Modellen das passende Bike.</p>
      <a class="knopf" href="/">Quiz starten</a>
    </section>
  </main>
  <footer class="fuss">
    <p>Preise: mittlere Marktpreise gebraucht${STAND ? `, Stand ${esc(STAND)}` : ""}. Alle Angaben ohne Gewähr.</p>
    <p><a href="/motorraeder/">Alle Themen</a> · <a href="/impressum.html">Impressum</a> · <a href="/datenschutz.html">Datenschutz</a> · <a href="/agb.html">AGB</a></p>
  </footer>
</body>
</html>
`;

function karte(b) {
  const info = [klasseText(b), b.ps ? `${b.ps} PS` : null, b.cc ? `${b.cc} ccm` : null].filter(Boolean).join(" · ");
  return `<li class="karte"><a href="${bikePfad.get(b)}">
      <img src="${esc(bikeBild(b, "kachel"))}" alt="${esc(b.name)}" loading="lazy" decoding="async" width="420" height="300" />
      <strong>${esc(b.name)}</strong><span class="preis">${preisText(b)}</span><span class="info">${esc(info)}</span>
    </a></li>`;
}

function kennzahlen(liste) {
  const mitPreis = liste.filter((b) => preis(b)).sort((a, b) => preis(a) - preis(b));
  const teile = [`<strong>${liste.length}</strong> Modelle`];
  if (mitPreis.length) {
    const mitte = preis(mitPreis[Math.floor(mitPreis.length / 2)]);
    teile.push(`günstigstes: <a href="${bikePfad.get(mitPreis[0])}">${esc(mitPreis[0].name)}</a> (${preisText(mitPreis[0])})`);
    teile.push(`typischer Preis: ca. ${zahl(mitte)} €`);
  }
  const leicht = liste.filter((b) => b.weight > 0).sort((a, b) => a.weight - b.weight)[0];
  if (leicht) teile.push(`leichtestes: <a href="${bikePfad.get(leicht)}">${esc(leicht.name)}</a> (${leicht.weight} kg)`);
  const tief = liste.filter((b) => b.seat_height > 0).sort((a, b) => a.seat_height - b.seat_height)[0];
  if (tief) teile.push(`niedrigste Sitzhöhe: <a href="${bikePfad.get(tief)}">${esc(tief.name)}</a> (${dez(tief.seat_height)} cm)`);
  return `<p class="kennzahlen">${teile.join(" · ")}</p>`;
}

function schreibe(pfad, html) {
  const ziel = join(DIST, pfad, "index.html");
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(ziel, html);
}

// ── Seiten schreiben ───────────────────────────────────────────────────────

for (const t of themen) {
  const krumen = [["Start", "/"], ["Motorräder", "/motorraeder/"], [t.h1, t.pfad]];
  const verwandt = themen.filter((x) => x !== t && x.gruppe === t.gruppe).slice(0, 12);
  const beschreibung = `${t.intro} ${t.liste.length} Modelle mit Gebrauchtpreis, PS und Führerscheinklasse.`.slice(0, 300);
  schreibe(t.pfad, kopf({ titel: t.titel, beschreibung, pfad: t.pfad, krumen, bild: hatFoto(t.liste[0]) ? bikeBild(t.liste[0], "titel") : null }) + `
    <h1>${esc(t.h1)}</h1>
    <p class="intro">${esc(t.intro)}</p>
    ${kennzahlen(t.liste)}
    <ul class="raster">${t.liste.slice(0, MAX_LISTE).map(karte).join("")}</ul>
    ${t.liste.length > MAX_LISTE ? `<p class="hinweis">Gezeigt: die ${MAX_LISTE} gefragtesten von ${t.liste.length} Modellen. Das Quiz durchsucht alle.</p>` : ""}
    ${verwandt.length ? `<section><h2>Ähnliche Themen</h2><ul class="themen">${verwandt.map((x) => `<li><a href="${x.pfad}">${esc(x.h1)}</a></li>`).join("")}</ul></section>` : ""}
` + fuss());
}

const gruppen = [...new Set(themen.map((t) => t.gruppe))];
schreibe("/motorraeder/", kopf({
  titel: "Motorräder nach Führerschein, Bauart und Budget",
  beschreibung: `Motorrad finden: ${bikes.length} Modelle aus dem deutschen Markt, sortiert nach Führerschein (A1, A2, A, B196), Bauart, Budget und Marke — mit Gebrauchtpreis und Daten.`,
  pfad: "/motorraeder/", krumen: [["Start", "/"], ["Motorräder", "/motorraeder/"]] }) + `
    <h1>Motorräder nach Führerschein, Bauart und Budget</h1>
    <p class="intro">${bikes.length} Modelle aus dem deutschen Markt, jedes mit Gebrauchtpreis, Leistung und Führerscheinklasse. Wähle ein Thema — oder lass dir im Quiz das passende Bike zeigen.</p>
    ${gruppen.map((g) => `<section><h2>${esc(g)}</h2><ul class="themen">${themen.filter((t) => t.gruppe === g)
      .map((t) => `<li><a href="${t.pfad}">${esc(t.h1)}</a> <span>${t.liste.length}</span></li>`).join("")}</ul></section>`).join("")}
` + fuss());

for (const b of bikes) {
  const pfad = bikePfad.get(b);
  const s = STIL[b.style];
  const stilThema = s && themaPfad(s.slug);
  const markeThema = themaPfad(`marke-${slugify(b.brand)}`);
  const klasseThema = b.license === "A1" ? themaPfad("fuehrerschein-a1") : darfA2(b) ? themaPfad("fuehrerschein-a2") : themaPfad("fuehrerschein-a");
  const krumen = [["Start", "/"], ["Motorräder", "/motorraeder/"]];
  if (markeThema) krumen.push([`${b.brand}`, markeThema]);
  krumen.push([b.name, pfad]);

  const fakten = [
    ["Führerschein", klasseText(b)], ["Bauart", s?.einzahl || b.style], ["Leistung", b.ps ? `${b.ps} PS (${b.kw} kW)` : null],
    ["Hubraum", b.cc ? `${zahl(b.cc)} ccm` : null], ["Drehmoment", b.torque ? `${b.torque} Nm` : null],
    ["Motor", [b.zylinder && !/zylinder/i.test(b.bauart || "") ? `${b.zylinder} Zylinder` : null, b.bauart].filter(Boolean).join(", ") || null],
    ["Gewicht", b.weight ? `${b.weight} kg` : null], ["Sitzhöhe", b.seat_height ? `${dez(b.seat_height)} cm` : null],
    ["Tank", b.tank ? `${dez(b.tank)} l` : null], ["Verbrauch", b.verbrauch ? `${dez(b.verbrauch)} l/100 km` : null],
    ["Höchstgeschwindigkeit", b.topSpeed ? `${b.topSpeed} km/h` : null], ["Getriebe", b.gear], ["Antrieb", b.antrieb],
    ["Baujahre", Array.isArray(b.jahre) && b.jahre.length ? `${b.jahre[0]}–${b.jahre.at(-1)}` : null],
  ].filter(([, v]) => v);

  const fuerWen = [];
  if (b.license === "A1") fuerWen.push("Fahrbar mit A1 (ab 16) und mit B196 über den Autoführerschein.");
  else if (b.license === "A2") fuerWen.push("Fahrbar mit dem A2-Führerschein, ohne Drosselung.");
  else if (b.a2) fuerWen.push("Mit A2 fahrbar, wenn sie auf 35 kW gedrosselt ist; offen braucht sie Klasse A.");
  else fuerWen.push("Braucht den offenen Führerschein A — für A2 ist sie zu stark.");
  fuerWen.push(b.beginner ? "Gilt als einsteigerfreundlich." : "Eher etwas für Fahrerinnen und Fahrer mit Erfahrung.");
  if (b.seat_height) fuerWen.push(`Bei ${dez(b.seat_height)} cm Sitzhöhe kommst du als Faustregel ab etwa ${abGroesse(b.seat_height)} cm Körpergröße sicher auf den Boden.`);
  if (b.weight) fuerWen.push(b.weight <= 180 ? `Mit ${b.weight} kg leicht zu rangieren.` : b.weight >= 250 ? `Mit ${b.weight} kg ein schweres Motorrad — beim Rangieren merkt man das.` : `Mit ${b.weight} kg im mittleren Gewichtsbereich.`);
  const einsatz = (b.uses || []).map((u) => EINSATZ[u] || u).filter(Boolean);
  if (einsatz.length) fuerWen.push(`Stark bei: ${einsatz.join(", ")}.`);

  const jahre = b.priceYears ? Object.entries(b.priceYears).filter(([, v]) => v > 1).sort(([a], [c]) => a - c) : [];
  const aehnlich = findSimilarBikes(b, 6).map((r) => r.bike).filter((x) => bikePfad.has(x));
  const beschreibung = `${b.name}: ${s?.einzahl || b.style}${b.ps ? ` mit ${b.ps} PS` : ""}${b.cc ? ` und ${zahl(b.cc)} ccm` : ""}. Gebraucht ${preisText(b)}, Führerschein ${klasseText(b)}${b.seat_height ? `, Sitzhöhe ${dez(b.seat_height)} cm` : ""}. Technische Daten, Preise nach Baujahr und ähnliche Modelle.`;

  schreibe(pfad, kopf({ titel: `${b.name} – Preis, technische Daten & Führerschein`, beschreibung, pfad, krumen, bild: hatFoto(b) ? bikeBild(b, "titel") : null }) + `
    <article class="bike">
      <h1>${esc(b.name)}</h1>
      <figure><img src="${esc(bikeBild(b, "titel"))}" alt="${esc(b.name)}" width="1600" height="437" />${hatFoto(b) ? "" : "<figcaption>Foto folgt</figcaption>"}</figure>
      <p class="preis gross">${preisText(b)}${b.priceYear && preis(b) ? ` <span>gebraucht, Baujahr ${b.priceYear}</span>` : ""}</p>
      <section><h2>Passt die ${esc(b.name)} zu dir?</h2><ul class="punkte">${fuerWen.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
      <section><h2>Technische Daten</h2><dl class="daten">${fakten.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></section>
      ${jahre.length ? `<section><h2>Gebrauchtpreis nach Baujahr</h2><table class="jahre"><tr><th>Baujahr</th><th>Preis ca.</th></tr>${jahre.map(([j, v]) => `<tr><td>${j}</td><td>${zahl(v)} €</td></tr>`).join("")}</table></section>` : ""}
    </article>
    ${aehnlich.length ? `<section><h2>Ähnliche Motorräder</h2><ul class="raster">${aehnlich.map(karte).join("")}</ul></section>` : ""}
    <section><h2>Mehr entdecken</h2><ul class="themen">${[klasseThema && [klasseThema, themen.find((t) => t.pfad === klasseThema).h1], stilThema && [stilThema, s.mehrzahl], markeThema && [markeThema, `Alle ${b.brand} Motorräder`]]
      .filter(Boolean).map(([p, n]) => `<li><a href="${p}">${esc(n)}</a></li>`).join("")}</ul></section>
` + fuss());
}

// ── Stylesheet und Sitemap ─────────────────────────────────────────────────

writeFileSync(join(DIST, "seo.css"), `@font-face{font-family:Barlow;font-weight:400;font-display:swap;src:url(/fonts/barlow-400.woff2) format("woff2")}
@font-face{font-family:Barlow;font-weight:600;font-display:swap;src:url(/fonts/barlow-600.woff2) format("woff2")}
@font-face{font-family:Barlow;font-weight:800;font-display:swap;src:url(/fonts/barlow-800.woff2) format("woff2")}
:root{--bg:#0a0a0a;--fl:#141414;--rand:rgba(255,255,255,.08);--text:#fff;--dim:rgba(255,255,255,.55);--font:Barlow,"Arial Narrow",Arial,sans-serif}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--font);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit}
.kopf{display:flex;justify-content:space-between;align-items:center;padding:18px 16px;max-width:1200px;margin:0 auto}
.kopf nav{display:flex;gap:18px;align-items:center}
.kopf nav a{text-decoration:none;font-size:15px}
.logo{font-weight:800;letter-spacing:.3em;text-decoration:none}
.krumen{max-width:1200px;margin:0 auto;padding:0 16px 8px;font-size:13px;color:var(--dim)}
.krumen a{text-decoration:none}
main{max-width:1200px;margin:0 auto;padding:8px 16px 48px}
h1{font-size:clamp(30px,6vw,52px);font-weight:800;line-height:1.1;margin:12px 0 14px}
h2{font-size:22px;font-weight:600;margin:40px 0 14px}
.intro{max-width:760px;font-size:18px;color:rgba(255,255,255,.8)}
.kennzahlen,.hinweis{margin-top:14px;color:var(--dim);font-size:15px}
.raster{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin-top:24px}
.karte a{display:flex;flex-direction:column;gap:2px;height:100%;padding:12px;background:var(--fl);border:1px solid var(--rand);border-radius:14px;text-decoration:none}
.karte a:hover{border-color:rgba(255,255,255,.3)}
.karte img{width:100%;height:auto;aspect-ratio:7/5;object-fit:contain;margin-bottom:8px}
.karte .preis{font-weight:600}
.karte .info{font-size:13px;color:var(--dim)}
.themen{list-style:none;display:flex;flex-wrap:wrap;gap:10px}
.themen a{display:inline-block;padding:8px 14px;border:1px solid var(--rand);border-radius:999px;text-decoration:none;font-size:15px}
.themen span{color:var(--dim);font-size:13px}
.bike figure{margin:8px 0 12px;background:linear-gradient(#e9e9e9,#cfcfcf);border-radius:18px;overflow:hidden;position:relative}
.bike figure img{display:block;width:100%;height:auto}
.bike figcaption{position:absolute;right:14px;bottom:10px;color:#333;font-size:13px}
.preis.gross{font-size:26px;font-weight:600}
.preis.gross span{font-size:15px;color:var(--dim);font-weight:400}
.punkte{padding-left:20px;max-width:760px}
.punkte li{margin:4px 0}
.daten{display:grid;grid-template-columns:max-content 1fr;gap:6px 24px;max-width:620px}
.daten dt{color:var(--dim)}
.jahre{border-collapse:collapse;min-width:260px}
.jahre th,.jahre td{text-align:left;padding:6px 18px 6px 0;border-bottom:1px solid var(--rand)}
.jahre th{color:var(--dim);font-weight:400}
.cta{margin-top:56px;padding:28px;border:1px solid var(--rand);border-radius:18px;background:var(--fl);text-align:center}
.cta h2{margin-top:0}
.cta p{color:var(--dim);max-width:560px;margin:0 auto 18px}
.knopf{display:inline-block;background:#fff;color:#000;padding:12px 26px;text-decoration:none;font-weight:600}
.knopf.klein{padding:7px 14px;font-size:14px}
.fuss{max-width:1200px;margin:0 auto;padding:24px 16px 40px;border-top:1px solid var(--rand);color:var(--dim);font-size:13px}
.fuss p{margin:4px 0}
@media (max-width:640px){.raster{grid-template-columns:repeat(2,1fr);gap:10px}.karte a{padding:8px}h2{font-size:19px}.daten{gap:4px 14px}}
`);

const heute = new Date().toISOString().slice(0, 10);
const adressen = ["/", "/motorraeder/", ...themen.map((t) => t.pfad), ...bikes.map((b) => bikePfad.get(b))];
writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${adressen.map((p) => `  <url><loc>${url(p)}</loc><lastmod>${heute}</lastmod></url>`).join("\n")}
</urlset>
`);

console.log(`[seo] ${bikes.length} Bike-Seiten, ${themen.length} Themenseiten, Sitemap mit ${adressen.length} Adressen`);
