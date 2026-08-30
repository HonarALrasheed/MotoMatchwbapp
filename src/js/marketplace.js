/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — marketplace.js  v2.1
 *  Marketplace listings über den Server-Proxy.
 *
 *  /api/search-places ruft Tavily auf und kostet damit Geld. Der Endpoint
 *  verlangt deshalb eine gültige Supabase-Session (siehe api/_shared.js) —
 *  ohne Authorization-Header antwortet er mit 401. Gleiches Muster wie
 *  src/js/voice.js für /api/livekit-token.
 *
 *  Ohne Anmeldung bleibt items leer; die Aufrufseite (garage.js) zeigt dann
 *  ihren Leerzustand mit den drei Suchlinks aus buildSearchUrls().
 * ══════════════════════════════════════════════════════════════
 */

import { supabase, OFFLINE_MODE } from "./supabase.js";

const PROXY_URL = "/api/search-places";

export function buildSearchUrls(bikeName) {
  const query = encodeURIComponent(bikeName);
  return {
    kleinanzeigen: `https://www.kleinanzeigen.de/s-motorraeder-roller/${query}/k0c305`,
    mobile: `https://suchen.mobile.de/motorrad/search.html?q=${query}`,
    ebay: `https://www.ebay.de/sch/i.html?_nkw=${query}+motorrad`,
  };
}

export async function getLiveListings(bikeName) {
  const urls = buildSearchUrls(bikeName);

  // Ohne Backend (Demo-Modus) oder ohne Anmeldung gibt es kein Token — den
  // Aufruf dann gar nicht erst absetzen, er könnte nur 401 werden.
  if (OFFLINE_MODE || !supabase) return { items: [], urls };

  let session = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch (_) {
    return { items: [], urls };
  }
  if (!session) return { items: [], urls };

  try {
    const proxyRes = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ bikeName }),
    });
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      return { items: data.items || [], urls };
    }
  } catch (_) {
    // Proxy nicht erreichbar
  }

  return { items: [], urls };
}
