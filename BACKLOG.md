# MotoMatch — Backlog

Priorisierte Arbeitsliste aus dem Audit vom 27./28.08.2026. Details und Code-Zitate zu jedem Punkt in `AUDIT-REPORT.md`, Abschnitt 5 (Referenz in der Spalte „Befund").

**Aufwandsmaß für eine Person:** S = unter 1 Std. · M = 2–6 Std. · L = 1–3 Tage

---

## Getroffene Entscheidungen

Diese Punkte waren im ersten Entwurf noch offene Fragen. Sie sind entschieden — Begründungen in `AUDIT-REPORT.md`, Abschnitt 9.

| Thema | Entscheidung |
|---|---|
| `dealers.js` (40 Betriebe) | **Löschen.** Recherche: „Zweirad Hölscher" ist ein Fahrradladen in Ascheberg, „Harley-Davidson Münster" existiert nicht. Google Places liefert das kostenlos und aktuell |
| Erfundene Marktplatz-Inserate | **Löschen.** Ersatz: ehrlicher Leerzustand plus die vorhandenen Links zu Kleinanzeigen/mobile.de/eBay |
| Google Maps | **Bleibt.** `VITE_GMAPS_KEY` in Vercel setzen + Referrer-Beschränkung. Ohne Key zieht die tote Karte die erfundenen Händler nach sich |
| 3D-Ansicht | **Bleibt** — das ist der Unterschied zum Vergleichsportal. Aber: 13,6-MB-HDRI ersetzen, Fahrermodell nur im Quiz, DRACO aus npm statt gstatic |
| Apple-Login | **Entfernen.** In Supabase ist der Provider aus, der Client-Pfad legt ein localStorage-Konto an, das nie in Supabase existiert |
| Amazon-Affiliate | **Jetzt nicht.** Erträge bei Beta-Reichweite ≈ 0, Kennzeichnungspflichten sofort. Nach der Beta als eigenes Thema |
| `price` in `gear.js` | **Feld entfernen**, nur `priceMin`–`priceMax` als „ca."-Bereich zeigen. 32 von 64 Preisen widersprechen ihrem eigenen Bereich |
| Bike-Katalog in die DB | **Noch nicht.** 10 Modelle im Code sind in Ordnung. Ab ~30 umziehen. Der Kommentar, der 40.000 behauptet, muss trotzdem weg |
| E-Mail-Bestätigung | **Einschalten — aber erst nach #27.** Der Schalter allein macht die Registrierung sofort kaputt |
| Fremdgehostete Produktbilder | **Selbst hosten.** Eine zweite Einwilligungsschranke für Produktfotos wäre unverhältnismäßig |

---

## Nächste 5 Schritte

Zusammen **etwa 1,5 Arbeitstage**. Danach ist der gefährlichste Teil weg.

### 1. Datenbank sichern — 15 Min.
```bash
npx supabase db dump --db-url "$SUPABASE_DB_URL" -f backup-$(date +%F).sql
```
Vor jeder Schema-Änderung. Im Free-Plan gibt es keine automatischen Sicherungen, und die Schritte 4–5 fassen Policies an. Datei außerhalb des Repos ablegen.

### 2. Ausgabenlimits setzen — 15 Min.
Harte Monatslimits bei **OpenAI**, **Tavily**, **LiveKit** und **Google Cloud**. Die einzige Maßnahme, die auch dann noch greift, wenn alles andere in diesem Backlog schiefgeht — und Befund 4.3 (Origin-Check hält nicht, live reproduziert) macht sie dringend, sobald die Adresse öffentlich ist.

### 3. Repository deploybar machen — 1–2 Std.
Die 10 unversionierten Dateien und 19 Änderungen committen, in Häppchen (PWA-Assets · Navigation · Sticker · Schema). Dann zur Probe:
```bash
git clone <repo> /tmp/mm-test && cd /tmp/mm-test && npm ci && npm run build
```
Solange das nicht durchläuft, kannst du keinen einzigen der folgenden Fixes ausliefern.

### 4. Die vier RLS-Löcher schließen — 3–4 Std.
Eine SQL-Sitzung: `email_for_username` (E-Mail-Preisgabe an anonyme Aufrufer), `msg_insert_dm` (Fremde schreiben in private Chats), `gm_insert` (Beitrittsregeln und Sperren wirkungslos), `invites` (alle Codes für alle lesbar und änderbar). Danach mit zwei Testkonten gegenprüfen, dass die Angriffe nicht mehr durchgehen.

### 5. XSS in der Community schließen — 2–3 Std.
`avatarColor()` in `community.js:104` filtern statt an 20 Stellen `esc()` nachzurüsten, plus `CHECK`-Constraint auf `profiles.avatar_color`. Dazu die Schema-Prüfung in `attachmentHtml`. Weil die Supabase-Session in `localStorage` liegt, ist das Kontoübernahme — und ein Chat mit Fremden ist genau der Ort, an dem so etwas ausprobiert wird.

> **Gleich mitnehmen — drei S-Aufgaben, zusammen unter einer Stunde:**
> **#4** `VITE_GMAPS_KEY` setzen (die Karte ist produktiv tot und zeigt stattdessen die erfundenen Händler), **#13** die erfundenen Händler und Inserate löschen, **#19** `session?.id` → `session?.uid` (zwei Zeichen, danach unterdrückt Stummschalten endlich Push-Nachrichten).

---

## P0 — Launch-Blocker

| # | Titel | Schweregrad | Bereich | Datei(en) | Aufwand | Abhängig von | Warum jetzt |
|---|---|---|---|---|---|---|---|
| 1 | DB-Backup ziehen und außerhalb ablegen | P0 | 10 Deploy | — | S | — | Alle folgenden Schema-Punkte ändern Policies. Ohne Sicherung ist jeder Fehler endgültig. |
| 2 | Ausgabenlimits bei OpenAI, Tavily, LiveKit, Google Cloud setzen | P0 | 17 Kosten | — | S | — | Greift auch dann, wenn #9 später kommt. 15 Minuten gegen eine unbegrenzte Rechnung. |
| 3 | 10 unversionierte Dateien + 19 Änderungen committen, Build aus frischem Clone prüfen | P0 | 10 Deploy | `src/js/{nav,swipe,viewport,install,stickers,match-history}.js`, `public/{manifest.webmanifest,icon-192,icon-512,apple-touch-icon}.png`, `supabase/schema.sql` | S | 1 | `app.js:5-8` importiert vier Module, die nicht in Git sind → aus dem Repo baut nichts. Ohne das kannst du keinen Fix ausliefern. Befund 10.1 |
| 4 | `VITE_GMAPS_KEY` in Vercel setzen + in der Google Cloud Console per HTTP-Referrer beschränken | P0 | 9 Konfiguration | Vercel-Env, `src/js/garage.js:45,936` | S | — | **Aktueller Produktionszustand:** Key fehlt → `key=undefined` → Karte scheitert → `garage.js:1406` zeigt die 40 erfundenen Händler. Befund 9.1 |
| 5 | Erfundene Händler und Gebrauchtmarkt-Inserate löschen, ehrliche Leerzustände einsetzen | P0 | 16 Recht | `src/js/dealers.js` (löschen), `src/js/marketplace.js:13-274`, `src/js/garage.js:798-813,1417-1440` | S | — | Beides sind aktive Rückfallebenen. Nachrecherchiert: reale Betriebe mit falschen Angaben, dazu ein Markenname für einen nicht existierenden Händler. Befund 16.4 |
| 6 | `email_for_username()`: `ILIKE` → `lower() = lower()` | P0 | 3 Auth | `supabase/schema.sql:410-423` | S | 1 | `%` als Parameter liefert fremde E-Mail-Adressen, an `anon` freigegeben. Preisgabe personenbezogener Daten, meldepflichtig. Befund 3.1 |
| 7 | `msg_insert_dm`: Teilnahme + Blockierung in `WITH CHECK` erzwingen; dasselbe für `msg_update` | P0 | 3 Auth | `supabase/schema.sql:281-282`, `:283-288` | S | 1 | Jeder Angemeldete kann in jeden fremden DM-Thread schreiben. Blockieren existiert nur als eine Client-Zeile. Befund 3.2 |
| 8 | `gm_insert`: `join_mode` und `group_bans` prüfen; Beitritt für `request`/`invite` in eine `SECURITY DEFINER`-Funktion | P0 | 3 Auth | `supabase/schema.sql:144-149` | M | 1 | Private Gruppen sind nicht privat, Sperren wirkungslos — der Client ist die einzige Prüfung. Befund 3.3 |
| 9 | `invites_select`/`invites_update` einschränken, `redeem_invite()`-RPC bauen, `_loadInvites()` anpassen | P0 | 3 Auth | `supabase/schema.sql:335,341`, `src/js/community-api.js:348-359,1400-1418` | M | 8 | Jeder Nutzer lädt beim Start alle Einladungscodes aller Gruppen und kann sie ändern. Braucht die Beitritts-RPC aus #8. Befund 3.4 |
| 10 | `avatarColor()` auf Farbwerte filtern + `CHECK`-Constraint auf `profiles.avatar_color` | P0 | 4 Sicherheit | `src/js/community.js:104-107`, `supabase/schema.sql:14` | M | 1 | Stored XSS an 20 Render-Stellen. Session liegt in `localStorage` → Kontoübernahme. Befund 4.1 |
| 11 | `attachmentHtml`: URL-Schema prüfen, bevor sie in `href` geht | P0 | 4 Sicherheit | `src/js/community.js:1174-1198` | S | — | `esc()` maskiert Anführungszeichen, aber nicht `javascript:` — die Anhang-URL kommt frei vom Absender. Befund 4.2 |
| 12 | `ai-match` + `search-places` hinter Supabase-Session hängen (Muster: `api/livekit-token.js:41-56`) | P0 | 4 Sicherheit | `api/ai-match.js:15`, `api/search-places.js:15`, `api/_shared.js` | M | 3 | Origin-Header ist fälschbar, Rate-Limit ist eine Map im Lambda-Speicher. **Live reproduziert:** ein zusätzlicher Header, und der OpenAI-Aufruf geht durch. Befund 4.3 |
| 13 | `api/delete-account.js` bauen (Service-Role + `auth.admin.deleteUser`), `auth.js:deleteAccount()` anschließen | P0 | 3 Auth / 16 Recht | `src/js/auth.js:535-544`, `src/js/account.js:1930-1936`, neu: `api/delete-account.js` | M | 3 | Art. 17 DSGVO nicht erfüllbar, und der Knopf behauptet das Gegenteil: Nutzer wird abgemeldet, Konto bleibt. `SUPABASE_SERVICE_ROLE_KEY` ist in Vercel bereits gesetzt. Befund 3.5 |
| 14 | Impressum ausfüllen (§ 5 DDG statt TMG, § 18 Abs. 2 MStV statt RStV) | P0 | 16 Recht | `public/impressum.html:177-227` | S | — | Alle sechs Abschnitte sind Platzhalter. Direkt abmahnbar ab der ersten öffentlichen Minute. Befund 16.1 |
| 15 | Datenschutzerklärung ausfüllen; Dienstliste aus dem Code übernehmen (Tabelle in `AUDIT-REPORT.md` Abschnitt 4) | P0 | 16 Recht | `public/datenschutz.html` | M | 21, 22 | Enthält für Besucher sichtbare Arbeitsanweisungen (`[Prüfen: …]`), nennt Open-Meteo (unbenutzt) und verschweigt Sentry, LiveKit, KLIPY, gstatic, louis.de, Amazon, Apple, Push. Erst schreiben, wenn #21 und #22 die Dienstliste festgezurrt haben. Befund 16.2 |
| 16 | Auskunftsfunktion (Art. 15): `SECURITY DEFINER`-Funktion, die alle Zeilen zu einer `user_id` als JSON liefert | P0 | 16 Recht | neu in `supabase/schema.sql`, `src/js/account.js:1968-1982` | M | 13 | Der vorhandene Export erfasst nur `localStorage` — nicht Nachrichten, Gruppen, Freundschaften, Meldungen. Befund 16.5 |

**Summe P0: ca. 3–4 Arbeitstage.**

---

## P1 — Kritisch

| # | Titel | Schweregrad | Bereich | Datei(en) | Aufwand | Abhängig von | Warum jetzt |
|---|---|---|---|---|---|---|---|
| 17 | Sentry aktivieren: `VITE_SENTRY_DSN` + `SENTRY_DSN` in Vercel setzen, `unhandledrejection`-Handler in `main.js`, Alert-Regel | P1 | 12 Observability | `src/main.js`, Vercel-Env | S | 3 | Geprüft: beide DSN fehlen in Produktion. Der Code ist fertig und ordentlich (inkl. PII-Filterung) — es fehlen zwei Variablen. Befund 12.1 |
| 18 | `_syncMuteToServer`: `session?.id` → `session?.uid` (2 Zeilen) | P1 | 7 Robustheit | `src/js/community.js:217,226` | S | — | Tippfehler gegen `auth.js:90`. Ergebnis: `notification_mutes` bleibt leer, Stummschalten unterdrückt keine Push-Nachricht. Befund 7.3 |
| 19 | `select('*')` in `_loadProfiles` durch Feldliste **ohne** `avatar` ersetzen | P1 | 8 Performance | `src/js/community-api.js:144` | S | — | Jeder Nutzer lädt bei jedem Start alle base64-Avatare aller Nutzer. Einzeiler mit dem größten Traffic-Effekt. Befund 8.2 |
| 20 | Profilanlage in `AFTER INSERT`-Trigger auf `auth.users` verlegen | P1 | 3 Auth | `src/js/auth.js:351-375`, neu in `supabase/schema.sql` | M | 1 | Muss **vor** #21 kommen: der Bestätigungsschalter macht die Registrierung sonst sofort kaputt (kein `auth.uid()` beim Profil-INSERT). Befund 3.6b |
| 21 | „Confirm email" in Supabase einschalten | P1 | 3 Auth / 16 Recht | Supabase-Dashboard | S | 20 | Geprüft: `mailer_autoconfirm: true` — jeder kann ein Konto auf eine fremde Adresse anlegen, der echte Inhaber bekommt Reset-Links für ein Konto, das er nie erstellt hat. Befund 3.6 |
| 22 | Produktbilder herunterladen, zu WebP konvertieren, selbst ausliefern; DRACO als npm-Paket statt von gstatic | P1 | 16 Recht / 8 Performance | `src/js/gear.js`, `bike-detail.js:4501`, `garage.js:417`, `quiz.js:170` | M | — | 64 fremdgehostete Bilder übertragen die IP jedes Besuchers an Louis, fc-moto und Amazon — ohne Einwilligung. Louis liefert beim Abruf bereits 403. Löst Einwilligung, Hotlinking und Ladezeit in einem. Befund 16.3 |
| 23 | `price`-Feld aus `gear.js` entfernen, nur „ca. X–Y €"-Bereiche anzeigen | P1 | 16 Recht | `src/js/gear.js` (64 Einträge) | S | — | 32 von 64 Preisen widersprechen ihrem eigenen `priceMin`/`priceMax`-Bereich. Kein Aktualisierungsmechanismus vorhanden. Befund 16.8 |
| 24 | Apple-Login-Pfad entfernen | P1 | 1 Architektur / 16 Recht | `src/js/auth.js:100-207` (`loginWithApple`, `loginOrRegisterFromProvider`, `decodeJwtPayload`, `loadScriptOnce`, `APPLE_CLIENT_ID`) | S | — | In Supabase ist der Provider aus (`"apple": false`); der Client legt ein localStorage-Konto an, das nie in Supabase existiert. Nimmt ~60 Zeilen, einen externen Skript-Host und einen Datenschutz-Eintrag mit. Befund 3 in Abschnitt 3 |
| 25 | Reaktionen in eigene Tabelle `message_reactions` mit eigener Policy | P1 | 7 Robustheit | `supabase/schema.sql:283-288`, `src/js/community-api.js:1278-1294,1543-1563` | M | 1 | Reaktionen auf **fremde** Nachrichten scheitern immer und still — die einzige Nutzeraktion, die garantiert nichts speichert. Löst nebenbei das Überschreiben bei gleichzeitigen Reaktionen. Befund 7.2 |
| 26 | Schreib-Helfer mit Rollback bauen, 28 ungeprüfte `await supabase…` umstellen | P1 | 7 Robustheit | `src/js/community-api.js` (28 Stellen, Liste in Befund 7.1) | L | 25 | Optimistisches Update + verworfener Fehler = die UI meldet Erfolg, die DB hat nichts. Betrifft Kicken, Sperren, Löschen, Moderation. Befund 7.1 |
| 27 | Bilder in `public/` komprimieren (WebP, max. 1600px), 4 Duplikate löschen | P1 | 8 Performance | `public/bikes/`, `public/rider/`, `src/js/matching.js`, `landing.js` | M | 3 | Einzelbilder bis 7,97 MB, `public/` 98 MB. Zwei Bildpaare liegen doppelt (~10 MB). Befund 8.1 |
| 28 | 3D-Assets abspecken: `studio.hdr` (13,6 MB) ersetzen, Fahrermodell nur im Quiz laden | P1 | 8 Performance | `public/hdri/studio.hdr`, `public/bikes/Quiz Bike/`, `src/js/quiz.js`, `garage.js` | M | 27 | Größte Einzeldatei im Projekt, für Karosserie-Spiegelungen reicht ein Bruchteil. Entscheidung: 3D bleibt, die Auslieferung wird billiger |
| 29 | `OFFLINE_MODE` in Produktion laut scheitern lassen; Klartext-Passwörter im Demo-Modus entfernen | P1 | 4 Sicherheit | `src/js/supabase.js:13`, `src/js/auth.js:323,388` | S | — | Eine fehlende Env-Variable macht die App still zur localStorage-Demo mit Klartext-Passwörtern — und genau das passiert derzeit in jedem Preview-Deploy (#33). Befund 4.8 |
| 30 | Passwort-Mindestlänge auf 8 anheben (5 Stellen + Supabase-Einstellung) | P1 | 3 Auth | `src/js/auth.js:340,486,527`, `:647`, `src/js/community.js:635` | S | — | Aktuell 4 Zeichen, während Supabase 6 erzwingt → rohe englische Fehlermeldung im deutschen Formular. Befund 3.7 |
| 31 | Eingabevalidierung + Längenbegrenzung in `ai-match` und `search-places` | P1 | 4 Sicherheit | `api/ai-match.js:27-40`, `api/search-places.js:27` | S | 12 | Kein Feld wird geprüft; unbegrenzte Prompt-Länge = unbegrenzte Token-Kosten, dazu Prompt-Injection. Befund 4.4 |
| 32 | `beta_feedback`: anonymes Insert abschalten, Längen-`CHECK` ergänzen | P1 | 4 Sicherheit | `supabase/schema.sql:438-439` | S | 1 | `anon` darf mit `user_id IS NULL` unbegrenzt inserten — Spam-Vektor gegen die eigene DB. Befund 4.6 |
| 33 | Env-Variablen auch für `Preview` setzen — oder Preview-Deploys abschalten | P1 | 9 Konfiguration | Vercel-Projekt | S | 39 | Geprüft: alle 13 Variablen existieren nur für `Production`. Jede Preview-URL läuft im `OFFLINE_MODE` und speichert Passwörter im Klartext. Befund 9.4 |
| 34 | Längen- und Format-Constraints auf `messages.text`, `profiles.bio`, `profiles.username` | P1 | 2 Datenmodell | `supabase/schema.sql:10,221` | S | 1 | Kein Textfeld hat eine Obergrenze. Ein Nutzer kann die Datenbank vollschreiben. Befund 2.3 |
| 35 | Quiz-Antworten-Schlüssel `motoMatchAnswers` → `mm_quiz_answers_v1` migrieren | P1 | 16 Recht | `src/js/quiz.js:188`, `src/js/account.js:1952-1958` | S | — | Der einzige Schlüssel ohne `mm_`-Präfix — enthält Führerschein, Budget, **Körpergröße** und überlebt „Alle lokalen Daten löschen". Migrationsmuster steht in `match-history.js:41-45`. Befund 16.6 |
| 36 | Gastmodus online: echte Gruppen laden oder das Versprechen ändern | P1 | 14 UX | `src/js/auth.js:397-402`, `src/js/community-api.js:100-103`, `src/js/community.js:706-714` | S | — | „Als Gast ansehen — Lesen ja" führt online in eine komplett leere Community, ohne Hinweis warum. Befund 14.3 |
| 37 | `startQuiz`: dynamischen Import absichern, Startseite bei Fehler wiederherstellen | P1 | 7 Robustheit | `src/js/landing.js:490-502` | S | — | `opacity = 0` steht **vor** dem `await import()` — scheitert er, bleibt ein weißer Bildschirm ohne Ausweg. Befund im Ablauf B |
| 38 | `LIVEKIT_API_SECRET` und `LIVEKIT_API_KEY` als `Sensitive` neu anlegen und in LiveKit rotieren | P1 | 4 Sicherheit | Vercel-Projekt | S | — | Geprüft: als `Non-sensitive` hinterlegt, also im Dashboard lesbar und von `vercel env pull` in lokale Dateien geschrieben. Befund 9.5 |
| 39 | Migrationen mit Supabase-CLI aufsetzen, `CREATE POLICY` → `DROP … IF EXISTS; CREATE …` | P1 | 2 Datenmodell / 10 Deploy | `supabase/schema.sql`, neu `supabase/migrations/` | M | 16 | `schema.sql` ist nicht wiederholbar ausführbar, Migrationen stehen als Kommentare da. Deshalb rät die App an 6 Stellen, wie ihr eigenes Schema aussieht. Nach den P0-Schemaänderungen der richtige Zeitpunkt. Befund 2.1 |
| 40 | Indizes auf die 7 meistgefilterten Fremdschlüssel | P1 | 2 Datenmodell | `supabase/schema.sql` | S | 39 | Es gibt genau zwei Indizes im ganzen Schema. `push_subscriptions(user_id)` wird bei **jeder** Nachricht abgefragt. Befund 2.2 |

**Summe P1: ca. 4–6 Arbeitstage.**

---

## P2 — Wichtig

| # | Titel | Schweregrad | Bereich | Datei(en) | Aufwand | Abhängig von | Warum |
|---|---|---|---|---|---|---|---|
| 41 | `_loadDMs`/`_loadGroups` paginieren (50 Nachrichten je Chat, Rest beim Hochscrollen) | P2 | 8 Performance | `src/js/community-api.js:179-217,293-297` | L | 19 | Startlast wächst mit dem Gesamtbestand statt mit den eigenen Daten. Bei 1.000 Nutzern unbenutzbar. Befund 8.2 |
| 42 | `profiles_select` und `gm_select` einschränken | P2 | 4 Sicherheit | `supabase/schema.sql:25,143` | M | 39 | Mit dem Anon-Key lässt sich ohne Konto der komplette Nutzerbestand samt Avataren und Gruppenzugehörigkeiten abziehen. Befund 4.10 |
| 43 | `message_reports` laden (`_loadMsgReports()`), Moderations-Panel funktionsfähig machen | P2 | 2 Datenmodell | `src/js/community-api.js:64,106` | S | — | Meldungen landen in der DB, der Moderator sieht online immer eine leere Liste. Befund 2.5 |
| 44 | ESLint + Prettier + GitHub-Actions-Workflow (`npm ci && npm run build`) | P2 | 10 Deploy | neu: `.eslintrc`, `.github/workflows/` | M | 3 | `no-unused-vars`/`no-undef` fangen genau die Fehlerklasse, aus der #18 stammt. Dazu: der Stil ist innerhalb des Projekts uneinheitlich. Befund 10.2 |
| 45 | Vitest aufsetzen; RLS-Tests + `matching.js` + `esc()`/`renderText()` | P2 | 11 Tests | neu: `*.test.js` | M | 44 | RLS-Tests hätten #7, #8 und #9 gefunden — das sind ~30 Zeilen `supabase-js`. Befund 11.1 |
| 46 | Zweites Supabase-Projekt als `dev` | P2 | 9 Konfiguration | `.env` | S | 39 | Lokales Entwickeln schreibt derzeit in die Produktionsdatenbank. Liefert gleichzeitig das Backend für #33. Befund 9.2 |
| 47 | `robots.txt`, `sitemap.xml`, Canonical, absolute `og:*`-URLs, eigenes `og-cover.jpg` | P2 | 15 SEO | `public/`, `index.html:27-37` | S | — | `og:image` ist relativ (Vorschau bleibt beim Teilen leer) und 2,25 MB groß. Befunde 15.1, 15.3 |
| 48 | Klickbare `<div>`/`<article>` zu `<button>` machen | P2 | 14 Zugänglichkeit | `src/js/landing.js:431,446,155` + ~10 weitere | M | — | Entdecken-Karten und Suchergebnisse sind per Tastatur nicht erreichbar. `role=` steht 7×, `tabindex` 2× im ganzen `src/js/`. Befund 14.1 |
| 49 | Gemeinsamer `openModal()`-Helfer: `role="dialog"`, Fokus-Trap, Escape, Fokus zurückgeben | P2 | 14 Zugänglichkeit | `src/js/auth.js:567,720`, `feedback.js:164`, `community.js` | M | 48 | Tab führt aus offenen Dialogen heraus, Escape schließt nicht überall. Befund 14.2 |
| 50 | `voice.js` dynamisch importieren (LiveKit aus dem Community-Chunk lösen) | P2 | 8 Performance | `src/js/community.js:24-27` | M | — | Spart ~120 kB gzip für alle, die nie telefonieren. Der Community-Chunk ist 670 kB. Befund 8.3 |
| 51 | Bestätigungsdialog für „Kanal löschen" und „Gruppe verlassen" | P2 | 14 UX | `src/js/community.js`, `community-api.js:1129` | S | — | Ein Klick löscht einen Kanal samt aller Nachrichten. `openConfirmModal` existiert bereits. Befund 14.4 |
| 52 | `createGroup` als Postgres-Funktion (echte Transaktion) | P2 | 2 Datenmodell | `src/js/community-api.js:917-956` | M | 39 | Drei Inserts mit handgeschriebener Kompensation — bricht der Browser dazwischen ab, bleibt eine Gruppe ohne Kanal zurück. Befund 2.4 |
| 53 | Einheitliches Fehlerformat in `api/*`, Upstream-Fehlertexte nicht durchreichen | P2 | 5 API | `api/*.js`, `api/_shared.js` | S | 12 | Vier verschiedene Fehlerformen; `ai-match.js:66` gibt die rohe OpenAI-Antwort an den Client. Befunde 5.1, 4.5 |
| 54 | Skelett-Ansicht während `initCommunityData()` | P2 | 6 Frontend | `src/js/community.js:501-505` | S | — | Neun parallele Abfragen ohne jede Anzeige — der Bereich bleibt leer. Befund 6.3 |
| 55 | Datenimport/-export: Allowlist statt `mm_`-Präfixprüfung | P2 | 4 Sicherheit | `src/js/account.js:1968-2002` | S | 29 | Import setzt beliebige `mm_*`-Schlüssel (inkl. Auth-Caches), Export gibt Klartext-Passwörter heraus. Befund 4.9 |
| 56 | E-Mail-Änderung im Konto: entweder echt umsetzen oder Feld entfernen | P2 | 14 UX | `src/js/account.js:1915-1917` | S | 21 | Schreibt nur nach `localStorage`; die Anmelde-E-Mail bleibt unverändert. Die UI behauptet etwas Falsches. Befund 16.5 |
| 57 | AGB + Community-Regeln als dritte Rechtsseite, Häkchen bei der Registrierung | P2 | 16 Recht | neu: `public/agb.html` | M | 15 | Nutzer erstellen öffentliche Inhalte, es gibt keine Regeln. Altersabfrage ab 14 ohne Validierung (Art. 8 DSGVO). Befund 16.7 |
| 58 | `push-trigger`: `timingSafeEqual` + Limit pro Absender | P2 | 4 Sicherheit | `api/push-trigger.js:23-31,160-174` | S | — | Der einzige Endpunkt ganz ohne Rate-Limit; jeder Aufruf löst mehrere Service-Role-Abfragen aus. Befund 4.7 |
| 59 | LiveKit-Token-TTL von 6 h auf 1 h | P2 | 4 Sicherheit | `api/livekit-token.js:113` | S | — | Lang für einen Sprachraum; LiveKit erneuert von selbst. Befund 5.3 |
| 60 | Leere `catch`-Blöcke mit `console.warn` versehen | P2 | 7 Robustheit | 71 Stellen, u. a. `auth.js:219`, `community-api.js:578,624`, `voice.js:376,386`, `ai.js:44` | M | 17 | Erst mit Sentry sichtbar — dann aber sofort nützlich. Befund 7.4 |
| 61 | Globaler `error`-Handler + Auffangbereich in `main.js` | P2 | 7 Robustheit | `src/main.js` | S | 17 | Drei Zeilen ohne jede Absicherung; wirft ein Bildschirm beim Rendern, bleibt ein leerer Container stehen. Befund 7.5 |
| 62 | `<noscript>`-Block mit Kurzbeschreibung und Rechts-Links | P2 | 15 SEO | `index.html` | S | — | Ohne JS ist die Seite vollständig leer — auch für Crawler, die kein JS ausführen. Befund 15.4 |
| 63 | `_appendMessageToGroupChat` und `_appendMessageToDMChat` zusammenführen | P2 | 13 Wartbarkeit | `src/js/community.js:865-1002,1005-1106` | M | — | 240 Zeilen, zu ~85 % identisch. Jede Änderung am Nachrichten-Markup muss zweimal gemacht werden. Befund 6.2 |
| 64 | Sieben irreführende Kommentare korrigieren, `setCatalog()` anschließen oder entfernen | P2 | 13 Wartbarkeit | `matching.js:5-9,429,581`, `marketplace.js:6-9`, `community.js:10-12`, `schema.sql:409` | S | 5 | „Architected for 40,000+ motorcycles" bei 10 hartcodierten Bikes und ungenutztem `setCatalog()`. Bei 38.000 Zeilen sind Kommentare deine Landkarte. Befund 13.1 |
| 65 | Zirkelbezug `auth.js ↔ community-api.js` auflösen | P2 | 1 Architektur | `src/js/auth.js:15`, `src/js/community-api.js:20` | S | — | `initCommunityData` an das bereits vorhandene `mm:auth-changed`-Event hängen statt aus `auth.js` aufzurufen. Befund 1.1 |
| 66 | `viewState`-Objekt statt 8 Modulvariablen | P2 | 6 Frontend | `src/js/community.js:750-769` | M | 63 | Jeder neue Bildschirm muss diese Liste kennen; `resetNavState` dokumentiert den Fehler, der daraus schon entstanden ist. Befund 6.1 |

---

## P3 — Aufräumen

| # | Titel | Schweregrad | Bereich | Datei(en) | Aufwand | Abhängig von | Warum |
|---|---|---|---|---|---|---|---|
| 67 | Toten Code löschen | P3 | 13 Wartbarkeit | `src/counter.js`, `src/style.css`, `src/assets/{vite,javascript}.svg`, `copy-bikes.mjs`, `copy-assembly.js`, `vite.config.js:7-67`, `.env`: `VITE_TURN_*` | S | 3 | ~420 Zeilen Vite-Template-Reste und ein Windows-Pfad (`D:/MotoMatch`), der auf macOS nie greift. Befund 1.4 |
| 68 | Drei lokale `esc()`-Kopien durch den Import aus `util.js` ersetzen | P3 | 13 Wartbarkeit | `src/js/auth.js:564`, `feedback.js:25`, `landing.js:24` | S | 11 | Härtest du eine, härtest du drei nicht mit — genau der Fall bei #11. Befund 1.3 |
| 69 | Supabase-Projekt-ID aus `matching.js` in eine Konstante | P3 | 9 Konfiguration | `src/js/matching.js:45,71,97,123,149,175,201,227,253,279` | S | 46 | Zehnmal hartcodiert; blockiert den Wechsel auf ein `dev`-Projekt. Befund 9.3 |
| 70 | `.ilike()` für Namensvergleiche durch `.eq()` + `lower()`-Index ersetzen | P3 | 3 Auth | `src/js/auth.js:346,462`, `community-api.js:1626,1798` | S | 34 | Benutzername `max_1` kollidiert per `ILIKE` mit `maxx1` → falsches „bereits vergeben". Befund 3.8 |
| 71 | `confirm()` durch `openConfirmModal` ersetzen | P3 | 14 UX | `src/js/account.js:1931,1945,1992` | S | 51 | Stilbruch — der Rest der App nutzt eigene Dialoge. Befund 14.4 |
| 72 | `.nvmrc` auf `24` setzen (Vercel-Projekteinstellung) | P3 | 10 Deploy | `.nvmrc` | S | — | Geprüft: Vercel baut mit 24.x, `.nvmrc` sagt 20, lokal läuft 25.9.0. Die Datei beschreibt nichts, was irgendwo gilt. Befund 9.6 |
| 73 | `setInterval(nudge, 45000)` aufräumen | P3 | 13 Wartbarkeit | `src/js/feedback.js:159` | S | — | Läuft für die gesamte Sitzungsdauer weiter. |
| 74 | `matching.js`: statischen und dynamischen Import vereinheitlichen | P3 | 8 Performance | `src/js/app.js:24`, 5 weitere Module | S | — | Der Build meldet, dass der dynamische Import wirkungslos bleibt. |
| 75 | Vite 5 → 8, Sentry 8 → 10 | P3 | 4 Sicherheit | `package.json` | M | 45 | 23 `npm audit`-Meldungen, alle in devDependencies (nicht im Bundle). Braucht Tests als Netz. Befund 4.11 |
| 76 | `main.css` (13.798 Z.) gliedern oder aufteilen | P3 | 13 Wartbarkeit | `src/styles/main.css` | L | 66 | Eine Datei, 47 kB gzip, kein Weg zu erkennen, was noch benutzt wird. |
| 77 | `community.js` (5.164 Z.) nach Bildschirm aufteilen | P3 | 1 Architektur | `src/js/community.js` | L | 66 | Der Datenzugriff ist bereits getrennt — die Aufteilung ist mechanisch. Befund 1.2 |
| 78 | Echte Routen: `vercel.json`-Rewrite + Pfade in `nav.js` | P3 | 15 SEO | `vercel.json`, `src/js/nav.js:193-197` | M | 47 | Macht Bikes teilbar, indexierbar und pro Seite betitelbar. Befund 15.2 |
| 79 | Bike-Katalog nach Supabase umziehen | P3 | 2 Datenmodell | `src/js/matching.js:22-283`, `:429` | M | 64 | **Erst ab ~30 Modellen.** Bis dahin ist der Code der pragmatischere Ort — aber `setCatalog()` braucht dann endlich einen Aufrufer |
| 80 | Amazon-Affiliate-Tags nachrüsten inkl. Kennzeichnung | P3 | 16 Recht | `src/js/gear.js`, `public/datenschutz.html`, `public/impressum.html` | M | 15, 23 | **Erst wenn der Ausrüstungsbereich nachweislich genutzt wird.** Bringt Kennzeichnungspflichten nach § 6 DDG und PartnerNet mit |

---

## Nachtrag — beim Schließen von #6 und #7 gefunden (29.08.2026)

Beim Reparieren von `email_for_username`, `msg_insert_dm` und `msg_update` fielen drei weitere Policies auf, die noch nicht im Backlog stehen. Nicht mitgeändert — die SQL-Sitzung sollte auf die vier Löcher aus Schritt 4 beschränkt bleiben.

| # | Titel | Schweregrad | Bereich | Datei(en) | Aufwand | Abhängig von | Warum |
|---|---|---|---|---|---|---|---|
| 81 | `email_for_username`: Abfrage begrenzen — Edge Function mit Rate-Limit, oder gar keine Klartext-Adresse zurückgeben | P1 | 3 Auth | `supabase/schema.sql:467-480`, `src/js/auth.js:303-306` | M | 6 | #6 beendet das Abklappern per `%`, aber die Funktion liefert weiterhin die echte E-Mail zu einem **exakt** geratenen Benutzernamen. Benutzernamen sind über `profiles_select` öffentlich (#42) — wer die Liste zieht, löst sie einzeln in Adressen auf. Aus einem Aufruf werden N, verhindert ist der Bestandsabzug damit nicht. |
| 82 | `groups_update`: eigenes `WITH CHECK`, `created_by` festnageln | P1 | 3 Auth | `supabase/schema.sql:105-108` | S | 1 | Ohne eigenes `WITH CHECK` setzt Postgres die `USING`-Bedingung auch für die neue Zeile ein — die erfüllt ein `mod` bereits. Er kann `created_by` auf sich selbst setzen und damit die Gruppe übernehmen, samt Löschrecht (`groups_delete` prüft nur `created_by`). |
| 83 | `msg_update`: Kanalzweig im `WITH CHECK` nachziehen | P2 | 3 Auth | `supabase/schema.sql:320-338` | S | 7 | Das `WITH CHECK` aus #7 deckt bewusst nur DMs ab; für Kanalnachrichten gilt weiter allein `USING`. Ein Autor kann seine Nachricht per UPDATE in einen beliebigen anderen Kanal umhängen, ein Mod die `author_id` einer Nachricht in seinem Kanal auf eine fremde uuid umschreiben. |

Vier weitere Beobachtungen aus derselben Durchsicht sind bereits erfasst und brauchen keinen neuen Eintrag: `invites_select`/`invites_update` → **#9**, `gm_insert` → **#8**, `bf_insert_auth` mit `user_id IS NULL` → **#32**, `profiles_select`/`gm_select` öffentlich → **#42**. Die `ILIKE`-Prüfung in der Registrierung (`auth.js:346`) steht als **#70**.

---

## Was ich nicht entscheiden konnte

- **Gibt es ein Backup der Supabase-Datenbank?** Weder im Repo noch über die CLI sichtbar. Im Free-Plan legt Supabase keine automatischen Sicherungen an. Falls nein, ist Punkt 1 nicht optional.
- **Wie viele Beta-Tester, und wird die Adresse beworben?** Ändert die Dringlichkeit von #12 (offener KI-Proxy) erheblich. Die Limits aus #2 entschärfen beide Fälle.
- **Öffentliche oder Einladungs-Beta?** `disable_signup: false` — jeder mit der URL kann ein Konto anlegen. Eine Einladungsliste wäre der billigste Schutz überhaupt und kauft Zeit für die P1-Punkte.
