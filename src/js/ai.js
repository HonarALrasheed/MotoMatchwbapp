/**
 * KI-Begründung zum Quiz-Ergebnis.
 *
 * Der Endpoint /api/ai-match ruft OpenAI auf und kostet damit Geld. Er verlangt
 * deshalb eine gültige Supabase-Session (siehe api/_shared.js) — der
 * Authorization-Header hier ist kein Beiwerk, ohne ihn antwortet der Server mit
 * 401. Gleiches Muster wie src/js/voice.js für /api/livekit-token.
 */
import { supabase, OFFLINE_MODE } from "./supabase.js";
import { report } from "./monitoring.js";

const PROXY_URL = "/api/ai-match";
const NOT_AVAILABLE = "KI-Erklärung nicht verfügbar.";
const NEEDS_LOGIN = "Melde dich an, um die KI-Analyse zu sehen.";

export async function getAIExplanation(answers, bike) {
  const licenseLabels = {
    A1: "A1 (max. 125cc)",
    A2: "A2 (max. 35kW)",
    A: "Unbegrenzt (A)",
    B196: "B196 (125cc mit PKW-Schein)",
  };

  const payload = {
    answers: {
      license: licenseLabels[answers.q1] || answers.q1,
      experience: answers.q2,
      style: answers.q3,
      use: answers.q4,
      budget: answers.q5,
      height: answers.q6,
      passenger: answers.q7,
    },
    bike: {
      name: bike.name,
      brand: bike.brand,
      style: bike.style,
      cc: bike.cc,
      ps: bike.ps,
      weight: bike.weight,
      seat_height: bike.seat_height,
      license: bike.license,
    },
  };

  // Ohne Backend (Demo-Modus) oder ohne Anmeldung gibt es kein Token — den
  // Aufruf dann gar nicht erst absetzen, er könnte nur 401 werden.
  if (OFFLINE_MODE || !supabase) return NOT_AVAILABLE;

  let session = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch (err) {
    // getSession() wirft nur, wenn der Auth-Client selbst nicht kann: kein Netz
    // zum Token-Refresh, kaputter Storage. Der Nutzer sieht dieselbe Meldung wie
    // beim Proxy-Fehler unten — welcher der beiden Fälle es war, stünde ohne
    // das hier nirgends.
    report(err, { where: 'ai.getAIExplanation.getSession' })
    return NOT_AVAILABLE;
  }
  if (!session) return NEEDS_LOGIN;

  try {
    const proxyRes = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      return data.explanation || NOT_AVAILABLE;
    }
    // Fehlerformat des Servers: { error: { code, message } }.
    if (proxyRes.status === 401) return NEEDS_LOGIN;
    const body = await proxyRes.json().catch(() => ({}));
    return body?.error?.message || NOT_AVAILABLE;
  } catch (err) {
    // Proxy nicht erreichbar: offline, DNS, Function-Timeout, kaputtes Deployment.
    // Der Nutzer bekommt NOT_AVAILABLE zu sehen — welcher der Fälle es war,
    // stünde ohne das hier nirgends. Kein `payload` mitschicken: da stehen die
    // Quiz-Antworten drin.
    report(err, { where: 'ai.getAIExplanation', endpoint: PROXY_URL })
  }

  return NOT_AVAILABLE;
}
