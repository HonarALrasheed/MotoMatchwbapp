/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — marketplace.js  v3.0
 *  Suchlinks zu den großen Gebrauchtmärkten, schon auf ein Modell eingestellt.
 *
 *  Bis 2026-09-21 holte getLiveListings() über /api/search-places fünf
 *  Websuche-Treffer von Tavily dazu. Abgeschaltet auf Wunsch des Nutzers:
 *  Titel und Link ohne Preis, oft nur Kategorieseiten, und jede Suche
 *  kostete Geld. Die drei Links zeigen dagegen alle aktuellen Inserate.
 *  Alte Fassung und Endpoint: _archiv/2026-09-21/.
 * ══════════════════════════════════════════════════════════════
 */

export function buildSearchUrls(bikeName) {
  const query = encodeURIComponent(bikeName);
  return {
    kleinanzeigen: `https://www.kleinanzeigen.de/s-motorraeder-roller/${query}/k0c305`,
    mobile: `https://suchen.mobile.de/motorrad/search.html?q=${query}`,
    ebay: `https://www.ebay.de/sch/i.html?_nkw=${query}+motorrad`,
  };
}
