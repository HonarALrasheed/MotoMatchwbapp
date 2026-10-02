/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — matching.js  v2.0
 *  Scoring Engine — Architected for 40,000+ motorcycles
 *
 *  Architecture:
 *    Phase 1 — Hard filters (license, budget) eliminate non-candidates
 *    Phase 2 — Weighted multi-factor scoring on survivors
 *    Phase 3 — Top-K extraction (no full sort at scale)
 *
 *  Public API:
 *    setCatalog(bikes)                  → void
 *    findBestBike(answers)              → Bike
 *    findTopMatches(answers, n?)        → { bike, score, breakdown }[]
 * ══════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════════════════════════════
//  DEFAULT CATALOG (10 bikes — production replaces via setCatalog)
// ══════════════════════════════════════════════════════════════

// Die freigegebenen Bikes der Bildwerkstatt — erzeugt von tools/catalog/einbau.py, kommen zu den zehn Grund-Bikes.
import { FREIGEGEBENE_BIKES } from "./freigegebene-bikes.js";

const DEFAULT_CATALOG = [
  {
    id: 1,
    name: "Honda NR750",
    brand: "Honda",
    style: "Sportbike",
    cc: 747,
    ps: 125,
    kw: 92,
    accel: 3.5,
    topSpeed: 259,
    tank: 18.0,
    gear: "6-Gang",
    seat_height: 78.5,
    weight: 244,
    license: "A",
    beginner: false,
    use: "Rennstrecke",
    price: "18000-25000",
    priceDisplay: "Ab EUR 18.000",
    model: "1992-1994",
    bgText: "NR750",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/honda_nr750_1994.glb",
    image: "/bikes/honda_nr750_1994.webp",
    image2: "/bikes/2/honda_nr750_1994.webp",
  },
  {
    id: 2,
    name: "Honda CB 750 F",
    brand: "Honda",
    style: "Klassiker",
    cc: 736,
    ps: 67,
    kw: 49,
    accel: 5.8,
    topSpeed: 200,
    tank: 14.0,
    gear: "5-Gang",
    seat_height: 80.0,
    weight: 235,
    license: "A",
    beginner: true,
    use: "Touring",
    price: "12000-18000",
    priceDisplay: "Ab EUR 12.000",
    model: "1969-1970",
    bgText: "CB750F",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/honda_cb750f_1970.glb",
    image: "/bikes/honda_cb750f_1970.webp",
    image2: "/bikes/2/honda_cb750f_1970.webp",
  },
  {
    id: 3,
    name: "Yamaha YZF-R3",
    brand: "Yamaha",
    style: "Sportbike",
    cc: 321,
    ps: 42,
    kw: 31,
    accel: 5.6,
    topSpeed: 180,
    tank: 14.0,
    gear: "6-Gang",
    seat_height: 78.0,
    weight: 167,
    license: "A2",
    beginner: true,
    use: "Pendeln",
    price: "4500-6000",
    priceDisplay: "Ab EUR 4.500",
    model: "2017",
    bgText: "YZF-R3",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/yamaha_yzfr3_2017.glb",
    image: "/bikes/yamaha_yzfr3_2017.webp",
    image2: "/bikes/2/yamaha_yzfr3_2017.webp",
  },
  {
    id: 4,
    name: "Suzuki GSX-R 750",
    brand: "Suzuki",
    style: "Sportbike",
    cc: 750,
    ps: 150,
    kw: 110,
    accel: 3.2,
    topSpeed: 280,
    tank: 16.0,
    gear: "6-Gang",
    seat_height: 81.0,
    weight: 190,
    license: "A",
    beginner: false,
    use: "Rennstrecke",
    price: "11000-15000",
    priceDisplay: "Ab EUR 11.000",
    model: "2023",
    bgText: "GSX-R750",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/suzuki_gsxr750_2023.glb",
    image: "/bikes/2/suzuki_gsxr750_2023.webp",
    image2: "/bikes/2/suzuki_gsxr750_2023.webp",
  },
  {
    id: 5,
    name: "Harley-Davidson Seventy-Two",
    brand: "Harley-Davidson",
    style: "Cruiser",
    cc: 1202,
    ps: 66,
    kw: 49,
    accel: 5.2,
    topSpeed: 170,
    tank: 7.9,
    gear: "5-Gang",
    seat_height: 67.6,
    weight: 255,
    license: "A",
    beginner: false,
    use: "Cruisen",
    price: "15000-20000",
    priceDisplay: "Ab EUR 15.000",
    model: "2015",
    bgText: "Seventy-Two",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/harley_seventytwo_2015.glb",
    image: "/bikes/harley_seventytwo_2015.webp",
    image2: "/bikes/2/harley_seventytwo_2015.webp",
  },
  {
    id: 6,
    name: "Harley-Davidson Iron 883",
    brand: "Harley-Davidson",
    style: "Cruiser",
    cc: 883,
    ps: 51,
    kw: 38,
    accel: 6.5,
    topSpeed: 161,
    tank: 12.5,
    gear: "5-Gang",
    seat_height: 65.3,
    weight: 256,
    license: "A2",
    beginner: true,
    use: "Pendeln",
    price: "7000-10000",
    priceDisplay: "Ab EUR 7.000",
    model: "2018",
    bgText: "Iron 883",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/harley_iron883_2018.glb",
    image: "/bikes/harley_iron883_2018.webp",
    image2: "/bikes/2/harley_iron883_2018.webp",
  },
  {
    id: 7,
    name: "Yamaha RX-King 135",
    brand: "Yamaha",
    style: "Naked",
    cc: 132,
    ps: 18,
    kw: 13,
    accel: 8.5,
    topSpeed: 130,
    tank: 12.0,
    gear: "5-Gang",
    seat_height: 77.0,
    weight: 100,
    license: "A1",
    beginner: true,
    use: "Pendeln",
    price: "1500-3000",
    priceDisplay: "Ab EUR 1.500",
    model: "1983-2009",
    bgText: "RX-King",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/yamaha_rxking_135.glb",
    image: "/bikes/yamaha_rxking_135.webp",
    image2: "/bikes/2/yamaha_rxking_135.webp",
  },
  {
    id: 8,
    name: "Honda CRF 450R",
    brand: "Honda",
    style: "Motocross",
    cc: 450,
    ps: 62,
    kw: 46,
    accel: 4.2,
    topSpeed: 145,
    tank: 6.3,
    gear: "5-Gang",
    seat_height: 96.5,
    weight: 106,
    license: "Offroad",
    beginner: false,
    use: "Gelande",
    price: "6000-8500",
    priceDisplay: "Ab EUR 6.000",
    model: "2023",
    bgText: "CRF450R",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/honda_crf450r_2023.glb",
    image: "/bikes/honda_crf450r_2023.webp",
    image2: "/bikes/2/honda_crf450r_2023.webp",
  },
  {
    id: 9,
    name: "Yamaha DT 125 E",
    brand: "Yamaha",
    style: "Enduro",
    cc: 123,
    ps: 13,
    kw: 10,
    accel: 9.0,
    topSpeed: 115,
    tank: 9.5,
    gear: "5-Gang",
    seat_height: 80.0,
    weight: 103,
    license: "A1",
    beginner: true,
    use: "Gelande",
    price: "1200-2500",
    priceDisplay: "Ab EUR 1.200",
    model: "1974",
    bgText: "DT125E",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/yamaha_dt125e_1974.glb",
    image: "/bikes/yamaha_dt125e_1974.webp",
    image2: "/bikes/2/yamaha_dt125e_1974.webp",
  },
  {
    id: 10,
    name: "Yamaha 500 Custom",
    brand: "Yamaha",
    style: "Custom",
    cc: 500,
    ps: 48,
    kw: 35,
    accel: 5.5,
    topSpeed: 180,
    tank: 13.0,
    gear: "5-Gang",
    seat_height: 82.0,
    weight: 195,
    license: "A2",
    beginner: true,
    use: "Pendeln",
    price: "5500-7500",
    priceDisplay: "Ab EUR 5.500",
    model: "2024",
    bgText: "500Custom",
    has3D: true,
    glb: "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/yamaha_500custom.glb",
    image: "/bikes/yamaha_500custom.webp",
    image2: "/bikes/2/yamaha_500custom.webp",
  },
];

// ══════════════════════════════════════════════════════════════
//  SCORING CONFIGURATION
// ══════════════════════════════════════════════════════════════

const WEIGHT = Object.freeze({
  STYLE: 45, // Style preference match (highest)
  USE_CASE: 35, // Use case alignment
  BUDGET: 25, // Within budget range
  SEAT_HEIGHT: 30, // Ergonomic compatibility (max, degrades with diff) — as
  // heavily weighted as budget so rider height reliably decides between
  // otherwise-tied bikes, not just nudges the score
  PASSENGER: 15, // Passenger-capable bonus
  BEGINNER_PENALTY: -35, // Non-beginner bike for beginner rider
  LICENSE_FIT: 20, // Bike-Klasse entspricht der Fuehrerscheinklasse
  LICENSE_UNDER: -20, // Bike liegt zwei Klassen unter dem Schein (A -> A1)
  /* Verbreitung in Deutschland (2026-09-17, seit der Katalog den ganzen Markt umfasst).
     Unter ~2.500 Modellen erreichen viele denselben Score aus Stil, Einsatz, Budget und
     Sitzhöhe. Dann soll das Bike gewinnen, das hier tatsächlich gefahren und gehandelt
     wird — Neuzulassungen (KBA) bzw. Zahl der Inserate, im Katalog als `pop` (0–1). */
  POPULARITY: 18,
  /* Charakter: wie viel Maschine es sein soll (Frage 9, 2026-09-20). Gemeint ist nicht die
     Leistung in kW — die sagt ohne die Klasse nichts —, sondern wie weit das Bike die
     Führerscheinklasse ausreizt. Eine 11-kW-125er ist für A1 „so viel wie geht", für A
     ein Spielzeug. Gewichtet zwischen Sozius (15) und Führerschein (20): eine ernste
     Vorliebe, aber keine, die Stil oder Budget aussticht. */
  POWER: 20,
});

/* Was die Klasse hergibt. A ist offen — 120 kW als Bezug: darüber beginnt das, was
   auch in der offenen Klasse als viel gilt (S 1000 RR: 152 kW, R 1250 GS: 100 kW). */
const LEISTUNGS_DECKEL = Object.freeze({ A1: 11, B196: 11, A2: 35, A: 120 });
const LEISTUNGS_ZIEL = Object.freeze({ ruhig: 0.3, mittel: 0.6, voll: 1 });

/* Die Erfahrungsfrage (q2) hatte bisher nur zwei Wirkungen: Anfänger bekamen die Strafe für
   nicht-anfängertaugliche Maschinen, Wiedereinsteiger und Profis gar nichts — die dritte Antwort
   war also folgenlos. Jetzt verschiebt die Erfahrung, wie weit „so viel wie erlaubt" reicht:
   Wer zum ersten Mal fährt und die stärkste Maschine seiner Klasse anklickt, bekommt trotzdem
   nicht die schärfste. Die Klasse bleibt dieselbe — gedeckelt wird nur der Charakter. */
const CHARAKTER_DECKEL = Object.freeze({ "Anfänger": 0.75, Anfanger: 0.75, Wiedereinsteiger: 0.9 });
/* Nur dort, wo die Klasse echten Spielraum lässt. A1 und B196 enden bei 11 kW — die ganze Klasse ist
   anfängertauglich, und ein Deckel drehte die Frage dort um: „so viel wie erlaubt" lieferte weniger
   Leistung als „ruhig" (Golden Set, 20.09.). */
const DECKEL_KLASSEN = new Set(["A2", "A"]);

/* Körperliche Passung ist keine Geschmacksfrage: wer mit den Zehenspitzen nicht sicher steht, dem nützt
   die schönste Maschine nichts. Bisher kostete jeder Zentimeter Sitzhöhe 0,9 Punkte — eine 95er-Enduro
   konnte damit bei 1,65 m trotzdem gewinnen, wenn Stil und Preis stimmten. Jetzt deckelt zu viel Sitzhöhe
   das Gesamtergebnis, statt nur daran zu knabbern. */
const SITZ_TOLERANZ = 4; // cm über der sicheren Höhe, die niemanden stören
const KAPPE_HOCH = 0.85; // 4–8 cm darüber: geht, aber nie als bester Treffer
const KAPPE_ZU_HOCH = 0.6; // mehr als 8 cm darüber: nur noch am Rand sichtbar

/* Ein einzelnes Inserat ist ein echter Preis, aber kein Markt (katalog-de.json: `priceConfidence`).
   Solche Bikes dürfen mitspielen, sollen aber nicht wegen eines Zufallspreises gewinnen. */
const EINZELANGEBOT = 0.8;

/* Vielfalt in den Treffern: fünfmal dieselbe Familie in vier Baujahren ist kein Ergebnis, sondern eine
   Liste. Pro Familie einer, pro Marke höchstens zwei — gesucht wird eine Entscheidung, keine Aufzählung. */
const JE_MARKE = 2;

/* Rangfolge der Klassen fuer die Passung — NICHT fuer die Zulaessigkeit.
   Was jemand fahren DARF, steht in LICENSE_ALLOWS und wird vorher hart
   gefiltert. Hier geht es nur darum, was zu ihm passt: wer den unbegrenzten
   Schein hat, bekam bisher eine 125er mit derselben Punktzahl wie eine
   Maschine seiner Klasse. Offroad-Maschinen brauchen fuer die Strasse
   ohnehin den A-Schein und stehen deshalb auf derselben Stufe. */
const LICENSE_RANK = Object.freeze({ A1: 1, B196: 1, A2: 2, A: 3, Offroad: 3 });

/**
 * Darf dieser Fahrer dieses Motorrad fahren?
 *
 * Die Klasse im Katalog sagt, was die Maschine ab Werk verlangt. Viele A-Maschinen lassen sich aber auf
 * 35 kW drosseln und sind damit für A2 zugelassen — im Katalog steht das als `a2` (Feld a2_drosselbar aus
 * dem 1000PS-Datensatz). Ohne diese Zeile blieben 231 von 431 A2-tauglichen Bikes unsichtbar, darunter 6
 * der 8 A2-Supermotos (gemessen 2026-09-20, nachdem der Nutzer fragte, warum für A2 so wenig übrig bleibt).
 */
function darfFahren(bike, klasse, erlaubt) {
  if (erlaubt.has(bike.license)) return true;
  return klasse === "A2" && Boolean(bike.a2);
}

/** Muss die Maschine dafür gedrosselt werden? */
function gedrosselt(bike, klasse) {
  return klasse === "A2" && bike.license !== "A2" && Boolean(bike.a2) && LICENSE_RANK[bike.license] > 2;
}

/**
 * Ist das genau die Klasse, die gewählt wurde — nicht nur legal erlaubt? darfFahren() lässt für A2
 * auch A1-Maschinen durch (legal richtig: A2 schließt A1 ein), aber wer im Quiz A2 wählt, soll ein
 * A2-Bike bekommen, kein A1 (Nutzer 2026-09-26: „genau so bei den anderen" — gilt also für jede
 * Klasse). Eine gedrosselte A-Maschine zählt als A2, weil sie genau dafür verkauft und zugelassen
 * wird, nicht als Kompromiss.
 */
export function klassePasstExakt(bike, klasse) {
  const riderRank = LICENSE_RANK[klasse] || 3;
  const bikeRank = gedrosselt(bike, klasse) ? riderRank : LICENSE_RANK[bike.license] || 1;
  return bikeRank === riderRank;
}

/**
 * Passt der Stil des Bikes zur Wunschgattung? Exakt oder Teilstring in beide Richtungen (z. B.
 * "Sport touring" enthält "Touring"). Zentrale Stelle statt der bisherigen dreifachen Kopie —
 * dieselbe Logik entscheidet jetzt den harten Filter in findTopMatches() UND den Score in scoreBike().
 */
function stilPasstZu(bikeStyle, wantStyle) {
  const b = (bikeStyle || "").toLowerCase();
  const w = (wantStyle || "").toLowerCase();
  if (!b || !w) return false;
  return b === w || b.includes(w) || w.includes(b);
}

// License class compatibility (what each class can legally ride)
const LICENSE_ALLOWS = Object.freeze({
  A1: new Set(["A1"]),
  A2: new Set(["A1", "A2"]),
  A: new Set(["A1", "A2", "A", "Offroad"]),
  B196: new Set(["A1"]),
});

// Rider height (cm) to ideal seat height (cm) — linear fit through the
// previous brackets' midpoints (160cm -> 74, 172cm -> 80, 185cm -> 86)
function idealSeatFromHeight(heightCm) {
  if (!heightCm) return 80;
  return Math.min(92, Math.max(68, heightCm * 0.48 - 2.8));
}

/* Die Höhe, bei der man noch sicher steht. Ausschlaggebend ist in der Wirklichkeit die Schrittlänge,
   nicht die Körpergröße — danach wurde bis 2026-09-29 eigens gefragt. Die Frage ist entfallen: Sie
   schlug ohnehin nur die Näherung unten vor, und fast niemand hat den Vorschlag geändert.
   Übliche Näherung: Schritt ≈ 45 % der Größe. Mit beiden Ballen am Boden geht etwa die Schrittlänge
   selbst als Sitzhöhe durch.

   Der zweite Parameter bleibt bewusst stehen: Kommt die Frage zurück oder liefert ein Profil die
   Schrittlänge, reicht es, sie hier wieder hereinzureichen. */
function sichereSitzhoehe(heightCm, schrittCm) {
  const schritt = Number(schrittCm) || (Number(heightCm) || 175) * 0.45;
  return Math.min(95, Math.max(66, schritt * 1.03));
}

// Use case aliases for fuzzy matching
const USE_ALIASES = Object.freeze({
  Urlaub: "Touring",
  Wochenende: "Cruisen",
  Pendeln: "Pendeln",
  "Gelände": "Gelande",
  Gelande: "Gelande",
  Rennstrecke: "Rennstrecke",
  Cruisen: "Cruisen",
});

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════

let catalog = [...DEFAULT_CATALOG, ...FREIGEGEBENE_BIKES];

// ══════════════════════════════════════════════════════════════
//  VOLLKATALOG — der ganze deutsche Markt (seit 2026-09-17)
//
//  public/data/katalog-de.json entsteht aus dem Bikez-CSV (Marken mit
//  DE-Vertrieb, ab 2010) plus den Marktpreisen und Katalogdaten von 1000PS
//  (tools/catalog/matching_katalog.py). Aufgenommen ist, was nachweislich in
//  Deutschland gehandelt wird. Die Datei wird nachgeladen, nicht gebündelt:
//  bis sie da ist, rechnet die Seite mit den Bikes der Bildwerkstatt weiter.
// ══════════════════════════════════════════════════════════════

const KATALOG_URL = "/data/katalog-de.json";
let katalogLaden = null;

const schluessel = (b) => `${b.brand || ""} ${b.name || ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Anzeigepreis: „ca. 7.900 €" aus der Mitte von neu und gebraucht; ohne Preis „Preis folgt". */
function preisText(b) {
  // price=1 ist der Platzhalter aus der Katalogpipeline für "kein echter Preis
  // ermittelbar" (2026-09-27 Audit) — als Preis ausgegeben zeigte das "ca. 1 €"
  // an, obwohl bei vielen dieser Bikes priceNew/priceUsed längst vorliegen.
  // Erst daraus die Mitte bilden, bevor "Preis folgt" das letzte Wort hat.
  if (b.price && b.price > 1) return `ca. ${Math.round(b.price).toLocaleString("de-DE")} €`;
  if (b.priceNew && b.priceUsed) return `ca. ${Math.round((b.priceNew + b.priceUsed) / 2).toLocaleString("de-DE")} €`;
  if (b.priceUsed) return `ca. ${Math.round(b.priceUsed).toLocaleString("de-DE")} €`;
  if (b.priceNew) return `ca. ${Math.round(b.priceNew).toLocaleString("de-DE")} €`;
  return "Preis folgt";
}

function katalogEintrag(b, i) {
  return {
    ...b,
    id: 1000 + i,
    priceDisplay: b.priceDisplay || preisText(b),
    priceSource: b.priceUsed ? `1000PS Marktpreis ${b.priceYear || ""}`.trim() : b.priceSource,
    has3D: Boolean(b.has3D && b.glb),
  };
}

/** Bildwerkstatt und alte Klassiker behalten ihre Bilder und 3D-Modelle. */
function mische(neue) {
  const alt = new Map();
  for (const b of [...DEFAULT_CATALOG, ...FREIGEGEBENE_BIKES]) alt.set(schluessel(b), b);
  const out = [];
  neue.forEach((b, i) => {
    const e = katalogEintrag(b, i);
    const a = alt.get(schluessel(e));
    if (a) {
      alt.delete(schluessel(e));
      for (const k of ["image", "image2", "studio", "glb", "has3D", "accel", "topSpeed", "tank", "gear", "bgText"]) {
        if (e[k] === undefined || e[k] === null || e[k] === "") e[k] = a[k];
      }
      if (a.has3D && a.glb) { e.has3D = true; e.glb = a.glb; }
    }
    out.push(e);
  });
  /* Was nur im alten Katalog steht (die zehn Schaustücke mit 3D-Modell: NR750, RX-King, DT 125 E …),
     hängt hinten dran — und bekommt eine kleine Verbreitung: es sind Liebhaberstücke, keine Bikes,
     die hier jemand neu kauft. Ohne den Wert lagen sie mit 0,5 vor echten Marktmodellen. */
  const rest = [...alt.values()].map((b) => (typeof b.pop === "number" ? b : { ...b, pop: 0.25 }));
  return [...out, ...rest];
}

/**
 * Lädt den Vollkatalog einmal pro Sitzung. Schlägt das fehl (offline, Datei fehlt),
 * bleibt der eingebaute Katalog stehen — die Seite funktioniert weiter.
 * @returns {Promise<Array>} der Katalog, mit dem gerechnet wird
 */
export function ladeVollkatalog() {
  if (katalogLaden) return katalogLaden;
  katalogLaden = fetch(KATALOG_URL)
    .then((r) => {
      if (!r.ok) {
        console.warn("[matching] Vollkatalog nicht geladen: HTTP", r.status);
        return null;
      }
      return r.json();
    })
    .then((d) => {
      if (d && Array.isArray(d.bikes) && d.bikes.length) {
        setCatalog(mische(d.bikes));
        console.info(`[matching] Vollkatalog ${d.stand || ""}: ${d.bikes.length} Bikes aus dem deutschen Markt`);
      }
      return catalog;
    })
    .catch((e) => {
      console.warn("[matching] Vollkatalog nicht geladen:", e.message);
      return catalog;
    });
  return katalogLaden;
}

// ══════════════════════════════════════════════════════════════
//  INTERNAL: Parse price string to min value
// ══════════════════════════════════════════════════════════════

function parseMinPrice(priceStr) {
  if (typeof priceStr === "number") return priceStr;
  if (!priceStr) return 0;
  const match = String(priceStr).match(/(\d[\d.]*)/);
  return match ? parseInt(match[1].replace(/\./g, ""), 10) : 0;
}

/* Was das Bike mindestens kostet. `price` ist die Mitte aus neu und gebraucht; gefiltert wird
   über den Gebrauchtpreis, sonst fiele eine Maschine aus dem Budget, die es gebraucht längst
   darunter gibt (Nutzer 2026-09-17: „neuen und gebraucht preisen und daraus die mite ungefähr").
   `priceYears` hat den Marktpreis je Baujahr (1000PS) — mit Budget zählt das jüngste Baujahr,
   das hineinpasst: eine MT-125 von 2016 kostet 2.900 €, die von 2022 4.100 €. */
export function preisAb(bike, budget) {
  const wahl = preisWahl(bike, budget);
  return wahl.preis;
}

function preisWahl(bike, budget) {
  const jahre = bike?.priceYears;
  if (jahre && Number.isFinite(budget)) {
    let bestesJahr = null;
    let bestesPreis = Infinity;
    for (const [jahr, preis] of Object.entries(jahre)) {
      if (preis <= budget && (bestesJahr === null || Number(jahr) > bestesJahr)) {
        bestesJahr = Number(jahr);
        bestesPreis = preis;
      }
    }
    if (bestesJahr !== null) return { preis: bestesPreis, jahr: bestesJahr };
  }
  if (typeof bike?.priceUsed === "number") return { preis: bike.priceUsed, jahr: bike.priceYear ?? null };
  return { preis: parseMinPrice(bike?.price), jahr: null };
}

/* Sozius: das Gewicht allein reichte nicht mehr, seit der Katalog auch 125er, Supermotos
   und Roller enthält — eine 690 SMC R wiegt 150 kg und taugt trotzdem nicht für zwei,
   eine Vespa GTS 300 wiegt 158 kg und schon. Bauart zuerst, dann Gewicht/Hubraum. */
function soziusTauglich(bike) {
  if (bike.style === "Supermoto") return false;
  const cc = bike.cc || 0;
  const kg = bike.weight || 0;
  if (cc && cc < 125) return false;
  /* Enduro ist die einzige Gattung, in der beides vorkommt: die Reiseenduro mit Sitzbank für zwei
     (R 1250 GS, 249 kg) und die Wettbewerbsmaschine ohne (KTM 500 EXC-F, 106 kg). Das Gewicht
     trennt sie zuverlässig — eine zugelassene Enduro mit Soziusplatz wiegt ab 135 kg (Honda
     CRF300L 142 kg, KTM 690 Enduro R 146 kg). Ohne Gewichtsangabe entscheidet der Hubraum. */
  if (bike.style === "Enduro") return kg ? kg >= 135 : cc >= 250;
  /* Alle übrigen Straßenmaschinen ab 125 ccm haben serienmäßig einen Soziusplatz. Die alte Regel
     verlangte 170 kg oder 500 ccm und sortierte damit die halbe Mittelklasse aus: KTM 390 Duke
     (165 kg, 373 ccm), Kawasaki Ninja 400, BMW G 310 R — 48 Maschinen (gemessen 20.09.). */
  return cc >= 125 || kg >= 150;
}

// ══════════════════════════════════════════════════════════════
//  INTERNAL: Score a single bike against answers
// ══════════════════════════════════════════════════════════════

/* Wie weit reizt die Maschine die Klasse aus? 0 = zahm, 1 = am Anschlag.
   Ohne Leistungsangabe null — dann wird weder belohnt noch bestraft. */
function charakter(bike, klasse) {
  const kw = typeof bike.kw === "number" && bike.kw > 0 ? bike.kw : null;
  if (!kw) return null;
  // Gedrosselt fährt sie mit 35 kW, nicht mit ihrer vollen Leistung.
  const wirksam = gedrosselt(bike, klasse) ? Math.min(kw, 35) : kw;
  return Math.min(1, wirksam / (LEISTUNGS_DECKEL[klasse] || LEISTUNGS_DECKEL.A));
}

function scoreBike(bike, ctx) {
  const breakdown = {};
  let score = 0;

  // Style match
  /* „Ist mir egal": keine Gattung wird bevorzugt. Alle bekommen die volle Punktzahl, damit die
     Prozente vergleichbar bleiben — entschieden wird dann über Einsatz, Budget, Sitzhöhe und Markt.
     Bei einer konkreten Wunschgattung ist dieser Zweig inzwischen ein No-op: findTopMatches() filtert
     dann schon vorher hart auf stilPasstZu(), hier bleibt nur noch der Egal-Fall und die Einzelbewertung
     eines schon geöffneten Bikes (Match-Reiter, scoreBikeAgainst) übrig. */
  if (!ctx.style || (ctx.style || "").toLowerCase() === "egal") {
    score += WEIGHT.STYLE;
    breakdown.style = WEIGHT.STYLE;
  } else if (stilPasstZu(bike.style, ctx.style)) {
    score += WEIGHT.STYLE;
    breakdown.style = WEIGHT.STYLE;
  } else {
    breakdown.style = 0;
  }

  /* Einsatzzweck. `uses` (Vollkatalog) nennt neben dem Hauptzweck die Zweitzwecke — eine
     Reiseenduro fährt auch zur Arbeit. Hauptzweck volle Punkte, Zweitzweck 60 %. */
  const wantUse = (ctx.normalizedUse || "").toLowerCase();
  const passt = (u) => {
    const b = (u || "").toLowerCase();
    return b === wantUse || (b && wantUse && (b.includes(wantUse) || wantUse.includes(b)));
  };
  let useScore = 0;
  if (passt(bike.use)) useScore = WEIGHT.USE_CASE;
  else if (Array.isArray(bike.uses) && bike.uses.some(passt)) useScore = WEIGHT.USE_CASE * 0.6;
  score += useScore;
  breakdown.use = Math.round(useScore * 10) / 10;

  /* Budget-Passung.
     Vorher gab es die Punkte bedingungslos — eine 1.500-EUR-Maschine und eine
     fuer 13.000 standen bei einem Budget von 13.000 gleichauf. Guenstig ist
     kein Makel, aber wer eine Klasse hoeher sucht, soll sie auch bekommen:
     ab 40 % des Budgets gibt es die vollen Punkte, darunter linear weniger,
     mit einem Boden bei 20 % — ein billiges Bike faellt damit zurueck, wird
     aber nicht aussortiert. */
  const bikePrice = preisAb(bike, ctx.budgetMax);
  let budgetScore;
  if (!Number.isFinite(ctx.budgetMax)) {
    budgetScore = WEIGHT.BUDGET; // keine Budgetangabe -> niemanden bestrafen
  } else if (!bikePrice) {
    // Ohne Preis und mit Budget kommt hier keiner mehr an (harter Filter in findTopMatches). Dieser Zweig
    // gilt nur noch dem Einzelaufruf aus dem Match-Reiter: weder Schnaeppchen noch zu teuer.
    budgetScore = WEIGHT.BUDGET * 0.5;
  } else if (bikePrice > ctx.budgetMax) {
    budgetScore = 0;
  } else {
    const ratio = ctx.budgetMax > 0 ? bikePrice / ctx.budgetMax : 1;
    /* Volle Punkte ab 30 % des Budgets (vorher 40 %): Die meisten suchen bewusst günstig
       (Nutzer 2026-09-20) — ein Bike, das nur ein Drittel des Budgets kostet, ist für sie kein
       Makel, sondern der Grund für die Suche. Ganz ohne Gefälle bliebe die Auswahl allerdings
       immer am untersten Ende kleben, deshalb bleibt die Kurve. */
    budgetScore = WEIGHT.BUDGET * Math.min(1, Math.max(0.25, ratio / 0.3));
    if (bike.priceConfidence === "einzelangebot") budgetScore *= EINZELANGEBOT;
  }
  score += budgetScore;
  breakdown.budget = Math.round(budgetScore * 10) / 10;

  /* Fuehrerschein-Passung. Legal erlaubt ist die Maschine an dieser Stelle
     bereits (harter Filter). Die Frage ist nur noch, ob sie zur Klasse passt:
     gleiche Stufe gibt Punkte, zwei Stufen darunter kostet welche. */
  const riderRank = LICENSE_RANK[ctx.licenseClass] || 3;
  const drossel = gedrosselt(bike, ctx.licenseClass);
  // Gedrosselt ist die Maschine eine A2-Maschine — sie zählt deshalb als passend, nicht als zu groß.
  const bikeRank = drossel ? riderRank : LICENSE_RANK[bike.license] || 1;
  const stufen = riderRank - bikeRank;
  let licenseScore = 0;
  /* Eine Treppe statt einer Schwelle: Bisher kostete erst der Abstand von zwei Klassen Punkte —
     eine 125er stand damit für A2-Fahrer punktgleich neben einer A2-Maschine mit dreifacher
     Leistung und gewann über Preis und Verbreitung (Test des Nutzers 2026-09-20: A2 + Supermoto
     lieferte ab Platz zwei nur 125er). Jetzt kostet schon eine Klasse Abstand die halbe Strafe. */
  // Die Drosselung kostet Geld und Papierkram — deshalb drei Viertel der Punkte, nicht alle.
  if (stufen === 0) licenseScore = drossel ? WEIGHT.LICENSE_FIT * 0.75 : WEIGHT.LICENSE_FIT;
  else if (stufen === 1) licenseScore = WEIGHT.LICENSE_UNDER / 2;
  else if (stufen >= 2) licenseScore = WEIGHT.LICENSE_UNDER;
  // stufen < 0: die Maschine verlangt eine HÖHERE Klasse, als der Schein hergibt — das ist kein
  // "zu wenig ausgereizt" wie bei stufen>=2, sondern schlicht außer Reichweite. Härter bestraft als
  // die Unterforderung, nicht nur genauso stark.
  else if (stufen < 0) licenseScore = WEIGHT.LICENSE_UNDER * 1.5;
  score += licenseScore;
  breakdown.license = licenseScore;
  /* Der Abstand selbst, nicht nur die Punktzahl. Die Hinweise auf der Ergebnisseite leiteten
     den Text bisher aus dem Vorzeichen von breakdown.license ab — und schrieben „zwei Klassen
     unter deinem Fuehrerschein" auch dann, wenn die Maschine eine HOEHERE Klasse verlangt.
     Aus dem Vorzeichen allein laesst sich das nicht unterscheiden. */
  breakdown.licenseStufen = stufen;
  if (drossel) breakdown.drossel = true;

  /* Sitzhöhe. Ohne Angabe (im Vollkatalog fehlt sie bei rund einem Drittel) gibt es die
     halbe Punktzahl — ein unbekannter Wert soll weder belohnen noch bestrafen. */
  let seatScore;
  let kappe = 1;
  if (typeof bike.seat_height === "number" && bike.seat_height > 0) {
    seatScore = Math.max(0, WEIGHT.SEAT_HEIGHT - Math.abs(bike.seat_height - ctx.idealSeat) * 0.9);
    /* Die Kappe: zu hoch ist kein Punktabzug, sondern ein Grund, das Bike nicht nach oben zu lassen. */
    const ueber = bike.seat_height - (ctx.sicherSeat + SITZ_TOLERANZ);
    if (ueber > 4) kappe = KAPPE_ZU_HOCH;
    else if (ueber > 0) kappe = KAPPE_HOCH;
    if (kappe < 1) breakdown.seatWarn = Math.round(ueber * 10) / 10;
  } else {
    /* Ohne Angabe bisher pauschal die halbe Punktzahl. Für kleine Fahrer ist eine fehlende
       Sitzhöhe aber kein neutraler Wert, sondern ein Risiko: die MV Agusta Brutale 750S stand
       für eine 152 cm große Person auf Platz eins, ohne dass ihre Sitzhöhe irgendwo bekannt
       wäre (17 von 1.179 Bikes haben keine). Je enger der sichere Bereich, desto weniger zählt
       die Lücke — bei 70 cm noch ein Viertel, ab 82 cm wieder die Hälfte. */
    const vertrauen = Math.min(0.5, Math.max(0.25, 0.25 + (ctx.sicherSeat - 70) / 48));
    seatScore = WEIGHT.SEAT_HEIGHT * vertrauen;
  }
  score += seatScore;
  breakdown.seatHeight = Math.round(seatScore * 10) / 10;

  // Passenger capability
  if (ctx.wantsPassenger && soziusTauglich(bike)) {
    score += WEIGHT.PASSENGER;
    breakdown.passenger = WEIGHT.PASSENGER;
  } else {
    breakdown.passenger = 0;
  }

  /* Charakter (Frage 9). Wurde nicht gefragt — alte gespeicherte Antworten, Aufruf aus dem
     Match-Reiter —, bekommt jedes Bike die volle Punktzahl: eine Frage, die niemand beantwortet
     hat, darf keine Maschine schlechter dastehen lassen. */
  const zielRoh = LEISTUNGS_ZIEL[ctx.power];
  const deckel = DECKEL_KLASSEN.has(ctx.licenseClass) ? CHARAKTER_DECKEL[ctx.erfahrung] : undefined;
  const ziel = zielRoh === undefined ? undefined : (deckel ? Math.min(zielRoh, deckel) : zielRoh);
  /* Wurde die Frage nicht gestellt (alte gespeicherte Antworten, Aufruf aus dem Match-Reiter),
     zaehlt sie gar nicht mit — weder in der Punktzahl noch in der Obergrenze. Volle Punkte fuer
     alle waeren dasselbe, wuerden aber in den Balken der Detailseite als erfuellte Bedingung
     erscheinen, die niemand gestellt hat. */
  if (ziel !== undefined) {
    const c = charakter(bike, ctx.licenseClass);
    // Ohne Leistungsangabe die Mitte. Sonst: 0,6 Abstand im Charakter kostet alle Punkte.
    const powerScore = c === null ? WEIGHT.POWER * 0.5 : WEIGHT.POWER * Math.max(0, 1 - Math.abs(c - ziel) / 0.6);
    score += powerScore;
    breakdown.power = Math.round(powerScore * 10) / 10;
    breakdown.powerZiel = ziel;
  }

  /* Verbreitung: `pop` steht im Vollkatalog (Neuzulassungen, sonst Inserate und Bewertung).
     Bikes aus dem alten Katalog ohne Wert bekommen die Mitte, damit sie nicht zurückfallen. */
  const pop = typeof bike.pop === "number" ? Math.max(0, Math.min(1, bike.pop)) : 0.5;
  const popScore = WEIGHT.POPULARITY * pop;
  score += popScore;
  breakdown.popularity = Math.round(popScore * 10) / 10;

  // Beginner penalty
  if (ctx.isBeginner && !bike.beginner) {
    score += WEIGHT.BEGINNER_PENALTY;
    breakdown.beginnerPenalty = WEIGHT.BEGINNER_PENALTY;
  } else {
    breakdown.beginnerPenalty = 0;
  }

  // Die Kappe darf nur einen positiven Score kappen. Bei bereits negativem Score (z. B. wegen
  // BEGINNER_PENALTY oder falscher Führerscheinklasse) würde eine Multiplikation mit 0.6/0.85 den
  // Score näher an 0 heben — also BESSER machen, obwohl die zu hohe Sitzhöhe ein Malus sein soll.
  const gekappt = Math.max(0, score) * kappe + Math.min(0, score);
  return { bike, score: Math.round(gekappt * 10) / 10, breakdown };
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════

/**
 * Replace the default catalog with externally loaded bikes.
 * Call after fetching from Supabase/API.
 */
export function setCatalog(bikes) {
  if (!Array.isArray(bikes) || bikes.length === 0) {
    console.warn("[matching] Invalid catalog, keeping default.");
    return;
  }
  catalog = bikes;
  console.info(`[matching] Catalog loaded: ${catalog.length} bikes`);
}

/**
 * Get current catalog (for drop animation, etc.)
 */
export function getCatalog() {
  return catalog;
}

export function findBikeByShortName(shortName) {
  if (!shortName) return undefined;
  const q = shortName.toLowerCase();
  /* Genaue Treffer zuerst: seit der Katalog den ganzen Markt umfasst, würde die alte
     Teilstring-Suche sonst beim erstbesten Namen hängenbleiben, der den gesuchten enthält. */
  return (
    catalog.find((b) => b.name?.toLowerCase() === q) ||
    catalog.find((b) => b.bgText?.toLowerCase() === q) ||
    catalog.find((b) => b.name?.toLowerCase().includes(q))
  );
}

/* Slider-Obergrenze aus quiz.js Frage q5 (openEnded: true). Am Anschlag zeigt das Quiz "30.000 €+" —
   das Budget ist dort bewusst offen, keine harte Grenze bei genau 30.000 €. Ohne diese Umrechnung
   verschwand jedes Bike über 30.000 € aus dem Ergebnis, obwohl die UI "+" versprach. */
export const BUDGET_SLIDER_MAX = 30000;

/**
 * Baut den Bewertungs-Kontext aus den Quiz-Antworten. Einmal pro Suchlauf,
 * nicht pro Bike — und wiederverwendbar für die Einzelbewertung.
 */
function buildContext(answers = {}) {
  const budgetRoh = Number(answers.q5) || Infinity;
  const budgetMax = budgetRoh >= BUDGET_SLIDER_MAX ? Infinity : budgetRoh;
  return {
    allowedLicenses: LICENSE_ALLOWS[answers.q1] || new Set(["A1", "A2", "A"]),
    budgetMax,
    ctx: {
      style: answers.q3,
      normalizedUse: USE_ALIASES[answers.q4] || answers.q4,
      idealSeat: idealSeatFromHeight(Number(answers.q6)),
      sicherSeat: sichereSitzhoehe(Number(answers.q6)),
      wantsPassenger: answers.q7 === "Ja",
      isBeginner: answers.q2 === "Anfanger" || answers.q2 === "Anfänger",
      // Beide wandern jetzt in die Bewertung statt nur in den harten Filter.
      budgetMax,
      licenseClass: answers.q1,
      power: answers.q9,
      erfahrung: answers.q2,
    },
  };
}

/**
 * Bewertet EIN bereits bekanntes Bike gegen die Quiz-Antworten — dieselbe
 * Logik wie findTopMatches, nur ohne Katalog-Durchlauf. Für den Match-Reiter,
 * der zeigen soll, wie gut das gerade geöffnete Bike zum Profil passt.
 *
 * Zusätzlich zum Score kommen die harten Kriterien mit zurück (Führerschein,
 * Budget): findTopMatches filtert sie vorher weg, hier sind sie die
 * eigentliche Information — das Bike liegt ja schon auf dem Tisch.
 *
 * @returns { score, maxScore, pct, breakdown, fits } oder null ohne Bike
 */
export function scoreBikeAgainst(bike, answers) {
  if (!bike) return null;
  const { allowedLicenses, budgetMax, ctx } = buildContext(answers);
  const { score, breakdown } = scoreBike(bike, ctx);

  /* Ueber Budget ergibt in scoreBike() bereits 0 Punkte — das gilt hier
     genauso, nur ist die Information jetzt zusaetzlich als Merkmal gefragt:
     das Bike liegt ja schon auf dem Tisch und der Reiter sagt ausdruecklich,
     ob es passt. */
  // Kein Preis bekannt (preisAb liefert dann 0, nie eine positive endliche Zahl) heißt in
  // scoreBike() weder "passt" noch "passt nicht" (neutrale halbe Punktzahl) — hier, wo nur ein
  // Bool bleibt, wird das wie dort nicht als Malus behandelt statt als zufälliger Treffer über
  // den nackten Zahlenvergleich (0 <= budgetMax wäre sonst für JEDEN Preis "true").
  const bikePreisRoh = preisAb(bike, budgetMax);
  const preisBekannt = Number.isFinite(bikePreisRoh) && bikePreisRoh > 0;
  const fitsBudget = !preisBekannt || !Number.isFinite(budgetMax) || bikePreisRoh <= budgetMax;

  // Obergrenze abhängig vom Profil: der Sozius-Bonus ist nur erreichbar,
  // wenn überhaupt zu zweit gefahren werden soll — sonst wäre kein Bike je
  // bei 100 %.
  const maxScore =
    WEIGHT.STYLE +
    WEIGHT.USE_CASE +
    WEIGHT.BUDGET +
    WEIGHT.SEAT_HEIGHT +
    WEIGHT.LICENSE_FIT +
    WEIGHT.POPULARITY +
    (ctx.power ? WEIGHT.POWER : 0) +
    (ctx.wantsPassenger ? WEIGHT.PASSENGER : 0);

  return {
    score,
    maxScore,
    pct: Math.max(0, Math.min(100, Math.round((score / maxScore) * 100))),
    breakdown,
    fits: {
      license: darfFahren(bike, answers.q1, allowedLicenses),
      budget: fitsBudget,
    },
  };
}

/**
 * Ähnliche Bikes zu einem gegebenen Modell — ohne Quiz-Antworten.
 *
 * Der Match-Reiter soll auch dann Alternativen zeigen, wenn noch niemand das
 * Quiz gemacht hat. Maßstab ist dann nicht das Fahrerprofil, sondern das
 * offene Bike selbst: gleiche Gattung zuerst, danach Nähe bei Preis,
 * Leistung und Hubraum.
 *
 * @returns { bike, score }[] — absteigend, ohne das Ausgangs-Bike
 */
export function findSimilarBikes(bike, n = 3) {
  if (!bike) return [];
  // price=1 ist der Katalog-Platzhalter für "kein echter Preis ermittelbar"
  // (2026-09-27 Audit) — als echter Preis behandelt verzerrte er die
  // Ähnlichkeits-Wertung (Bikes ohne Preis wirkten fälschlich baugleich teuer).
  const refPriceRaw = parseMinPrice(bike.price);
  const refPrice = refPriceRaw > 1 ? refPriceRaw : null;
  const refPs = bike.ps || 1;
  const refCc = bike.cc || 1;
  // Ausgangsbike ausschließen: über die id, wenn beide eine haben (eindeutig, siehe
  // katalogEintrag()/FREIGEGEBENE_BIKES) — sonst könnten zwei gleichnamige Modelle
  // verschiedener Marken sich gegenseitig fälschlich ausschließen (name allein reicht nicht).
  const istAusgangsbike = (b) =>
    bike.id != null && b.id != null ? b.id === bike.id : b.brand === bike.brand && b.name === bike.name;

  const scored = catalog
    .filter((b) => !istAusgangsbike(b))
    .map((b) => {
      let score = 0;
      // Die Gattung wiegt schwerer als alle Nähe-Kriterien zusammen (50):
      // wer eine Cruiser ansieht, will keine Enduro vorgeschlagen bekommen,
      // nur weil der Preis zufällig passt.
      if ((b.style || "") === (bike.style || "")) score += 70;
      if ((b.use || "") === (bike.use || "")) score += 20;
      if ((b.license || "") === (bike.license || "")) score += 10;
      // Relative Abstände, damit ein 1.000-€-Unterschied bei einer 4.000-€-
      // Maschine schwerer wiegt als bei einer 20.000-€-Maschine.
      const bPrice = parseMinPrice(b.price);
      if (refPrice && bPrice > 1) {
        score += 25 * Math.max(0, 1 - Math.abs(bPrice - refPrice) / refPrice);
      }
      score += 15 * Math.max(0, 1 - Math.abs((b.ps || 0) - refPs) / refPs);
      score += 10 * Math.max(0, 1 - Math.abs((b.cc || 0) - refCc) / refCc);
      return { bike: b, score: Math.round(score * 10) / 10 };
    });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(n, scored.length));
}

/**
 * Gewichte als Obergrenzen für die Balken im Match-Reiter — die UI muss
 * sonst raten, wie viel von "45 Punkte Stil" erreichbar war.
 */
export const MATCH_WEIGHTS = WEIGHT;

/**
 * Länge der Ergebnisliste nach dem Quiz. Sie ist mehr als eine Anzeigegröße: findTopMatches()
 * lockert das Budget, bis mindestens so viele Bikes der Wunschgattung übrig sind — mit einer
 * anderen Länge kann also ein anderes Bike auf Platz eins landen.
 */
export const ERGEBNIS_ANZAHL = 5;

/**
 * Returns the single best matching bike object.
 * Maintains backward compatibility — returns the bike directly.
 *
 * Rechnet mit derselben Listenlänge wie die Ergebnisseite (garage.js). Mit n = 1 hielt die Walze
 * (drop-animation.js) auf 37.884 von 129.600 Quizwegen bei einem anderen Bike als dem, das die
 * Ergebnisseite danach zeigte.
 */
export function findBestBike(answers) {
  const results = findTopMatches(answers, ERGEBNIS_ANZAHL);
  return results.length > 0 ? results[0].bike : catalog[0];
}

/* Budget-Lockerungsfaktoren: Liefert das genannte Budget zu wenige Treffer der Wunschgattung, wächst
   nur das zugestandene Budget in diesen Schritten — der Stil bleibt in jeder Stufe hart. Faktor 1 ist
   das Ausgangsbudget selbst, Infinity die letzte Stufe vor dem völligen Fallenlassen des Stils. */
const BUDGET_LOCKERUNGS_STUFEN = [1, 1.3, 1.6, 2, 3, Infinity];

/**
 * Ein Durchlauf durch den Katalog: Führerschein hart, Klasse exakt hart, Budget hart, Stil hart (wenn
 * `wantStyle` gesetzt ist). Ein Bike ohne Preis fiel hier bisher durchs Raster (preisAb() liefert 0,
 * und 0 ist nie größer als das Budget) — wer ein Budget nennt, bekommt nur noch Bikes mit bekanntem
 * Preis; ohne Budget zählt weiter jedes.
 *
 * darfFahren() bleibt als rechtliche Untergrenze stehen, klassePasstExakt() ist der eigentliche,
 * schärfere Filter fürs Ergebnis: legal erlaubt ist hier nicht mehr genug, es muss die gewählte
 * Klasse selbst sein (Nutzer 2026-09-26).
 *
 * `preisPflicht` ist bewusst getrennt von `Number.isFinite(budgetLimit)`: die Stil-Lockerung (Stufe B)
 * ruft diese Funktion auch mit `budgetLimit = Infinity` auf, wenn selbst das höchste Vielfache nicht
 * reicht — das heißt aber nicht, dass der Nutzer gar kein Budget genannt hat. Ohne diese Trennung
 * rutschten Bikes ganz ohne Preisangabe in genau dieser Lockerungsstufe durch (Harley-Davidson Forty-
 * Eight bei A/Cruiser/500 €, Wachhund 25.09.) — ein Preis war ja verlangt, nur die Obergrenze offen.
 */
function ueberlebende(allowedLicenses, licenseClass, budgetLimit, wantStyle, preisPflicht) {
  const treffer = [];
  for (let i = 0; i < catalog.length; i++) {
    const bike = catalog[i];
    if (!darfFahren(bike, licenseClass, allowedLicenses)) continue;
    if (!klassePasstExakt(bike, licenseClass)) continue;
    if (preisPflicht || Number.isFinite(budgetLimit)) {
      const preis = preisAb(bike, budgetLimit);
      if (!preis || (Number.isFinite(budgetLimit) && preis > budgetLimit)) continue;
    }
    if (wantStyle && !stilPasstZu(bike.style, wantStyle)) continue;
    treffer.push(bike);
  }
  return treffer;
}

/**
 * Returns top N matches with score breakdowns.
 *
 * Staged pipeline:
 *   1. Hard filter: license class (exakt) + style (wenn genannt) + budget, stufenweise gelockert
 *   2. Score: weighted multi-factor evaluation
 *   3. Top-K: sort only what we need
 *
 * At 40,000 bikes: Phase 1 typically eliminates 60-80%,
 * Phase 2 scores ~8,000-16,000 survivors, Phase 3 partial-sorts.
 */
export function findTopMatches(answers, n = 5) {
  // Pre-compute context once (not per-bike)
  const { allowedLicenses, budgetMax, ctx } = buildContext(answers);
  const wantStyle = ctx.style && String(ctx.style).toLowerCase() !== "egal" ? ctx.style : null;

  /* Stufe A/B: Wer eine Gattung nennt, soll sie auch bekommen — Budget wächst erst, wenn die
     genannte Grenze zu wenige Treffer der Wunschgattung hergibt (siehe BUDGET_LOCKERUNGS_STUFEN).
     Ohne Wunschgattung ("Egal") reicht ein einziger Durchlauf mit dem genannten Budget. */
  let survivors = [];
  let budgetStufe = 1;
  /* Der Limit-Wert, mit dem tatsächlich gefiltert wurde — nicht immer budgetMax, siehe unten. Der
     Anzeigepreis am Ende (ergebnis.map) muss mit diesem Wert rechnen, sonst zeigt ein nur wegen der
     Lockerung aufgenommenes Bike einen Preis, der sogar über der gelockerten Grenze liegt: KTM 125 Duke
     passt bei 1.950 € über das Baujahr 2011 (1.920 €), preisWahl(bike, 1.500 €) findet dafür aber kein
     Baujahr und griff auf den allgemeinen Gebrauchtpreis zurück (3.537 €) — höher als die im Hinweis
     genannte Grenze. */
  let effektivBudget = budgetMax;
  // Wurde überhaupt ein Budget genannt? Entscheidet, ob ein Preis Pflicht ist — unabhängig davon, ob
  // die aktuell geprüfte Lockerungsstufe selbst schon unbegrenzt ist (siehe ueberlebende()).
  const preisPflicht = Number.isFinite(budgetMax);
  if (wantStyle) {
    for (const faktor of BUDGET_LOCKERUNGS_STUFEN) {
      const limit = Number.isFinite(budgetMax) && Number.isFinite(faktor) ? budgetMax * faktor : Infinity;
      survivors = ueberlebende(allowedLicenses, ctx.licenseClass, limit, wantStyle, preisPflicht);
      budgetStufe = faktor;
      effektivBudget = limit;
      if (survivors.length >= n || !Number.isFinite(budgetMax)) break;
    }
  } else {
    survivors = ueberlebende(allowedLicenses, ctx.licenseClass, budgetMax, null, preisPflicht);
  }

  /* Stufe C: Selbst ohne jede Budgetgrenze gibt es die Wunschgattung mit diesem Führerschein nicht
     (z. B. A1 + Tourer). Erst dann fällt der Stil — mit Pflichthinweis weiter unten, nie still. */
  let stilGelockert = false;
  if (wantStyle && survivors.length === 0) {
    stilGelockert = true;
    effektivBudget = budgetMax;
    survivors = ueberlebende(allowedLicenses, ctx.licenseClass, budgetMax, null, preisPflicht);
  }

  // Edge case: no bike fits the budget at all (e.g. budget below the
  // cheapest available bike). Don't drop the budget constraint — fall
  // back to whichever bike(s) of the exact license class are closest to it.
  let budgetReichtNicht = false;
  if (survivors.length === 0) {
    budgetReichtNicht = Number.isFinite(budgetMax);
    /* Nur Maschinen mit bekanntem Preis: preisAb() liefert für ein Bike ohne Preis 0, und 0 liegt
       bei einem Budget von 500 EUR näher dran als jeder echte Preis — deshalb standen hier bisher
       ausgerechnet die Bikes ohne Preisangabe (Wachhund über alle Kombinationen, 20.09.: 32.400
       Befunde). Wer ein Budget nennt, soll auch im Notfall nur Maschinen sehen, deren Preis
       belegt ist. Und die Sitzhöhe zählt hier genauso: für eine 150 cm große Person war die erste
       Empfehlung sonst eine Maschine, auf der sie nicht steht. Die Klasse bleibt auch im Notfall
       exakt (klassePasstExakt) — sonst zeigte ausgerechnet der Preisboden wieder ein A1-Bike für
       einen A2-Fahrer. */
    const mitPreis = catalog.filter((b) => klassePasstExakt(b, ctx.licenseClass) && preisAb(b, budgetMax) > 0);
    const pool = mitPreis.length > 0 ? mitPreis : catalog.filter((b) => preisAb(b, budgetMax) > 0);
    let closestPrice = Infinity;
    let closestDiff = Infinity;
    for (const b of pool) {
      const diff = Math.abs(preisAb(b, budgetMax) - budgetMax);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestPrice = preisAb(b, budgetMax);
      }
    }
    for (const b of pool) {
      if (preisAb(b, budgetMax) === closestPrice) survivors.push(b);
    }
    /* Reicht das nicht für fünf, kommen die nächstteureren dazu — sonst entscheidet allein der
       Zufall gleicher Preise, wie viele Vorschläge jemand sieht. */
    if (survivors.length < n) {
      for (const b of pool.slice().sort((x, y) =>
        Math.abs(preisAb(x, budgetMax) - budgetMax) - Math.abs(preisAb(y, budgetMax) - budgetMax))) {
        if (survivors.length >= n) break;
        if (!survivors.includes(b)) survivors.push(b);
      }
    }
  }

  // Still nothing? Return first bike as absolute fallback
  if (survivors.length === 0) {
    return [{ bike: catalog[0], score: 0, breakdown: {} }];
  }

  // Phase 2: Score survivors
  const scored = new Array(survivors.length);
  for (let i = 0; i < survivors.length; i++) {
    scored[i] = scoreBike(survivors[i], ctx);
  }

  // Phase 3: Top-K extraction
  // At < 10,000 candidates, full sort is fast enough (~2ms)
  // At 40K+, we could use quickselect, but sort is still < 10ms
  scored.sort((a, b) => b.score - a.score);

  /* Vielfalt: aus der sortierten Liste wandert nur ein Bike je Familie und höchstens zwei je Marke ins
     Ergebnis. Bleiben dadurch zu wenige übrig, füllen die übersprungenen wieder auf — leer ausgehen soll
     niemand. */
  const familie = (b) => `${b.brand || ""}|${(b.bgText || b.name || "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const gesehen = new Set();
  const jeMarke = new Map();
  const jeStil = new Map();
  /* „Ist mir egal“ heißt: zeig mir die Bandbreite. Ohne Grenze kamen in 36 % der Fälle fünf Bikes
     derselben Gattung heraus (gemessen über 720 Kombinationen, 20.09.) — wer keine Vorliebe angibt,
     bekam trotzdem fünfmal dasselbe. Bei einer genannten Wunschgattung gilt die Grenze nicht: dort
     sollen die Treffer ja gerade aus einer Gattung kommen. */
  const stilGrenze = String(ctx.style || "").toLowerCase() === "egal" ? 2 : Infinity;
  const auswahl = [];
  const zurueck = [];
  for (const r of scored) {
    if (auswahl.length >= n) break;
    const f = familie(r.bike);
    const m = (r.bike.brand || "").toLowerCase();
    const s = (r.bike.style || "").toLowerCase();
    if (gesehen.has(f) || (jeMarke.get(m) || 0) >= JE_MARKE || (jeStil.get(s) || 0) >= stilGrenze) {
      zurueck.push(r);
      continue;
    }
    gesehen.add(f);
    jeMarke.set(m, (jeMarke.get(m) || 0) + 1);
    jeStil.set(s, (jeStil.get(s) || 0) + 1);
    auswahl.push(r);
  }
  /* Nachfüllen in zwei Durchgängen: erst die, die die Markengrenze halten, dann der Rest. Vorher
     füllte der eine Durchgang blind auf und riss die Grenze — drei Hondas unter fünf Treffern
     (Wachhund über alle Kombinationen, 20.09.). Leer ausgehen soll aber weiter niemand, deshalb
     der zweite Durchgang ohne Grenze. */
  for (const streng of [true, false]) {
    for (const r of zurueck) {
      if (auswahl.length >= n) break;
      if (auswahl.includes(r)) continue;
      if (streng) {
        const mk = (r.bike.brand || "").toLowerCase();
        const schon = auswahl.filter((x) => (x.bike.brand || "").toLowerCase() === mk).length;
        if (schon >= JE_MARKE) continue;
      }
      auswahl.push(r);
    }
  }

  /* Eine nachträgliche Stilgarantie ist hier nicht mehr nötig: Ist eine Wunschgattung genannt, sind
     `survivors` (und damit `scored`/`auswahl`) durch den gestuften Filter oben bereits stilrein — außer
     Stufe C hat den Stil bewusst fallengelassen (`stilGelockert`), was unten seinen eigenen Hinweis bekommt. */

  /* Geeichte Prozente. „82 % von der Höchstpunktzahl" sagt niemandem etwas, weil fast jedes Bike dort
     landet. Die Hälfte der Anzeige misst deshalb, wie gut der Treffer an sich ist, die andere Hälfte,
     wie er gegen das restliche Feld dasteht. */
  const maxMoeglich =
    WEIGHT.STYLE + WEIGHT.USE_CASE + WEIGHT.BUDGET + WEIGHT.SEAT_HEIGHT +
    WEIGHT.LICENSE_FIT + WEIGHT.POPULARITY + (ctx.power ? WEIGHT.POWER : 0) +
    (ctx.wantsPassenger ? WEIGHT.PASSENGER : 0);
  const beste = scored[0].score;
  const schwaechste = scored[scored.length - 1].score;
  const spanne = Math.max(1, beste - schwaechste);

  /* Preisspanne: mindestens ein Treffer soll zeigen, was das Budget wirklich kauft. Gemessen am
     20.09.: ab etwa 10.000 EUR hörte die Budgetfrage auf zu wirken — 14.000 und 25.000 lieferten
     dasselbe Ergebnis, im Schnitt zu 34 % ausgeschöpft. Grund ist nicht die Budgetkurve (eine
     steilere brachte 34 auf 40 %), sondern die Verbreitung: teure Maschinen sind seltener
     gehandelt und verlieren an dieser Stelle. Günstig bleibt deshalb die Regel — nur der letzte
     Platz geht an eine Maschine aus der oberen Budgethälfte, wenn sonst keine dabei wäre. */
  if (Number.isFinite(ctx.budgetMax) && auswahl.length >= n) {
    const schwelle = ctx.budgetMax * 0.55;
    if (!auswahl.some((r) => preisAb(r.bike, ctx.budgetMax) >= schwelle)) {
      /* Der Tausch darf die Gattungsvielfalt nicht wieder einreißen: bei „Egal" bleibt die Grenze
         von zwei je Gattung auch hier gültig — sonst kämen in 4,7 % der Fälle wieder nur zwei
         Gattungen heraus (gemessen 20.09.). */
      const ohneLetzten = auswahl.slice(0, -1);
      const zaehler = new Map();
      const marken = new Map();
      for (const r of ohneLetzten) {
        const s = (r.bike.style || "").toLowerCase();
        zaehler.set(s, (zaehler.get(s) || 0) + 1);
        const mk = (r.bike.brand || "").toLowerCase();
        marken.set(mk, (marken.get(mk) || 0) + 1);
      }
      // Auch die Markengrenze gilt hier: sonst tauschte die Garantie eine dritte Honda ein
      // (Wachhund, 20.09.: A1/Sportbike/7.000 EUR/150 cm).
      const teuer = scored.find((r) => {
        if (auswahl.includes(r)) return false;
        if (preisAb(r.bike, ctx.budgetMax) < schwelle) return false;
        const s = (r.bike.style || "").toLowerCase();
        if ((zaehler.get(s) || 0) >= stilGrenze) return false;
        return (marken.get((r.bike.brand || "").toLowerCase()) || 0) < JE_MARKE;
      });
      if (teuer) auswahl[auswahl.length - 1] = teuer;
    }
  }

  /* Gibt es die Wunschgattung in dieser Klasse und diesem Budget überhaupt nicht, sagt das Ergebnis
     das — statt still mit anderem aufzufüllen. Für A1 existiert zum Beispiel kein einziger Tourer
     (Durchlauf über alle Kombinationen, 2026-09-20). */
  let hinweis = null;
  /* Reicht das Budget für gar nichts, sagt das Ergebnis es. Vorher zeigte die Seite einfach die
     günstigsten Maschinen, ohne zu erwähnen, dass sie über dem genannten Betrag liegen — wer 500 EUR
     eingibt und eine 1.390-EUR-Maschine sieht, muss das erfahren (Wachhund, 20.09.). */
  if (budgetReichtNicht && auswahl.length) {
    const guenstigste = Math.min(...auswahl.map((r) => preisAb(r.bike, ctx.budgetMax) || Infinity));
    if (Number.isFinite(guenstigste)) {
      hinweis = `Für ${Math.round(ctx.budgetMax).toLocaleString("de-DE")} € gibt es auf dem deutschen Markt nichts — das Günstigste liegt bei ${Math.round(guenstigste).toLocaleString("de-DE")} €.`;
    }
  } else if (stilGelockert) {
    // Stufe C: selbst ohne jede Budgetgrenze gibt es die Wunschgattung mit diesem Führerschein nicht.
    hinweis = `${ctx.style} gibt es mit deinem Führerschein nicht — das hier kommt am nächsten.`;
  } else if (wantStyle && budgetStufe > 1) {
    // Stufe B: die Wunschgattung gibt es, aber erst mit mehr Budget als genannt.
    const grenze = Number.isFinite(budgetMax * budgetStufe)
      ? `bis ${Math.round(budgetMax * budgetStufe).toLocaleString("de-DE")} €`
      : "ganz ohne Budgetgrenze";
    hinweis = `Für ${Math.round(budgetMax).toLocaleString("de-DE")} € gibt es nicht genug ${ctx.style}-Modelle mit deinem Führerschein — hier auch ${grenze}.`;
  }

  const ergebnis = auswahl.map((r) => {
    const absolut = Math.min(1, Math.max(0, r.score / maxMoeglich));
    const imFeld = Math.min(1, Math.max(0, (r.score - schwaechste) / spanne));
    const angereichert = {
      ...r,
      pct: Math.round(100 * (0.5 * absolut + 0.5 * imFeld)),
      warum: begruendung(r, ctx),
    };
    /* Der Treffer zeigt den Preis des Baujahrs, das ins Budget passt („ab Baujahr 2016, ca. 2.900 €") —
       sonst stünde am Ergebnis der Preis des jüngsten Modelljahrs, das der Nutzer sich gar nicht leisten
       wollte. Kopie, damit der Katalog unverändert bleibt. */
    /* Gefiltert wird mit dem Gebrauchtpreis des passenden Baujahrs — angezeigt werden musste bisher
       trotzdem die Mitte aus neu und gebraucht. Beides auseinanderlaufen zu lassen war ein Fehler: das
       Golden Set fand eine KTM RC 125 für 4.420 € im Ergebnis eines 2.500-€-Budgets, obwohl gefiltert
       korrekt mit 2.425 € (Baujahr 2015) worden war. Wer ein Budget nennt, sieht jetzt den Preis, mit
       dem gerechnet wurde. */
    const { preis, jahr } = preisWahl(r.bike, effektivBudget);
    if (!Number.isFinite(effektivBudget) || !preis || preis === r.bike.price) return angereichert;
    return {
      ...angereichert,
      bike: {
        ...angereichert.bike,
        price: preis,
        priceYear: jahr || r.bike.priceYear,
        priceUsed: preis,
        priceDisplay: `ca. ${Math.round(preis).toLocaleString("de-DE")} €`,
      },
    };
  });
  // Nicht aufzählbar, damit Code, der über die Treffer läuft, nichts davon merkt.
  Object.defineProperty(ergebnis, "hinweis", { value: hinweis, enumerable: false });
  /* Die Auswahl, aus der die Treffer stammen (nach Führerschein, Gattung und — ggf. gelockertem —
     Budget). Für den Wachhund (tools/matching-wachhund.mjs): eine Zusage wie "höchstens zwei je
     Marke" ist nur dann verletzt, wenn diese Auswahl eine Alternative hergegeben hätte. Gegen den
     ganzen Markt geprüft meldete er Tausende Fälle, in denen es schlicht keine gab. */
  Object.defineProperty(ergebnis, "auswahl", { value: survivors, enumerable: false });
  return ergebnis;
}

/**
 * Die Begründung zu einem Bike und einem Quiz-Profil — derselbe Weg wie scoreBikeAgainst(),
 * nur dass hier Sätze herauskommen statt Punkte. Für den Match-Reiter, der das offene Bike
 * gegen das Profil erklärt.
 *
 * @returns {{ plus: string[], aber: string[] }}
 */
export function begruendungFuer(bike, answers) {
  if (!bike || !answers) return { plus: [], aber: [], kurz: [] };
  const { ctx } = buildContext(answers);
  const { breakdown } = scoreBike(bike, ctx);
  return begruendung({ bike, breakdown }, ctx);
}

/**
 * Warum dieses Bike — in Sätzen, die ein Mensch liest, statt in Balken.
 * Zwei Listen: was dafür spricht, und was man wissen sollte. Das „Aber" bleibt drin, auch wenn es
 * die Prozentzahl schwächer aussehen lässt: ein Vorschlag, der die Nachteile verschweigt, hält nicht
 * bis zur Probefahrt.
 *
 * @returns {{ plus: string[], aber: string[] }}
 */
export function begruendung({ bike, breakdown }, ctx) {
  const plus = [];
  const aber = [];
  /* `kurz` ist dieselbe Aussage in zwei, drei Wörtern — für Chips in der Karte, wo ganze Sätze
     die Fläche erschlagen. Die langen Sätze bleiben für den Prüflauf und alles, was Platz hat. */
  const kurz = [];
  const euro = (v) => `${Math.round(v).toLocaleString("de-DE")} €`;

  if (breakdown.style > 0) {
    plus.push(`${bike.style} — genau der Stil, den du wolltest`);
    kurz.push({ art: "plus", text: bike.style });
  }
  if (breakdown.use >= WEIGHT.USE_CASE) {
    plus.push(`gemacht für ${ctx.normalizedUse || "deinen Einsatz"}`);
    kurz.push({ art: "plus", text: `für ${ctx.normalizedUse || "deinen Einsatz"}` });
  } else if (breakdown.use > 0) {
    plus.push(`taugt auch für ${ctx.normalizedUse || "deinen Einsatz"}`);
    kurz.push({ art: "plus", text: `auch für ${ctx.normalizedUse || "deinen Einsatz"}` });
  }

  /* Nur behaupten, was stimmt: im Ergebnis-Fünfer sind zu teure Bikes längst aussortiert, im
     Match-Reiter aber liegt das geöffnete Bike auf dem Tisch, egal was es kostet. Passt es nicht,
     sagt hier gar nichts zum Preis — die Karte nennt die Überschreitung ohnehin mit Zahl. */
  const preis = preisAb(bike, ctx.budgetMax);
  if (preis && Number.isFinite(ctx.budgetMax) && preis <= ctx.budgetMax) {
    const luft = ctx.budgetMax - preis;
    if (luft > ctx.budgetMax * 0.25) plus.push(`${euro(preis)} — ${euro(luft)} unter deinem Budget`);
    else plus.push(`${euro(preis)} — passt ins Budget`);
    kurz.push({ art: "plus", text: luft > ctx.budgetMax * 0.25 ? `${euro(luft)} unter Budget` : "im Budget" });
  }
  if (breakdown.drossel) {
    aber.push("muss für A2 auf 35 kW gedrosselt werden");
    kurz.push({ art: "aber", text: "Drosselung nötig" });
  }
  if (bike.priceConfidence === "einzelangebot") {
    aber.push("Preis stammt aus einem einzelnen Inserat, nicht aus einem Marktschnitt");
    kurz.push({ art: "aber", text: "Preis aus 1 Inserat" });
  }

  if (typeof bike.seat_height === "number" && bike.seat_height > 0) {
    if (breakdown.seatWarn > 4) {
      aber.push(`${bike.seat_height} cm Sitzhöhe — deutlich zu hoch für sicheren Stand`);
      kurz.push({ art: "aber", text: `${bike.seat_height} cm — zu hoch` });
    } else if (breakdown.seatWarn > 0) {
      aber.push(`${bike.seat_height} cm Sitzhöhe — du kommst nur auf die Zehenspitzen`);
      kurz.push({ art: "aber", text: `${bike.seat_height} cm — knapp` });
    } else {
      plus.push(`${bike.seat_height} cm Sitzhöhe — du stehst sicher`);
      kurz.push({ art: "plus", text: `${bike.seat_height} cm — sicherer Stand` });
    }
  }
  /* Charakter (Frage 9). Wer nach dem Temperament gefragt wurde, soll auch lesen, ob die Maschine
     trifft, was er wollte — sonst bleibt die Frage für ihn folgenlos. Genannt wird die Leistung,
     weil sie die Zahl hinter dem Gefühl ist. */
  if (breakdown.powerZiel !== undefined && typeof bike.kw === "number" && bike.kw > 0) {
    const anteil = breakdown.power / WEIGHT.POWER;
    const wort = { ruhig: "ruhig zu fahren", mittel: "ausgewogen motorisiert", voll: "reizt deine Klasse aus" };
    if (anteil >= 0.7) {
      plus.push(`${bike.kw} kW — ${wort[ctx.power] || "passt zu deinem Wunsch"}`);
      kurz.push({ art: "plus", text: `${bike.kw} kW` });
    } else if (anteil <= 0.3) {
      const satz = ctx.power === "voll"
        ? `${bike.kw} kW — zahmer, als du wolltest`
        : `${bike.kw} kW — mehr Maschine, als du wolltest`;
      aber.push(satz);
      kurz.push({ art: "aber", text: `${bike.kw} kW` });
    }
  }

  if (ctx.isBeginner && (bike.weight || 0) >= 220) {
    aber.push(`${bike.weight} kg sind viel für den Anfang`);
    kurz.push({ art: "aber", text: `${bike.weight} kg` });
  }
  if (ctx.isBeginner && breakdown.beginnerPenalty < 0) {
    aber.push("keine Anfängermaschine");
    kurz.push({ art: "aber", text: "nichts für den Anfang" });
  }
  if (ctx.wantsPassenger && breakdown.passenger > 0) {
    plus.push("für zwei geeignet");
    kurz.push({ art: "plus", text: "für zwei" });
  }
  if ((bike.listings || 0) >= 20) {
    plus.push(`${bike.listings} Angebote in Deutschland — leicht zu finden`);
    kurz.push({ art: "plus", text: `${bike.listings} Angebote` });
  } else if ((bike.listings || 0) > 0 && bike.listings <= 3) {
    aber.push(`nur ${bike.listings} Angebot(e) im Markt — Geduld nötig`);
    kurz.push({ art: "aber", text: `nur ${bike.listings} Angebote` });
  }

  return { plus, aber, kurz };
}
