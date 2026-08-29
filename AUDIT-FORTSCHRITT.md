# AUDIT-FORTSCHRITT

Laufendes Protokoll. Format: `Datei:Zeile — Problem — Schweregrad`

## Phase 0 — Orientierung ✔

- Repo `/Volumes/Untitled/MotoMatch/moto-match`, Remote `git@github.com:HonarALrasheed/MotoMatchwbapp.git`, Branch `fix/vercel-lfs`
- Vanilla JS + Vite 5.4.21, ESM, kein TS, kein Test-Runner, kein Linter (package.json)
- Supabase (Postgres+Auth+Realtime+Storage), 5 Vercel-Functions in `api/`, Node 20 (.nvmrc)
- LiveKit (Voice/Screenshare), web-push, Sentry, Leaflet(unbenutzt), three.js, lottie-web
- ~38.325 LOC. God-Files: main.css 13.798, community.js 5.164, bike-detail.js 4.699

## Phase 4 — Verifikation (Ist-Ausgaben) ✔

- `npm run build` → **exit 0**, 10,38 s, 290 Module. Warnungen: matching.js dyn+statisch importiert; 2 Chunks > 500 kB (community 670 kB / 170 kB gz, meshopt_decoder 648 kB)
- `npm audit` → **23 Schwachstellen (20 moderate, 3 high)** — nanoid, postcss, esbuild/vite. Alle devDependencies (Build-Zeit), nicht im Auslieferungs-Bundle
- `npm outdated` → vite 5.4.21 vs 8.2.2, @sentry/* 8.55.2 vs 10.71.0, three 0.183 vs 0.185
- Secrets im Bundle: **keine gefunden** (grep sk-/tvly-/service_role/LIVEKIT_API_SECRET über dist/) ✔
- `dist/` = 111 MB, `public/` = 98 MB
- Keine Testdatei im Repo. Kein CI. Kein Linter.

---

## BEFUNDE

### P0 — Launch-Blocker

| # | Fundstelle | Problem |
|---|---|---|
| P0-1 | `supabase/schema.sql:410-423` | `email_for_username()` SECURITY DEFINER, `WHERE p.username ILIKE uname`, GRANT an **anon**. `%` als Wildcard → beliebige/alle E-Mail-Adressen anonym abgreifbar |
| P0-2 | `supabase/schema.sql:281-282` | `msg_insert_dm WITH CHECK (author_id = auth.uid() AND dm_thread IS NOT NULL)` — keine Teilnehmerprüfung. Jeder kann in JEDEN fremden DM-Thread schreiben |
| P0-3 | `src/js/community.js:900,1030,1476,1740,2431,2555,2573,2614,2715,3474,3720,3790,4014,4029,4051,4070,4563,4755,4812,4954` | `style="background:${avatarColor(x)}"` — `profiles.avatar_color` (nutzergesteuert, kein CHECK) unescaped ins style-Attribut → **stored XSS** an 20 Stellen |
| P0-4 | `supabase/schema.sql:144-149` | `gm_insert WITH CHECK (user_id = auth.uid())` — `join_mode` und `group_bans` werden auf DB-Ebene nicht geprüft. Jeder tritt jeder Gruppe bei, Bans wirkungslos |
| P0-5 | `supabase/schema.sql:335,341` | `invites_select USING (true)` + `invites_update USING (true)` — jeder liest/ändert alle Einladungscodes aller Gruppen. `community-api.js:349` lädt sie sogar aktiv (`select('*')`) |
| P0-6 | `public/impressum.html:180-226` | Impressum besteht komplett aus Platzhaltern `[Name des Betreibers]`, `[kontakt@example.com]` → §5 DDG verletzt |
| P0-7 | `public/datenschutz.html` (ganze Datei) | Datenschutzerklärung ist Template mit sichtbaren Entwickler-Notizen `[Prüfen: …]`, `[Weiterer Dienst]`, `[Datum eintragen]`. Nennt nicht genutzte Dienste (Open-Meteo), verschweigt genutzte (Sentry, LiveKit, KLIPY, gstatic/DRACO, louis.de/amazon-CDN) |
| P0-8 | `src/js/auth.js:535-544` | `deleteAccount()` ist online **nicht implementiert** — kein Backend-Endpunkt. Art. 17 DSGVO technisch nicht erfüllbar |
| P0-9 | `src/js/dealers.js:1-303`, `src/js/marketplace.js:13-274` | 40 erfundene Händler/Werkstätten/Fahrschulen mit echt klingenden Namen + 30 erfundene Marktplatz-Inserate mit Preisen und „vor 2 Tagen" — werden als echt dargestellt |

### P1 — Kritisch

| # | Fundstelle | Problem |
|---|---|---|
| P1-1 | `api/_shared.js:4,26-57` | Rate-Limit als In-Memory-`Map` pro Lambda-Instanz. Auf Vercel pro Instanz/Cold-Start zurückgesetzt → praktisch wirkungslos. Origin-Header (Z. 29) ist trivial fälschbar → OpenAI/Tavily-Keys als offener Proxy |
| P1-2 | `api/ai-match.js:27-40` | `const { answers, bike } = req.body` — keine Validierung/Längenbegrenzung, direkt in den Prompt interpoliert. Unbegrenzte Token-Kosten + Prompt-Injection |
| P1-3 | `src/js/community.js:217,226` | `getSession()?.id` — Feld heißt `uid` (auth.js:90). Mute-Sync zum Server läuft **nie**. `notification_mutes` bleibt leer, Push ignoriert Mutes komplett |
| P1-4 | `src/js/community-api.js:1293,1561` | `toggleReaction*` schreibt per `messages.update`; RLS `msg_update` erlaubt nur Autor/Mod → Reaktion auf fremde Nachrichten scheitert still, Fehler wird verworfen |
| P1-5 | `src/js/community-api.js:961,996,1042,1052,1063,1071,1084,1133,1268,1275,1316,1356,1362,1397,1415,1416,1531,1540,1594,1604,1708,1729,1749` | Durchgängiges Muster: optimistisches lokales Update + `await supabase…` **ohne Fehlerprüfung**. UI zeigt Erfolg, DB hat nichts |
| P1-6 | `src/js/community-api.js:144,179-217,293-297,349` | `_loadProfiles/_loadGroups/_loadDMs/_loadInvites` laden beim Start **alles ohne Limit** — alle Profile (inkl. base64-Avatare), alle Gruppen, alle Nachrichten aller Kanäle, alle DMs, alle Invites |
| P1-7 | `supabase/schema.sql:15,221` | `profiles.avatar` = base64-Data-URL in `text`, `messages.text` ohne Längen-CHECK. Keine Größenbegrenzung auf DB-Ebene |
| P1-8 | `src/js/auth.js:340,486,527` | Passwort-Minimum **4 Zeichen** clientseitig; Supabase-Default ist 6 → Registrierung scheitert mit roher englischer Supabase-Meldung (auth.js:355) |
| P1-9 | `src/js/auth.js:364-370` | Profil-INSERT vor der `if (data.session)`-Prüfung. Bei aktivierter E-Mail-Bestätigung in Supabase ist `auth.uid()` null → RLS blockt → Registrierung komplett kaputt. NICHT VERIFIZIERBAR ohne Supabase-Dashboard |
| P1-10 | `src/js/auth.js:442-447` | Profilfelder (Avatar, Bio, Alter, Führerschein) landen für Online-Nutzer in **localStorage** statt in `profiles` — obwohl die Spalten existieren. Kein Gerätewechsel, für andere unsichtbar |
| P1-11 | `src/js/auth.js:132-144,186-207` | Apple-Login legt bei ONLINE-Betrieb ein reines localStorage-Konto an, nie ein Supabase-Konto → halb migriertes, kaputtes Feature |
| P1-12 | `src/js/gear.js` (34× fc-moto, 23× cdn2.louis.de, 7× m.media-amazon.com), `bike-detail.js:4501`, `garage.js:417`, `quiz.js:170` (gstatic) | Bilder und DRACO-Decoder werden von Drittanbieter-CDNs geladen → IP-Übertragung ohne Einwilligung, nicht in der Datenschutzerklärung |
| P1-13 | `supabase/schema.sql:429-439` | `beta_feedback` — anon darf mit `user_id IS NULL` unbegrenzt inserten. Kein Rate-Limit, kein CAPTCHA → Spam-/Füll-Vektor |
| P1-14 | `src/js/community-api.js:1468-1473,1489-1497` | Blockieren und `dm_policy` werden **nur clientseitig** durchgesetzt; DB kennt keine entsprechende Policy |
| P1-15 | `.env` / `.env.production.local` | In Produktion (per `vercel env pull` gezogen) fehlen `ALLOWED_ORIGINS`, `LIVEKIT_*`, `VAPID_*`, `SUPABASE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_DSN`. Ohne `ALLOWED_ORIGINS` → `_shared.js:29` → **alle `/api/*` antworten 403** |
| P1-16 | `public/bikes/*.png` | Einzelbilder bis **7,97 MB** (`harley_seventytwo_2015.png`), `hdri/studio.hdr` 13,6 MB. `public/` 98 MB |
| P1-17 | `git status` | 19 modifizierte + 10 untrackte Dateien uncommitted, darunter `supabase/schema.sql`, `manifest.webmanifest`, `icon-*.png`, `src/js/{install,nav,swipe,viewport,stickers,match-history}.js` → Deploy vom Repo würde die App zerreißen |

### P2 / P3 (Auswahl, s. Report)

- `src/js/community.js:1190` — `<a href="${esc(att.url)}">`: `esc` filtert `javascript:` nicht → XSS bei Klick auf Datei-Anhang (P1/P2)
- `src/js/matching.js:22-283,436` — Katalog fest bei 10 Bikes, `setCatalog()` hat **keinen Aufrufer**; Header behauptet „Architected for 40,000+ motorcycles" → Kommentar lügt
- `src/js/gear.js:64,150` — `priceMin/priceMax` widersprechen `price` (120–200 vs. 559,99 €); keine Affiliate-Tags trotz Commit „gear affiliate links"
- `src/js/auth.js:346,462,1626`(api) — `.ilike(username)` behandelt `_`/`%` als Wildcard → falsche „Name vergeben"-Meldungen
- `src/js/stickers.js:106` — KLIPY-Key im URL-Pfad, Request aus dem Browser; sendet getippten Nachrichtentext an Dritte
- Toter Code: `src/counter.js`, `src/style.css` (296 Z.), `src/assets/{vite,javascript}.svg`, `src/js/dealers.js` (326 Z., kein Import), `copy-bikes.mjs`, `copy-assembly.js`, `vite.config.js:7-67` (Windows-Pfad `D:/MotoMatch`)
- `.env` enthält tote `VITE_TURN_*` (Relikt des WebRTC-Mesh)
- `public/bikes/`: `haendler_beratung.png` und `Händler & beratung .png` sind dieselbe Datei (7,72 MB doppelt), ebenso `community_gear.png` / `Community & Gear .png`
- 71 leere `catch`-Blöcke, 163 `innerHTML`-Stellen, 33 `console.*`
- `supabase/schema.sql` nicht idempotent (`CREATE POLICY` ohne `IF NOT EXISTS`) → zweiter Lauf schlägt fehl; keine Migrations-Historie
- Fehlende Indizes: `friendships(user_a/user_b)`, `group_members(user_id)`, `friend_requests(to_user)`, `push_subscriptions(user_id)`, `channels(group_id)`, `voice_rooms(group_id)`, `blocks`, `ignores`
- `supabase/schema.sql:143` — `gm_select USING (true)`: komplette Mitgliederlisten aller Gruppen öffentlich
- `src/js/feedback.js:159` — `setInterval(nudge, 45000)` wird nie aufgeräumt
