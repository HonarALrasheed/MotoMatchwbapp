# MotoMatch — CLAUDE.md

## Aktueller Fokus (2026-08-11)
Ziel ist eine **geschlossene Beta für 10–30 Bekannte** aus dem Motorrad-Umfeld
mit **0 € Fixkosten** (nur Free-Tiers), Zeitbudget ~20 h/Woche.
- Ist-Zustand und Feature-Inventar: [docs/STATUS.md](docs/STATUS.md)
- Aufgabenliste, Meilensteine, was raus- und was rein muss: [docs/ROADMAP-BETA.md](docs/ROADMAP-BETA.md)
- Bewusst aus Beta-Scope: Marketplace, Shop, Quests, QR-Login, OAuth (Voice/Talks ist seit heute in Arbeit, s. u.)
- Beta-Blocker mit höchster Priorität: Git-Hygiene (nur 2 Commits, 16 dirty files),
  Sentry, Google-Maps-Key-Restriction, Rate-Limit auf `api/*`, Passwort-Reset-Flow

## Projekt
Web-App für Motorradfahrer:innen: passendes Bike finden (Quiz + Matching), Modelle vergleichen (3D-Ansicht), Ausrüstung, Karte (Händler/Werkstätten), Community im Discord-Stil.
**Status:** Frontend + Supabase-Backend (Auth, Postgres, Realtime) live-fähig; `OFFLINE_MODE`-Fallback auf `localStorage` bleibt für Dev ohne Keys. Ziel: Closed Beta.

## Tech-Stack
| Bereich | Technologie |
|---|---|
| Build | Vite 5 |
| Sprache | Vanilla JavaScript (ES-Module), **kein Framework** |
| Package Manager | npm (package-lock.json), Node 20 (`.nvmrc`) |
| 3D | three.js + three-stdlib (GLTF) |
| Karten | Leaflet + Google Maps / Open-Meteo |
| Animation | lottie-web |
| Styling | ein zentrales Stylesheet: `src/styles/main.css` |
| Deployment | Vercel, Base-Pfad `/app/` nur im Build |

## Befehle
```bash
npm run dev      # Vite-Dev-Server, http://localhost:5173
npm run build    # Production-Build nach dist/ (terser)
npm run preview  # Build lokal ansehen
```
Keine Tests und kein Linter konfiguriert.

## Struktur
| Pfad | Inhalt |
|---|---|
| `index.html` | Grundgerüst; Container aller "Bildschirme" (SPA per Ein-/Ausblenden) |
| `src/main.js` | Einstiegspunkt: lädt CSS + `startApp()` |
| `src/js/` | gesamte Logik, ein Modul pro Feature (s. u.) |
| `src/styles/main.css` | gesamtes Styling (dunkles, Porsche-inspiriertes Design) |
| `public/` | statische Assets, ~220 MB (Bike-Bilder, 3D-Modelle, HDRI, Video) |
| `vite.config.js` | Base-Pfad, Asset-Kopie von `D:/MotoMatch/...` (nur alte Windows-Dev-Maschine, auf macOS inert) |
| `.env` | `VITE_SUPABASE_URL/ANON_KEY`, `VITE_GMAPS_KEY`, `VITE_SENTRY_DSN` (client) sowie serverseitig `OPENAI_KEY`, `TAVILY_KEY`, `SENTRY_DSN` — alle optional, Features degradieren ohne Keys. Server-Keys **nie** mit `VITE_`-Prefix. |

Wichtigste Module in `src/js/`:
- `app.js` — Bootstrapping/Router zwischen Bildschirmen
- `auth.js` — **zentrale** Auth (eine Session plattformweit); API: `login`, `register`, `logout`, `loginGuest`, `currentUser`, `updateProfile`, `getSession`, `isLoggedIn`, `openAuthModal`, `requestPasswordReset`, `updatePasswordDirect`, `openPasswordResetScreen`; Event `mm:auth-changed`
- `bike-detail.js` — größtes Modul: Konfigurator, 3D-Viewer, Tabs
- `community.js` — Discord-artige Community (Gruppen, Talks, DMs)
- `quiz.js` / `matching.js` — Match-Quiz + Empfehlungslogik
- `garage.js`, `map-view.js`, `gear.js`, `account.js`, `landing.js`, `marketplace.js`, `ai.js`

## Konventionen
- UI-Rendering per Template-Strings + `innerHTML`; **Nutzereingaben immer über `esc()` escapen** (XSS)
- localStorage-Keys: Präfix `mm_` + Versionssuffix (z. B. `mm_auth_users_v1`, `mm_comm_groups_v2`)
- Auth/Daten-Zugriffe nur über die `auth.js`-API — sie ist die Schnittstelle für ein späteres echtes Backend, Signaturen stabil halten
- Kein UI-Framework, keine State-Library, keine neuen Dependencies ohne Rückfrage
- Styling ausschließlich in `src/styles/main.css`, keine Inline-Styles in JS-Templates ohne Not

## Niemals ändern
- `dist/`, `node_modules/`, `.vite/`, `.vercel/`
- `public/bikes/`, `public/models/`, `public/__video/`, `public/hdri/` (kopierte/große Binär-Assets)
- `package-lock.json` (nur über npm-Befehle)
- `.env`, `.env.local` (Secrets)
- `._*`-Dateien (macOS-AppleDouble-Metadaten auf dem externen Volume)

## Bike-Datenpipeline
- Die Bike-Stammdaten sind **doppelt hardcodiert**: `matching.js` (Array `BIKES`, für Quiz/Matching) **und** `bike-detail.js` (Objekt `BIKE_DATA`, keyed by Name, für die Detailseite). Änderungen immer in **beiden** Dateien nachziehen.
- Rohdaten liegen im Elternordner `/Volumes/Untitled/MotoMatch/`: `motorcycles_motoMatch.csv` (Quelle der Specs), `Modell-CSV/`, `Bilder/`. Sie werden vom Frontend **nicht** gelesen — nur manuell übertragen.
- `import_motorcycles.py` (Elternordner) importiert die CSV nach Supabase — Vorbereitung fürs künftige Backend, vom Frontend noch ungenutzt.
- Neues Bike hinzufügen: Eintrag in `matching.js` + `bike-detail.js`, dazu Assets: `public/bikes/<slug>.png` (Seitenansicht), `public/bikes/2/<slug>.png` (Detail), `public/models/<slug>.glb` (3D).

## Deployment (Vercel)
- Projekt `moto-matchwbapp`, verlinkt über `.vercel/`; Build laut `vercel.json`: `npm run build` → `dist/`.
- **Achtung:** `public/models/` und `public/__video/` sind gitignored ("too big for GitHub"). Ein Deploy über die Git-Integration hätte daher **keine 3D-Modelle/kein Hero-Video** — deployen über die `vercel` CLI vom lokalen Rechner, die lädt `public/` vollständig hoch.
- Im Build gilt Base-Pfad `/app/` — absolute Asset-Pfade im Code (z. B. `/models/…`) funktionieren nur, weil Vite sie beim Build umschreibt bzw. die Assets unter `/app/` landen; bei 404s in Produktion zuerst hier suchen.

## API-Schutz
Die kostenpflichtigen Upstream-Endpoints (`api/ai-match.js` → OpenAI,
`api/search-places.js` → Tavily) hängen an einer **Supabase-Session**, nicht am
Origin-Header. Reihenfolge in beiden Handlern, Helfer alle aus
[`api/_shared.js`](api/_shared.js):
1. `checkOriginAndRate(req, res, { typedErrors: true })` — gibt der Helper `true` zurück, hat er bereits geantwortet und der Handler muss sofort `return`en.
2. Methodenprüfung (nur POST)
3. `requireUser(req)` → `{ user, supabase } | null`; `null` → **401**
4. `checkDailyLimit(supabase, endpoint)` → `false` → **429**
5. Eingabevalidierung mit `takeString()` / `isPlainObject()` **vor** jeder Interpolation in Prompt oder Query

- **Der Origin-Check ist kein Schutz.** `Origin` ist eine Browser-Konvention; jeder andere HTTP-Client setzt ihn frei. `curl -H 'Origin: <erlaubt>'` kam damit früher bis zu OpenAI durch. Die Prüfung bleibt als Versehens-Bremse (fremde Webseite im Browser, falsche Preview-URL, vergessene Env-Var) — sie ist **nicht** die Zugangskontrolle. Allowlist weiterhin über `ALLOWED_ORIGINS` (kommagetrennt, keine Wildcards).
- **In-memory-Rate-Limit ist nur eine Burst-Bremse.** 10/60 s pro IP, Map im Modul-Scope. Auf Vercel hat jede Lambda-Instanz eigenen Speicher, Instanzen skalieren und starten kalt — das Limit gilt pro Instanz, nicht pro IP.
- **Die belastbare Grenze ist das Tageskontingent pro Nutzer**: Tabelle `api_usage` + SECURITY-DEFINER-Funktion `bump_api_usage(p_endpoint, p_limit)` in [`supabase/schema.sql`](supabase/schema.sql). Limits stehen in `DAILY_LIMITS` in `_shared.js` (ai-match 30/Tag, search-places 60/Tag). `api_usage` hat bewusst **keine** RLS-Policy — sonst könnte man den eigenen Zähler per REST löschen.
  **Fail-open:** Fehlert die RPC selbst (nicht deployt, DB weg), läuft der Aufruf durch und der Fehler geht an Sentry. Nur ein echtes `false` ist ein Limit-Treffer.
- **Client muss den Token mitschicken.** `supabase.auth.getSession()` → `Authorization: Bearer <access_token>`, siehe [`src/js/ai.js`](src/js/ai.js), [`src/js/marketplace.js`](src/js/marketplace.js), [`src/js/voice.js`](src/js/voice.js). Ohne Session wird gar nicht erst gefetcht. **Gast-Login (`loginGuest`) hat keine Supabase-Session** — für Gäste degradieren KI-Analyse und Marktsuche auf ihren Leerzustand.
- **Fehlerformat, alle fünf Endpoints:** `{ error: { code, message } }` — `code` zum Verzweigen, `message` für Menschen (deutsch, darf im UI stehen). Codes: `forbidden_origin`, `rate_limited`, `method_not_allowed`, `unauthorized`, `missing_token`, `invalid_session`, `daily_limit`, `invalid_body`, `invalid_room`, `no_profile`, `not_participant`, `not_friends`, `room_forbidden`, `upstream_error`, `not_configured`, `storage_cleanup_failed`, `delete_failed`, `server_error`. **Nie Upstream- oder Exception-Text durchreichen** (Kontingent-/Kontodetails, Stacktraces); das Detail geht über `report()` aus `_shared.js` an Sentry. Sentry-Init und `report()` stehen nur noch in `_shared.js`.
- **`api/delete-account.js` ist der einzige Endpoint mit BEIDEN Schlüsseln:** `requireUser()` (Anon-Key) stellt fest, *wer* fragt — die zu löschende uid kommt ausschließlich aus dem verifizierten Token, es gibt bewusst keinen uid-Parameter. Erst danach kommt der Service-Role-Client für `auth.admin.deleteUser()` und das Aufräumen des Buckets `chat-attachments` (die CASCADE-Ketten in `schema.sql` räumen Tabellen ab, **nicht** den Storage). Reihenfolge ist Absicht: erst Storage, dann Auth-User — schlägt der Storage-Teil fehl, bricht der Endpoint ab und lässt das Konto stehen, weil ein verwaister öffentlicher Anhang danach niemandem mehr zuzuordnen wäre. Ohne `SUPABASE_SERVICE_ROLE_KEY` (lokal nicht in `.env`): 500/`not_configured`, es wird nichts gelöscht.
- **`api/push-trigger.js` bleibt die Ausnahme bei der Authentifizierung:** aufgerufen von einem Supabase-Webhook, nicht aus dem Browser — deshalb bewusst **kein** Origin-Check und **kein** `requireUser`, sondern `x-webhook-secret`. Nur das Fehlerformat ist angeglichen. Nicht "vereinheitlichen".
- **Konfigurationsprüfungen (`OPENAI_KEY`, `TAVILY_KEY`, `LIVEKIT_*`) stehen hinter der Anmeldung**, nicht davor: sonst kann jeder mit passendem Origin Sentry mit Events fluten und nebenbei abfragen, ob überhaupt Schlüssel hinterlegt sind.

## Fehler-Monitoring (Sentry)
- Frontend-Init in [`src/js/monitoring.js`](src/js/monitoring.js), aufgerufen als **erste Zeile in [`src/main.js`](src/main.js)** — vor dem dynamischen Import von `app.js`, damit auch ein Fehler beim Auswerten der Importkette noch gemeldet wird. DSN aus `VITE_SENTRY_DSN` — ohne DSN no-op mit Konsolen-Info (wie `OFFLINE_MODE` in `supabase.js`).
- **`VITE_SENTRY_DSN` muss zur *Build*-Zeit gesetzt sein.** Vite inlint den Wert; ohne DSN ist der `Sentry.init`-Zweig toter Code und `@sentry/browser` wird komplett wegoptimiert (Entry-Chunk 1,6 kB gz statt 25,8 kB gz). Die Variable in Vercel zu setzen reicht also nicht — es braucht danach einen **Redeploy mit neuem Build**.
- **Umgebungstrennung:** `VITE_SENTRY_ENVIRONMENT` (Frontend) und `SENTRY_ENVIRONMENT` (Functions, wird von `@sentry/node` selbst gelesen) je Vercel-Umgebung auf `production` bzw. `preview` setzen. Ohne sie melden Preview-Deploys als `production` — `vite build` läuft dort im selben Modus — und die Alarmregeln feuern auf Preview-Rauschen.
- `report(err, {where})` / `reportFatal(err, {where})` aus `monitoring.js` sind das Client-Gegenstück zu `report()` in `_shared.js`: console.warn/error **plus** eigenes Sentry-Ereignis (Stufe `warning` bzw. `fatal`). Ein blosses `console.warn` würde bei Sentry nur als Breadcrumb an einem anderen Ereignis landen — ein geschluckter Fehler erzeugt aber keins. Genutzt in den catch-Blöcken, die sonst still bleiben (`auth.js` notify, `community-api.js` Broadcasts, `voice.js` Gerätewechsel, `ai.js` Proxy). **Keine Nutzerdaten ins `extra`** — `beforeSend` filtert E-Mails und Token, aber nicht Namen und IDs.
- `unhandledrejection`-Handler in `monitoring.js` (immer installiert, auch ohne DSN) loggt nur in die Konsole. Er meldet **absichtlich nicht selbst** an Sentry: dessen `globalHandlersIntegration` ist Standard und fängt dieselben Ereignisse schon ab — ein eigener captureException ergäbe alles doppelt.
- Die localStorage-`catch {}`-Blöcke bleiben leer. Ein voller oder gesperrter Speicher ist kein Programmfehler und gehört nicht ins Kontingent.
- Backend: `@sentry/node` in [`api/ai-match.js`](api/ai-match.js) und [`api/search-places.js`](api/search-places.js). Init lazy, DSN aus `SENTRY_DSN` (ohne `VITE_`). Jeder gefangene Fehler wird zusätzlich an Sentry gemeldet, das bestehende JSON-Error-Response bleibt unverändert.
- PII-Scrubbing: `beforeSend` filtert E-Mails, Passwörter, Tokens, Cookies aus Events (Frontend) — **einschliesslich der Exception-Nachrichten** (`event.exception.values[].value`). Die gingen früher ungefiltert raus; Supabase-Auth-Fehler zitieren die Adresse im Klartext, was nebenbei je Adresse eine eigene Issue-Gruppe erzeugte. `scrub()` erwischt Schlüssel-Wert-Paare in JSON- **und** in Klartext-/Query-Notation (`?access_token=…`) sowie `Bearer`-Header und JWTs (`eyJ…`) an beliebiger Stelle im String.
- **Test-Empfang verifizieren:** in der Browser-Konsole `Promise.reject(new Error('Sentry test'))` — geht über `unhandledrejection` an Sentry, ohne Code anzufassen. Oder temporär eine kaputte Zeile einbauen, z. B. in `src/js/monitoring.js` nach `Sentry.init(...)`: `setTimeout(() => { throw new Error('Sentry test error') }, 1000)`. Für Backend: `throw new Error('Sentry backend test')` am Anfang des `try`-Blocks in `api/ai-match.js`. Nach Verifikation im Sentry-Dashboard sofort wieder entfernen — **nicht committen**.
- **Source-Maps-Upload** (später, nicht in dieser Session): `npm i -D @sentry/cli`, dann in Post-Build-Step `sentry-cli sourcemaps inject ./dist && sentry-cli sourcemaps upload --org <org> --project moto-match ./dist`. Auth-Token via `SENTRY_AUTH_TOKEN` in CI/Vercel.

## Browser-Verifikation nach UI-Änderungen
- Dev-Server **immer** über die Browser-Preview starten (`.claude/launch.json`, Konfiguration `moto-match`, Port 5173) — nie per Bash.
- Nach Änderungen an UI/Styling: Seite laden, Konsole auf Fehler prüfen, Screenshot machen und selbst vergleichen. Nicht den Nutzer manuell prüfen lassen.
- Bildschirme sind SPA-Container — zum Testen ggf. per Klick durch Landing → Quiz/Detail navigieren.

## Cross-Browser (WebKit vs. Chromium)
Referenz ist Edge/Chromium auf Android. Abweichungen kamen praktisch alle von
WebKit — auf dem iPhone benutzen **alle** Browser (Safari, Chrome, Edge,
Firefox) dieselbe Engine, ein Test in Safari deckt sie also alle ab.
Was dafür im Code steht:
- `-webkit-backdrop-filter` gehört **immer** neben jedes `backdrop-filter`;
  ohne Prefix fehlt der Milchglas-Effekt auf iOS < 18 ersatzlos.
- Eingabefelder unter 16px lösen auf iOS Auto-Zoom aus. Abgefangen im
  767px-Block *und* im `@supports (-webkit-touch-callout: none)`-Block am
  Dateiende (Querformat/iPad liegen über 767px).
- Bildschirmtastatur: [`src/js/viewport.js`](src/js/viewport.js) misst sie über
  `visualViewport` und legt `--kb-inset` + `body.kb-open` ab; der Tastatur-Block
  am Ende von `main.css` wertet das aus. Chromium verkleinert das Layout selbst,
  dort bleibt `--kb-inset` 0px — die Regeln sind da Nulloperationen.
- `scrollbar-width`/`scrollbar-color` (Firefox) nur innerhalb von
  `@supports not selector(::-webkit-scrollbar)` setzen: in Chromium schaltet
  ein gesetztes `scrollbar-color` die `::-webkit-scrollbar`-Regeln desselben
  Elements ab, und es vererbt.
- Kein `-webkit-overflow-scrolling: touch` mehr — seit iOS 13 Voreinstellung,
  erzeugte aber eine eigene Ebene, in der WebKit `position: fixed`-Kinder
  abschneidet.
- Kein Regex-Lookbehind (`(?<!…)`): WebKit kennt es erst ab 16.4 und wirft
  davor schon beim Parsen, was das ganze Modul mitreißt.

## Vollbild auf dem Handy (PWA)
Ein normaler Browser-Tab kann sich den Bildschirm nicht selbst nehmen — die
Adressleiste gehört dem Browser, und `requestFullscreen()` ist auf iOS für
alles außer `<video>` gesperrt. Vollbild gibt es nur als **installierte**
Web-App. Dafür ist eingerichtet:
- [`public/manifest.webmanifest`](public/manifest.webmanifest) — `display:
  standalone`, Start-URL `/`, Theme `#0a0a0a`, Icons 192/512 (512 doppelt,
  einmal `any` und einmal `maskable`).
- Icons: `public/icon-{192,512}.png` + `public/apple-touch-icon.png`
  (180 px). Erzeugt aus der Wortmarke „MM" in Barlow 800 auf `#0a0a0a`;
  zum Austauschen einfach die PNGs ersetzen, Größen beibehalten.
- `index.html` trägt Manifest-Link, `theme-color` und die
  `apple-mobile-web-app-*`-Metatags. `black-translucent` + das bereits
  gesetzte `viewport-fit=cover` ziehen den Inhalt unter die Statusleiste.
- [`public/sw.js`](public/sw.js) hat einen leeren `fetch`-Listener. Der
  cached nichts, steht aber auf Chromiums Prüfliste für Installierbarkeit —
  ohne ihn kommt `beforeinstallprompt` nie.
- [`src/js/install.js`](src/js/install.js) registriert den Service Worker beim
  Start (vorher lief er nur bei aktiviertem Push) und zeigt nach 20 s einen
  Hinweisbalken: auf Android einen echten Installieren-Knopf über
  `beforeinstallprompt`, auf iOS die Anleitung „Teilen → Zum Home-Bildschirm",
  weil WebKit kein solches Ereignis kennt. Einmal weggeklickt = weg
  (`mm_install_hint_v1`).

## Navigation (nav.js, swipe.js)
Alle Bildschirme teilen sich **eine Adresse** — ein erfundener Pfad gäbe beim
Neuladen einen 404. Deshalb spiegelt [`src/js/nav.js`](src/js/nav.js) jede
Ebene auf einen History-Eintrag mit gleicher URL und hält den Rückweg im
Modul-Scope.
- **Richtung** steckt in `history.state.mmNav` (laufende Nummer je Eintrag).
  Vorher las der popstate-Handler jedes Signal als "zurück" — Vorwärts war
  dadurch wirkungslos. Wer `replaceState` aufruft (auth.js, community.js),
  muss `window.history.state` durchreichen, sonst geht die Nummer verloren.
- **Vorwärts und Neuladen** brauchen beide dasselbe: eine Ebene muss aus
  Daten wiederherstellbar sein, nicht nur aus einer Closure. Darum gibt jeder
  `enterScreen()`-Aufruf eine serialisierbare `view` mit
  (`{ screen, bike, tab }`), und `app.js` hinterlegt per `setViewResolver()`
  einmal `openView()`. **Neuer Bildschirm = `view` mitgeben und in
  `openView()` auflösbar machen**, sonst ist er nicht wiederherstellbar
  (Zurück funktioniert trotzdem).
- Die zuletzt sichtbare Ebene liegt in `sessionStorage` (`mm_nav_view_v1`):
  überlebt Reload, nicht den Tab-Neustart.
- **Sichtbarer Rückweg auf jedem Reiter.** `.konf-back-float` war auf
  Ausrüstung und Community ausgeblendet — dort gab es damit gar keinen
  sichtbaren Weg zurück (die Tab-Leiste wechselt nur Reiter, der Pfeil der
  Community führt nur von der Detailansicht in die Liste). Er ist wieder da;
  Platz macht die Kategorie-Leiste (`padding-left`) bzw. `.mmc`
  (`padding-top`). **Achtung bei Änderungen am Ausrüstungs-Polster:** die
  Regel im 640px-Block setzt `padding` als Kurzform mit `!important` und hat
  drei Klassen — ein `body:has(…)`-Selektor verliert dagegen auch mit
  `!important`.
- **Wischgesten** in [`src/js/swipe.js`](src/js/swipe.js): links = zurück,
  rechts = vorwärts, nur unter 768px. Ausgenommen sind die Bildschirmränder
  (28px — dort liegt die Zurück-Geste von iOS bzw. Android), waagerecht
  scrollbare Bereiche (an der Scrollbreite erkannt, nicht an Klassennamen),
  Karte, 3D-Canvas, Karten-Sheet und Eingabefelder.

## Feedback-Knopf (verschiebbar)
Der FAB aus [`src/js/feedback.js`](src/js/feedback.js) lässt sich ziehen und
rastet an der näheren Seite ein; Position in `localStorage`
(`mm_fb_fab_pos_v1`, `{ side, bottom }`).
- Die Seite steckt in der Klasse `.mm-fb-fab--left`, die Höhe in der Variablen
  `--fab-user-bottom`. **Nie ein Inline-`bottom` setzen**: die Ausweich-Regeln
  in `main.css` rechnen die Variable per `max()` als *Untergrenze* ein, damit
  der Knopf trotz freier Position nicht unter Tab-Leiste, Karten-Sheet oder
  Tastatur rutscht. Ein Inline-Wert überschriebe sie alle.
- Gezogen wird über Pointer-Events mit `setPointerCapture`; ab 6px gilt es als
  Zug, und der darauffolgende Klick wird in der Capture-Phase geschluckt,
  damit das Modal nicht aufgeht.
- `.mm-fb-fab` steht in der Ausschlussliste von [`swipe.js`](src/js/swipe.js) —
  sonst wäre ein Zug nach links gleichzeitig ein Schritt zurück.

## Ladezeit
Gemessen am **Produktions-Build** (`npm run preview`), nicht am Dev-Server —
der liefert unbundled Module und zeigt völlig andere Zahlen.
- **Der Flaschenhals sind Bilder, nicht der Code.** Startseite: ~8 MB Bilder
  gegen 74 KB kritisches JavaScript. Vor jeder Code-Optimierung dort messen.
- **Statische Importe sind Ketten.** `quiz.js` → `drop-animation.js` →
  `garage.js` zog three.js und Leaflet (633 KB) in jeden Chunk, der das Quiz
  anfasst — und über die Quiz-Vorbereitung auf die Startseite. `loadGarage`
  wird deshalb dynamisch geladen. **Beim Hinzufügen statischer Importe in
  quiz/drop-animation prüfen, was mitkommt.**
- Die Quiz-Vorbereitung (three.js + ein 1,5-MB-Fahrermodell aus Supabase)
  hängt an der Absicht: Zeiger/Berührung auf `#hero-cta`. Rückfall nach 12 s,
  und nur wenn die Verbindung weder `saveData` noch 2g/3g meldet.
- Das Hero-Video (3,8 MB) wird ohne `src` ausgeliefert; `startHeroVideo()` in
  [`landing.js`](src/js/landing.js) hängt sie nach dem `load`-Ereignis an und
  überspringt es bei `saveData`, 2g oder `prefers-reduced-motion`.

## Geräteränder (Dynamic Island, Notch, Gestenleiste)
Vier Tokens in `:root` statt `env()` an jeder Stelle:
`--sa-top`, `--sa-bottom`, `--sa-left`, `--sa-right`. Sie funktionieren nur,
weil `index.html` `viewport-fit=cover` setzt.
- **Immer die Tokens benutzen, nie `env()` direkt.** `env()` lässt sich nicht
  überschreiben — über die Tokens kann man ein Gerät simulieren
  (`document.documentElement.style.setProperty('--sa-top','59px')`) und das
  Layout prüfen, ohne so ein Gerät zu haben.
- **Ränder gehören in die Grundregel, nicht in den 767px-Block.** Ein Handy im
  Querformat ist über 767px breit und hat trotzdem eine Aussparung — nur eben
  seitlich. Genau daran lag der Zurück-Pfeil vorher unter der Island. Auf
  echten Desktops sind die Tokens 0, die Rechnung ist dort folgenlos.
- `--sa-left`/`--sa-right` sind für Querformat da und waren vorher nirgends
  berücksichtigt. Betroffen: alles randlos über die volle Breite —
  Tab-Leiste, Zurück-Pfeil, Community-Raster, Feedback-Knopf, Install-Hinweis.
- **Die Tab-Leiste rechnet den unteren Rand bewusst nur zur Hälfte ein**
  (`--tb-mobile-bottom`). Voll gerechnet stand sie sichtbar zu hoch. Gemessen
  auf iPhone-Maßen: Leistenkante 25px vom Rand, Tippflächen ab 31px — außerhalb
  der ~20px-Wischzone von iOS. Wer sie tiefer oder höher will, dreht an
  `--tb-mobile-gap`.

## Formensprache für Bedienleisten
Wo mehrere Zeilen/Knöpfe untereinander stehen, hängen die Maße an **einem
Satz Tokens** statt an Einzelwerten je Regel — sonst driften linke Kanten,
Radien und Zeilenhöhen auseinander, und genau das fällt auf.
- Karten-Panel/Sheet: `--kv-ctl-h`, `--kv-ctl-r`, `--kv-ctl-fs`, `--kv-pad-x`.
- Gruppen-Spalte der Community: `--mmc-pad-x`, `--mmc-inset`, `--mmc-row-h`,
  `--mmc-row-r`, `--mmc-row-fs` auf `.mmc-col2-body` (am Dateiende).
  `--mmc-inset` ist die Einrückung der Zeilenflächen; der Text rechnet mit
  `calc(var(--mmc-pad-x) - var(--mmc-inset))` dagegen, damit er trotz
  eingerückter Fläche auf derselben Kante sitzt wie die Abschnittslabels.
- Die Tokens sind bewusst auf `.mmc-col2-body` begrenzt: `.mmc-vc-row` und
  `.mmc-dm-empty` kommen auch in anderen Spalten vor.
- **Rangfolge über Helligkeit, nicht über Farbe.** Die App ist einfarbig; die
  drei Stufen sind überall dieselben: **gefüllt weiß** (Hauptaktion, Inhaber,
  „Beitreten", Installieren) → **Kontur** (zweite Ebene, Moderation,
  „Verlassen") → **gedämpft** (Mitglied, „Voll"). Grün/Rot/Bernstein sind aus
  Talks, Rollen, Stummschaltung und Formular-Rückmeldung entfernt. Farbe bleibt
  nur, wo sie echte Information trägt (Fehlermeldung, gedämpftes Rosé).
- **Kleine Icon-Knöpfe brauchen eine eigene Trefferfläche.** Das „+" für Talks
  war 20×20 — sichtbar bleibt es klein, die Trefferzone wächst über
  `::after { inset: -9px }` auf 44px, ohne das Layout zu verschieben. In einem
  Flex-Kopf zusätzlich `flex: 0 0 auto`, sonst quetscht ihn der Container.

## Community-Kategorieleiste
`fillRail()` in [`community.js`](src/js/community.js) rendert die linke
Icon-Leiste für **alle drei** Ansichten (Freunde, in einer Gruppe, Übersicht).
- Vorher gab es sie dreimal: `fillFriendsRail()`, `fillCatRail()` und in der
  Übersicht einen Nachbau aus Spalte 2 (`col2ServerHtml()` mit
  `.mmc-nav-item`/`.mmc-cat`). Beim Kategoriewechsel sprang deshalb die ganze
  linke Spalte um — anderes Markup, andere Maße, Ungelesen-Punkte nur in einer
  der drei Fassungen. `fillCol2`/`col2ServerHtml` sind entfernt.
- Welcher Eintrag aktiv ist, ergibt sich aus dem Zustand (`friendsMode`,
  `activeGroup`, `serverCategory`), nicht aus der Ansicht. **Neue Ansicht =
  `<nav class="mmc-catrail">` einsetzen und `fillRail(root)` rufen**, nichts
  nachbauen.
- Die Spaltenbreite ist überall 72px (`.mmc` und `.mmc--overview`), auf Mobil
  54px — sonst springt die Leiste beim Wechsel um ein paar Pixel.

## Bekannte Einschränkungen
- Passwörter im Klartext in localStorage — nur Prototyp, kein Security-Fix nötig, aber nichts darauf aufbauen
- QR-Login, Shop, Quests sind Platzhalter

## Sprachkanäle (LiveKit)
Echtes Audio über LiveKit (SFU statt des früheren selbstgebauten
RTCPeerConnection-Mesh ohne TURN-Server — funktionierte dadurch hinter
symmetrischem NAT nicht zuverlässig). Serverseitiges Token-Minting in
[`api/livekit-token.js`](api/livekit-token.js) (Muster wie `api/ai-match.js`:
`checkOriginAndRate` zuerst, danach Supabase-Session verifizieren und prüfen,
dass der Nutzer Mitglied der Gruppe ist bzw. die Gruppe offen ist — spiegelt
die `vr_select`-RLS-Policy). Client-Logik in
[`src/js/voice.js`](src/js/voice.js), exportierte Funktionssignaturen
unverändert gegenüber vorher, `community.js` musste dafür nicht angepasst
werden. Die "wer ist im Raum, ohne beizutreten"-Anzeige läuft weiterhin über
Supabase-Realtime-Presence, unabhängig vom Audio-Transport.
**Setup nötig:** kostenloses Projekt auf cloud.livekit.io anlegen,
`VITE_LIVEKIT_URL` in `.env` sowie `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`
(ohne `VITE_`-Prefix) lokal in `.env` und in Vercel als Server-Env-Var setzen
— siehe `.env.example`. Ohne diese Vars liefert `joinVoiceRoom()` einen
sprechenden Fehler statt einer stillen Fehlfunktion.
Bildschirmfreigabe ist auf Transport-Ebene fertig (`toggleScreenShare()` in
`voice.js`), aber noch ohne eigene Video-Kachel-UI — folgt separat.

## Push-Benachrichtigungen (Web Push)
Desktop-Benachrichtigungen für DMs + Freundschaftsanfragen (Scope V1 bewusst
klein gehalten — Gruppennachrichten sind ein Fast-Follow, kein Teil davon).
Service Worker [`public/sw.js`](public/sw.js), Client-Logik
[`src/js/push.js`](src/js/push.js) (Registrierung, Subscribe/Unsubscribe,
speichert in `push_subscriptions`). Versand serverseitig in
[`api/push-trigger.js`](api/push-trigger.js), ausgelöst per **Supabase
Database Webhook** (kein Browser-Origin, daher kein `checkOriginAndRate`,
sondern ein geteiltes Secret im Header `x-webhook-secret` gegen
`SUPABASE_WEBHOOK_SECRET`). Der Endpoint braucht `SUPABASE_SERVICE_ROLE_KEY`
(umgeht RLS, da er für beliebige Empfänger nachschlagen muss) — sensibelster
Key im Projekt bisher, niemals mit `VITE_`-Prefix.
Mute-Status wird zusätzlich zur lokalen `isMuted()`/localStorage-Logik in
`notification_mutes` gespiegelt (Dual-Write in `setMute`/`removeMute` in
`community.js`), damit der Server gemutete DMs nicht anstößt.
Deep-Link beim Notification-Klick: `?dm=<username>` wird von `mountCommunity()`
beim Start gelesen und öffnet die richtige Unterhaltung direkt.
**Setup nötig:** VAPID-Keys selbst generiert (`npx web-push generate-vapid-keys`,
kein Account nötig) — `VITE_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/
`VAPID_SUBJECT` in `.env` + Vercel setzen. Zusätzlich im **Supabase Dashboard
→ Database → Webhooks** einen Webhook auf `friend_requests`-INSERT anlegen,
Ziel `.../api/push-trigger`, Header `x-webhook-secret` = `SUPABASE_WEBHOOK_SECRET`.
Ohne diese Vars liefert `enablePushNotifications()` einen sprechenden Fehler.

## Passwort-Reset-Flow
Öffentlicher "Passwort vergessen"-Weg im Auth-Modal (`openAuthModal` → Link
"Passwort vergessen?" im Login-Modus, im `OFFLINE_MODE` ausgeblendet). Nutzt
Supabase `resetPasswordForEmail` mit `redirectTo = <origin>/?reset=1`. Nach
Klick auf den Mail-Link öffnet `startApp()` bzw. der `PASSWORD_RECOVERY`-Event
in `initSupabaseAuth` den Reset-Screen (`openPasswordResetScreen`), der per
`supabase.auth.updateUser({ password })` das neue Passwort setzt und den
`?reset=1`-Param wieder entfernt.

**Wichtig für Betrieb:** Das Reset-Mail-Template muss im Supabase-Dashboard auf
Deutsch angepasst werden (**Authentication → Email Templates → "Reset Password"**),
sonst kommt die Standard-englische Vorlage. Ebenso `Site URL` und
`Additional Redirect URLs` unter **Authentication → URL Configuration** um die
produktive Domain (mit `/?reset=1`) ergänzen.

## Beta-Feedback-Kanal
Floating Action Button (💬 „Feedback") rechts unten auf allen Screens, init in
`startApp()` via [`src/js/feedback.js`](src/js/feedback.js). Submit schreibt in
Tabelle `beta_feedback` (Supabase, siehe `supabase/schema.sql` — Migration
einmalig im SQL-Editor ausführen). Im `OFFLINE_MODE` Fallback in
localStorage-Key `mm_beta_feedback_local`.

**Feedback einsehen:** Supabase-Dashboard → **Table Editor → `beta_feedback`**,
Spalte `created_at` absteigend sortieren. Kein SELECT-Policy für User, d. h.
niemand außer über das Dashboard (Service-Role) kann die Einträge lesen.

## Arbeitsregeln
- **Beim Kompaktieren immer die Liste geänderter Dateien und offene TODOs erhalten.**
- Bei Zweifel zu Scope oder Priorisierung: erst [docs/ROADMAP-BETA.md](docs/ROADMAP-BETA.md) lesen, dann handeln.
- Keine neuen Features vor Abschluss von **Phase 0 (Sicherheitsnetz)** in der Roadmap.
- Vor jedem Beginn: `git status` — wenn dirty, erst committen. Nie mehr als eine Aufgabe pro Commit sammeln.

## Bekannte Karteileichen (nicht auf denen aufbauen)
- [`src/js/map-view.js`](src/js/map-view.js) — nirgendwo importiert, wird gelöscht (T1.1 in Roadmap)
- `CLAUDE.md.backup` — alt, wird gelöscht
- Windows-Asset-Kopie in [`vite.config.js`](vite.config.js) L6–70 — inert auf macOS, wird entfernt
- localStorage-Duplikate: `mm_gear_favs`/`mm_kv_favs`, `mm_comm_friends_v1`/`v2`, `mm_comm_prefs`/`_v1` (T1.4)
- 13 Footer-TODO-Links in [`src/js/landing.js`](src/js/landing.js) L365–393 (T1.2)
- Die nachgebaute Community in [`src/js/bike-detail.js`](src/js/bike-detail.js)
  (`cc-*`/`ccd-*`/`ccg-*`, ~L880–1250 plus Handler ab L4240): Einstiegspunkt
  `buildCommunityView()` wird **nirgends aufgerufen** — der Community-Reiter
  rendert `community.js` (`mmc-*`). Alles daran (Kommentare, Gruppenchat,
  `MOCK_COMMENTS`, `getUserComments`) ist unerreichbar. Die fehlenden
  `esc()`-Aufrufe darin waren genau deshalb so lange unbemerkt.
