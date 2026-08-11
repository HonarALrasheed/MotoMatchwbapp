# MotoMatch — Post-Launch-Prompts (V2+)

> **⚠️ Diese Prompts sind bewusst NACH dem Beta-Launch angesetzt.**
>
> Wenn du sie vor dem Launch anfängst, launchst du nicht. Jeder Punkt hier war in
> [STATUS.md](STATUS.md) und [ROADMAP-BETA.md](ROADMAP-BETA.md) ausdrücklich aus
> dem Beta-Scope ausgeschlossen. Das war kein Übersehen — das war eine bewusste
> Entscheidung, damit die Beta in 4 Wochen live geht statt in 6 Monaten.
>
> **Regel:** ein Post-Launch-Prompt darf frühestens angefasst werden, wenn
> (a) die Beta mindestens 3 Wochen live war UND
> (b) das Beta-Feedback ausdrücklich diesen Ausbau nahelegt.
>
> Ohne diese zwei Bedingungen ist es Scope-Creep, nicht Fortschritt.
>
> **Priorisierung nach Retention-Hebel** (nicht nach persönlicher Vorliebe):
> 1. Ride-Feed (P4) — der eine Baustein, der aus Werkzeugkasten → tägliche App macht
> 2. Push-Notifications als PWA (P5) — Rückholmechanik
> 3. Community-Preview ohne Login (P10) — senkt Akquise-Reibung
> 4. Alles andere: nach Nutzerbelegen entscheiden

---

## P1 — „Mit Fahrer"-Option für alle Bikes

```
Wir erweitern das MotoMatch-Projekt um eine "Mit Fahrer"-Ansicht für die 3D-Bike-
Ansicht. Aktuell existiert der Toggle "Motorrad / Mit Fahrer" im Bike-Detail-Screen
schon in der UI, aber wechselt vermutlich nur die Perspektive, nicht das Modell.

Bevor du änderst: `src/js/bike-detail.js` (Bereich um den "Motorrad/Mit Fahrer"-
Toggle lesen), `public/models/`-Struktur prüfen, wie GLBs benannt sind.

Vor der Aufgabe eine Grundsatzfrage klären — mich fragen und Antwort abwarten:
Woher kommen die 3D-Fahrer-Modelle?
Option A: separates Fahrer-GLB pro Bike (aufwändig, jedes Modell einzeln)
Option B: ein generisches Fahrer-Modell, das auf jedes Bike gesetzt wird
         (technisch machbar mit three.js, Sitzposition muss pro Bike konfiguriert
          werden)
Option C: fertiges gerendertes 2D-Bild "mit Fahrer" pro Bike, kein 3D
         (billigste, hässlichste Lösung)
Empfehlung: B — ein Fahrer-Modell + pro Bike ein kleines Metadaten-Objekt mit
Sitzposition (x, y, z, Rotation). So skaliert es.

Nach meiner Wahl:
1. Wenn B: ein generisches Fahrer-Modell in Supabase Storage hochladen (lasse mich
   das machen; du liefer nur die Anleitung was ich brauche — Blender-Export-Settings,
   Empfehlung wie das Modell aussehen soll).
2. Pro Bike in `matching.js` bzw. `bike-detail.js` ein `riderTransform`-Objekt
   ergänzen mit Position + Rotation. Default: leere Konstante, wird pro Bike gefüllt.
3. Im Bike-Detail bei Toggle "Mit Fahrer": Fahrer-Modell laden, positionieren,
   parenten am Bike-Root oder an einer definierten "Sitzbank"-Bone (falls im
   Bike-GLB annotiert). Andernfalls per Transform manuell platzieren.
4. Die ersten 5 Bikes einzeln kalibrieren, danach für den Rest die Position aus
   Bike-Type ("Cruiser", "Sportbike", "Naked") als Preset ableiten.

Wichtig:
- KEINE 40 Fahrer-Modelle. Ein einziges Modell reicht.
- Toggle darf keine sichtbare Ladezeit haben (Modell einmal cachen).
- Wenn Position offensichtlich falsch aussieht ("Fahrer schwebt in der Luft"):
  mir Screenshot schicken, ich justiere die Werte.

DoD: Toggle wechselt für alle Bikes zwischen "leerem" und "besetztem" Modell;
mindestens 5 Bikes visuell überzeugend kalibriert; commit "feat(bike-detail):
rider overlay on 3D view".
```

---

## P2 — Voice/Talks (WebRTC über LiveKit)

```
Wir aktivieren Voice-Talks in der MotoMatch-Community. Aktuell existiert
`src/js/voice.js` als 468-Zeilen-Skeleton ohne echtes WebRTC-Signaling. Wir bauen
das nicht selbst — wir nutzen LiveKit (Free-Tier: 100 gleichzeitige Nutzer).

Voraussetzung, bitte vorab prüfen und mir bestätigen:
- LiveKit-Konto existiert
- API-Key + Secret liegen in `.env.local` als `LIVEKIT_API_KEY` und `LIVEKIT_SECRET`
- URL des LiveKit-Servers in `VITE_LIVEKIT_URL`
Wenn eines fehlt: mir sagen, ich mache die Account-Anlage im Dashboard.

Bevor du änderst: `src/js/voice.js` komplett lesen, `src/js/community.js` (wo
Voice-Kanäle gerendert werden).

Aufgabe:
1. `livekit-client` als Dependency hinzufügen (npm install).
2. Neue Serverless-Function `api/livekit-token.js` — erzeugt für einen
   eingeloggten User (Auth via Supabase-Token im Request-Header) ein LiveKit-
   Access-Token für einen bestimmten Raum. Nur Kanal-Mitglieder dürfen Token
   bekommen.
3. `voice.js` entkernen: alle Skeleton-Funktionen entfernen, ersetzen durch:
   - `joinVoiceChannel(channelId)` → Token holen, `Room.connect()`, Mic aktivieren
   - `leaveVoiceChannel()` → Room disconnect, Cleanup
   - `toggleMute()`, `toggleDeafen()`
   - Event-Listener für "participant joined/left/muted"
4. In `community.js` die Voice-Kanal-Buttons an die neuen Funktionen anschließen.
   UI-Status: wer ist im Raum, wer spricht (LiveKit hat active-speakers-events).
5. Feature-Flag: `BETA_FLAGS.voice` auf `true` setzen (in `src/js/config.js`).
6. In `CLAUDE.md` unter "Community" einen kurzen Hinweis auf LiveKit.

Wichtig:
- KEIN eigenes Signaling-Protokoll bauen.
- Server-Token-Function: MUSS Supabase-Auth-Header verifizieren, sonst kann jeder
  jedem Raum beitreten.
- Rate-Limit auf Token-Erzeugung (10/min pro User).
- Mobile: nur testen wenn LiveKit auf iOS-Safari läuft (offiziell ja).

DoD: Zwei Test-User können in einem Voice-Kanal sprechen; Mic-Mute-Toggle funktioniert;
Rejoin nach Verbindungsverlust klappt; commit "feat(community): livekit voice channels".
```

---

## P3 — Marketplace live schalten (Gebraucht-Aggregator)

```
Wir aktivieren den bestehenden Marketplace im MotoMatch-Projekt. Der Code liegt
schon in `src/js/marketplace.js` + `api/search-places.js` (Tavily). Wir haben ihn
für die Beta hinter `BETA_FLAGS.marketplace` versteckt — jetzt wieder rein.

Bevor du änderst: `src/js/marketplace.js`, `api/search-places.js`, wo im UI
`marketplace` referenziert wird (grep).

Aufgabe:
1. `BETA_FLAGS.marketplace = true` in `src/js/config.js`.
2. Rate-Limit auf `api/search-places.js` prüfen (T0.3 hat das eingebaut) — bei
   Marketplace-Traffic muss das Limit strenger sein: 20/h pro User, nicht per IP.
   Wenn nicht per-User: umbauen (Supabase-Token im Header prüfen, User-ID
   extrahieren, Rate-Limit gegen User-ID).
3. Caching einbauen: jede Bike-Suche 24 h in Supabase-Tabelle
   `marketplace_cache (bike_slug, results_json, fetched_at)` speichern. Bei
   erneuter Anfrage innerhalb 24 h: aus Cache. Reduziert Tavily-Kosten massiv.
4. UI: bei Empty-Ergebnis eine ehrliche Meldung ("Aktuell keine passenden Angebote
   gefunden — schau bei Kleinanzeigen/mobile.de direkt vorbei", mit Links aus T2.6).
5. Hinweis-Zeile in der Marketplace-UI: "Angebote von externen Quellen, kein direkter
   Bezug zu MotoMatch. Prüft bitte selbst vor Kauf."

Wichtig:
- Ohne Rate-Limit-Umbau kein Deploy — sonst Kostenexplosion durch einen einzigen
  aggressiven User.
- Caching in Supabase, nicht in-memory (Serverless-Cold-Start).
- Kein Affiliate-Link ohne rechtliche Prüfung (das ist eigenes Post-Post-Launch-Thema).

DoD: Marketplace-Feature sichtbar; Suche funktioniert; Cache greift beim zweiten
Aufruf (Supabase-Table gefüllt); Rate-Limit greift; commit "feat(marketplace):
enable with caching and per-user rate limit".
```

---

## P4 — Ride-Feed (der eine Baustein, der aus Werkzeug → tägliche App macht)

```
Das ist DER Retention-Baustein. Wir machen aus dem Solo-Fahrten-Journal einen
sozialen Feed — der eine Schritt, der MotoMatch zu einer täglichen App macht.
Referenz-Vorbild: Strava-Feed.

Bevor du änderst:
- `src/js/account.js` (Fahrten-Journal-Modul finden)
- `supabase/schema.sql` (aktuelle Tabellen sehen)
- `src/js/community.js` (Community-Struktur verstehen)

Aufgabe in vier Teilen — jede Teilaufgabe = eine eigene Session. Nicht
alles zusammen. Ich sage dir wann.

TEIL 1 — Schema + Migration:
1. Neue Supabase-Tabellen:
   - `rides`: id, user_id, title, date, km, hours, weather, text, bike_id (nullable),
     visibility ('public'|'friends'|'private'), created_at
   - `ride_photos`: id, ride_id, storage_path, position
   - `ride_likes`: id, ride_id, user_id, unique (ride_id, user_id)
   - `ride_comments`: id, ride_id, user_id, text, created_at
2. RLS: Rides read = public/friends/self je nach visibility; write = own only;
   likes/comments = authenticated only.
3. Migrations-Skript für bestehende localStorage-`mm_rides_v1`-Einträge: beim
   ersten Login des Users automatisch in Supabase importieren (visibility default
   'private'), lokale Kopie behalten als Backup.

TEIL 2 — Backend-API in `src/js/rides-api.js`:
- `createRide(data, photos[])` — INSERT + Storage-Upload
- `updateRide(id, patch)`, `deleteRide(id)`
- `getMyRides()`, `getFriendsFeed(limit, before)` — pagination
- `getPublicFeed(limit, before)` — feed algorithm: recent + friend-boost
- `likeRide(id)`, `unlikeRide(id)`, `commentOnRide(id, text)`
- Realtime-Subscribe auf `ride_likes` + `ride_comments` für aktive Feed-Views

TEIL 3 — UI in Account/Fahrten-Screen:
- Bestehendes Journal-Formular erweitern: Sichtbarkeits-Wahl (public/friends/private),
  Fotos hochladen, Bike auswählen
- Neuer Feed-Screen: chronologische Liste der Freunde-Rides mit Foto, Karte
  (später), Titel, Kommentaren, Like-Button

TEIL 4 — Community-Integration:
- Neue Community-Kategorie "Feed" oben im Sidebar (vor "Freunde")
- Push-Notifications an Freunde bei neuem Public-Ride (wenn P5 fertig ist)

Wichtig für ALLE Teile:
- KEINE GPX-Tracks in dieser Iteration (das ist P4.5 später).
- KEINE Karten-Anzeige der Route (auch später).
- Feed-Algorithmus in P4: chronologisch reicht. Kein ML.
- Storage-Quota im Supabase Free-Tier: 1 GB. Bei mehreren hundert Nutzern eng.
  Foto-Upload → clientseitig auf max. 1600px Kantenlänge komprimieren.
- Jede Teilaufgabe endet mit eigenem Commit.

DoD (nach allen 4 Teilen): Ich erstelle eine Fahrt mit Foto, mein Freund sieht sie
im Feed, kann liken und kommentieren, ich bekomme Like-Benachrichtigung (in-app,
Push kommt separat mit P5); alle 4 Teile committet.
```

---

## P5 — Push-Notifications als PWA

```
Wir machen MotoMatch installierbar und pushfähig. Kein native App-Store — reines
PWA-Web-Push. Kompatibilität: Chrome (Desktop+Android), Edge, Firefox, Safari 16.4+
(iOS: nur wenn User die App zum Homescreen hinzugefügt hat).

Bevor du änderst: `index.html`, `public/`, `vite.config.js`.

Aufgabe in drei Teilen:

TEIL 1 — PWA-Manifest + Service Worker:
1. `public/manifest.webmanifest` mit App-Name, Icons (192/512), Farben, Startseite.
2. `public/service-worker.js` — mit Vite-Plugin `vite-plugin-pwa` (das ist eine
   erlaubte neue Dependency, weil es sonst massive Arbeit wäre). Standard-Config
   mit Precache und Runtime-Cache für Bilder.
3. Icons erzeugen (mir Anleitung wie ich sie aus dem bestehenden Favicon in
   die zwei Größen konvertiere).
4. `index.html`: Link auf Manifest, Meta-Tags für iOS-Homescreen.
5. Prüfen mit Lighthouse/DevTools → PWA-Score sollte ≥ 90 sein.

TEIL 2 — Push-Registration + Backend:
1. Web-Push-Keys generieren (`web-push generate-vapid-keys`), `VITE_VAPID_PUBLIC_KEY`
   und `VAPID_PRIVATE_KEY` in Env.
2. Neue Supabase-Tabelle `push_subscriptions (user_id, subscription_json,
   user_agent, created_at, revoked_at)`.
3. Client: User-Consent für Push (nur auf expliziten Klick, kein Auto-Prompt beim
   Seitenaufruf), Subscription registrieren, an Supabase senden.
4. Serverless-Function `api/send-push.js` — nimmt user_id + notification-payload,
   holt subscription, sendet via `web-push`-Library. Revoked-410-Response →
   subscription in DB als `revoked_at` markieren.

TEIL 3 — Push-Trigger:
- Neue Freundschaftsanfrage → Push an Empfänger
- Neue DM → Push an Empfänger (nur wenn App nicht fokussiert ist, sonst nervig)
- Neuer Ride im Feed (aus P4) → Push an Follower (wenn User es aktiviert hat)
- Neuer Event in beigetretener Gruppe → Push an Mitglieder
- User-Setting im Profil: pro Trigger ein Toggle

Wichtig:
- KEIN auto-Prompt für Push beim Seitenaufruf. Immer nur nach Klick auf explizitem
  Button ("Benachrichtigungen aktivieren").
- Payload-Größe max 4 KB — Text kurz halten.
- Icon in Push-Payload angeben.
- iOS-Safari: NUR wenn PWA installiert ist. UI-Hinweis dazu ("Für Push: MotoMatch
  zum Homescreen hinzufügen").

DoD: App ist installierbar (Chrome zeigt Install-Prompt); Push kommt für Test-DM
an Handy an; Settings-Toggles im Profil funktionieren; commit "feat: PWA with
web push notifications".
```

---

## P6 — Native App (Capacitor-Wrap)

```
Wir verpacken die MotoMatch-PWA als native iOS/Android-App über Capacitor. Grund:
App-Store-Präsenz, bessere Push-Notifications auf iOS, natives Kamera-Zugriff für
Ride-Fotos.

Voraussetzungen:
- P5 (PWA) MUSS fertig sein
- Apple Developer Account (99 $/Jahr) — deine Entscheidung ob du das jetzt willst
- Google Play Console (25 $ einmalig)
- macOS mit Xcode für iOS-Build (du hast eins)

Bevor du änderst: `package.json`, `vite.config.js`.

Aufgabe:
1. Capacitor initialisieren (`@capacitor/core`, `@capacitor/cli`,
   `@capacitor/ios`, `@capacitor/android`). App-ID: `com.motomatch.app`.
2. Build-Output (`dist/`) als Web-Asset für Capacitor konfigurieren.
3. iOS-Projekt öffnen (`npx cap open ios`), in Xcode:
   - App-Icons und Splash-Screen setzen (Assets-Ordner)
   - Bundle Identifier + Signing konfigurieren
   - Info.plist: Kamera-Berechtigung, Standort-Berechtigung, Push-Notification-Capability
4. Native Plugins hinzufügen (nur was wir brauchen):
   - `@capacitor/push-notifications` (ersetzt Web-Push auf iOS)
   - `@capacitor/camera` (Ride-Fotos)
   - `@capacitor/geolocation` (Karte, GPX später)
5. Code-Weichen: wenn `Capacitor.isNativePlatform() === true`, native APIs statt
   Web-APIs nutzen. Ein neues Modul `src/js/platform.js` als Wrapper.
6. Android: parallel `npx cap open android`, Android-Studio-Setup analog.
7. Deployment-Anleitungen als eigene Docs: `docs/DEPLOY-IOS.md` und
   `docs/DEPLOY-ANDROID.md`. Ich mache die Store-Submissions selbst.

Wichtig:
- KEINE Duplikate-Codebasis. Alles bleibt in `src/js/`, Capacitor ist nur Wrapper.
- Store-Submission ist NICHT Teil dieser Aufgabe — nur build-fähige Projekte.
- iOS-App-Store-Review kann Wochen dauern; realistisch mit einplanen.
- Test-Flight für iOS-Beta-Distribution: Anleitung in `docs/DEPLOY-IOS.md`.

DoD: `npx cap sync` läuft, App-Icon in Xcode-Preview korrekt, App startet im
iOS-Simulator, Push kommt an, Kamera funktioniert; analog Android; committet.
```

---

## P7 — OAuth Google/Apple polish

```
Wir aktivieren und polieren OAuth-Login für Google und Apple im MotoMatch-Projekt.
Der Frontend-Skeleton existiert schon in `src/js/auth.js` (renderGoogleButton,
loginWithApple), aber ist vermutlich nicht durchkonfiguriert.

Bevor du änderst: `src/js/auth.js` (OAuth-Bereich), Supabase-Dashboard-Config.

Aufgabe:
1. Konfiguration prüfen und mir Klick-Anleitung geben, was ich im Supabase-Dashboard
   und in der Google-Cloud-Console + Apple-Developer-Konsole einstellen muss:
   - Supabase: Auth → Providers → Google aktivieren, Client-ID + Secret eintragen
   - Google Cloud: OAuth-Consent-Screen + OAuth-Client-ID (Web) erstellen,
     Redirect-URI = `<supabase-url>/auth/v1/callback`
   - Analog für Apple (Apple-Developer-Account benötigt)
2. Frontend-Code cleanup: die `loginWithApple`-Funktion prüfen, ob sie die Supabase-
   Standard-Methode `signInWithOAuth({ provider: 'apple' })` verwendet oder eigenen
   Weg — auf Supabase-Standard vereinheitlichen.
3. Nach OAuth-Redirect zurück zur App: Profil-Vervollständigung (Username-Wahl),
   falls nach signIn kein Profil existiert. Der onAuthStateChange-Handler in
   auth.js macht das schon halb; prüfen ob es sauber läuft.
4. Fehlerbehandlung: OAuth-Fehler user-freundlich anzeigen, nicht als Rohtext.

Wichtig:
- Google-OAuth-Verifikationsprozess für Consent-Screen dauert Wochen bei Google,
  wenn du sensitive Scopes willst. Wir wollen KEINE sensitive scopes — nur email +
  profile. Damit bleibt Consent-Screen im "unverified"-Modus, was für < 100 Nutzer
  ok ist.
- Redirect-URI muss exakt matchen. Case-sensitive.
- Test-Login mit einem Google-Account, der noch nie MotoMatch benutzt hat.

DoD: Google-Sign-In funktioniert End-to-End; Apple-Sign-In funktioniert
End-to-End (falls Apple-Developer-Konto vorhanden); Fehler-UX klar;
commit "feat(auth): production-ready OAuth for Google and Apple".
```

---

## P8 — Refactoring der großen Files

```
Wir zerlegen die drei Monster-Files im MotoMatch-Projekt. Achtung: ausdrückliche
Regel aus meiner Roadmap war "funktionierenden Code nicht anfassen". Wir machen
das JETZT NUR, wenn die Beta läuft und die Files aktiv Bugs verursachen oder neue
Features darin gefährlich werden.

Bevor du änderst:
- `src/js/bike-detail.js` (3.265 Zeilen)
- `src/js/community.js` (3.302 Zeilen)
- `src/js/account.js` (2.087 Zeilen)

Zuerst mir sagen: welche der drei Files verursacht aktuell die meisten Bugs (aus
Sentry-Daten)? Nur DIESES eine File refactoren, nicht alle drei.

Ansatz (für eine der drei Files):
1. Struktur-Analyse: welche logischen Bereiche gibt es? Meistens: Datenzugriff,
   Rendering, Event-Handler, Utils. Ergebnis als Text-Übersicht.
2. Extrahieren in eigene Sub-Module unter `src/js/<file>/`:
   - `<file>/data.js` — Datenzugriff/State
   - `<file>/render.js` — HTML-Rendering-Funktionen
   - `<file>/events.js` — Event-Handler
   - `<file>/utils.js` — File-lokale Utils
3. Der ursprüngliche `bike-detail.js` bleibt als Entry-Point, importiert nur noch
   aus den Sub-Modulen. Public API bleibt identisch — keine Namensänderungen.
4. Nach jeder Extraktion: kompletter manueller Regression-Test aller Features des
   Bereichs. Ein Commit pro Sub-Modul.

Wichtig:
- KEIN Framework-Umbau (kein React, kein Vue, kein Svelte).
- KEINE öffentliche API ändern — andere Module dürfen weiterhin die gleichen
  Funktionen importieren.
- KEIN "während wir dabei sind"-Cleanup. Nur strukturell trennen, keine
  Logik-Änderungen.
- Testing nach jedem Schritt zwingend: die Modul-Refactorings sind bekannt für
  Regressionen durch Reihenfolge-Änderungen in Rendering-Code.

DoD: Ursprüngliche File < 500 Zeilen (nur noch Public-API + Composition);
Sub-Module thematisch klar; alle Features funktionieren wie vorher; separate
Commits pro Sub-Modul.
```

---

## P9 — Neue Bikes hinzufügen (Bike-DB erweitern)

```
Wir erweitern die MotoMatch-Bike-Datenbank. Aktueller Stand: ~15–20 Bikes hart in
`matching.js` (Array `BIKES`) und `bike-detail.js` (Objekt `BIKE_DATA`). Doppelte
Datenhaltung — auch das räumen wir jetzt auf.

Grundsatzfrage vorab, mir sagen und Antwort abwarten:
Zielanzahl?
- Realistisch für DACH: 200–400 Modelle (alle relevanten neuen + gängige Gebraucht-
  Modelle der letzten 10 Jahre)
- KEIN Sinn: 40.000 (siehe frühere Diskussion — 90 % würden nie angesehen)
Empfehlung: 300 als Ziel, in Wellen (erst 50, dann 100, dann 300).

Bevor du änderst: `src/js/matching.js` (BIKES-Array), `src/js/bike-detail.js`
(BIKE_DATA-Objekt), `import_motorcycles.py` im Elternordner.

Aufgabe:
1. Single Source of Truth: Bike-Daten aus dem Frontend in eine Supabase-Tabelle
   `bikes` migrieren. Schema:
   ```
   bikes (
     id uuid, slug text unique, name text, brand text, style text,
     cc int, ps int, weight int, seat_height int, license text,
     price_from int, model_year_start int, model_year_end int,
     description text, features jsonb, image_side text, image_detail text,
     model_glb text
   )
   ```
2. Migrations-Skript: aktuelle 15–20 Bikes aus `matching.js` in die neue Tabelle
   INSERT. Anleitung wie ich das Skript im Supabase-SQL-Editor laufen lasse.
3. Frontend umbauen: `matching.js` und `bike-detail.js` lesen die Bike-Daten
   beim App-Start aus Supabase (Cache in-memory für die Session).
4. Ein einfaches Admin-Formular auf `/admin/bikes` (nur für User mit
   `is_admin`-Flag im Profil), wo ich neue Bikes eintragen kann. Alternativ:
   direkt im Supabase-Table-Editor — auch ok.
5. Bilder & GLBs: Konvention `<slug>.png` in Supabase Storage Bucket `bikes-images`
   + `<slug>-detail.png` + `<slug>.glb` in Bucket `bikes-3d`. Bei fehlendem
   Bild/GLB: Fallback-Placeholder.
6. Bulk-Import-Skript für später: liest CSV mit Standardspalten und INSERTs in
   Supabase. Ich pflege die CSV manuell in Numbers/Excel.

Wichtig:
- KEINE 40k Bikes generieren.
- KEINE gescrapten Bilder — nur Presse-Material oder eigene.
- Migration muss idempotent sein — mehrfach ausführbar ohne Duplikate.
- Doppelte Datenhaltung `matching.js`/`bike-detail.js` MUSS mit dieser Session
  weg. Keine Ausrede.

DoD: Alle Bike-Daten in Supabase; Frontend liest von dort; Admin kann neue Bikes
per Table-Editor oder Admin-Formular hinzufügen; Doppel-Hardcoding entfernt;
commit "refactor(bikes): single source of truth in Supabase".
```

---

## P10 — Community-Preview ohne Login

```
Wir öffnen einen begrenzten Community-Bereich für nicht-eingeloggte Besucher.
Ziel: Akquise-Reibung senken, TikTok-artiges "erst gucken, dann anmelden".

Bevor du änderst: `src/js/community.js`, `src/js/community-api.js`,
`supabase/schema.sql` (RLS-Policies).

Aufgabe:
1. Neue "Öffentlich"-Sichtbarkeit für Gruppen (`groups.is_public boolean`) — nur
   Owner kann die Gruppe als öffentlich markieren.
2. RLS-Policy: SELECT auf `messages` in Channels von `is_public = true`-Gruppen
   erlaubt für `anon`-Role. Insert/Update weiterhin nur für Mitglieder.
3. Auf `/community` Landing (ohne Login):
   - Anzeige der öffentlichen Gruppen mit letzten 3 Nachrichten (Preview)
   - Kein Zugriff auf DMs, keine Ride-Feeds, keine Freundes-Liste
   - Prominent CTA "Kostenlos beitreten und mitschreiben"
4. Anti-Spam: wenn nicht-eingeloggt, Preview limitiert auf 20 Nachrichten pro
   Gruppe (letzten 20), keine Reaktionen sichtbar, keine Reply-Threads.
5. Konsistenz: Ride-Feed und Ausrüstung bleiben login-required (kein Preview).

Wichtig:
- RLS-Änderungen MÜSSEN nochmal separat getestet werden — Preview darf niemals
  private Gruppen zeigen.
- Preview ist read-only. Kein "Beitritt" ohne Anmeldung.
- Login-CTA muss sichtbar bleiben beim Scrollen.

DoD: Als unregistrierter User sehe ich Vorschau der öffentlichen Gruppen mit
letzten 20 Nachrichten; kann nicht schreiben; sehe klare Login-CTAs; RLS-Test:
private Gruppen bleiben unsichtbar; commit "feat(community): public preview
without login".
```

---

## P11 — Analytics-Dashboard (PostHog)

```
Wir bauen echtes Product-Analytics ins MotoMatch-Projekt ein. Sentry (aus T0.2)
zeigt Fehler — PostHog zeigt Nutzerverhalten (welche Features werden benutzt,
wo brechen User ab, Retention-Kurven).

Voraussetzung: PostHog Cloud EU (Free-Tier: 1 Mio. Events/Monat, reicht für Beta).

Bevor du änderst: `src/js/monitoring.js` (aus T0.2), `src/js/consent.js`
(aus T2.5).

Aufgabe:
1. PostHog-Account einrichten, EU-Region wählen. API-Key als `VITE_POSTHOG_KEY` in
   `.env`.
2. `posthog-js` als Dependency. Init in `src/js/monitoring.js` — nur wenn
   `getConsent().analytics === true` (Consent-Gate wie bei Sentry).
3. Events instrumentieren (nicht alles — die wichtigen):
   - `quiz_started`, `quiz_completed` (mit dem Match als Property)
   - `bike_detail_viewed` (mit Bike-Name)
   - `bike_added_to_garage`
   - `ride_created` (nach P4)
   - `friend_request_sent`, `friend_request_accepted`
   - `dm_sent`
   - `feedback_submitted`
   - `signup_completed`
4. Identify-Call nach Login mit User-ID (nicht E-Mail) — für Kohorten-Analyse.
5. Dashboard in PostHog manuell einrichten (Anleitung liefern):
   - Wöchentliche aktive Nutzer
   - Retention-Kurve Woche 1–4
   - Quiz-Completion-Rate
   - Feature-Nutzung nach Typ

Wichtig:
- Consent-Gate strikt einhalten (DSGVO).
- KEINE PII (E-Mails, Namen) in Event-Properties — nur IDs.
- Session-Replay: NICHT aktivieren (wäre klar consent-pflichtig und speichert viel).

DoD: Events kommen in PostHog an; Retention-Kurve wird gezeichnet; Dashboard
liefert Zahlen die man Wochen-für-Wochen vergleichen kann; commit "feat: posthog
product analytics with consent gate".
```

---

## P12 — Email-Marketing / Newsletter (Resend)

```
Wir bauen einen minimalen Newsletter-Flow für MotoMatch. Nach Beta-Launch willst
du wahrscheinlich einen "Was Neues"-Monatsversand + Wichtiges wie Wartungs-
Notifications. Wir nutzen Resend (Free-Tier: 3.000 Mails/Monat, eigene Domain).

Voraussetzung:
- Eigene Domain mit DNS-Zugriff (SPF, DKIM, DMARC setzen)
- Resend-Account

Bevor du änderst: Nichts. Wir bauen neu.

Aufgabe:
1. Anleitung: Resend-Account, Domain verifizieren, DNS-Einträge.
2. Neue Supabase-Tabelle `newsletter_subscribers (user_id, email, subscribed_at,
   unsubscribed_at, topics text[])`. Topics = 'product-updates' | 'community-highlights'
   | 'safety-tips'.
3. Anmelde-UI: Toggle im Account-Settings pro Topic. Beim ersten Login: sanfter
   Hinweis, kein Zwang.
4. Doppel-Opt-In: nach Toggle → Bestätigungsmail von Resend, Klick nötig.
   Rechtlich in Deutschland Pflicht.
5. Serverless-Function `api/send-newsletter.js` — nur für Admin-User, sendet an
   alle Subscriber eines Topics. Payload: Subject + Markdown-Body. Automatische
   Konvertierung Markdown → HTML.
6. Unsubscribe-Link in jeder Mail (Pflicht) mit Token.

Wichtig:
- KEIN Newsletter ohne explizites Opt-In pro Topic.
- KEIN "wir haben Sie automatisch angemeldet weil Sie registriert sind" — das ist
  in DE illegal.
- Impressum + Datenschutzerklärung müssen "wir versenden Newsletter" abbilden.
- Bounce-/Complaint-Handling: Resend sendet Webhooks; einfache Serverless-Function
  `api/resend-webhook.js` markiert Adressen bei Bounce als `unsubscribed_at`.

DoD: Ich kann mich als Test-User in-App für Newsletter anmelden, bekomme Bestätigungs-
mail, klicke Link, bin subscribed; als Admin kann ich Testmail versenden, kommt an;
Unsubscribe funktioniert; commit "feat: newsletter with resend and double-opt-in".
```

---

## P13 — SEO-Optimierung

```
Wir machen MotoMatch für Google auffindbar. Vor der Beta hatte SEO Null Priorität
(Login-required Content sowieso nicht indexierbar). Nach Launch + P10
(Community-Preview) + öffentlicher Bike-DB gibt es aber echten SEO-Wert.

Bevor du änderst: `index.html`, `src/js/landing.js`, `src/js/bike-detail.js`.

Aufgabe in drei Bereichen:

BEREICH 1 — Technisches SEO:
1. `robots.txt` in `public/` — Basis (Allow: /, Sitemap-Verweis).
2. `sitemap.xml` generieren beim Build — alle Bike-Detail-URLs, öffentliche
   Community-Gruppen, statische Seiten. Vite-Plugin oder eigenes Skript.
3. Meta-Tags dynamisch pro Screen setzen: Title, Description, OG-Image.
   Für Bike-Detail: "Yamaha YZF-R3 — Specs, Test, Preis | MotoMatch".
4. Structured Data (JSON-LD) pro Bike-Detail: `Product`-Schema mit
   Marke, Modell, Preis, Bild.

BEREICH 2 — Content-Seiten (echte HTML statt SPA-only):
1. Statische Seiten für alle Bikes bei Build generieren — pre-rendered HTML,
   nicht nur JS-generiert. Ansatz: Build-Skript rendert für jeden Bike-Slug ein
   HTML-File nach `dist/bikes/<slug>.html` mit vollem Content.
2. Landing bekommt echten prerendered HTML-Content (Hero + Sektionen + Footer),
   damit Googlebot ohne JS-Rendering was zu indexieren hat.

BEREICH 3 — Ranking-Grundlagen:
1. Interne Verlinkung: von jedem Bike-Detail Cross-Links zu 3 ähnlichen Bikes.
2. Canonical-URLs überall setzen.
3. Alt-Texte für ALLE Bilder (accessibility + SEO).
4. Ladezeit: Lighthouse-Score prüfen. Bilder als WebP, lazy-load, Fonts subsettet.
5. Google Search Console einrichten (Anleitung), Sitemap einreichen.

Wichtig:
- KEIN Keyword-Stuffing im Text.
- KEIN Cloaking (User sieht anderen Content als Bot).
- Structured Data validieren mit Google Rich Results Test.
- SEO braucht Monate bis es wirkt. Erwartungshaltung managen.

DoD: `robots.txt` und `sitemap.xml` erreichbar; Meta-Tags dynamisch pro Screen;
JSON-LD auf Bike-Detail-Seiten validiert; Prerender-Build funktioniert; alle
Bilder haben Alt-Texte; Lighthouse-SEO-Score ≥ 95; committet in 2–3 Commits
je Bereich.
```

---

## P14 — Mobile-Ansicht polieren (echtes Mobile-Redesign)

```
Vollständige Mobile-Optimierung des MotoMatch-Projekts. Achtung: T3.6 hat nur die
schlimmsten Blocker gefixt. Hier machen wir eine tatsächlich schöne, mobile-first
Erfahrung. Erst wenn Beta-Feedback zeigt dass Mobile > 50 % der Nutzung ausmacht
(sonst falsche Priorisierung).

Bevor du änderst:
- `src/styles/main.css` (9.984 Zeilen — hier gibt's viel zu tun)
- `docs/BETA-MOBILE-CHECK.md` (aus T3.6)
- Analytics-Zahlen (aus P11): Mobile-Nutzungs-Anteil

Vorgehen:
1. Zuerst mir die Analytics-Zahlen zeigen: Anteil Mobile/Desktop, welche Screens
   werden mobil überwiegend genutzt. Priorisierung folgt Datenlage, nicht
   Bauchgefühl.
2. Ein Screen nach dem anderen mobile-optimieren, in dieser Reihenfolge (nur
   wenn Daten das bestätigen — sonst umsortieren):
   - Landing (Hero, Sektionen kompakter, CTAs Daumen-freundlich)
   - Bike-Detail (3D-Viewer als volle Höhe, Tabs als Bottom-Sheet)
   - Community (Sidebar als Slide-out, Chat als Vollbild)
   - Karte (Karte als Vollbild, Filter als Bottom-Sheet)
   - Ausrüstung (Grid 2-spaltig)
   - Account (Sidebar collapse, Sektionen stapeln)
   - Feed (Vollbild-Cards)
3. Pro Screen: aktueller Zustand → Ziel-Screenshot (aus Referenz-Apps wie
   Strava, Komoot) → Umsetzung → Test auf echtem Handy.
4. Bottom-Navigation für die 5 wichtigsten Screens (Feed, Match, Karte, Community,
   Account) — nur auf Mobile, nicht auf Desktop.
5. Touch-Targets mindestens 44×44 px.

Wichtig:
- KEIN kompletter CSS-Rewrite. Media-Queries im bestehenden main.css erweitern.
- Design-System-Extraktion (CSS-Variablen) sollte irgendwann in einem eigenen
  Refactor kommen — für JETZT nicht.
- Screenshots vor und nach jedem Screen als Beleg.
- Regression-Test auf Desktop nach jedem Screen (nicht kaputtmachen).

DoD: Alle 7 Kern-Screens mobil erstklassig; Bottom-Nav auf Mobile aktiv;
Vergleichs-Screenshots vor/nach pro Screen; Regression-Test Desktop ok;
committet in 7 Commits (einer pro Screen).
```

---

## Reihenfolge der Post-Launch-Prompts (empfohlen)

Nach Beta-Feedback prüfen, welche Bausteine tatsächlich Priorität haben. Meine
**Default-Reihenfolge**, wenn du keine anderen Signale hast:

1. **P4 (Ride-Feed)** — der eine Baustein, der aus Werkzeugkasten → tägliche App macht
2. **P11 (Analytics)** — parallel, damit du ab jetzt datenbasiert entscheidest
3. **P5 (Push/PWA)** — Rückholmechanik, verdoppelt Retention typisch
4. **P9 (Bike-DB erweitern auf 300)** — jetzt datenbasiert (welche Bikes werden gesucht?)
5. **P10 (Community-Preview ohne Login)** — senkt Akquise-Reibung, wenn Beta signalisiert dass Community trägt
6. **P7 (OAuth polish)** — wenn Signup-Reibung als Blocker sichtbar wird
7. **P3 (Marketplace)** — wenn User nach Kaufhilfe fragen
8. **P14 (Mobile-Polish)** — wenn Mobile-Anteil > 50 %
9. **P13 (SEO)** — wenn du auf organisches Wachstum setzt (nicht nur Freundeskreis)
10. **P8 (Refactoring)** — nur wenn Sentry-Daten zeigen dass Files aktiv Bugs verursachen
11. **P1 (Mit-Fahrer-3D)** — nice-to-have, nicht retention-treibend
12. **P12 (Newsletter)** — wenn du > 500 Nutzer hast und Owned-Channel brauchst
13. **P2 (Voice)** — wenn Beta ausdrücklich danach fragt (unwahrscheinlich in Text-Community)
14. **P6 (Native App)** — wenn PWA-Reichweite zu klein für iOS-Nutzer wird

## Meta-Regel für alle Post-Launch-Prompts

**Kein einziger Post-Launch-Prompt darf gestartet werden, ohne dass du dir folgende
drei Fragen beantwortet hast:**

1. Was in den letzten 2 Wochen Beta-Nutzung sagt, dass genau dieses Feature jetzt
   dran ist?
2. Was passiert wenn ich es NICHT baue?
3. Was baue ich mit diesem Aufwand als Alternative — und was verdrängt es?

Wenn du auf eine der drei keine klare Antwort hast: dann ist das Feature nicht
dran.
