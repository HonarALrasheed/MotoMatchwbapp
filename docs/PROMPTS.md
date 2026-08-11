# MotoMatch — Pre-Launch-Prompts für Claude Code

> **Diese Datei = alles bis zum Beta-Launch.** 20 Prompts, ~50 h Arbeit, ~3–4
> Wochen bei 20 h/Woche. Nach Abschluss ist die Beta live an 30 Bekannten.
>
> **Post-Launch:** [PROMPTS-POST-LAUNCH.md](PROMPTS-POST-LAUNCH.md) — 14 Prompts
> für Ride-Feed, Push, Voice, Native App, SEO usw. **Nicht** vor Launch anfassen.
>
> Jeder Prompt ist **self-contained** — du kannst ihn in eine frische Session
> pasten, ohne dass Claude Vorwissen aus deiner alten Session braucht.
>
> **Wie benutzen:**
> 1. Neue Claude-Code-Session starten im Projektroot `/Volumes/Untitled/MotoMatch/moto-match`
> 2. Prompt komplett kopieren und einfügen
> 3. Claude lässt sich zuerst kurz die relevanten Files zeigen, dann arbeiten lassen
> 4. Am Ende: `git status` → committen → nächste Aufgabe
>
> **Vor jedem Prompt selbst prüfen:** `git status` sauber? Wenn nicht, erst committen.

---

## T0.1 — Git-Hygiene wiederherstellen

```
Wir arbeiten am MotoMatch-Projekt (Vanilla-JS + Vite + Supabase, siehe CLAUDE.md
und docs/STATUS.md). Aktuell sind nur 2 Commits im Git-Log und 16 Dateien uncommittet.
Das ist unser größtes Risiko — kein Rollback möglich.

Aufgabe: die uncommitteten Änderungen sichten und in 2–4 thematisch sinnvolle Commits
zerlegen, dann pushen. Anschließend Branch-Protection für `main` einrichten.

Schritte:
1. `git status` und `git diff` durchgehen — mir eine Übersicht geben, welche Änderungen
   in welchen Files sind, und einen Vorschlag machen, wie du sie thematisch bündeln
   würdest (Vorschlag: eine Gruppierung pro Domäne — z. B. "community-api", "auth",
   "landing-polish", "sonstiges").
2. Mich pro Commit-Vorschlag um Bestätigung fragen bevor du `git add` und `git commit`
   ausführst. Commit-Messages im Conventional-Commits-Stil (feat/fix/chore/refactor).
3. Nach allen Commits: `git push` — falls du `git push` nicht ohne Nachfrage darfst,
   frag mich vorher.
4. Zum Schluss vorschlagen wie ich Branch-Protection auf GitHub einrichte (Screen-by-Screen,
   ich mache das selbst im Browser).

Wichtig:
- KEIN `git commit --amend`, KEIN Rebase, KEIN Force-Push.
- KEINE `.env` / `.env.local` staggen (auch wenn `git status` sie irgendwie zeigen sollte —
  laut .gitignore werden sie aber ignoriert).
- Sensible Files (Secrets) vor jedem commit prüfen.
- Wenn ein pre-commit-hook fehlschlägt: Ursache untersuchen, nicht mit --no-verify umgehen.

Definition of Done: `git status` sagt "nothing to commit, working tree clean";
`git log --oneline` zeigt die neuen Commits; ich weiß was ich für Branch-Protection
klicken muss.
```

---

## T0.2 — Sentry integrieren

```
Wir integrieren Sentry (Free-Tier) ins MotoMatch-Projekt für Fehler-Monitoring
in der Beta. Kontext: Vanilla-JS + Vite (kein React), plus Vercel Serverless
Functions in `api/*.js`.

Bevor du irgendetwas änderst: lies `src/main.js`, `src/js/app.js`, `index.html`,
`api/ai-match.js`, `api/search-places.js` und `.env.example` — damit du weißt wie
Bootstrapping und Env-Vars laufen.

Aufgabe:
1. Frontend-Sentry: `@sentry/browser` als Dependency hinzufügen. In einem neuen
   `src/js/monitoring.js` init-Funktion `initMonitoring()` — liest DSN aus
   `import.meta.env.VITE_SENTRY_DSN`, wenn leer: einfach no-op mit Console-Info
   (analog zum bestehenden OFFLINE_MODE-Muster in `src/js/supabase.js`).
   `beforeSend` so konfigurieren, dass PII (E-Mails, Passwörter) rausgefiltert werden.
2. `initMonitoring()` GANZ AM ANFANG von `src/js/app.js` in `startApp()` aufrufen
   (vor `initSupabaseAuth`), damit Fehler beim Bootstrap auch erfasst werden.
3. Backend-Sentry für die zwei Serverless-Functions: `@sentry/node` in `api/ai-match.js`
   und `api/search-places.js` — try/catch bleibt, aber jeder Fehler wird zusätzlich
   an Sentry gesendet. DSN aus `process.env.SENTRY_DSN` (ohne VITE_-Prefix).
4. `.env.example` und `CLAUDE.md` (§ Env-Variablen) aktualisieren: `VITE_SENTRY_DSN`
   (client) und `SENTRY_DSN` (server) hinzufügen, beide als optional.
5. Am Ende einen Test-Error dokumentieren: eine bewusst-fehlerhafte Zeile die man
   temporär einbauen kann, um den Sentry-Empfang zu verifizieren. NICHT den Testcode
   committen.

Wichtig:
- KEINE anderen Dependencies hinzufügen als `@sentry/browser` und `@sentry/node`.
- Wenn eine Änderung an Struktur/Bootstrap nötig scheint, die über das oben Beschriebene
  hinausgeht: erst nachfragen.
- Source-Maps-Upload nicht in dieser Session — dokumentiere aber in `CLAUDE.md`
  einen Hinweis wie das mit `sentry-cli` später geht.
- Nicht selbst `npm install` ausführen ohne mich zu fragen.

DoD: `npm install` läuft; im Frontend sehe ich in der Konsole "[Monitoring] Sentry
initialisiert" (bzw. "[Monitoring] deaktiviert — kein DSN"); die Serverless-Functions
haben Sentry-Wrapping; `.env.example` und CLAUDE.md sind konsistent.
```

---

## T0.3 — Google-Maps-Key + Serverless-APIs schützen

```
Wir schließen die Kostenfallen im MotoMatch-Projekt. Zwei Baustellen:
(a) Google-Maps-Key ist im Frontend öffentlich → Restriction muss ins
    Google-Cloud-Dashboard. Das ist Config, keine Code-Änderung.
(b) Serverless-Functions `api/ai-match.js` und `api/search-places.js` haben
    weder Origin-Check noch Rate-Limit — jeder mit der URL kann sie aufrufen.

Bevor du änderst: lies `api/ai-match.js`, `api/search-places.js`, `vercel.json`,
`.env.example`.

Aufgabe:
1. In beiden Serverless-Files einen Helper `checkOriginAndRate(req, res)` einbauen
   (kann in einer neuen Datei `api/_shared.js` liegen, damit er nicht doppelt ist):
   - Origin-Check: `req.headers.origin` muss auf einer Allowlist stehen, die aus
     `process.env.ALLOWED_ORIGINS` (kommagetrennt) kommt. Kein Match → 403.
   - Rate-Limit: einfaches per-IP-Limit, 10 Requests pro Minute pro IP.
     Für die Beta reicht eine in-memory-Map mit TTL (Modul-Scope; ich weiß, dass
     Vercel-Serverless zwischen Cold-Starts wechselt — das ist bewusst so, wir
     brauchen keine perfekte Lösung, nur einen einfachen Schutz gegen Missbrauch).
     Über Limit → 429 mit Retry-After-Header.
   - IP aus `req.headers['x-forwarded-for']` (erster Wert) bzw. `req.headers['x-real-ip']`.
2. Beide Endpoints rufen den Helper als Erstes auf; wenn der Helper eine Response
   schickt, sofort `return`.
3. `.env.example` aktualisieren: `ALLOWED_ORIGINS` als Pflicht dokumentieren mit
   Beispiel `https://moto-matchwbapp.vercel.app,http://localhost:5173`.
4. In `CLAUDE.md` einen neuen Abschnitt "API-Schutz" mit kurzer Erklärung wie
   der Helper funktioniert.

Nicht-Code (mir erklären, ich mache das im Browser):
5. Schritt-für-Schritt-Anleitung, wie ich in der Google-Cloud-Console eine
   HTTP-Referrer-Restriction auf den `VITE_GMAPS_KEY` lege — mit exakten Menü-Pfaden,
   welche Wildcards ich verwende, und welche Referrer ich eintragen muss
   (Vercel-Domain, Vercel-Preview-Wildcard, localhost:5173).

Wichtig:
- KEINE externe Rate-Limit-Library hinzufügen (kein `express-rate-limit` etc.) —
  wir wollen zero-dependency.
- Cold-Start-Reset des In-Memory-Store ist akzeptabel und wird dokumentiert.
- Wenn du unsicher bist wie Vercel die Env-Vars an `api/*` durchreicht: lies
  `vercel.json` und die Vercel-Docs, keine Vermutungen.

DoD: `curl -X POST` gegen `/api/ai-match` ohne korrekten Origin → 403;
mit korrektem Origin 11-mal in 60s → 11. Aufruf ist 429; ich habe die
Klick-Anleitung für die Google-Cloud-Console.
```

---

## T1.1 — Toten Code entfernen

```
Aufräum-Session im MotoMatch-Projekt. Wir löschen bestätigten toten Code und
Dev-Legacy. Belege stehen in docs/STATUS.md § 7 und § 9.

Bevor du löschst, verifiziere jeden Punkt einzeln mit grep und melde mir das
Ergebnis — erst nach meiner Bestätigung tatsächlich löschen.

Prüfliste (jede Zeile einzeln verifizieren + löschen):
1. `src/js/map-view.js` — laut Analyse nirgendwo importiert.
   Verifizieren: `grep -rn "map-view" src/ index.html src/main.js`.
   Wenn 0 externe Referenzen: löschen.
2. `CLAUDE.md.backup` — Reste eines Rewrite-Versuchs. Löschen.
3. `vite.config.js` Zeilen 6–70 (Windows-Asset-Copy `D:/MotoMatch/…`) —
   auf macOS toter Code. Rausschneiden. Die verbleibende Config muss:
   - lokal `vite` starten (Port 5173)
   - `npm run build` produzieren
   - den Hero-Video-Serve-Middleware-Block sauber entfernen (der referenziert
     ebenfalls `D:/MotoMatch/…`).
   Nach dem Refactor: `npm run build` starten und prüfen dass es durchläuft.
4. `dot_clean .` im Repo-Root ausführen, dann `find . -name '._*' -not -path
   './node_modules/*' | wc -l` — sollte 0 sein.
5. Prüfen ob `dist/` im Repo-Root existiert (aus vorherigen Builds).
   Wenn ja: löschen. `.gitignore` schließt es korrekt aus, aber wenn es lokal
   da ist ist es 122 MB Ballast.

Wichtig:
- Jeder Löschvorgang: erst per grep verifizieren, dann mir das Grep-Ergebnis zeigen,
  dann von mir Freigabe abwarten, DANN löschen.
- KEINE anderen Files löschen die nicht in dieser Liste stehen, auch wenn sie
  "verdächtig" aussehen.
- Vor dem Bearbeiten von `vite.config.js`: kompletten Inhalt zeigen, Diff vorschlagen,
  Freigabe abwarten.

DoD: `npm run dev` startet ohne Fehler; `npm run build` produziert `dist/` ohne
Fehler; `grep -r map-view src/` liefert nichts; keine `._*`-Files mehr im Repo-Root;
alles ist committet (kleiner Commit "chore: remove dead code and windows-legacy").
```

---

## T1.2 — Landing-Footer entrümpeln

```
Wir entpeinlichen den Landing-Page-Footer im MotoMatch-Projekt. In
`src/js/landing.js` Zeilen 365–393 stehen 13 TODO-Links auf nicht existente
Seiten wie "MotoMatch AG", "Investor Relations", "Newsroom & Presse",
"Karriere", "Motorrad-Konfigurator", "Marktplatz" etc. Das wirkt bei einer
Closed Beta mit 30 Bekannten unseriös bis absurd.

Bevor du änderst: lies `src/js/landing.js` (nur den Footer-Bereich, Zeilen ~350–420
reichen).

Aufgabe:
Den Footer auf genau vier Links reduzieren:
- "Impressum" → `/impressum.html`
- "Datenschutz" → `/datenschutz.html`
- "Kontakt" → `mailto:` mit meiner E-Mail (frag mich vorher welche das sein soll)
- "Feedback" → wird später (T2.2) durch den Feedback-FAB ersetzt; für jetzt
  ebenfalls `mailto:` mit Betreff "MotoMatch Beta-Feedback"

Alle anderen Links komplett entfernen (auch die TODO-Kommentare). Die Sektionen
"MotoMatch AG", "Investor Relations", "Newsroom & Presse", "Karriere" komplett
raus — nicht "coming soon" o.ä., sondern weg. Ebenso "Konfigurator", "Marktplatz",
"MotoMatch Connect", "MotoMatch Contact", "MotoMatch Homepage",
"Motorrad kaufen", "Motorrad verkaufen".

Danach: das Styling im Footer prüfen — wenn die verbleibenden 4 Links optisch
seltsam vereinzelt wirken (weil vorher mehrere Spalten waren), das CSS in
`src/styles/main.css` minimal anpassen dass es zentriert / einzeilig / wie auch
immer sinnvoll aussieht. UI-Verifikation über die Browser-Preview (Port 5173),
Screenshot machen und mir zeigen.

Wichtig:
- KEINE anderen Landing-Bereiche anfassen. Nur Footer.
- NUR `src/js/landing.js` und ggf. `src/styles/main.css` editieren.
- `esc()` verwenden falls dynamischer Text reinkommt (Konvention aus CLAUDE.md).
- KEINE Inline-Styles.

DoD: Alle Footer-Links funktionieren; kein "TODO" im Footer-Code; Screenshot aus
der Preview zeigt einen sauberen minimalistischen Footer; commit
"refactor(landing): trim placeholder footer links".
```

---

## T1.3 — Beta-Features ausblenden (Voice, QR, Shop, Quests, Marketplace)

```
Wir verstecken für die Beta alle Features, die entweder nicht funktionieren oder
nicht Beta-Scope sind, hinter Feature-Flags. Kontext: Closed Beta mit 30 Bekannten;
was Tester nicht sehen, können sie nicht enttäuscht klicken.

Zu versteckende Features:
- Voice/Talks in der Community (`src/js/voice.js`, in `src/js/community.js` importiert)
- QR-Login (irgendwo im Account/Auth-UI)
- Shop
- Quests
- Marketplace (`src/js/marketplace.js`, in `src/js/garage.js` importiert)

Bevor du änderst: lies `src/js/community.js` (nur um zu sehen wo Voice-Tabs
gerendert werden), `src/js/account.js` (grep nach QR/Shop/Quests), `src/js/garage.js`
(wo marketplace referenziert wird).

Aufgabe:
1. Neue Datei `src/js/config.js`:
   ```
   export const BETA_FLAGS = {
     voice: false,
     marketplace: false,
     shop: false,
     qrLogin: false,
     quests: false,
   }
   ```
2. In den betroffenen Modulen den jeweiligen Feature-Entrypoint hinter das Flag legen:
   - Wenn `flag === false`: den UI-Eintrag (Button, Tab, Menü-Item) gar nicht rendern
     (bevorzugt) oder als `disabled` mit Tooltip "Bald verfügbar" markieren, je nachdem
     was mit dem Rest-UI am wenigsten kollidiert.
   - Für Voice in Community: die Talks-Tabs komplett ausblenden; die Import-Statements
     von `voice.js` beibehalten (kein Dead-Code jetzt, das räumen wir später auf).
3. Für JEDEN Ort, an dem du ein Flag benutzt, mir vorab zeigen:
   - Datei + Zeilennummer
   - Aktueller Code (kurzer Ausschnitt)
   - Vorschlag wie du es ändern würdest
   Erst nach meinem OK ausführen.
4. Am Ende: UI-Verifikation in der Browser-Preview — Community öffnen (keine
   Voice-Tabs), Garage öffnen (kein Marketplace-Bereich), Account öffnen
   (kein QR/Shop/Quests). Screenshots mitschicken.

Wichtig:
- KEINE Files löschen (auch nicht `voice.js`, `marketplace.js` etc.). Nur ausblenden.
- KEINE Refactorings am eigentlichen Feature-Code.
- Feature-Flag-File: KEINE weiteren Konstanten oder Utilities darin.

DoD: `BETA_FLAGS` existiert in `src/js/config.js`; alle 5 Features sind aus dem
UI verschwunden ohne Konsolen-Fehler; Screenshots der 3 relevanten Screens
angehängt; commit "feat: gate beta-out features behind BETA_FLAGS".
```

---

## T1.4 — localStorage-Keys aufräumen

```
Wir bereinigen die localStorage-Duplikate im MotoMatch-Projekt. Aktuell koexistieren
mehrere Duo-Paare mit unklarer "aktiver" Variante — Karteileichen aus
Versionswechseln. Belege stehen in docs/STATUS.md § 3.

Duo-Paare:
- `mm_gear_favs` vs. `mm_kv_favs` (+ jeweils `_meta`)
- `mm_comm_friends_v1` vs. `mm_comm_friends_v2`
- `mm_comm_prefs` vs. `mm_comm_prefs_v1`
- `mm_recent_bikes_v1` vs. `mm_recent_kv`

Vorgehen streng in dieser Reihenfolge:
1. Für JEDES Duo per grep in `src/js/` herausfinden welcher Key aktiv geschrieben und
   gelesen wird, und welcher tot ist. Ausschließlich Belege. Ergebnis mir als
   kleine Tabelle zeigen:
   | Duo | aktiv | tot | Belegdatei:Zeile |
2. Auf meine Freigabe warten.
3. Für jedes tote Duo-Element: alle Referenzen im Code entfernen.
4. Optional (nur wenn ich zustimme): eine einmalige Migrations-Funktion
   `migrateLegacyStorage()` in `src/js/util.js`, die beim App-Start aufgerufen wird
   und alte Keys nach neuen umzieht (falls User die App schon mit alten Daten hatten)
   und dann die alten Keys löscht. Wenn wir das machen, muss sie idempotent sein
   (mehrfach aufrufbar) und darf keine Daten überschreiben.

Wichtig:
- Nichts löschen ohne dass ich die Tabelle aus Schritt 1 gesehen habe.
- Bei Unsicherheit welcher Key aktiv ist (z. B. beide werden geschrieben): mir
  melden, nicht raten.
- KEINE anderen `mm_*`-Keys anfassen, auch wenn sie "verdächtig" aussehen.

DoD: Pro Duo nur noch ein Key im Code; Migration (falls implementiert) läuft beim
App-Start ohne Fehler; UI-Verifikation dass Favoriten/Freunde/Prefs noch funktionieren;
commit "chore: consolidate legacy localStorage keys".
```

---

## T1.5 — Landing-Repositionierung (Zwei-Wege für neue + Bestandsfahrer)

```
Wir positionieren die MotoMatch-Landing neu. Aktuelles Problem: die Landing ist
komplett Match-fokussiert ("FINDE DEIN PERFEKTES BIKE"), obwohl die App viel mehr
kann (Community, Karte, Ausrüstung, Journal, Garage). Bestandsfahrer, die schon ein
Bike haben, denken "nicht für mich" und gehen wieder.

Ziel: Landing so gestalten, dass beide Zielgruppen (Bike-Suchende + Bestandsfahrer)
sich sofort erkannt fühlen — ohne die visuelle Wucht des Hero-Bildes zu verlieren.

Bevor du änderst: `src/js/landing.js` komplett lesen. Hero-Sektion, Sektionen-Grid,
Menü-Aufbau (die Nav-Bar mit "Ansicht / Ausrüstung / Match finden / Community /
Karte") verstehen.

Aufgabe:
1. Neuer Slogan im Hero. Mir 4 Vorschläge zeigen, ich wähle einen:
   - "MotoMatch. Alles fürs Motorrad, an einem Ort."
   - "Dein Zuhause fürs Motorrad."
   - "Fahren beginnt hier."
   - "Die App für alle, die Motorrad leben."
   Bis meine Wahl da ist: keine Änderung am Slogan.

2. Zwei-CTA-Hero. Bild bleibt (Triumph-Motiv). Unterhalb des Slogans zwei
   gleichwertige Buttons nebeneinander:
   - Primär (weiß gefüllt): "Passendes Bike finden" → startet Quiz
   - Sekundär (Outline): "Ich hab schon eins →" → öffnet einen kleinen
     Chooser-Overlay (nächster Punkt)

3. Chooser-Overlay bei erstem Klick auf "Ich hab schon eins →":
   - Klein, zentriert, 3–4 Buttons:
     - "Freunde zum Fahren finden" → Community-Screen
     - "Meine Bikes verwalten" → Account/Meine Bikes
     - "Karte & Werkstätten" → Karte-Screen
     - "Nur umschauen" → schließt Overlay, tut nichts
   - Wahl wird NICHT gespeichert — nur eine Navigation. Wir personalisieren
     die Landing NICHT dauerhaft in dieser Iteration (das ist Post-Launch).

4. Sektionen unter dem Hero. Aktuell drei Bild-Kacheln ("Quiz & Matching",
   "Händler & Beratung", "Community & Gear"). Umbau zu vier Nutzungs-Sektionen,
   jeweils mit Bild, Titel, Kurzbeschreibung, "→"-Link:
   - "Finde dein perfektes Bike" → Quiz
   - "Deine Garage im Blick" → Account/Meine Bikes/Wartung
   - "Fahr nicht allein" → Community
   - "Alles fürs Fahren" → Ausrüstung + Karte
   Bilder aus dem bestehenden Bestand nehmen; keine neuen Assets herbeiziehen.

5. Menü-Renaming in der Top-Nav (`src/js/landing.js` bzw. wo die Nav gerendert wird):
   - "Match finden" → "Match" (kürzer, weniger dominant)
   - "Ansicht" → "Bikes" (klarer)
   - Neu: "Garage" als Menüpunkt (öffnet Account/Meine Bikes) — falls das
     das Design nicht zerschießt (max. 6 Menüpunkte). Sonst nur Renaming.

6. Copyright-Footer: "© 2026 MotoMatch AG" → "© 2026 MotoMatch". Das "AG" raus.

Wichtig:
- KEINE anderen Screens anfassen.
- KEINE neuen Assets/Bilder importieren.
- Nach jeder Teiländerung Browser-Preview aufmachen und Screenshot mitschicken.
- `esc()` für allen dynamischen Text.
- Chooser-Overlay: kein Framework, plain JS/CSS-Modal wie im Rest der App.
- WENN das Menü-Renaming das Layout kaputtmacht (Nav-Bar bricht um o.ä.):
  nur Renaming, kein neuer Menüpunkt. Melde dich vor der Entscheidung.

DoD: Landing zeigt neuen Slogan; zwei CTAs sichtbar und funktional; Chooser-
Overlay tut was es soll; vier Nutzungs-Sektionen sortiert; Menü umbenannt;
"AG" aus Copyright weg; drei Screenshots (Hero, Chooser offen, Sektionen);
commit "refactor(landing): reposition for both new and existing riders".
```

---

## T1.6 — Grammatik-Fixes in Community-Empty-States

```
Kleiner Fix im MotoMatch-Projekt. In den leeren Community-Kategorien
(Events, Touren usw.) stehen grammatikalisch fehlerhafte Sätze wie
"Tritt einer bestehenden Event bei" oder "erstelle die erste Event".
"Event" ist Neutrum → "einem bestehenden Event" bzw. "das erste Event".

Bevor du änderst: `src/js/community.js` und `src/js/community-api.js`
per grep durchsuchen nach "bestehenden Event", "erste Event",
"bestehenden Tour" etc. Alle Kategorien prüfen (Events, Touren, Gruppen,
Stammtische, Rennstrecke, Schrauber-Treff, Forum).

Aufgabe:
1. Alle fehlerhaften Empty-State-Texte auflisten und mir zeigen — pro
   Kategorie den aktuellen Text + den korrigierten Vorschlag.
2. Nach meinem OK: alle in einem Rutsch korrigieren.
3. Nach dem Fix in der Browser-Preview jede Kategorie einmal öffnen
   (als Gast, unregistriert), Screenshots.

Wichtig:
- Nur Text-Änderungen, keine Logik-Änderungen.
- Alle Screens einmal testen — bei so vielen Kategorien passiert schnell
  ein Copy-Paste-Fehler.

DoD: Alle Empty-States grammatikalisch korrekt; Screenshots pro Kategorie;
commit "fix(community): grammar in empty-state texts".
```

---

## T2.1 — Passwort-vergessen-Flow

```
Wir bauen den öffentlichen Passwort-vergessen-Flow im MotoMatch-Projekt.
Kontext: Auth läuft über Supabase (siehe `src/js/auth.js`, `src/js/supabase.js`);
`changePassword` für eingeloggte User existiert schon (auth.js L480–505), aber es
gibt keinen öffentlichen "Passwort vergessen"-Weg für nicht-eingeloggte User.

Bevor du änderst: lies `src/js/auth.js` komplett, `src/js/supabase.js`, und schau
im `openAuthModal`-Code (auth.js L539+) wie das Auth-Modal aufgebaut ist.

Aufgabe:
1. Im Login-Bereich des Auth-Modals einen Link "Passwort vergessen?" hinzufügen.
2. Klick öffnet einen neuen Modal-View (oder erweitert den bestehenden) mit
   Input-Feld für die E-Mail-Adresse und Button "Reset-Link senden".
3. Submit ruft `supabase.auth.resetPasswordForEmail(email, { redirectTo: ... })`
   auf. `redirectTo` muss auf die eigene App zeigen, sinnvollerweise
   `${window.location.origin}/?reset=1` (Query-Param, kein Hash — Hash würde
   Supabase-Redirect-Handling stören).
4. Beim App-Start in `src/js/app.js`: prüfen ob URL-Param `?reset=1` gesetzt ist
   ODER ob Supabase eine `PASSWORD_RECOVERY`-Event feuert (siehe
   `supabase.auth.onAuthStateChange`). Wenn ja: neuen Reset-Screen anzeigen mit
   zwei Passwort-Feldern und Button "Neues Passwort speichern".
5. Submit im Reset-Screen: `supabase.auth.updateUser({ password: newPassword })`.
   Bei Erfolg: URL-Param entfernen, Erfolgsmeldung, dann normal weiter zur App.
6. In `CLAUDE.md` unter "Auth" einen kurzen Hinweis auf den neuen Flow und dass
   das Reset-Mail-Template im Supabase-Dashboard auf Deutsch angepasst werden
   sollte (Anleitung: Dashboard → Authentication → Email Templates → "Reset Password").

UX-Kleinigkeiten:
- Ladezustand beim Absenden (Button disabled, Spinner)
- Klare Fehlermeldungen bei ungültiger E-Mail bzw. Supabase-Fehler
- Nach erfolgreichem "Reset-Link senden" eine Meldung "Falls diese E-Mail
  registriert ist, hast du eine Mail bekommen." — kein Leak ob User existiert.

Wichtig:
- KEINE anderen Auth-Flows anfassen (Login, Register, OAuth bleibt unberührt).
- KEINE neuen Dependencies.
- `esc()` für allen User-Input im UI (Konvention aus CLAUDE.md).
- Im Reset-Screen: Passwort-Feld hat `autocomplete="new-password"`.
- OFFLINE_MODE: der Flow ist nur online sinnvoll. Wenn `OFFLINE_MODE === true`,
  Link "Passwort vergessen?" ausblenden.

DoD: End-to-End manuell getestet: E-Mail eingeben → Reset-Mail kommt an
(Supabase Default-SMTP) → Link öffnen → neues PW eingeben → damit einloggen
funktioniert; alles committet.
```

---

## T2.2 — Feedback-Kanal einbauen

```
Wir bauen den Beta-Feedback-Kanal im MotoMatch-Projekt. Ohne niedrigschwelligen
Kanal bekommen wir kein Feedback von den 30 Bekannten — die schreiben nicht von
sich aus.

Bevor du änderst: lies `supabase/schema.sql` (Schema-Muster), `src/js/community-api.js`
(Muster für Supabase-Zugriffe), `src/js/auth.js` (für `currentUser()`), und schau
wie im Rest der App Modals gebaut werden (grep nach "openAuthModal" für ein Beispiel).

Aufgabe:
1. Schema erweitern: neue Tabelle in `supabase/schema.sql`:
   ```
   CREATE TABLE IF NOT EXISTS beta_feedback (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
     text        text NOT NULL,
     page        text,
     user_agent  text,
     created_at  timestamptz DEFAULT now()
   );
   ALTER TABLE beta_feedback ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "bf_insert_auth" ON beta_feedback FOR INSERT
     WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
   -- kein SELECT-Policy für User; ich lese es im Supabase-Dashboard
   ```
2. Neue Datei `src/js/feedback.js`:
   - Export `initFeedbackFab()` — rendert unten rechts einen Floating Action Button
     mit Icon (z. B. `💬`, Text "Feedback"). Fixed positioning, z-index hoch genug
     um über allem zu liegen.
   - Klick öffnet Modal mit Textarea (min 20 Zeichen, max 2000), optionalem
     Info-Text "Was hakt? Was fehlt? Was gefällt dir?".
   - Submit: INSERT in `beta_feedback` via Supabase. `page` = `window.location.pathname
     + window.location.hash`, `user_agent` = `navigator.userAgent`, `user_id` =
     currentUser-uid (falls eingeloggt und nicht Gast).
   - Erfolgsmeldung "Danke! Ich lese jedes Feedback."; danach Modal schließt.
   - Fehlerbehandlung: rote Meldung, Textarea-Inhalt bleibt erhalten.
3. `initFeedbackFab()` in `src/js/app.js` in `startApp()` aufrufen.
4. Styling in `src/styles/main.css` — passend zum bestehenden dunklen Design
   (siehe existierende Modal-Styles).
5. OFFLINE_MODE: FAB trotzdem rendern, Submit dann in `mm_beta_feedback_local`
   ablegen (Fallback), damit du keine Regression im Dev-Modus hast.
6. In `CLAUDE.md` einen Hinweis wie ich das Feedback im Supabase-Dashboard einsehe
   (Table Editor → beta_feedback → sort by created_at desc).

Wichtig:
- `esc()` für Anzeige, aber nicht für den DB-Insert (der geht als Parameter, nicht
  interpoliert).
- KEINE neuen Dependencies.
- Screenshot-Upload NICHT in dieser Iteration — bewusst rausgehalten, weil Storage-
  Setup + Auth komplizierter wäre. Wenn User was Visuelles zeigen will: Textform.

DoD: SQL-Migration im Supabase-Dashboard laufen lassen (Anleitung liefern);
Test-Feedback lokal + auf Live-Deploy abgegeben, erscheint in Supabase-Table;
FAB ist auf allen Screens sichtbar; committet.
```

---

## T2.3 — 3D-Modelle in Supabase Storage prüfen/abschließen

```
Wir prüfen und finalisieren die 3D-Modell-Migration von lokalem `public/models/`
nach Supabase Storage im MotoMatch-Projekt. Der letzte Commit heißt "feat: migrate
3D model URLs to Supabase Storage" — vermutlich angefangen, möglicherweise nicht
zu 100 % fertig. Ziel: Vercel-Deploy per Git-Integration funktioniert
(kein Zwang mehr für lokale `vercel` CLI).

Bevor du änderst:
- `ls public/models/` — welche GLBs liegen noch lokal?
- `grep -rn "\.glb" src/js/` — wo werden GLB-URLs im Code gebaut?
- `grep -rn "supabase.co/storage" src/js/` — was ist schon migriert?
- `git log -p 9c614f0 -- src/js/bike-detail.js | head -200` — was hat der
  Migrations-Commit geändert?

Mir das Ergebnis als Übersicht liefern:
| Bike | in code (URL-Muster) | lokal in public/models/? | im Supabase Storage? |

Erst nach meiner Freigabe weiterarbeiten.

Aufgabe (nach Freigabe):
1. Für jede noch nicht migrierte GLB: mir eine Copy-Paste-Anleitung geben, wie ich
   sie im Supabase-Dashboard hochlade (Bucket-Name, Ordner-Struktur, Public-Read-Setting).
   Ich mache das im Browser, du machst kein Upload.
2. Nach jedem Upload: die entsprechende URL in `bike-detail.js` (und ggf. `matching.js`)
   aktualisieren. Konsistentes URL-Muster verwenden — schau dir an wie es der
   Migrations-Commit gemacht hat und halte dich daran.
3. Wenn alle GLBs migriert sind: `public/models/` komplett leeren (die Files sind
   ohnehin gitignored, aber lokal Ballast).
4. `.gitignore` prüfen: `*.glb` bleibt drin (nur zur Sicherheit).
5. UI-Verifikation: für 3–4 verschiedene Bikes die Detailseite öffnen und prüfen
   dass das 3D-Modell lädt (Konsole offen, Network-Tab auf 200er checken).
   Screenshots mitschicken.
6. Wenn alles läuft: einen Testdeploy per Vercel-Git-Integration triggern (Push auf
   einen neuen Branch, Preview-URL prüfen). Wenn das Preview funktioniert →
   Vercel-Projekt-Setting: automatischen Production-Deploy bei Push auf `main`
   aktivieren (Anleitung, ich klicke).

Wichtig:
- KEINE GLBs selbst hochladen (kein Storage-Upload-Code).
- KEINE URLs raten — nur URLs verwenden die ich dir aus dem Dashboard bestätige.
- Wenn im Bike-Detail-Modul unklar ist wo die URL zusammengebaut wird:
  fragen, nicht raten. bike-detail.js hat 3265 Zeilen, lies nur was du brauchst.

DoD: `public/models/` ist leer; alle Bikes zeigen 3D-Modell live auf einem Vercel-
Preview-Deploy; `main`-Push deployt automatisch; committet als
"chore: complete GLB migration to Supabase Storage".
```

---

## T2.4 — Impressum/Datenschutz mit echten Angaben

```
Wir füllen Impressum und Datenschutzerklärung des MotoMatch-Projekts mit echten
Angaben. Beide Dateien existieren als `public/impressum.html` und
`public/datenschutz.html`, sind aber noch Muster/Dummy-Text (bitte verifizieren
per Lesen).

WICHTIGER RAHMEN: Ich brauche KEINE Rechtsberatung — nur eine strukturierte
Vorlage mit meinen echten Daten in den Standard-Bausteinen. Für echte rechtliche
Sicherheit werde ich später einen Fachanwalt / IT-Recht-Kanzlei-Muster
konsultieren. Diese Aufgabe ist die "gute Solo-Dev-Grundausstattung", nicht
mehr.

Bevor du änderst: `public/impressum.html` und `public/datenschutz.html` komplett
lesen. Was ist schon Muster, was fehlt?

Aufgabe:
1. Mich nach den nötigen Angaben fragen (in EINEM Rutsch, nicht Stück für Stück):
   - Voller Name
   - Adresse (Straße, PLZ, Ort)
   - E-Mail
   - (optional) Telefon
   - (optional) USt-ID / Steuernummer — falls du keine hast, überspringen
   - Ist die Website rein privat oder mit wirtschaftlicher Absicht (Startup-Vorbereitung
     → Ja)?
   - Verantwortlich i.S.d. §18 MStV — meistens du selbst
2. Impressum nach dem Muster §5 DDG (früher TMG) + §18 MStV aufbauen.
3. Datenschutzerklärung nach Art. 13 DSGVO. Jeder aktuell genutzte Drittdienst
   bekommt einen eigenen Absatz mit: Anbieter + Sitz + Zweck + Rechtsgrundlage
   + Speicherdauer (grob) + Widerrufsmöglichkeit + Link zur Datenschutzerklärung
   des Anbieters. Aktuell zu erwähnen:
   - Supabase (Postgres, Auth, Realtime — EU-Region ist wählbar; welche wir nutzen,
     prüfen)
   - Vercel (Hosting, US)
   - Google Maps (Karten, US — nur mit Consent)
   - OpenAI (KI-Empfehlungs-Text, US)
   - Tavily (Gebrauchtsuche, US) — falls Marketplace in Beta rein wäre; wenn per
     T1.3 versteckt: nicht erwähnen
   - Sentry (Fehler-Monitoring — welche Region, prüfen)
4. Cookie-/LocalStorage-Abschnitt: technisch notwendig vs. einwilligungspflichtig.
   (Der eigentliche Banner kommt in T2.5.)
5. Rechte des Nutzers (Auskunft, Löschung, Widerspruch, Beschwerde bei
   Aufsichtsbehörde).
6. Am Ende der Datenschutzerklärung: Kontakt Verantwortlicher (mein Name + E-Mail)
   und "Stand: [Datum]".
7. Beide Seiten aus dem Footer der Landing (T1.2) verlinken — sicherstellen dass
   das schon der Fall ist.
8. In `CLAUDE.md` unter "Rechtliches" Verweis auf diese zwei Seiten und Hinweis
   "keine anwaltlich geprüfte Fassung — bei Bedarf Muster von IT-Recht Kanzlei
   / activeMind einsetzen".

Wichtig:
- KEINE erfundenen Angaben. Wenn ich etwas nicht liefere: Platzhalter `[BITTE ERGÄNZEN]`
  mit klarer Markierung.
- KEINE Rechtsberatung im Chat — nur Textbausteine nach gängigem Muster.
- Fließtext auf Deutsch, sachlich, ohne juristisches Kauderwelsch wo vermeidbar.
- HTML soll den bestehenden Style beibehalten (schau ins Bestandsdokument).

DoD: Beide Seiten füllt und ohne `[BITTE ERGÄNZEN]`-Marker (falls ich alles geliefert
habe); Aufruf `/impressum.html` und `/datenschutz.html` auf dem Deploy funktioniert;
Links aus dem Footer erreichbar; committet.
```

---

## T2.5 — Cookie-/Consent-Banner minimal

```
Wir bauen einen minimalen Consent-Banner ins MotoMatch-Projekt. Rechtlicher
Rahmen: DSGVO / TTDSG. Ausdrücklich kein Consent-Framework wie Cookiebot —
wir bauen eine schlanke eigene Lösung, ausreichend für die Closed Beta.

Bevor du änderst: schau welche Dienste einwilligungspflichtig sein könnten:
- Sentry (Error-Tracking OHNE Session-Replay ist meistens als berechtigtes
  Interesse ok — wir sind vorsichtig und stellen es hinter Consent)
- Google Maps (setzt Cookies → einwilligungspflichtig)
- Alles Supabase / eigene localStorage-Nutzung → technisch notwendig, kein Consent

Aufgabe:
1. Neues Modul `src/js/consent.js`:
   - Export `getConsent()` — liest `mm_consent_v1` aus localStorage,
     Rückgabe `{ analytics: false, maps: false }` per Default (bei fehlendem Eintrag).
   - Export `initConsentBanner()` — rendert am unteren Bildschirmrand einen
     schmalen Banner mit kurzer Info-Text und drei Buttons:
     - "Nur essenziell" → Consent {analytics:false, maps:false}, Banner weg
     - "Alle akzeptieren" → Consent {analytics:true, maps:true}, Banner weg
     - "Details" → Link auf `/datenschutz.html`
   - Nach Wahl: Event `mm:consent-changed` feuern.
2. In `src/js/monitoring.js` (aus T0.2): `initMonitoring()` nur dann Sentry laden
   wenn `getConsent().analytics === true`. Wenn Consent später erteilt wird
   (Event), Sentry nachladen.
3. Google Maps ähnlich: die Maps-Initialisierung in `src/js/dealers.js` erst
   ausführen wenn `getConsent().maps === true`. Wenn nicht: einen Platzhalter
   "Karte anzeigen (Cookies aktivieren)" mit Button, der Consent nachträglich
   erteilt.
4. `initConsentBanner()` in `src/js/app.js` VOR `initMonitoring()` aufrufen.
5. Styling in `src/styles/main.css` — schmal, dezent, dunkel, unten fixiert.
6. In `CLAUDE.md` unter "Consent" kurz dokumentieren wie der Flow läuft und
   wie ich neue einwilligungspflichtige Dienste an das Muster anschließe.

Wichtig:
- KEIN Consent-Framework als Dependency.
- KEIN Dark-Pattern (der "Ablehnen"-Button muss gleichwertig sichtbar sein).
- Consent gilt bis zum Widerruf — wir zeigen den Banner nicht bei jedem Besuch
  neu, sondern erst wieder wenn `mm_consent_v1` gelöscht wird ODER wir das Schema
  in `_v2` erhöhen.
- KEINE Analytics-Tools einbauen — die kommen erst später.

DoD: Erster Besuch (Inkognito) → Banner sichtbar; "Nur essenziell" → Sentry und
Google Maps laden nicht (Network-Tab prüfen); "Alle akzeptieren" → beide laden;
Consent überlebt Reload; committet.
```

---

## T2.6 — Marketplace-Suchlinks im Bike-Detail (Mini)

```
Kleiner UX-Loop-Schluss im MotoMatch-Projekt. Aktuell endet der Match-Flow bei
"Händler finden". Für den, der ein gebrauchtes Bike sucht, fehlt der offensichtliche
Sprung zu Kleinanzeigen/mobile.de. Das ist mit statischen Suchlinks 1 Stunde Arbeit
und schließt einen sichtbaren Loop.

Kein echter Aggregator, keine Tavily-Suche, keine API — nur ehrliche externe
Suchlinks pro Bike.

Bevor du änderst: `src/js/bike-detail.js` (nur den Bereich lesen, wo aktuell
"Händler finden" / Nächster-Schritt-Card gerendert wird).

Aufgabe:
1. In der Nächster-Schritt-Card unterhalb "Bereit für dein Bike?" eine zweite
   Zeile ergänzen: "Gebraucht suchen:" mit drei kleinen Buttons:
   - "Kleinanzeigen" → öffnet neuen Tab mit URL wie
     `https://www.kleinanzeigen.de/s-motorraeder-roller/${encodeURIComponent(bikeName)}/k0c305`
   - "mobile.de" → `https://suchen.mobile.de/fahrzeuge/search.html?ms=&s=Motorbike&fr=&sfmr=false&isSearchRequest=true&makeModelVariantExact=true&fnai=prem&keyword=${encodeURIComponent(bikeName)}`
   - "eBay" → `https://www.ebay.de/sch/i.html?_from=R40&_trksid=p2334524.m570.l1313&_nkw=${encodeURIComponent(bikeName)}&_sacat=6024`
2. Externe Links immer mit `target="_blank" rel="noopener noreferrer"`.
3. Kein Tracking, keine UTM-Parameter — reine Suche.
4. UI-Verifikation: alle drei Links öffnen zur richtigen Suche für 2–3
   verschiedene Bikes.

Wichtig:
- KEINE Marketplace-Feature-Flag anfassen (T1.3 hat den Marketplace ausgeblendet —
  das bleibt). Das hier sind nur externe Suchlinks, kein internes Feature.
- KEIN Screenshot, kein Preis-Scrape — nur klare Textlinks.
- URLs mit `encodeURIComponent` — nicht selbst escapen.
- Falls das URL-Schema von Kleinanzeigen/mobile.de sich als kaputt herausstellt,
  fallback: nur "auf Kleinanzeigen suchen" mit Basis-Query-URL.

DoD: Drei Buttons unter der Nächster-Schritt-Card, öffnen die jeweilige Suche im
neuen Tab; getestet für 2–3 Bikes; commit "feat(bike-detail): external
marketplace search links".
```

---

## T3.1 — Golden-Path-Durchlauf

```
Wir machen einen strukturierten Selbst-Test aller Kern-User-Flows im
MotoMatch-Projekt vor dem Öffnen für Beta-Tester. Ziel: ein Dokument
`docs/BETA-SMOKETEST.md` mit "✅ funktioniert / ⚠️ Bug X" pro Schritt.

Vorgehen:
1. Dev-Server über die Browser-Preview starten (`.claude/launch.json`, "moto-match").
2. Inkognito-Fenster / frischer Session-Storage.
3. Die folgenden Flows der Reihe nach durchgehen. Für JEDEN Schritt:
   - Screenshot machen (in scratchpad oder docs/screenshots/ ablegen)
   - Konsolen-Errors und -Warnings notieren
   - Netzwerk-Fehler notieren
   - UX-Auffälligkeiten (langsam, kaputte Buttons, Text abgeschnitten) notieren

Flows:
A) Registrierung:
   - Landing-Page laden
   - Auth-Modal öffnen
   - Registrieren mit einer Test-E-Mail (Mailinator o.ä.)
   - Bestätigungsmail prüfen (falls Supabase auf "confirm email" steht)
   - Einloggen mit den neuen Credentials
B) Quiz-Flow:
   - Zum Quiz navigieren
   - Alle Fragen beantworten
   - Ergebnis + KI-Begründung erscheint
C) Bike-Detail:
   - Aus dem Match-Ergebnis auf das Bike klicken
   - Detailseite lädt (inkl. 3D-Modell)
   - Alle Tabs durchklicken
   - Bike in Garage speichern
D) Garage:
   - Garage-Seite öffnen
   - Gespeichertes Bike sichtbar
   - Wartungseintrag hinzufügen
E) Karte:
   - Karte öffnen (Consent akzeptieren)
   - Marker sichtbar
   - Popup klickbar
F) Community:
   - Community-Screen öffnen
   - Öffentliche Gruppe finden + beitreten
   - In Kanal Nachricht schreiben (Realtime-Test: zweites Fenster als anderer
     User oder mit dir selbst)
   - Freund adden (via Username-Suche)
   - DM schreiben
G) Feedback:
   - FAB klicken
   - Feedback abschicken
   - Prüfen ob es in Supabase-Table landet
H) Passwort-Reset:
   - Ausloggen
   - "Passwort vergessen" klicken
   - Mail kommt an
   - Neues PW setzen
   - Damit einloggen
I) Ausrüstung:
   - Kurz durchklicken, Favorit setzen
J) Landing-Footer:
   - Impressum + Datenschutz aufrufen — beide erreichbar, Inhalt korrekt

Wichtig:
- Bei jedem Bug: NICHT sofort fixen. Nur dokumentieren. Fixes machen wir in T3.2
  in einer separaten Session, damit wir nicht Bugs beim Fixen einführen.
- Screenshots in `docs/screenshots/T3.1-<flow>-<step>.png` benennen.
- Am Ende: Zusammenfassung "X Flows durch, Y Bugs gefunden, Z davon blockierend
  (kann Beta nicht starten) / non-blocking".

DoD: `docs/BETA-SMOKETEST.md` existiert mit strukturierter Auflistung; alle
Screenshots im `docs/screenshots/` abgelegt; Zusammenfassung als letzter
Abschnitt.
```

---

## T3.2 — Bug-Fix-Runde

```
Wir arbeiten die in T3.1 (`docs/BETA-SMOKETEST.md`) gefundenen Bugs ab.

Vor dem Start:
1. `docs/BETA-SMOKETEST.md` lesen — mir eine priorisierte Liste vorschlagen:
   - Priorität 1: blockiert Beta-Launch (Registrierung/Login kaputt, kein
     Match-Ergebnis, Community-Chat schickt nicht)
   - Priorität 2: sichtbar, aber Beta-fähig (UX-Ecken, Text-Kleinigkeiten)
   - Priorität 3: nice-to-have
2. Meine Freigabe abwarten in welcher Reihenfolge du fixt.

Regeln für die Fix-Runde:
- Ein Fix = ein Commit. Nicht bündeln.
- Vor jedem Fix: Ursache benennen (echter Root-Cause, nicht Symptom).
- Nach jedem Fix: den betroffenen Flow aus T3.1 erneut durchspielen und Screenshot
  machen. Alten "⚠️" im BETA-SMOKETEST.md nach "✅" ändern.
- Wenn du beim Fixen einen NEUEN Bug siehst: nicht mitfixen, ins Dokument
  eintragen und erst mit mir absprechen.
- KEINE Refactorings während der Fix-Runde. Kleinste-mögliche Änderung.
- Bei Unsicherheit fragen, nicht ausprobieren-und-hoffen.

Ende der Session:
- Zusammenfassung: welche Bugs sind fix, welche stehen noch, welche sind non-blocking
  für Beta.
- Wenn alle P1-Bugs weg: Beta-Launch aus technischer Sicht möglich.

DoD: alle P1-Bugs gefixt und im SMOKETEST als ✅; jeder Fix hat einen eigenen Commit
mit `fix(...):`-Prefix; kein neuer P1-Bug übrig.
```

---

## T3.3 — Vercel-Domain + Auth-Redirect-URLs

```
Wir richten die endgültige Deploy-Domain für die MotoMatch-Beta ein und
konfigurieren alle Dienste konsistent.

Bevor du änderst: `vercel.json`, `.vercel/project.json` (falls im Repo), und
alle Stellen wo `window.location.origin` bzw. hardcodierte Domains referenziert
werden — `grep -rn "vercel.app\|moto-match" src/`.

Vorgehen (viele Schritte sind im Browser, nicht im Code):
1. Frag mich zuerst: nutze ich `moto-matchwbapp.vercel.app` weiter oder habe ich
   eine eigene Domain (welche)?
2. Wenn eigene Domain: Schritt-für-Schritt-Anleitung wie ich sie in Vercel
   verbinde (DNS-Records: CNAME oder A, welche Werte).
3. Danach für JEDEN dieser Dienste eine Klick-Anleitung liefern, was ich wo
   ergänzen muss:
   - Google Cloud Console → API-Key-Restrictions → neue Domain in Allowlist
   - Supabase Dashboard → Authentication → URL Configuration → Site URL +
     Redirect URLs (neue Domain und Vercel-Preview-Pattern)
   - Sentry → Project Settings → Client Keys → allowed domains
   - `.env` (Vercel-Env-Vars) → `ALLOWED_ORIGINS` um neue Domain erweitern
4. Prüfen ob im Code irgendwo eine Domain hardcoded ist (soll nicht sein, wenn ja
   auf `window.location.origin` umstellen).
5. Kompletten End-to-End-Test auf der neuen Domain: Registrierung → Passwort-Reset
   → Google Maps lädt → Sentry-Test-Error erscheint. Screenshots.

Wichtig:
- KEINE Änderungen an DNS-Records durch dich (mach ich beim Registrar).
- Wenn ich auf der `.vercel.app`-Subdomain bleibe: nur die Auth-Redirect-URLs
  und ALLOWED_ORIGINS-Konsistenz prüfen, keine Domain-Neuanbindung.

DoD: Die Zieldomain liefert die App aus; alle vier oben genannten Dienste kennen
sie; End-to-End-Test grün; falls Config-Änderungen im Code nötig waren, committet.
```

---

## T3.4 — Beta-Onboarding + Einladungstext

```
Wir bauen ein knappes Beta-Onboarding-Overlay und formulieren den
Einladungstext für die 10–30 Bekannten.

Bevor du änderst: `src/js/onboarding.js` lesen (es gibt schon ein kleines
Onboarding — nur Tab-Hint, nicht mehr; wir bauen ein separates Beta-Onboarding).
`src/js/auth.js` — wo passiert der SIGNED_IN-Handler?

Aufgabe:
1. Neues Modul `src/js/beta-onboarding.js`:
   - Export `maybeShowBetaOnboarding()` — prüft `mm_beta_onboarded_v1` in
     localStorage. Wenn schon true: nichts. Sonst: Overlay-Modal zeigen.
   - 3 Slides mit Weiter-Button, letzter Slide hat "Los geht's":
     Slide 1: Willkommen — MotoMatch ist noch Beta, gib mir Feedback per FAB
              unten rechts. Kurz erklären was die App macht.
     Slide 2: So findest du dein Bike: Quiz → Match → Details → in Garage speichern.
     Slide 3: Community: Freund adden, in Gruppen quatschen. Bugs? Nutze den
              Feedback-Button.
   - Bei "Los geht's": `mm_beta_onboarded_v1 = true`, Overlay weg.
2. `maybeShowBetaOnboarding()` in `auth.js` im SIGNED_IN-Pfad aufrufen — nach
   erfolgreichem Login/Register, nicht bei Gast-Login.
3. Kleines Icon "Beta-Tour erneut zeigen" im Account-Screen, das
   `mm_beta_onboarded_v1` löscht und Onboarding neu startet. Klein und dezent.
4. Styling im bestehenden dunklen Look.
5. Einladungstext als Datei `docs/BETA-EINLADUNG.md` mit zwei Varianten:
   a) Kurz (WhatsApp/Signal, ~3 Zeilen + Link)
   b) Etwas länger (E-Mail, mit Ablauf, was ich vom Tester wissen will,
      Feedback-Kanal, ungefährer Zeitaufwand für Test)
   Beide auf Deutsch, freundlich, ehrlich ("es ist noch Beta, kann bugen",
   "bitte gib mir 10 min und melde was komisch war").

Wichtig:
- Onboarding NICHT dauerhaft überall im UI. Genau einmal, dann weg.
- `esc()` nicht nötig weil kein User-Input.
- KEINE Animation, KEIN Lottie. Einfache Slides mit Weiter-Button.
- Einladungstext KEIN Marketing-Sprech, kein Emoji-Feuerwerk. Ehrlich.

DoD: Frischer User sieht Onboarding einmal, danach nie wieder; Re-Trigger im
Account funktioniert; `docs/BETA-EINLADUNG.md` existiert mit beiden Varianten;
committet.
```

---

## T3.5 — Staffel-Launch an 3 dann 30

```
Wir starten die Beta gestaffelt. Diese "Aufgabe" ist überwiegend Prozess, nicht
Code — aber ein paar Vorbereitungen macht Claude Code trotzdem.

Aufgabe (Code + Prep):
1. In Supabase-Table `beta_feedback` (aus T2.2) prüfen dass alle bisherigen
   Test-Einträge weg sind. Anleitung liefern wie ich sie im Dashboard lösche.
2. Ein kleines Monitoring-Dashboard-Query vorbereiten — als SQL in
   `docs/BETA-MONITORING.md`:
   - Anzahl Registrierungen letzte 24 h
   - Anzahl aktive User (letzte 7 Tage)
   - Anzahl gesendeter Nachrichten letzte 24 h
   - Anzahl Feedback-Einträge
   - Fehler-Zusammenfassung Sentry (nur beschreiben, das mache ich im
     Sentry-Dashboard)
3. Ein simples "kill-switch"-Muster: eine Konstante `SITE_STATUS = 'live' |
   'maintenance'` in `src/js/config.js` (aus T1.3 erweitern). Wenn `maintenance`:
   Beim App-Start eine Wartungsseite statt Landing. So kann ich bei einem
   kritischen Bug in 30 Sekunden dichtmachen.

Ablauf-Vorschlag den ich befolgen soll (nicht Code, nur Text):
1. Woche A: 2–3 Bekannte einladen (aus BETA-EINLADUNG.md Kurz-Variante).
2. Aktiv Feedback einholen (nachfragen ist ok).
3. Bugs fixen, Sentry checken.
4. Wenn nach 5–7 Tagen keine kritischen Bugs mehr: an die restlichen 25–27
   ausrollen.

Wichtig:
- KEINE echten E-Mails/DMs verschicken durch Claude. Ich mache das selbst.
- Beim Kill-Switch: das darf keine Nebeneffekte haben (kein Datenlöschen,
  nur Rendering blocken).

DoD: Feedback-Table leer für Start; Monitoring-SQLs in `docs/BETA-MONITORING.md`;
Kill-Switch implementiert und getestet (`SITE_STATUS = 'maintenance'` → Wartungsseite);
committet.
```

---

## T3.6 — Mobile-Ansicht Grund-Check

```
Vor dem Beta-Launch prüfen wir, ob die MotoMatch-App auf Mobilgeräten überhaupt
benutzbar ist. Nicht polieren — nur Grund-Check und die schlimmsten Blocker fixen.
Vollständige Mobile-Optimierung ist Post-Launch.

Vorgehen:
1. Dev-Server über Browser-Preview starten. Viewport auf "mobile" umschalten
   (375×812, iPhone-Format).
2. Alle Kern-Screens durchgehen und prüfen:
   - Landing (Hero, Sektionen, Footer)
   - Auth-Modal
   - Quiz (kann man Fragen beantworten?)
   - Bike-Detail (3D-Viewer, Tabs)
   - Community (Sidebar, Kanäle, DM)
   - Karte
   - Ausrüstung
   - Account/Profil (Chronik, Meine Bikes, Fahrten, Vergleich)
   - Feedback-FAB (aus T2.2)
3. Für jeden Screen dokumentieren in `docs/BETA-MOBILE-CHECK.md`:
   - ✅ benutzbar
   - ⚠️ suboptimal, aber machbar
   - ❌ kaputt / unbenutzbar
   - Screenshot mitschicken
4. Bewusster Test auf echtem Handy: dev-server-URL im lokalen WLAN, Handy
   drauf zugreifen. (Anleitung: Netzwerk-IP + Port.)

Fix-Regel:
- ✅ / ⚠️ → nichts machen. Post-Launch.
- ❌ → hier und jetzt fixen, aber nur das eine kaputte Ding, kein Refactor.
- Typische Blocker: Community-Sidebar überdeckt Content, Modal schließt nicht,
  Karte scrollt Seite mit, Text abgeschnitten, Button zu klein zum Tippen.

Wichtig:
- KEINE Mobile-Redesigns.
- KEINE neue Media-Queries für "sähe besser aus". Nur ❌-Fixes.
- Nach jedem ❌-Fix: Screen erneut im Mobile-Viewport testen, Screenshot updaten.

DoD: `docs/BETA-MOBILE-CHECK.md` steht mit Status pro Screen; alle ❌ sind ✅ oder
⚠️; commit "fix(mobile): unblock critical mobile blockers".
```

---

## Prompts-Nutzungshinweise (für dich, nicht für Claude)

- **Reihenfolge zählt.** T0.1 zwingend zuerst. T0.2/T0.3 auch früh — die schützen
  vor Kostenfallen. Danach ist die Reihenfolge flexibler, aber nicht chaotisch:
  die T1-Aufgaben sind billige Aufräum-Wins die Momentum geben.
- **Ein Prompt = eine Session.** Wenn Claude in der Mitte fragt "sollen wir X
  auch noch machen?", sag Nein. Neue Aufgabe → neue Session.
- **Prüf-Reflex:** Nach jedem Session-Ende: `git status`, `git log --oneline -5`,
  Deploy testen. Erst wenn das sauber ist, den nächsten Prompt starten.
- **Wenn Claude eine Aufgabe splittet:** ok, aber mit deinem Sign-off. Nicht
  einfach machen lassen.
- **Wenn ein Prompt hier zu allgemein ist:** ergänze am Ende einen konkreten
  Kontext-Absatz ("Zusätzlicher Kontext: gestern habe ich X gemacht, bin heute
  an Y unsicher").
