/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — affiliate.js
 *  Produktlinks in Partnerlinks umschreiben
 * ══════════════════════════════════════════════════════════════
 *
 * Die Ausrüstungsseite verlinkt 64 Produkte zu drei Shops. Jeder läuft über
 * ein anderes Netzwerk — nachgeschlagen, nicht geraten:
 *
 *   fc-moto.com  (34 Links)  →  Webgains        bis 6 % · 30 Tage Cookie
 *   louis.de     (23 Links)  →  belboon         bis 5 % · 30 Tage Cookie
 *   amazon.de     (7 Links)  →  Amazon PartnerNet
 *
 * Drei Netzwerke, drei Link-Bauarten. Deshalb steht hier kein allgemeiner
 * Umschreiber, sondern pro Shop genau der Weg, den sein Netzwerk verlangt.
 *
 * ── Warum die Kennungen nicht hier stehen ──────────────────────────────
 * Sie gehören zum Partnerkonto und stehen in `.env`. Das VITE_-Präfix ist
 * Absicht: sie werden im Browser gebraucht und stehen ohnehin sichtbar in
 * jedem erzeugten Link — geheim ist daran nichts.
 *
 * Fehlt eine Kennung, bleibt der Link unverändert. Die Seite funktioniert
 * dann genau wie vorher, nur ohne Provision — kein Sonderfall, kein toter
 * Link. Man kann also einzelne Programme nacheinander freischalten.
 *
 * ── Kennzeichnung ──────────────────────────────────────────────────────
 * Partnerlinks sind in Deutschland kennzeichnungspflichtig. `hatPartnerLinks()`
 * sagt der Oberfläche, ob überhaupt welche aktiv sind — der Hinweis erscheint
 * dann und nur dann.
 */

const env = import.meta.env

/** Amazon PartnerNet: Tracking-ID, endet auf .de üblicherweise auf "-21". */
const AMAZON_TAG = (env.VITE_AMAZON_TAG || '').trim()

/* belboon (louis.de): Hier gehört die **komplette** Basis-Trackingadresse aus
   dem belboon-Konto hinein, z. B.
     https://www1.belboon.de/tracking/000000123.html
   Sie ist nicht aus einer Nummer zusammensetzbar — belboon erzeugt sie je
   Programm. Das Ziel hängen wir unten als `deeplink=` an. */
const BELBOON_LOUIS = (env.VITE_BELBOON_LOUIS_BASE || '').trim()

/* Webgains (fc-moto.com): zwei Nummern.
     wgcampaignid — deine Publisher-Kampagne, für alle Programme gleich
     wgprogramid  — das Programm, hier FC-Moto DE */
const WEBGAINS_CAMPAIGN = (env.VITE_WEBGAINS_CAMPAIGN_ID || '').trim()
const WEBGAINS_PROGRAM_FCMOTO = (env.VITE_WEBGAINS_PROGRAM_FCMOTO || '').trim()

/** Domain ohne "www.", oder '' wenn die Adresse unbrauchbar ist. */
function domainVon(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Hängt einen Parameter an eine fertige Basisadresse.
 * Ob dort schon ein "?" steht, weiss nur die Adresse selbst — die Netzwerke
 * geben ihre Basis-Links in beiden Formen aus.
 */
function mitParameter(basis, name, wert) {
  const trenner = basis.includes('?') ? '&' : '?'
  return `${basis}${trenner}${name}=${encodeURIComponent(wert)}`
}

/**
 * Schreibt einen Produktlink in einen Partnerlink um.
 *
 * @param {string} url Die Shop-Adresse aus gear.js
 * @returns {{ href: string, partner: boolean }} `partner` sagt, ob wirklich
 *   umgeschrieben wurde — nur dann ist es ein bezahlter Link.
 */
export function partnerLink(url) {
  const unveraendert = { href: url, partner: false }
  if (!url) return unveraendert

  const domain = domainVon(url)
  if (!domain) return unveraendert

  // ── Amazon: Kennung als Parameter anhängen ──
  if (domain.endsWith('amazon.de') || domain.endsWith('amazon.com')) {
    if (!AMAZON_TAG) return unveraendert
    try {
      const ziel = new URL(url)
      // set statt append: eine mitgelieferte fremde Kennung bliebe sonst
      // stehen und die Provision ginge woandershin.
      ziel.searchParams.set('tag', AMAZON_TAG)
      return { href: ziel.toString(), partner: true }
    } catch {
      return unveraendert
    }
  }

  // ── Louis über belboon: Ziel als deeplink an die Basisadresse ──
  if (domain.endsWith('louis.de') || domain.endsWith('louis.at')) {
    if (!BELBOON_LOUIS) return unveraendert
    return { href: mitParameter(BELBOON_LOUIS, 'deeplink', url), partner: true }
  }

  // ── FC-Moto über Webgains: Zähl-Link mit Kampagnen- und Programmnummer ──
  if (domain.endsWith('fc-moto.com') || domain.endsWith('fc-moto.de')) {
    if (!WEBGAINS_CAMPAIGN || !WEBGAINS_PROGRAM_FCMOTO) return unveraendert
    const href =
      'https://track.webgains.com/click.html' +
      `?wgcampaignid=${encodeURIComponent(WEBGAINS_CAMPAIGN)}` +
      `&wgprogramid=${encodeURIComponent(WEBGAINS_PROGRAM_FCMOTO)}` +
      `&wgtarget=${encodeURIComponent(url)}`
    return { href, partner: true }
  }

  return unveraendert
}

/**
 * Ist mindestens ein Partnerprogramm eingerichtet?
 * Steuert den Kennzeichnungshinweis in der Oberfläche.
 */
export function hatPartnerLinks() {
  if (AMAZON_TAG) return true
  if (BELBOON_LOUIS) return true
  return Boolean(WEBGAINS_CAMPAIGN && WEBGAINS_PROGRAM_FCMOTO)
}
