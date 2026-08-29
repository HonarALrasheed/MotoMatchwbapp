import { findBestBike } from "./matching.js";

const BIKES = [
  { name: "Honda NR750", img: "/bikes/2/honda_nr750_1994.png" },
  { name: "Honda CB 750 F", img: "/bikes/2/honda_cb750f_1970.png" },
  { name: "Yamaha YZF-R3", img: "/bikes/2/yamaha_yzfr3_2017.png" },
  { name: "Harley Seventy-Two", img: "/bikes/2/harley_seventytwo_2015.png" },
  { name: "Harley Iron 883", img: "/bikes/2/harley_iron883_2018.png" },
  { name: "Yamaha 500 Custom", img: "/bikes/2/yamaha_500custom.png" },
  { name: "Honda CRF 450R", img: "/bikes/2/honda_crf450r_2023.png" },
  { name: "Yamaha RX-King 135", img: "/bikes/2/yamaha_rxking_135.png" },
  { name: "Suzuki GSX-R 750", img: "/bikes/2/suzuki_gsxr750_2023.png" },
  { name: "Yamaha DT 125 E", img: "/bikes/2/yamaha_dt125e_1974.png" },
];

const CARD_W = 240;
const CARD_GAP = 16;
const CARD_STEP = CARD_W + CARD_GAP;

export function startDropAnimation(answers) {
  const container = document.getElementById("drop-container");
  container.style.display = "flex";
  container.style.opacity = "1";

  const winner = findBestBike(answers);
  try { localStorage.setItem('mm_primary_bike', winner.name); } catch (e) { /* ignore */ }
  const winBike =
    BIKES.find((b) => b.name === winner.name) ||
    BIKES.find((b) => winner.name.includes(b.name.split(" ").slice(-1)[0])) ||
    BIKES[0];

  // ── Build strip: 70 items, winner near end ──
  const TOTAL = 70;
  const WIN_POS = TOTAL - 8;
  const strip = [];
  const others = BIKES.filter((b) => b.name !== winBike.name);
  for (let i = 0; i < TOTAL; i++) {
    if (i === WIN_POS) {
      strip.push(winBike);
    } else {
      strip.push(others[Math.floor(Math.random() * others.length)]);
    }
  }

  // ── DOM ──
  container.innerHTML = `
    <div class="rl-wrap">
      <div class="rl-label" id="rl-label">DEIN MATCH WIRD ERMITTELT</div>
      <div class="rl-viewport" id="rl-vp">
        <div class="rl-marker"></div>
        <div class="rl-strip" id="rl-strip">
          ${strip
            .map(
              (b, i) => `
            <div class="rl-card${i === WIN_POS ? " rl-winner" : ""}" data-i="${i}">
              <img src="${b.img}" alt="${b.name}" draggable="false">
              <div class="rl-card-name">${b.name}</div>
            </div>
          `,
            )
            .join("")}
        </div>
        <div class="rl-edge rl-edge-l"></div>
        <div class="rl-edge rl-edge-r"></div>
      </div>
      <div class="rl-flash" id="rl-flash"></div>
      <div class="rl-result" id="rl-result">
        <img class="rl-result-img" id="rl-result-img" src="${winBike.img}" alt="${winner.name}" style="background:transparent;">
        <div class="rl-result-text">
          <span class="rl-result-sub">Dein perfektes Bike</span>
          <span class="rl-result-name" id="rl-result-name">${winner.name}</span>
        </div>
      </div>
    </div>
  `;

  const stripEl = document.getElementById("rl-strip");
  const vpEl = document.getElementById("rl-vp");
  const label = document.getElementById("rl-label");

  // ── Physics-based animation ──
  const DURATION = 7000;
  let t0 = null;
  let prevCard = -1;
  let x = 0;
  let finalX = 0;
  let vpW = 0;

  function ease(t) {
    // Fast start, very gradual slowdown, precise landing
    if (t < 0.65) {
      // Fast phase: cubic ease-out
      const p = t / 0.65;
      return 0.8 * (1 - Math.pow(1 - p, 3));
    } else {
      // Slow crawl — smooth deceleration, no overshoot
      const p = (t - 0.65) / 0.35;
      return 0.8 + 0.2 * (1 - Math.pow(1 - p, 5));
    }
  }

  function frame(ts) {
    if (!t0) t0 = ts;
    const elapsed = ts - t0;
    const progress = Math.min(elapsed / DURATION, 1);
    const eased = ease(progress);
    x = eased * finalX;

    stripEl.style.transform = `translateX(${-x}px)`;

    // ── Highlight card nearest to center ──
    const centerX = x + vpW / 2;
    const nearestIdx = Math.round(centerX / CARD_STEP);
    if (nearestIdx !== prevCard && nearestIdx >= 0 && nearestIdx < TOTAL) {
      prevCard = nearestIdx;
      // Tick flash
      const marker = container.querySelector(".rl-marker");
      marker.classList.remove("rl-tick");
      void marker.offsetWidth;
      marker.classList.add("rl-tick");
    }

    // ── Scale cards based on distance to center (only visible ones) ──
    const cards = stripEl.children;
    const visibleStart = Math.max(0, Math.floor((centerX - vpW) / CARD_STEP));
    const visibleEnd = Math.min(TOTAL, Math.ceil((centerX + vpW) / CARD_STEP) + 1);
    for (let i = visibleStart; i < visibleEnd; i++) {
      const cardCenter = i * CARD_STEP + CARD_W / 2;
      const dist = Math.abs(cardCenter - centerX);
      const norm = Math.min(dist / (vpW * 0.45), 1);
      const s = 1 - norm * 0.15;
      const bright = 1 - norm * 0.5;
      cards[i].style.transform = `scale(${s})`;
      cards[i].style.filter = `brightness(${bright})`;
    }

    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      onReveal();
    }
  }

  // Start immediately after layout
  requestAnimationFrame(() => {
    vpW = vpEl.offsetWidth;
    const winnerCard = stripEl.children[WIN_POS];
    if (winnerCard) {
      finalX = winnerCard.offsetLeft + winnerCard.offsetWidth / 2 - vpW / 2;
    } else {
      finalX = WIN_POS * CARD_STEP - vpW / 2 + CARD_W / 2;
    }
    requestAnimationFrame(frame);
  });

  function onReveal() {
    // Highlight winner
    const winEl = container.querySelector(".rl-winner");
    if (winEl) {
      winEl.classList.add("rl-revealed");
      winEl.style.transform = "scale(1)";
      winEl.style.filter = "brightness(1)";
    }

    // Hide label
    label.style.opacity = "0";

    // Flash
    const flash = document.getElementById("rl-flash");
    flash.classList.add("active");

    // After flash, show result screen
    setTimeout(() => {
      // Fade out roulette
      vpEl.style.transition =
        "opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)";
      vpEl.style.opacity = "0";
      vpEl.style.transform = "scale(0.95)";

      // Show result
      const result = document.getElementById("rl-result");
      result.classList.add("active");
    }, 1200);

    // Transition to 3D garage
    setTimeout(() => {
      container.style.transition = "opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1)";
      container.style.opacity = "0";
      setTimeout(() => {
        container.style.display = "none";
        // Erst hier nachladen statt oben statisch: der statische Import zog
        // garage.js (mit three.js und Leaflet) in jeden Chunk, der quiz.js
        // anfasst — und damit ueber die Quiz-Vorbereitung auf die Startseite.
        import("./garage.js").then(m => m.loadGarage(answers));
      }, 800);
    }, 3800);
  }
}
