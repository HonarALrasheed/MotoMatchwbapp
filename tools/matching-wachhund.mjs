/**
 * MotoMatch — die Zusagen über ALLE Quiz-Kombinationen prüfen (2026-09-20)
 *
 * Das Golden Set (matching-golden.mjs) prüft 24 Fahrerprofile gründlich, mit Begründungen. Dieser
 * Lauf macht das Gegenteil: er prüft nur die harten Zusagen, dafür über jede Kombination, die das
 * Quiz hergibt. Was hier durchkommt, kann kein Nutzer auslösen.
 *
 * Geprüft wird, was das Matching verspricht:
 *   · Es kommt überhaupt ein Ergebnis
 *   · Nichts, was der Fahrer nicht fahren darf
 *   · Nichts über dem Budget, und nichts ohne Preis, wenn ein Budget genannt wurde
 *   · Keine Maschine auf Platz eins, die weit über der sicheren Sitzhöhe liegt
 *   · Keine zwei Maschinen derselben Familie, höchstens zwei je Marke
 *   · Bei „Egal" höchstens zwei je Gattung
 *   · Die Walze (findBestBike) hält beim selben Bike, das die Ergebnisseite auf Platz eins zeigt
 *
 *     node tools/matching-wachhund.mjs
 */
import { readFileSync } from "node:fs";
import { setCatalog, findTopMatches, findBestBike, ERGEBNIS_ANZAHL, BUDGET_SLIDER_MAX } from "../src/js/matching.js";

const katalog = JSON.parse(readFileSync(new URL("../public/data/katalog-de.json", import.meta.url)));
setCatalog(katalog.bikes);

const LIZENZ_ERLAUBT = { A1: ["A1"], B196: ["A1"], A2: ["A1", "A2"], A: ["A1", "A2", "A", "Offroad"] };
const sicher = (groesse, schritt) => Math.min(95, Math.max(66, ((Number(schritt) || groesse * 0.45) * 1.03)));

const LIZENZ = ["A1", "A2", "A", "B196"];
const ERFAHRUNG = ["Anfänger", "Wiedereinsteiger", "Profi"];
const STIL = ["Sportbike", "Naked", "Cruiser", "Enduro", "Touring", "Klassiker", "Supermoto", "Roller", "Egal"];
const EINSATZ = ["Pendeln", "Urlaub", "Gelände", "Rennstrecke", "Cruisen"];
const BUDGET = ["500", "1500", "2500", "4000", "7000", "12000", "20000", "30000"];
const GROESSE = ["150", "165", "178", "195", "210"];
const SOZIUS = ["Ja", "Nein"];
const CHARAKTER = ["ruhig", "mittel", "voll"];

/* Über dem Budget ist in Ordnung, wenn das Ergebnis es sagt — die drei Hinweise aus findTopMatches():
   nichts auf dem Markt, Gattung mit diesem Führerschein gar nicht, oder Budget gelockert ("hier auch
   bis 1.950 €" / "ganz ohne Budgetgrenze"). Beim gelockerten Budget darf der Preis die genannte neue
   Grenze nicht überschreiten. */
function budgetErklaert(hinweis, preis) {
  if (!hinweis) return false;
  if (/gibt es auf dem deutschen Markt nichts|gibt es mit deinem Führerschein nicht|ganz ohne Budgetgrenze/.test(hinweis)) return true;
  const bis = hinweis.match(/hier auch bis ([\d.]+) €/);
  return Boolean(bis) && preis <= Number(bis[1].replace(/\./g, ""));
}

const befunde = new Map();   // Art → { anzahl, beispiel }
let laeufe = 0;
const melde = (art, beispiel) => {
  const e = befunde.get(art) || { anzahl: 0, beispiel };
  e.anzahl++;
  befunde.set(art, e);
};

for (const q1 of LIZENZ) for (const q2 of ERFAHRUNG) for (const q3 of STIL) for (const q4 of EINSATZ)
for (const q5 of BUDGET) for (const q6 of GROESSE) for (const q7 of SOZIUS) for (const q9 of CHARAKTER) {
  const a = { q1, q2, q3, q4, q5, q6, q7, q9 };
  const wer = `${q1}/${q2}/${q3}/${q4}/${q5} €/${q6} cm/${q7}/${q9}`;
  const top = findTopMatches(a, ERGEBNIS_ANZAHL);
  laeufe++;

  if (!top.length) { melde("kein Ergebnis", wer); continue; }

  const walze = findBestBike(a);
  if (walze.name !== top[0].bike.name) melde("Walze hält bei anderem Bike als das Ergebnis", `${wer} → ${walze.name} statt ${top[0].bike.name}`);

  /* Am Anschlag zeigt das Quiz "30.000 €+": dort gibt es bewusst keine Obergrenze (BUDGET_SLIDER_MAX
     in matching.js) — Bikes ohne Preis und über 30.000 € sind dann zulässig. */
  const budget = Number(q5) >= BUDGET_SLIDER_MAX ? Infinity : Number(q5);
  const erlaubt = LIZENZ_ERLAUBT[q1];
  for (const { bike } of top) {
    if (!(erlaubt.includes(bike.license) || (q1 === "A2" && bike.a2))) {
      melde(`unzulässige Klasse (${bike.license} für ${q1})`, `${wer} → ${bike.name}`);
    }
    if (Number.isFinite(budget)) {
      if (!bike.price) melde("Treffer ohne Preis trotz Budget", `${wer} → ${bike.name}`);
      /* Über dem Budget ist nur in Ordnung, wenn es unterhalb wirklich nichts gibt UND das
         Ergebnis das auch sagt. Stillschweigend zu teuer bleibt ein Fehler. */
      else if (bike.price > budget && !budgetErklaert(top.hinweis, bike.price)) {
        melde("über Budget ohne Hinweis", `${wer} → ${bike.name} (${bike.price} €)`);
      }
    }
  }

  // Die Auswahl, aus der das Matching tatsächlich gewählt hat (Führerschein, Gattung, ggf. gelockertes Budget).
  const auswahl = top.auswahl || [];
  const poolGross = katalog.bikes.filter((b) => {
    if (!(erlaubt.includes(b.license) || (q1 === "A2" && b.a2))) return false;
    if (!Number.isFinite(budget)) return true;
    const jahre = b.priceYears ? Object.values(b.priceYears).filter((v) => v > 0 && v <= budget) : [];
    return jahre.length > 0 || (b.price > 0 && b.price <= budget);
  }).length >= 15;

  const erste = top[0].bike;
  const sicherHoehe = sicher(Number(q6));
  const notfall = /gibt es auf dem deutschen Markt nichts/.test(top.hinweis || "");
  /* Auch die Sitzhöhe lässt sich nur verlangen, wo es eine niedrigere Maschine gibt: bei A1 und
     1.500 EUR stehen acht Bikes zur Wahl, alle über 79 cm. Dann ist die hohe Sitzbank keine
     Fehlentscheidung des Matchings, sondern der Markt — die Karte nennt sie ohnehin als
     Einschränkung („79,5 cm Sitzhöhe — deutlich zu hoch für sicheren Stand"). */
  // Nur ein Fehler, wenn die Auswahl eine Maschine hergegeben hätte, auf der man sicher(er) steht.
  const niedrigere = auswahl.some((b) => b.seat_height && b.seat_height <= sicherHoehe + 8);
  if (!notfall && poolGross && niedrigere && erste.seat_height && erste.seat_height > sicherHoehe + 8) {
    melde("Platz eins zu hoch", `${wer} → ${erste.name} (${erste.seat_height} cm, sicher ${sicherHoehe.toFixed(0)})`);
  }

  const familien = top.map((r) => `${r.bike.brand}|${(r.bike.bgText || "").toLowerCase().replace(/[^a-z0-9]/g, "")}`);
  if (new Set(familien).size !== familien.length) melde("zweimal dieselbe Familie", wer);
  const marken = {};
  for (const r of top) marken[r.bike.brand] = (marken[r.bike.brand] || 0) + 1;
  // Nur ein Fehler, wenn die Auswahl genug Bikes anderer Marken hergegeben hätte: höchstens zwei je Marke
  // gezählt, müssen damit volle Ergebnisplätze zu füllen sein.
  const jeMarkeMoeglich = {};
  let moeglich = 0;
  for (const b of auswahl) if ((jeMarkeMoeglich[b.brand] = (jeMarkeMoeglich[b.brand] || 0) + 1) <= 2) moeglich++;
  if (poolGross && moeglich >= top.length) for (const [mk, z] of Object.entries(marken)) if (z > 2) melde(`mehr als zwei je Marke (${mk})`, wer);
  if (poolGross && q3 === "Egal") {
    const stile = {};
    for (const r of top) stile[r.bike.style] = (stile[r.bike.style] || 0) + 1;
    for (const [s, z] of Object.entries(stile)) if (z > 2) melde(`bei „Egal" mehr als zwei je Gattung (${s})`, wer);
  }
}

console.log(`${laeufe.toLocaleString("de-DE")} Kombinationen geprüft`);
if (!befunde.size) {
  console.log("Keine Beanstandung — alle Zusagen halten.");
  process.exit(0);
}
for (const [art, { anzahl, beispiel }] of [...befunde.entries()].sort((a, b) => b[1].anzahl - a[1].anzahl)) {
  console.log(`  ✗ ${art}: ${anzahl}×   z. B. ${beispiel}`);
}
process.exit(1);
