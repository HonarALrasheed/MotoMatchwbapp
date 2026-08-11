import { maybeShowOnboarding } from "./onboarding.js";
import { getCatalog, findBikeByShortName } from "./matching.js";

let landingObserver = null;
let _scrollHandler = null;

// Kurze Vorschau-Info auf den Lifestyle-Karten — erscheint rein per CSS
// (:hover mit transition-delay), verschwindet sofort beim Verlassen.
// Funktioniert auf Touch-Geräten genauso über :hover-Emulation beim Tippen.
const LC_INFO = {
  "lc-quiz": "Beantworte ein paar Fragen zu deinem Fahrstil — wir finden dein perfektes Motorrad.",
  "lc-dealer": "Vergleiche Preise, Ausstattung und finde Händler mit Beratung in deiner Nähe.",
  "lc-community": "Entdecke Modelle nach Stil, tausch dich mit anderen aus und finde passendes Gear.",
};

const FEATURED_BIKES = [
  {
    name: "Iron 883",
    style: "Cruiser",
    badgeKey: "cruiser",
    font: "font-harley",
    desc: "Dark Custom mit V-Twin. Minimalistisch, roh, unverkennbar.",
    img: "/bikes/harley_iron883_2018.jpg",
  },
  {
    name: "Seventy-Two",
    style: "Cruiser",
    badgeKey: "cruiser",
    font: "font-harley-classic",
    desc: "Klassischer Chopper-Stil mit V-Twin Power. Purer Cruiser-Charakter.",
    img: "/bikes/harley_seventytwo_2015.jpg",
  },
  {
    name: "CB 750 F",
    style: "Klassiker",
    badgeKey: "klassiker",
    font: "font-honda-classic",
    desc: "Die Legende, die alles veränderte. Vier Zylinder, Geschichte.",
    img: "/bikes/honda_cb750f_1970.jpg",
  },
  {
    name: "500 Custom",
    style: "Custom",
    badgeKey: "custom",
    font: "font-yamaha-custom",
    desc: "Moderner Custom-Cruiser. Vielseitig, komfortabel, einzigartig.",
    img: "/bikes/yamaha_500custom.png",
  },
  {
    name: "YZF-R3",
    style: "Sport",
    badgeKey: "sport",
    font: "font-yamaha-sport",
    desc: "Idealer Einstieg in die Sportwelt. Agil, leicht, perfekt für A2.",
    img: "/bikes/yamaha_yzfr3_2017.jpg",
  },
  {
    name: "NR750",
    style: "Sportbike",
    badgeKey: "sportbike",
    font: "font-honda-tech",
    desc: "Ikonischer V4-Sportler mit ovalen Kolben. Technisches Meisterwerk.",
    img: "/bikes/honda_nr750_1994.png",
  },
];

// FEATURED_BIKES-Einträge tragen nur Name/Stil fürs Landing-UI — für den
// Konfigurator (Preis, PS, Beschleunigung etc.) brauchen wir den vollen
// Katalog-Eintrag, sonst bleiben Preis und Kennzahlen dort leer.
function resolveFeaturedBike(def) {
  return findBikeByShortName(def.name) || def;
}

const DISCOVER_CATS = [
  { type: "Stil", name: "Cruiser",   primaryBike: "Iron 883",    bikes: "Iron 883 · Seventy-Two",   desc: "Dark Custom mit V-Twin. Minimalistisch, roh, unverkennbar.",        img: "/bikes/harley_iron883_2018.jpg",    filter: "Cruiser"   },
  { type: "Stil", name: "Sportbike", primaryBike: "YZF-R3",      bikes: "YZF-R3 · NR750",           desc: "Agilität trifft Technik. Für die Rennstrecke und die Straße.",       img: "/bikes/yamaha_yzfr3_2017.jpg",      filter: "Sport"     },
  { type: "Stil", name: "Klassiker", primaryBike: "CB 750 F",    bikes: "CB 750 F · RX King",       desc: "Zeitlose Legenden. Geschichte, die man fahren kann.",                img: "/bikes/honda_cb750f_1970.jpg",      filter: "Klassiker" },
  { type: "Stil", name: "Custom",    primaryBike: "500 Custom",  bikes: "500 Custom · DT 125",      desc: "Einzigartiger Stil. Jedes Bike ein Unikat.",                         img: "/bikes/yamaha_500custom.png",       filter: "Custom"    },
  { type: "Stil", name: "Naked",     primaryBike: "NR750",       bikes: "CRF450R · Speed Triple",   desc: "Puristische Power ohne Verkleidung. Fahrspaß pur.",                 img: "/bikes/honda_nr750_1994.png",       filter: "Sportbike" },
  { type: "Stil", name: "Vintage",   primaryBike: "Seventy-Two", bikes: "Seventy-Two · CB 750 F",   desc: "Klassisches Design, moderne Seele. Retro mit Charakter.",           img: "/bikes/harley_seventytwo_2015.jpg", filter: "Cruiser"   },
];

// ── Toast helper ─────────────────────────────────────────
let _toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById("p-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "p-toast";
    toast.className = "p-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

// ── Search overlay ────────────────────────────────────────
function buildSearchOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "p-search-overlay";
  overlay.id = "p-search-overlay";
  overlay.innerHTML = `
    <button class="p-search-close" id="p-search-close">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      ESC
    </button>
    <div class="p-search-inner">
      <div class="p-search-label">Motorrad suchen</div>
      <div class="p-search-field">
        <input class="p-search-input" id="p-search-input" type="text" placeholder="Modell, Marke, Stil…" autocomplete="off" />
      </div>
      <div class="p-search-results" id="p-search-results"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#p-search-input");
  const results = overlay.querySelector("#p-search-results");

  const renderResults = (query) => {
    const q = query.trim().toLowerCase();
    const catalog = getCatalog();
    const matches = q
      ? catalog.filter(b =>
          b.name.toLowerCase().includes(q) ||
          (b.brand || "").toLowerCase().includes(q) ||
          (b.style || "").toLowerCase().includes(q) ||
          (b.bgText || "").toLowerCase().includes(q))
      : catalog;

    if (matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "p-search-empty";
      empty.textContent = `Kein Ergebnis für „${query}"`;
      results.replaceChildren(empty);
      return;
    }
    results.innerHTML = matches.map(b => `
      <div class="p-search-result" data-name="${b.name.replace(/"/g, "&quot;")}">
        <img class="p-search-result-thumb" src="${b.image}" alt="${b.name.replace(/"/g, "&quot;")}">
        <div>
          <div class="p-search-result-name">${b.name}</div>
          <div class="p-search-result-style">${b.style}</div>
        </div>
      </div>
    `).join("");

    results.querySelectorAll(".p-search-result").forEach(row => {
      row.addEventListener("click", async () => {
        closeSearch();
        const { openBikeGarage } = await import("./garage.js");
        openBikeGarage(row.dataset.name);
      });
    });
  };

  renderResults("");
  input.addEventListener("input", () => renderResults(input.value));

  // Close on backdrop click
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSearch(); });
  overlay.querySelector("#p-search-close").addEventListener("click", closeSearch);
  document.addEventListener("keydown", onSearchKey);

  function onSearchKey(e) {
    if (e.key === "Escape") closeSearch();
  }

  overlay._cleanup = () => document.removeEventListener("keydown", onSearchKey);
  return overlay;
}

function openSearch() {
  const overlay = document.getElementById("p-search-overlay") || buildSearchOverlay();
  overlay.classList.add("open");
  setTimeout(() => overlay.querySelector("#p-search-input")?.focus(), 50);
}

function closeSearch() {
  const overlay = document.getElementById("p-search-overlay");
  if (!overlay) return;
  overlay.classList.remove("open");
}

// ── Global window listeners (registered once per app lifetime) ────────────
let _globalListenersRegistered = false;
function ensureGlobalListeners() {
  if (_globalListenersRegistered) return;
  _globalListenersRegistered = true;

  window.addEventListener("mm:open-bike", async (e) => {
    if (e.detail?.name) {
      const { openBikeGarage } = await import("./garage.js");
      openBikeGarage(e.detail.name);
    }
  });
  window.addEventListener("mm:open-community", async () => {
    const { openKonfigurator } = await import("./bike-detail.js");
    const def = FEATURED_BIKES[0];
    openKonfigurator(resolveFeaturedBike(def), null, "community");
  });
  window.addEventListener("mm:open-karte", async (e) => {
    const { openKonfigurator } = await import("./bike-detail.js");
    const { panHubToCoords } = await import("./garage.js");
    const primary = localStorage.getItem("mm_primary_bike");
    const def = primary
      ? FEATURED_BIKES.find((b) => b.name === primary) || FEATURED_BIKES[0]
      : FEATURED_BIKES[0];
    const { lat, lng } = e.detail || {};
    if (lat && lng) sessionStorage.setItem("mm_karte_focus", JSON.stringify({ lat, lng }));
    openKonfigurator(resolveFeaturedBike(def), null, "karte");
    if (lat && lng) {
      setTimeout(() => {
        if (!panHubToCoords(lat, lng)) {
          const retry = setInterval(() => {
            if (panHubToCoords(lat, lng)) clearInterval(retry);
          }, 200);
          setTimeout(() => clearInterval(retry), 5000);
        }
      }, 300);
    }
  });
}

// ── initLanding ───────────────────────────────────────────
export function initLanding() {
  if (landingObserver) { landingObserver.disconnect(); landingObserver = null; }
  if (_scrollHandler) { window.removeEventListener("scroll", _scrollHandler); _scrollHandler = null; }

  const landing = document.getElementById("landing");
  landing.style.display = "block";
  landing.style.opacity = "1";
  document.documentElement.classList.add("has-landing");

  landing.innerHTML = `
    <!-- ═══ MENU DRAWER ═══ -->
    <div class="p-drawer" id="p-drawer" aria-hidden="true">
      <div class="p-drawer-backdrop" id="p-drawer-backdrop"></div>
      <aside class="p-drawer-panel" role="dialog" aria-label="Hauptmenü">
        <div class="p-drawer-head">
          <span class="p-drawer-title">Menü</span>
          <button class="p-drawer-close" id="p-drawer-close" aria-label="Schließen">×</button>
        </div>
        <p class="p-drawer-sub">Entdecke MotoMatch</p>
        <nav class="p-drawer-nav tb-bar tb-bar--vertical">
          <button class="p-drawer-item tb-btn" data-tab="ansicht">Ansicht</button>
          <button class="p-drawer-item tb-btn" data-tab="ausstattung">Ausrüstung</button>
          <button class="p-drawer-item tb-btn" data-tab="match">Match finden</button>
          <button class="p-drawer-item tb-btn" data-tab="community">Community</button>
          <button class="p-drawer-item tb-btn" data-tab="karte">Karte</button>
        </nav>
        <div class="p-drawer-foot">
          <span class="p-drawer-foot-text">© MotoMatch 2026</span>
        </div>
      </aside>
    </div>

    <!-- ═══ FIXED NAV ═══ -->
    <header class="p-nav" id="p-nav">
      <div class="p-nav-left">
        <button class="p-nav-menu" id="p-nav-menu" aria-label="Menü öffnen" aria-expanded="false">
          <span class="p-nav-menu-lines"><span></span><span></span></span>
          <span class="p-nav-menu-text">Menü</span>
        </button>
      </div>
      <span class="p-nav-logo">MotoMatch</span>
      <div class="p-nav-right">
        <button class="p-nav-icon" id="nav-search" aria-label="Suche">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        </button>
        <button class="p-nav-icon" id="nav-account" aria-label="Konto">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </button>

      </div>
    </header>

    <!-- ═══ HERO ═══ -->
    <section class="p-hero">
      <video class="p-hero-video" autoplay muted loop playsinline>
        <source src="/__video/hero.mp4" type="video/mp4">
      </video>
      <div class="p-hero-gradient-top"></div>
      <div class="p-hero-gradient-bottom"></div>
      <div class="p-hero-content">
        <h1 class="p-hero-title">
          <span class="hw">Finde dein</span><br>
          <span class="hw">perfektes Bike.</span>
        </h1>
        <button id="hero-cta" class="p-hero-btn anim-p delay-1">MATCH FINDEN</button>
      </div>
    </section>

    <!-- ═══ LIFESTYLE HERO ═══ -->
    <div class="p-lifestyle-hero">
      <img src="/hero-lifestyle.jpeg" alt="Fahrerlebnis" />
    </div>

    <!-- ═══ LIFESTYLE CARDS ═══ -->
    <div class="p-lifestyle-cards">
      <article class="p-lifestyle-card" id="lc-quiz">
        <div class="p-lifestyle-card-img">
          <img src="/quiz-lifestyle.jpeg" alt="Quiz &amp; Matching">
          <div class="p-lc-info"><p class="p-lc-info-text">${LC_INFO["lc-quiz"]}</p></div>
        </div>
        <span class="p-lifestyle-card-label">Quiz &amp; Matching</span>
      </article>
      <article class="p-lifestyle-card" id="lc-dealer">
        <div class="p-lifestyle-card-img">
          <img src="/dealer-lifestyle.jpeg" alt="Händler &amp; Beratung">
          <div class="p-lc-info"><p class="p-lc-info-text">${LC_INFO["lc-dealer"]}</p></div>
        </div>
        <span class="p-lifestyle-card-label">Händler &amp; Beratung</span>
      </article>
      <article class="p-lifestyle-card" id="lc-community">
        <div class="p-lifestyle-card-img">
          <img src="/community-lifestyle.jpeg" alt="Community &amp; Gear">
          <div class="p-lc-info"><p class="p-lc-info-text">${LC_INFO["lc-community"]}</p></div>
        </div>
        <span class="p-lifestyle-card-label">Community &amp; Gear</span>
      </article>
    </div>

    <!-- ═══ DISCOVER ═══ -->
    <section class="p-discover reveal-p" id="p-discover">
      <h2 class="p-discover-title">Entdecken</h2>
      <div class="p-discover-cats">
        ${DISCOVER_CATS.map(c => `
          <div class="p-discover-cat" data-primary-bike="${c.primaryBike}">
            <img src="${c.img}" alt="${c.name}" loading="lazy">
            <div class="p-discover-cat-top">${c.bikes}</div>
            <div class="p-discover-cat-bottom">
              <div class="p-discover-cat-desc">${c.desc}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </section>

    <!-- ═══ FINDER ═══ -->
    <section class="p-finder reveal-p" id="p-finder">
      <div class="p-finder-visual">
        <img src="/bikes/sportbikes_trio.jpg" alt="MotoMatch Motorrad" />
      </div>
      <div class="p-finder-text">
        <h2 class="p-finder-title">Finde mit 7 Fragen<br>dein passendes Bike.</h2>
        <p class="p-finder-desc">Keine Verkaufsberatung, sondern ehrliches Matching — und Händler in deiner Nähe für eine unverbindliche Probefahrt.</p>
        <div class="p-finder-form">
          <button class="p-finder-submit" id="finder-submit">MATCH FINDEN</button>
        </div>
      </div>
    </section>

    <!-- ═══ FOOTER ═══ -->
    <footer class="p-footer">
      <div class="p-footer-top">
        <p class="p-footer-noch">Noch hier</p>
      </div>
      <div class="p-footer-cols">
        <div class="p-footer-col">
          <a href="/datenschutz.html" class="p-footer-link">Datenschutz / Cookies</a>
          <a href="/impressum.html" class="p-footer-link">Impressum</a>
          <!-- TODO: Zielseite für "Kontakt" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Kontakt</span>
          <!-- TODO: Zielseite für "Karriere" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Karriere</span>
          <!-- TODO: Zielseite für "Newsroom & Presse" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Newsroom &amp; Presse</span>
        </div>
        <div class="p-footer-col">
          <!-- TODO: Zielseite für "Investor Relations" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Investor Relations</span>
          <!-- TODO: Zielseite für "MotoMatch AG" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">MotoMatch AG</span>
          <!-- TODO: Zielseite für "Motorrad-Konfigurator" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Motorrad-Konfigurator</span>
          <!-- TODO: Zielseite für "Händler finden" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Händler finden</span>
          <!-- TODO: Zielseite für "MotoMatch Connect" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">MotoMatch Connect</span>
        </div>
        <div class="p-footer-col">
          <!-- TODO: Zielseite für "MotoMatch Homepage" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">MotoMatch Homepage</span>
          <!-- TODO: Zielseite für "Motorrad kaufen" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Motorrad kaufen</span>
          <!-- TODO: Zielseite für "Motorrad verkaufen" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Motorrad verkaufen</span>
          <!-- TODO: Zielseite für "Marktplatz" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">Marktplatz</span>
          <!-- TODO: Zielseite für "MotoMatch Contact" noch nicht angelegt -->
          <span class="p-footer-link p-footer-link--disabled">MotoMatch Contact</span>
        </div>
      </div>
      <div class="p-footer-bottom">
        <span class="p-footer-copy">© 2026 MotoMatch AG. Alle Rechte vorbehalten.</span>
        <span class="p-footer-logo">MotoMatch</span>
      </div>
    </footer>
  `;

  // ── Quiz start ──────────────────────────────────────────
  const startQuiz = async () => {
    if (_scrollHandler) { window.removeEventListener("scroll", _scrollHandler); _scrollHandler = null; }
    if (landingObserver) { landingObserver.disconnect(); landingObserver = null; }
    document.documentElement.classList.remove("has-landing");
    landing.style.transition = "opacity 0.5s ease";
    landing.style.opacity = "0";
    const { initQuiz } = await import("./quiz.js");
    setTimeout(() => {
      landing.style.display = "none";
      document.getElementById("quiz-screen").style.display = "flex";
      initQuiz();
    }, 500);
  };

  document.getElementById("hero-cta").addEventListener("click", startQuiz);
  // Die drei Lifestyle-Karten haben bewusst keine Klick-Funktion mehr —
  // sie zeigen beim Hovern/Antippen nur die kurze Vorschau-Info (siehe CSS).

  // ── Discover category cards → Garage ───────────────────
  landing.querySelectorAll(".p-discover-cat").forEach((cat) => {
    cat.addEventListener("click", async () => {
      const primaryBike = cat.dataset.primaryBike;
      if (primaryBike) {
        const { openBikeGarage } = await import("./garage.js");
        openBikeGarage(primaryBike);
      }
    });
  });

  // ── Nav: Search ──────────────────────────────────────────
  document.getElementById("nav-search").addEventListener("click", openSearch);

  // ── Nav: Account ─────────────────────────────────────────
  document.getElementById("nav-account").addEventListener("click", async () => {
    const { openAccount } = await import("./account.js");
    openAccount();
  });

  // ── Global window listeners (once per app lifetime) ──────
  ensureGlobalListeners();


  // ── Nav: Menu (hamburger → drawer) ──────────────────────
  const menuBtn = document.getElementById("p-nav-menu");
  const drawer = document.getElementById("p-drawer");
  const drawerBackdrop = document.getElementById("p-drawer-backdrop");
  const drawerClose = document.getElementById("p-drawer-close");

  function openDrawer() {
    if (!drawer) return;
    drawer.setAttribute("aria-hidden", "false");
    drawer.classList.add("p-drawer--open");
    menuBtn.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove("p-drawer--open");
    menuBtn.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
    setTimeout(() => { drawer.setAttribute("aria-hidden", "true"); }, 300);
    document.body.style.overflow = "";
  }

  menuBtn.addEventListener("click", () => {
    if (drawer?.classList.contains("p-drawer--open")) closeDrawer();
    else openDrawer();
  });
  drawerBackdrop?.addEventListener("click", closeDrawer);
  drawerClose?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer?.classList.contains("p-drawer--open")) closeDrawer();
  });

  // Drawer item click → open default bike on chosen tab
  document.querySelectorAll(".p-drawer-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = btn.dataset.tab;
      closeDrawer();

      // Startseite sauber ausblenden — sonst bleibt sie unsichtbar im
      // Hintergrund aktiv (Menü/Scroll-Handler etc.), während der
      // Konfigurator angezeigt wird.
      if (_scrollHandler) { window.removeEventListener("scroll", _scrollHandler); _scrollHandler = null; }
      if (landingObserver) { landingObserver.disconnect(); landingObserver = null; }
      document.documentElement.classList.remove("has-landing");
      landing.style.transition = "opacity 0.3s ease";
      landing.style.opacity = "0";

      const defaultBike = FEATURED_BIKES[0];
      const { openKonfigurator } = await import("./bike-detail.js");
      setTimeout(() => {
        landing.style.display = "none";
        openKonfigurator(resolveFeaturedBike(defaultBike), null, tab);
      }, 300);
    });
  });

  // ── Finder submit ────────────────────────────────────────
  const finderSubmit = document.getElementById("finder-submit");
  if (finderSubmit) {
    finderSubmit.addEventListener("click", startQuiz);
  }

  // ── Nav scroll behaviour ─────────────────────────────────
  const nav = document.getElementById("p-nav");
  _scrollHandler = () => nav.classList.toggle("is-scrolled", window.scrollY > 40);
  window.addEventListener("scroll", _scrollHandler, { passive: true });

  // ── Preload quiz assets ──────────────────────────────────
  setTimeout(() => import("./quiz.js").then(m => m.preloadQuizAssets()), 2000);

  // ── First-visit onboarding ─────────────────────────────────
  maybeShowOnboarding();

  // ── Scroll reveal ────────────────────────────────────────
  landingObserver = new IntersectionObserver(
    (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("vis"); }),
    { threshold: 0, rootMargin: "0px 0px -5% 0px" },
  );
  landing.querySelectorAll(".reveal-p").forEach((el) => landingObserver.observe(el));
  // Fallback: mark already-visible elements immediately
  setTimeout(() => {
    landing.querySelectorAll(".reveal-p:not(.vis)").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) el.classList.add("vis");
    });
  }, 100);

  // ── Hero entrance animation ──────────────────────────────
  const words = landing.querySelectorAll(".p-hero-title .hw");
  words.forEach((w, i) => setTimeout(() => w.classList.add("vis"), 200 + i * 180));
  const delay = 200 + words.length * 180 + 150;
  setTimeout(() => {
    landing.querySelectorAll(".anim-p").forEach((el, i) => {
      setTimeout(() => el.classList.add("vis"), i * 220);
    });
  }, delay);
  // ── Hard fallback: ensure nothing stays invisible ────────
  setTimeout(() => {
    landing.querySelectorAll(".hw, .anim-p, .reveal-p").forEach((el) => el.classList.add("vis"));
  }, 1200);
}
