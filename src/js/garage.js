/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — garage.js  v3.0
 *  Porsche-style Quiz Result Page
 *
 *  Layout (scrollable, like bike-detail.js):
 *    Section 1: Hero — bg text + cutout image + name/badge/price/actions
 *    Section 2: Specs — animated counters (left) + 3D model (right)
 *    Section 3: KI-Analyse + Gear + Markt + Map (tabbed)
 *    Footer
 *
 *  3D: DRACOLoader + MeshoptDecoder, adaptive shadows, PMREM env
 * ══════════════════════════════════════════════════════════════
 */

import * as THREE from "three";
import { enterScreen, goBack as navGoBack } from "./nav.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  findBestBike,
  findTopMatches,
  findBikeByShortName,
  scoreBikeAgainst,
} from "./matching.js";
import { addMatch } from "./match-history.js";
import { getGear } from "./gear.js";
import { getStaticListings, getLiveListings } from "./marketplace.js";
import { getAIExplanation } from "./ai.js";
import { findNearby } from "./dealers.js";
import { esc } from "./util.js";

// Einmaliger, dezenter Puls auf der Tab-Leiste, damit Nutzer merken, dass
// hinter "Profil"/"Ausrüstung"/etc. mehr Inhalt steckt.
const TABHINT_KEY = "mm_tabhint_seen_v1";
function tabHintSeen() {
  try { return !!localStorage.getItem(TABHINT_KEY); } catch { return true; }
}
function markTabHintSeen() {
  try { localStorage.setItem(TABHINT_KEY, "1"); } catch {}
}

const GMAPS_KEY = import.meta.env.VITE_GMAPS_KEY;

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
let camDist = 5,
  camHeight = 1.5,
  lookAtY = 0.45;
let userLat = 51.77,
  userLng = 7.444;
let userLocationKnown = false;
let gmapsLoadPromise = null;
let geoPromise = null;

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

  const bikeData = findBestBike(answers);
  const topMatches = findTopMatches(answers, 5);

  console.info(`[garage] Matched: ${bikeData.name}`);

  // Sieger des Durchlaufs in die Match-Chronik — der Match-Reiter im
  // Konfigurator liest sie aus.
  const winner = topMatches[0];
  addMatch(bikeData, {
    score: winner?.score,
    pct: winner ? scoreBikeAgainst(bikeData, answers)?.pct : null,
    source: 'quiz',
  });

  // Preload Google Maps + geolocation in background — only after consent
  if (hasMapsConsent()) {
    loadGoogleMapsScript();
    getUserLocation();
  }

  // Build the full page
  container.innerHTML = buildPage(bikeData);
  container.scrollTop = 0;
  window.scrollTo(0, 0);

  // Animate hero image in
  requestAnimationFrame(() => {
    container.style.opacity = "1";
    initAnimations(container);
    init3DViewer(bikeData);
    bindEvents(bikeData, answers);
    initHubScrollEffect();
    initTabbarThemeSync();
    mountAnsicht(bikeData);
  });
}

/**
 * Open the garage page directly for a bike (from landing page cards).
 * No quiz answers needed — same full-featured page.
 */
export function openBikeGarage(shortName) {
  const bikeData = findBikeByShortName(shortName);
  if (!bikeData) {
    import('./landing.js').then(m => m.initLanding());
    // Reuse the existing mm-toast style — no new CSS introduced
    let el = document.getElementById('mm-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mm-toast';
      el.className = 'mm-toast';
      document.body.appendChild(el);
    }
    el.textContent = 'Bike nicht gefunden.';
    el.classList.remove('mm-toast--show');
    void el.offsetWidth; // force reflow so re-adding the class triggers transition
    el.classList.add('mm-toast--show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('mm-toast--show'), 2800);
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

    if (hasMapsConsent()) {
      loadGoogleMapsScript();
      getUserLocation();
    }

    container.innerHTML = buildPage(bikeData, false);
    container.scrollTop = 0;
    window.scrollTo(0, 0);

    requestAnimationFrame(() => {
      container.style.opacity = "1";
      initAnimations(container);
      init3DViewer(bikeData);
      bindEvents(bikeData, null);
      initHubScrollEffect();
      initTabbarThemeSync();
      mountAnsicht(bikeData);
    });
  }, 220);
}

// ══════════════════════════════════════════════════════════════
//  PAGE BUILDER
// ══════════════════════════════════════════════════════════════

function buildPage(bike, fromQuiz = true) {
  const priceDisplay =
    bike.priceDisplay || `Ab EUR ${bike.price.split("-")[0]}`;

  return `
    <!-- ═══ SECTION 1: Hero (Porsche-style) ═══ -->
    <section class="bd-hero">
      <button class="bd-back" id="garage-back">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>

      <!-- Wortmarke sitzt in der Bildbox, damit sie an das Motorrad
           gekoppelt bleibt statt an die Hero-Hoehe. -->
      <div class="bd-hero-img-wrap">
        <div class="bd-hero-bg-text">${bike.bgText || bike.name}</div>
        <img class="bd-hero-img" src="${bike.image2 || bike.image}" alt="${bike.name}">
      </div>

      <div class="bd-hero-info">
        ${fromQuiz ? '<p class="gr-match-label">Dein perfektes Match</p>' : ""}
        <h1 class="bd-model-name">${bike.name}</h1>
        <span class="bd-badge">${bike.style}</span>
        <p class="bd-price">${priceDisplay} inkl. MwSt.</p>
      </div>
    </section>

    <!-- ═══ Sticky Touch Bar ═══ -->
    <div class="tb-wrap" id="bd-sticky-nav">
      <nav class="tb-bar" id="gr-tabbar">
        <button class="tb-btn" type="button" id="gr-profil-btn">Profil</button>
        <button class="tb-btn" id="gr-nav-gear">Ausr\u00fcstung</button>
        <button class="tb-btn tb-btn-active" id="gr-share-btn"><span class="tb-lbl-lang">Match finden</span><span class="tb-lbl-kurz">Match</span></button>
        <button class="tb-btn" id="gr-nav-hub">Community</button>
        <button class="tb-btn" id="gr-nav-market">Karte</button>
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

function init3DViewer(bikeData) {
  if (!bikeData.has3D || !bikeData.glb) return;

  const wrap = document.getElementById("gr-3d-wrap");
  const canvas = document.getElementById("gr-3d-canvas");
  if (!wrap || !canvas) return;

  garageScene = new THREE.Scene();
  garageScene.background = null; // transparent — blends with page

  const w = wrap.offsetWidth;
  const h = wrap.offsetHeight || Math.min(w * 0.75, 550);
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
  dracoLoader.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  );
  loader.setDRACOLoader(dracoLoader);

  loader.load(bikeData.glb, (gltf) => {
    // Guard: scene was cleaned up while model was loading
    if (!garageScene || !garageRenderer) {
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
    const nw = wrap.offsetWidth;
    const nh = Math.min(nw * 0.6, 600);
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

function bindEvents(bikeData, answers) {
  const fromQuiz = answers !== null;

  // Back button → go back to landing. Über die History, damit In-App-Button
  // und Browser-Zurück denselben Weg nehmen; der Fallback greift nur beim
  // Direkteinstieg über ?bike=<name>, wo kein Eintrag darunter liegt.
  document.getElementById("garage-back")?.addEventListener("click", () => {
    if (!navGoBack()) goBack();
  });

  // Hinweis-Puls: erst nach 15s Inaktivität starten (siehe scheduleTabHint)
  scheduleTabHint();

  // Sticky nav: toggle .scrolled class + hide hero back button
  const stickyNav = document.getElementById("bd-sticky-nav");
  const heroBack = document.getElementById("garage-back");
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
    };
    scrollRoot.addEventListener("scroll", checkScrolled, { passive: true });
    checkScrolled();
  }

  // Hub-Bereich (Werkstätten/Händler/Fahrschulen) lädt erst, wenn er
  // tatsächlich in Sicht kommt — die Tab-Buttons springen zwar direkt in
  // den Konfigurator, der Bereich bleibt aber per Scrollen erreichbar.
  const hubSection = document.getElementById("gr-hub-section");
  if (hubSection) {
    const hubObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            initHubMap();
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

  // Match finden button → start quiz
  document.getElementById("gr-share-btn")?.addEventListener("click", () => {
    setActiveBtn("gr-share-btn");
    cleanup();
    const container = document.getElementById("garage-container");
    container.style.display = "none";
    container.innerHTML = "";
    document.getElementById("quiz-screen").style.display = "flex";
    import("./quiz.js").then((m) => m.initQuiz());
  });

  // Helper: set active button
  function setActiveBtn(activeId) {
    document
      .querySelectorAll(".tb-btn")
      .forEach((b) => b.classList.remove("tb-btn-active"));
    document.getElementById(activeId)?.classList.add("tb-btn-active");
    // Erster Klick auf einen Tab → Hinweis-Puls beenden/verhindern und nie wieder zeigen
    markTabHintSeen();
    stopTabHint();
  }

  // Nav buttons → direkt zum passenden Konfigurator-Tab wechseln (kein Scrollen auf dem Deckblatt)
  const navMap = {
    "gr-nav-gear": "ausstattung",
    "gr-nav-market": "karte",
    "gr-nav-hub": "community",
  };
  Object.entries(navMap).forEach(([id, tab]) => {
    document.getElementById(id)?.addEventListener("click", async () => {
      setActiveBtn(id);
      const { openKonfigurator } = await import("./bike-detail.js");
      openKonfigurator(bikeData, cleanup, tab);
    });
  });

  // Hub filter pills
  document.querySelectorAll(".hub-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      document
        .querySelectorAll(".hub-pill")
        .forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      searchNearby(pill.dataset.query);
      // Falls die Karte noch nicht (oder nicht mehr) verfügbar ist, im
      // Hintergrund einen neuen Ladeversuch starten (z. B. nach Netzwerkfehler)
      if (!hubMapInstance) initHubMap();
    });
  });

  // Retry-Button im Fehlerzustand ("Standort nicht verfügbar") — der Button
  // wird per innerHTML injiziert, daher hier per Delegation binden.
  document.getElementById("garage-container")?.addEventListener("click", (e) => {
    if (e.target.closest("#hub-retry-btn")) retryHubLocation();
  });
}

export function retryHubLocation() {
  const loader = document.getElementById("hub-map-loading");
  if (loader) {
    loader.innerHTML = `
      <span class="hub-map-spinner"></span>
      <span>Standort wird ermittelt…</span>
    `;
  }
  getUserLocation().then(() => initHubMap());
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

  if (tab === "ai") {
    if (!answers) {
      content.innerHTML = `
        <div class="gr-ai-section">
          <p class="gr-ai-text">Starte das Quiz, um eine personalisierte KI-Analyse zu erhalten.</p>
        </div>
      `;
      return;
    }
    content.innerHTML = `
      <div class="gr-ai-section">
        <p class="gr-ai-text" id="gr-ai-text">Wird geladen...</p>
      </div>
    `;
    getAIExplanation(answers, bikeData)
      .then((text) => {
        const el = document.getElementById("gr-ai-text");
        if (el) el.textContent = text;
      })
      .catch(() => {
        const el = document.getElementById("gr-ai-text");
        if (el) el.textContent = "Nicht verfügbar.";
      });
  } else if (tab === "gear") {
    const gear = getGear(bikeData.style);
    const items = [
      { ...gear.helmet, label: "Helm" },
      { ...gear.jacket, label: "Jacke" },
      { ...gear.gloves, label: "Handschuhe" },
      { ...gear.boots, label: "Stiefel" },
    ];
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
              <span class="gr-gear-price">${i.price}</span>
            </div>
            <span class="gr-gear-meta">${i.type} / ${i.reason}</span>
          </div>
        </div>
      `,
        )
        .join("")}
    `;
  } else if (tab === "market") {
    const { items: staticItems, urls } = getStaticListings(
      bikeData.id,
      bikeData.name,
    );
    content.innerHTML = `
      <p class="gr-section-label">Gebrauchtmarkt</p>
      <div id="gr-market-listings" class="gr-market-list">
        <p class="gr-meta-text">Suche Angebote...</p>
      </div>
      <div class="gr-market-links">
        <a href="${urls.kleinanzeigen}" target="_blank" rel="noopener" class="gr-market-link">Kleinanzeigen</a>
        <a href="${urls.mobile}" target="_blank" rel="noopener" class="gr-market-link">Mobile.de</a>
        <a href="${urls.ebay}" target="_blank" rel="noopener" class="gr-market-link">eBay</a>
      </div>
    `;
    getLiveListings(bikeData.name)
      .then(({ items }) => {
        const el = document.getElementById("gr-market-listings");
        if (!el || items.length === 0) throw new Error("no results");
        el.innerHTML = items
          .map(
            (item) => `
          <a href="${esc(item.url)}" target="_blank" rel="noopener" class="gr-listing-item">
            <span class="gr-listing-title">${esc(item.title)}</span>
            <span class="gr-listing-meta">${esc(item.source)}</span>
          </a>
        `,
          )
          .join("");
      })
      .catch(() => {
        const el = document.getElementById("gr-market-listings");
        if (!el) return;
        el.innerHTML = staticItems
          .map(
            (item) => `
          <div class="gr-listing-item">
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
              <span class="gr-listing-title">${item.title}</span>
              <span class="gr-listing-price">${item.price}</span>
            </div>
            <span class="gr-listing-meta">${item.year} / ${item.km} km / ${item.location}</span>
          </div>
        `,
          )
          .join("");
      });
  } else if (tab === "map") {
    // Redirect to hub section
    document
      .getElementById("gr-hub-section")
      ?.scrollIntoView({ behavior: "smooth" });
    initHubMap();
  }
}

// ══════════════════════════════════════════════════════════════
//  HUB MAP (Apple Maps Style)
// ══════════════════════════════════════════════════════════════

let hubMapInstance = null;
let hubMarkers = [];
let hubInfoWindow = null;

const MAPS_CONSENT_KEY = 'mm_maps_consent_v1';
export function hasMapsConsent() {
  try { return localStorage.getItem(MAPS_CONSENT_KEY) === '1'; } catch { return false; }
}
function setMapsConsent() {
  try { localStorage.setItem(MAPS_CONSENT_KEY, '1'); } catch {}
}
function renderMapsConsentPlaceholder(el) {
  // Aussehen liegt in main.css (.hub-map-consent) — im Karten-Tab muss der
  // Block dem schwebenden Ergebnis-Panel ausweichen, und das geht mit Inline-
  // Stilen nicht, ohne sie mit !important zu ueberschreiben.
  el.innerHTML = `
    <div class="hub-map-consent" id="hub-map-consent">
      <p class="hub-map-consent-text">
        Die Karte lädt Daten von <strong>Google Maps</strong>. Dabei wird deine
        IP-Adresse an Google übertragen. Details in der
        <a href="#" data-open-legal="datenschutz">Datenschutzerklärung</a>.
      </p>
      <button type="button" id="hub-map-consent-btn" class="tb-btn hub-map-consent-btn">
        Karte laden
      </button>
    </div>`;
  el.querySelector('#hub-map-consent-btn')?.addEventListener('click', () => {
    setMapsConsent();
    el.innerHTML = `
      <div class="hub-map-loading" id="hub-map-loading">
        <span class="hub-map-spinner"></span>
        <span>Standort wird ermittelt…</span>
      </div>`;
    initHubMap();
  });
}

/* Bibliotheken, die der Hub tatsächlich anfasst — siehe die google.maps.*-
   Aufrufstellen weiter unten:
     core      → ControlPosition, SymbolPath, Point, Size, event
     maps      → Map, InfoWindow
     marker    → Marker
     places    → PlacesService, PlacesServiceStatus
     geocoding → Geocoder
   Mit loading=async liefert der Bootstrap beim script.onload nur einen
   Platzhalter: google.maps existiert, die Konstruktoren und Konstanten aber
   noch nicht. Wer direkt danach google.maps.Map oder ControlPosition benutzt,
   läuft in "Cannot read properties of undefined". Erst importLibrary() füllt
   den Namensraum — und zwar auch den klassischen google.maps.*, sodass die
   bestehenden Aufrufstellen unverändert gültig bleiben. */
const GMAPS_LIBRARIES = ["core", "maps", "marker", "places", "geocoding"];
let gmapsReady = false;

function loadGoogleMapsScript() {
  // Nicht auf window.google.maps prüfen: das ist mit loading=async schon
  // gesetzt, solange die Bibliotheken noch fehlen.
  if (gmapsReady) return Promise.resolve();
  if (gmapsLoadPromise) return gmapsLoadPromise;
  gmapsLoadPromise = new Promise((resolve, reject) => {
    let timer = null;
    const fail = (err) => {
      clearTimeout(timer);
      gmapsLoadPromise = null; // nächster Versuch darf frisch starten
      reject(err);
    };
    const loadLibraries = async () => {
      try {
        // Nach dem callback ist der klassische Namensraum bereits befüllt;
        // importLibrary holt zusätzlich marker/geocoding, die nicht in der
        // libraries=-Liste stehen. Fehlt die Funktion wider Erwarten, reicht
        // der bereits befüllte Namensraum für die genutzten Symbole aus.
        if (typeof google.maps.importLibrary === "function") {
          await Promise.all(
            GMAPS_LIBRARIES.map((lib) => google.maps.importLibrary(lib)),
          );
        }
        clearTimeout(timer);
        gmapsReady = true;
        resolve();
      } catch (err) {
        // Grund durchreichen statt verschlucken — sonst ist im Fehlerfall
        // nicht zu unterscheiden, ob der Schlüssel, eine nicht freigeschaltete
        // API oder das Netz das Problem ist.
        fail(
          new Error(
            `Google Maps: Bibliotheken konnten nicht geladen werden (${err?.message || err})`,
          ),
        );
      }
    };
    // Zeitlimit deckt Skript *und* Bibliotheken ab — ein hängendes
    // importLibrary darf den Aufrufer nicht ewig warten lassen.
    timer = setTimeout(
      () => fail(new Error("Google Maps: Ladezeit überschritten")),
      8000,
    );
    // Bootstrap schon vorhanden (z. B. vorheriger Versuch): nur Bibliotheken holen.
    if (window.google?.maps?.importLibrary) {
      loadLibraries();
      return;
    }
    // script.onload ist bei loading=async das falsche Signal: es feuert, bevor
    // die API sich eingerichtet hat — zu dem Zeitpunkt fehlt selbst
    // google.maps.importLibrary noch. Der callback-Parameter ist der von
    // Google vorgesehene Fertig-Zeitpunkt; erst danach steht der Namensraum.
    const cbName = `__mmGmapsReady${Date.now().toString(36)}`;
    window[cbName] = () => {
      delete window[cbName];
      loadLibraries();
    };
    const s = document.createElement("script");
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}` +
      `&libraries=places&loading=async&callback=${cbName}`;
    s.async = true;
    s.onerror = () => {
      delete window[cbName];
      fail(new Error("Google Maps: Skript konnte nicht geladen werden"));
    };
    document.head.appendChild(s);
  });
  return gmapsLoadPromise;
}

function getUserLocation() {
  if (geoPromise) return geoPromise;
  geoPromise = new Promise((resolve) => {
    if (!navigator.geolocation) return resolve();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLat = pos.coords.latitude;
        userLng = pos.coords.longitude;
        userLocationKnown = true;

        // If map already initialized, re-center and re-search
        if (hubMapInstance) {
          hubMapInstance.setCenter({ lat: userLat, lng: userLng });
          const activePill = document.querySelector(".hub-pill.active");
          if (activePill) searchNearby(activePill.dataset.query);
        }

        resolve();
      },
      (err) => {
        // Geolocation abgelehnt/fehlgeschlagen — nächster Aufruf (z. B. erneutes
        // Öffnen des Bereichs) darf automatisch einen neuen Versuch starten.
        geoPromise = null;
        const loader = document.getElementById("hub-map-loading");
        if (loader) {
          loader.innerHTML = `
            <div style="font-size:32px;margin-bottom:8px">📍</div>
            <div style="font-weight:700;color:#fff;margin-bottom:4px">Standort nicht verfügbar</div>
            <div style="font-size:12px;color:#888;max-width:280px;text-align:center;line-height:1.4">
              Bitte erlaube den Standortzugriff im Browser, damit Ergebnisse in deiner Nähe angezeigt werden können.
            </div>
            <button type="button" class="hub-retry-btn" id="hub-retry-btn">Standort erneut anfragen</button>
          `;
        }
        resolve();
      },
      { timeout: 8000, enableHighAccuracy: true, maximumAge: 60000 },
    );
  });
  return geoPromise;
}

// Premium dark map style
const MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#242424" }] },
  { elementType: "geometry.stroke", stylers: [{ visibility: "off" }] },
  { elementType: "labels", stylers: [{ visibility: "off" }] },
  {
    featureType: "water",
    elementType: "geometry.fill",
    stylers: [{ color: "#121212" }],
  },
  {
    featureType: "water",
    elementType: "geometry.stroke",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "geometry.fill",
    stylers: [{ color: "#5c5c5c" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ visibility: "off" }],
  },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", stylers: [{ visibility: "off" }] },
  {
    featureType: "landscape",
    elementType: "geometry.stroke",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "landscape",
    elementType: "geometry.fill",
    stylers: [{ color: "#242424" }],
  },
];

// Premium marker colors per filter type
const QUERY_COLORS = {
  Motorradwerkstatt: { fill: "#c9a84c", stroke: "#a88a3a", label: "Werkstatt" },
  "Motorradh\u00e4ndler": {
    fill: "#7ab8f5",
    stroke: "#4a90d9",
    label: "H\u00e4ndler",
  },
  Fahrschule: { fill: "#d0d0d0", stroke: "#999", label: "Fahrschule" },
};

// Map filter → dealers.js type for fallback
const FILTER_TO_DEALER_TYPE = {
  Motorradwerkstatt: "Werkstatt",
  "Motorradh\u00e4ndler": "H\u00e4ndler",
  Fahrschule: "Fahrschule",
};

// All possible search keywords per filter
const FILTER_KEYWORDS = {
  Motorradwerkstatt: [
    "Motorrad Werkstatt",
    "Motorrad Service",
    "Zweirad Werkstatt",
    "Motorrad Reparatur",
    "Zweirad Service",
    "Motorrad Inspektion",
    "Motorrad Meisterbetrieb",
    "Motorrad Garage",
    "Motorrad Tuning",
    "Zweiradmechatroniker",
  ],
  Motorradhändler: [
    "Motorrad Händler",
    "Motorrad Shop",
    "Zweirad Händler",
    "Motorrad Center",
    "Motorradhaus",
    "Bike Shop",
    "Motorrad Verkauf",
    "BMW Motorrad",
    "Honda Motorrad",
    "Harley Davidson",
  ],
  Fahrschule: [
    "Fahrschule",
    "Fahrschule Motorrad",
    "Führerschein Motorrad",
    "Motorrad Fahrschule",
    "Fahrschule Klasse A",
    "Führerschein A2",
    "Fahrausbildung Motorrad",
    "Motorradausbildung",
  ],
  Tankstelle: [
    "Tankstelle",
    "Aral Tankstelle",
    "Shell Tankstelle",
    "Esso Tankstelle",
    "Total Tankstelle",
    "Jet Tankstelle",
  ],
  Parkplatz: [
    "Motorrad Parkplatz",
    "Parkhaus",
    "Parkplatz",
  ],
  Cafe: [
    "Motorrad Café",
    "Biker Treffpunkt",
    "Café",
    "Motorrad Treff",
  ],
  Notdienst: [
    "Motorrad Pannendienst",
    "ADAC",
    "Pannenhilfe",
    "Motorrad Notdienst",
    "Abschleppdienst Motorrad",
  ],
};

// Helper: get current search results with full place data
export function getHubSearchResults() {
  const myLat = userLat, myLng = userLng
  return (_allSearchResults || []).slice(0, MAX_RESULTS).map((place) => {
    const lat = place.geometry?.location?.lat?.() || 0
    const lng = place.geometry?.location?.lng?.() || 0
    return {
      placeId: place.place_id,
      name: place.name || '—',
      address: place.formatted_address || place.vicinity || '',
      rating: place.rating || null,
      userRatings: place.user_ratings_total || 0,
      isOpen: place.opening_hours?.open_now ?? null,
      lat, lng,
      distanceKm: haversineKm(myLat, myLng, lat, lng),
    }
  }).sort((a, b) => a.distanceKm - b.distanceKm)
}
// Helper: get current visible search markers (used by bike-detail Karte view)
export function getHubMarkers() {
  return (hubMarkers || []).map((m) => ({
    title: m.getTitle?.() || '',
    position: m.getPosition?.()?.toJSON?.() || null,
    marker: m,
  }));
}
// Focus map on a specific result (open InfoWindow + center)
/* Liefert false, wenn es zu der Kennung keinen Marker gibt — die Karten-
   Ansicht faellt dann auf panHubToCoords() zurueck. Das kommt bei gemerkten
   Orten vor, die ausserhalb der aktuellen Trefferliste liegen. */
export function focusHubResult(placeId) {
  if (!hubMapInstance) return false
  const idx = (_allSearchResults || []).findIndex((p) => p.place_id === placeId)
  if (idx < 0) return false
  const place = _allSearchResults[idx]
  const marker = hubMarkers[idx]
  if (!marker || !place) return false
  hubMapInstance.panTo(place.geometry.location)
  hubMapInstance.setZoom(15)
  if (hubInfoWindow) {
    hubInfoWindow.setContent(buildInfoContent(place, _lastSearchFilter))
    hubInfoWindow.open(hubMapInstance, marker)
  }
  return true
}
// Recenter map on user
export function recenterHubMap() {
  if (!hubMapInstance) return
  hubMapInstance.panTo({ lat: userLat, lng: userLng })
  hubMapInstance.setZoom(13.5)
}
// Step the zoom level up/down (used by the floating map controls)
export function zoomHubMap(delta) {
  if (!hubMapInstance) return
  hubMapInstance.setZoom((hubMapInstance.getZoom() || 13.5) + delta)
}
export function panHubToCoords(lat, lng) {
  if (!hubMapInstance) return false
  hubMapInstance.panTo({ lat, lng })
  hubMapInstance.setZoom(16)
  return true
}
// Move the search origin to arbitrary coords and re-run the active filter
export function searchNearbyAt(lat, lng) {
  userLat = lat
  userLng = lng
  if (hubMapInstance) {
    hubMapInstance.panTo({ lat, lng })
    hubMapInstance.setZoom(13)
  }
  const activePill = document.querySelector('.konf-karte-hub .hub-pill.active')
  searchNearby(activePill ? activePill.dataset.query : _lastSearchFilter || 'Motorradwerkstatt')
}
// Get current coordinates
export function getUserCoords() {
  if (!userLocationKnown) return { lat: null, lng: null };
  return { lat: userLat, lng: userLng }
}
/* Meldet, dass der Nutzer den Kartenausschnitt selbst verschoben hat, samt
   neuer Mitte. Der Karten-Tab blendet daraufhin "Hier suchen" ein — ohne das
   bleibt die Trefferliste an der alten Mitte haengen, waehrend die Karte
   laengst woanders steht. */
let _onMapMovedCallback = null;
export function onHubMapMoved(cb) {
  _onMapMovedCallback = cb;
}
export function getHubMapCenter() {
  const c = hubMapInstance?.getCenter?.();
  return c ? { lat: c.lat(), lng: c.lng() } : null;
}

// Callback hook: bike-detail Karte view subscribes to result updates
let _onResultsCallback = null;
export function onHubResults(cb) {
  _onResultsCallback = cb;
}
function emitResultsUpdate() {
  if (_onResultsCallback) try { _onResultsCallback(getHubMarkers()); } catch {}
}

const MAX_RESULTS = 30;

// Icon sizes tuned so all appear visually equal on the map
const MARKER_SIZES = {
  Motorradwerkstatt: { w: 36, h: 36 },
  Motorradhändler: { w: 50, h: 32 },
  Fahrschule: { w: 45, h: 29 },
};

function createMarkerIcon(filter) {
  let url;
  switch (filter) {
    case "Motorradhändler":
      url = "/map-icons/haendler.png";
      break;
    case "Fahrschule":
      url = "/map-icons/fahrschule.png";
      break;
    default:
      url = "/map-icons/werkstatt.png";
  }
  const sz = MARKER_SIZES[filter] || MARKER_SIZES["Motorradwerkstatt"];
  return {
    url,
    scaledSize: new google.maps.Size(sz.w, sz.h),
    anchor: new google.maps.Point(sz.w / 2, sz.h / 2),
    _baseW: sz.w,
    _baseH: sz.h,
  };
}

function onZoomChanged() {
  if (!hubMapInstance) return;
  const zoom = hubMapInstance.getZoom();

  // Marker-Größe anpassen
  const scale = zoom < 12 ? 0.5 : 1;
  hubMarkers.forEach((m) => {
    const icon = m.getIcon();
    if (icon && icon.url && icon._baseW) {
      const w = Math.round(icon._baseW * scale);
      const h = Math.round(icon._baseH * scale);
      m.setIcon({
        url: icon.url,
        scaledSize: new google.maps.Size(w, h),
        anchor: new google.maps.Point(w / 2, h / 2),
        _baseW: icon._baseW,
        _baseH: icon._baseH,
      });
    }
  });

  // Bei Rauszoomen: weitere Ergebnisse nachladen
  if (
    _lastSearchFilter &&
    _lastSearchRadius > 0 &&
    _lastSearchRadius < 30000 &&
    zoom < 12
  ) {
    searchNearby(_lastSearchFilter, 30000);
  }
}

function buildInfoContent(place, query) {
  const colors = QUERY_COLORS[query] || QUERY_COLORS["Motorradwerkstatt"];
  const addr = place.vicinity || "";
  const rating = place.rating ? `${place.rating} / 5` : "";
  const open = place.opening_hours?.open_now;
  const openLabel =
    open === true
      ? '<span style="color:#34c759">Ge\u00f6ffnet</span>'
      : open === false
        ? '<span style="color:#ff3b30">Geschlossen</span>'
        : "";

  return `<div class="hub-info">
    <span class="hub-info-name">${esc(place.name)}</span>
    <span class="hub-info-type" style="color:${colors.fill}">${colors.label}${rating ? " \u00b7 " + rating : ""}</span>
    ${addr ? `<span class="hub-info-addr">${esc(addr)}</span>` : ""}
    ${openLabel ? `<span class="hub-info-open">${openLabel}</span>` : ""}
  </div>`;
}

function buildDealerInfoContent(dealer, query) {
  const colors = QUERY_COLORS[query] || QUERY_COLORS["Motorradwerkstatt"];
  return `<div class="hub-info">
    <span class="hub-info-name">${esc(dealer.name)}</span>
    <span class="hub-info-type" style="color:${colors.fill}">${colors.label}</span>
    <span class="hub-info-addr">${esc(dealer.city)}</span>
    ${dealer.phone ? `<a class="hub-info-phone" href="tel:${esc(dealer.phone)}">${esc(dealer.phone)}</a>` : ""}
    <span class="hub-info-addr" style="margin-top:4px;font-size:10px;opacity:0.55">Beispieldaten · keine echten Betriebe</span>
  </div>`;
}

let hubPlacesService = null;
let hubMapInitToken = 0;

export async function initHubMap() {
  const el = document.getElementById("hub-gmap");
  if (!el) return;
  // DSGVO: kein Google-Maps-Load ohne User-Consent
  if (!hasMapsConsent()) {
    renderMapsConsentPlaceholder(el);
    return;
  }
  // Reset stale instance if its DOM element is no longer in the document
  if (hubMapInstance && !document.body.contains(hubMapInstance.getDiv?.())) {
    hubMapInstance = null;
  }
  if (hubMapInstance) {
    // Existing instance still valid → bind it to the new element
    return;
  }

  // Merkt sich diesen Aufruf: wird die Karte inzwischen erneut initialisiert
  // (schnelles Weg-/Zurückklicken) oder die Kartenfläche entfernt, brechen
  // wir unten ab, statt eine Karte an ein verwaistes DOM-Element zu binden.
  const myToken = ++hubMapInitToken;

  try {
    // Wait for script + real user location before showing map
    await Promise.all([loadGoogleMapsScript(), getUserLocation()]);
    if (myToken !== hubMapInitToken || !document.body.contains(el)) return;

    // Ohne echten Standort nicht stillschweigend mit dem Default-Fallback
    // (Lüdinghausen) weitermachen — sonst wirken Karte/Ergebnisse wie am
    // echten Standort, obwohl der Nutzer den Zugriff verweigert hat.
    // getUserLocation() hat dafür bereits eine Fehlermeldung in den Loader
    // geschrieben; die bleibt stehen, bis ein neuer Versuch erfolgreich ist.
    if (!userLocationKnown) return;

    // Hide loading spinner
    const loader = document.getElementById("hub-map-loading");
    if (loader) loader.style.display = "none";

    const center = { lat: userLat, lng: userLng };

    hubMapInstance = new google.maps.Map(el, {
      center,
      zoom: 13.5,
      styles: MAP_STYLES,
      // Disable all default UI, re-enable only zoom
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: {
        position: google.maps.ControlPosition.RIGHT_CENTER,
      },
      // Premium: cooperative gesture prevents accidental scroll hijack
      gestureHandling: "cooperative",
    });

    hubInfoWindow = new google.maps.InfoWindow();

    // GTA Radar: scale markers on zoom change
    hubMapInstance.addListener("zoom_changed", onZoomChanged);

    /* Nur "dragend": ein Zoom aendert die Mitte nicht, und focusHubResult()
       schwenkt selbst — beides duerfte "Hier suchen" nicht ausloesen. */
    hubMapInstance.addListener("dragend", () => {
      if (!_onMapMovedCallback) return;
      const c = hubMapInstance.getCenter?.();
      if (!c) return;
      try { _onMapMovedCallback({ lat: c.lat(), lng: c.lng() }); } catch {}
    });

    // User location dot (pulsing blue)
    new google.maps.Marker({
      position: center,
      map: hubMapInstance,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#007AFF",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 3,
      },
      zIndex: 999,
    });

    // Places service (may fail if API not enabled)
    try {
      hubPlacesService = new google.maps.places.PlacesService(hubMapInstance);
    } catch {
      hubPlacesService = null;
    }

    // Search for active pill (falls back to dealers.js if Places unavailable)
    const activePill = document.querySelector(".hub-pill.active");
    if (activePill) searchNearby(activePill.dataset.query);
  } catch (err) {
    console.warn("[hub] Map init failed:", err);
    // Karte nicht verf\u00fcgbar (z. B. Netzwerk/CSP blockiert Google Maps) \u2014
    // trotzdem die lokal bekannten Eintr\u00e4ge in der N\u00e4he anzeigen, statt nichts zu tun.
    const activePill = document.querySelector(".hub-pill.active");
    renderDealerFallbackList(activePill?.dataset.query || "Motorradwerkstatt");
  }
}

// Reine Liste ohne Karte \u2014 greift auf die lokalen H\u00e4ndlerdaten zur\u00fcck,
// z. B. wenn Google Maps nicht laden konnte oder noch l\u00e4dt.
function renderDealerFallbackList(filter) {
  const el = document.getElementById("hub-gmap");
  if (!el) return;
  const dealerType = FILTER_TO_DEALER_TYPE[filter] || filter;
  const nearby = findNearby(userLat, userLng, 80)
    .filter((d) => d.type === dealerType)
    .slice(0, MAX_RESULTS);

  if (!nearby.length) {
    el.innerHTML = `
      <div class="hub-map-loading" id="hub-map-loading">
        <div style="font-size:32px;margin-bottom:8px">\ud83d\udccd</div>
        <div style="font-weight:700;color:#fff;margin-bottom:4px">Keine Ergebnisse in der N\u00e4he</div>
        <div style="font-size:12px;color:#888;max-width:280px;text-align:center;line-height:1.4">
          F\u00fcr diese Kategorie wurden keine Eintr\u00e4ge in deiner Umgebung gefunden.
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="hub-fallback-list" style="height:100%;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px">
      ${nearby
        .map(
          (d) => `
        <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px 16px">
          <div style="font-weight:700;color:#fff;font-size:14px;margin-bottom:2px">${esc(d.name)}</div>
          <div style="font-size:12px;color:#888">${esc(d.city)}${d.phone ? " \u00b7 " + esc(d.phone) : ""}</div>
        </div>`,
        )
        .join("")}
    </div>`;
}

let searchGeneration = 0;
let searchTimeout = null;

// Haversine distance in km
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Smooth animated viewport fit — clamped to stay local
function smoothFitBounds(bounds) {
  if (!hubMapInstance) return;
  hubMapInstance.fitBounds(bounds, {
    top: 60,
    right: 60,
    bottom: 60,
    left: 60,
  });
  // Clamp zoom so it never zooms out beyond city level
  google.maps.event.addListenerOnce(hubMapInstance, "idle", () => {
    const z = hubMapInstance.getZoom();
    if (z < 11) hubMapInstance.setZoom(11);
  });
}

let _lastSearchRadius = 0;
let _lastSearchFilter = null;
let _allSearchResults = [];
let _allSeenIds = new Set();

export function searchNearby(filter, radius = 5000) {
  if (!hubMapInstance) {
    // Karte (noch) nicht verfügbar — trotzdem lokale Ergebnisse anzeigen
    renderDealerFallbackList(filter);
    return;
  }

  // If same filter with wider radius, keep existing results and add more
  const isExpand = filter === _lastSearchFilter && radius > _lastSearchRadius;

  if (!isExpand) {
    // New filter — clear everything
    searchGeneration++;
    hubMarkers.forEach((m) => m.setMap(null));
    hubMarkers = [];
    _allSearchResults = [];
    _allSeenIds = new Set();
    if (hubInfoWindow) hubInfoWindow.close();
  } else {
    searchGeneration++;
  }

  const gen = searchGeneration;
  if (searchTimeout) clearTimeout(searchTimeout);
  _lastSearchFilter = filter;
  _lastSearchRadius = radius;

  const keywords = FILTER_KEYWORDS[filter] || [filter];

  if (hubPlacesService) {
    let done = 0;

    searchTimeout = setTimeout(() => {
      if (gen !== searchGeneration) return;
      if (!_allSearchResults.length) showDealerResults(filter, gen);
    }, 10000);

    keywords.forEach((kw) => {
      hubPlacesService.textSearch(
        { location: { lat: userLat, lng: userLng }, radius, query: kw },
        (results, status) => {
          if (gen !== searchGeneration) return;
          done++;
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            results.forEach((place) => {
              if (!place.place_id || !place.geometry?.location) return;
              if (
                place.business_status &&
                place.business_status !== "OPERATIONAL"
              )
                return;
              const n = (place.name || "").toLowerCase();
              if (
                n.includes("fahrrad") ||
                n.includes("e-bike") ||
                n.includes("ebike") ||
                n.includes("pedelec")
              )
                return;
              if (!_allSeenIds.has(place.place_id)) {
                _allSeenIds.add(place.place_id);
                _allSearchResults.push(place);
              }
            });
          }
          if (done === keywords.length) {
            clearTimeout(searchTimeout);
            if (_allSearchResults.length) {
              _allSearchResults.sort(
                (a, b) =>
                  haversineKm(
                    userLat,
                    userLng,
                    a.geometry.location.lat(),
                    a.geometry.location.lng(),
                  ) -
                  haversineKm(
                    userLat,
                    userLng,
                    b.geometry.location.lat(),
                    b.geometry.location.lng(),
                  ),
              );
              showPlacesResults(_allSearchResults, filter, gen);
            } else {
              showDealerResults(filter, gen);
            }
          }
        },
      );
    });
  } else {
    showDealerResults(filter, gen);
  }
}

function showPlacesResults(results, filter, gen) {
  hubMarkers.forEach((m) => m.setMap(null));
  hubMarkers = [];

  // Only the nearest locations
  const limited = results.slice(0, MAX_RESULTS);

  limited.forEach((place, i) => {
    setTimeout(() => {
      try {
        if (gen !== searchGeneration) return;
        if (!place.geometry?.location) return;

        const marker = new google.maps.Marker({
          position: place.geometry.location,
          map: hubMapInstance,
          title: place.name,
          icon: createMarkerIcon(filter),
        });

        marker.addListener("click", () => {
          hubInfoWindow.setContent(buildInfoContent(place, filter));
          hubInfoWindow.open(hubMapInstance, marker);
        });

        hubMarkers.push(marker);
        emitResultsUpdate();
      } catch (err) {
        console.warn("[hub] Marker error:", err);
      }
    }, i * 40);
  });
}

function showDealerResults(filter, gen) {
  const dealerType = FILTER_TO_DEALER_TYPE[filter] || filter;
  const nearby = findNearby(userLat, userLng, 80)
    .filter((d) => d.type === dealerType)
    .slice(0, MAX_RESULTS);

  if (!nearby.length) return;

  hubMarkers.forEach((m) => m.setMap(null));
  hubMarkers = [];

  nearby.forEach((dealer, i) => {
    setTimeout(() => {
      try {
        if (gen !== searchGeneration) return;

        const marker = new google.maps.Marker({
          position: { lat: dealer.lat, lng: dealer.lng },
          map: hubMapInstance,
          title: dealer.name,
          icon: createMarkerIcon(filter),
        });

        marker.addListener("click", () => {
          hubInfoWindow.setContent(buildDealerInfoContent(dealer, filter));
          hubInfoWindow.open(hubMapInstance, marker);
        });

        hubMarkers.push(marker);
      } catch (err) {
        console.warn("[hub] Dealer marker error:", err);
      }
    }, i * 60);
  });
}

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

function shareResult(bikeData) {
  const heroImg = document.querySelector(".bd-hero-img");
  if (!heroImg || heroImg.naturalWidth === 0) return;

  const c = document.createElement("canvas");
  const w = heroImg.naturalWidth;
  const h = heroImg.naturalHeight;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(heroImg, 0, 0);

  // Gradient watermark
  const grad = ctx.createLinearGradient(0, h - 80, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.8)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - 80, w, 80);

  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(w * 0.028)}px Inter, -apple-system, sans-serif`;
  ctx.fillText(bikeData.name, 28, h - 32);

  ctx.font = `400 ${Math.round(w * 0.015)}px Inter, -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(`${bikeData.cc}cc / ${bikeData.ps}PS / MotoMatch`, 28, h - 14);

  const dataUrl = c.toDataURL("image/png");

  // Try native share, fallback to download
  if (navigator.share) {
    c.toBlob((blob) => {
      const file = new File(
        [blob],
        `motomatch-${bikeData.name.replace(/\s+/g, "-")}.png`,
        { type: "image/png" },
      );
      navigator
        .share({ title: `MotoMatch: ${bikeData.name}`, files: [file] })
        .catch(() => {});
    });
  } else {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `motomatch-${bikeData.name.replace(/\s+/g, "-").toLowerCase()}.png`;
    a.click();
  }
}

// ══════════════════════════════════════════════════════════════
//  CLEANUP
// ══════════════════════════════════════════════════════════════

function cleanup() {
  clearTabHintTimers();
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

  // Reset hub map state
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = null;
  hubMarkers.forEach((m) => m.setMap(null));
  hubMarkers = [];
  if (hubInfoWindow) hubInfoWindow.close();
  hubInfoWindow = null;
  hubPlacesService = null;
  hubMapInstance = null;
  searchGeneration = 0;
  geoPromise = null;
  gmapsLoadPromise = null;
  _lastSearchRadius = 0;
  _lastSearchFilter = null;
  _allSearchResults = [];
  _allSeenIds = new Set();
}
