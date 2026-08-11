# MotoMatch — ROADMAP zur Closed Beta

> Ziel: **funktionierende geschlossene Beta für 10–30 Bekannte**, mit ~20 h/Woche
> Zeitbudget und **0 € Fixkosten** (nur Free-Tiers). Grundlage: [STATUS.md](STATUS.md).

---

## Beta-Scope

**Die Wahrheit vorab:** Du willst alle vier Kernbereiche (Quiz+Matching,
Bike-Detail+3D, Community, Karte) in der Beta drinhaben. Das ist für eine
geschlossene 10-30-Personen-Beta realistisch, **aber nur wenn du innerhalb
jedes Bereichs radikal beschneidest.** „Fertig ist nicht mehr Features, sondern
weniger Baustellen."

### Muss rein
- Login/Registrierung (E-Mail+PW über Supabase) — funktioniert schon
- **Passwort-vergessen-Flow** (Supabase kann das nativ, nur UI fehlt)
- Match-Quiz + Empfehlung + KI-Begründung — funktioniert
- Bike-Detailseite mit 3D-Viewer + Vergleich — funktioniert
- Garage (eigenes Bike, einfache Wartung) — funktioniert
- Karte mit Händlern/Werkstätten — funktioniert (Google Maps)
- Community: Freunde, DMs, Gruppen, Text-Chat — funktioniert (Supabase Realtime)
- Ausrüstungs-Guide — funktioniert
- Impressum/Datenschutz mit echten Angaben — Dateien existieren, Inhalt ggf. prüfen
- Feedback-Kanal (einfaches Formular oder Discord-Link)
- Sentry-Fehler-Monitoring

### Fliegt bewusst raus (für die Beta)
- **Voice/Talks-Kanäle** — 468 Zeilen Skeleton, echtes WebRTC ist Wochen Arbeit. UI ausblenden.
- **QR-Login, Shop, Quests** — ungenutzte Platzhalter, aus UI entfernen.
- **Events/RSVP in der Community** — TODO im DB-Schema. Später.
- **Marktplatz-Aggregator** — funktioniert zwar, aber Tavily-Kosten pro Suche + kein Kernnutzen. Für Beta ausblenden oder Feature-Flag hinter Setting.
- **Öffentliche Landing-Footer-Links** (Karriere, Investor Relations, MotoMatch AG …) — auf 3–4 echte Links reduzieren: Impressum, Datenschutz, Kontakt-Mail, evtl. GitHub.
- **OAuth Google/Apple** — nice-to-have, für 30 Bekannte tut es E-Mail+Passwort.
- **Marketplace als „Käufer helfen"-Feature** — später als Growth-Feature nach Beta.

---

## Meilensteine

| Meilenstein | Definition |
|---|---|
| **M0 — Sicherheitsnetz** | Alles committet, Sentry live, Google-Maps-Key eingeschränkt |
| **M1 — Technisch lauffähig** | Live-Deploy erreichbar, alle Kern-Screens ohne Konsolen-Fehler, PW-Reset funktioniert |
| **M2 — Intern testbar** | Du selbst hast alle Kern-User-Flows einmal komplett durchgespielt, Feedback-Kanal steht |
| **M3 — Öffentliche Closed Beta** | 3 Freunde durch, offensichtliche Bugs raus, Impressum korrekt, Beta-Link an 10–30 raus |

---

## Aufgabenliste

Blöcke à ~2–4 h. Reihenfolge nicht random, sondern nach Abhängigkeit + Risiko.

### PHASE 0 — Sicherheitsnetz (M0)

#### T0.1 — Git-Hygiene wiederherstellen (2 h)
- **Was:** Alle uncommitteten Änderungen sichten, in 2–4 sinnvolle Commits zerlegen und pushen. `main` schützen (GitHub → Settings → Branch protection: require PR).
- **Warum:** 16 uncommittete Files ohne Rollback ist ein Damoklesschwert. Wenn heute etwas verloren geht, ist es weg.
- **Betroffen:** alles unter `git status`.
- **DoD:** `git status` sagt „nothing to commit". Ein GitHub-PR-Flow läuft (auch als Solo-Dev: nie direkt auf `main` pushen). Aktuelle Version auf Vercel live.

#### T0.2 — Sentry integrieren (2 h)
- **Was:** Sentry-Account (Free), Vanilla-JS-Snippet in `index.html` einbauen, Vercel-serverless in `api/*.js` ebenfalls instrumentieren. `.env` bekommt `VITE_SENTRY_DSN`.
- **Warum:** Ohne Fehler-Sichtbarkeit ist eine Beta blind. Du erfährst Bugs sonst nur, wenn Freunde ausdrücklich Bescheid geben — und das tun sie meistens nicht.
- **Betroffen:** [`index.html`](index.html), neu: `src/js/monitoring.js`, [`api/ai-match.js`](api/ai-match.js), [`api/search-places.js`](api/search-places.js).
- **DoD:** Bewusst gebauter Test-Error erscheint in Sentry-Dashboard, Source-Maps hochgeladen (`sentry-cli`).

#### T0.3 — Google-Maps-Key + Serverless-APIs schützen (2 h)
- **Was:** Google-Cloud-Console → API-Key → HTTP-Referrer-Restriction auf `moto-matchwbapp.vercel.app/*` + deine eigene Domain. In `api/ai-match.js` und `api/search-places.js` einen Origin-Header-Check (`req.headers.origin === allowedOrigin`) und ein simples Per-IP-Rate-Limit (Vercel KV oder in-memory Map mit TTL) einbauen.
- **Warum:** Sobald die URL public ist, kann jeder deinen Google-Maps-Key auslesen und deinen OpenAI-/Tavily-Endpunkt aufrufen — ohne Auth, ohne Limit. Kann in einer Nacht dreistellige Kosten machen.
- **Betroffen:** [`api/ai-match.js`](api/ai-match.js), [`api/search-places.js`](api/search-places.js), Google-Cloud-Console.
- **DoD:** Aufruf der API von `curl` ohne korrekten Origin liefert 403; ein zweiter Aufruf binnen 5 s liefert 429.

---

### PHASE 1 — Aufräumen (technisch lauffähig, Richtung M1)

#### T1.1 — Toten Code entfernen (2 h)
- **Was:** [`src/js/map-view.js`](src/js/map-view.js) löschen. `CLAUDE.md.backup` löschen. In [`vite.config.js`](vite.config.js) den `D:/MotoMatch/`-Copy-Block entfernen (Zeilen ~6–70). `dot_clean .` im Repo-Root gegen die 319 `._*`-Files. Prüfen ob `dist/` versehentlich getrackt ist.
- **Warum:** Weniger Kognitionslast, schnellere Navigation, Kolleg:innen (auch Zukunfts-du) verwirren sich nicht mehr an totem Code.
- **Betroffen:** siehe oben.
- **DoD:** `grep -r map-view src/` liefert nichts. `find . -name '._*' | wc -l` = 0 im Repo-Root.

#### T1.2 — Landing-Footer entrümpeln (2 h)
- **Was:** In [`src/js/landing.js`](src/js/landing.js) L365–393 die 13 TODO-Links auf 4 echte reduzieren: Impressum, Datenschutz, „Kontakt" (mailto), evtl. „Über MotoMatch" mit einer kurzen echten Seite. „MotoMatch AG", „Investor Relations", „Newsroom" u.a. **komplett löschen** — die suggerieren Größe die schadet.
- **Warum:** Erste Klick-Enttäuschung eines Testers = verlorener Tester. Und Investor Relations für 10 Freunde ist absurd.
- **Betroffen:** [`src/js/landing.js`](src/js/landing.js).
- **DoD:** Alle Footer-Links führen entweder zu einer existierenden Seite oder öffnen `mailto:`. Kein einziges TODO-Kommentar mehr im Footer.

#### T1.3 — Beta-Features ausblenden (Voice, QR, Shop, Quests, Marketplace) (3 h)
- **Was:** Eine zentrale Konstante `BETA_FLAGS = { voice: false, marketplace: false, shop: false, qrLogin: false, quests: false }` in einem neuen `src/js/config.js`. In der Navigation und den Feature-Entrypoints Buttons entweder gar nicht rendern oder als `disabled` mit „bald verfügbar" Tooltip.
- **Warum:** Was Nutzer nicht sehen, kann nicht enttäuschen. Und du kannst nach Beta gezielt einzelne Flags flippen.
- **Betroffen:** [`src/js/community.js`](src/js/community.js) (voice-tabs), [`src/js/landing.js`](src/js/landing.js), [`src/js/account.js`](src/js/account.js) (QR-Login-Button), evtl. weitere.
- **DoD:** Kein Beta-Tester kann auf ein nicht-funktionierendes Feature klicken.

#### T1.4 — localStorage-Keys aufräumen (2 h)
- **Was:** Für jedes Duo-Paar (`friends_v1`/`v2`, `prefs`/`prefs_v1`, `gear_favs`/`kv_favs`) den aktiven Key per Code-Grep feststellen, den anderen aus dem Code entfernen. Optional: einmalige Migrations-Funktion, die beim Start alte Keys nach neuen migriert und dann löscht.
- **Warum:** Weniger Zufalls-Bugs („warum sind meine Favoriten weg?"), sauberer Schnitt vor Public-Beta.
- **Betroffen:** [`src/js/gear.js`](src/js/gear.js), [`src/js/garage.js`](src/js/garage.js), [`src/js/community-api.js`](src/js/community-api.js).
- **DoD:** Nur noch ein Key pro Datentyp im Code. Alte Keys werden bei App-Start migriert und gelöscht.

---

### PHASE 2 — Muss-Features (Richtung M1/M2)

#### T2.1 — Passwort-vergessen-Flow (3 h)
- **Was:** Im Auth-Modal Link „Passwort vergessen?" → E-Mail-Input → `supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/#reset` })`. Eine neue Reset-Seite (Screen), die `supabase.auth.updateUser({ password })` aufruft, sobald der User über den Magic-Link-Redirect hier landet.
- **Warum:** Erster Bekannter, der sein PW vergisst → Support-Aufwand für dich. Supabase löst das mit einer Zeile.
- **Betroffen:** [`src/js/auth.js`](src/js/auth.js), neu ein „reset"-Screen (kann in `auth.js` bleiben).
- **DoD:** Reset-Mail kommt an, Link führt zur Reset-Seite, neues PW funktioniert für Login. In Supabase-Dashboard das Mail-Template auf Deutsch angepasst.

#### T2.2 — Feedback-Kanal einbauen (2 h)
- **Was:** „Feedback"-Button unten rechts (Floating Action Button). Klick → Modal mit Textfeld + optional Screenshot-Upload → INSERT in neue Supabase-Tabelle `beta_feedback (id, user_id, text, page, user_agent, screenshot_url, created_at)` mit RLS „nur INSERT für authenticated".
- **Warum:** Ohne Kanal bekommst du kein Feedback — Freunde schreiben nicht von sich aus. Ein FAB im Blickfeld senkt die Hemmschwelle massiv.
- **Betroffen:** Neu `src/js/feedback.js`, [`supabase/schema.sql`](supabase/schema.sql) erweitern.
- **DoD:** Testfeedback landet in Supabase, du siehst es im Table-Editor.

#### T2.3 — 3D-Modelle in Supabase Storage (falls noch nicht fertig) (4 h)
- **Was:** Prüfen ob letzter Commit „feat: migrate 3D model URLs to Supabase Storage" wirklich alle GLBs migriert hat. Fehlende GLBs in Supabase Storage Bucket `bikes-3d` hochladen (public read). URLs in [`src/js/bike-detail.js`](src/js/bike-detail.js) verifizieren. `.glb` aus `public/models/` entfernen.
- **Warum:** Damit Vercel-Deploy per Git-Integration funktioniert (statt jedes Mal `vercel deploy` lokal). Bringt auch CI/CD-Auto-Deploy auf PR-Merge.
- **Betroffen:** [`src/js/bike-detail.js`](src/js/bike-detail.js), Supabase Storage, `public/models/`.
- **DoD:** Nach `git push` deployt Vercel automatisch, 3D-Viewer lädt alle Bikes.

#### T2.4 — Impressum/Datenschutz mit echten Angaben (2 h)
- **Was:** [`public/impressum.html`](public/impressum.html) mit deiner Adresse + E-Mail füllen (§5 TMG). [`public/datenschutz.html`](public/datenschutz.html) mit den echten verwendeten Diensten (Supabase, Vercel, Google Maps, OpenAI, Tavily, Sentry) — für jeden Dienst Zweck + Rechtsgrundlage + Sitz + Link zur eigenen Datenschutzerklärung. Beide Seiten im Footer verlinken.
- **Warum:** Impressumspflicht (§5 TMG) und Informationspflicht (Art. 13 DSGVO) gelten ab dem Moment, in dem die Seite öffentlich ist. Auch für „nur 30 Freunde" — der Link ist ja öffentlich.
- **Betroffen:** [`public/impressum.html`](public/impressum.html), [`public/datenschutz.html`](public/datenschutz.html).
- **DoD:** Anwaltliche Standard-Textbausteine (Muster von IT-Recht Kanzlei / activeMind) mit deinen Daten befüllt. **Kein anwaltlicher Rat — nur Hinweis; im Zweifel spezialisierten Anwalt fragen.**

#### T2.5 — Cookie-/Consent-Banner minimal (2 h)
- **Was:** Prüfen welche Cookies/LocalStorage-Einträge du wirklich setzt. Sentry und Google Maps sind ggf. consent-pflichtig. Ein simpler Banner „Nur essenziell / Alle akzeptieren" mit Ablage in `mm_consent_v1`. Wenn Ablehnung: Sentry und Google Maps erst nach Consent laden.
- **Warum:** DSGVO/TTDSG. Für 30 Bekannte gäbe es faktisch kein Risiko, aber Aufwand ist gering.
- **Betroffen:** neu `src/js/consent.js`, Sentry-Init lazy machen.
- **DoD:** Banner erscheint beim ersten Besuch, Consent wird gespeichert, essentielle-only lädt Sentry/GMaps nicht.

---

### PHASE 3 — Selbst-Test + Launch (M2 → M3)

#### T3.1 — Golden-Path-Durchlauf inkl. Screenshots (3 h)
- **Was:** Als frischer User (Inkognito-Fenster) alle Kernflüsse einmal komplett: Registrierung → Quiz → Match ansehen → Detailseite + 3D → in Garage speichern → Karte öffnen → Freund adden → DM schreiben. Jeden Screen screenshoten. Konsole offen halten, jede Warning notieren.
- **Warum:** Bevor Freunde testen, musst du selbst wissen, ob es überhaupt geradlinig geht. Screenshots sind auch Basis für den Beta-Einladungs-Post.
- **Betroffen:** kein Code, außer Fix-Bugs die du dabei findest.
- **DoD:** Ein Markdown-Dokument `docs/BETA-SMOKETEST.md` mit „✅ funktioniert / ⚠️ Bug X" pro Schritt.

#### T3.2 — Umbrella-Bug-Fix-Runde (4 h Puffer, evtl. mehr)
- **Was:** Alle in T3.1 gefundenen Bugs.
- **Warum:** Die kommen sicher.
- **DoD:** T3.1 nochmal komplett grün.

#### T3.3 — Vercel-Custom-Domain + „gedeckte" URL (2 h)
- **Was:** Falls du eine Domain hast, in Vercel verbinden. Sonst reicht `moto-matchwbapp.vercel.app`. In Sentry, Google-Cloud-Console, Supabase (Redirect-URLs für Auth) die neue Domain hinterlegen.
- **Warum:** Ohne konsistente Domain funktionieren OAuth-Redirects und Referrer-Restrictions nicht sauber.
- **DoD:** Domain reagiert, HTTPS grün, Auth funktioniert.

#### T3.4 — Beta-Onboarding-Screen + Einladungsversand (2 h)
- **Was:** Beim ersten Login ein 3-Slide-Onboarding (Wilkommen / So funktioniert das Quiz / So funktioniert die Community / Feedback-Button erklären). Einladungstext (WhatsApp/Signal-copypaste) fertigmachen.
- **Warum:** 10–30 Freunde springen sonst zu unterschiedlichen Features, verstehen nicht was du testen willst — und geben inkonsistentes Feedback.
- **DoD:** Onboarding schaltet nach einmaliger Anzeige ab (`mm_beta_onboarded_v1`). Einladungstext + Link kopierbereit.

#### T3.5 — 3 Freunde vorab (nicht sofort alle 30) (Woche 1)
- **Was:** Erst 2–3 Personen einladen, 1 Woche laufen lassen, Feedback sammeln, dringende Bugs fixen. Dann erst den Rest.
- **Warum:** Wenn ein zentraler Bug alle 30 gleichzeitig trifft, verbrennst du die Community. Staffel-Launch schützt.
- **DoD:** Nach 1 Woche ohne kritische Bugs → an alle 30.

---

## Was du als Solo-Dev NICHT selbst bauen sollst

| Bereich | Warum nicht selbst | Nimm stattdessen |
|---|---|---|
| Auth | Passwörter, Reset-Flows, OAuth = Sicherheitsminen | **Supabase Auth (schon drin)** |
| E-Mail-Versand | SMTP, Deliverability, Bounces | **Supabase-Default für Beta**, später **Resend Free** (3.000/Monat, eigene Domain) |
| Datenbank + Realtime | Postgres selbst hosten macht in Beta 0 Sinn | **Supabase (schon drin)** |
| Fehler-Monitoring | Selbst-Aggregation ist Trümmer | **Sentry Free** (5k Events/Monat) |
| Analytics | GA4 ist Overkill und consent-pflichtig | **Plausible Free-Tier** (self-hosted) oder **Umami**; oder simple Supabase-Event-Tabelle für Beta-Phase |
| Voice/WebRTC | 2–4 Wochen Arbeit, nicht Beta-relevant | Später: **LiveKit Free-Tier** oder komplett rauslassen |
| CDN / Asset-Hosting | Nichts eigenes hosten | **Vercel Edge + Supabase Storage (schon drin)** |
| Bild-Uploads (Avatar) | Base64 in DB skaliert nicht | Für Beta ok, danach **Supabase Storage** |
| Payments | Für Beta nicht relevant | Später: **Stripe Checkout** (fertige Hosted-Page) |
| Cookie-Consent-Framework | Selbst basteln ist ok für Beta | Später: **Klaro** (Open Source) oder **Cookiebot Free** |

---

## Minimales Launch-Setup

- **Fehler-Monitoring:** Sentry Free
- **Analytics:** Für Beta: eigene `beta_events`-Tabelle in Supabase, `INSERT` bei Kern-Events (Quiz-Abschluss, Registrierung, DM verschickt). Ausreichend um zu sehen wer wie weit kommt.
- **Feedback-Kanal:** Feedback-FAB (T2.2) + optional Discord-Server für Diskussion
- **Backups:** Supabase Free hat **keine Daily Backups**. Für Beta ok (kein echter Datenschaden), aber: einmal pro Woche `pg_dump` per `supabase db dump` auf deine Platte, in ein privates Repo. 15 Min Arbeit die Woche.
- **Uptime:** Vercel + Supabase Free sind stabil genug. Kein UptimeRobot nötig.
- **Domain:** Falls vorhanden → verbinden. Sonst `.vercel.app` bleibt.

---

## Rechtliches DACH — Checkliste (kein Rechtsrat)

> Ich bin kein Anwalt, das ersetzt keine Beratung. Für eine 30-Personen-Beta ist
> das Risiko klein, aber die Pflichten gelten ab dem Moment, wo die Seite unter
> einer öffentlichen URL erreichbar ist.

- [ ] **Impressum** nach §5 DDG (früher TMG): vollständiger Name, ladungsfähige Adresse (kein Postfach), E-Mail. Verlinkt im Footer, direkt erreichbar. Ohne wirtschaftliches Interesse (rein privat) diskutabel — aber sobald du an „Startup" denkst, gilt es sicher.
- [ ] **Datenschutzerklärung** nach Art. 13 DSGVO: alle Dienste einzeln nennen (Supabase EU/US, Vercel US, Google Maps US, OpenAI US, Tavily US, Sentry US), jeweils Zweck + Rechtsgrundlage + Empfänger + Speicherdauer + Betroffenenrechte + Kontakt-Verantwortlicher.
- [ ] **Auftragsverarbeitungsvertrag (AVV/DPA)** mit Supabase, Vercel, Sentry, OpenAI — alle bieten Standardverträge online. Rein formal, aber Pflicht.
- [ ] **Cookie-/Consent-Banner** nach TTDSG §25: Speicherzugriff über den technisch-notwendigen Rahmen hinaus ist einwilligungspflichtig. Sentry-Session-Replay wäre einwilligungspflichtig, reines Error-Tracking meist nicht. Google Maps setzt Cookies → einwilligungspflichtig.
- [ ] **AGB / Nutzungsbedingungen:** für Beta unter Bekannten nicht zwingend, aber sinnvoll: „Beta-Software, keine Gewähr, Datenverlust möglich, kein Anspruch auf Verfügbarkeit" auf einer /agb-Seite.
- [ ] **Community-Regeln + Moderationskonzept** (auch nur ein Absatz): Was ist verboten, wie kann gemeldet werden. Ist im Schema (`message_reports`, `user_reports`, `group_bans`) bereits vorbereitet.

---

## Zusammenfassung: erste Woche

Wenn du morgen anfängst und ~20 h/Woche schaffst, ist das folgende die realistische
1-Wochen-Sequenz: **T0.1 → T0.2 → T0.3 → T1.1 → T1.2 → T1.3.**

Dann hast du am Wochenende: alles committet, Fehler-Monitoring live, Kostenfallen zu,
toter Code weg, Landing entpeinlicht, Beta-Features versteckt. **Die Basis ist dann
sauber**, und die restlichen Muss-Features (PW-Reset, Feedback, GLB-Migration,
Impressum) sind je 2–4 h und alle unabhängig — machst du in Woche 2.
