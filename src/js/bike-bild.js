/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — bike-bild.js
 *  Ein Bild für jedes Bike — auch für die, die noch keins haben.
 *
 *  Seit 2026-09-17 kommt der Katalog aus dem ganzen deutschen Markt
 *  (public/data/katalog-de.json, tools/catalog/matching_katalog.py). Fotos
 *  gibt es erst für die Bikes, die durch die Bildwerkstatt gelaufen sind.
 *  Für alle anderen steht hier seit 2026-09-19 EIN Motorrad, das es so nicht
 *  gibt: markenlos, einfarbig grau, gerechnet mit demselben Modell und
 *  denselben Studio-Beschreibungen wie die echten Bilder
 *  (tools/catalog/platzhalter_ki.py). Es passt dadurch in die Seite, und weil
 *  es keine Marke trägt, hält es niemand für das gesuchte Modell. Wo Platz
 *  ist, schreibt die Seite „Foto folgt" daneben.
 *
 *  Die flachen Bauart-Silhouetten von vorher (platzhalter_bilder.py) liegen
 *  weiter in public/bikes/platzhalter/ — sie werden nur nicht mehr gezeigt.
 * ══════════════════════════════════════════════════════════════
 */

const ART_SUFFIX = { titel: "", kachel: "_kachel", studio: "_studio" };

/** Hat das Bike ein echtes Foto (Bildwerkstatt) — oder nur die Silhouette? */
export function hatFoto(bike) {
  return Boolean(bike && (bike.image2 || bike.image || bike.studio));
}

/**
 * Pfad des Platzhalters. art: "titel" | "kachel" | "studio".
 * Der Stil spielt keine Rolle mehr — es ist für alle dasselbe Motorrad.
 */
export function platzhalterBild(stil, art = "titel") {
  return `/bikes/platzhalter/universal${ART_SUFFIX[art] ?? ""}.webp`;
}

/**
 * Die Kachel fürs Handy — oder nichts.
 *
 * Am Handy zeigt der Hero die eng beschnittene Kachel statt des Panoramas. Das geht nur mit den
 * freigestellten Kacheln aus der Bildwerkstatt (`…_kachel.webp`) und dem Platzhalter: die zehn alten
 * Schaustücke tragen im selben Feld ein Werbefoto mit Schriftzug und Hintergrund — das stand nach dem
 * ersten Versuch als Plakat im Hero (2026-09-19). Passt nichts, bleibt es beim Titelbild.
 */
export function kachelFuerHero(bike) {
  const k = bikeBild(bike, "kachel");
  return /_kachel\.webp$/.test(k) ? k : null;
}

/**
 * Das Bild eines Bikes in der gewünschten Art — echtes Foto, sonst Silhouette.
 *   titel  = freigestellt auf der 1600×437-Fläche (Hero, Walze, Empfehlungen)
 *   kachel = 840×600, eng zugeschnitten (Suche, Konto, Vergleich)
 *   studio = 1280×960 im dunklen Studio (Rahmen neben den Daten)
 */
export function bikeBild(bike, art = "titel") {
  if (!bike) return platzhalterBild(null, art);
  if (art === "kachel" && bike.image) return bike.image;
  if (art === "studio" && bike.studio) return bike.studio;
  if (art === "titel" && (bike.image2 || bike.image)) return bike.image2 || bike.image;
  return platzhalterBild(bike.style, art);
}
