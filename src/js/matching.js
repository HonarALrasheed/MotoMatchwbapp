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
});

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

/* Die Höhe, bei der man noch sicher steht. Gefragt ist die Schrittlänge (q8, freiwillig) — sie entscheidet
   in der Wirklichkeit, nicht die Körpergröße. Ohne Angabe die übliche Näherung: Schritt ≈ 45 % der Größe.
   Mit beiden Ballen am Boden geht etwa die Schrittlänge selbst als Sitzhöhe durch. */
function sichereSitzhoehe(heightCm, schrittCm) {
  const schritt = Number(schrittCm) || (Number(heightCm) || 175) * 0.45;
  return Math.min(95, Math.max(66, schritt * 1.03));
}

// Use case aliases for fuzzy matching
const USE_ALIASES = Object.freeze({
  Urlaub: "Touring",
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

// Pre-built index for fast license filtering at 40K+ scale
let licenseIndex = buildLicenseIndex(catalog);

function buildLicenseIndex(bikes) {
  const index = {};
  for (let i = 0; i < bikes.length; i++) {
    const lic = bikes[i].license || "A";
    if (!index[lic]) index[lic] = [];
    index[lic].push(i);
  }
  return index;
}

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
  if (!b.price) return "Preis folgt";
  return `ca. ${Math.round(b.price).toLocaleString("de-DE")} €`;
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
    .then((r) => (r.ok ? r.json() : null))
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
function preisAb(bike, budget) {
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
  if ((bike.cc || 0) && bike.cc < 125) return false;
  if (["Touring", "Cruiser", "Klassiker", "Roller"].includes(bike.style)) return (bike.cc || 0) >= 125;
  return (bike.weight || 0) >= 170 || (bike.cc || 0) >= 500;
}

// ══════════════════════════════════════════════════════════════
//  INTERNAL: Score a single bike against answers
// ══════════════════════════════════════════════════════════════

function scoreBike(bike, ctx) {
  const breakdown = {};
  let score = 0;

  // Style match
  const bikeStyle = (bike.style || "").toLowerCase();
  const wantStyle = (ctx.style || "").toLowerCase();
  if (
    bikeStyle === wantStyle ||
    bikeStyle.includes(wantStyle) ||
    wantStyle.includes(bikeStyle)
  ) {
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
    budgetScore = WEIGHT.BUDGET * Math.min(1, Math.max(0.2, ratio / 0.4));
    if (bike.priceConfidence === "einzelangebot") budgetScore *= EINZELANGEBOT;
  }
  score += budgetScore;
  breakdown.budget = Math.round(budgetScore * 10) / 10;

  /* Fuehrerschein-Passung. Legal erlaubt ist die Maschine an dieser Stelle
     bereits (harter Filter). Die Frage ist nur noch, ob sie zur Klasse passt:
     gleiche Stufe gibt Punkte, zwei Stufen darunter kostet welche. */
  const riderRank = LICENSE_RANK[ctx.licenseClass] || 3;
  const bikeRank = LICENSE_RANK[bike.license] || 1;
  let licenseScore = 0;
  if (bikeRank === riderRank) licenseScore = WEIGHT.LICENSE_FIT;
  else if (riderRank - bikeRank >= 2) licenseScore = WEIGHT.LICENSE_UNDER;
  score += licenseScore;
  breakdown.license = licenseScore;

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
    seatScore = WEIGHT.SEAT_HEIGHT * 0.5;
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

  return { bike, score: Math.round(score * kappe * 10) / 10, breakdown };
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════════

/**
 * Replace the default catalog with externally loaded bikes.
 * Call after fetching from Supabase/API.
 * Rebuilds internal indexes for fast filtering.
 */
export function setCatalog(bikes) {
  if (!Array.isArray(bikes) || bikes.length === 0) {
    console.warn("[matching] Invalid catalog, keeping default.");
    return;
  }
  catalog = bikes;
  licenseIndex = buildLicenseIndex(catalog);
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
    catalog.find((b) => b.name.toLowerCase() === q) ||
    catalog.find((b) => b.bgText?.toLowerCase() === q) ||
    catalog.find((b) => b.name.toLowerCase().includes(q))
  );
}

/**
 * Baut den Bewertungs-Kontext aus den Quiz-Antworten. Einmal pro Suchlauf,
 * nicht pro Bike — und wiederverwendbar für die Einzelbewertung.
 */
function buildContext(answers = {}) {
  return {
    allowedLicenses: LICENSE_ALLOWS[answers.q1] || new Set(["A1", "A2", "A"]),
    budgetMax: Number(answers.q5) || Infinity,
    ctx: {
      style: answers.q3,
      normalizedUse: USE_ALIASES[answers.q4] || answers.q4,
      idealSeat: idealSeatFromHeight(Number(answers.q6)),
      sicherSeat: sichereSitzhoehe(Number(answers.q6), Number(answers.q8)),
      wantsPassenger: answers.q7 === "Ja",
      isBeginner: answers.q2 === "Anfanger" || answers.q2 === "Anfänger",
      // Beide wandern jetzt in die Bewertung statt nur in den harten Filter.
      budgetMax: Number(answers.q5) || Infinity,
      licenseClass: answers.q1,
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
  const fitsBudget = preisAb(bike, budgetMax) <= budgetMax;

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
    (ctx.wantsPassenger ? WEIGHT.PASSENGER : 0);

  return {
    score,
    maxScore,
    pct: Math.max(0, Math.min(100, Math.round((score / maxScore) * 100))),
    breakdown,
    fits: {
      license: allowedLicenses.has(bike.license),
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
  const refPrice = parseMinPrice(bike.price) || 1;
  const refPs = bike.ps || 1;
  const refCc = bike.cc || 1;

  const scored = catalog
    .filter((b) => b.name !== bike.name)
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
      score += 25 * Math.max(0, 1 - Math.abs(parseMinPrice(b.price) - refPrice) / refPrice);
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
 * Returns the single best matching bike object.
 * Maintains backward compatibility — returns the bike directly.
 */
export function findBestBike(answers) {
  const results = findTopMatches(answers, 1);
  return results.length > 0 ? results[0].bike : catalog[0];
}

/**
 * Returns top N matches with score breakdowns.
 *
 * Three-phase pipeline:
 *   1. Hard filter: license class + budget ceiling
 *   2. Score: weighted multi-factor evaluation
 *   3. Top-K: sort only what we need
 *
 * At 40,000 bikes: Phase 1 typically eliminates 60-80%,
 * Phase 2 scores ~8,000-16,000 survivors, Phase 3 partial-sorts.
 */
export function findTopMatches(answers, n = 5) {
  // Pre-compute context once (not per-bike)
  const { allowedLicenses, budgetMax, ctx } = buildContext(answers);

  // Phase 1: Hard filter — O(n)
  const survivors = [];
  for (let i = 0; i < catalog.length; i++) {
    const bike = catalog[i];

    // License hard constraint
    if (!allowedLicenses.has(bike.license)) continue;

    /* Budget — gerechnet wird mit dem Gebrauchtpreis des passenden Baujahrs. Ein Bike ohne Preis fiel hier
       bisher durchs Raster: preisAb() liefert 0, und 0 ist nie größer als das Budget — also überlebte jede
       Maschine ohne Preisangabe jeden Budget-Filter und bekam danach noch die halben Budget-Punkte. Wer ein
       Budget nennt, bekommt jetzt nur noch Bikes mit bekanntem Preis; ohne Budget zählt weiter jedes. */
    const preis = preisAb(bike, budgetMax);
    if (Number.isFinite(budgetMax)) {
      if (!preis || preis > budgetMax) continue;
    }

    survivors.push(bike);
  }

  // Edge case: no bike fits the budget at all (e.g. budget below the
  // cheapest available bike). Don't drop the budget constraint — fall
  // back to whichever license-eligible bike(s) are closest to it.
  if (survivors.length === 0) {
    const licenseMatches = catalog.filter((b) => allowedLicenses.has(b.license));
    const pool = licenseMatches.length > 0 ? licenseMatches : catalog;
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
  const auswahl = [];
  const zurueck = [];
  for (const r of scored) {
    if (auswahl.length >= n) break;
    const f = familie(r.bike);
    const m = (r.bike.brand || "").toLowerCase();
    if (gesehen.has(f) || (jeMarke.get(m) || 0) >= JE_MARKE) {
      zurueck.push(r);
      continue;
    }
    gesehen.add(f);
    jeMarke.set(m, (jeMarke.get(m) || 0) + 1);
    auswahl.push(r);
  }
  for (const r of zurueck) {
    if (auswahl.length >= n) break;
    auswahl.push(r);
  }

  /* Stilgarantie: wer „Naked" wählt, soll mindestens eine Naked sehen, solange das Budget eine hergibt.
     Ohne diese Regel verdrängten bei knappem Budget andere Gattungen mit besserer Führerscheinpassung den
     einzigen Treffer der Wunschgattung — bei 1.500 € stand keine einzige Naked im Ergebnis, obwohl es eine
     gab (Golden Set, Profil „Sparfuchs"). */
  if (ctx.style) {
    const wunsch = String(ctx.style).toLowerCase();
    const passt = (r) => String(r.bike.style || "").toLowerCase() === wunsch;
    if (!auswahl.some(passt)) {
      const bester = scored.find(passt);
      if (bester) {
        if (auswahl.length < n) auswahl.push(bester);
        else auswahl[auswahl.length - 1] = bester;
      }
    }
  }

  /* Geeichte Prozente. „82 % von der Höchstpunktzahl" sagt niemandem etwas, weil fast jedes Bike dort
     landet. Die Hälfte der Anzeige misst deshalb, wie gut der Treffer an sich ist, die andere Hälfte,
     wie er gegen das restliche Feld dasteht. */
  const maxMoeglich =
    WEIGHT.STYLE + WEIGHT.USE_CASE + WEIGHT.BUDGET + WEIGHT.SEAT_HEIGHT +
    WEIGHT.LICENSE_FIT + WEIGHT.POPULARITY + (ctx.wantsPassenger ? WEIGHT.PASSENGER : 0);
  const beste = scored[0].score;
  const schwaechste = scored[scored.length - 1].score;
  const spanne = Math.max(1, beste - schwaechste);

  return auswahl.map((r) => {
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
    const { preis, jahr } = preisWahl(r.bike, budgetMax);
    if (!Number.isFinite(budgetMax) || !preis || preis === r.bike.price) return angereichert;
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
}

/**
 * Die Begründung zu einem Bike und einem Quiz-Profil — derselbe Weg wie scoreBikeAgainst(),
 * nur dass hier Sätze herauskommen statt Punkte. Für den Match-Reiter, der das offene Bike
 * gegen das Profil erklärt.
 *
 * @returns {{ plus: string[], aber: string[] }}
 */
export function begruendungFuer(bike, answers) {
  if (!bike || !answers) return { plus: [], aber: [] };
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
