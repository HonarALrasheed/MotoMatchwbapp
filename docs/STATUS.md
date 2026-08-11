# MotoMatch — STATUS (Stand: 2026-08-11)

> Analyse ohne Code-Änderung. Belegt am aktuellen `main`-Branch, uncommittete
> Änderungen inklusive. Wo etwas unsicher ist, steht es unter „Offene Fragen".

---

## 1. Was ist das Projekt in 5 Sätzen

MotoMatch ist eine deutschsprachige Web-App für Motorradfahrer:innen. Kern ist ein
Quiz, das aus Nutzerpräferenzen ein passendes Motorrad empfiehlt. Ergänzt wird das
durch eine Detailseite mit 3D-Viewer und Vergleich, eine „Garage" fürs eigene Bike,
eine Karte für Händler/Werkstätten, eine Discord-artige Community und einen
Gebrauchtmarkt-Aggregator. Zielgruppe der Beta sind laut Nutzer 10–30 Bekannte aus
dem Motorrad-Umfeld — also eine private geschlossene Beta, kein Public Launch.

---

## 2. Architektur & Stack

| Bereich | Ist-Zustand |
|---|---|
| Build | Vite 5.4, Node 20, npm |
| Sprache | Vanilla JavaScript (ES-Module), **kein UI-Framework** |
| Frontend-Muster | SPA über `display:none`-Container in [`index.html`](index.html); Rendering per Template-Strings + `innerHTML` |
| Auth | Supabase Auth (E-Mail+PW, OAuth-Skeleton) mit `OFFLINE_MODE`-Fallback auf localStorage in [`src/js/auth.js`](src/js/auth.js) |
| DB / Realtime | Supabase Postgres, Schema in [`supabase/schema.sql`](supabase/schema.sql), RLS auf allen Tabellen aktiv |
| Community-Backend | [`src/js/community-api.js`](src/js/community-api.js) — echter Abstraktions-Layer, Realtime auf `messages`, `friend_requests`, `group_members` |
| Server-APIs | Vercel Serverless Functions in [`api/`](api/): `ai-match.js` (OpenAI), `search-places.js` (Tavily) — Keys korrekt server-side |
| 3D | three.js + three-stdlib, GLB-Modelle |
| Karten | Leaflet (OSM) + Google Maps Places (Händler) |
| Styling | Ein Stylesheet, 9.984 Zeilen, [`src/styles/main.css`](src/styles/main.css) |
| Deployment | Vercel, Projekt `moto-matchwbapp`; Assets gitignored → Deploy nur per lokaler `vercel` CLI |
| Tests / Linter | Keine |
| Fehler-Monitoring | Keins |
| CI | Keine, außer Vercel-Build |

**Zusammenspiel.** [`src/main.js`](src/main.js) importiert CSS + ruft `startApp()`
aus [`src/js/app.js`](src/js/app.js). `app.js` versteckt alle Screens, ruft
`initSupabaseAuth()` und `initLanding()`. Alle weiteren Feature-Module werden
statisch oder dynamisch (per `import()`) nachgeladen. Ein echter Router existiert
nicht — Navigation ist Screen-Toggling + Event-Bus (`mm:auth-changed` u.a.).

---

## 3. Datenmodell

### Supabase (Prod-Backend)
Vollständig definiert und mit RLS in [`supabase/schema.sql`](supabase/schema.sql):
- `profiles` (bio, avatar als data-URL, dm_policy, notif-flags)
- `friendships`, `friend_requests`, `blocks`, `ignores`
- `groups`, `group_members`, `channels`, `messages` (Kanal + DM in einer Tabelle
  via `CHECK ((channel_id IS NOT NULL) != (dm_thread IS NOT NULL))`)
- `group_join_requests`, `invites`, `group_bans`
- `message_reports`, `user_reports`
- SECURITY-DEFINER-Funktion `email_for_username(uname)` für Login per Benutzername

**Sauber gemacht.** Fremdschlüssel, unique-Constraints, sinnvolle Indizes
(`messages_channel_created`, `messages_dm_created`), RLS-Policies für Owner/Mod-Rollen.

### localStorage (Legacy + Client-Cache)
41 verschiedene `mm_*`-Keys im Code. Kritisch: **Versions-Drift.** Es koexistieren:
- `mm_comm_friends_v1` **und** `mm_comm_friends_v2`
- `mm_comm_prefs` **und** `mm_comm_prefs_v1`
- `mm_gear_favs` **und** `mm_kv_favs`, dazu `mm_gear_favs_meta` und `mm_kv_favs_meta`
- `mm_recent_kv` (unklarer Zweck neben `mm_recent_bikes_v1`)

Mindestens eines jedes Duo-Paars ist Karteileiche — welches genau, muss durch
Grep in den Modulen entschieden werden (siehe „Offene Fragen").

### Bike-Stammdaten
Hart im Frontend, **doppelt hinterlegt**:
- [`src/js/matching.js`](src/js/matching.js) → Array `BIKES` (fürs Quiz)
- [`src/js/bike-detail.js`](src/js/bike-detail.js) → Objekt `BIKE_DATA` (Detailseite)

Rohquelle: `/Volumes/Untitled/MotoMatch/motorcycles_motoMatch.csv` (nicht im Repo).
Ein `import_motorcycles.py` liegt im Elternordner und würde nach Supabase
importieren — vom Frontend aber ungenutzt. → **Single Source of Truth fehlt.**

---

## 4. Feature-Inventar

Legende: **FERTIG** = funktioniert, für Beta tauglich · **HALBFERTIG** = läuft,
aber mit fehlenden Teilen · **KAPUTT** = wirft Fehler oder falsches Verhalten
(nur bei Belegen so markiert) · **TOT** = im Code, aber nicht verdrahtet ·
**PLATZHALTER** = UI ohne Logik

| Feature | Status | Pfad | LOC | Bemerkung |
|---|---|---|---|---|
| Landing-Page (Header, Hero, Sektionen) | FERTIG | [`src/js/landing.js`](src/js/landing.js) | 548 | Optisch stark; Hero-Video wird lokal nur unter Windows-Pfad kopiert |
| Landing-Footer (13 Links) | PLATZHALTER | [`src/js/landing.js`](src/js/landing.js) L365–393 | — | „Kontakt", „Karriere", „Newsroom", „Investor Relations", „MotoMatch AG", „Konfigurator", „Marktplatz" u.a. sind **alle** TODO ohne Zielseite |
| Match-Quiz | FERTIG | [`src/js/quiz.js`](src/js/quiz.js) | 1337 | Aufwendige Assembly-Animation als Hintergrund |
| Matching-Logik | FERTIG | [`src/js/matching.js`](src/js/matching.js) | 538 | Regel-basiert; kein ML, keine Personalisierung |
| KI-Erklärung zum Match | FERTIG | [`api/ai-match.js`](api/ai-match.js) + [`src/js/ai.js`](src/js/ai.js) | 59 + 49 | gpt-4o-mini, ein Satz Begründung; degradiert wenn Key fehlt |
| Bike-Detail + Tabs + Konfigurator | FERTIG | [`src/js/bike-detail.js`](src/js/bike-detail.js) | 3265 | Größtes Modul, funktional dicht |
| 3D-Viewer | FERTIG | Teil von `bike-detail.js` | — | GLB-Modelle liegen in `public/models/` (12 MB), gitignored |
| Bike-Vergleich | HALBFERTIG | `bike-detail.js` + `mm_compare_v1` | — | Zu prüfen: UI vollständig, Persistenz vorhanden |
| Garage (eigenes Bike, Wartung, Rides) | FERTIG | [`src/js/garage.js`](src/js/garage.js) | 1718 | localStorage-Persistenz (`mm_owned_bikes_v1`, `mm_maintenance_v1`, `mm_rides_v1`) — **nicht in Supabase** |
| Ausrüstungs-Guide | FERTIG | [`src/js/gear.js`](src/js/gear.js) | 231 | Klein, aber ausreichend für Beta |
| Community — Gruppen, Kanäle, DMs, Freunde | FERTIG | [`src/js/community.js`](src/js/community.js) + `community-api.js` | 3302 + 1176 | Über Supabase mit Realtime; sauberer API-Layer; ~identisches Offline-Verhalten |
| Community — Reports & Bans | FERTIG | Schema + `community-api.js` | — | `message_reports`, `user_reports`, `group_bans` sind da |
| Community — Talks/Voice | PLATZHALTER | [`src/js/voice.js`](src/js/voice.js) | 468 | 468 Zeilen Skeleton, kein echtes WebRTC-Signaling; TURN-Keys in `.env.local` |
| Community — Events/RSVP | HALBFERTIG | `community-api.js` L507, L546 | — | Eigene TODOs: „eventAt, meetingPoint, rsvp are not yet mapped to the Supabase DB schema" |
| Karte — Händler/Werkstätten | FERTIG | [`src/js/dealers.js`](src/js/dealers.js) | 326 | Google-Maps-basiert |
| Karte — Leaflet-Variante | TOT | [`src/js/map-view.js`](src/js/map-view.js) | 134 | **Nirgendwo importiert.** Referenziert CDN-Icons (leaflet-CDN). Karteileiche. |
| Marktplatz (Gebraucht-Aggregator) | FERTIG | [`src/js/marketplace.js`](src/js/marketplace.js) + [`api/search-places.js`](api/search-places.js) | 312 + 48 | Tavily-Suche über Kleinanzeigen/Mobile.de; im Code TODO „Deploy Supabase Edge Function and remove VITE_TAVILY_KEY" — heute läuft der Key aber schon server-side |
| Account-Seite | FERTIG | [`src/js/account.js`](src/js/account.js) | 2087 | Sehr großes Modul, deckt Profil/Settings/Passwort/Delete ab |
| Auth-Modal + Registrierung | FERTIG | [`src/js/auth.js`](src/js/auth.js) | 638 | Login per Username **oder** E-Mail via `email_for_username`-RPC |
| Passwort-Reset | HALBFERTIG | `auth.js` L480–505 | — | `changePassword` funktioniert für eingeloggte User; **öffentlicher „Passwort vergessen"-Flow fehlt** (CLAUDE.md erwähnt Platzhalter) |
| OAuth (Google/Apple) | HALBFERTIG | `auth.js` L147–210 | — | Skeleton vorhanden, unklar ob im Supabase-Dashboard konfiguriert |
| QR-Login | PLATZHALTER | erwähnt in CLAUDE.md | — | UI-Only |
| Shop | PLATZHALTER | erwähnt in CLAUDE.md | — | UI-Only |
| Quests | PLATZHALTER | erwähnt in CLAUDE.md | — | UI-Only |
| Onboarding (Tab-Hint) | FERTIG | [`src/js/onboarding.js`](src/js/onboarding.js) | 85 | Winzig, tut was es soll |
| Drop-Animation | FERTIG | [`src/js/drop-animation.js`](src/js/drop-animation.js) | 196 | Landing-Effekt |
| Impressum / Datenschutz | FERTIG | [`public/impressum.html`](public/impressum.html) + [`public/datenschutz.html`](public/datenschutz.html) | — | Beide vorhanden — **Inhalt aber ungeprüft, für Beta muss dein Name/Adresse drinstehen** |

**Nicht gefundene Features, die manchmal erwartet werden:** Cookie-/Consent-Banner,
E-Mail-Verifikation-Trigger, Feedback-Kanal für Beta-Tester, Analytics.

---

## 5. Auth, Payments, E-Mail, externe APIs

| Baustein | Konfiguriert? | Details |
|---|---|---|
| Supabase Auth | ✅ | `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` gesetzt; RLS aktiv |
| E-Mail-Provider für Supabase | ❓ | Supabase nutzt Default-SMTP → **Rate-Limit 3–4 Mails/h, Absender `noreply@mail.app.supabase.co`**. Für 10–30 Tester noch ok, für „öffentliche Beta" nicht |
| Passwort-Reset-Flow | ❌ | „Passwort vergessen"-Link fehlt im UI |
| OAuth Google/Apple | ❓ | Frontend-Skeleton vorhanden; ob Supabase-Dashboard konfiguriert ist, ist unbekannt |
| Payments | ❌ | Kein Bezahlsystem — für Beta auch nicht nötig |
| OpenAI | ✅ server-side | `OPENAI_KEY` in `.env`, kein `VITE_`-Prefix → korrekt |
| Tavily (Gebrauchtsuche) | ✅ server-side | `TAVILY_KEY` in `.env`, kein `VITE_`-Prefix → korrekt |
| Google Maps | ⚠️ client-side | `VITE_GMAPS_KEY` — **öffentlich, daher zwingend im Google-Cloud-Console-Dashboard per HTTP-Referrer auf deine Vercel-Domain einschränken** |
| Google OAuth Client ID | ✅ | `VITE_GOOGLE_CLIENT_ID` — Client-ID darf öffentlich sein |
| TURN-Server (Metered) | ⚠️ | `VITE_TURN_*` in `.env.local` — Voice ist ohnehin nur Skeleton |
| Fehler-Monitoring | ❌ | Kein Sentry/Rollbar |
| Analytics | ❌ | Nichts eingebaut |

---

## 6. Deployment

- Vercel-Projekt `moto-matchwbapp`, Framework `vite`, verlinkt in `.vercel/`.
- Build: `npm run build` → `dist/` (122 MB inkl. gebundelter Assets).
- **Kritischer Deploy-Blocker:** `.gitignore` schließt `*.glb` aus, dazu sind `public/__video/` und `public/models/` groß und nicht im Repo. Ein Deploy über die Git-Integration von Vercel würde ohne 3D-Modelle und ohne Hero-Video landen. Deploy funktioniert daher **nur** per lokaler `vercel` CLI vom Rechner mit den vollen Assets.
- `vite.config.js` enthält Windows-Legacy: Kopiert Assets aus `D:/MotoMatch/…`.
  Auf macOS inert, aber unhygienisch und verwirrend.
- **Nur 2 Commits im Git-Log**, aktuell **16 uncommittete Dateien** — kein
  Rollback möglich, kein Blame, kein Feature-Branch. Größtes strukturelles Risiko.

---

## 7. Qualität, Duplikate, Sicherheit

### Duplikate / toter Code
- `src/js/map-view.js` (134 LOC) — **wird nirgendwo importiert.** Löschen.
- 319 macOS-`._*`-Metadaten-Dateien liegen physisch im Repo-Verzeichnis
  (durch externes exFAT-Volume). Sie sind in `.gitignore`, verschmutzen aber
  jedes `ls`/`find`. `dot_clean .` in der Repo-Wurzel entfernt sie.
- `CLAUDE.md.backup` — Reste eines Rewrite-Versuchs.
- Bike-Stammdaten doppelt (matching.js + bike-detail.js) — Sync-Bug wartet.
- Legacy-localStorage-Keys (siehe §3) — mindestens 5 verwaiste Keys.

### TODO/FIXME im Code
- 13 TODO-Kommentare in [`landing.js`](src/js/landing.js) L365–393 (Footer-Links auf nicht existente Seiten)
- 1 TODO in [`marketplace.js`](src/js/marketplace.js) L9 (Edge Function — Key ist aber schon serverseitig, TODO ist veraltet)
- 2 TODOs in [`community-api.js`](src/js/community-api.js) L507, L546 (Event-Felder nicht im Supabase-Schema)

### Sicherheit
- ✅ `.env`, `.env.local`, `.env.*` sind in `.gitignore` — Secrets sind nicht im Repo.
- ✅ RLS aktiv auf allen Supabase-Tabellen.
- ✅ `esc()`-Helper vorhanden und laut CLAUDE.md als Pflicht verankert.
- ✅ Server-Keys (OpenAI, Tavily) korrekt ohne `VITE_`-Prefix.
- ⚠️ `VITE_GMAPS_KEY` ist **öffentlich sichtbar** (was für Client-Maps-Keys unvermeidbar ist). Muss zwingend per HTTP-Referrer-Restriction in der Google-Cloud-Console eingeschränkt werden, sonst kann jeder Kosten auf dein Konto laufen lassen.
- ⚠️ localStorage-Passwörter (nur im Offline-Modus): Klartext. Laut CLAUDE.md „Prototyp", da Beta auf Supabase läuft, ist es faktisch irrelevant — der Code sollte aber im Produktivbetrieb sicherstellen, dass `OFFLINE_MODE` niemals true ist, wenn die App live geht (harte Assertion beim Start).
- ⚠️ Serverless-Funktionen in `api/` haben **keine Rate-Limits** und keine Auth-Prüfung. Jeder mit der URL kann sie aufrufen und deine OpenAI-/Tavily-Kosten treiben. Für 10–30 Tester akzeptabel, aber ein Origin-Header-Check und ein simples per-IP-Limit sind eine Stunde Arbeit.

### Testabdeckung
- **0 %.** Es existieren keine Test-Files. Kein Jest/Vitest/Playwright.

---

## 8. Top 10 Probleme, sortiert nach Risiko für den Beta-Launch

1. **Git-Hygiene katastrophal.** Nur 2 Commits, 16 uncommittete Dateien, kein Rollback. → Vor allen weiteren Arbeiten: alles committen, ab jetzt kleine feature-branches.
2. **Kein Fehler-Monitoring.** Bei 10–30 Testern in der freien Wildbahn werden Bugs kommen und du wirst nichts davon mitbekommen. Sentry Free reicht.
3. **`VITE_GMAPS_KEY` ungeschützt.** Sobald die Seite public ist, kann jeder deinen Google-Maps-Key abrufen und Kosten verursachen. Zwingend Referrer-Restriction im Google-Cloud-Dashboard setzen.
4. **Serverless-APIs ohne Rate-Limit / Origin-Check.** Gleiche Kostenfalle wie oben, für OpenAI und Tavily.
5. **Passwort-vergessen-Flow fehlt.** Beim ersten Bekannten, der sein Passwort vergisst, ist der Support-Aufwand deiner. Supabase kann das nativ.
6. **Landing-Footer voll mit toten Links.** 13 Platzhalter-Links auf „Karriere", „Investor Relations", „MotoMatch AG" — wirkt für Tester peinlich und suggeriert Größe, die es nicht gibt. Radikal ausdünnen.
7. **E-Mail-Versand-Limit von Supabase Default-SMTP.** 3–4 Mails/h und Absender `noreply@mail.app.supabase.co` funktioniert für 10–30 Freunde, wird aber bei größerer Nutzung sofort zum Nadelöhr. Für Beta ok, danach eigene Domain + Resend Free-Tier.
8. **Deployment nur per lokaler CLI möglich.** Da `.glb`-Modelle gitignored sind, würde ein Git-basierter Vercel-Deploy die 3D-Ansicht kaputt machen. Lösung: 3D-Modelle in Supabase Storage hosten (der letzte Commit heißt schon so — Migration angefangen, evtl. nicht abgeschlossen).
9. **Bike-Stammdaten doppelt hardcodiert.** Bei jeder Änderung mussten zwei Files gepflegt werden — wird eher früher als später auseinanderlaufen. Für Beta akzeptabel, aber ins Bewusstsein.
10. **Kein Feedback-Kanal.** Wenn ein Tester einen Bug sieht, hat er keinen Weg, ihn zu melden. Simples „Feedback"-Modal mit Supabase-Insert oder ein Discord-/E-Mail-Link reicht.

---

## 9. Was du definitiv wegwerfen solltest

- `src/js/map-view.js` — tot, ungenutzt.
- `CLAUDE.md.backup` — alte Sicherung, nicht mehr nötig (CLAUDE.md ist aktuell).
- Legacy-localStorage-Keys `mm_gear_favs`/`mm_kv_favs`, `mm_comm_friends_v1`, `mm_comm_prefs`, `mm_recent_kv` — nach Belegcheck welcher die aktive Variante ist.
- Landing-Footer-Links auf nicht existente Seiten (Karriere, Investor Relations, MotoMatch AG etc.).
- Windows-Asset-Kopie in `vite.config.js` (Zeilen 6–70) — auf macOS toter Code, macht die Config unnötig komplex.
- `voice.js` **nicht** wegwerfen, aber für die Beta aus der UI verbergen (Feature-Flag „coming soon"), sonst weckt es falsche Erwartungen.
- QR-Login, Shop, Quests — falls im UI verlinkt: aus der Beta-Navigation nehmen.
- 319 `._*`-Files: `dot_clean .` in der Repo-Wurzel.

---

## 10. Offene Fragen

1. **Welche der Duo-Keys im localStorage ist aktiv?** `mm_gear_favs` vs. `mm_kv_favs`, `mm_comm_friends_v1` vs. `_v2`, `mm_comm_prefs` vs. `_v1`. → Grep in `gear.js` / `garage.js` / `community-api.js` sagt es eindeutig.
2. **Ist die GLB-Migration nach Supabase Storage (letzter Commit) fertig?** Falls ja: aus welchem Bucket werden sie im Frontend geladen? Falls nicht: welche `.glb` liegen noch lokal in `public/models/`?
3. **Sind OAuth-Provider (Google, Apple) im Supabase-Dashboard aktiviert?** Der Frontend-Code ist da, aber Dashboard-Config kann ich nicht sehen.
4. **Läuft die Vercel-Domain schon?** `moto-matchwbapp.vercel.app` oder eigene Domain?
5. **Impressum/Datenschutz-Inhalt.** Sind da schon deine echten Angaben drin, oder Dummy-Text?
6. **Community-Talks (Voice).** Steht das für die Beta drin (dann klar als „coming soon" markieren) oder rausnehmen?
7. **`bike-detail.js` Konfigurator.** Was tut er inhaltlich — welche Optionen, wird was gespeichert? (3.265 Zeilen habe ich nicht durchgelesen.)
