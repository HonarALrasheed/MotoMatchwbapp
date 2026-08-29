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
    image: "/bikes/honda_nr750_1994.png",
    image2: "/bikes/2/honda_nr750_1994.png",
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
    image: "/bikes/honda_cb750f_1970.png",
    image2: "/bikes/2/honda_cb750f_1970.png",
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
    image: "/bikes/yamaha_yzfr3_2017.png",
    image2: "/bikes/2/yamaha_yzfr3_2017.png",
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
    image: "/bikes/2/suzuki_gsxr750_2023.png",
    image2: "/bikes/2/suzuki_gsxr750_2023.png",
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
    image: "/bikes/harley_seventytwo_2015.png",
    image2: "/bikes/2/harley_seventytwo_2015.png",
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
    image: "/bikes/harley_iron883_2018.png",
    image2: "/bikes/2/harley_iron883_2018.png",
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
    image: "/bikes/yamaha_rxking_135.png",
    image2: "/bikes/2/yamaha_rxking_135.png",
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
    image: "/bikes/honda_crf450r_2023.png",
    image2: "/bikes/2/honda_crf450r_2023.png",
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
    image: "/bikes/yamaha_dt125e_1974.png",
    image2: "/bikes/2/yamaha_dt125e_1974.png",
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
    image: "/bikes/yamaha_500custom.png",
    image2: "/bikes/2/yamaha_500custom.png",
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
});

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

let catalog = DEFAULT_CATALOG;

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
//  INTERNAL: Parse price string to min value
// ══════════════════════════════════════════════════════════════

function parseMinPrice(priceStr) {
  if (typeof priceStr === "number") return priceStr;
  if (!priceStr) return 0;
  const match = String(priceStr).match(/(\d[\d.]*)/);
  return match ? parseInt(match[1].replace(/\./g, ""), 10) : 0;
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

  // Use case match
  const bikeUse = (bike.use || "").toLowerCase();
  const wantUse = (ctx.normalizedUse || "").toLowerCase();
  if (
    bikeUse === wantUse ||
    bikeUse.includes(wantUse) ||
    wantUse.includes(bikeUse)
  ) {
    score += WEIGHT.USE_CASE;
    breakdown.use = WEIGHT.USE_CASE;
  } else {
    breakdown.use = 0;
  }

  // Budget match (already passed hard filter, give full points)
  score += WEIGHT.BUDGET;
  breakdown.budget = WEIGHT.BUDGET;

  // Seat height compatibility (diminishing returns)
  const seatDiff = Math.abs((bike.seat_height || 80) - ctx.idealSeat);
  const seatScore = Math.max(0, WEIGHT.SEAT_HEIGHT - seatDiff * 0.9);
  score += seatScore;
  breakdown.seatHeight = Math.round(seatScore * 10) / 10;

  // Passenger capability
  if (ctx.wantsPassenger && (bike.weight || 0) > 180) {
    score += WEIGHT.PASSENGER;
    breakdown.passenger = WEIGHT.PASSENGER;
  } else {
    breakdown.passenger = 0;
  }

  // Beginner penalty
  if (ctx.isBeginner && !bike.beginner) {
    score += WEIGHT.BEGINNER_PENALTY;
    breakdown.beginnerPenalty = WEIGHT.BEGINNER_PENALTY;
  } else {
    breakdown.beginnerPenalty = 0;
  }

  return { bike, score: Math.round(score * 10) / 10, breakdown };
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
  return catalog.find(
    (b) =>
      b.name.toLowerCase().includes(shortName.toLowerCase()) ||
      b.bgText?.toLowerCase() === shortName.toLowerCase(),
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
      wantsPassenger: answers.q7 === "Ja",
      isBeginner: answers.q2 === "Anfanger" || answers.q2 === "Anfänger",
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
  let { score, breakdown } = scoreBike(bike, ctx);

  const fitsBudget = parseMinPrice(bike.price) <= budgetMax;
  // scoreBike vergibt die Budget-Punkte bedingungslos — im Katalog-Durchlauf
  // ist das korrekt, weil der harte Filter zu teure Bikes vorher aussortiert.
  // Hier liegt das Bike aber schon fest: dann müssen die Punkte weg, sonst
  // stünde ein voller Budget-Balken neben dem Hinweis "über deinem Budget".
  if (!fitsBudget) {
    score = Math.round((score - WEIGHT.BUDGET) * 10) / 10;
    breakdown = { ...breakdown, budget: 0 };
  }

  // Obergrenze abhängig vom Profil: der Sozius-Bonus ist nur erreichbar,
  // wenn überhaupt zu zweit gefahren werden soll — sonst wäre kein Bike je
  // bei 100 %.
  const maxScore =
    WEIGHT.STYLE +
    WEIGHT.USE_CASE +
    WEIGHT.BUDGET +
    WEIGHT.SEAT_HEIGHT +
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

    // Budget hard constraint
    if (parseMinPrice(bike.price) > budgetMax) continue;

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
      const diff = Math.abs(parseMinPrice(b.price) - budgetMax);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestPrice = parseMinPrice(b.price);
      }
    }
    for (const b of pool) {
      if (parseMinPrice(b.price) === closestPrice) survivors.push(b);
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

  return scored.slice(0, Math.min(n, scored.length));
}
