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
import { buildSearchUrls, getLiveListings } from "./marketplace.js";
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
        <p class="bd-price">${priceDisplay}${/\d/.test(priceDisplay) ? " inkl. MwSt." : ""}</p>
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

function init3DViewer(bikeData) {
  if (!bikeData.has3D || !bikeData.glb) {
    // Ohne 3D-Modell steht hier der 3D-Ersatz: dasselbe Motorrad mit Fahrer im dunklen Studio
    // (freigegebene Bikes, tools/catalog/einbau.py).
    const wrap = document.getElementById("gr-3d-wrap");
    if (wrap && bikeData.studio) {
      wrap.classList.add("bd-3d-canvas-wrap--studio");
      wrap.innerHTML = `<img class="bd-studio-img" src="${bikeData.studio}" alt="${bikeData.name} im Studio" loading="lazy" decoding="async">`;
      // Höhe der Specs-Karte einfrieren, damit das Studio-Bild beim Aufklappen nicht mitwächst.
      // mountAnsicht() ist async → bd-ansicht-embed existiert erst nach dem Import. MutationObserver abwarten.
      const host = document.getElementById("gr-ansicht-host");
      if (host) {
        const obs = new MutationObserver(() => {
          const specsCard = host.querySelector(".bd-ansicht-embed");
          if (specsCard) {
            obs.disconnect();
            requestAnimationFrame(() => {
              const h = specsCard.offsetHeight + "px";
              wrap.style.height = h;
              wrap.style.maxHeight = h;
            });
          }
        });
        obs.observe(host, { childList: true, subtree: true });
      }
    }
    return;
  }

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
  dracoLoader.setDecoderPath("/draco/");
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
    const urls = buildSearchUrls(bikeData.name);
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
    /* Liefert die Suche nichts, steht hier ein Hinweis statt einer Liste.
       Frueher sprangen an dieser Stelle erfundene Inserate mit Preisen und
       Kilometerstaenden ein — die sahen aus wie echte Angebote, waren aber
       keine. Die drei Suchlinks direkt darunter sind der Weg nach vorn. */
    const renderMarketEmpty = () => {
      const el = document.getElementById("gr-market-listings");
      if (!el) return;
      el.innerHTML = `
        <p class="gr-meta-text">
          Aktuell keine Angebote abrufbar. Suche direkt bei Kleinanzeigen,
          Mobile.de oder eBay \u2014 die Links stehen darunter.
        </p>`;
    };
    getLiveListings(bikeData.name)
      .then(({ items }) => {
        const el = document.getElementById("gr-market-listings");
        if (!el) return;
        if (!items.length) {
          renderMarketEmpty();
          return;
        }
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
      .catch(renderMarketEmpty);
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
   "geocoding" stand hier ebenfalls, wird aber nicht mehr gebraucht: die
   Ortssuche laeuft ueber Places (resolveOrt), weil die Geocoding-API im
   Google-Projekt nicht freigeschaltet ist.
   Mit loading=async liefert der Bootstrap beim script.onload nur einen
   Platzhalter: google.maps existiert, die Konstruktoren und Konstanten aber
   noch nicht. Wer direkt danach google.maps.Map oder ControlPosition benutzt,
   läuft in "Cannot read properties of undefined". Erst importLibrary() füllt
   den Namensraum — und zwar auch den klassischen google.maps.*, sodass die
   bestehenden Aufrufstellen unverändert gültig bleiben. */
const GMAPS_LIBRARIES = ["core", "maps", "marker", "places"];
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
    elementType: "geometry.stroke",
    stylers: [{ visibility: "off" }],
  },
  /* Strassen nach Rang abgestuft.
     Vorher lag alles auf #5c5c5c — jeder Feldweg so hell wie eine Autobahn.
     Im Muensterland ergab das ein dichtes graues Geflecht, in dem sich nichts
     unterscheiden liess; genau daher kam der ueberfuellte Eindruck, mehr noch
     als von den Ortsnamen. Jetzt tragen die Hauptstrassen das Bild und die
     kleinen Wege liegen knapp ueber dem Untergrund. */
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#3a3a3a" }] },
  { featureType: "road.local", elementType: "geometry.fill", stylers: [{ color: "#2f2f2f" }] },
  { featureType: "road.arterial", elementType: "geometry.fill", stylers: [{ color: "#4a4a4a" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#6b6b6b" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  // Verwaltungsgrenzen bleiben aus — die Namen darin kommen unten zurueck.
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ visibility: "off" }],
  },
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

  /* ── Beschriftung ───────────────────────────────────────────────────
     Die Regel `labels: off` weiter oben nimmt saemtliche Beschriftungen weg.
     Uebrig blieb ein graues Liniengeflecht: man sah, DASS da Strassen sind,
     aber nicht, wo man ist. Deshalb hier gezielt zurueck — und nur Text,
     keine Symbole, damit die eigenen Marker die einzigen Zeichen auf der
     Karte bleiben.

     Die Helligkeit ist bewusst zurueckgenommen (#969696 statt #e2e2e2): in
     Google fuehren auch Bauerschaften und Ortsteile als "locality", und in
     Muensterland sind das viele. Ueber den Feature-Typ lassen sie sich nicht
     von Staedten trennen — geprueft, "administrative.neighborhood" aus
     aendert nichts daran. Was bleibt, ist das Gewicht: gross geschriebene
     Stadtnamen setzt Google ohnehin groesser, die vielen kleinen treten mit
     gedaempfter Farbe zurueck, statt das Bild zu fuellen. Bei der
     Startzoomstufe (13,5) stehen ohnehin nur eine Handvoll Namen da; dicht
     wird es erst zwei Stufen weiter draussen. */
  {
    featureType: "administrative.locality",
    elementType: "labels.text.fill",
    stylers: [{ visibility: "on" }, { color: "#7d7d7d" }],
  },
  {
    featureType: "administrative.locality",
    elementType: "labels.text.stroke",
    stylers: [{ visibility: "on" }, { color: "#141414" }, { weight: 3 }],
  },
  // Die kleinen Punkte neben Ortsnamen: weg. Auf der Karte sollen nur die
  // eigenen Marker Zeichen sein.
  {
    featureType: "administrative.locality",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ visibility: "on" }, { color: "#6f6f6f" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.stroke",
    stylers: [{ visibility: "on" }, { color: "#141414" }, { weight: 3 }],
  },
  // Autobahn- und Bundesstrassenschilder: die Nummer ist unterwegs die
  // schnellste Orientierung, das Schild selbst waere nur ein bunter Fleck.
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
];

// Premium marker colors per filter type
const QUERY_COLORS = {
  /* Die Farben der drei gezeichneten Bilder sind uebernommen — Orange,
     Gruen, Lila waren bereits die Erkennungsfarben auf der Karte. */
  Motorradwerkstatt: { fill: "#ff6a13", stroke: "#c24f0d", label: "Werkstatt" },
  "Motorradh\u00e4ndler": {
    fill: "#5ee61e",
    stroke: "#3fae12",
    label: "H\u00e4ndler",
  },
  Fahrschule: { fill: "#a020f0", stroke: "#7a17b8", label: "Fahrschule" },
  Tankstelle: { fill: "#e63946", stroke: "#b32a35", label: "Tankstelle" },
  Parkplatz: { fill: "#2f7dd1", stroke: "#215a99", label: "Parkplatz" },
  Cafe: { fill: "#a9652e", stroke: "#7d4a20", label: "Biker-Treff" },
  Notdienst: { fill: "#ffc300", stroke: "#c69800", label: "Notdienst" },
};

/* Markersymbole fuer alle sieben Kacheln.
   Frueher lagen drei gezeichnete .webp-Dateien im Ordner map-icons, die
   restlichen vier Kacheln fielen mangels eigenem Bild auf das Werkstatt-Bild
   zurueck — eine Tankstelle bekam also einen Schraubenschluessel.

   Jetzt kommen alle sieben aus denselben Pfaden, die auch auf den
   Filter-Knoepfen liegen: Knopf und Marker zeigen dasselbe Zeichen.
   Gezeichnet wird zweilagig — dicke schwarze Linie darunter, farbige darueber.
   Das ergibt die kraeftige Kontur der vorhandenen Bilder, bleibt aber als
   Vektor bei jeder Zoomstufe scharf. */
const MARKER_GLYPHS = {
  Motorradwerkstatt:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  "Motorradh\u00e4ndler": '<path d="M20 7H4l1-3h14zM2 7h20v5H2zM4 12v9h4v-5h8v5h4v-9"/>',
  Fahrschule:
    '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  Tankstelle:
    '<path d="M3 21h12M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M5 11h10M15 6l3 3v8a2 2 0 0 1-4 0v-2"/>',
  Parkplatz:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  Cafe:
    '<path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 1v3M10 1v3M14 1v3"/>',
  Notdienst:
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
};

function glyphIconUrl(filter) {
  const pfade = MARKER_GLYPHS[filter];
  if (!pfade) return null;
  const farbe = (QUERY_COLORS[filter] || {}).fill || "#fff";
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 28 28" width="34" height="34">' +
    '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    `<g stroke="#111" stroke-width="6">${pfade}</g>` +
    `<g stroke="${farbe}" stroke-width="3">${pfade}</g>` +
    "</g></svg>";
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

/* Suchbegriffe je Filter.
   Bewusst kurz: JEDER Begriff ist ein eigener, kostenpflichtiger
   Text-Search-Aufruf bei Google. Vorher standen hier 46 Begriffe ueber alle
   Filter — ein einmaliges Durchklicken der sieben Kacheln kostete damit 46
   Aufrufe, ohne die auf 30 Treffer gedeckelte Liste besser zu fuellen.
   "Zweirad*" ist zusaetzlich raus: im Deutschen sind das ueberwiegend
   Fahrradlaeden, sie haben die Werkstattliste mit Radstationen geflutet. */
const FILTER_KEYWORDS = {
  Motorradwerkstatt: ["Motorradwerkstatt", "Motorrad Service"],
  "Motorradh\u00e4ndler": ["Motorradh\u00e4ndler", "Motorradhaus"],
  Fahrschule: ["Fahrschule Motorrad", "Fahrschule"],
  Tankstelle: ["Tankstelle"],
  Parkplatz: ["Parkplatz"],
  Cafe: ["Motorrad Caf\u00e9", "Biker Treffpunkt"],
  Notdienst: ["Motorrad Pannendienst"],
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
  return (hubMarkers || []).filter(Boolean).map((m) => ({
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
  /* Ein eingegebener Ort ist ein vollwertiger Standort.
     Ohne diese Zeile blieb userLocationKnown false — und initHubMap() steigt
     genau darauf aus. Die Ortssuche konnte damit ausgerechnet in dem Fall
     nichts ausrichten, fuer den es sie gibt: wenn der Browser den Standort
     verweigert. Die Karte blieb "nicht verfuegbar", die Eingabe wirkungslos. */
  userLocationKnown = true

  if (!hubMapInstance) {
    // Karte wurde mangels Standort nie gebaut — jetzt nachholen. initHubMap()
    // startet am Ende selbst die Suche fuer die aktive Kachel.
    initHubMap()
    return
  }
  hubMapInstance.panTo({ lat, lng })
  hubMapInstance.setZoom(13)
  const activePill = document.querySelector('.konf-karte-hub .hub-pill.active')
  searchNearby(activePill ? activePill.dataset.query : _lastSearchFilter || 'Motorradwerkstatt')
}

/**
 * Ort oder Postleitzahl zu Koordinaten aufloesen.
 *
 * Bewusst ueber die Places-Textsuche und NICHT ueber google.maps.Geocoder:
 * die Geocoding-API ist im Google-Projekt nicht freigeschaltet, sie antwortet
 * mit REQUEST_DENIED. Die Oberflaeche machte daraus "Ort nicht gefunden" und
 * schob den Fehler damit dem Nutzer zu. Places ist ohnehin in Benutzung und
 * loest beides sauber auf — an "Köln", "48143" und "Lüdinghausen" geprueft.
 *
 * @returns {Promise<{ok:true,lat:number,lng:number,label:string}|{ok:false,grund:'nicht_gefunden'|'technisch'}>}
 */
export function resolveOrt(query) {
  return new Promise((fertig) => {
    if (typeof google === 'undefined' || !google.maps?.places) {
      fertig({ ok: false, grund: 'technisch' })
      return
    }
    // Eigener Dienst ohne Karte: die Ortssuche muss auch dann gehen, wenn
    // mangels Standort noch gar keine Karte steht.
    const dienst = new google.maps.places.PlacesService(document.createElement('div'))
    dienst.textSearch({ query: `${query}, Deutschland` }, (treffer, status) => {
      const S = google.maps.places.PlacesServiceStatus
      if (status === S.OK && treffer?.[0]?.geometry?.location) {
        const ort = treffer[0]
        fertig({
          ok: true,
          lat: ort.geometry.location.lat(),
          lng: ort.geometry.location.lng(),
          label: ort.formatted_address || ort.name || query,
        })
        return
      }
      fertig({ ok: false, grund: status === S.ZERO_RESULTS ? 'nicht_gefunden' : 'technisch' })
    })
  })
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
  // Einheitlich, seit alle Symbole aus derselben 24er-Zeichenflaeche kommen.
  // Die krummen Masse davor (50x32, 45x29) stammten von den Bildseitenverhaeltnissen.
  Motorradwerkstatt: { w: 34, h: 34 },
  Motorradhändler: { w: 34, h: 34 },
  Fahrschule: { w: 34, h: 34 },
  Tankstelle: { w: 34, h: 34 },
  Parkplatz: { w: 34, h: 34 },
  Cafe: { w: 34, h: 34 },
  Notdienst: { w: 34, h: 34 },
};

function createMarkerIcon(filter) {
  // Eine Herkunft fuer alle Kacheln; der Rueckfall gilt nur noch fuer eine
  // Kachel, die versehentlich ohne Symbol angelegt wird.
  const url = glyphIconUrl(filter) || glyphIconUrl("Motorradwerkstatt");
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
    const icon = m?.getIcon();
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

  /* Frueher lief hier bei jedem Zoom unter Stufe 12 automatisch eine neue
     Suche mit 30 km Radius an — also ein kompletter Satz kostenpflichtiger
     Text-Search-Aufrufe fuer eine reine Kartengeste. Die Startstufe ist 13,5;
     zweimal rauszoomen genuegte. Wer weiter weg suchen will, hat dafuer die
     Radius-Kacheln und "Hier suchen". Zoom aendert jetzt nur noch die
     Markergroesse. */
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
  /* Bestehende Karte weiterverwenden statt eine neue zu bauen.
     Jedes `new google.maps.Map(...)` ist ein kostenpflichtiger Kartenaufruf
     bei Google. Der Karten-Reiter wirft beim Wechseln sein DOM weg, also war
     der bisherige Test ("liegt das Element noch im Dokument?") nach jedem
     Reiterwechsel negativ — und es entstand jedes Mal eine neue Karte. Ein
     paar Mal hin und her, und das Tageskontingent war weg
     (Google meldet dann OverQuotaMapError, die Karte erscheint hell und
     unformatiert mit dem Hinweis "For development purposes only").

     Jetzt zieht die vorhandene Kartenflaeche in den neuen Platzhalter um.
     Das Element mit seinem Kartenzustand bleibt dasselbe, Google erfaehrt nur
     die neue Groesse. */
  const bestehendesFeld = hubMapInstance?.getDiv?.() || null;
  if (bestehendesFeld) {
    if (bestehendesFeld !== el) {
      el.replaceWith(bestehendesFeld);
      // Ohne resize bleibt die Karte auf der Groesse des alten Platzhalters.
      google.maps.event.trigger(hubMapInstance, "resize");
    }
    /* Suche auch auf diesem Weg anstossen. Der Karten-Reiter verlaesst sich
       darauf, dass initHubMap() das tut, und laesst seine Platzhalterzeilen
       sonst stehen, bis onHubResults() meldet — was nie kaeme.
       Kostet in aller Regel keinen Google-Aufruf: gleicher Filter, gleiche
       Gegend, der Ergebnisspeicher antwortet. */
    const aktiveKachel = document.querySelector(".hub-pill.active");
    if (aktiveKachel) searchNearby(aktiveKachel.dataset.query);
    return;
  }
  // Kein brauchbares Feld mehr (Karte nie gebaut oder Instanz verloren).
  hubMapInstance = null;

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

    // Search for active pill
    const activePill = document.querySelector(".hub-pill.active");
    if (activePill) searchNearby(activePill.dataset.query);
  } catch (err) {
    console.warn("[hub] Map init failed:", err);
    // Karte nicht verf\u00fcgbar (z. B. Netzwerk/CSP blockiert Google Maps) \u2014
    // das sagen wir dem Nutzer, statt Ersatzeintr\u00e4ge zu erfinden.
    renderMapUnavailable();
  }
}

/* Steht statt der Karte da, wenn Google Maps nicht geladen werden konnte.
   Frueher stand hier eine Liste erfundener Werkstaetten und Fahrschulen, die
   wie echte Betriebe in der Naehe aussah. Ohne Karte gibt es keine echten
   Treffer \u2014 also nennt der Block die Ursache und bietet einen zweiten
   Versuch an, statt eine Naehe vorzutaeuschen, die niemand geprueft hat. */
function renderMapUnavailable() {
  const el = document.getElementById("hub-gmap");
  if (!el) return;
  el.innerHTML = `
    <div class="hub-map-loading" id="hub-map-loading">
      <div style="font-size:32px;margin-bottom:8px">\ud83d\uddfa\ufe0f</div>
      <div style="font-weight:700;color:#fff;margin-bottom:4px">Karte nicht verf\u00fcgbar</div>
      <div style="font-size:12px;color:#888;max-width:280px;text-align:center;line-height:1.4">
        Google Maps konnte gerade nicht geladen werden \u2014 deshalb lassen sich
        keine Betriebe in deiner N\u00e4he anzeigen. Pr\u00fcfe deine Verbindung
        und versuch es noch einmal.
      </div>
      <button type="button" id="hub-map-retry-btn" class="hub-retry-btn">Erneut versuchen</button>
    </div>`;
  el.querySelector("#hub-map-retry-btn")?.addEventListener("click", () => {
    el.innerHTML = `
      <div class="hub-map-loading" id="hub-map-loading">
        <span class="hub-map-spinner"></span>
        <span>Karte wird geladen\u2026</span>
      </div>`;
    initHubMap();
  });
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

/* ── Welche Treffer gehoeren in welche Kachel ──────────────────────────
   Die Textsuche liefert, wonach sie gefragt wird, aber nicht nur das: unter
   "Werkstatt" standen Radstationen, ein Kaufhaus und die Handwerkskammer.

   An echten Antworten aus Muenster abgelesen:
     Motorrad Mallek, Moto Basler, Motorrad Christiansen  -> car_repair
     Motorrad Technik Druffel                             -> car_dealer
     Radstation, Drahtesel, Bike-Corner, Zweirad Civak    -> bicycle_store
   Die Unterscheidung liegt also im Typ, nicht im Namen. Zwei Ausnahmen
   fangen die Wortlisten ab: "Triumph Muenster" fuehrt nur `store`, wird aber
   ueber die Marke erkannt; "Fahrradwerkstatt ... Bike & more" traegt gar
   keinen Typ und faellt ueber das Wort.

   Fahrschulen liefern ueberhaupt keine Typen (geprueft: acht von acht ohne).
   Fuer sie und die uebrigen Kacheln darf deshalb nichts verlangt werden —
   dort wird nur aussortiert, nicht ausgewaehlt. */
const RAD_WORTE = ["fahrrad", "e-bike", "ebike", "pedelec", "radstation", "velo"];
const MOTOR_WORTE = [
  "motorrad", "motorcycle", "moto", "biker", "kraftrad", "roller", "vespa",
  "harley", "yamaha", "honda", "suzuki", "kawasaki", "ducati", "ktm",
  "triumph", "aprilia", "husqvarna", "piaggio",
];
// Google fuehrt Motorradbetriebe unter den Kfz-Typen — einen eigenen gibt es nicht.
const KFZ_TYPEN = ["car_repair", "car_dealer", "motorcycle_dealer"];
// Nur hier wird eine Motorrad-Zugehoerigkeit verlangt.
const NUR_MOTORISIERT = new Set(["Motorradwerkstatt", "Motorradh\u00e4ndler"]);

function passtZurKategorie(place, filter) {
  const name = (place.name || "").toLowerCase();
  const typen = place.types || [];

  // Gilt fuer jede Kachel: Fahrradlaeden sind nie gemeint.
  if (typen.includes("bicycle_store")) return false;
  if (RAD_WORTE.some((w) => name.includes(w))) return false;

  if (!NUR_MOTORISIERT.has(filter)) return true;

  return (
    typen.some((t) => KFZ_TYPEN.includes(t)) ||
    MOTOR_WORTE.some((w) => name.includes(w))
  );
}

/* Ergebnis-Zwischenspeicher.
   Ohne ihn kostete jedes Hin- und Herklicken zwischen Filtern und Radien
   erneut Geld, obwohl sich weder Standort noch Umgebung geaendert hatten.
   Schluessel ist der Filter plus die auf zwei Nachkommastellen (~1 km)
   gerundete Suchmitte. Gemerkt wird der groesste bereits gesuchte Radius:
   eine Suche mit kleinerem Radius ist darin enthalten und wird ohne einen
   einzigen neuen Aufruf bedient. Auch leere Ergebnisse werden gemerkt —
   sonst fragt eine tote Gegend bei jedem Klick erneut nach. */
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const searchCache = new Map();

function searchCacheKey(filter, lat, lng) {
  return `${filter}|${lat.toFixed(2)}|${lng.toFixed(2)}`;
}

function readSearchCache(filter, radius, lat, lng) {
  const hit = searchCache.get(searchCacheKey(filter, lat, lng));
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) return null;
  // Enger gesucht als jetzt gefragt: der Speicher deckt die Frage nicht ab.
  if (hit.radius < radius) return null;
  return hit.results;
}

function writeSearchCache(filter, radius, lat, lng, results) {
  const key = searchCacheKey(filter, lat, lng);
  const prev = searchCache.get(key);
  // Einen weiter gefassten Treffer nicht durch einen engeren ersetzen.
  if (prev && prev.radius > radius && Date.now() - prev.at <= SEARCH_CACHE_TTL_MS) return;
  searchCache.set(key, { radius, results, at: Date.now() });
}

export function searchNearby(filter, radius = 5000) {
  if (!hubMapInstance) {
    // Ohne Karte gibt es keine echten Treffer — Ursache benennen statt raten.
    renderMapUnavailable();
    return;
  }

  // If same filter with wider radius, keep existing results and add more
  const isExpand = filter === _lastSearchFilter && radius > _lastSearchRadius;

  if (!isExpand) {
    // New filter — clear everything
    searchGeneration++;
    hubMarkers.forEach((m) => m?.setMap(null));
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

  /* Suchmitte einmal festhalten. searchNearbyAt() kann userLat/userLng
     verschieben, waehrend die Antworten noch unterwegs sind — dann sortierte
     die Rueckmeldung unten nach einer Mitte, um die gar nicht gesucht wurde. */
  const originLat = userLat;
  const originLng = userLng;

  // Schon gesucht? Dann ohne einen einzigen Google-Aufruf beantworten.
  const cached = readSearchCache(filter, radius, originLat, originLng);
  if (cached) {
    _allSearchResults = cached.slice();
    _allSeenIds = new Set(cached.map((p) => p.place_id));
    if (_allSearchResults.length) showPlacesResults(_allSearchResults, filter, gen);
    else clearHubResults(gen);
    return;
  }

  const keywords = FILTER_KEYWORDS[filter] || [filter];

  if (hubPlacesService) {
    let done = 0;

    searchTimeout = setTimeout(() => {
      if (gen !== searchGeneration) return;
      if (!_allSearchResults.length) clearHubResults(gen);
    }, 10000);

    keywords.forEach((kw) => {
      hubPlacesService.textSearch(
        { location: { lat: originLat, lng: originLng }, radius, query: kw },
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
              if (!passtZurKategorie(place, filter)) return;
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
                    originLat,
                    originLng,
                    a.geometry.location.lat(),
                    a.geometry.location.lng(),
                  ) -
                  haversineKm(
                    originLat,
                    originLng,
                    b.geometry.location.lat(),
                    b.geometry.location.lng(),
                  ),
              );
              writeSearchCache(filter, radius, originLat, originLng, _allSearchResults);
              showPlacesResults(_allSearchResults, filter, gen);
            } else {
              writeSearchCache(filter, radius, originLat, originLng, []);
              clearHubResults(gen);
            }
          }
        },
      );
    });
  } else {
    // Places-Dienst nicht verf\u00fcgbar — ohne ihn gibt es nichts zu zeigen.
    clearHubResults(gen);
  }
}

function showPlacesResults(results, filter, gen) {
  hubMarkers.forEach((m) => m?.setMap(null));

  // Only the nearest locations
  const limited = results.slice(0, MAX_RESULTS);

  /* Feste Plaetze statt push(): die Marker entstehen versetzt (i * 40 ms) und
     einzelne koennen ausfallen. Mit push() rutschten die nachfolgenden eine
     Stelle vor, und focusHubResult() — das ueber den Index aus
     _allSearchResults zugreift — oeffnete danach den falschen Ort. */
  hubMarkers = new Array(limited.length);

  /* Die Trefferliste haengt nicht an den Markern, sie liest _allSearchResults.
     Sobald hier sortiert vorliegt, ist sie vollstaendig — also genau einmal
     melden. Vorher stand diese Zeile im Timeout jedes einzelnen Markers: bei
     30 Treffern baute sich die Liste 30-mal in 1,2 Sekunden neu auf. Genau
     das war das Zappeln beim Laden. */
  emitResultsUpdate();

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

        hubMarkers[i] = marker;
      } catch (err) {
        console.warn("[hub] Marker error:", err);
      }
    }, i * 40);
  });
}

/* Die Places-Suche hat nichts geliefert \u2014 sei es, weil es in der Umgebung
   nichts gibt, weil die Suche in die Zeitgrenze gelaufen ist oder weil der
   Places-Dienst gar nicht bereitsteht. Frueher setzte an dieser Stelle eine
   Liste erfundener Betriebe Marker auf die Karte. Jetzt bleibt die Karte leer
   und die Trefferliste erfaehrt es, damit sie ihren eigenen Leerzustand
   zeigen kann. */
function clearHubResults(gen) {
  if (gen !== searchGeneration) return;
  hubMarkers.forEach((m) => m?.setMap(null));
  hubMarkers = [];
  if (hubInfoWindow) hubInfoWindow.close();
  emitResultsUpdate();
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

  /* Suchzustand zuruecksetzen — die Karte selbst aber behalten.
     hubMapInstance, das zugehoerige Infofenster und der Places-Dienst haengen
     an genau einem `new google.maps.Map(...)`, und das ist bei Google ein
     kostenpflichtiger Kartenaufruf. Wurden sie hier verworfen, entstand beim
     naechsten Oeffnen der Karte eine neue — jedes Mal. Zusammen mit dem
     Reiterwechsel summierte sich das bis zum ausgeschoepften Tageskontingent
     (OverQuotaMapError: Karte hell, unformatiert, "For development purposes
     only"). Die Instanz kostet im Speicher wenig und wird beim naechsten
     initHubMap() samt ihrer Kartenflaeche weiterverwendet. */
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = null;
  hubMarkers.forEach((m) => m?.setMap(null));
  hubMarkers = [];
  if (hubInfoWindow) hubInfoWindow.close();
  searchGeneration = 0;
  geoPromise = null;
  gmapsLoadPromise = null;
  _lastSearchRadius = 0;
  _lastSearchFilter = null;
  _allSearchResults = [];
  _allSeenIds = new Set();
}
