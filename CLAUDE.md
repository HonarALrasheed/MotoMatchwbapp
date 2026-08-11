# MotoMatch — CLAUDE.md

## Aktueller Fokus (2026-08-11)
Ziel ist eine **geschlossene Beta für 10–30 Bekannte** aus dem Motorrad-Umfeld
mit **0 € Fixkosten** (nur Free-Tiers), Zeitbudget ~20 h/Woche.
- Ist-Zustand und Feature-Inventar: [docs/STATUS.md](docs/STATUS.md)
- Aufgabenliste, Meilensteine, was raus- und was rein muss: [docs/ROADMAP-BETA.md](docs/ROADMAP-BETA.md)
- Bewusst aus Beta-Scope: Voice/Talks, Marketplace, Shop, Quests, QR-Login, OAuth
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
| `.env` | `VITE_OPENAI_KEY`, `VITE_TAVILY_KEY`, `VITE_GMAPS_KEY` — alle optional, Features degradieren ohne Keys |

Wichtigste Module in `src/js/`:
- `app.js` — Bootstrapping/Router zwischen Bildschirmen
- `auth.js` — **zentrale** Auth (eine Session plattformweit); API: `login`, `register`, `logout`, `loginGuest`, `currentUser`, `updateProfile`, `getSession`, `isLoggedIn`, `openAuthModal`; Event `mm:auth-changed`
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

## Browser-Verifikation nach UI-Änderungen
- Dev-Server **immer** über die Browser-Preview starten (`.claude/launch.json`, Konfiguration `moto-match`, Port 5173) — nie per Bash.
- Nach Änderungen an UI/Styling: Seite laden, Konsole auf Fehler prüfen, Screenshot machen und selbst vergleichen. Nicht den Nutzer manuell prüfen lassen.
- Bildschirme sind SPA-Container — zum Testen ggf. per Klick durch Landing → Quiz/Detail navigieren.

## Bekannte Einschränkungen
- Passwörter im Klartext in localStorage — nur Prototyp, kein Security-Fix nötig, aber nichts darauf aufbauen
- Talks/Sprachkanäle: nur UI, kein echtes Audio (WebRTC = Roadmap)
- QR-Login, Shop, Quests, Passwort-Reset sind Platzhalter

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
