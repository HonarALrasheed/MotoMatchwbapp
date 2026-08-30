import {
  checkOriginAndRate,
  requireUser,
  checkDailyLimit,
  sendError,
  report,
  takeString,
  isPlainObject,
} from "./_shared.js";

/**
 * Gebraucht-Angebote zu einem Modell (Tavily, kostenpflichtig).
 *
 * Der Zugang hängt an einer gültigen Supabase-Session, nicht am Origin-Header —
 * warum, steht ausführlich in _shared.js über checkOriginAndRate().
 */

/** Modellnamen sind kurz ("Yamaha MT-07"). Der längste Eintrag in
 *  matching.js/BIKE_DATA liegt weit darunter; 80 Zeichen sind Puffer, keine
 *  Einladung, ganze Absätze in die Suchanfrage zu schieben. */
const MAX_BIKE_NAME = 80;

export default async function handler(req, res) {
  if (checkOriginAndRate(req, res)) return;

  if (req.method !== "POST") {
    return sendError(res, 405, "method_not_allowed", "Method Not Allowed");
  }

  try {
    const auth = await requireUser(req);
    if (!auth) {
      return sendError(res, 401, "unauthorized", "Anmeldung erforderlich.");
    }

    // Konfigurationsprüfung bewusst NACH der Session — siehe ai-match.js.
    const TAVILY_KEY = process.env.TAVILY_KEY;
    if (!TAVILY_KEY) {
      report(new Error("TAVILY_KEY not configured"));
      return sendError(res, 500, "not_configured", "Dienst ist nicht verfügbar.");
    }

    if (!(await checkDailyLimit(auth.supabase, "search-places"))) {
      return sendError(res, 429, "daily_limit", "Tageslimit für Marktsuchen erreicht.");
    }

    const body = isPlainObject(req.body) ? req.body : {};
    const bikeName = takeString(body.bikeName, MAX_BIKE_NAME);
    if (!bikeName) {
      return sendError(res, 400, "invalid_body", "bikeName fehlt oder ist kein Text.");
    }

    const upstream = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query: `${bikeName} gebraucht kaufen Deutschland`,
        search_depth: "basic",
        max_results: 5,
        include_domains: [
          "kleinanzeigen.de",
          "mobile.de",
          "ebay.de",
          "ebay-kleinanzeigen.de",
        ],
      }),
    });

    if (!upstream.ok) {
      // Upstream-Text nur nach Sentry — siehe ai-match.js.
      const detail = await upstream.text();
      report(new Error(`Tavily upstream ${upstream.status}`), { body: detail });
      return sendError(res, 502, "upstream_error", "Marktsuche gerade nicht verfügbar.");
    }

    const data = await upstream.json();
    // new URL() wirft bei kaputten Treffer-URLs und riss früher die ganze
    // Antwort in den 500er-Zweig; ein unbrauchbarer Treffer fällt jetzt raus.
    const items = (Array.isArray(data.results) ? data.results : []).flatMap((r) => {
      let source;
      try {
        source = new URL(r.url).hostname.replace("www.", "");
      } catch {
        return [];
      }
      return [{
        title: takeString(r.title, 160),
        url: r.url,
        snippet: takeString(r.content, 120),
        source,
      }];
    });

    return res.status(200).json({ items });
  } catch (err) {
    report(err);
    return sendError(res, 500, "server_error", "Unerwarteter Fehler.");
  }
}
