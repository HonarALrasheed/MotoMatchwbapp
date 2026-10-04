/**
 * ══════════════════════════════════════════════════════════════════
 *  RSS-Feeds für Pinterest — /pins/feed/<bauart>.xml (Rewrite in vercel.json)
 *
 *  Pinterest liest verknüpfte Feeds selbst ein und macht aus jedem neuen
 *  Eintrag einen Pin auf der Pinnwand, die beim Verknüpfen gewählt wurde.
 *  Ein Feed je Bauart, damit jede Pinnwand ihre eigenen Bikes bekommt.
 *
 *  Der Plan (api/_pins-plan.js, aus scripts/pins/bauen.mjs) legt fest, wann
 *  welcher Pin frei wird: 12 am Tag, abwechselnd nach Bauart. Der Feed zeigt
 *  nur, was schon frei ist — so tropfen die Pins von allein, ohne Upload.
 *  Einträge mit csv: true gingen per CSV-Upload raus und bleiben hier weg,
 *  sonst gäbe es sie doppelt.
 *
 *  /pins/feed/ratgeber.xml: die Ratgeber-Artikel, ein Pin pro Tag
 *  (api/_ratgeber-pins.js aus scripts/pins/ratgeber.mjs).
 * ══════════════════════════════════════════════════════════════════
 */
import plan from "./_pins-plan.js";
import ratgeberPlan from "./_ratgeber-pins.js";

const BASIS = "https://motomatch.studio";
const ARTEN = {
  enduro: "Enduro", naked: "Naked", sportbike: "Sportbike", roller: "Roller",
  cruiser: "Cruiser", touring: "Touring", klassiker: "Klassiker", supermoto: "Supermoto",
};
const MAX_EINTRAEGE = 50;

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

export default function handler(req, res) {
  const schluessel = String(req.query.art || "").toLowerCase();
  // Ratgeber: eigener Plan (scripts/pins/ratgeber.mjs), Link auf den Artikel statt aufs Bike
  if (schluessel === "ratgeber") {
    const jetzt = Date.now();
    const frei = ratgeberPlan.filter((e) => e.ab <= jetzt).sort((a, b) => b.ab - a.ab).slice(0, MAX_EINTRAEGE);
    return senden(res, schluessel, "Ratgeber", frei.map((e) => ({
      titel: e.t, link: `${BASIS}/ratgeber/${e.s}/?utm_source=pinterest&amp;utm_medium=rss&amp;utm_campaign=ratgeber`,
      guid: `motomatch-ratgeber-${e.s}`, ab: e.ab, text: e.d, bild: `${BASIS}/pins/ratgeber/${e.s}.jpg`,
    })));
  }
  const art = ARTEN[schluessel];
  if (!art) {
    res.status(404).send("Unbekannte Bauart");
    return;
  }
  const jetzt = Date.now();
  const frei = plan
    .filter((e) => e.art === art && !e.csv && e.ab <= jetzt)
    .sort((a, b) => b.ab - a.ab)
    .slice(0, MAX_EINTRAEGE);

  return senden(res, schluessel, art, frei.map((e) => ({
    titel: e.t, link: `${BASIS}/?motorrad=${e.s}&amp;utm_source=pinterest&amp;utm_medium=rss&amp;utm_campaign=bikes`,
    guid: `motomatch-pin-${e.s}`, ab: e.ab, text: e.d, bild: `${BASIS}/pins/${e.s}.jpg`,
  })));
}

function senden(res, schluessel, name, eintraege) {
  const items = eintraege.map((e) => `
    <item>
      <title>${xml(e.titel)}</title>
      <link>${e.link}</link>
      <guid isPermaLink="false">${e.guid}</guid>
      <pubDate>${new Date(e.ab).toUTCString()}</pubDate>
      <description>${xml(e.text)}</description>
      <enclosure url="${e.bild}" type="image/jpeg" length="0"/>
      <media:content url="${e.bild}" medium="image" type="image/jpeg" width="1000" height="1500"/>
    </item>`).join("");

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  // Eine Stunde im CDN: neue Freigaben kommen spätestens dann an, Pinterest liest ohnehin seltener
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=600");
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>MotoMatch – ${xml(name)}</title>
    <link>${BASIS}/</link>
    <atom:link href="${BASIS}/pins/feed/${schluessel}.xml" rel="self" type="application/rss+xml"/>
    <description>Motorräder aus dem MotoMatch-Katalog: Daten, Preise, Führerschein.</description>
    <language>de-de</language>${eintraege[0] ? `
    <lastBuildDate>${new Date(eintraege[0].ab).toUTCString()}</lastBuildDate>` : ""}${items}
  </channel>
</rss>
`);
}
