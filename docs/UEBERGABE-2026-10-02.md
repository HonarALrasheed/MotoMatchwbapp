# MotoMatch — ÜBERGABE (Stand: 2026-10-02, `main` = d72e0f8)

> Für Claude Code und jede neue Session. **Ergänzt `CLAUDE.md`** (technische Regeln, Konventionen)
> um das, was dort nicht steht: was seit dem 2026-09-29 passiert ist, **warum**, wo es im Code liegt,
> was außerhalb des Codes eingerichtet wurde und was offen ist. `docs/STATUS.md` und
> `docs/ROADMAP-BETA.md` sind vom 2026-08-11 und in Teilen überholt (siehe Abschnitt 8).

---

## 1. In fünf Sätzen

MotoMatch ist live auf **motomatch.studio** (Vercel, Produktion = Branch `main`). Alle Arbeit der
Branch `fix/vercel-lfs` (~85 Commits: 203-Bike-Katalog, Rechtsseiten, Login, Community, PWA …) wurde
nach `main` gebracht (#5). Danach lag der Schwerpunkt auf **Auffindbarkeit**: 3.525 statische Seiten
für Google, Bing und KI-Assistenten (#6–#8), dazu Sicherheits-Header, Ladezeit, zwei Bugfixes
(Walze, Maps/Safari) und eine bereinigte Prüfung des Matchings (#9–#10). Das Matching selbst ist über
alle 129.600 Quizwege ohne Befund. Offen sind vor allem **Katalogdaten** (falsche Gewichte, 780 von
1.182 Bikes ohne Foto), **Rechtliches** (Datenschutzerklärung, AVV) und ein **Handy-Durchlauf** vor
der Beta-Einladung.

---

## 2. Sofort wissen (Fallen, die schon Zeit gekostet haben)

1. **Produktion = `main`.** Vercel → Settings → Environments → Production → Branch Tracking stand
   versehentlich auf `fix/vercel-lfs`; Merges nach `main` waren nur Previews (Symptom: Domain lieferte
   `/sitemap.xml` mit 404). Seit 2026-09-30 korrigiert. **Nicht zurückstellen.** Jeder Merge nach
   `main` geht live.
2. **SEO-Skripte liegen in `scripts/`, nicht in `tools/`.** `.vercelignore` schließt `tools/` (Bildwerkstatt,
   mehrere GB) vom Upload aus — der Vercel-Build fände `seo-seiten.mjs` dort nicht und bräche ab.
3. **`npm run build` = `vite build && node scripts/seo-seiten.mjs`.** Die ~3.500 Seiten entstehen nur in
   `dist/`, nicht im Repo und nicht im Dev-Server. Ansehen: `npm run build`, dann `npx vite preview`.
4. **`#landing` in `index.html` ist nicht leer** (`.mm-vorab`, Textfassung für Crawler ohne JavaScript).
   `ensureLandingRendered()` in `src/js/landing.js` wertet sie als „noch nicht aufgebaut“. Wer irgendwo
   auf „#landing leer“ prüft, bekommt nach einem Reload mitten in der App eine schwarze Startseite.
5. **`katalog-de.json` (~900 KB) lädt erst im Leerlauf nach `load`** (`src/js/app.js`, `katalogImLeerlauf`).
   Wer den Vollkatalog früher braucht, ruft `ladeVollkatalog()` selbst (idempotent). Neuer Code, der
   `getCatalog()` beim Start liest, sieht sonst nur die ~400 Bikes mit Foto.
6. **Walze und Ergebnisseite müssen dasselbe Bike zeigen.** Beide rechnen mit `ERGEBNIS_ANZAHL` (5) aus
   `src/js/matching.js`: die Budget-Lockerung in `findTopMatches()` hängt von `n` ab. Nie mit anderem `n`
   aufrufen, wenn das Ergebnis dasselbe sein muss.
7. **`robots.txt`: KI-Crawler stehen in derselben Gruppe wie `*`.** Eine eigene Gruppe je Bot würde für
   ihn die `Disallow`-Zeilen der Rechtsseiten aufheben (Bots lesen nur ihre eigene Gruppe).
8. **IndexNow-Schlüsseldatei** `public/7a0a8c61046ce4400d26bb1e1ae8653b.txt` nicht umbenennen oder
   löschen. Der erste Lauf scheitert mit 403 „SiteVerificationNotCompleted“, solange Bing die Domain noch
   nicht kennt — danach erneut starten.
9. **`Permissions-Policy` (vercel.json)** erlaubt Mikrofon, Bildschirmfreigabe, Standort nur für die eigene
   Seite, sperrt Kamera. Neue Browser-Funktion = dort freigeben, sonst lehnt der Browser still ab.
10. **Das Ergebnis von `findTopMatches()` trägt zwei nicht aufzählbare Eigenschaften:** `.hinweis` und
    `.auswahl` (die Kandidatenmenge). `.filter()`/`.slice()` verlieren sie.
11. **Ein falscher Wert im Katalog steht jetzt öffentlich** (Vergleichsseiten heben „leichter/stärker“
    hervor, FAQ-Antworten zitieren „das leichteste Modell“; Google und KI übernehmen das wörtlich).
    Korrigiert wird in der Pipeline (`tools/catalog/`), nicht in `katalog-de.json`.

---

## 3. Was passiert ist (nach Pull Request)

| PR | Inhalt | Wichtigste Stellen |
|---|---|---|
| **#5** | `fix/vercel-lfs` → `main` (~85 Commits) inkl. Konfliktlösung mit #4, **Walzen-Fix**, **Quiz-Hänger-Fix** | siehe unten |
| **#6** | 3.525 SEO-Seiten, Sitemap, Canonical, JSON-LD, Titel, **IndexNow**, **Sicherheits-Header** | `scripts/seo-seiten.mjs`, `scripts/indexnow.mjs`, `.github/workflows/indexnow.yml`, `vercel.json`, `index.html` |
| **#7** | **KI-Sichtbarkeit**: Startseite ohne JS lesbar, `llms.txt`, FAQ, strukturierte Daten, `robots.txt` | `index.html`, `scripts/seo-seiten.mjs`, `public/robots.txt`, `src/js/landing.js` |
| **#8** | **Ladezeit**, **Direktlink** `?motorrad=`, **Bilder-SEO**, verwandte **Suchbegriffe** | `src/js/app.js`, `src/js/garage.js`, `scripts/seo-seiten.mjs` |
| **#9** | **Google Maps** (Safari-Fehler in Sentry) | `src/js/garage.js` (`loadGoogleMapsScript`) |
| **#10** | **Wachhund** ohne Fehlalarme, `CLAUDE.md` (Deployment, Ladezeit) | `tools/matching-wachhund.mjs`, `src/js/matching.js` |
| **#11** | **Vercel Analytics** auch auf den Katalogseiten | `scripts/seo-seiten.mjs` |

### #5 — `fix/vercel-lfs` nach `main`
- Konfliktlösung mit #4 (WebP-Umstellung, three.js per dynamischem Import, Quiz-Absturz-Fix):
  three.js lädt erst beim Aufbau eines Viewers (`garage.js`, `bike-detail.js`); die Studio-Bild-Zweige
  der Garage/Detailseite blieben; **Bildpfade: Version des Branches** (WebP direkt aus `public/bikes/`),
  das dadurch ungenutzte `public/img/` aus #4 wurde entfernt; `leaflet`, `lottie-web`, `three-stdlib` raus
  (nirgends importiert); `package-lock.json` per `npm install` neu erzeugt; Quiz-Vorbereitung des Branches
  (Absicht + 12-s-Rückfall) behalten.
- **Walzen-Fix** (485e832): `findBestBike()` fragte `findTopMatches(…, 1)`, die Ergebnisseite `(…, 5)`.
  Auf 37.884 von 129.600 Quizwegen (29 %) hielt die Walze beim anderen Bike. Seitdem `ERGEBNIS_ANZAHL`.
- **Quiz-Hänger** (7fd7287): Das Quiz kam nach „Match finden“ nur weiter, wenn das 3D-Modell von Supabase
  geladen war (`exitPhase === 2 && bikePivotGroup` in `loop()`). Jetzt Rückfall 2,5 s nach `exitPhase = 2`
  auf `finishExit()` (`triggerExit()` in `src/js/quiz.js`).

### #6 — SEO-Seiten, IndexNow, Header
- `scripts/seo-seiten.mjs` liest `public/data/katalog-de.json` und schreibt nach `dist/`:
  `/motorrad/<slug>/` (1.182), `/motorraeder/` + `/motorraeder/<thema>/` (75: Führerschein, Bauart,
  Bauart × A2/125, Budget, A2 × Budget, Einsteiger, Sitzhöhe, Gewicht, Marken), `/vergleich/<a>-vs-<b>/`
  (2.265), `sitemap.xml` (**3.525** Adressen = 1 Start + `/motorraeder/` + `/vergleich/` + 75 + 1.182 + 2.265),
  `seo.css`. Eigenes Stylesheet, kein App-JavaScript.
- **Vergleiche** (`vergleiche` im Skript): die 3 ähnlichsten Modelle je Bike (`findSimilarBikes`), nur gleiche
  Bauart, beide mit Preis, Preis **und** PS höchstens Faktor 1,6 auseinander (`verhaeltnis`).
- **Jede Seite trägt echte Katalogdaten** — Seiten, die nur Suchbegriffe wiederholen, wertet Google als
  Doorway-Pages und stuft die ganze Domain ab. Neue Themen nur mit eigener Datenauswahl.
- `index.html`: `canonical`, JSON-LD, absolute `og:image`-URLs, Titel „MotoMatch – Motorrad-Quiz: …“.
- **IndexNow**: `scripts/indexnow.mjs` meldet die *live* ausgelieferte Sitemap an `api.indexnow.org`;
  `.github/workflows/indexnow.yml` läuft nach jedem erfolgreichen **Production**-Deploy von Vercel
  (`deployment_status`, `startsWith(environment, 'Production')`) und per `workflow_dispatch`.
- **Header** (`vercel.json`): `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, HSTS 2 Jahre (ohne `includeSubDomains`),
  `Permissions-Policy`. **Bewusst keine volle Script-CSP** (müsste Supabase, Maps, LiveKit, Sentry,
  Vercel Analytics, CartoCDN einzeln freigeben und bräche beim nächsten Dienst still).

### #7 — KI-Sichtbarkeit
- Die meisten KI-Crawler (GPTBot, ClaudeBot, PerplexityBot …) führen **kein JavaScript** aus → die Startseite
  war für sie leer. Jetzt `#landing > main.mm-vorab` in `index.html` (Text + Links auf Themenseiten),
  für Besucher mit JS per Klasse `js` (Inline-Skript im `<head>`) ab dem ersten Byte unsichtbar.
- `dist/llms.txt` (llmstxt.org) entsteht im selben Skript.
- Themen- und Bike-Seiten: **„Häufige Fragen“**, aus Katalogdaten beantwortet (`themaFragen`, `bikeFragen`),
  sichtbar **und** als `FAQPage`-JSON-LD (nur beides zusammen ist erlaubt). Dazu `ItemList` (Themen),
  `Motorcycle` (Bikes), `WebSite` + `Organization` + `WebApplication` (Startseite).
- `robots.txt` nennt KI-Crawler namentlich (Gruppe wie `*`, siehe Abschnitt 2, Punkt 7).

### #8 — Ladezeit, Direktlink, Bilder-SEO, Suchbegriffe
- **Ladezeit** (gemessen mit Handy-Profil: 390 px, 1,6 Mbit/s, 150 ms, CPU 4× gedrosselt): LCP vorher
  2,36 / 3,54 / 2,40 s, nachher 2,29 / 2,26 / 2,33 s. Hebel: Vollkatalog im Leerlauf, Hero-Wörter enger
  gestaffelt (60 ms + 90 ms je Wort in `landing.js`). Die Startseite wiegt nur ~377 KB Bilder — die frühere
  Angabe „~8 MB“ war überholt.
- **Direktlink** `/?motorrad=<slug>` (`app.js`): eindeutig über den Katalog-`slug`, wartet auf den Vollkatalog.
  `?bike=<Name>` und `openView()` (Reload-Wiederherstellung) warten jetzt ebenfalls, wenn das Bike fehlt
  (vorher „Bike nicht gefunden“ für alle Bikes ohne Foto). `openBikeGarage()` nimmt auch ein Katalog-Objekt.
  Jede Bike-Seite hat „In MotoMatch ansehen“ und „Passt sie zu mir? Quiz starten“.
- **Bilder-SEO**: Bild-Sitemap (1.206 echte Fotos, Platzhalter-Silhouetten bewusst nicht), Alt-Texte
  „Modell, Bauart – Ansicht“ (`altText()`), `fetchpriority="high"` am Titelbild.
- **Suchbegriffe**: zweiter Absatz je Themenseite (`STIL_MEHR`, `themaMehr()`) mit den Wörtern, die Leute
  tippen (Streetfighter, Leichtkraftrad, Stufenführerschein, gedrosselt, Fahranfänger …) in ganzen Sätzen;
  Führerscheinseiten erklären die Regeln. Titel in Suchform: „<Modell> gebraucht: …“, „<A> oder <B>? …“.

### #9 — Google Maps (Sentry: „Loader.provide not called by module 'places'“, Safari)
Zwei Ursachen in `loadGoogleMapsScript()` (`src/js/garage.js`): (1) lief das 8-s-Zeitlimit ab, setzte es alles
zurück und der nächste Versuch band ein **zweites** `maps/api/js`-Skript ein; (2) `places` wurde doppelt
angefordert (`libraries=places` **und** `importLibrary`). Jetzt: Bootstrap-Skript mit eigenem Promise
(`gmapsBootstrap`), das das Zeitlimit überlebt; **kein** `libraries=` in der URL; Bibliotheken nacheinander.
In Chromium nachgewiesen (2 Skripte → 1), **Safari selbst nicht getestet** → nach dem Deploy in Sentry beobachten.

### #10 — Wachhund
`tools/matching-wachhund.mjs` meldete über 155.000 „Befunde“ — alles **Fehlalarme des Prüfers, nicht des
Matchings**: kannte nur einen von drei Hinweistexten („hier auch bis … €“), ignorierte „30.000 €+“
(`BUDGET_SLIDER_MAX`), und prüfte Sitzhöhe/Markengrenze gegen den ganzen Markt statt gegen die Kandidatenmenge
(`ergebnis.auswahl`). Jetzt: 129.600 Kombinationen, keine Beanstandung. Gegenprobe mit absichtlich
eingebauten Fehlern (Markengrenze aus → 4.734 Befunde; Preise über Budget → 380.250).

### #11 — Analytics
Die statischen Seiten laden kein App-JS und zählten in Vercel Analytics nicht mit. Jetzt dasselbe
Messverfahren wie `src/main.js`: Skript-Tag `/_vercel/insights/script.js`, ohne Cookies, ohne
Einwilligungsbanner. (Die ersten Besucher im Dashboard waren fast nur Crawler: USA 83 %, Android/Windows
42/42 % = Googlebot Mobil/Desktop.)

---

## 4. Außerhalb des Codes (Konten und Dienste)

| Dienst | Stand |
|---|---|
| **Vercel** | Projekt `moto-matchwbapp`, Production Branch = `main`, Domains `motomatch.studio` + `www` (beide Production), Analytics an. Env-Variablen für Production **ungeprüft** (Supabase, VAPID, LiveKit, Service-Role, Webhook-Secret, `ALLOWED_ORIGINS`). Firewall → „AI Bots“ darf nicht auf *Block* stehen. |
| **Google Search Console** | Domain-Property `motomatch.studio` bestätigt; `sitemap.xml` eingereicht („Erfolgreich“, 3.525 erkannte Seiten); Startseite „URL ist auf Google“. Daten unter „Leistung“ erst nach 1–2 Tagen. |
| **Bing Webmaster Tools** | per Import aus der Search Console eingerichtet; Sitemap (vollständige URL) vom Nutzer eingetragen. |
| **IndexNow** | läuft automatisch nach Production-Deploy (siehe #6). |
| **Sentry** | Projekt `moto-match-web`. Safari-Fehler zu Maps → nach #9 beobachten, ob neue Events ausbleiben. |
| **Webgains** | Bewerbung (Affiliate) **abgelehnt**, Begründung „Minderwertige, unvollständige oder nicht funktionsfähige Websites“. Vermutlich: viele Bikes ohne Foto („Foto folgt“), „Preis folgt“, Beta-Hinweise, neue Domain ohne Reichweite. Plan unten (Abschnitt 6, D). |
| **Supabase** | Migrationen in `supabase/migrations/` (README dort lesen). Die Baseline ist ein **Platzhalter** (`RAISE EXCEPTION`) — erst `supabase db dump` einspielen. Security Advisor **ungeprüft**. |

---

## 5. Wo nachschauen

| Thema | Stelle |
|---|---|
| Konventionen, Regeln, Betrieb | `CLAUDE.md` (Abschnitte *Katalogseiten für Google*, *Sicherheits-Header*, *Deployment*, *Ladezeit*) |
| SEO-Seiten, Sitemap, `llms.txt`, FAQ | `scripts/seo-seiten.mjs` (Kopf-Kommentar lesen) |
| IndexNow | `scripts/indexnow.mjs`, `.github/workflows/indexnow.yml` |
| Startseite ohne JS | `index.html` (`.mm-vorab`, Inline-`<style>`), `ensureLandingRendered()` in `src/js/landing.js` |
| Katalog im Leerlauf, Direktlinks | `src/js/app.js` (`katalogImLeerlauf`, `?motorrad=`, `openView`), `ladeVollkatalog()` in `src/js/matching.js` |
| Matching, `ERGEBNIS_ANZAHL`, Hinweise | `src/js/matching.js` (`findTopMatches`, `findBestBike`) |
| Prüfung des Matchings | `tools/matching-wachhund.mjs` (`node tools/matching-wachhund.mjs`, ~4–5 min) |
| Walze | `src/js/drop-animation.js` |
| Quiz-Ausgang | `triggerExit()`, `finishExit()` in `src/js/quiz.js` |
| Karte / Maps-Lader | `loadGoogleMapsScript()`, `ladeGmapsBootstrap()` in `src/js/garage.js` |
| Bild-Auswahl, Platzhalter | `src/js/bike-bild.js` (`bikeBild`, `hatFoto`) |
| Katalog-Pipeline | `tools/catalog/matching_katalog.py` (`technik_pruefen()`), `plausi.py`, `daten/bikes_de.csv` |
| Header | `vercel.json` |
| Messung | `src/main.js` (App), `scripts/seo-seiten.mjs` (statische Seiten) |

---

## 6. Offen (priorisiert)

### A. Vor der Beta-Einladung
1. **Handy-Durchlauf** (Golden Path): Startseite → Quiz → Walze → Ergebnis → Registrierung → Community →
   Karte. Wurde **noch nicht** gemacht. Dabei auch Sprachkanal und Karte prüfen (neue `Permissions-Policy`).
2. **Datenschutzerklärung** um neue Dienste ergänzen (LiveKit, Vercel Analytics, Web-Push, Sticker-Dienst —
   gegen die tatsächlich geladenen Dienste abgleichen) und **AVV** mit Supabase, Vercel, Sentry. Kein
   Rechtsrat, Abgleich Code ↔ Text.
3. **Supabase Security Advisor** prüfen; **Vercel-Env-Variablen** für Production prüfen; **2FA** für GitHub,
   Vercel, Supabase, Domain-Anbieter.

### B. Katalogdaten (in der Pipeline, nicht in `katalog-de.json`)
4. **Falsche Werte** (Stand 2026-09-30): Honda CBR600RR 310 kg (real ~190), MV Agusta F4 RC 291 kg (real
   ~190), Honda Monkey 125 mit 4 PS/58 kg (Daten der 50er vermischt; sie ist dadurch „leichtestes Naked
   Bike“). Vorschlag: Gewichtsprüfung in `technik_pruefen()` (Median je Bauart/Hubraumklasse, Ausreißer →
   `None`, nicht raten, wie bei der Sitzhöhe). Danach `npm run build`, `dist/motorraeder/naked-bike/` und den
   Vergleich ZX-6R/CBR600RR prüfen, `node tools/matching-wachhund.mjs` darf nicht schlechter werden.
5. **Dubletten/Einordnung**: z. B. „Kawasaki VN900 Classic“ ↔ „Vulcan 900 Classic“; die Honda Grom steht als
   „Sportbike“ mit Einsatz „Rennstrecke“. Fast alle „Gleiche-Bauart“-Vergleichspaare sind echte Varianten
   (RSV4 RF/RR), nur wenige echte Dubletten.

### C. Sichtbarkeit (wirkt über Wochen)
6. Search Console → *Seiten* und Bing → *Such-Performance*/*AI Performance* beobachten.
7. **Nicht gebaut, aber besprochen**: teilbare Quiz-Ergebnisse („Mein Match: …“ mit Link und Vorschaubild);
   Wertverlust-Studie aus den Preisdaten (Ranglisten je Klasse); Ratgeber-Seiten (A2 drosseln, B196, erstes
   Motorrad, kleine Fahrer); SEO-Seiten im Design der App; `sameAs`-Links im JSON-LD, sobald es
   Instagram/TikTok/YouTube gibt; Vorlage für Mail an Fahrschulen. Außerhalb des Codes: Links von
   Fahrschulen, Foren, Reddit, Kurzvideos.

### D. Webgains / Partnerprogramme
8. Beim Publisher-Team nachfragen, was konkret beanstandet wurde. **Nicht gebaut**: Bikes ohne Foto aus dem
   Schaufenster nehmen (Startseite, Listen, Walze), „Preis folgt“ verhindern (383 Treffer in
   `src/js/freigegebene-bikes.js`; sichtbar, bis der Vollkatalog da ist), „Beta“-Hinweise dezenter,
   2–3 echte Ratgeber-Artikel. Neubewerbung nach 4–6 Wochen.
9. **Fotos**: 402 von 1.182 Bikes haben ein echtes Foto; die übrigen zeigen die Platzhalter-Silhouette.

### E. Hygiene
10. `npm audit --omit=dev`: 19 moderate Warnungen, alle in `@opentelemetry/core` über `@sentry/node`
    (nur serverseitig, nicht dringend; Behebung = größeres Sentry-Update).
11. `CLAUDE.md` Kopf („Aktueller Fokus 2026-08-11“, „Beta-Blocker …“) und `docs/STATUS.md`/`ROADMAP-BETA.md`
    spiegeln den Stand vom August — bei Gelegenheit aktualisieren.

---

## 7. Arbeitsweise und Test-Rezepte (Cloud-Sandbox)

- **PRs mergt der Nutzer selbst.** Ablauf: Branch `claude/wizardly-faraday-p9ch7z` → PR nach `main` → Vercel
  baut Preview → Nutzer klickt „Merge“ → danach Branch neu von `origin/main` aufsetzen
  (`git fetch origin main && git checkout -B <branch> origin/main`, Push mit `--force-with-lease`).
  Keine PRs ohne Auftrag. Commit-Footer und PR-Footer wie in der Session-Anweisung.
- **GitHub nur über die MCP-Tools** (`mcp__github__*`), kein `gh`. Vercel-Status:
  `curl https://api.github.com/repos/HonarALrasheed/MotoMatchwbapp/commits/<sha>/status`.
- **Aus der Sandbox nicht erreichbar:** `motomatch.studio`, Supabase (also auch die GLB-Modelle). Deshalb
  lässt sich der Live-Stand nur über Vercel-Status und GitHub-Actions-Läufe prüfen, nicht per `curl`.
- **App lokal testen:** `npx vite` (Dev-Server, `OFFLINE_MODE`). Ein **Produktions-Build der App startet ohne
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` absichtlich nicht** (Boot-Fehler); für Messungen mit Dummy-Werten
  bauen: `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vite build`.
  Statische SEO-Seiten brauchen das nicht.
- **Playwright** ist global installiert: `NODE_PATH=$(npm root -g) node skript.js` (Chromium unter
  `/opt/pw-browsers`). Das Onboarding-Overlay `#ob-overlay` fängt Klicks ab — im Test per `evaluate` entfernen.
- **Quiz Ende-zu-Ende** braucht das GLB-Modell von Supabase: `page.route('**/*.glb', …)` mit einem winzigen
  Ersatzmodell beantworten; ohne Modell greift jetzt der 2,5-s-Rückfall.
- **Google Maps** in der Sandbox: Anfragen an `*.googleapis.com`/`gstatic` per `page.route` mit `curl`
  (Proxy) bedienen; Verzögerung/Zeitlimit lässt sich so künstlich erzeugen.
- **Ladezeit** messen mit CDP: `Network.emulateNetworkConditions` (1,6 Mbit/s, 150 ms) +
  `Emulation.setCPUThrottlingRate` 4, mehrere Läufe (Ausreißer!).
- **Wachhund** mit absichtlich eingebautem Fehler gegenprüfen, bevor man seinen Befunden traut.
- Hintergrundläufe nie mit `git stash` überlappen lassen; `pkill`/`kill` per Muster kann die eigene Shell
  treffen — gezielt nach PID.

---

## 8. Überholte Angaben in älteren Dokumenten

- `CLAUDE.md` → „Aktueller Fokus (2026-08-11)“ und „Beta-Blocker“: Sentry, Rate-Limit, Passwort-Reset,
  Maps-Key-Restriktion sind inzwischen umgesetzt bzw. in eigenen Abschnitten beschrieben.
- `CLAUDE.md` → „Browser-Verifikation: Dev-Server immer über die Browser-Preview, nie per Bash“ — gilt für
  den lokalen Rechner (`.claude/launch.json` zeigt auf einen macOS-Node-Pfad). In der Cloud-Sandbox wurde der
  Dev-Server/Preview per Bash gestartet und mit Playwright geprüft, wie in Abschnitt 7.
- `docs/STATUS.md`, `docs/ROADMAP-BETA.md`: Stand 2026-08-11 (Git-Hygiene, 16 dirty files, Footer-TODOs,
  Voice/Talks „UI ausblenden“ …) — Voice/Talks über LiveKit, Web-Push, PWA und die Anmeldung per
  GitHub/Discord/Code per Mail sind inzwischen gebaut und im Code (ob die Provider im Supabase-Dashboard
  aktiv sind, ist ungeprüft). Marketplace, Shop, Quests, QR-Login bleiben Platzhalter.
- `CLAUDE.md` → *Ladezeit*: erwähnt noch „three.js und Leaflet (633 KB)“; Leaflet ist entfernt.
