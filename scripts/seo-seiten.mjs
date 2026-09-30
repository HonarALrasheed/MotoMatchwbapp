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
 *   /vergleich/<a>-vs-<b>/   ähnliche Modelle derselben Bauart direkt nebeneinander
 *   /sitemap.xml             alle Adressen (ersetzt die Fassung aus public/)
 *
 * Jede Seite trägt echte Katalogdaten und führt ins Quiz. Das ist Absicht: Seiten, die nur
 * Suchbegriffe wiederholen, stuft Google als Spam ein ("doorway pages") — Seiten mit Daten, die
 * sonst niemand so zusammenstellt, nicht.
 *
 *     node scripts/seo-seiten.mjs            (läuft automatisch in `npm run build`)
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
const jahrText = (j) => (Array.isArray(j) && j.length ? (j[0] === j.at(-1) ? `${j[0]}` : `${j[0]}–${j.at(-1)}`) : null);
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
/* Zweiter Absatz je Thema: die Wörter, die Leute für dieselbe Sache tatsächlich eintippen
   ("Streetfighter", "Leichtkraftrad", "Fahranfänger", "gedrosselt" …) — in ganzen Sätzen, die für
   Menschen stimmen. Keine Wortlisten, keine Wiederholungen: Google erkennt Füllwörter und wertet
   die Seite dann ab. Jeder Satz muss auch ohne Suchmaschine sinnvoll sein. */
const STIL_MEHR = {
  Sportbike: "Vom 125er-Sportler bis zum Supersportler mit über 200 PS: verkleidete Maschinen für kurvige Landstraßen und die Rennstrecke, mit sportlicher Sitzposition und hoher Drehzahl.",
  Naked: "Naked Bikes heißen auch Streetfighter oder Roadster — Motorräder ohne Verkleidung, aufrechte Sitzposition, handlich in der Stadt und auf der Landstraße. Für viele das vielseitigste erste Motorrad.",
  Cruiser: "Chopper, Bobber und klassische V2-Cruiser: tiefe Sitzbank, entspannte Sitzposition, viel Drehmoment von unten — zum Cruisen, nicht zum Rasen.",
  Enduro: "Reiseenduros, Adventure-Bikes und Crossover für lange Touren mit Gepäck, dazu leichte Enduros für Feldwege und Offroad. Aufrecht sitzen, viel Federweg, oft große Tanks.",
  Touring: "Reisemotorräder und Sporttourer für die Langstrecke: Windschutz, bequeme Sitzbank für Fahrer und Sozius, Platz für Koffer — gebaut für viele Kilometer am Stück.",
  Klassiker: "Retro-Bikes im Stil der 70er: Neo-Retro, Café Racer und Scrambler mit moderner Technik, dazu echte Klassiker. Rundscheinwerfer, Speichen- oder Gussräder, viel Charakter.",
  Supermoto: "Supermotos (auch Supermotard oder Motard) sind Enduros mit Straßenreifen: leicht, wendig, hoher Lenker — der Spaßmacher für enge Kurven und die Stadt.",
  Roller: "Motorroller, Scooter und Maxi-Scooter mit Automatik: kein Schalten, Stauraum unter der Sitzbank, Wetterschutz — ideal zum Pendeln. Viele sind 125er, die man auch mit B196 fahren darf.",
};
function themaMehr(t) {
  const fest = {
    "fuehrerschein-a1": "A1-Motorräder heißen offiziell Leichtkrafträder: bis 125 ccm Hubraum, höchstens 11 kW (15 PS) und 0,1 kW je kg. Die frühere 80-km/h-Grenze für 16- und 17-Jährige gibt es seit 2013 nicht mehr.",
    "fuehrerschein-b196": "Die Schlüsselzahl 196 wird ohne Prüfung eingetragen: nach Fahrstunden in der Fahrschule (4 × 90 Minuten Theorie, 5 × 90 Minuten Praxis). Sie gilt nur in Deutschland. Dafür darfst du jedes Leichtkraftrad fahren — Motorrad oder Roller mit 125 ccm.",
    "fuehrerschein-a2": "A2 ist die mittlere Stufe des Stufenführerscheins: bis 35 kW (48 PS) und höchstens 0,2 kW je kg. Viele stärkere Modelle gibt es mit Drossel — ein gedrosseltes Motorrad darf ungedrosselt höchstens 70 kW haben. Nach zwei Jahren A2 geht es per Aufstieg (praktische Prüfung) zum offenen A.",
    "fuehrerschein-a": "Der offene Führerschein A (auch „der große Motorradführerschein“) hat keine Leistungsgrenze. Direkt ab 24 Jahren, oder mit 20 nach mindestens zwei Jahren A2.",
    "einsteiger": "Ob Fahranfänger, Wiedereinsteiger nach Jahren Pause oder das erste eigene Motorrad nach dem Führerschein: gutmütige Leistung, geringes Gewicht und eine erreichbare Sitzhöhe machen die ersten tausend Kilometer entspannt.",
    "niedrige-sitzhoehe": "Wer mit beiden Füßen sicher auf den Boden will — etwa bei kleiner Körpergröße oder kurzer Schrittlänge — achtet zuerst auf die Sitzhöhe. Viele Modelle lassen sich zusätzlich tieferlegen oder mit einer flacheren Sitzbank ausstatten.",
    "leichte-motorraeder": "Ein leichtes Motorrad ist wendig, lässt sich einfach schieben, rangieren und nach einem Umkipper wieder aufstellen. Gerade in der Stadt und beim Einstieg ist das mehr wert als ein paar PS.",
  };
  if (fest[t.slug]) return fest[t.slug];
  if (t.stil && !t.slug.endsWith("-a2") && !t.slug.endsWith("-125")) return STIL_MEHR[t.stil] || "";
  const budget = t.slug.match(/^(a2-)?unter-(\d+)-euro$/);
  if (budget) return `Günstige Motorräder gebraucht kaufen: die Preise sind mittlere Marktpreise des deutschen Gebrauchtmarkts. Ein Schnäppchen unter ${zahl(Number(budget[2]))} € ist oft ein älteres Baujahr — auf der Modellseite steht der Gebrauchtpreis je Baujahr.`;
  if (t.marke) return `${t.marke} gebraucht: alle Modelle mit mittlerem Gebrauchtpreis, Leistung, Gewicht, Sitzhöhe und Führerscheinklasse — und passende Alternativen anderer Hersteller auf jeder Modellseite.`;
  return "";
}

for (const t of themen) {
  t.pfad = `/motorraeder/${t.slug}/`;
  t.mehr = themaMehr(t);
  t.liste.sort((a, b) => (b.pop || 0) - (a.pop || 0));
}
const themaPfad = (slug) => themen.find((t) => t.slug === slug)?.pfad;

// ── Vergleiche ─────────────────────────────────────────────────────────────
/* "MT-07 vs Z650" gehört zu den häufigsten Motorrad-Suchen. Paare nur aus den drei ähnlichsten
   Modellen derselben Bauart, beide mit Preis — sonst entstünden Vergleiche, die niemand sucht.
   Vorne steht das bekanntere Modell (pop), so wie man es auch eintippen würde. */
const verhaeltnis = (p, q) => Math.max(p, q) / Math.min(p, q);
const vergleiche = [];
const vergleicheVon = new Map();
{
  const gesehen = new Set();
  for (const b of bikes) {
    if (!preis(b)) continue;
    for (const { bike: x } of findSimilarBikes(b, 3)) {
      if (!bikePfad.has(x) || !preis(x) || x.style !== b.style) continue;
      // Nur echte Konkurrenten: Preis und Leistung höchstens Faktor 1,6 auseinander. Sonst stand
      // "Aprilia Caponord 1200 vs. Sherco 250 SE" da — gleiche Bauart, aber niemand sucht das.
      if (verhaeltnis(preis(b), preis(x)) > 1.6 || (b.ps && x.ps && verhaeltnis(b.ps, x.ps) > 1.6)) continue;
      const schl = [b.slug, x.slug].sort().join("|");
      if (gesehen.has(schl)) continue;
      gesehen.add(schl);
      const [eins, zwei] = (b.pop || 0) >= (x.pop || 0) ? [b, x] : [x, b];
      const v = { a: eins, b: zwei, pfad: `/vergleich/${eins.slug.replace(/_/g, "-")}-vs-${zwei.slug.replace(/_/g, "-")}/` };
      vergleiche.push(v);
      for (const y of [eins, zwei]) {
        if (!vergleicheVon.has(y)) vergleicheVon.set(y, []);
        vergleicheVon.get(y).push(v);
      }
    }
  }
  vergleiche.sort((p, q) => (q.a.pop || 0) + (q.b.pop || 0) - (p.a.pop || 0) - (p.b.pop || 0));
}

// ── Bausteine ──────────────────────────────────────────────────────────────

function kopf({ titel, beschreibung, pfad, bild, krumen, ld: extraLd = [] }) {
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
  ${[ld, ...extraLd].map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("\n  ")}
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

/* Alt-Texte für die Bildersuche: Modell, Bauart und Ansicht — so, wie jemand ein Foto beschreiben würde.
   Platzhalter sagen, dass sie einer sind: sonst zeigte die Bildersuche eine graue Silhouette als "Foto"
   des Modells. */
function altText(b, art) {
  if (!hatFoto(b)) return `${b.name} – noch kein Foto (Platzhalter-Silhouette)`;
  const bauart = STIL[b.style]?.einzahl || b.style;
  const ansicht = art === "studio" ? "im Studio" : art === "kachel" ? "freigestellt" : "Seitenansicht";
  return `${b.name}, ${bauart} – ${ansicht}`;
}

function karte(b) {
  const info = [klasseText(b), b.ps ? `${b.ps} PS` : null, b.cc ? `${b.cc} ccm` : null].filter(Boolean).join(" · ");
  return `<li class="karte"><a href="${bikePfad.get(b)}">
      <img src="${esc(bikeBild(b, "kachel"))}" alt="${esc(altText(b, "kachel"))}" loading="lazy" decoding="async" width="420" height="300" />
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

/* Häufige Fragen — beantwortet aus den Katalogdaten, nicht ausgedacht. Suchmaschinen und KI-Assistenten
   (ChatGPT, Perplexity, Copilot, Gemini) zitieren bevorzugt Stellen, die eine Frage direkt beantworten.
   Dieselben Paare stehen sichtbar auf der Seite und als FAQPage-Daten im Kopf — nur so ist es erlaubt. */
function faqHtml(paare) {
  if (!paare.length) return "";
  return `<section class="faq"><h2>Häufige Fragen</h2><dl>${paare.map(([f, a]) => `<dt>${esc(f)}</dt><dd>${esc(a)}</dd>`).join("")}</dl></section>`;
}
const faqLd = (paare) => paare.length ? [{
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: paare.map(([f, a]) => ({ "@type": "Question", name: f, acceptedAnswer: { "@type": "Answer", text: a } })),
}] : [];

function themaFragen(t) {
  const l = t.liste, paare = [];
  const mitPreis = l.filter((b) => preis(b)).sort((a, b) => preis(a) - preis(b));
  if (mitPreis.length >= 3) {
    const q = (x) => preis(mitPreis[Math.min(mitPreis.length - 1, Math.floor(mitPreis.length * x))]);
    paare.push([`${t.h1}: Was kosten sie gebraucht?`,
      `Die Hälfte der ${mitPreis.length} Modelle mit Preis liegt gebraucht zwischen ca. ${zahl(q(0.25))} € und ${zahl(q(0.75))} €, typisch sind ca. ${zahl(q(0.5))} € (mittlere Marktpreise, Stand ${STAND}).`]);
    paare.push([`${t.h1}: Welches Modell ist am günstigsten?`,
      `Am günstigsten ist die ${mitPreis[0].name} mit ${preisText(mitPreis[0])} gebraucht, gefolgt von ${mitPreis.slice(1, 3).map((b) => `${b.name} (${preisText(b)})`).join(" und ")}.`]);
  }
  const stark = l.filter((b) => b.ps > 0).sort((a, b) => b.ps - a.ps)[0];
  if (stark) paare.push([`${t.h1}: Welches Modell hat die meiste Leistung?`, `Die meiste Leistung hat die ${stark.name} mit ${stark.ps} PS (${stark.kw} kW)${
    stark.license === "A" && stark.a2 && t.liste.every(darfA2) ? " — offen gemessen; mit A2 fährst du sie auf 35 kW gedrosselt" : ""}.`]);
  const leicht = l.filter((b) => b.weight > 0).sort((a, b) => a.weight - b.weight)[0];
  if (leicht) paare.push([`${t.h1}: Welches Modell ist am leichtesten?`, `Am leichtesten ist die ${leicht.name} mit ${leicht.weight} kg.`]);
  const tief = l.filter((b) => b.seat_height > 0).sort((a, b) => a.seat_height - b.seat_height)[0];
  if (tief) paare.push([`${t.h1}: Welches Modell hat die niedrigste Sitzhöhe?`,
    `Am niedrigsten sitzt man auf der ${tief.name} mit ${dez(tief.seat_height)} cm — als Faustregel kommt man damit ab etwa ${abGroesse(tief.seat_height)} cm Körpergröße sicher auf den Boden.`]);
  const beliebt = l.slice(0, 3);
  if (beliebt.length === 3) paare.push([`${t.h1}: Welche Modelle sind am gefragtesten?`,
    `Am gefragtesten auf dem deutschen Gebrauchtmarkt sind ${beliebt.map((b) => `${b.name} (${preisText(b)})`).join(", ")}.`]);
  return paare;
}

function bikeFragen(b) {
  const paare = [];
  const lizenz = b.license === "A1" ? "den A1-Führerschein (ab 16) oder B196 mit dem Autoführerschein"
    : b.license === "A2" ? "den A2-Führerschein (ab 18)"
    : b.a2 ? "den A-Führerschein — oder A2, wenn sie auf 35 kW gedrosselt ist" : "den offenen A-Führerschein; für A2 ist sie zu stark";
  paare.push([`Welchen Führerschein brauche ich für die ${b.name}?`, `Für die ${b.name} brauchst du ${lizenz}.`]);
  if (preis(b)) paare.push([`Was kostet die ${b.name} gebraucht?`,
    `Gebraucht kostet die ${b.name} ${preisText(b)}${b.priceYear ? ` (Baujahr ${b.priceYear})` : ""}, mittlerer Marktpreis, Stand ${STAND}.`]);
  if (b.seat_height) paare.push([`Wie hoch ist die Sitzhöhe der ${b.name}?`,
    `Die Sitzhöhe beträgt ${dez(b.seat_height)} cm. Als Faustregel kommt man ab etwa ${abGroesse(b.seat_height)} cm Körpergröße mit beiden Füßen sicher auf den Boden.`]);
  paare.push([`Ist die ${b.name} für Anfänger geeignet?`, b.beginner
    ? `Ja, die ${b.name} gilt als einsteigerfreundlich${b.weight ? ` — mit ${b.weight} kg` : ""}${b.ps ? ` und ${b.ps} PS` : ""}.`
    : `Eher nicht: die ${b.name} ist eher etwas für Fahrerinnen und Fahrer mit Erfahrung${b.ps ? ` (${b.ps} PS${b.weight ? `, ${b.weight} kg` : ""})` : ""}.`]);
  return paare;
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
  const fragen = themaFragen(t);
  const liste = { "@context": "https://schema.org", "@type": "ItemList", name: t.h1, numberOfItems: t.liste.length,
    itemListElement: t.liste.slice(0, 30).map((b, i) => ({ "@type": "ListItem", position: i + 1, name: b.name, url: url(bikePfad.get(b)) })) };
  schreibe(t.pfad, kopf({ titel: t.titel, beschreibung, pfad: t.pfad, krumen, bild: hatFoto(t.liste[0]) ? bikeBild(t.liste[0], "titel") : null, ld: [liste, ...faqLd(fragen)] }) + `
    <h1>${esc(t.h1)}</h1>
    <p class="intro">${esc(t.intro)}</p>
    ${t.mehr ? `<p class="intro zwei">${esc(t.mehr)}</p>` : ""}
    ${kennzahlen(t.liste)}
    <ul class="raster">${t.liste.slice(0, MAX_LISTE).map(karte).join("")}</ul>
    ${t.liste.length > MAX_LISTE ? `<p class="hinweis">Gezeigt: die ${MAX_LISTE} gefragtesten von ${t.liste.length} Modellen. Das Quiz durchsucht alle.</p>` : ""}
    ${faqHtml(fragen)}
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
    <section><h2>Vergleiche</h2><ul class="themen"><li><a href="/vergleich/">Alle Motorrad-Vergleiche</a> <span>${vergleiche.length}</span></li></ul></section>
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
    ["Baujahre", jahrText(b.jahre)],
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

  const fragen = bikeFragen(b);
  const menge = (value, unitCode) => (value ? { "@type": "QuantitativeValue", value, unitCode } : undefined);
  const motorrad = {
    "@context": "https://schema.org", "@type": "Motorcycle", name: b.name, url: url(pfad),
    brand: { "@type": "Brand", name: b.brand }, model: b.bgText || b.name,
    image: hatFoto(b) ? url(bikeBild(b, "titel")) : undefined,
    vehicleEngine: (b.cc || b.kw) ? { "@type": "EngineSpecification", engineDisplacement: menge(b.cc, "CMQ"), enginePower: menge(b.kw, "KWT") } : undefined,
    weight: menge(b.weight, "KGM"), fuelCapacity: menge(b.tank, "LTR"),
    fuelConsumption: b.verbrauch ? { "@type": "QuantitativeValue", value: b.verbrauch, unitText: "l/100 km" } : undefined,
    speed: menge(b.topSpeed, "KMH"), vehicleTransmission: b.gear || undefined,
    bodyType: s?.einzahl || b.style,
  };
  schreibe(pfad, kopf({ titel: `${b.name} gebraucht: Preis, technische Daten & Führerschein`, beschreibung, pfad, krumen, bild: hatFoto(b) ? bikeBild(b, "titel") : null, ld: [motorrad, ...faqLd(fragen)] }) + `
    <article class="bike">
      <h1>${esc(b.name)}</h1>
      <figure><img src="${esc(bikeBild(b, "titel"))}" alt="${esc(altText(b, "titel"))}" width="1600" height="437" fetchpriority="high" />${hatFoto(b) ? "" : "<figcaption>Foto folgt</figcaption>"}</figure>
      <p class="preis gross">${preisText(b)}${b.priceYear && preis(b) ? ` <span>gebraucht, Baujahr ${b.priceYear}</span>` : ""}</p>
      <p class="aktionen"><a class="knopf" href="/?motorrad=${esc(b.slug.replace(/_/g, "-"))}">In MotoMatch ansehen</a> <a class="knopf zweit" href="/">Passt sie zu mir? Quiz starten</a></p>
      <section><h2>Passt die ${esc(b.name)} zu dir?</h2><ul class="punkte">${fuerWen.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
      <section><h2>Technische Daten</h2><dl class="daten">${fakten.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></section>
      ${jahre.length ? `<section><h2>Gebrauchtpreis nach Baujahr</h2><table class="jahre"><tr><th>Baujahr</th><th>Preis ca.</th></tr>${jahre.map(([j, v]) => `<tr><td>${j}</td><td>${zahl(v)} €</td></tr>`).join("")}</table></section>` : ""}
      ${faqHtml(fragen)}
    </article>
    ${aehnlich.length ? `<section><h2>Ähnliche Motorräder</h2><ul class="raster">${aehnlich.map(karte).join("")}</ul></section>` : ""}
    ${vergleicheVon.has(b) ? `<section><h2>${esc(b.name)} im Vergleich</h2><ul class="themen">${vergleicheVon.get(b)
      .map((v) => `<li><a href="${v.pfad}">${esc(v.a.name)} vs. ${esc(v.b.name)}</a></li>`).join("")}</ul></section>` : ""}
    <section><h2>Mehr entdecken</h2><ul class="themen">${[klasseThema && [klasseThema, themen.find((t) => t.pfad === klasseThema).h1], stilThema && [stilThema, s.mehrzahl], markeThema && [markeThema, `Alle ${b.brand} Motorräder`]]
      .filter(Boolean).map(([p, n]) => `<li><a href="${p}">${esc(n)}</a></li>`).join("")}</ul></section>
` + fuss());
}

// ── Vergleichsseiten ───────────────────────────────────────────────────────

/* [Beschriftung, Wert, Anzeige, besser] — besser: "min"/"max" markiert den Gewinner der Zeile,
   null heißt "kein besser oder schlechter" (Hubraum, Sitzhöhe hängen vom Fahrer ab). */
const reichweite = (b) => (b.tank > 0 && b.verbrauch > 0 ? Math.round((b.tank / b.verbrauch) * 100) : null);
const ZEILEN = [
  ["Preis gebraucht", preis, (v) => `ca. ${zahl(v)} €`, "min"],
  ["Führerschein", klasseText, (v) => v, null],
  ["Leistung", (b) => b.ps || null, (v) => `${v} PS`, "max"],
  ["Drehmoment", (b) => b.torque || null, (v) => `${v} Nm`, "max"],
  ["Hubraum", (b) => b.cc || null, (v) => `${zahl(v)} ccm`, null],
  ["Gewicht", (b) => b.weight || null, (v) => `${v} kg`, "min"],
  ["Leistungsgewicht", (b) => (b.ps > 0 && b.weight > 0 ? Math.round((b.weight / b.ps) * 10) / 10 : null), (v) => `${dez(v.toFixed(1))} kg/PS`, "min"],
  ["Sitzhöhe", (b) => b.seat_height || null, (v) => `${dez(v)} cm`, null],
  ["Tank", (b) => b.tank || null, (v) => `${dez(v)} l`, "max"],
  ["Verbrauch", (b) => b.verbrauch || null, (v) => `${dez(v)} l/100 km`, "min"],
  ["Reichweite", reichweite, (v) => `ca. ${zahl(v)} km`, "max"],
  ["Höchstgeschwindigkeit", (b) => b.topSpeed || null, (v) => `${v} km/h`, "max"],
  ["Baujahre", (b) => jahrText(b.jahre), (v) => v, null],
];

function fazit(a, b) {
  const punkte = [];
  const pa = preis(a), pb = preis(b);
  if (Math.abs(pa - pb) >= 200) {
    const [g, t] = pa < pb ? [a, b] : [b, a];
    punkte.push(`Günstiger ist die ${g.name}: gebraucht rund ${zahl(Math.abs(pa - pb))} € weniger als die ${t.name}.`);
  } else punkte.push("Preislich liegen beide fast gleichauf.");
  if (a.ps && b.ps && a.ps !== b.ps) {
    const [s, w] = a.ps > b.ps ? [a, b] : [b, a];
    punkte.push(`Mehr Leistung hat die ${s.name} (${s.ps} statt ${w.ps} PS).`);
  }
  if (a.weight && b.weight && Math.abs(a.weight - b.weight) >= 3) {
    const [l, s] = a.weight < b.weight ? [a, b] : [b, a];
    punkte.push(`Leichter ist die ${l.name} — ${Math.abs(a.weight - b.weight)} kg weniger, das merkt man beim Rangieren.`);
  }
  if (a.seat_height && b.seat_height && Math.abs(a.seat_height - b.seat_height) >= 1) {
    const n = a.seat_height < b.seat_height ? a : b;
    punkte.push(`Niedriger sitzt man auf der ${n.name} (${dez(n.seat_height)} cm) — sicherer Stand als Faustregel ab etwa ${abGroesse(n.seat_height)} cm Körpergröße.`);
  }
  if (darfA2(a) !== darfA2(b)) {
    const j = darfA2(a) ? a : b;
    punkte.push(`Nur die ${j.name} ist mit dem A2-Führerschein fahrbar${j.license === "A" ? " (gedrosselt)" : ""}.`);
  }
  if (a.beginner !== b.beginner) punkte.push(`Für Einsteiger eignet sich eher die ${(a.beginner ? a : b).name}.`);
  return punkte;
}

for (const v of vergleiche) {
  const { a, b } = v;
  const krumen = [["Start", "/"], ["Motorräder", "/motorraeder/"], ["Vergleiche", "/vergleich/"], [`${a.name} vs. ${b.name}`, v.pfad]];
  const zeilen = ZEILEN.map(([name, wert, zeige, besser]) => {
    const wa = wert(a), wb = wert(b);
    if (wa == null && wb == null) return "";
    const sieg = (w, x) => besser && typeof w === "number" && typeof x === "number" && w !== x && (besser === "min" ? w < x : w > x);
    const zelle = (w, x) => `<td${sieg(w, x) ? ' class="besser"' : ""}>${w == null ? "–" : esc(zeige(w))}</td>`;
    return `<tr><th>${esc(name)}</th>${zelle(wa, wb)}${zelle(wb, wa)}</tr>`;
  }).join("");
  const beschreibung = `${a.name} oder ${b.name}? Preis (${preisText(a)} vs. ${preisText(b)}), Leistung, Gewicht, Sitzhöhe und Führerschein im direkten Vergleich.`;
  const weitere = [...(vergleicheVon.get(a) || []), ...(vergleicheVon.get(b) || [])].filter((x) => x !== v).slice(0, 8);

  schreibe(v.pfad, kopf({ titel: `${a.name} oder ${b.name}? Vergleich von Preis, PS & Gewicht`, beschreibung, pfad: v.pfad, krumen, bild: hatFoto(a) ? bikeBild(a, "titel") : null }) + `
    <h1>${esc(a.name)} vs. ${esc(b.name)}</h1>
    <p class="intro">${esc(a.name)} oder ${esc(b.name)}? Zwei ${esc(STIL[a.style]?.mehrzahl || a.style)} im direkten Vergleich — mit Gebrauchtpreis, Technik und Führerschein.</p>
    <div class="vs">${[a, b].map((x) => `<a href="${bikePfad.get(x)}"><img src="${esc(bikeBild(x, "kachel"))}" alt="${esc(altText(x, "kachel"))}" width="420" height="300" /><strong>${esc(x.name)}</strong><span class="preis">${preisText(x)}</span></a>`).join("")}</div>
    <section><h2>Kurz gesagt</h2><ul class="punkte">${fazit(a, b).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
    <section><h2>Daten im Vergleich</h2><div class="tabelle"><table class="vergleich"><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr>${zeilen}</table></div>
      <p class="hinweis">Hervorgehoben ist jeweils der bessere Wert. Welche Sitzhöhe und welcher Hubraum passen, hängt von dir ab.</p></section>
    ${weitere.length ? `<section><h2>Weitere Vergleiche</h2><ul class="themen">${weitere.map((x) => `<li><a href="${x.pfad}">${esc(x.a.name)} vs. ${esc(x.b.name)}</a></li>`).join("")}</ul></section>` : ""}
` + fuss());
}

/* Übersicht: je Bauart die gefragtesten Paare. Alle Paare stehen in der Sitemap und sind von den
   Bike-Seiten aus verlinkt — hier alle 2.000+ aufzulisten wäre für Menschen unbrauchbar. */
schreibe("/vergleich/", kopf({
  titel: "Motorrad-Vergleiche: Preis, PS & Gewicht direkt nebeneinander",
  beschreibung: `${vergleiche.length} Motorrad-Vergleiche aus dem deutschen Markt: Gebrauchtpreis, Leistung, Gewicht, Sitzhöhe und Führerschein direkt nebeneinander.`,
  pfad: "/vergleich/", krumen: [["Start", "/"], ["Motorräder", "/motorraeder/"], ["Vergleiche", "/vergleich/"]] }) + `
    <h1>Motorrad-Vergleiche</h1>
    <p class="intro">${vergleiche.length} Duelle ähnlicher Modelle — mit Gebrauchtpreis, Leistung, Gewicht, Sitzhöhe und Führerschein direkt nebeneinander.</p>
    ${Object.entries(STIL).map(([stil, s]) => {
      const liste = vergleiche.filter((v) => v.a.style === stil).slice(0, 30);
      return liste.length ? `<section><h2>${esc(s.mehrzahl)}</h2><ul class="themen">${liste.map((v) => `<li><a href="${v.pfad}">${esc(v.a.name)} vs. ${esc(v.b.name)}</a></li>`).join("")}</ul></section>` : "";
    }).join("")}
` + fuss());

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
.intro.zwei{font-size:16px;color:rgba(255,255,255,.65);margin-top:10px}
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
.knopf.zweit{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.35)}
.aktionen{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 4px}
.fuss{max-width:1200px;margin:0 auto;padding:24px 16px 40px;border-top:1px solid var(--rand);color:var(--dim);font-size:13px}
.fuss p{margin:4px 0}
.vs{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:24px}
.vs a{display:flex;flex-direction:column;gap:2px;padding:12px;background:var(--fl);border:1px solid var(--rand);border-radius:14px;text-decoration:none}
.vs img{width:100%;height:auto;aspect-ratio:7/5;object-fit:contain;margin-bottom:8px}
.tabelle{overflow-x:auto}
.vergleich{border-collapse:collapse;width:100%;max-width:760px}
.vergleich th,.vergleich td{text-align:left;padding:8px 14px 8px 0;border-bottom:1px solid var(--rand);vertical-align:top}
.vergleich tr:first-child th{font-weight:600}
.vergleich th{color:var(--dim);font-weight:400}
.vergleich td{color:rgba(255,255,255,.75)}
.vergleich td.besser{color:#fff;font-weight:600}
.vergleich td.besser::after{content:" ✓";font-weight:400}
.faq dl{max-width:760px}
.faq dt{font-weight:600;margin-top:16px}
.faq dd{color:rgba(255,255,255,.75);margin-top:4px}
@media (max-width:640px){.raster{grid-template-columns:repeat(2,1fr);gap:10px}.karte a{padding:8px}h2{font-size:19px}.daten{gap:4px 14px}}
`);

/* llms.txt (llmstxt.org): eine Kurzbeschreibung der Seite für KI-Assistenten, in Markdown. Die meisten
   KI-Crawler führen kein JavaScript aus — für sie ist die App selbst leer. Hier steht, was MotoMatch ist
   und welche Seiten die Daten tragen. */
{
  const zeile = (t) => `- [${t.h1}](${url(t.pfad)}): ${t.liste.length} Modelle`;
  const gruppe = (g) => themen.filter((t) => t.gruppe === g).map(zeile).join("\n");
  writeFileSync(join(DIST, "llms.txt"), `# MotoMatch

> MotoMatch hilft Motorradfahrerinnen und -fahrern in Deutschland, das passende Motorrad zu finden: ein Quiz mit acht Fragen (Führerschein, Budget, Körpergröße, Erfahrung, Einsatzzweck, Fahrstil) und ein Katalog von ${bikes.length} Modellen des deutschen Markts mit Gebrauchtpreisen, technischen Daten und Führerscheinklasse (A1, A2, A, B196).

Die Preise sind mittlere Gebrauchtmarktpreise (Stand ${STAND}). Jede Modellseite nennt Preis (auch nach Baujahr), Leistung, Hubraum, Gewicht, Sitzhöhe, Tank, Verbrauch, Führerscheinklasse, Eignung für Einsteiger und ähnliche Modelle. Das Quiz selbst läuft unter ${BASIS}/ und braucht JavaScript.

## Einstieg

- [Quiz: Welches Motorrad passt zu mir?](${BASIS}/): acht Fragen, Ergebnis aus über 1.000 Modellen
- [Alle Themen](${url("/motorraeder/")}): Motorräder nach Führerschein, Bauart, Budget und Marke
- [Motorrad-Vergleiche](${url("/vergleich/")}): ${vergleiche.length} Duelle ähnlicher Modelle mit Preis, PS, Gewicht und Sitzhöhe

## Nach Führerschein

${gruppe("Führerschein")}

## Für wen

${gruppe("Für wen")}

## Nach Bauart

${gruppe("Bauart")}

## Nach Budget

${gruppe("Budget")}

## Optional

${gruppe("Bauart × Führerschein")}
${gruppe("Marke")}
- [Sitemap mit allen Modell- und Vergleichsseiten](${url("/sitemap.xml")})
`);
}

const heute = new Date().toISOString().slice(0, 10);
const adressen = ["/", "/motorraeder/", "/vergleich/", ...themen.map((t) => t.pfad), ...bikes.map((b) => bikePfad.get(b)), ...vergleiche.map((v) => v.pfad)];
/* Bild-Sitemap (Google-Erweiterung): die echten Fotos je Bike-Seite, damit sie in der Bildersuche
   erscheinen. Nur echte Fotos — Platzhalter-Silhouetten gehören nicht in die Bildersuche. */
const bilderJeSeite = new Map();
for (const b of bikes) {
  if (!hatFoto(b)) continue;
  const bilder = [...new Set([bikeBild(b, "titel"), b.studio, b.image].filter(Boolean))];
  bilderJeSeite.set(bikePfad.get(b), bilder);
}
writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${adressen.map((p) => `  <url><loc>${url(p)}</loc><lastmod>${heute}</lastmod>${(bilderJeSeite.get(p) || [])
    .map((bild) => `<image:image><image:loc>${esc(url(bild))}</image:loc></image:image>`).join("")}</url>`).join("\n")}
</urlset>
`);

console.log(`[seo] ${bikes.length} Bike-Seiten, ${themen.length} Themenseiten, ${vergleiche.length} Vergleiche, Sitemap mit ${adressen.length} Adressen`);
