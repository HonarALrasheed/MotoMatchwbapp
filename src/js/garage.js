/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — garage.js  v3.0
 *  Porsche-style Quiz Result Page
 *
 *  Layout (scrollable, like bike-detail.js):
 *    Section 1: Hero — bg text + cutout image + name/badge/price/actions
 *    Section 2: Specs — animated counters (left) + 3D model (right)
 *    Section 3: Gear + Markt + Map (tabbed)
 *    Footer
 *
 *  3D: DRACOLoader + MeshoptDecoder, adaptive shadows, PMREM env
 * ══════════════════════════════════════════════════════════════
 */

import { enterScreen, goBack as navGoBack, currentScreen } from "./nav.js";
// three.js liegt in einem gemeinsamen Chunk von 667 KB. Die meisten Screens
// (Karte, Ausrüstung, Community) zeigen kein Modell — deshalb erst laden,
// wenn wirklich ein Viewer aufgebaut wird.
let THREE, GLTFLoader, DRACOLoader, MeshoptDecoder, RoomEnvironment
let _threePromise = null
function loadThree() {
  if (!_threePromise) {
    _threePromise = Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/DRACOLoader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
      import('three/addons/environments/RoomEnvironment.js'),
    ]).then(([three, gltf, draco, meshopt, room]) => {
      THREE = three
      GLTFLoader = gltf.GLTFLoader
      DRACOLoader = draco.DRACOLoader
      MeshoptDecoder = meshopt.MeshoptDecoder
      RoomEnvironment = room.RoomEnvironment
    })
  }
  return _threePromise
}
import {
  findBestBike,
  ERGEBNIS_ANZAHL,
  findTopMatches,
  findBikeByShortName,
  resolveBikeDetail,
  istVollkatalogGeladen,
  canonicalBikeForDetail,
  preisAnzeige,
  scoreBikeAgainst,
} from "./matching.js";
import { addMatch } from "./match-history.js";
import { bikeBild, hatFoto, kachelFuerHero } from "./bike-bild.js";
import { getGear } from "./gear.js";
import { buildSearchUrls } from "./marketplace.js";
import { esc } from "./util.js";
import { initHubMap, searchNearby, retryHubLocation, getHubMap, panHubToCoords, resetHubSuche, setHubPlacesPausiert } from "./karte.js";

/* Die Karte hier ist dieselbe wie im Karten-Reiter. Stand der dort zuletzt auf
   "Touren", waren die Orte pausiert und die Tourlinien an — hier sollen
   Werkstätten, Händler und Fahrschulen kommen. */
async function hubAlsOrte() {
  try { (await import("./touren.js")).setTourenAktiv(false); } catch {}
  setHubPlacesPausiert(false);
  const bereich = document.querySelector("#garage-container #gr-hub-section");
  await initHubMap(bereich?.querySelector(".hub-map"));
  const aktiv = bereich?.querySelector(".hub-pill.active");
  searchNearby(aktiv?.dataset.query || "Motorradwerkstatt");
}

// Einmaliger, dezenter Puls auf der Tab-Leiste, damit Nutzer merken, dass
// hinter "Profil"/"Ausrüstung"/etc. mehr Inhalt steckt.
const TABHINT_KEY = "mm_tabhint_seen_v1";
function tabHintSeen() {
  try { return !!localStorage.getItem(TABHINT_KEY); } catch { return true; }
}
function markTabHintSeen() {
  try { localStorage.setItem(TABHINT_KEY, "1"); } catch {}
}


// Hinweis-Puls-Zyklus: erst nach 15s Inaktivität starten, dann 5s pulsieren,
// 5s Pause, wieder 5s pulsieren usw. — bis der Nutzer einen Tab anklickt.
const TABHINT_WAIT_MS = 15000;
const TABHINT_PULSE_MS = 5000;
const TABHINT_PAUSE_MS = 5000;
let tabHintTimers = [];
function clearTabHintTimers() {
  tabHintTimers.forEach(clearTimeout);
  tabHintTimers = [];
}
function scheduleTabHint() {
  clearTabHintTimers();
  if (tabHintSeen()) return;
  const bar = document.getElementById("gr-tabbar");
  if (!bar) return;

  const cycle = (on) => {
    if (tabHintSeen() || !document.body.contains(bar)) return; // Seite verlassen/verändert oder inzwischen geklickt
    bar.classList.toggle("tb-bar--hint", on);
    tabHintTimers.push(
      setTimeout(() => cycle(!on), on ? TABHINT_PULSE_MS : TABHINT_PAUSE_MS)
    );
  };
  tabHintTimers.push(setTimeout(() => cycle(true), TABHINT_WAIT_MS));
}
function stopTabHint() {
  clearTabHintTimers();
  document.getElementById("gr-tabbar")?.classList.remove("tb-bar--hint");
}

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════

let garageScene, garageCamera, garageRenderer, garageBike, garageRaf;
let bikeDetailRequestId = 0;
// Zaehlt jeden Start eines 3D-Ladevorgangs — der GLTF-Callback vergleicht
// damit, ob er noch zum aktuellen Ladevorgang gehoert (siehe init3DViewer).
let garageLoadGen = 0;
let garageAnsichtObserver = null;
// #garage-container ist statisch (index.html) und wird nie neu erzeugt —
// bindEvents() legt sonst bei jedem Besuch einen weiteren scroll-/click-
// Listener drauf. Referenzen hier merken, damit cleanup() sie abmeldet.
let garageContainerScrollHandler = null;
let garageContainerClickHandler = null;
let camDist = 5,
  camHeight = 1.5,
  lookAtY = 0.45;

// ══════════════════════════════════════════════════════════════
//  GEAR SVG ICONS
// ══════════════════════════════════════════════════════════════

const GEAR_ICONS = {
  helmet:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C7 2 3 6 3 11v2c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2c0-5-4-9-9-9z"/><path d="M3 13h18"/><path d="M7 15v2a2 2 0 002 2h6a2 2 0 002-2v-2"/></svg>',
  jacket:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l-4 4H4v14h16V6h-4l-4-4z"/><path d="M12 2v8"/><path d="M4 10h4"/><path d="M16 10h4"/></svg>',
  gloves:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 00-4 0"/><path d="M14 6V4a2 2 0 00-4 0v7"/><path d="M10 11V3a2 2 0 00-4 0v8"/><path d="M18 11a2 2 0 012 2v1a8 8 0 01-8 8h-1a8 8 0 01-8-8v-1a2 2 0 012-2"/></svg>',
  boots:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v7l-4 5v6h14v-6l-2-5V2H8z"/><path d="M4 20h14"/><path d="M8 9h8"/></svg>',
};

function gearIcon(name) {
  return GEAR_ICONS[name] || "";
}

// ══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ══════════════════════════════════════════════════════════════

export function loadGarage(answers) {
  cleanup();

  const container = document.getElementById("garage-container");
  container.style.display = "block";

  /* Ein Durchlauf statt zwei: findBestBike() rechnete dasselbe noch einmal — und konnte seit der
     Stilgarantie sogar ein anderes Bike liefern als Platz eins der Fünferliste. */
  const topMatches = findTopMatches(answers, ERGEBNIS_ANZAHL);
  const matchBike = topMatches[0]?.bike || findBestBike(answers);
  const bikeData = canonicalBikeForDetail(matchBike);

  // Das vollständige Quiz-Ergebnis ist eine wiederherstellbare Ansicht. Ohne
  // diesen Eintrag landeten Nutzer nach einem Browserneustart auf der
  // Startseite, obwohl der Sieger und die Antworten bereits lokal vorlagen.
  enterScreen("garage", goBack, isGarageActive,
              { screen: "match-result", bike: bikeData.name });

  console.info(`[garage] Matched: ${bikeData.name}`);

  // Sieger des Durchlaufs in die Match-Chronik — der Match-Reiter im
  // Konfigurator liest sie aus.
  const winner = topMatches[0];
  addMatch(bikeData, {
    score: winner?.score,
    pct: winner ? scoreBikeAgainst(matchBike, answers)?.pct : null,
    source: 'quiz',
  });

  // Build the full page
  container.innerHTML = buildPage(bikeData, true, topMatches.hinweis, matchBike);
  container.scrollTop = 0;
  window.scrollTo(0, 0);

  // Animate hero image in
  requestAnimationFrame(() => {
    container.style.opacity = "1";
    initAnimations(container);
    init3DViewer(bikeData);
    bindEvents(bikeData);
    initHubScrollEffect();
    initTabbarThemeSync();
    mountAnsicht(bikeData);
  });
}

/**
 * Open the garage page directly for a bike (from landing page cards).
 * No quiz answers needed — same full-featured page.
 */
export async function openBikeGarage(shortName) {
  const requestId = ++bikeDetailRequestId;
  const screenAtRequest = currentScreen();
  // Auch ein Katalog-Objekt: der Direktlink ?motorrad=<slug> (app.js) hat das Bike schon eindeutig
  // gefunden — über den Namen wären gleichnamige Modelle verschiedener Baujahre mehrdeutig.
  const direktEintrag = shortName && typeof shortName === "object";
  let bikeData;
  if (direktEintrag) {
    bikeData = shortName;
  } else {
    const ladeToast = istVollkatalogGeladen() ? null : zeigeToast("Motorraddaten werden geladen…", { duration: 0 });
    const aufloesung = await resolveBikeDetail(shortName);
    bikeData = canonicalBikeForDetail(aufloesung.bike);
    if (ladeToast && ladeToast.textContent === "Motorraddaten werden geladen…") {
      clearTimeout(ladeToast._t);
      ladeToast.classList.remove("mm-toast--show");
    }
    // Ein langsamer Abruf darf nicht nach einem inzwischen gestarteten Screenwechsel
    // oder über einem geöffneten Konto-Overlay nachträglich die Garage öffnen.
    if (requestId !== bikeDetailRequestId || currentScreen() !== screenAtRequest ||
        document.getElementById("quiz-screen")?.style.display !== "none" ||
        document.getElementById("acc-overlay")?.classList.contains("acc-overlay--open")) return;
  }
  if (!bikeData) {
    import('./landing.js').then(m => m.initLanding());
    zeigeToast("Bike nicht gefunden.");
    return;
  }

  cleanup();

  // Hide landing, show garage
  const landing = document.getElementById("landing");
  const detail = document.getElementById("bike-detail");
  const container = document.getElementById("garage-container");

  if (landing) {
    landing.style.transition = "opacity 0.22s ease";
    landing.style.opacity = "0";
  }
  if (detail) detail.style.display = "none";

  setTimeout(() => {
    if (landing) landing.style.display = "none";
    container.style.display = "block";
    enterScreen("garage", goBack, isGarageActive,
                { screen: "garage", bike: bikeData.name });


    container.innerHTML = buildPage(bikeData, false);
    container.scrollTop = 0;
    window.scrollTo(0, 0);

    requestAnimationFrame(() => {
      container.style.opacity = "1";
      initAnimations(container);
      init3DViewer(bikeData);
      bindEvents(bikeData);
      initHubScrollEffect();
      initTabbarThemeSync();
      mountAnsicht(bikeData);
    });
  }, 220);
}

// ══════════════════════════════════════════════════════════════
//  PAGE BUILDER
// ══════════════════════════════════════════════════════════════

/** Neu- und Gebrauchtpreis unter dem Hauptpreis — die Mitte aus beiden steht oben (matching_katalog.py). */
function preisDetails(bike) {
  const euro = (n) => `${Math.round(n).toLocaleString("de-DE")} €`;
  const teile = [];
  if (bike.priceNew) teile.push(`neu ca. ${euro(bike.priceNew)}`);
  if (bike.priceUsed) {
    /* `priceYear` bedeutet zweierlei: bei einem Katalogpreis das Modelljahr, bei einem Median aus
       Inseraten dagegen den Tag der Erhebung. Beides gleich zu beschriften las sich falsch — die
       Honda XL1000V Varadero (gebaut bis 2013) stand mit „gebraucht (2026)" da, als gäbe es sie
       als 2026er Modell. Betroffen waren 348 Bikes, deren Preis aus Inseraten stammt. */
    const ausInseraten = /Inserate/i.test(bike.priceSource || "");
    const jahr = bike.priceYear
      ? (ausInseraten ? ` (Stand ${bike.priceYear})` : ` (${bike.priceYear})`)
      : "";
    teile.push(`gebraucht${jahr} ca. ${euro(bike.priceUsed)}`);
  }
  if (!teile.length) return "";
  return `<p class="bd-price-detail">${teile.join(" · ")} — Marktpreise 1000PS</p>`;
}

function buildPage(bike, fromQuiz = true, hinweis = null, preisDetailsBike = bike) {
  const priceDisplay = preisAnzeige(bike);

  return `
    <!-- ═══ SECTION 1: Hero (Porsche-style) ═══ -->
    <section class="bd-hero">
      <button class="bd-back" id="garage-back">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <button class="bd-back bd-teilen" id="garage-teilen" type="button" aria-label="Teilen">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>
      </button>

      <!-- Wortmarke sitzt in der Bildbox, damit sie an das Motorrad
           gekoppelt bleibt statt an die Hero-Hoehe. -->
      <div class="bd-hero-img-wrap">
        <div class="bd-hero-bg-text">${bike.bgText || bike.name}</div>
        <!-- Am Handy die eng beschnittene Kachel statt des Panoramas: im Titelbild (1600 × 437)
             nimmt das Motorrad nur gut 40 % der Breite ein — auf 375 px blieb davon ein 90 px
             hohes Bike mit viel Leere ringsum. Die Kachel zeigt nur das Motorrad. -->
        <picture class="bd-hero-pic">
          ${kachelFuerHero(bike) ? `<source media="(max-width: 768px)" srcset="${kachelFuerHero(bike)}">` : ""}
          <img class="bd-hero-img" src="${bikeBild(bike, "titel")}" alt="${bike.name}">
        </picture>
        ${hatFoto(bike) ? "" : '<span class="bd-hero-foto-folgt">Foto folgt</span>'}
      </div>

      <div class="bd-hero-info">
        ${fromQuiz ? '<p class="gr-match-label">Dein perfektes Match</p>' : ""}
        <h1 class="bd-model-name">${bike.name}</h1>
        <p class="bd-price">${priceDisplay}</p>
        ${preisDetails(preisDetailsBike)}
        ${hinweis ? `<p class="bd-hinweis">${hinweis}</p>` : ""}
      </div>
    </section>

    <!-- ═══ Sticky Touch Bar ═══ -->
    <div class="tb-wrap" id="bd-sticky-nav">
      <nav class="tb-bar" id="gr-tabbar">
        <button class="tb-btn" type="button" id="gr-profil-btn">Profil</button>
        <button class="tb-btn" data-tab="ausstattung">Ausr\u00fcstung</button>
        <button class="tb-btn" data-tab="match"><span class="tb-lbl-lang">Match finden</span><span class="tb-lbl-kurz">Match</span></button>
        <button class="tb-btn" data-tab="community">Community</button>
        <button class="tb-btn" data-tab="karte">Karte</button>
      </nav>
    </div>

    <!-- ═══ SECTION 2: Specs + 3D Model ═══ -->
    <section class="bd-specs" id="gr-specs-section">
      <div class="bd-specs-inner">
        <!-- Wird von mountAnsicht() gefuellt (bike-detail.js bleibt ein
             eigener Chunk und wird erst nach dem Rendern nachgeladen). -->
        <div class="bd-specs-left" id="gr-ansicht-host"></div>
        <div class="bd-specs-right">
          <div class="bd-3d-canvas-wrap" id="gr-3d-wrap">
            <canvas id="gr-3d-canvas"></canvas>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ SECTION 3: Content (scrolled to by nav buttons) ═══ -->
    <section class="gr-extras" id="gr-extras-section">
      <div class="gr-extras-inner">
        <div class="gr-tab-content" id="gr-tab-content"></div>
      </div>
    </section>

    <!-- ═══ SECTION 4: Hub — Apple Maps Style ═══ -->
    <section class="hub-section hub-section--finale" id="gr-hub-section">
      <div class="hub-inner">
        <h2 class="hub-title">In deiner N\u00e4he</h2>
        <div class="hub-filters">
          <button class="hub-pill active" data-query="Motorradwerkstatt">Werkst\u00e4tten & Shops</button>
          <button class="hub-pill" data-query="Motorradh\u00e4ndler">H\u00e4ndler</button>
          <button class="hub-pill" data-query="Fahrschule">Fahrschulen</button>
        </div>
        <div class="hub-map-wrap">
          <div class="hub-map" id="hub-gmap">
            <div class="hub-map-loading" id="hub-map-loading">
              <span class="hub-map-spinner"></span>
              <span>Standort wird ermittelt\u2026</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══ FOOTER ═══ -->
    <footer class="landing-footer">
      <span class="landing-footer-logo">MotoMatch</span>
      <span class="landing-footer-copy">&copy; 2026 &middot; Alle Rechte vorbehalten</span>
    </footer>
  `;
}

// ══════════════════════════════════════════════════════════════
//  ANIMATIONS (counter + intersection observer)
// ══════════════════════════════════════════════════════════════

function initAnimations(container) {
  const specItems = container.querySelectorAll(".bd-spec-anim");
  let countersStarted = false;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !countersStarted) {
          countersStarted = true;
          specItems.forEach((el, i) => {
            setTimeout(() => el.classList.add("visible"), i * 200);
          });
          setTimeout(() => animateCounters(container), 100);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 },
  );
  if (specItems[0]) observer.observe(specItems[0]);
}

function animateCounters(container) {
  const counters = container.querySelectorAll(".bd-counter");
  counters.forEach((el, idx) => {
    const target = parseFloat(el.dataset.target);
    const decimals = parseInt(el.dataset.decimals) || 0;
    const duration = 1800;
    const startDelay = idx * 150;

    setTimeout(() => {
      const t0 = performance.now();
      function tick(now) {
        const elapsed = now - t0;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        const current = eased * target;
        el.textContent =
          decimals > 0 ? current.toFixed(decimals) : Math.round(current);
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }, startDelay);
  });
}

// ══════════════════════════════════════════════════════════════
//  3D VIEWER (in specs section)
// ══════════════════════════════════════════════════════════════

/* Gemeinsame Formel fuer Initial-Setup und Resize — vorher rechnete der
   Resize-Handler mit einem eigenen Seitenverhaeltnis (w*0.6, Deckel 600),
   das vom Aufbau (w*0.75, Deckel 550) abwich und nach jedem Resize ein
   anderes Bild-Seitenverhaeltnis ergab als beim ersten Rendern. */
function garage3dCanvasSize(wrap) {
  const w = wrap.offsetWidth;
  const h = wrap.offsetHeight || Math.min(w * 0.75, 550);
  return { w, h };
}

async function init3DViewer(bikeData) {
  if (!bikeData.has3D || !bikeData.glb) {
    // Ohne 3D-Modell steht hier der 3D-Ersatz: dasselbe Motorrad im dunklen Studio, 4:3
    // (freigegebene Bikes, tools/catalog/einbau.py).
    const wrap = document.getElementById("gr-3d-wrap");
    if (wrap) {
      // Ohne Studio-Bild steht hier die Silhouette der Bauart (bike-bild.js) — der Rahmen bleibt
      // gefüllt, und die Bildunterschrift sagt, dass das Foto noch kommt.
      wrap.classList.add("bd-3d-canvas-wrap--studio");
      wrap.innerHTML = `<img class="bd-studio-img" src="${bikeBild(bikeData, "studio")}" alt="${bikeData.name} im Studio" loading="lazy" decoding="async">`
        + (bikeData.studio ? "" : '<span class="bd-studio-folgt">Studiofoto folgt</span>');
      // Nebeneinander so hoch wie die Specs-Karte (bündige Kanten), aber nie schmaler als 4:3 — das Format des
      // Studio-Bilds. Mit der vollen Kartenhöhe schnitt object-fit: cover bei schmalen Spalten (800–1100 px
      // Fensterbreite, Rahmen 0,74–1,2) Vorder- und Hinterrad ab. Untereinander (Handy, Tablet hochkant) gilt das
      // 4:3 aus dem CSS; die Kartenhöhe machte den Rahmen dort hochkant (340 × 460 px).
      // Eingefroren, damit das Bild beim Aufklappen der Karte nicht mitwächst. mountAnsicht() ist async →
      // bd-ansicht-embed existiert erst nach dem Import. MutationObserver abwarten.
      const host = document.getElementById("gr-ansicht-host");
      const inner = wrap.closest(".bd-specs-inner");
      if (host && inner) {
        let ansichtObsTimeout = null;
        const obs = new MutationObserver(() => {
          const specsCard = host.querySelector(".bd-ansicht-embed");
          if (specsCard) {
            obs.disconnect();
            if (garageAnsichtObserver === obs) garageAnsichtObserver = null;
            clearTimeout(ansichtObsTimeout);
            requestAnimationFrame(() => {
              if (getComputedStyle(inner).flexDirection === "column") return;
              const h = Math.min(specsCard.offsetHeight, (wrap.offsetWidth * 3) / 4) + "px";
              wrap.style.height = h;
              wrap.style.maxHeight = h;
            });
          }
        });
        garageAnsichtObserver = obs;
        obs.observe(host, { childList: true, subtree: true });
        // mountAnsicht() ist async — scheitert sie (z. B. Ladefehler), erscheint
        // .bd-ansicht-embed nie und der Observer liefe sonst endlos weiter.
        // cleanup() faengt den Regelfall (Seite verlassen) ab, dieses Zeitlimit
        // den Rest.
        ansichtObsTimeout = setTimeout(() => {
          obs.disconnect();
          if (garageAnsichtObserver === obs) garageAnsichtObserver = null;
        }, 10000);
      }
    }
    return;
  }

  const wrap = document.getElementById("gr-3d-wrap");
  const canvas = document.getElementById("gr-3d-canvas");
  if (!wrap || !canvas) return;

  try {
    await loadThree();
  } catch (err) {
    console.error("[MotoMatch] three.js konnte nicht geladen werden", err);
    return;
  }
  // Während des Ladens kann der Nutzer den Screen längst verlassen haben
  if (!canvas.isConnected) return;

  garageScene = new THREE.Scene();
  garageScene.background = null; // transparent — blends with page

  const { w, h } = garage3dCanvasSize(wrap);
  canvas.style.height = h + "px";

  garageCamera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
  garageCamera.position.set(4, 2, 5);

  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);

  garageRenderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  garageRenderer.setClearColor(0x000000, 0);
  garageRenderer.setSize(w, h);
  garageRenderer.setPixelRatio(
    Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2),
  );
  garageRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  garageRenderer.toneMappingExposure = 1.1;

  // Environment for reflections
  const pmrem = new THREE.PMREMGenerator(garageRenderer);
  garageScene.environment = pmrem.fromScene(
    new RoomEnvironment(),
    0.04,
  ).texture;
  pmrem.dispose();

  // Lighting — ambient + directional (no floor/studio)
  garageScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(3, 6, 4);
  garageScene.add(dirLight);

  // Load model
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/draco/");
  loader.setDRACOLoader(dracoLoader);

  const myLoadGen = ++garageLoadGen;
  loader.load(bikeData.glb, (gltf) => {
    // Guard: scene was cleaned up, or a newer load started (Nutzer navigierte
    // weg und wieder zurueck, bevor dieser Fetch fertig war), waehrend das
    // Modell lud — sonst landet dieses Ergebnis in einer fremden Szene.
    if (!garageScene || !garageRenderer || myLoadGen !== garageLoadGen) {
      dracoLoader.dispose();
      return;
    }
    garageBike = gltf.scene;

    // Remove shadow/ground planes
    const toRemove = [];
    garageBike.traverse((child) => {
      if (child.isMesh) {
        const name = (child.name || "").toLowerCase();
        if (
          name.includes("shadow") ||
          name.includes("floor") ||
          name.includes("ground") ||
          name.includes("plane")
        ) {
          toRemove.push(child);
          return;
        }
        if (child.geometry) {
          const geo = child.geometry;
          geo.computeBoundingBox();
          const gSize = geo.boundingBox.getSize(new THREE.Vector3());
          if (gSize.y < gSize.x * 0.01 && gSize.x > 0.5) {
            toRemove.push(child);
            return;
          }
        }
        if (child.material) {
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          mats.forEach((m) => {
            m.side = THREE.DoubleSide;
          });
        }
      }
    });
    toRemove.forEach((obj) => obj.parent?.remove(obj));

    // Normalize scale
    const box = new THREE.Box3().setFromObject(garageBike);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 2.5;
    const scale = targetSize / maxDim;
    garageBike.scale.setScalar(scale);

    // Recalculate after scaling
    const scaledBox = new THREE.Box3().setFromObject(garageBike);
    const scaledSize = scaledBox.getSize(new THREE.Vector3());
    const scaledCenter = scaledBox.getCenter(new THREE.Vector3());

    garageBike.position.x -= scaledCenter.x;
    garageBike.position.z -= scaledCenter.z;
    garageBike.position.y -= scaledBox.min.y;

    // Dynamic camera
    const modelWidth = scaledSize.x;
    const modelDepth = scaledSize.z;
    const modelHeight = scaledSize.y;
    const diagonal = Math.sqrt(
      modelWidth * modelWidth + modelDepth * modelDepth,
    );
    const fovRad = (garageCamera.fov * Math.PI) / 180;
    const fitDist = diagonal / 2 / Math.tan(fovRad / 2);
    // Rand um das Modell. fitDist passt die Grundflaechen-Diagonale in das
    // (vertikale) FOV — bei dem nahezu quadratischen Canvas blieb mit 1.35
    // viel Luft. 1.1 laesst noch Reserve, damit beim Drehen nichts anschneidet.
    camDist = fitDist * 1.1;
    camHeight = modelHeight * 0.6;
    lookAtY = modelHeight * 0.35;

    garageScene.add(garageBike);
    dracoLoader.dispose();
  });

  // Mouse/touch orbit
  let isDragging = false;
  let angle = 0.8;
  let prevX = 0;

  canvas.addEventListener("pointerdown", (e) => {
    isDragging = true;
    prevX = e.clientX;
    canvas.style.cursor = "grabbing";
  });
  const onPointerMove = (e) => {
    if (!isDragging) return;
    angle += (e.clientX - prevX) * 0.008;
    prevX = e.clientX;
  };
  const onPointerUp = () => {
    isDragging = false;
    if (canvas) canvas.style.cursor = "grab";
  };
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvas.style.cursor = "grab";

  // Store references for cleanup
  garageRenderer._pointerMoveHandler = onPointerMove;
  garageRenderer._pointerUpHandler = onPointerUp;

  // Render loop
  function animate() {
    garageRaf = requestAnimationFrame(animate);
    if (!isDragging) angle += 0.003;
    garageCamera.position.x = camDist * Math.sin(angle);
    garageCamera.position.z = camDist * Math.cos(angle);
    garageCamera.position.y = camHeight;
    garageCamera.lookAt(0, lookAtY, 0);
    garageRenderer.render(garageScene, garageCamera);
  }
  animate();

  // Resize
  const onResize = () => {
    const { w: nw, h: nh } = garage3dCanvasSize(wrap);
    canvas.style.height = nh + "px";
    garageRenderer.setSize(nw, nh);
    garageCamera.aspect = nw / nh;
    garageCamera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);
  garageRenderer._resizeHandler = onResize;
}

// ══════════════════════════════════════════════════════════════
//  EVENT BINDINGS
// ══════════════════════════════════════════════════════════════

function bindEvents(bikeData) {
  // Back button → go back to landing. Über die History, damit In-App-Button
  // und Browser-Zurück denselben Weg nehmen; der Fallback greift nur beim
  // Direkteinstieg über ?bike=<name>, wo kein Eintrag darunter liegt.
  document.getElementById("garage-back")?.addEventListener("click", () => {
    if (!navGoBack()) goBack();
  });
  document.getElementById("garage-teilen")?.addEventListener("click", () => teilen(bikeData));
  teilBildVorladen(bikeData);

  // Hinweis-Puls: erst nach 15s Inaktivität starten (siehe scheduleTabHint)
  scheduleTabHint();

  // Sticky nav: toggle .scrolled class + hide hero back button
  const stickyNav = document.getElementById("bd-sticky-nav");
  const heroBack = document.getElementById("garage-back");
  const heroTeilen = document.getElementById("garage-teilen");
  const scrollRoot = document.getElementById("garage-container");
  if (stickyNav && scrollRoot) {
    const checkScrolled = () => {
      const navRect = stickyNav.getBoundingClientRect();
      const rootRect = scrollRoot.getBoundingClientRect();
      const stuck = navRect.top <= rootRect.top - 59;
      stickyNav.classList.toggle("scrolled", stuck);
      if (heroBack) {
        heroBack.style.opacity = stuck ? "0" : "1";
        heroBack.style.pointerEvents = stuck ? "none" : "auto";
      }
      if (heroTeilen) {
        heroTeilen.style.opacity = stuck ? "0" : "1";
        heroTeilen.style.pointerEvents = stuck ? "none" : "auto";
      }
    };
    // #garage-container ist statisch (index.html) und wird nie neu erzeugt —
    // Referenz merken, damit cleanup() den Listener beim naechsten Besuch
    // wieder abmeldet, statt ihn bei jedem loadGarage()/openBikeGarage() ein
    // weiteres Mal draufzulegen.
    garageContainerScrollHandler = checkScrolled;
    scrollRoot.addEventListener("scroll", garageContainerScrollHandler, { passive: true });
    checkScrolled();
  }

  // Hub-Bereich (Werkstätten/Händler/Fahrschulen) lädt erst, wenn er
  // tatsächlich in Sicht kommt — die Tab-Buttons springen zwar direkt in
  // den Konfigurator, der Bereich bleibt aber per Scrollen erreichbar.
  const hubSection = document.querySelector("#garage-container #gr-hub-section");
  if (hubSection) {
    const hubObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            hubAlsOrte();
            hubObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    hubObserver.observe(hubSection);
  }

  // Profil button → Konto-Overlay (kein Tab, daher kein setActiveBtn)
  document.getElementById("gr-profil-btn")?.addEventListener("click", async () => {
    markTabHintSeen();
    stopTabHint();
    const { openAccount } = await import("./account.js");
    openAccount(document.getElementById("gr-tabbar"));
  });

  // Aktiven Reiter setzen — nur innerhalb dieser Leiste, nicht ueber alle
  // .tb-btn im Dokument (die Konto-Leiste ist ein Klon derselben Klasse).
  function setActiveBtn(btn) {
    document
      .querySelectorAll("#gr-tabbar .tb-btn")
      .forEach((b) => b.classList.remove("tb-btn-active"));
    btn?.classList.add("tb-btn-active");
    // Erster Klick auf einen Tab → Hinweis-Puls beenden/verhindern und nie wieder zeigen
    markTabHintSeen();
    stopTabHint();
  }

  /* Alle vier Reiter fuehren in denselben Konfigurator-Tab wie die
     gleichnamigen Reiter dort — eine Leiste, ein Verhalten.

     "Match finden" sprang hier frueher direkt ins Quiz, waehrend derselbe
     Reiter im Konfigurator die Passgenauigkeits-Ansicht oeffnete: gleiche
     Beschriftung, gleiche Stelle, zwei verschiedene Ziele. Das Quiz startet
     jetzt von dort aus ueber "Quiz starten" — ein Klick mehr, dafuer sieht
     man vorher, worauf man sich einlaesst. */
  document.querySelectorAll("#gr-tabbar .tb-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      setActiveBtn(btn);
      const { openKonfigurator } = await import("./bike-detail.js");
      openKonfigurator(bikeData, cleanup, btn.dataset.tab);
    });
  });

  // Hub filter pills
  document.querySelectorAll("#garage-container .hub-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document
        .querySelectorAll("#garage-container .hub-pill")
        .forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      // Orte nicht pausiert lassen (siehe hubAlsOrte) und Karte notfalls neu laden
      // Karte muss im Profil-Bereich stehen (sie wandert zwischen Profil und Karten-Reiter)
      const feld = getHubMap()?.getContainer()
      if (!feld || !feld.closest("#garage-container")) hubAlsOrte();
      else { setHubPlacesPausiert(false); searchNearby(pill.dataset.query); }
    });
  });

  // Retry-Button im Fehlerzustand ("Standort nicht verfügbar") — der Button
  // wird per innerHTML injiziert, daher hier per Delegation binden.
  // Referenz merken (siehe Scroll-Listener oben): #garage-container bleibt
  // ueber Besuche hinweg dasselbe Element, cleanup() meldet diesen Handler ab.
  garageContainerClickHandler = (e) => {
    if (e.target.closest("#hub-retry-btn")) retryHubLocation();
  };
  document.getElementById("garage-container")?.addEventListener("click", garageContainerClickHandler);
}

function isGarageActive() {
  const container = document.getElementById("garage-container");
  return !!container && container.style.display !== "none";
}

function goBack() {
  cleanup();
  const container = document.getElementById("garage-container");
  container.style.display = "none";
  container.innerHTML = "";

  // Show landing
  const landing = document.getElementById("landing");
  landing.style.display = "block";
  landing.style.opacity = "1";
  document.documentElement.classList.add("has-landing");

  // Re-init landing
  import("./landing.js").then((m) => m.initLanding());
}

// ══════════════════════════════════════════════════════════════
//  TAB RENDERING (extras section)
// ══════════════════════════════════════════════════════════════

function renderTab(tab, bikeData, answers) {
  const content = document.getElementById("gr-tab-content");
  if (!content) return;

  // Show the extras section
  const extras = document.getElementById("gr-extras-section");
  if (extras) extras.classList.add("has-content");

  /* Der Reiter "ai" ist entfallen. Er zeigte eine von OpenAI erzeugte
     Begruendung zum Quiz-Ergebnis — sichtbar wurde sie nie, weil renderTab()
     von keiner Stelle aufgerufen wird. Ein Aufruf pro Anzeige haette Geld
     gekostet, gesehen hat ihn niemand. Mit ihm sind src/js/ai.js und
     api/ai-match.js weg. */
  if (tab === "gear") {
    const gear = getGear(bikeData.style);
    /* getGear() liefert je Kategorie eine Liste — hier steht der Einstiegs-
       Vorschlag, also der erste Eintrag. Vorher wurde die Liste selbst ins
       Objekt gespreizt ({ ...gear.helmet }), womit name/type/reason undefined
       waren und die Zeile leer blieb. */
    const items = [
      { ...gear.helmet?.[0], label: "Helm", icon: "helmet" },
      { ...gear.jacket?.[0], label: "Jacke", icon: "jacket" },
      { ...gear.gloves?.[0], label: "Handschuhe", icon: "gloves" },
      { ...gear.boots?.[0], label: "Stiefel", icon: "boots" },
    ].filter((i) => i.name);
    content.innerHTML = `
      <p class="gr-section-label">Empfohlen fur ${bikeData.style}</p>
      ${items
        .map(
          (i) => `
        <div class="gr-gear-row">
          <div class="gr-gear-icon">${gearIcon(i.icon)}</div>
          <div class="gr-gear-info">
            <div class="gr-gear-top">
              <span class="gr-gear-name">${i.name}</span>
              <span class="gr-gear-price">ca. ${i.priceMin}\u2013${i.priceMax} EUR</span>
            </div>
            <span class="gr-gear-meta">${i.type} / ${i.reason}</span>
          </div>
        </div>
      `,
        )
        .join("")}
    `;
  } else if (tab === "market") {
    /* Nur die drei Suchlinks, schon auf dieses Modell eingestellt. Bis 2026-09-21 holte
       /api/search-places über Tavily fünf Websuche-Treffer dazu — Titel und Link ohne
       Preis, oft nur Kategorieseiten, und jede Suche kostete Geld. Die Links zeigen alle
       aktuellen Inserate; was ein gebrauchtes Exemplar kostet, steht schon in den
       Katalogpreisen. Davor sprangen hier erfundene Inserate ein — nie etwas zeigen, das
       wie ein echtes Angebot aussieht, ohne eins zu sein. */
    const urls = buildSearchUrls(bikeData.name);
    content.innerHTML = `
      <p class="gr-section-label">Gebrauchtmarkt</p>
      <div class="gr-market-list">
        <p class="gr-meta-text">
          Aktuelle Inserate findest du direkt bei den großen Marktplätzen \u2014 die Suche
          ist schon auf dieses Modell eingestellt.
        </p>
      </div>
      <div class="gr-market-links">
        <a href="${urls.kleinanzeigen}" target="_blank" rel="noopener" class="gr-market-link">Kleinanzeigen</a>
        <a href="${urls.mobile}" target="_blank" rel="noopener" class="gr-market-link">Mobile.de</a>
        <a href="${urls.ebay}" target="_blank" rel="noopener" class="gr-market-link">eBay</a>
      </div>
    `;
  } else if (tab === "map") {
    // Redirect to hub section
    document
      .querySelector("#garage-container #gr-hub-section")
      ?.scrollIntoView({ behavior: "smooth" });
    hubAlsOrte();
  }
}

// ══════════════════════════════════════════════════════════════
//  HUB MAP — lebt seit 2026-10-03 in karte.js (MapLibre + eigene OSM-Daten).
//  Hier stand die Google-Maps-Fassung samt Places-Suche; panHubToCoords
//  wird für landing.js weiter von hier aus angeboten.
// ══════════════════════════════════════════════════════════════
export { panHubToCoords };

// ══════════════════════════════════════════════════════════════
//  HUB SCROLL EFFECT (map shrinks on scroll)
// ══════════════════════════════════════════════════════════════

let hubScrollHandler = null;
let hubScrollRAF = null;

/**
 * Sobald die Tab-Leiste beim Scrollen oben andockt, schaltet sie auf die
 * dunkle Variante (.scrolled) — dieselbe wie im Konfigurator. Frei stehend
 * unter dem Hero bleibt sie hell.
 */
let tabbarThemeHandler = null;

/**
 * Setzt die Ansicht-Seite in die linke Spalte der Spec-Section. Laeuft ueber
 * einen dynamischen Import, damit bike-detail.js nicht in den Garage-Chunk
 * wandert — die Spalte ist fuer einen Moment leer, das ist gewollt.
 */
async function mountAnsicht(bikeData) {
  const host = document.getElementById("gr-ansicht-host");
  if (!host) return;
  try {
    const {
      normalizeGarageData,
      buildDetailsAnsichtHTML,
      bindDetailsAnsichtEvents,
      openKonfigurator,
    } = await import("./bike-detail.js");
    host.innerHTML = buildDetailsAnsichtHTML(normalizeGarageData(bikeData));
    bindDetailsAnsichtEvents(host.querySelector(".bd-ansicht-embed"), (tab) =>
      openKonfigurator(bikeData, cleanup, tab),
    );
  } catch {
    /* Spalte bleibt leer — der Rest der Seite funktioniert weiter */
  }
}

function initTabbarThemeSync() {
  if (tabbarThemeHandler) return;

  const nav = document.getElementById("bd-sticky-nav");
  if (!nav) return;

  const scrollTarget = document.getElementById("garage-container") || window;
  // Der Sticky-Offset steht im CSS (negativ, damit die Bar knapp unter dem
  // Fensterrand einrastet) — von dort lesen, statt ihn hier zu wiederholen.
  const stickyTop = parseFloat(getComputedStyle(nav).top) || 0;

  let ticking = false;
  tabbarThemeHandler = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const rootTop =
        scrollTarget === window ? 0 : scrollTarget.getBoundingClientRect().top;
      const docked = nav.getBoundingClientRect().top - rootTop <= stickyTop + 1;
      nav.classList.toggle("scrolled", docked);
    });
  };

  scrollTarget.addEventListener("scroll", tabbarThemeHandler, { passive: true });
  tabbarThemeHandler._scrollTarget = scrollTarget;
  tabbarThemeHandler();
}

function initHubScrollEffect() {
  if (hubScrollHandler) return;

  const mapWrap = document.querySelector(".hub-map-wrap");
  if (!mapWrap) return;

  const hubMap = mapWrap.querySelector(".hub-map");
  mapWrap.style.willChange = "transform";
  mapWrap.style.transformOrigin = "center center";

  // Lerped values for butter-smooth interpolation
  let currentScale = 1;
  let currentRadius = 24;
  let targetScale = 1;
  let targetRadius = 24;
  let ticking = false;

  // Ease-out cubic for natural deceleration
  const lerp = (a, b, t) => a + (b - a) * t;

  function applyTransform() {
    // Lerp toward target — 0.08 factor = ~12 frames to settle, silky smooth
    currentScale = lerp(currentScale, targetScale, 0.08);
    currentRadius = lerp(currentRadius, targetRadius, 0.08);

    // Snap when close enough to avoid infinite micro-updates
    if (Math.abs(currentScale - targetScale) < 0.0005) {
      currentScale = targetScale;
      currentRadius = targetRadius;
    }

    mapWrap.style.transform = `scale(${currentScale})`;
    if (hubMap) hubMap.style.borderRadius = `${currentRadius}px`;

    // Keep animating while not settled
    if (currentScale !== targetScale) {
      hubScrollRAF = requestAnimationFrame(applyTransform);
    } else {
      ticking = false;
    }
  }

  hubScrollHandler = () => {
    const rect = mapWrap.getBoundingClientRect();
    const vh = window.innerHeight;

    // progress: 0 when map top is at viewport bottom, 1 when at top
    const progress = Math.max(0, Math.min(1, 1 - rect.top / vh));

    // Scale 1.0 → 0.92, radius 24 → 44
    targetScale = 1 - progress * 0.08;
    targetRadius = 24 + progress * 20;

    if (!ticking) {
      ticking = true;
      hubScrollRAF = requestAnimationFrame(applyTransform);
    }
  };

  const scrollTarget = document.getElementById("garage-container") || window;
  scrollTarget.addEventListener("scroll", hubScrollHandler, { passive: true });
  // Store reference for cleanup
  hubScrollHandler._scrollTarget = scrollTarget;
}

// ══════════════════════════════════════════════════════════════
//  SHARE
// ══════════════════════════════════════════════════════════════

/**
 * Teilen-Knopf auf dem Deckblatt. Geteilt wird der Direktlink auf genau diese Seite
 * (?motorrad=<slug>, app.js) — wer ihn öffnet, landet hier und nicht auf der Startseite.
 * Wo es ein Pin-Bild gibt (public/pins, scripts/pins/bauen.mjs), geht es als Bild mit:
 * in WhatsApp und Instagram-Story wirkt das stärker als ein nackter Link.
 * Das Bild wird beim Öffnen der Seite vorgeladen — Safari erlaubt navigator.share nur
 * direkt im Tipp, ein fetch dazwischen kostet die Freigabe.
 */
let teilBild = null;
const teilSlug = (bike) => String(bike?.slug || "").toLowerCase().replace(/_/g, "-");

function teilBildVorladen(bike) {
  teilBild = null;
  const slug = teilSlug(bike);
  if (!slug || !hatFoto(bike) || !navigator.canShare) return;
  fetch(`/pins/${slug}.jpg`)
    .then((r) => (r.ok && /image/.test(r.headers.get("content-type") || "") ? r.blob() : null))
    .then((blob) => {
      if (!blob || teilSlug(bike) !== slug) return;
      const datei = new File([blob], `motomatch-${slug}.jpg`, { type: "image/jpeg" });
      if (navigator.canShare({ files: [datei] })) teilBild = { slug, datei };
    })
    .catch(() => {});
}

async function teilen(bike) {
  const slug = teilSlug(bike);
  const url = slug ? `${location.origin}/?motorrad=${slug}&utm_source=teilen` : location.href;
  const text = `${bike.name} – passt sie zu dir? Schau sie dir auf MotoMatch an:`;
  try {
    if (navigator.share) {
      const datei = teilBild?.slug === slug ? teilBild.datei : null;
      // Mit Bild den Link in den Text: manche Apps verwerfen das url-Feld neben einer Datei
      await navigator.share(datei
        ? { title: `MotoMatch: ${bike.name}`, text: `${text} ${url}`, files: [datei] }
        : { title: `MotoMatch: ${bike.name}`, text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    zeigeToast("Link kopiert ✓");
  } catch (err) {
    if (err?.name !== "AbortError") zeigeToast("Teilen hat nicht geklappt.");
  }
}

function zeigeToast(text, { duration = 2800 } = {}) {
  let el = document.getElementById("mm-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "mm-toast";
    el.className = "mm-toast";
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove("mm-toast--show");
  void el.offsetWidth; // force reflow so re-adding the class triggers transition
  el.classList.add("mm-toast--show");
  clearTimeout(el._t);
  el._t = duration > 0 ? setTimeout(() => el.classList.remove("mm-toast--show"), duration) : null;
  return el;
}

// ══════════════════════════════════════════════════════════════
//  CLEANUP
// ══════════════════════════════════════════════════════════════

function cleanup() {
  clearTabHintTimers();
  if (garageAnsichtObserver) {
    garageAnsichtObserver.disconnect();
    garageAnsichtObserver = null;
  }
  const gcEl = document.getElementById("garage-container");
  if (garageContainerScrollHandler) {
    gcEl?.removeEventListener("scroll", garageContainerScrollHandler);
    garageContainerScrollHandler = null;
  }
  if (garageContainerClickHandler) {
    gcEl?.removeEventListener("click", garageContainerClickHandler);
    garageContainerClickHandler = null;
  }
  if (hubScrollHandler) {
    const target = hubScrollHandler._scrollTarget || window;
    target.removeEventListener("scroll", hubScrollHandler);
    hubScrollHandler = null;
  }
  if (hubScrollRAF) {
    cancelAnimationFrame(hubScrollRAF);
    hubScrollRAF = null;
  }
  if (tabbarThemeHandler) {
    const target = tabbarThemeHandler._scrollTarget || window;
    target.removeEventListener("scroll", tabbarThemeHandler);
    tabbarThemeHandler = null;
  }
  if (garageRaf) {
    cancelAnimationFrame(garageRaf);
    garageRaf = null;
  }
  if (garageRenderer) {
    if (garageRenderer._resizeHandler) {
      window.removeEventListener("resize", garageRenderer._resizeHandler);
    }
    if (garageRenderer._pointerMoveHandler) {
      window.removeEventListener("pointermove", garageRenderer._pointerMoveHandler);
    }
    if (garageRenderer._pointerUpHandler) {
      window.removeEventListener("pointerup", garageRenderer._pointerUpHandler);
    }
    garageRenderer.dispose();
    garageRenderer = null;
  }
  if (garageScene) {
    garageScene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.map) m.map.dispose();
          if (m.normalMap) m.normalMap.dispose();
          if (m.roughnessMap) m.roughnessMap.dispose();
          if (m.metalnessMap) m.metalnessMap.dispose();
          if (m.aoMap) m.aoMap.dispose();
          if (m.emissiveMap) m.emissiveMap.dispose();
          if (m.envMap) m.envMap.dispose();
          m.dispose();
        });
      }
    });
    if (garageScene.environment) garageScene.environment.dispose();
    garageScene = null;
  }
  garageCamera = null;
  garageBike = null;

  // Suchzustand zuruecksetzen — die Karte selbst bleibt und wird beim
  // naechsten initHubMap() weiterverwendet.
  resetHubSuche();
}
