import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { startDropAnimation } from "./drop-animation.js";
import { LS_QUIZ_ANSWERS } from "./util.js";

/* ═══ Questions ═══ */
const questions = [
  {
    id: 1,
    question: "Welche Führerscheinklasse hast du?",
    options: [
      { value: "A1", label: "A1 — max. 125cc" },
      { value: "A2", label: "A2 — max. 35kW" },
      { value: "A", label: "A — Unbegrenzt" },
      { value: "B196", label: "B196 — 125cc ab 25" },
    ],
  },
  {
    id: 2,
    question: "Wie ist deine Fahrerfahrung?",
    options: [
      { value: "Anfänger", label: "Anfänger" },
      { value: "Wiedereinsteiger", label: "Wiedereinsteiger" },
      { value: "Profi", label: "Profi" },
    ],
  },
  {
    id: 3,
    question: "Welcher Stil spricht dich an?",
    options: [
      { value: "Sportbike", label: "Sportbike" },
      { value: "Naked", label: "Naked Bike" },
      { value: "Cruiser", label: "Cruiser" },
      { value: "Enduro", label: "Enduro / Offroad" },
    ],
  },
  {
    id: 4,
    question: "Wofür nutzt du das Motorrad?",
    options: [
      { value: "Pendeln", label: "Pendeln / Kurzstrecke" },
      { value: "Urlaub", label: "Touren / Urlaub" },
      { value: "Gelände", label: "Gelände / Offroad" },
      { value: "Rennstrecke", label: "Rennstrecke / Performance" },
    ],
  },
  {
    id: 5,
    question: "Dein Budget?",
    type: "slider",
    unit: "€",
    min: 1000,
    max: 30000,
    step: 500,
    default: 10000,
    openEnded: true,
  },
  {
    id: 6,
    question: "Wie groß bist du?",
    type: "slider",
    unit: "cm",
    min: 150,
    max: 210,
    step: 1,
    default: 175,
  },
  {
    id: 7,
    question: "Fährst du mit Beifahrer?",
    options: [
      { value: "Ja", label: "Ja, regelmäßig" },
      { value: "Nein", label: "Nein, nur allein" },
    ],
  },
];

/* ═══ State ═══ */
let idx = 0,
  answers = {};
let speed = 0,
  targetSpeed = 0;
let exiting = false,
  exitPhase = 0;
let animId = null;
let chaosNeedle = 0;
let digitalDisplay = "0";
let idleTimer = 0;
let rpmSpikeTimer = null;

/* Three.js */
let scene, camera, renderer, mixer, bike, clock;
let gaugeCanvas, gaugeCtx;
let roadDashes = [];
let dashInstances = null;
const DASH_COUNT = 40;
let speedStreaks = [];
let groundMesh;
let wheels = [];
let sideView = false;
let handAction = null;

/* ═══ Bike Interaction State ═══ */
let currentQuestionIndex = 0;
let bikeTargetX = 0;
let bikeCurX = 0;
let bikeTargetLean = 0;
let bikeCurLean = 0;
let wheelieAmount = 0;
let wheelieTarget = 0;
let bikeBaseY = 0;
let bikePivotGroup = null;
let phase2Active = false;
let roadScrollDir = 1;
let worldGroup = null;
let worldTargetRotY = 0;
let worldCurRotY = 0;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/* Headlight */
let headlight = null;

/* Camera shake */
const shakeOffset = new THREE.Vector3();
let shakeIntensity = 0;

/* Suspension bob */
let bobPhase = 0;
let bobAmount = 0;

/* Particles */
let sparkGeo = null,
  sparkMat = null,
  sparkPoints = null;
let dustGeo = null,
  dustMat = null,
  dustPoints = null;
const SPARK_COUNT = 80;
const DUST_COUNT = 40;

/* Phase transition */
let transitionActive = false;
let transitionTimer = 0;
let transitionDuration = 1.8;

/* Exit enhancement */
let exitBlurStreaks = [];

/* Constants */
const GAUGE_START = (Math.PI * 5) / 6;
const GAUGE_RANGE = (Math.PI * 4) / 3;
const MAX_KMH = 160;
const CAM_BASE = new THREE.Vector3(0, 1.8, 7);
const CAM_LOOK = new THREE.Vector3(0, 0.5, 0);
const IS_TOUCH = "ontouchstart" in window;
const STREAK_COUNT = IS_TOUCH ? 30 : 55;
const PREFERS_REDUCED = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/* ═══ Preload ═══ */
let preloadedBikeGLTF = null;

function createLoader() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  );
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export function preloadQuizAssets() {
  if (preloadedBikeGLTF) return;
  createLoader().load(
    "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/akira_guy_on_motorcycle_animated.glb",
    (gltf) => {
      preloadedBikeGLTF = gltf;
    },
  );
}

/* ═══ Persistence helpers ═══ */
const LS_KEY = LS_QUIZ_ANSWERS;

function saveAnswers() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(answers)); } catch (e) { /* ignore */ }
}

/* ═══ Init ═══ */
export function initQuiz() {
  idx = 0;
  answers = {};
  speed = 0;
  targetSpeed = 20;
  exiting = false;
  exitPhase = 0;
  phase2Active = false;
  sideView = false;
  worldTargetRotY = 0;
  worldCurRotY = 0;
  roadScrollDir = 1;
  wheelieAmount = 0;
  wheelieTarget = 0;
  transitionActive = false;
  bobPhase = 0;
  shakeIntensity = 0;

  setupThreeJS();
  setupGauge();
  setupMouse();

  clock = new THREE.Timer();
  animId = requestAnimationFrame(loop);

  showQuestion(0);
}

/* ═══ Three.js Setup ═══ */
function setupThreeJS() {
  const canvas = document.getElementById("moto-canvas");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x000000, 0.025);

  const screen = document.getElementById("quiz-screen");
  const w = screen ? screen.clientWidth : window.innerWidth;
  const h = screen ? screen.clientHeight : window.innerHeight;

  camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 500);
  camera.position.copy(CAM_BASE);
  camera.lookAt(CAM_LOOK);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(3, 8, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x6688cc, 0.6);
  rimLight.position.set(-4, 3, -3);
  scene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0xc9a84c, 0.3);
  fillLight.position.set(-2, 1, 4);
  scene.add(fillLight);

  worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // Ground — pure black for night atmosphere
  const groundGeo = new THREE.PlaneGeometry(300, 300);
  const groundMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
  });
  groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.01;
  worldGroup.add(groundMesh);

  createRoadDashes();
  createSpeedStreaks();
  createParticles();

  // Load GLB with DRACO decompression (use preloaded if available)
  const setupBike = (gltf) => {
    // Guard: scene was cleaned up while model was loading
    if (!scene || !worldGroup) return;
    bike = gltf.scene;

    const box = new THREE.Box3().setFromObject(bike);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2.0 / maxDim;
    bike.scale.setScalar(scale);
    bike.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    bike.rotation.y = Math.PI;

    wheels = [];
    bike.traverse((child) => {
      const name = (child.name || "").toLowerCase();
      if (name === "wheel_wheel_0" || name === "wheel_wheel_0001") {
        wheels.push(child);
      }
    });
    if (wheels.length === 0) {
      bike.traverse((child) => {
        const name = (child.name || "").toLowerCase();
        if (name.includes("wheel") && !wheels.includes(child.parent)) {
          wheels.push(child);
        }
      });
    }

    const bikeBox = new THREE.Box3().setFromObject(bike);
    const bikeSize = bikeBox.getSize(new THREE.Vector3());
    bikeBaseY = bike.position.y;

    bikePivotGroup = new THREE.Group();
    bikePivotGroup.position.set(
      bike.position.x,
      0,
      bike.position.z + bikeSize.z * 0.3,
    );
    worldGroup.add(bikePivotGroup);

    bike.position.x -= bikePivotGroup.position.x;
    bike.position.z -= bikePivotGroup.position.z;
    bikePivotGroup.add(bike);

    // Headlight glow
    headlight = new THREE.PointLight(0xffffcc, 2, 15, 2);
    headlight.position.set(0, bikeSize.y * 0.35, -bikeSize.z * 0.4);
    bike.add(headlight);

    // Animation
    if (gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(bike);
      const clip = gltf.animations[0];
      handAction = mixer.clipAction(clip);
      handAction.setLoop(THREE.LoopOnce);
      handAction.clampWhenFinished = true;
      handAction.play();
      handAction.time = 0;
      handAction.paused = true;
      mixer.update(0);
    }
  };

  if (preloadedBikeGLTF) {
    setupBike(preloadedBikeGLTF);
    preloadedBikeGLTF = null;
  } else {
    createLoader().load(
      "https://quljniqnizxlhczzfkhq.supabase.co/storage/v1/object/public/models/akira_guy_on_motorcycle_animated.glb",
      setupBike,
      undefined,
      (err) => console.error("GLB load error:", err),
    );
  }

  window.addEventListener("resize", onResize);
}

/* ═══ Road Dashes ═══ */
function createRoadDashes() {
  const dashGeo = new THREE.BoxGeometry(0.15, 0.005, 1.2);
  const dashMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
  });

  dashInstances = new THREE.InstancedMesh(dashGeo, dashMat, DASH_COUNT);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < DASH_COUNT; i++) {
    dummy.position.set(0, 0.005, -i * 3 + 20);
    dummy.updateMatrix();
    dashInstances.setMatrixAt(i, dummy.matrix);
  }
  dashInstances.instanceMatrix.needsUpdate = true;
  worldGroup.add(dashInstances);

  const edgeGeo = new THREE.BoxGeometry(0.08, 0.005, 300);
  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
  });
  const leftEdge = new THREE.Mesh(edgeGeo, edgeMat);
  leftEdge.position.set(-1.5, 0.005, -130);
  worldGroup.add(leftEdge);
  const rightEdge = new THREE.Mesh(edgeGeo, edgeMat.clone());
  rightEdge.position.set(1.5, 0.005, -130);
  worldGroup.add(rightEdge);
}

/* ═══ Speed Streaks (improved) ═══ */
function createSpeedStreaks() {
  if (PREFERS_REDUCED) return;
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
  });

  for (let i = 0; i < STREAK_COUNT; i++) {
    const len = 2 + Math.random() * 8;
    const geo = new THREE.BoxGeometry(0.02 + Math.random() * 0.05, 0.01, len);
    const streak = new THREE.Mesh(geo, mat.clone());
    streak.userData = {
      baseX: (Math.random() - 0.5) * 8,
      baseY: 0.1 + Math.random() * 2.0,
      baseZ: -2 - Math.random() * 18,
      speed: 3 + Math.random() * 8,
      phase: Math.random() * Math.PI * 2,
      maxAlpha: 0.08 + Math.random() * 0.3,
      baseLen: len,
    };
    streak.position.set(
      streak.userData.baseX,
      streak.userData.baseY,
      streak.userData.baseZ,
    );
    worldGroup.add(streak);
    speedStreaks.push(streak);
  }
}

/* ═══ Particles (sparks + dust) ═══ */
function createParticles() {
  if (PREFERS_REDUCED) return;
  // Sparks — for wheelie
  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  const sparkAlphas = new Float32Array(SPARK_COUNT);
  const sparkVelocities = [];
  const sparkLives = new Float32Array(SPARK_COUNT);
  for (let i = 0; i < SPARK_COUNT; i++) {
    sparkVelocities.push(new THREE.Vector3());
    sparkLives[i] = 0;
  }
  sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(sparkPositions, 3),
  );
  sparkMat = new THREE.PointsMaterial({
    color: 0xffaa33,
    size: 0.04,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  sparkPoints = new THREE.Points(sparkGeo, sparkMat);
  sparkPoints.userData = {
    velocities: sparkVelocities,
    lives: sparkLives,
    alphas: sparkAlphas,
  };
  worldGroup.add(sparkPoints);

  // Dust — rear wheel at speed
  const dustPositions = new Float32Array(DUST_COUNT * 3);
  const dustAlphas = new Float32Array(DUST_COUNT);
  const dustVelocities = [];
  const dustLives = new Float32Array(DUST_COUNT);
  for (let i = 0; i < DUST_COUNT; i++) {
    dustVelocities.push(new THREE.Vector3());
    dustLives[i] = 0;
  }
  dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  dustMat = new THREE.PointsMaterial({
    color: 0x666666,
    size: 0.1,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  dustPoints = new THREE.Points(dustGeo, dustMat);
  dustPoints.userData = {
    velocities: dustVelocities,
    lives: dustLives,
    alphas: dustAlphas,
  };
  worldGroup.add(dustPoints);
}

/* ═══ Gauge ═══ */
function setupGauge() {
  gaugeCanvas = document.getElementById("gauge-canvas");
  if (!gaugeCanvas) return;
  gaugeCanvas.width = 560;
  gaugeCanvas.height = 340;
  gaugeCtx = gaugeCanvas.getContext("2d");
}

/* ═══ Mouse / Touch Setup ═══ */
function setupMouse() {
  const canvas = renderer.domElement;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
}

let dragStartX = 0;
let isDragging = false;

function onPointerDown(e) {
  e.preventDefault();
  // Only interact with the 3D area (above quiz container)
  const quizContainer = document.getElementById("quiz-container");
  const quizTop = quizContainer
    ? quizContainer.getBoundingClientRect().top
    : window.innerHeight * 0.55;
  if (e.clientY > quizTop) return;

  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (!bike) return;

  if (phase2Active) {
    wheelieTarget = 1;
    isDragging = true;
    return;
  }

  raycaster.setFromCamera(pointer, camera);
  const target = bikePivotGroup || bike;
  const hits = raycaster.intersectObject(target, true);
  if (hits.length > 0) {
    isDragging = true;
    dragStartX = e.clientX;
  }
}

function onPointerMove(e) {
  if (!isDragging) return;
  e.preventDefault();
  if (!phase2Active) {
    const deltaX = (e.clientX - dragStartX) / window.innerWidth;
    bikeTargetX = deltaX * 4;
    bikeTargetLean = -deltaX * 0.3;
  }
}

function onPointerUp() {
  isDragging = false;
  if (!phase2Active) {
    bikeTargetX = 0;
    bikeTargetLean = 0;
  }
  if (phase2Active) {
    wheelieTarget = 0;
  }
}

function onResize() {
  if (!renderer) return;
  const screen = document.getElementById("quiz-screen");
  const w = screen ? screen.clientWidth : window.innerWidth;
  const h = screen ? screen.clientHeight : window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

/* ═══ Animation Loop ═══ */
function loop() {
  animId = requestAnimationFrame(loop);
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.getElapsed();

  // Speed
  speed += (targetSpeed - speed) * (exiting ? 0.06 : 0.025);

  // Needle follows actual speed (smooth)
  chaosNeedle += (speed - chaosNeedle) * dt * 4;

  // Digital display shows actual speed
  digitalDisplay = String(Math.round(chaosNeedle));

  // Idle decay: reduce speed if user takes long (not during transition)
  idleTimer += dt;
  if (idleTimer > 4 && !exiting && !transitionActive) {
    targetSpeed = Math.max(5, targetSpeed - dt * 1.5);
  }

  if (mixer) mixer.update(dt);

  // Phase transition (cinematic sweep)
  if (transitionActive) {
    updateTransition(dt);
  } else if (worldGroup) {
    worldCurRotY += (worldTargetRotY - worldCurRotY) * dt * 2.0;
    worldGroup.rotation.y = worldCurRotY;
  }

  // Suspension bobbing
  bobPhase += dt * (3 + speed * 0.03);
  bobAmount = Math.sin(bobPhase) * (0.002 + speed * 0.00003);
  bobAmount *= 1 - wheelieAmount * 0.7;

  // Phase 1 (Q1-3): lateral movement & lean
  if (!phase2Active && bike && bikePivotGroup) {
    bikeCurX += (bikeTargetX - bikeCurX) * dt * 5;
    bikePivotGroup.position.x = bikeCurX;
    bikePivotGroup.position.y = bobAmount;

    bikeCurLean += (bikeTargetLean - bikeCurLean) * dt * 5;
    bike.rotation.z = bikeCurLean;
    bike.rotation.x = 0;
  }

  // Phase 2 (Q4+): wheelie via pivot group
  if (phase2Active && bikePivotGroup) {
    wheelieAmount += (wheelieTarget - wheelieAmount) * dt * 6;
    bikePivotGroup.rotation.x = wheelieAmount * -0.4;
    bikePivotGroup.rotation.z = 0;
    bikePivotGroup.position.y = wheelieAmount * 0.55 + bobAmount;
    bike.rotation.z = 0;
  }

  // Spin wheels
  const wheelSpin = dt * (speed / 30);
  for (const w of wheels) w.rotation.x += wheelSpin;

  // Headlight pulse
  if (headlight) {
    headlight.intensity = 2 + Math.sin(elapsed * 3) * 0.15;
  }

  // Road dashes
  updateRoadDashes(dt);

  // Speed streaks
  updateSpeedStreaks(elapsed, dt);

  // Particles
  updateParticles(dt);

  // Camera shake
  updateCameraShake(dt, elapsed);

  // Exit animation
  if (exitPhase === 2 && bikePivotGroup) {
    bikePivotGroup.position.z += dt * 30 * (speed / 100);
    if (bikePivotGroup.position.z > 40) finishExit();
  }

  renderer.render(scene, camera);
  drawGauge();
}

/* ═══ Camera Shake ═══ */
function updateCameraShake(dt, elapsed) {
  const targetShake =
    (speed / 200) * 0.012 + wheelieAmount * 0.025 + (exiting ? 0.03 : 0);
  shakeIntensity += (targetShake - shakeIntensity) * dt * 5;

  shakeOffset.x =
    Math.sin(elapsed * 23.1) * Math.cos(elapsed * 17.3) * shakeIntensity;
  shakeOffset.y =
    Math.sin(elapsed * 19.7) * Math.cos(elapsed * 13.1) * shakeIntensity;
  shakeOffset.z =
    Math.sin(elapsed * 11.3) * Math.cos(elapsed * 29.7) * shakeIntensity * 0.5;

  camera.position.copy(CAM_BASE).add(shakeOffset);
  camera.lookAt(CAM_LOOK);
}

/* ═══ Phase Transition (cinematic Q3→Q4 sweep) ═══ */
let preTransitionSpeed = 0;

function startPhaseTransition() {
  transitionActive = true;
  transitionTimer = 0;
  transitionDuration = 1.8;
  // Save base speed and boost during transition
  preTransitionSpeed = targetSpeed;
  targetSpeed = preTransitionSpeed + 40;
}

function updateTransition(dt) {
  transitionTimer += dt;
  const t = Math.min(transitionTimer / transitionDuration, 1);

  // Cubic ease-in-out
  const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  worldCurRotY = eased * (Math.PI / 2);
  worldGroup.rotation.y = worldCurRotY;

  // Flip road scroll at midpoint
  if (t >= 0.5 && roadScrollDir !== -1) {
    roadScrollDir = -1;
  }

  if (t >= 1) {
    transitionActive = false;
    worldTargetRotY = Math.PI / 2;
    worldCurRotY = Math.PI / 2;
    phase2Active = true;
    sideView = true;
    // Restore to proper question speed (not relative)
    targetSpeed = preTransitionSpeed;
    bikeTargetX = 0;
    bikeCurX = 0;
    bikeTargetLean = 0;
    bikeCurLean = 0;
  }
}

/* ═══ Road Dashes ═══ */
function updateRoadDashes(dt) {
  // Move road dashes (InstancedMesh)
  if (dashInstances) {
    const scrollSpeed = speed * 0.04 * roadScrollDir;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < DASH_COUNT; i++) {
      dashInstances.getMatrixAt(i, dummy.matrix);
      dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
      dummy.position.z += scrollSpeed * dt;
      if (roadScrollDir > 0 && dummy.position.z > 25) dummy.position.z -= 120;
      else if (roadScrollDir < 0 && dummy.position.z < -100)
        dummy.position.z += 120;
      dummy.updateMatrix();
      dashInstances.setMatrixAt(i, dummy.matrix);
    }
    dashInstances.instanceMatrix.needsUpdate = true;
  }
}

/* ═══ Speed Streaks (improved) ═══ */
function updateSpeedStreaks(elapsed, dt) {
  const speedFactor = Math.min(speed / 160, 1);
  for (const streak of speedStreaks) {
    const ud = streak.userData;
    streak.position.z += speed * 0.04 * dt * roadScrollDir;

    // Dynamic length scaling with speed
    streak.scale.z = 1 + speedFactor * 2.5;

    if (roadScrollDir > 0 && streak.position.z > 15) {
      streak.position.z = ud.baseZ - Math.random() * 12;
      streak.position.x = (Math.random() - 0.5) * 8;
      streak.position.y = 0.1 + Math.random() * 2.0;
    } else if (roadScrollDir < 0 && streak.position.z < -20) {
      streak.position.z = 15 + Math.random() * 12;
      streak.position.x = (Math.random() - 0.5) * 8;
      streak.position.y = 0.1 + Math.random() * 2.0;
    }

    const flicker = 0.5 + 0.5 * Math.sin(elapsed * ud.speed + ud.phase);
    streak.material.opacity = ud.maxAlpha * speedFactor * flicker;

    // Warm tint at high speed
    if (speedFactor > 0.7) {
      const warmth = (speedFactor - 0.7) / 0.3;
      streak.material.color.setRGB(1, 1 - warmth * 0.1, 1 - warmth * 0.2);
    }
  }
}

/* ═══ Particles ═══ */
function updateParticles(dt) {
  if (!sparkPoints || !dustPoints || !bikePivotGroup) return;

  const sparkPos = sparkGeo.attributes.position.array;
  const sparkData = sparkPoints.userData;
  const pivotWorld = new THREE.Vector3();
  bikePivotGroup.getWorldPosition(pivotWorld);

  // Sparks — active during wheelie
  for (let i = 0; i < SPARK_COUNT; i++) {
    if (sparkData.lives[i] > 0) {
      sparkData.lives[i] -= dt;
      const v = sparkData.velocities[i];
      v.y -= 9.8 * dt; // gravity
      sparkPos[i * 3] += v.x * dt;
      sparkPos[i * 3 + 1] += v.y * dt;
      sparkPos[i * 3 + 2] += v.z * dt;
      if (sparkPos[i * 3 + 1] < 0) sparkData.lives[i] = 0;
    } else if (wheelieAmount > 0.2 && Math.random() < wheelieAmount * 0.4) {
      // Spawn new spark at rear wheel contact
      sparkPos[i * 3] = pivotWorld.x + (Math.random() - 0.5) * 0.3;
      sparkPos[i * 3 + 1] = 0.02;
      sparkPos[i * 3 + 2] = pivotWorld.z + (Math.random() - 0.5) * 0.3;
      sparkData.lives[i] = 0.3 + Math.random() * 0.5;
      const v = sparkData.velocities[i];
      v.set(
        (Math.random() - 0.5) * 2,
        1 + Math.random() * 3,
        (Math.random() - 0.5) * 2,
      );
    } else {
      sparkPos[i * 3 + 1] = -10; // hide below
    }
  }
  sparkMat.opacity = wheelieAmount > 0.1 ? 1 : 0;
  sparkGeo.attributes.position.needsUpdate = true;

  // Dust — active at high speed
  const dustPos = dustGeo.attributes.position.array;
  const dustData = dustPoints.userData;
  const speedRatio = Math.min(speed / 160, 1);

  for (let i = 0; i < DUST_COUNT; i++) {
    if (dustData.lives[i] > 0) {
      dustData.lives[i] -= dt;
      const v = dustData.velocities[i];
      v.y += 0.5 * dt; // slight upward drift
      dustPos[i * 3] += v.x * dt;
      dustPos[i * 3 + 1] += v.y * dt;
      dustPos[i * 3 + 2] += v.z * dt;
    } else if (speedRatio > 0.3 && Math.random() < speedRatio * 0.15) {
      dustPos[i * 3] = pivotWorld.x + (Math.random() - 0.5) * 0.5;
      dustPos[i * 3 + 1] = 0.05 + Math.random() * 0.1;
      dustPos[i * 3 + 2] = pivotWorld.z + (Math.random() - 0.5) * 0.5;
      dustData.lives[i] = 0.5 + Math.random() * 1.0;
      const v = dustData.velocities[i];
      v.set(
        (Math.random() - 0.5) * 0.5,
        0.1 + Math.random() * 0.3,
        roadScrollDir * (0.5 + Math.random()),
      );
    } else {
      dustPos[i * 3 + 1] = -10;
    }
  }
  dustMat.opacity = speedRatio > 0.2 ? 0.2 + speedRatio * 0.15 : 0;
  dustGeo.attributes.position.needsUpdate = true;
}

/* ═══ Gauge (TFT Dashboard — BMW Style) ═══ */
function drawGauge() {
  if (!gaugeCtx) return;
  const g = gaugeCtx;
  const cw = 560,
    ch = 340;
  g.clearRect(0, 0, cw, ch);
  g.save();

  const font = "'Segoe UI', -apple-system, 'Helvetica Neue', sans-serif";
  const pad = 18;
  const accent = "#c9a84c";

  // ── Background (roundRect fallback for older Safari) ──
  function drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }
  }
  drawRoundRect(g, 0, 0, cw, ch, 16);
  g.fillStyle = "rgba(6, 6, 8, 0.88)";
  g.fill();
  g.strokeStyle = "rgba(255, 255, 255, 0.06)";
  g.lineWidth = 1;
  g.stroke();

  // ── Top status bar ──
  const topY = 24;
  // Battery icon
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 1.5;
  g.strokeRect(pad, topY - 6, 18, 10);
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(pad + 18, topY - 3, 3, 4);
  g.fillRect(pad + 2, topY - 4, 12, 6);

  // "ROAD" mode label (center top)
  g.font = `600 13px ${font}`;
  g.fillStyle = accent;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("ROAD", cw / 2, topY);

  // ── Speed display (top left) ──
  g.font = `700 52px ${font}`;
  g.fillStyle = "#ffffff";
  g.textAlign = "left";
  g.textBaseline = "alphabetic";
  g.fillText(digitalDisplay, pad, topY + 58);

  // "km/h" next to speed
  g.font = `700 52px ${font}`;
  const actualSpdW = g.measureText(digitalDisplay).width;
  g.font = `400 15px ${font}`;
  g.fillStyle = "rgba(255, 255, 255, 0.4)";
  g.fillText("km/h", pad + actualSpdW + 6, topY + 56);

  // ── Gear indicator (top right) ──
  const gearNum =
    chaosNeedle < 15
      ? "N"
      : chaosNeedle < 40
        ? "1"
        : chaosNeedle < 65
          ? "2"
          : chaosNeedle < 90
            ? "3"
            : chaosNeedle < 120
              ? "4"
              : chaosNeedle < 145
                ? "5"
                : "6";

  g.font = `700 52px ${font}`;
  g.fillStyle = gearNum === "N" ? "#22c55e" : "#ffffff";
  g.textAlign = "right";
  g.textBaseline = "alphabetic";
  g.fillText(gearNum, cw - pad, topY + 58);

  // ── Accent separator ──
  g.beginPath();
  g.moveTo(pad, topY + 70);
  g.lineTo(cw - pad, topY + 70);
  g.strokeStyle = "rgba(201, 168, 76, 0.3)";
  g.lineWidth = 1;
  g.stroke();

  // ── Semi-circular RPM arc ──
  const arcCx = cw / 2;
  const arcCy = ch - 16;
  const arcR = 110;
  const MAX_RPM = 10;
  const rpmPct = Math.min(chaosNeedle / MAX_KMH, 1);
  const rpmVal = rpmPct * MAX_RPM;

  // Angle helper: rpm 0 = left (π), rpm 10 = right (2π)
  // Arc goes clockwise from π through 3π/2 (top) to 2π
  function rpmAngle(rpm) {
    return Math.PI + (rpm / MAX_RPM) * Math.PI;
  }

  // Background track
  g.beginPath();
  g.arc(arcCx, arcCy, arcR, rpmAngle(0), rpmAngle(MAX_RPM));
  g.strokeStyle = "rgba(255, 255, 255, 0.06)";
  g.lineWidth = 18;
  g.lineCap = "butt";
  g.stroke();

  // Red zone background (9-10)
  g.beginPath();
  g.arc(arcCx, arcCy, arcR, rpmAngle(9), rpmAngle(MAX_RPM));
  g.strokeStyle = "rgba(255, 40, 40, 0.15)";
  g.lineWidth = 18;
  g.stroke();

  // Active RPM fill
  if (rpmVal > 0.2) {
    g.beginPath();
    g.arc(arcCx, arcCy, arcR, rpmAngle(0), rpmAngle(rpmVal));
    g.strokeStyle = rpmVal >= 9 ? "rgba(255, 40, 40, 0.9)" : accent;
    g.lineWidth = 18;
    g.lineCap = "butt";
    g.stroke();
  }

  // Major ticks + numbers (1-10)
  for (let k = 1; k <= MAX_RPM; k++) {
    const angle = rpmAngle(k);
    const cosA = Math.cos(angle),
      sinA = Math.sin(angle);
    const isRed = k >= 9;
    const inner = arcR + 12;
    const outer = arcR + 22;

    g.beginPath();
    g.moveTo(arcCx + inner * cosA, arcCy + inner * sinA);
    g.lineTo(arcCx + outer * cosA, arcCy + outer * sinA);
    g.strokeStyle = isRed
      ? "rgba(255, 60, 60, 0.7)"
      : "rgba(255, 255, 255, 0.25)";
    g.lineWidth = 2;
    g.lineCap = "round";
    g.stroke();

    const numR = arcR + 34;
    g.font = `${isRed ? "700" : "500"} ${isRed ? 15 : 13}px ${font}`;
    g.fillStyle = isRed
      ? "rgba(255, 60, 60, 0.9)"
      : "rgba(255, 255, 255, 0.45)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(k), arcCx + numR * cosA, arcCy + numR * sinA);
  }

  // Minor ticks
  for (let k = 0.5; k < MAX_RPM; k += 1) {
    const angle = rpmAngle(k);
    const cosA = Math.cos(angle),
      sinA = Math.sin(angle);
    g.beginPath();
    g.moveTo(arcCx + (arcR + 12) * cosA, arcCy + (arcR + 12) * sinA);
    g.lineTo(arcCx + (arcR + 17) * cosA, arcCy + (arcR + 17) * sinA);
    g.strokeStyle = "rgba(255, 255, 255, 0.1)";
    g.lineWidth = 1;
    g.stroke();
  }

  // "RPM x1000" inside arc
  g.font = `10px ${font}`;
  g.fillStyle = "rgba(255, 255, 255, 0.2)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("RPM x 1000", arcCx, arcCy - 30);

  // ── Bottom status ──
  const bottomY = ch - 6;
  g.font = `11px ${font}`;
  g.fillStyle = "rgba(255, 255, 255, 0.18)";
  g.textAlign = "left";
  g.fillText("MotoMatch", pad, bottomY);
  g.textAlign = "right";
  const now = new Date();
  g.fillText(
    String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0"),
    cw - pad,
    bottomY,
  );

  g.restore();
}

/* ═══ Exit Transition (enhanced) ═══ */
async function triggerExit() {
  if (exiting) return;
  exiting = true;
  exitPhase = 1;
  targetSpeed = 250;

  // Fade out quiz card smoothly
  const card = document.querySelector(".quiz-card");
  if (card) {
    card.style.transition = "opacity 0.5s ease, transform 0.5s ease";
    card.style.opacity = "0";
    card.style.transform = "translateY(30px)";
  }

  // Boost all streak opacity for warp effect
  for (const streak of speedStreaks) {
    streak.userData.maxAlpha = Math.min(streak.userData.maxAlpha * 3, 0.9);
  }

  // Add motion blur overlay streaks
  createExitBlurStreaks();

  await sleep(1800);
  exitPhase = 2;
}

function createExitBlurStreaks() {
  if (PREFERS_REDUCED) return;
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 12; i++) {
    const geo = new THREE.BoxGeometry(100, 0.015, 0.01);
    const streak = new THREE.Mesh(geo, mat.clone());
    streak.position.set(0, 0.2 + Math.random() * 2.5, -2 + Math.random() * 4);
    streak.material.opacity = 0.05 + Math.random() * 0.15;
    scene.add(streak);
    exitBlurStreaks.push(streak);
  }
}

let handTimeout = null;
function playHandRaise() {
  if (!handAction || !mixer) return;
  if (handTimeout) clearTimeout(handTimeout);

  handAction.reset();
  handAction.setEffectiveWeight(1);
  handAction.time = 0;
  handAction.paused = false;
  handAction.play();

  handTimeout = setTimeout(() => {
    if (!handAction || !mixer) return;
    handAction.paused = false;
    handAction.setEffectiveTimeScale(-1);
    setTimeout(() => {
      if (!handAction || !mixer) return;
      handAction.paused = true;
      handAction.time = 0;
      handAction.setEffectiveTimeScale(1);
      mixer.update(0);
      handTimeout = null;
    }, 1500);
  }, 2500);
}

function finishExit() {
  if (exitPhase !== 2) return; // prevent re-entry from animation loop
  exitPhase = 3;
  const flash = document.createElement("div");
  flash.style.cssText =
    "position:fixed;inset:0;background:#fff;opacity:0;z-index:9999;pointer-events:none;transition:opacity 0.12s ease";
  document.getElementById("quiz-screen").appendChild(flash);
  requestAnimationFrame(() => {
    flash.style.opacity = "1";
    setTimeout(() => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);

      // Cleanup pointer handlers
      if (renderer) {
        const canvas = renderer.domElement;
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointermove", onPointerMove);
      }

      // Cleanup exit blur streaks
      for (const s of exitBlurStreaks) {
        scene.remove(s);
        s.geometry.dispose();
        s.material.dispose();
      }
      exitBlurStreaks = [];

      // Cleanup Three.js
      renderer.dispose();
      scene.traverse((obj) => {
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
            m.dispose();
          });
        }
      });

      // Null out references to prevent stale access
      scene = null;
      camera = null;
      renderer = null;
      mixer = null;
      handAction = null;
      bike = null;
      clock = null;
      if (handTimeout) { clearTimeout(handTimeout); handTimeout = null; }

      document.getElementById("quiz-screen").style.display = "none";
      flash.remove();
      exiting = false;
      exitPhase = 0;
      startDropAnimation(answers);
    }, 400);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatEuro(n) {
  return Math.round(n).toLocaleString("de-DE") + " €";
}

function formatSliderValue(value, q) {
  if (q.unit === "€") return formatEuro(value) + (q.openEnded && value >= q.max ? "+" : "");
  return Math.round(value) + " " + q.unit;
}

/* ═══ Quiz UI ═══ */
function showQuestion(i) {
  idx = i;
  currentQuestionIndex = i;
  const q = questions[i];
  const container = document.getElementById("quiz-container");
  const progress = ((i + 1) / questions.length) * 100;
  const isSlider = q.type === "slider";
  const cols = !isSlider && q.options.length > 3 ? "cols-2" : "";

  const optionsHtml = isSlider
    ? `
      <div class="quiz-slider">
        <div class="quiz-slider-row">
          <input type="range" id="q-slider" class="q-slider" min="${q.min}" max="${q.max}" step="${q.step}">
          <div class="quiz-slider-input-wrap">
            <input type="number" id="q-slider-input" class="q-slider-input" min="0" step="${q.step}" inputmode="numeric" aria-label="${q.question} — Wert eintippen">
            <span class="quiz-slider-input-suffix">${q.unit}</span>
          </div>
        </div>
        <div class="quiz-slider-scale">
          <span>${formatSliderValue(q.min, q)}</span>
          <span>${formatSliderValue(q.max, q)}</span>
        </div>
      </div>
    `
    : `
      <div class="quiz-options ${cols}">
        ${q.options
          .map(
            (o) => `
          <button class="opt-btn" data-value="${o.value}">${o.label}</button>
        `,
          )
          .join("")}
      </div>
    `;

  container.innerHTML = `
    <div class="quiz-card quiz-enter">
      <div class="progress-track">
        <div class="progress-fill" style="width:${progress}%"></div>
      </div>
      <p class="quiz-step">Schritt ${i + 1} von ${questions.length}</p>
      <h2 class="quiz-question">${q.question}</h2>
      ${optionsHtml}
      <div class="quiz-nav">
        ${i > 0 ? '<button class="btn-back" id="prev-btn">Zurück</button>' : ""}
        <button class="btn-next" id="next-btn" disabled>
          ${i === questions.length - 1 ? "Match finden" : "Weiter"}
        </button>
      </div>
    </div>
  `;

  // RPM spike feedback shared by all answer inputs
  function pulseRpm() {
    idleTimer = 0;
    if (rpmSpikeTimer) clearTimeout(rpmSpikeTimer);
    const baseSpeed = 20 + (i + 1) * 18;
    targetSpeed = Math.min(160, baseSpeed + 8);
    rpmSpikeTimer = setTimeout(() => {
      if (!transitionActive) targetSpeed = baseSpeed;
      rpmSpikeTimer = null;
    }, 400);
  }

  if (isSlider) {
    const slider = document.getElementById("q-slider");
    const numberInput = document.getElementById("q-slider-input");
    const nextBtn = document.getElementById("next-btn");

    const initial = Number(answers[`q${i + 1}`]) || q.default;
    slider.value = Math.min(q.max, Math.max(q.min, initial));
    numberInput.value = initial;
    nextBtn.disabled = !answers[`q${i + 1}`];

    const commitValue = (value) => {
      answers[`q${i + 1}`] = String(value);
      saveAnswers();
      nextBtn.disabled = false;
      pulseRpm();
    };

    slider.addEventListener("input", () => {
      const value = Number(slider.value);
      numberInput.value = value;
      commitValue(value);
    });

    numberInput.addEventListener("input", () => {
      const value = Number(numberInput.value);
      if (!numberInput.value || Number.isNaN(value) || value < 0) return;
      slider.value = Math.min(q.max, Math.max(q.min, value));
      commitValue(value);
    });
  } else {
    if (answers[`q${i + 1}`]) {
      const pre = container.querySelector(
        `[data-value="${answers[`q${i + 1}`]}"]`,
      );
      if (pre) pre.classList.add("selected");
      document.getElementById("next-btn").disabled = false;
    }

    container.querySelectorAll(".opt-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container
          .querySelectorAll(".opt-btn")
          .forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        answers[`q${i + 1}`] = btn.dataset.value;
        saveAnswers();
        document.getElementById("next-btn").disabled = false;
        pulseRpm();
      });
    });
  }

  document.getElementById("next-btn").addEventListener("click", () => {
    idleTimer = 0;
    if (rpmSpikeTimer) {
      clearTimeout(rpmSpikeTimer);
      rpmSpikeTimer = null;
    }
    targetSpeed = 20 + (i + 1) * 18;

    // At question 4: cinematic transition to side view
    if (i + 1 >= 3 && !phase2Active && !transitionActive) {
      startPhaseTransition();
    }

    playHandRaise();
    if (i < questions.length - 1) showQuestion(i + 1);
    else triggerExit();
  });

  const prev = document.getElementById("prev-btn");
  if (prev)
    prev.addEventListener("click", () => {
      idleTimer = 0;
      targetSpeed = Math.max(20, 20 + (i - 1) * 18);
      if (i - 1 < 3) {
        phase2Active = false;
        sideView = false;
        transitionActive = false;
        worldTargetRotY = 0;
        roadScrollDir = 1;
        wheelieTarget = 0;
      }
      showQuestion(i - 1);
    });
}
