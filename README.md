# MotoMatch 🏍️

MotoMatch ist eine Web-App, die Motorradfahrer:innen hilft, **das passende Bike zu finden**, Modelle zu vergleichen, Ausrüstung zu entdecken, Orte auf einer Karte zu speichern und sich in einer **Community (Discord-Stil)** auszutauschen.

> **Status:** Funktionsfähiger Prototyp. Frontend ist vollständig; die Datenhaltung läuft aktuell **lokal im Browser (localStorage)** — es gibt noch **kein echtes Backend**. Die Auth-/Daten-Funktionen sind hinter sauberen Schnittstellen gekapselt, sodass später ein echtes Backend (z. B. Supabase/JWT) eingesetzt werden kann.

---

## Tech-Stack

| Bereich        | Technologie |
|----------------|-------------|
| Build/Dev      | [Vite 5](https://vitejs.dev/) |
| Sprache        | **Vanilla JavaScript (ES-Module)** — kein Framework (kein React/Vue) |
| 3D             | [three.js](https://threejs.org/) + `three-stdlib` (GLTF-Loader, Environment) für die 3D-Bike-Ansicht |
| Karten         | [Leaflet](https://leafletjs.com/) + Google Maps / Open-Meteo (Wetter) |
| Animation      | [lottie-web](https://airbnb.io/lottie/) |
| Styling        | Ein zentrales, handgeschriebenes CSS (`src/styles/main.css`) — dunkles, „Porsche-inspiriertes" Design mit Karten-Layout |
| Deployment     | Vercel (`vercel.json`, Base-Pfad `/app/` im Build) |

Es wird **kein** UI-Framework und **keine** Zustands-Bibliothek verwendet — die UI wird per Template-Strings + `innerHTML` gerendert und über Events verdrahtet.

---

## Schnellstart

```bash
npm install
npm run dev      # startet Vite auf http://localhost:5173
```

Weitere Skripte:

```bash
npm run build    # Production-Build nach dist/
npm run preview  # Build lokal ansehen
```

### Umgebungsvariablen (`.env`)
Alle optional (Features degradieren ohne Keys gracefully):

| Variable            | Zweck |
|---------------------|-------|
| `VITE_OPENAI_KEY`   | KI-Funktionen (z. B. Empfehlungen) |
| `VITE_TAVILY_KEY`   | Web-Suche für KI-Kontext |
| `VITE_GMAPS_KEY`    | Google-Maps / Places in der Karten-Ansicht |

---

## Einstiegspunkt & Ablauf

`index.html` lädt genau **ein** Modul: `src/main.js`.

```
index.html → src/main.js → import './styles/main.css' + startApp() (src/js/app.js)
```

Die App ist eine Single-Page-App, die zwischen „Bildschirmen" umschaltet (Landing, Bike-Detail/Konfigurator, Quiz, Garage) — jeweils eigene Container in `index.html`, die per JS ein-/ausgeblendet werden.

---

## Projektstruktur

```
moto-match/
├─ index.html              # HTML-Grundgerüst + Container der Bildschirme
├─ vite.config.js          # Vite-Config (Base /app/ im Build, lokale Asset-Kopie)
├─ src/
│  ├─ main.js              # Einstiegspunkt: CSS + startApp()
│  ├─ styles/main.css      # gesamtes Styling (ein großes Stylesheet)
│  ├─ assets/              # Bilder (u. a. community-bg.jpeg = Muster-Hintergrund)
│  └─ js/
│     ├─ app.js            # Bootstrapping / Router zwischen den Bildschirmen
│     ├─ landing.js        # Startseite: Hero, Top-Navigation, Menü
│     ├─ onboarding.js     # 3-Schritt-Onboarding beim ersten Besuch
│     ├─ quiz.js           # „Match-Quiz" (Fragen → Empfehlung)
│     ├─ matching.js       # Matching-Logik Bike ↔ Fahrprofil
│     ├─ bike-detail.js    # Bike-Detail + Konfigurator (Tabs: Ansicht/Ausrüstung/
│     │                    #   Match/Community/Karte), 3D-Viewer, mountet Community
│     ├─ community.js      # Community im Discord-Stil (siehe unten)
│     ├─ auth.js           # ZENTRALE Authentifizierung (eine Session/DB, plattformweit)
│     ├─ account.js        # Konto/Profil-Overlay (Komoot-Stil, zwei Spalten)
│     ├─ gear.js           # Ausrüstungs-Katalog + Favoriten
│     ├─ garage.js         # „Garage"/Hub inkl. Karten-Funktionen (Leaflet)
│     ├─ map-view.js       # Karten-Ansicht (Händler/Werkstätten/Fahrschulen)
│     ├─ dealers.js        # Händlerdaten
│     ├─ marketplace.js    # Gebrauchtmarkt
│     ├─ ai.js             # KI-Anbindung (OpenAI/Tavily)
│     └─ drop-animation.js # visuelle Effekte
├─ public/                 # statische Assets (Bilder, Icons, Karten-Icons …)
└─ Modell-CSV / Bilder …   # Rohdaten der Motorräder (im übergeordneten Ordner)
```

---

## Kernfunktionen

### 1. Bike finden & konfigurieren
- Landing mit Hero + Match-Quiz (`quiz.js`, `matching.js`).
- Bike-Detailseite/Konfigurator (`bike-detail.js`) mit **3D-Ansicht** (three.js), technischen Daten, Ausrüstungs-Empfehlung, Karte und Community — als Tab-Leiste.

### 2. Community (Discord-Stil) — `community.js`
- **Login-/Registrierungs-Screen** mit Muster-Hintergrund; Dev-Shortcut „Überspringen" (Gast).
- **Kategorien statt Textkanäle:** Touren, Events, Gruppen, Stammtische, Rennstrecke, Schrauber-Treff, Forum.
- In einer Kategorie: **Gruppen/Einträge** zum **Beitreten** oder selbst **Erstellen**.
- In einer Gruppe (3-Spalten-Layout): Kategorie-Icons | **Talks/Sprachkanäle** (beitreten, Teilnehmer sichtbar) + Chat-Kanal | **Chat** (mit Motorrad-Muster-Hintergrund).
- **Freunde-Bereich** (eigener Reiter): Icon-Leiste | Freunde/Nachrichten + Direktnachrichten-Liste | Inhalt | „Jetzt aktiv"-Panel.
- **User-Panel unten links:** Klick auf den Avatar öffnet ein Discord-artiges Popover (Status ändern, Profil bearbeiten, Abmelden); Mikrofon-/Kopfhörer-Buttons öffnen Audio-Popover (Gerät, Lautstärke).

### 3. Zentrale Authentifizierung (Single Sign-On) — `auth.js`
- **Eine** User-Datenbank + **eine** Session für die gesamte Plattform.
- Egal ob Login/Registrierung über die Haupt-Website (Konto) oder die Community — **dieselbe Session**.
- Pub/Sub (`subscribe`) + Event `mm:auth-changed`, tab-übergreifend via `storage`-Event.
- Öffentliche API: `login`, `register`, `logout`, `loginGuest`, `currentUser`, `updateProfile`, `getSession`, `isLoggedIn`, `openAuthModal`.

### 4. Konto/Profil (Komoot-Stil) — `account.js`
- Zwei-Spalten-Profil: links Profil-Karte (Avatar, Name, Statistiken, Anmelden/Abmelden) + vertikale Navigation, rechts „Chronik".
- `getAccount()`/`saveAccount()` spiegeln den zentralen Auth-Nutzer (kein separates Profil).

---

## Datenhaltung (localStorage-Prototyp)

Alle Daten liegen aktuell im Browser. Wichtige Keys:

| Key | Inhalt |
|-----|--------|
| `mm_auth_users_v1` / `mm_auth_session_v1` | zentrale User-DB / aktive Session |
| `mm_comm_groups_v2` | Community-Gruppen inkl. Nachrichten & Talks |
| `mm_comm_friends_v1` / `mm_comm_dms_v1` | Freunde / Direktnachrichten |
| `mm_comm_prefs_v1` | Community-Einstellungen (Status, Lautstärke …) |
| `mm_gear_favs`, `mm_recent_bikes_v1`, `mm_kv_favs` | Ausrüstungs-Favoriten, zuletzt gesehene Bikes, gespeicherte Orte |

---

## Bekannte Einschränkungen / Roadmap

- **Kein echtes Backend:** Konten, Nachrichten, Gruppen sind lokal und nicht geräteübergreifend synchron. Passwörter werden **nicht** sicher gespeichert (Klartext im localStorage) — nur für den Prototyp.
- **Kein echtes Audio** in den Talks/Sprachkanälen (nur UI + Beitreten/Verlassen-Logik). WebRTC ist der nächste Schritt.
- QR-Login, „Server entdecken", Shop, Quests, Passwort-Reset sind **Platzhalter**.
- Nächste sinnvolle Schritte: echtes Backend (Auth + DB), Realtime (WebSockets/WebRTC), Tests, CI.

---

## Für Code-Review / Copilot

- **Frontend-Only, Vanilla JS** — die Logik lebt in `src/js/*.js`, das Styling komplett in `src/styles/main.css`.
- Auth ist der zentrale Dreh- und Angelpunkt: `src/js/auth.js` (Schnittstelle für ein späteres Backend).
- Größte/komplexeste Module: `bike-detail.js` (Konfigurator + 3D) und `community.js` (Discord-artige Community).
- Review-Schwerpunkte, die sinnvoll sind: Sicherheit der (künftigen) Auth, Trennung UI/Daten, XSS bei `innerHTML`-Rendering (Nutzereingaben werden über `esc()` escaped), Modularisierung von `bike-detail.js`.
