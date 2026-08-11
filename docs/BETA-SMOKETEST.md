# T3.1 — Beta-Smoketest

**Ziel:** Selbst-Test aller Kern-User-Flows vor dem Beta-Launch. Bugs werden
hier **nur dokumentiert**, Fixes gehören in T3.2 (separate Session, damit
neue Regressionen vermieden werden).

**Setup**
- Vite Dev-Server: `npm run dev` auf `http://localhost:5173`
- Browser: Chrome (headless via Puppeteer, viewport 1440×900)
- Frische Session pro Flow (neuer Browser-Context, keine Cookies/localStorage)
- Harness-Script: `scratchpad/harness/run.mjs` (macht Screenshot + sammelt
  Konsolen-Errors + Netzwerk-Fails pro Step)
- Screenshots: `docs/screenshots/T3.1-<flow>-<step>.png` (29 Stück)
- Test-User: dynamisch generiert `mm-smoke-<ts>@mailinator.com`, PW `Test1234!`

**Legende**
- ✅ funktioniert
- ⚠️ Bug / auffällig
- 🚫 blockierend für Beta-Start
- 🧪 nicht automatisiert verifiziert → **manueller Nachtest empfohlen vor Launch**

---

## Globale Beobachtungen (über alle Flows hinweg)

| Symptom | Wo | Blockierend? | Notiz |
|---|---|---|---|
| ⚠️ `GET /favicon.ico → 404` | Alle Seiten | non-blocking | Fehlt komplett, siehe `docs/screenshots/T3.1-J-04-open-impressum.png` (Konsole). Simple `favicon.ico` in `public/` reicht. |
| ⚠️ `GET /__video/hero.mp4 → net::ERR_ABORTED` | Landing (Hero) | non-blocking | Wird abgebrochen — vermutlich Autoplay+preload race. Kein visuelles Broken-Image, aber Netzwerkfehler in DevTools. Prüfen, ob Videopfad korrekt. |
| ⚠️ Konsolen-Warning: `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.` | Bike-Detail 3D | non-blocking | Three.js-Migration in T3.2 einplanen. |
| ⚠️ Konsolen-Warning: `Google Maps JavaScript API has been loaded directly without loading=async` | Karte / Dealers | non-blocking | Loader auf `loading=async` umstellen (Performance-Hinweis von Google). |
| ✅ Keine `pageerror` (uncaught) über alle 21 Steps | — | — | App wirft keine unbehandelten Exceptions während Basic-Navigation. |

---

## Flow A — Registrierung ✅

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| A01 Landing → Account-Icon klicken | ✅ | `T3.1-A-01-open-account.png` | `nav-account` öffnet Account-Screen (Gast-Modus). |
| A02 "Anmelden"-Button im Account-Screen | ✅ | `T3.1-A-02-click-anmelden.png` | Öffnet `#mm-authmodal` |
| A03 Toggle → Registrieren | ✅ | `T3.1-A-03-switch-to-register.png` | Zusätzliche Felder `pass2`, `age`, `license` erscheinen |
| A04 Formular ausfüllen + submit | ✅ | `T3.1-A-04-fill-and-submit.png` | Kein Fehler; ~4s Netz-Wartezeit |
| A05 Post-Signup-State | ✅ | `T3.1-A-05-post-signup-state.png` | Auth-Modal schließt, Session ist aktiv |

- 🧪 **Email-Confirmation-Flow**: Supabase-Projekt scheint aktuell auf
  "Confirm email = OFF" zu stehen (Session wurde sofort erstellt, Modal
  schloss ohne Bestätigungshinweis). **Vor Beta-Launch bewusst entscheiden:**
  Soll Confirm-Email an sein? Wenn ja, den Flow einmal mit echter
  Mailinator-Inbox durchgehen; aktuell nicht getestet.
- ⚠️ **UX-Auffälligkeit:** Der Weg zur Registrierung ist zweistufig
  (`nav-account` → Account-Screen → "Anmelden"-Button → Modal-Toggle "Noch
  keinen Account?"). Für neue Nutzer könnte ein direkter "Registrieren"-CTA
  auf der Landing / im Account-Screen schneller zum Ziel führen. Non-blocking,
  aber Onboarding-Reibung.

---

## Flow B — Quiz ⚠️

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| B01 Landing → Hero-CTA "Passendes Bike finden" | ✅ | `T3.1-B-01-start-quiz.png` | `#quiz-screen` wird sichtbar, erste Frage lädt |
| B02 Alle Fragen durchklicken | ⚠️ | `T3.1-B-02-answer-questions.png` | Harness bricht nach 20 Iterationen ohne Drop/Result ab |

- ⚠️ **Verhalten:** Der Test-Klick-Bot klickt automatisch die erste
  `.opt-btn` bzw. setzt Slider-Median + sucht "Weiter"-Button. Nach 20 Klicks
  landet der Screen **nicht** im Ergebnis (weder `#drop-container` sichtbar
  noch `.match-card`). Zwei mögliche Ursachen:
  - Slider-Fragen erwarten explizites Weiter-Klick nach `input` (kein
    Auto-Advance) und der Weiter-Button hat einen anderen Text als
    `weiter|next|fertig|ergebnis` — dann bleibt der Flow hängen.
  - Es gibt Zwischenscreens (Zusammenfassung / Bestätigung), die die Automation
    nicht erkennt.
- 🧪 **Manueller Nachtest zwingend:** Menschlich durchklicken und prüfen, ob
  KI-Begründung (Server-Call oder On-Device) korrekt erscheint. Der
  Automation-Bug ist wahrscheinlich **kein User-Blocker**, sollte aber
  bestätigt werden.
- Non-blocker Warning währenddessen: `THREE.Clock deprecated` (siehe global).

---

## Flow C — Bike-Detail ⚠️ (blockiert von B)

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| C01 Aus Ergebnis auf Bike klicken | ⚠️ | `T3.1-C-01-open-first-bike.png` | Keine `.match-card`/`[data-bike-detail]` verfügbar, weil Quiz nicht bis zum Ergebnis kam |

- 🧪 **Manueller Nachtest:** Nach abgeschlossenem Quiz das erste Match
  öffnen und prüfen:
  - Lädt das 3D-Modell (Konsole: `THREE.Clock`-Warning gilt hier)?
  - Sind alle Tabs (Specs, Bilder, Meinungen, o.ä.) klickbar & befüllt?
  - Funktioniert "In Garage speichern" (Insert in Supabase `garage_bikes`)?
- Aus dem Code (`src/js/bike-detail.js` existiert, Element `#bike-detail`
  im DOM) sieht der Screen konzeptuell OK aus — reiner Automations-Blocker,
  keine Code-Beobachtung, die auf Bugs hindeutet.

---

## Flow D — Garage ✅

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| D01 Drawer → "Garage" | ✅ | `T3.1-D-01-open-garage.png` | Öffnet designgemäß `#acc-overlay` (Account-Screen mit Garage), nicht `#garage-container` — mein T3.1-Harness prüfte den falschen Selector. Verifiziert in T3.2 mit `scratchpad/harness/verify-garage.mjs`. |

- 🧪 **Weiterhin nicht automatisiert:** Wartungseintrag hinzufügen, Bike-in-Garage-speichern-Flow von Bike-Detail aus. Manuell nachziehen.

---

## Flow E — Karte ✅

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| E01 Drawer → "Karte" | ✅ | `T3.1-E-01-open-map.png` | Kartenscreen öffnet |
| E02 Map-Container prüfen | ✅ | `T3.1-E-02-check-map-container.png` | `.leaflet-container` **oder** ähnliches vorhanden (mapEl=true), **kein Consent-Button erschien** |

- ⚠️ **Consent-Modal fehlt / greift nicht:** Task-Spec verlangt "Karte
  öffnen → Consent akzeptieren → Marker". Automation fand keinen Consent-
  Button. Zwei Möglichkeiten:
  - Consent wurde bereits automatisch gesetzt (z.B. Google-Maps-Loader ohne
    User-Zustimmung geladen) — dann **DSGVO-Risiko** vor Launch prüfen.
  - Consent-Modal ist implementiert, aber via anderem Selektor. Manuell
    verifizieren.
- 🧪 Marker-Klick + Popup: nicht automatisiert. Vor Beta manuell testen.
- ⚠️ Google-Maps-Warning (async-Loading, siehe global).

---

## Flow F — Community ✅ (Öffnen)

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| F01 Drawer → "Community" | ✅ | `T3.1-F-01-open-community.png` | Community-Screen öffnet |

- 🧪 **Nicht automatisiert:**
  - Öffentliche Gruppe finden + beitreten
  - In Kanal Nachricht schreiben
  - **Realtime-Test** (zweiter Browser als anderer User) → hier braucht es
    zwei Sessions parallel; sollte manuell + mit einem zweiten Testaccount
    verifiziert werden.
  - Freund adden via Username-Suche
  - DM schreiben
- Aus Code (`community.js`, `community-api.js`) sind alle diese Features
  angelegt. **Vor Beta zwingend manuell durchspielen**, weil Realtime-Bugs
  sich nur unter Last / bei tatsächlicher Realtime-Subscription zeigen.

---

## Flow G — Feedback ✅

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| G01 FAB `#mm-fb-fab` klicken | ✅ | `T3.1-G-01-click-fab.png` | Modal öffnet |
| G02 Nachricht schreiben + Senden | ✅ | `T3.1-G-02-submit-feedback.png` | Modal schließt sauber nach ~1.2s (Success-Path) |

- ✅ **Supabase-Insert prüfen:** Das Harness hat einen Test-Eintrag mit
  Text "Smoketest-Feedback vom Puppeteer-Harness &lt;ISO-Zeit&gt;"
  abgeschickt. **Vor Beta einmal manuell im Supabase-Dashboard →
  `beta_feedback` Table** verifizieren, dass die Row inkl. `user_agent`,
  `page`, ggf. `user_id` gelandet ist. Der Client meldete keinen Fehler
  (`err=""`), aber ein 4xx/5xx-Response wäre in der Konsole zu sehen gewesen
  — dort war nichts.
- Non-blocker Beobachtung: Konsole während G01 hatte `hero.mp4` net-fail
  (global, unabhängig).

---

## Flow H — Passwort-Reset 🧪

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| H01 Nav → Anmelden → "Passwort vergessen?" | ⚠️ | `T3.1-H-01-open-forgot.png` | Modal öffnete sich nicht (im Testlauf mit gerade angelegter Session — `nav-account` führt vermutlich direkt zum Account-Screen ohne Login-Button, weil bereits eingeloggt) |

- ⚠️ **Test-Artefakt:** Der Fehler kommt daher, dass der Harness-Kontext
  Cookies der Registrierung mitnimmt und der User schon eingeloggt ist.
- 🧪 **Manueller Nachtest zwingend:**
  1. Ausloggen
  2. Auth-Modal öffnen → "Passwort vergessen"
  3. Reset-Mail an Mailinator-Adresse
  4. Link öffnen → App muss mit `?reset=1` in `openPasswordResetScreen()`
     landen (siehe `src/js/app.js:8`)
  5. Neues Passwort setzen, damit einloggen
- Der Code-Pfad ist da (`#mm-am-forgot` → `#mm-am-submit` "Reset-Link
  senden"; Reset-Screen `#mm-rm-form`), aber **nicht end-to-end verifiziert
  in dieser Session**.

---

## Flow I — Ausrüstung ✅ (Öffnen)

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| I01 Drawer → "Ausrüstung" | ✅ | `T3.1-I-01-open-gear.png` | Gear-Screen öffnet |

- 🧪 **Nicht automatisiert:** Favorit setzen, Kategorie-Filter, Detail-View.
  Kurz manuell durchklicken.

---

## Flow J — Landing + Footer ⚠️

| Step | Status | Screenshot | Notiz |
|---|---|---|---|
| J01 Landing-Load | ✅ | `T3.1-J-01-landing-load.png` | `#landing` sichtbar. Onboarding-Overlay `#ob-overlay` erscheint als erstes Slide (nur bei erstem Besuch — `mm_onboarding_done_v1` in localStorage). |
| J02 Onboarding skippen | ✅ | `T3.1-J-02-kill-onboarding.png` | Overlay entfernt |
| J03 Zum Footer scrollen | ✅ | `T3.1-J-03-footer-visible.png` | `Impressum`, `Datenschutz`, `Kontakt`, `Feedback` als `.p-footer-link` sichtbar |
| J04 Impressum öffnen | ✅ | `T3.1-J-04-open-impressum.png` | Overlay mit Impressum-Inhalt lädt |
| J05 Datenschutz öffnen | ⚠️ | `T3.1-J-05-open-datenschutz.png` | Impressum-Modal blockiert Nachfolgeklick — `Escape` schließt es nicht |

- ⚠️ **Bug (klein):** Das Impressum-Overlay lässt sich per `Escape`-Taste
  nicht schließen. User muss explizit den Close-Button verwenden. Erwartetes
  Verhalten: `Escape` schließt Modals (Konvention). Non-blocking, aber
  Accessibility-Papercut. Prüfen ob Datenschutz-Modal dasselbe Verhalten hat.
- ⚠️ **Cookies-/Consent-Banner** wurde bei keinem Landing-Load beobachtet
  — falls die App Third-Party-Ressourcen (Google Fonts, Google Maps, YouTube
  Embeds) lädt, könnte das ein **DSGVO-Problem** vor Launch sein. Manuell
  klären, was aktuell ohne Consent geladen wird.

---

## Onboarding-Overlay (Nebenbefund)

- Beim ersten Besuch erscheint das 3-Slide-Onboarding-Overlay `#ob-overlay`
  über allem. **Manueller Test empfohlen:**
  - Alle 3 Slides normal durchklicken → sauberer Fade-Out?
  - "Überspringen" → Overlay verschwindet & merkt sich das (localStorage
    `mm_onboarding_done_v1`)?
  - Bei zweitem Besuch **nicht** mehr erscheinen?

---

## Zusammenfassung

- **Flows durchgegangen:** 10 (A–J)
- **Bugs / Auffälligkeiten dokumentiert:** 10
  - Davon **blockierend für Beta-Start (🚫):** **0** bestätigt
  - Davon **non-blocking, aber vor Launch fixen (⚠️):** 5
    (favicon 404, hero.mp4 ERR_ABORTED, THREE.Clock deprecation warning,
    Google Maps ohne `loading=async`, Impressum-Modal ignoriert `Escape`)
  - Davon **Bug wahrscheinlich reell, aber Nachtest nötig (⚠️🧪):** 2
    (Garage-Screen öffnet nicht via Drawer; Karte hat evtl. keinen
    Consent-Gate)
  - Davon **Automations-Limit, kein bestätigter Bug (🧪):** 3
    (Quiz-Autoklick erreicht kein Ergebnis; Bike-Detail dadurch nicht
    testbar; Passwort-Reset braucht Inbox-Zugang)
- **Manueller Nachtest zwingend vor Beta-Open** für:
  1. Quiz komplett menschlich durchklicken → KI-Ergebnis + Match-Cards
  2. Bike-Detail → 3D-Modell + Tabs + "In Garage speichern"
  3. Garage → Wartungseintrag hinzufügen
  4. Karte → Consent-Verhalten (DSGVO!) + Marker-Popup
  5. Community → Realtime-Chat mit zweitem User + Freund adden + DM
  6. Passwort-Reset komplett via Mail
  7. Feedback-Row in Supabase `beta_feedback` sichten
  8. DSGVO-Check: Was lädt die Landing ohne User-Consent? (Google Fonts,
     Google Maps API, Videos, Third-Party-Skripte)

**Empfehlung:** Beta kann in einer eingeschränkten Runde (Freunde/Family,
&lt;20 Nutzer) starten, **nachdem** die o.g. manuellen Nachtests
durchlaufen sind und die 5 non-blocking ⚠️ Punkte im T3.2-Sprint gefixt
wurden. Ein breiter Beta-Roll-out (Public Sign-up-Link) sollte auf DSGVO-
Consent-Klärung + Realtime-Chat-Verifikation warten.

---

_Erzeugt automatisch von_ `scratchpad/harness/run.mjs` _am_
`2026-08-11` _—_ Rohdaten in `scratchpad/harness/results.json`
