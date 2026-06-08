/* ============================================================================
   PAGE 22 — Stack Builder  (vanilla HTML5 Canvas, no libraries)

   A promo stack-builder for Reneev's 22-storey "PAGE 22" tower.
   Reference: CBC Kids "Stack Builder" + classic trim-and-shrink stackers.

   SECTION MAP
     1.  Config & constants
     2.  Asset loader (manifest + graceful image fallbacks)
     3.  World / camera model
     4.  Game state + block model
     5.  Crane pendulum physics (fixed timestep)
     6.  Drop / trim / shrink / sudden-death
     7.  Win sequence (crane away -> crown -> pull back -> overlay)
     8.  Rendering (sky, base, tower, crane, offcuts, HUD, overlays)
     9.  Input (unified tap/click/space)
     10. Main loop (rAF + accumulator, pause on hidden)
   ========================================================================== */

'use strict';

/* ============================================================================
   1. CONFIG & CONSTANTS
   ========================================================================== */

const CFG = {
  TOTAL_FLOORS: 22,

  // Canonical art dimensions (from manifest; verified at load).
  FLOOR_W: 602,
  FLOOR_H: 93,

  // World design width. We render the play column at this CSS-px width and
  // letterbox/scale to fit the viewport. Everything below is in WORLD px.
  WORLD_W: 620,

  // Vertical world layout (y grows DOWN). Base bottom sits at GROUND_Y.
  GROUND_Y: 0,            // base bottom anchored here; tower grows to -y.

  // Drawn floor height in world units (keep PNG aspect: 602x93).
  FLOOR_DRAW_W: 560,      // starting tower-top width (floor 1 footprint width).
  get FLOOR_DRAW_H() { return this.FLOOR_DRAW_W * (this.FLOOR_H / this.FLOOR_W); },

  // Base draw width (podium is wider than the floors).
  BASE_DRAW_W: 1010,      // 1085x166 -> scale to this width
  get BASE_DRAW_H() { return this.BASE_DRAW_W * (166 / 1085); },

  // Crane geometry (world units, relative to current build height).
  CRANE_CLEARANCE: 230,   // how far the jib sits above the current tower top
  CABLE_LEN: 120,         // pendulum cable length L
  JIB_LEN: 360,           // length of working jib (to the right of mast)
  COUNTERJIB_LEN: 150,

  // Pendulum tuning (difficulty ramps with floor number).
  SWING_AMP_MIN: 0.30,    // radians at floor 1 (wider, harder)
  SWING_AMP_MAX: 0.92,    // radians near floor 22 (~53 deg)
  SWING_OMEGA_MIN: 2.05,  // rad/s  (fast left-right)
  SWING_OMEGA_MAX: 4.30,
  TROLLEY_DRIFT: 42,      // px of trolley traverse (more lateral coverage)
  TROLLEY_OMEGA: 0.8,

  // Drop physics.
  GRAVITY: 2600,          // world px / s^2
  SWAY_DAMP: 0.86,        // residual sway damping per second factor
  MAX_FALL_VX: 900,

  // Placement rules.
  PERFECT_TOL: 9,         // |offset| within this = a "perfect" (combo + recovery)
  // --- Stability model (floors are NEVER trimmed/shrunk; off-centre hurts stability) ---
  STAB_MAX: 100,          // full, brand-new building
  LOSE_THRESHOLD: 60,     // at or below 60% stability the run ends (retry)
  STAB_SAFE: 14,          // |offset| under this does no damage
  STAB_DMG_SCALE: 62,     // damage for an offset of one full floor width
  STAB_RECOVER: 5,        // stability regained on a perfect placement

  // Camera.
  CAM_LERP: 4.2,          // higher = snappier follow

  // Fixed timestep.
  DT: 1 / 120,
};

// Palette (mirror of CSS; used for canvas fallbacks + chrome).
const COL = {
  ink:        '#1f2a2e',
  inkSoft:    '#34474d',
  paper:      '#f3ead9',
  beige:      '#e7d9bf',
  taupe:      '#b9a888',
  taupeDeep:  '#9a8a6c',
  terracotta: '#c0714e',
  terracottaDeep: '#9c5536',
  glass:      '#9fb8c4',
  steel:      '#cfd6d8',
  craneInk:   '#243035',
};

/* ============================================================================
   2. ASSET LOADER  (manifest + graceful fallbacks)
   Every image carries a .loaded flag; drawImageOrRect falls back to a tinted
   rectangle so the game ALWAYS runs even if art is missing.
   ========================================================================== */

const Assets = {
  manifest: null,
  floors: [],     // index 0 == floor 1
  crown: null,
  base: null,
  skyline: null,
  skyHero: null,
  wordmark: null,
  confetti: null,
  ready: false,
};

function loadImage(src) {
  const img = new Image();
  img.loaded = false;
  img.failed = false;
  img.onload = () => { img.loaded = true; };
  img.onerror = () => { img.failed = true; };
  img.src = src;
  return img;
}

async function loadAssets() {
  // Manifest is authoritative; fall back to defaults if it can't be read.
  try {
    const res = await fetch('assets/floors/manifest.json', { cache: 'no-cache' });
    Assets.manifest = await res.json();
    if (Assets.manifest?.canonical_floor?.w) CFG.FLOOR_W = Assets.manifest.canonical_floor.w;
    if (Assets.manifest?.floors?.[0]?.h) CFG.FLOOR_H = Assets.manifest.floors[0].h;
  } catch (e) {
    console.warn('[PAGE22] manifest load failed, using defaults', e);
  }

  const floorList = Assets.manifest?.floors ||
    Array.from({ length: CFG.TOTAL_FLOORS }, (_, i) => ({
      n: i + 1, file: `floor_${String(i + 1).padStart(2, '0')}.png`,
    }));

  Assets.floors = floorList.map(f => loadImage(`assets/floors/${f.file}`));
  Assets.crown = loadImage('assets/floors/crown.png');
  Assets.base = loadImage('assets/floors/base.png');

  // Branding agent assets — may not exist yet. Load with graceful fallback.
  Assets.skyline = loadImage('assets/bg/skyline.png');
  // Hero sky is produced concurrently and MAY be absent — code-gradient covers it.
  Assets.skyHero = loadImage('assets/bg/sky_hero.png');
  Assets.wordmark = loadImage('assets/logo/page22_wordmark.png');
  Assets.confetti = loadImage('assets/fx/confetti.png');

  Assets.ready = true; // we don't block on loads; fallbacks cover gaps.
}

// Draw an image, or a tinted rect fallback if it hasn't loaded.
function drawImageOrRect(ctx, img, dx, dy, dw, dh, fallbackColor) {
  if (img && img.loaded) {
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = fallbackColor || COL.taupe;
    ctx.fillRect(dx, dy, dw, dh);
  }
}

// Draw a SUB-RECTANGLE of an image (source crop) into a destination rect.
function drawImageCropOrRect(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh, fallbackColor) {
  if (img && img.loaded) {
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = fallbackColor || COL.taupe;
    ctx.fillRect(dx, dy, dw, dh);
  }
}

/* ============================================================================
   3. WORLD / CAMERA MODEL
   World y grows DOWNWARD. Base bottom = GROUND_Y (0). Tower grows to -y.
   Camera is a single vertical offset (cameraY) lerped toward the tower top.
   Rendering: x is centered on the canvas; worldToScreenY applies camera + scale.
   ========================================================================== */

const View = {
  canvas: null,
  ctx: null,
  dpr: 1,
  cssW: 0,
  cssH: 0,
  scale: 1,        // base gameplay world px -> screen px (set on resize)
  renderScale: 1,  // active scale used by transforms (lerps out for the win reveal)
  originX: 0,      // screen x of world x=0 (column center)
  cameraY: 0,      // world y currently centered-ish in frame
  anchorY: 0,      // screen y that cameraY maps to (lerps up for the win reveal)
};

function resizeCanvas() {
  const stage = document.getElementById('stage');
  const rect = stage.getBoundingClientRect();
  View.cssW = rect.width;
  View.cssH = rect.height;
  View.dpr = Math.min(window.devicePixelRatio || 1, 3);

  View.canvas.width = Math.round(View.cssW * View.dpr);
  View.canvas.height = Math.round(View.cssH * View.dpr);
  View.canvas.style.width = View.cssW + 'px';
  View.canvas.style.height = View.cssH + 'px';

  // All drawing happens in CSS px; dpr handled by the base transform.
  View.ctx.setTransform(View.dpr, 0, 0, View.dpr, 0, 0);

  // Fit world column width into the viewport width (with side margins),
  // but never scale so tall that vertical play feels cramped.
  const targetW = Math.min(View.cssW, View.cssH * 0.62); // keep portrait-ish
  View.scale = targetW / CFG.WORLD_W;
  if (Game.state === STATE.START || Game.state === STATE.PLAYING ||
      Game.state === STATE.DROPPING || Game.state === STATE.SETTLE) {
    View.renderScale = View.scale;       // snap during normal play
    View.anchorY = View.cssH * 0.62;
  }
  View.originX = View.cssW / 2; // world x=0 is the column center
}

// World coords -> screen CSS px. renderScale/anchorY lerp during the win reveal.
function wx(worldX) { return View.originX + worldX * View.renderScale; }
function wy(worldY) {
  return View.anchorY + (worldY - View.cameraY) * View.renderScale;
}
function wlen(v) { return v * View.renderScale; }

/* ============================================================================
   4. GAME STATE + BLOCK MODEL
   Each placed block tracks: floor index, world x-center, width, and the
   normalized source u-range [u0,u1] of ITS OWN floor PNG that remains visible.
   ========================================================================== */

const STATE = {
  START: 'start',
  PLAYING: 'playing',   // crane swinging, awaiting drop
  DROPPING: 'dropping', // current floor in projectile fall
  SETTLE: 'settle',     // brief pause after a placement (combo flash)
  WIN_SEQ: 'win_seq',   // animated win choreography
  WIN_OVERLAY: 'win_overlay',
  LOSE: 'lose',
};

const Game = {
  state: STATE.START,
  blocks: [],          // placed slabs, [0] = floor 1
  topWidth: 0,         // current tower-top width (= last placed width)
  nextFloor: 1,        // floor number about to be dropped (1..22)
  combo: 0,            // perfect streak
  bestCombo: 0,
  score: 0,            // floors completed
  stability: 100,      // building stability (0 = collapse). Shown top-right.
  stabShown: 100,      // smoothed value for the bar animation
  time: 0,             // accumulated game time (s) for pendulum phase
  fxTime: 0,           // always-advancing clock for wobble / fx

  // The currently hooked / falling floor.
  moving: null,        // {floor, x, y, w, vx, vy, swayPhase, swayAmp}

  // Visual fx.
  offcuts: [],         // tumbling slices {img,sx,sw, x,y,w,h, vx,vy,rot,vr,alpha}
  flashes: [],         // perfect-drop pulses {x,y,t}
  confetti: [],        // win burst particles
  pulse: 0,            // global scale-pulse for perfect feedback

  // Sequence timers.
  seqT: 0,
  seqStage: 0,

  // Crown animation (win).
  crownY: 0,
  crownTargetY: 0,
};

// Top surface world-y of the highest placed block (where the next slab lands).
function towerTopY() {
  if (Game.blocks.length === 0) return CFG.GROUND_Y - CFG.BASE_DRAW_H;
  const top = Game.blocks[Game.blocks.length - 1];
  return top.topY;
}

// Reset to a fresh game (floor 1 ready on the crane).
function startGame() {
  Game.blocks = [];
  Game.offcuts = [];
  Game.flashes = [];
  Game.confetti = [];
  AudioFX.stopParty();
  Game.combo = 0;
  Game.bestCombo = 0;
  Game.score = 0;
  Game.stability = CFG.STAB_MAX;
  Game.stabShown = CFG.STAB_MAX;
  Game.time = 0;
  Game.pulse = 0;
  Game.nextFloor = 1;
  Game.topWidth = CFG.FLOOR_DRAW_W;
  Game.crownY = 0;
  Game.seqStage = 0;
  Game.seqT = 0;

  spawnMovingFloor();
  // Snap camera to base initially.
  View.cameraY = (CFG.GROUND_Y - CFG.BASE_DRAW_H) + 60;
  Game.state = STATE.PLAYING;
}

// Build the hooked moving floor (full-width PNG, displayed at topWidth).
function spawnMovingFloor() {
  const w = Game.topWidth;
  const h = w * (CFG.FLOOR_H / CFG.FLOOR_W);
  Game.moving = {
    floor: Game.nextFloor,
    w: w,
    h: h,
    // x/y filled by physics each frame (hangs from hook). Start at jib.
    x: 0,
    y: towerTopY() - CFG.CRANE_CLEARANCE,
    vx: 0,
    vy: 0,
    swayAmp: 0,       // residual sway after drop
    swayPhase: 0,
    falling: false,
  };
}

/* ============================================================================
   5. CRANE PENDULUM PHYSICS  (fixed timestep)
   Pivot = trolley on the jib. Slab hangs at angle theta from vertical.
   theta(t) = A * sin(omega*t); slabX = trolleyX + L*sin(theta).
   Release velocity is computed NUMERICALLY (prevX -> x over dt).
   ========================================================================== */

// Difficulty-scaled amplitude / speed for the current floor.
function swingParams(floor) {
  const t = (floor - 1) / (CFG.TOTAL_FLOORS - 1); // 0..1
  const ease = t * t * (3 - 2 * t); // smoothstep ramp
  return {
    amp: CFG.SWING_AMP_MIN + (CFG.SWING_AMP_MAX - CFG.SWING_AMP_MIN) * ease,
    omega: CFG.SWING_OMEGA_MIN + (CFG.SWING_OMEGA_MAX - CFG.SWING_OMEGA_MIN) * ease,
  };
}

// Trolley world-x (slow drift adds life; pivot of the pendulum).
function trolleyX() {
  return Math.sin(Game.time * CFG.TROLLEY_OMEGA) * CFG.TROLLEY_DRIFT;
}

// Jib/hook world-y above the tower top.
function craneJibY() {
  return towerTopY() - CFG.CRANE_CLEARANCE;
}

let _prevSlabX = 0;

function stepPhysics(dt) {
  const m = Game.moving;
  if (!m) return;

  if (Game.state === STATE.PLAYING) {
    // Pendulum swing.
    Game.time += dt;
    const sp = swingParams(m.floor);
    const theta = sp.amp * Math.sin(sp.omega * Game.time);
    const pivotX = trolleyX();
    const jibY = craneJibY();
    const newX = pivotX + CFG.CABLE_LEN * Math.sin(theta);

    _prevSlabX = m.x;
    m.x = newX;
    m.y = jibY + CFG.CABLE_LEN * Math.cos(theta) - CFG.CABLE_LEN + 40; // hang point
    // store velocity continuously for release snapshot
    m.vx = (m.x - _prevSlabX) / dt;
  } else if (Game.state === STATE.DROPPING) {
    // Projectile fall with gravity + small damped residual sway.
    m.vy += CFG.GRAVITY * dt;
    m.x += m.vx * dt;
    m.y += m.vy * dt;

    // Residual sway (decays) — purely cosmetic horizontal jitter.
    m.swayPhase += dt * 8;
    m.swayAmp *= Math.pow(CFG.SWAY_DAMP, dt * 60 / 60);

    // Has it reached the landing surface? (Skip for a missed slab so it
    // plummets past the tower instead of re-resolving.)
    if (!m.missed) {
      const landY = towerTopY() - m.h; // top of slab rests on tower top
      if (m.y >= landY) {
        m.y = landY;
        resolvePlacement();
      }
    }
    // Sudden death: fell well past the tower with no landing (handled in resolve
    // when overlap is zero; but also guard if it plummets far below).
    if (m.y > CFG.GROUND_Y + 400) {
      triggerLose();
    }
  }
}

/* ============================================================================
   6. DROP / TRIM / SHRINK / SUDDEN-DEATH
   ========================================================================== */

// Trigger the drop: snapshot momentum, switch to projectile state.
function dropFloor() {
  if (Game.state !== STATE.PLAYING || !Game.moving) return;
  const m = Game.moving;
  m.vx = Math.max(-CFG.MAX_FALL_VX, Math.min(CFG.MAX_FALL_VX, m.vx));
  m.vy = 0;
  m.swayAmp = Math.abs(m.vx) * 0.02;
  m.swayPhase = 0;
  Game.state = STATE.DROPPING;
}

// Reference surface (x-center, width) that the falling floor must overlap.
function landingReference() {
  if (Game.blocks.length === 0) {
    // Floor 1 lands on the base. Use the central footprint of the podium,
    // NOT the full 1085 skirt, so floor 1 is gentle but a real miss is possible.
    return { cx: 0, w: CFG.FLOOR_DRAW_W * 1.05 };
  }
  const top = Game.blocks[Game.blocks.length - 1];
  return { cx: top.cx, w: top.w };
}

// Place the slab at FULL width (never trimmed); off-centre drains stability.
function resolvePlacement() {
  const m = Game.moving;
  const ref = landingReference();             // centre of the floor/base below
  const absOff = Math.abs(m.x - ref.cx);

  // Place the full-width floor exactly where it landed — NEVER cut, NEVER shrunk.
  const placedTopY = towerTopY() - m.h;
  Game.blocks.push({
    floor: m.floor,
    cx: m.x,
    w: m.w,
    h: m.h,
    topY: placedTopY,
    botY: placedTopY + m.h,
    u0: 0, u1: 1,                             // always the whole floor PNG
    imgIndex: m.floor - 1,
  });
  Game.score = m.floor;

  // Stability: a centred drop is safe (and recovers a little); the further
  // off-centre, the more the building's stability drains.
  if (absOff <= CFG.PERFECT_TOL) {
    Game.combo += 1;
    Game.bestCombo = Math.max(Game.bestCombo, Game.combo);
    Game.stability = Math.min(CFG.STAB_MAX, Game.stability + CFG.STAB_RECOVER);
    Game.pulse = 1;
    Game.flashes.push({ x: m.x, y: placedTopY + m.h / 2, t: 0 });
    AudioFX.perfect();
  } else {
    Game.combo = 0;
    const dmg = Math.max(0, absOff - CFG.STAB_SAFE) / m.w * CFG.STAB_DMG_SCALE;
    Game.stability = Math.max(0, Game.stability - dmg);
    AudioFX.place();
  }

  // Stability too low -> end the run (we never show the building fall).
  if (Game.stability <= CFG.LOSE_THRESHOLD) { triggerLose(); return; }

  // WIN at the top, else queue the next floor.
  if (m.floor >= CFG.TOTAL_FLOORS) {
    beginWinSequence();
  } else {
    Game.nextFloor = m.floor + 1;
    Game.moving = null;
    Game.state = STATE.SETTLE;
    Game.seqT = 0;
  }
}

// Create the falling, rotating, fading offcut slice(s).
function spawnOffcuts(m, ref, overlapLeft, overlapRight, placedTopY) {
  const movLeft = m.x - m.w / 2;
  const img = Assets.floors[m.floor - 1];
  const imgW = CFG.FLOOR_W;
  const imgH = CFG.FLOOR_H;

  // Left overhang (slab extends left of reference).
  if (overlapLeft - movLeft > 1) {
    const w = overlapLeft - movLeft;
    const u0 = 0;
    const u1 = w / m.w;
    Game.offcuts.push({
      img, sx: u0 * imgW, sw: (u1 - u0) * imgW, sy: 0, sh: imgH,
      x: movLeft + w / 2, y: placedTopY + m.h / 2, w, h: m.h,
      vx: -120 - Math.random() * 80, vy: -80, rot: 0,
      vr: -2 - Math.random() * 2, alpha: 1,
    });
  }
  // Right overhang.
  const movRight = m.x + m.w / 2;
  if (movRight - overlapRight > 1) {
    const w = movRight - overlapRight;
    const u0 = (overlapRight - movLeft) / m.w;
    const u1 = 1;
    Game.offcuts.push({
      img, sx: u0 * imgW, sw: (u1 - u0) * imgW, sy: 0, sh: imgH,
      x: overlapRight + w / 2, y: placedTopY + m.h / 2, w, h: m.h,
      vx: 120 + Math.random() * 80, vy: -80, rot: 0,
      vr: 2 + Math.random() * 2, alpha: 1,
    });
  }
}

function triggerLose() {
  if (Game.state === STATE.LOSE) return;
  Game.state = STATE.LOSE;
  Game.moving = null;
  AudioFX.lose();
}

/* ============================================================================
   7. WIN SEQUENCE
   Stages: 0 crane swings away -> 1 crown descends -> 2 camera pulls back
           -> 3 overlay reveal + confetti.
   ========================================================================== */

function beginWinSequence() {
  Game.state = STATE.WIN_SEQ;
  Game.seqStage = 0;
  Game.seqT = 0;
  Game.moving = null;
  // Crown starts high above the tower, descends to cap it.
  const topY = towerTopY();
  Game.crownStartY = topY - 520;
  Game.crownTargetY = topY; // crown bottom rests on tower top
  Game.crownY = Game.crownStartY;
  Game._craneAway = 0;
}

function stepWinSequence(dt) {
  Game.seqT += dt;
  if (Game.seqStage === 0) {
    // Crane swings/lifts away.
    Game._craneAway = Math.min(1, Game.seqT / 1.1);
    if (Game.seqT >= 1.1) { Game.seqStage = 1; Game.seqT = 0; }
  } else if (Game.seqStage === 1) {
    // Crown descends with ease-out.
    const p = Math.min(1, Game.seqT / 1.3);
    const e = 1 - Math.pow(1 - p, 3);
    Game.crownY = Game.crownStartY + (Game.crownTargetY - Game.crownStartY) * e;
    if (p >= 1) { Game.seqStage = 2; Game.seqT = 0; spawnConfetti(); AudioFX.startParty(); }
  } else if (Game.seqStage === 2) {
    // Camera pulls back to reveal full tower (handled in updateCamera).
    if (Game.seqT >= 1.2) { Game.seqStage = 3; Game.seqT = 0; Game.state = STATE.WIN_OVERLAY; }
  }
}

function spawnConfetti() {
  const colors = [COL.terracotta, COL.beige, COL.taupe, COL.paper, COL.terracottaDeep, COL.glass];
  for (let i = 0; i < 140; i++) {
    Game.confetti.push({
      x: (Math.random() - 0.5) * CFG.WORLD_W,
      y: towerTopY() - 120 - Math.random() * 200,
      vx: (Math.random() - 0.5) * 260,
      vy: -120 - Math.random() * 220,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 8,
      w: 7 + Math.random() * 8,
      h: 10 + Math.random() * 10,
      color: colors[(Math.random() * colors.length) | 0],
      alpha: 1,
    });
  }
}

/* ============================================================================
   8. CAMERA UPDATE + FX UPDATE
   ========================================================================== */

function updateCamera(dt) {
  let targetCam, targetScale, targetAnchor;
  const revealFull = (Game.state === STATE.WIN_SEQ && Game.seqStage >= 2) ||
                     Game.state === STATE.WIN_OVERLAY || Game.state === STATE.LOSE;

  if (revealFull) {
    // Pull back so the ENTIRE tower is on screen (base -> all floors -> crown),
    // framed in the upper area with room for the end-screen card below.
    const isWin = Game.state !== STATE.LOSE;
    const crownH = isWin ? CFG.FLOOR_DRAW_W * 1.18 * (368 / 700) : 0;
    const towerTop = towerTopY() - crownH;          // top of structure (world y, negative)
    const towerBot = CFG.GROUND_Y;                  // base bottom
    const towerH = Math.max(1, towerBot - towerTop);
    const avail = View.cssH * 0.52;                 // vertical room for the tower
    targetScale = Math.min(View.scale, avail / towerH);
    targetCam = (towerTop + towerBot) / 2;          // tower mid-point
    targetAnchor = View.cssH * 0.36;                // centre tower in the upper area
  } else {
    // Follow the active build region: keep crane + tower top in frame.
    targetCam = towerTopY() - CFG.CRANE_CLEARANCE * 0.55;
    targetScale = View.scale;
    targetAnchor = View.cssH * 0.62;
  }

  const k = 1 - Math.exp(-CFG.CAM_LERP * dt);
  View.cameraY += (targetCam - View.cameraY) * k;
  View.renderScale += (targetScale - View.renderScale) * k;
  View.anchorY += (targetAnchor - View.anchorY) * k;

  // Smooth the stability bar toward its true value.
  Game.stabShown += (Game.stability - Game.stabShown) * (1 - Math.exp(-8 * dt));
}

// Building lean/wobble that grows as stability falls toward the 60% line.
function wobbleAngle() {
  if (Game.state !== STATE.PLAYING && Game.state !== STATE.DROPPING &&
      Game.state !== STATE.SETTLE) return 0;
  const span = CFG.STAB_MAX - CFG.LOSE_THRESHOLD;     // 40 pts of headroom
  const instab = Math.max(0, Math.min(1, (CFG.STAB_MAX - Game.stabShown) / span));
  if (instab <= 0.02) return 0;
  const amp = instab * instab * 0.06;                  // up to ~3.4 deg, eases in
  return amp * Math.sin(Game.fxTime * 5.0);
}

function updateFx(dt) {
  Game.fxTime += dt;
  // Offcuts.
  for (const o of Game.offcuts) {
    o.vy += CFG.GRAVITY * 0.6 * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    o.rot += o.vr * dt;
    o.alpha -= dt * 0.55;
  }
  Game.offcuts = Game.offcuts.filter(o => o.alpha > 0 && o.y < CFG.GROUND_Y + 600);

  // Perfect flashes.
  for (const f of Game.flashes) f.t += dt;
  Game.flashes = Game.flashes.filter(f => f.t < 0.5);

  // Global pulse decay.
  Game.pulse = Math.max(0, Game.pulse - dt * 3.2);

  // Confetti.
  for (const c of Game.confetti) {
    c.vy += CFG.GRAVITY * 0.18 * dt;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.rot += c.vr * dt;
    if (c.y > towerTopY() + 200) c.alpha -= dt * 0.4;
  }
  Game.confetti = Game.confetti.filter(c => c.alpha > 0);
}

/* ============================================================================
   9. RENDERING
   ========================================================================== */

/* ----------------------------------------------------------------------------
   8a. ANIMATED, ALTITUDE-DRIVEN PARALLAX BACKGROUND
   Layer order (all behind the world scene, drawn inside clearAndSky):
     1. Hero sky image (panned with altitude) OR code dusk->high-sky gradient.
     2. Far skyline silhouette band (optional, low on the horizon).
     3. Ground scene: footpath + greenery + road + moving cars, anchored at
        GROUND_Y so it scrolls DOWN out of view as the tower rises.
     4. Drifting parallax clouds (3 layers), gated/strengthened by altitude.
     5. Bird flocks crossing the upper sky, gated to high altitude.
   Positions derive from Game.fxTime + pre-allocated property arrays => no
   per-frame allocation, no extra update step needed.
   ---------------------------------------------------------------------------- */

// 0..1 climb progress (floor 1 -> 22). Drives sky colour, clouds, birds, fades.
function altitudeProgress() {
  const floor = Game.moving ? Game.moving.floor :
    (Game.score > 0 ? Game.score : Game.nextFloor);
  return Math.min(1, Math.max(0, floor / CFG.TOTAL_FLOORS));
}

// Lerp two #rrggbb hex colours -> rgb() string. (Small, called a handful of
// times per frame for gradient stops only.)
function lerpHex(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = (ar + (br - ar) * t) | 0, g = (ag + (bg - ag) * t) | 0, bl = (ab + (bb - ab) * t) | 0;
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}

// Pre-allocated background actor tables (built once). Positions computed live.
const BG = {
  cars: null,    // {lane, dir, speed, phase, color, len, h}
  clouds: null,  // {layer, y, speed, scale, alpha, phase}
  flocks: null,  // {y, speed, phase, n, size}
  carColors: ['#3e5b6e', '#7a4a3a', '#5a6b4a', '#8a6a3a', '#4a4a5e', '#9c5536'],
};

function initBackground() {
  // Cars: a few per direction, spread across phase so they don't clump.
  const cars = [];
  const carN = 6;
  for (let i = 0; i < carN; i++) {
    cars.push({
      lane: i % 2,                              // 0 = near lane, 1 = far lane
      dir: i % 2 === 0 ? 1 : -1,                // near lane -> right, far -> left
      speed: 70 + (i * 37 % 60),               // world px/s, varied
      phase: (i / carN) + (i * 0.13 % 0.5),    // 0..1 start offset along road
      color: BG.carColors[i % BG.carColors.length],
      len: 46 + (i * 7 % 18),
    });
  }
  BG.cars = cars;

  // Clouds: 3 depth layers, slow -> fast, far/faint -> near/brighter.
  const clouds = [];
  const layerCfg = [
    { speed: 7,  scale: 0.85, alpha: 0.30, n: 3 },   // far, faint, high
    { speed: 13, scale: 1.15, alpha: 0.42, n: 3 },   // mid
    { speed: 22, scale: 1.55, alpha: 0.52, n: 2 },   // near, bigger
  ];
  for (let L = 0; L < layerCfg.length; L++) {
    const c = layerCfg[L];
    for (let i = 0; i < c.n; i++) {
      clouds.push({
        layer: L,
        yFrac: 0.14 + L * 0.10 + (i * 0.17 % 0.18), // vertical band (frac of cssH)
        speed: c.speed,
        scale: c.scale,
        alpha: c.alpha,
        phase: (i / c.n) + L * 0.27,                  // 0..1 start offset
      });
    }
  }
  BG.clouds = clouds;

  // Bird flocks crossing high up.
  const flocks = [];
  for (let i = 0; i < 3; i++) {
    flocks.push({
      yFrac: 0.10 + i * 0.07,
      speed: 34 + i * 12,
      phase: i / 3 + 0.1,
      n: 3 + (i % 3),       // birds in the V
      dir: i % 2 === 0 ? 1 : -1,
    });
  }
  BG.flocks = flocks;
}

// ---- Layer 1: hero sky image (parallax pan) or code gradient fallback -------
function drawSkyBackdrop(ctx, prog) {
  const W = View.cssW, H = View.cssH;
  if (Assets.skyHero && Assets.skyHero.loaded) {
    // Cover-fit, then pan vertically with altitude (slow parallax). Showing the
    // bottom of the image (horizon) low down, the top (high sky) when high up.
    const img = Assets.skyHero;
    const ir = img.width / img.height;
    const cr = W / H;
    let dw, dh;
    if (cr > ir) { dw = W; dh = dw / ir; }
    else { dh = H; dw = dh * ir; }
    // Add extra vertical slack so there is room to pan.
    const slackBoost = H * 0.5;
    dh += slackBoost; dw = dh * ir;
    const slackY = dh - H;
    const dx = (W - dw) / 2;
    // prog 0 -> show bottom (horizon); prog 1 -> show top (open sky).
    const dy = -slackY * (1 - prog);
    ctx.drawImage(img, dx, dy, dw, dh);
    return;
  }
  // Code-drawn gradient fallback (THIS is the live path until sky_hero exists).
  // Petrol night up top -> peach horizon at the base; brightens with altitude.
  const top    = lerpHex('#14202e', '#2a4763', prog);   // dark petrol -> lit petrol
  const mid    = lerpHex('#3a5c76', '#5e87a6', prog);   // petrol-blue -> brighter blue
  const horizon= lerpHex('#b56a4a', '#f2d1b2', prog);   // terracotta dusk -> soft peach
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(0.5, mid);
  g.addColorStop(0.84, lerpHex('#e7b894', '#f2d1b2', prog));
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Warm low sun glow near the horizon; fades as we climb into clear sky.
  const sunY = H * (0.78 - prog * 0.06);
  const glow = (0.42 * (1 - prog * 0.7));
  const sun = ctx.createRadialGradient(W * 0.5, sunY, 8, W * 0.5, sunY, W * 0.8);
  sun.addColorStop(0, 'rgba(247,222,190,' + glow.toFixed(3) + ')');
  sun.addColorStop(1, 'rgba(247,222,190,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);
}

// ---- Layer 2: far skyline silhouette band -----------------------------------
function drawFarSkyline(ctx, prog) {
  if (!(Assets.skyline && Assets.skyline.loaded)) return;
  // Place the silhouette as a low horizon band that scrolls slightly with the
  // camera (gentle parallax). Sits behind the ground scene.
  const img = Assets.skyline;
  const ir = img.width / img.height;
  const bandH = Math.min(View.cssH * 0.32, View.cssW / ir);
  const dw = View.cssW;
  const dh = dw / ir;
  // Horizon screen-y: where GROUND_Y maps, raised a touch. Parallax 0.18.
  const horizonY = wy(CFG.GROUND_Y) - View.cssH * 0.06;
  const dy = horizonY - dh + bandH * 0.0;
  ctx.save();
  ctx.globalAlpha = 0.55 * (1 - prog * 0.5);   // recedes as we climb past it
  ctx.drawImage(img, (View.cssW - dw) / 2, dy, dw, dh);
  ctx.restore();
}

// ---- Layer 3: ground scene (footpath, greenery, road, cars) -----------------
// Anchored at GROUND_Y so it scrolls DOWN out of view as the tower rises.
function drawGroundScene(ctx) {
  const groundScreenY = wy(CFG.GROUND_Y);
  // Cull if the ground has scrolled fully off the bottom.
  if (groundScreenY - 40 > View.cssH) return;

  const W = View.cssW;
  const s = View.renderScale;
  // Heights in world units -> screen via wlen for camera-correct scaling.
  const roadH = wlen(120);
  const pathH = wlen(34);
  const roadTop = groundScreenY;            // road starts at ground line
  const roadBot = groundScreenY + roadH;
  const pathTop = roadBot;

  ctx.save();

  // Greenery strip + footpath just above the road (sits on the ground line).
  // Trees/hedge silhouettes along the kerb.
  drawGreenery(ctx, groundScreenY, s);

  // Road surface (dark asphalt with petrol tint).
  const rg = ctx.createLinearGradient(0, roadTop, 0, roadBot);
  rg.addColorStop(0, '#2b3a44');
  rg.addColorStop(1, '#1c272f');
  ctx.fillStyle = rg;
  ctx.fillRect(0, roadTop, W, roadH);

  // Kerb highlight.
  ctx.fillStyle = '#3d525e';
  ctx.fillRect(0, roadTop, W, Math.max(1, wlen(3)));

  // Lane dashes (centre line), scrolling subtly for life.
  ctx.fillStyle = 'rgba(231,184,148,0.55)';
  const dashW = wlen(34), gap = wlen(28), midY = roadTop + roadH * 0.5;
  const off = (Game.fxTime * 40 * s) % (dashW + gap);
  for (let x = -off; x < W; x += dashW + gap) {
    ctx.fillRect(x, midY - wlen(2), dashW, wlen(4));
  }

  // Cars travelling horizontally across the road.
  drawCars(ctx, roadTop, roadH, s);

  // Footpath below the road (beige paving).
  ctx.fillStyle = '#cdbb9a';
  ctx.fillRect(0, pathTop, W, pathH);
  ctx.fillStyle = 'rgba(31,42,46,0.18)';
  ctx.fillRect(0, pathTop, W, Math.max(1, wlen(2)));
  // paving joints
  ctx.strokeStyle = 'rgba(31,42,46,0.15)';
  ctx.lineWidth = 1;
  const jw = wlen(40);
  for (let x = (Game.fxTime * 0) % jw; x < W; x += jw) {
    ctx.beginPath(); ctx.moveTo(x, pathTop); ctx.lineTo(x, pathTop + pathH); ctx.stroke();
  }

  ctx.restore();
}

// Tree / hedge silhouettes along the kerb above the road.
function drawGreenery(ctx, groundScreenY, s) {
  const W = View.cssW;
  const baseY = groundScreenY + wlen(2);
  ctx.save();
  // dark silhouette tone matching palette
  const hedgeH = wlen(26);
  ctx.fillStyle = '#1c2e22';
  ctx.fillRect(0, baseY - hedgeH, W, hedgeH);
  // bumpy hedge top
  ctx.fillStyle = '#243d2c';
  const bump = wlen(22);
  for (let x = 0; x < W + bump; x += bump) {
    ctx.beginPath();
    ctx.arc(x, baseY - hedgeH, bump * 0.6, Math.PI, 0);
    ctx.fill();
  }
  // a few taller trees, evenly spaced, deterministic positions
  const treeXs = [0.12, 0.34, 0.58, 0.8];
  for (let i = 0; i < treeXs.length; i++) {
    const tx = treeXs[i] * W;
    const trunkH = wlen(30 + (i % 2) * 8);
    const crownR = wlen(20 + (i % 3) * 5);
    // trunk
    ctx.fillStyle = '#2a1d14';
    ctx.fillRect(tx - wlen(3), baseY - hedgeH - trunkH, wlen(6), trunkH);
    // foliage (two-tone for a touch of depth)
    ctx.fillStyle = '#1f3526';
    ctx.beginPath();
    ctx.arc(tx, baseY - hedgeH - trunkH, crownR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c4a34';
    ctx.beginPath();
    ctx.arc(tx - crownR * 0.3, baseY - hedgeH - trunkH - crownR * 0.2, crownR * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Cars moving horizontally across the road (positions from fxTime, no alloc).
function drawCars(ctx, roadTop, roadH, s) {
  if (!BG.cars) return;
  const W = View.cssW;
  const span = W + wlen(160);             // travel distance incl. off-screen margin
  for (let i = 0; i < BG.cars.length; i++) {
    const car = BG.cars[i];
    const len = wlen(car.len);
    const h = wlen(car.lane === 0 ? 26 : 21);    // near lane bigger
    const laneY = car.lane === 0
      ? roadTop + roadH * 0.66
      : roadTop + roadH * 0.34;
    // travel 0..1 looping, offset by phase
    let t = (Game.fxTime * car.speed * s / span + car.phase) % 1;
    if (t < 0) t += 1;
    let x = car.dir > 0 ? (-wlen(160) + t * span) : (W + wlen(160) - t * span);
    const y = laneY - h;
    drawCar(ctx, x, y, len, h, car.color, car.dir);
  }
}

function drawCar(ctx, x, y, w, h, color, dir) {
  const r = Math.max(2, h * 0.18);
  // body
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r); ctx.fill();
  // cabin (slightly lighter, offset toward travel direction)
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  const cw = w * 0.42, ch = h * 0.5;
  const cx = dir > 0 ? x + w * 0.30 : x + w * 0.28;
  roundRect(ctx, cx, y - ch * 0.45, cw, ch, r * 0.8); ctx.fill();
  // windows
  ctx.fillStyle = 'rgba(159,184,196,0.6)';
  roundRect(ctx, cx + cw * 0.08, y - ch * 0.35, cw * 0.84, ch * 0.6, r * 0.5); ctx.fill();
  // wheels
  ctx.fillStyle = '#14202e';
  const wr = h * 0.22;
  ctx.beginPath(); ctx.arc(x + w * 0.24, y + h, wr, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + w * 0.76, y + h, wr, 0, Math.PI * 2); ctx.fill();
  // headlight glow toward travel direction
  ctx.fillStyle = 'rgba(247,222,190,0.85)';
  const hx = dir > 0 ? x + w - Math.max(2, w * 0.06) : x;
  ctx.fillRect(hx, y + h * 0.45, Math.max(2, w * 0.06), h * 0.22);
}

// ---- Layer 4: drifting parallax clouds --------------------------------------
function drawClouds(ctx, prog) {
  if (!BG.clouds) return;
  // Clouds appear as we start climbing; thickest in mid-altitude, thinning as
  // the sky "clears" near the very top.
  const gate = Math.min(1, Math.max(0, (prog - 0.06) / 0.30));   // ramp in early
  const clearOut = 1 - Math.max(0, (prog - 0.72) / 0.28) * 0.55; // thin near top
  const vis = gate * clearOut;
  if (vis <= 0.01) return;

  const W = View.cssW, H = View.cssH;
  const span = W + 360;
  // Keep the central band (where the tower sits) calmer: clouds drawn but we
  // dim any cloud whose centre is near mid-screen-x via a soft horizontal mask.
  for (let i = 0; i < BG.clouds.length; i++) {
    const cl = BG.clouds[i];
    let t = (Game.fxTime * cl.speed / span + cl.phase) % 1;
    if (t < 0) t += 1;
    const x = -180 + t * span;
    const y = H * cl.yFrac;
    // central calm: reduce alpha when cloud centre is near the column centre.
    const distFromCenter = Math.abs(x - W * 0.5) / (W * 0.5);
    const centerDim = 0.45 + 0.55 * Math.min(1, distFromCenter); // 0.45..1
    const a = cl.alpha * vis * centerDim;
    if (a <= 0.01) continue;
    drawCloud(ctx, x, y, cl.scale, a);
  }
}

function drawCloud(ctx, x, y, scale, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#f2d1b2';                  // warm peach-white, on palette
  const u = 22 * scale;                        // unit blob radius
  // a soft puffy cloud from overlapping circles
  ctx.beginPath();
  ctx.arc(x,            y,          u,        0, Math.PI * 2);
  ctx.arc(x + u * 1.1,  y - u*0.4,  u * 0.85, 0, Math.PI * 2);
  ctx.arc(x + u * 2.1,  y,          u * 0.95, 0, Math.PI * 2);
  ctx.arc(x + u * 1.0,  y + u*0.35, u * 1.05, 0, Math.PI * 2);
  ctx.arc(x - u * 0.9,  y + u*0.2,  u * 0.7,  0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- Layer 5: bird flocks (animated "V" shapes) crossing the upper sky ------
function drawBirds(ctx, prog) {
  if (!BG.flocks) return;
  const gate = Math.min(1, Math.max(0, (prog - 0.55) / 0.25));   // appear high up
  if (gate <= 0.01) return;

  const W = View.cssW, H = View.cssH;
  const span = W + 240;
  ctx.save();
  ctx.strokeStyle = 'rgba(20,32,46,' + (0.7 * gate).toFixed(3) + ')';
  ctx.lineCap = 'round';
  for (let i = 0; i < BG.flocks.length; i++) {
    const fl = BG.flocks[i];
    let t = (Game.fxTime * fl.speed / span + fl.phase) % 1;
    if (t < 0) t += 1;
    const lead = fl.dir > 0 ? (-120 + t * span) : (W + 120 - t * span);
    const y = H * fl.yFrac;
    // gentle wave so the flock undulates
    const wob = Math.sin(Game.fxTime * 1.2 + i) * 6;
    for (let b = 0; b < fl.n; b++) {
      // V formation: each bird trails back and to one side from the leader.
      const side = (b % 2 === 0 ? 1 : -1) * Math.ceil(b / 2);
      const bx = lead - fl.dir * Math.abs(side) * 16;
      const by = y + Math.abs(side) * 9 + wob;
      drawBird(ctx, bx, by, 9, Game.fxTime * 6 + b);
    }
  }
  ctx.restore();
}

function drawBird(ctx, x, y, size, flap) {
  // wing-flap: the V angle opens/closes a little over time.
  const a = size * (0.7 + Math.sin(flap) * 0.18);
  ctx.lineWidth = Math.max(1, size * 0.16);
  ctx.beginPath();
  ctx.moveTo(x - size, y + a * 0.4);
  ctx.lineTo(x, y - a * 0.3);
  ctx.lineTo(x + size, y + a * 0.4);
  ctx.stroke();
}

function clearAndSky(ctx) {
  ctx.clearRect(0, 0, View.cssW, View.cssH);
  const prog = altitudeProgress();
  // 1. backdrop (hero image or code gradient) — panned/brightened with altitude
  drawSkyBackdrop(ctx, prog);
  // 2. far skyline silhouette band (optional)
  drawFarSkyline(ctx, prog);
  // 4. clouds drift in mid-altitude (drawn before ground so ground occludes
  //    any low cloud as it scrolls up; birds sit highest)
  drawClouds(ctx, prog);
  drawBirds(ctx, prog);
  // 3. ground scene at the base, scrolls DOWN out of view as the tower rises
  drawGroundScene(ctx);
}

// Draw the podium base centered on the column.
function drawBase(ctx) {
  const w = CFG.BASE_DRAW_W;
  const h = CFG.BASE_DRAW_H;
  const dx = wx(-w / 2);
  const dy = wy(CFG.GROUND_Y - h);
  drawImageOrRect(ctx, Assets.base, dx, dy, wlen(w), wlen(h), COL.taupeDeep);
}

// Draw a placed block using its own PNG sub-crop.
function drawBlock(ctx, b) {
  const img = Assets.floors[b.imgIndex];
  const dx = wx(b.cx - b.w / 2);
  const dy = wy(b.topY);
  const dw = wlen(b.w);
  const dh = wlen(b.h);
  const sx = b.u0 * CFG.FLOOR_W;
  const sw = (b.u1 - b.u0) * CFG.FLOOR_W;
  drawImageCropOrRect(ctx, img, sx, 0, sw, CFG.FLOOR_H, dx, dy, dw, dh,
    b.floor % 2 ? COL.taupe : COL.beige);
  // subtle floor seam shadow
  ctx.fillStyle = 'rgba(31,42,46,0.10)';
  ctx.fillRect(dx, dy + dh - wlen(2), dw, wlen(2));
}

// Draw the moving (hooked or falling) floor at full width PNG [0,1].
function drawMoving(ctx) {
  const m = Game.moving;
  if (!m) return;
  const sway = Game.state === STATE.DROPPING ? Math.sin(m.swayPhase) * m.swayAmp : 0;
  const cx = m.x + sway;
  const dx = wx(cx - m.w / 2);
  const dy = wy(m.y);
  const dw = wlen(m.w);
  const dh = wlen(m.h);
  drawImageOrRect(ctx, Assets.floors[m.floor - 1], dx, dy, dw, dh,
    m.floor % 2 ? COL.taupe : COL.beige);
  ctx.fillStyle = 'rgba(31,42,46,0.10)';
  ctx.fillRect(dx, dy + dh - wlen(2), dw, wlen(2));
}

// The named feature: a tower crane (mast, jib, counter-jib, counterweight,
// trolley, cable, hook). Drawn in screen space from world anchors.
function drawCrane(ctx) {
  if (Game.state === STATE.WIN_OVERLAY) return;
  let awayShift = 0, awayAlpha = 1;
  if (Game.state === STATE.WIN_SEQ) {
    awayShift = Game._craneAway * 520;     // slides up & right out of frame
    awayAlpha = 1 - Game._craneAway;
  }

  const m = Game.moving;
  const jibY = craneJibY();
  const pivotX = trolleyX();

  ctx.save();
  ctx.globalAlpha = awayAlpha;

  const jibScreenY = wy(jibY) - awayShift;          // bottom chord of the jib
  const mastX = wx(-CFG.WORLD_W * 0.42);            // crane stands to the left
  const jibRight = wx(CFG.JIB_LEN * 0.62);          // working arm over the load
  const counterLeft = mastX - wlen(CFG.COUNTERJIB_LEN);

  const STEEL = '#f2b50e';                          // construction yellow
  const STEEL_LT = '#ffd64a';                        // lit edge of the steelwork
  const STEEL_DK = '#caa017';                        // shaded yellow
  const half = Math.max(5, wlen(13));               // half-width of the lattice chords
  const lw = (v) => Math.max(1, wlen(v));
  const bottomOfView = View.cssH + 40;

  // ---- Tower mast: two chords rising from below, rungs + X-bracing ----------
  ctx.lineCap = 'round';
  ctx.strokeStyle = STEEL;
  ctx.lineWidth = lw(5.5);
  ctx.beginPath();
  ctx.moveTo(mastX - half, jibScreenY); ctx.lineTo(mastX - half, bottomOfView);
  ctx.moveTo(mastX + half, jibScreenY); ctx.lineTo(mastX + half, bottomOfView);
  ctx.stroke();
  ctx.lineWidth = lw(2.2);
  const step = Math.max(14, wlen(34));
  let zig = true;
  for (let yy = jibScreenY; yy < bottomOfView; yy += step) {
    ctx.beginPath();                                // horizontal rung
    ctx.moveTo(mastX - half, yy); ctx.lineTo(mastX + half, yy); ctx.stroke();
    ctx.beginPath();                                // alternating diagonal
    if (zig) { ctx.moveTo(mastX - half, yy); ctx.lineTo(mastX + half, yy + step); }
    else     { ctx.moveTo(mastX + half, yy); ctx.lineTo(mastX - half, yy + step); }
    ctx.stroke(); zig = !zig;
  }

  // ---- A-frame apex (tower top) over the mast ------------------------------
  const apexX = mastX, apexY = jibScreenY - Math.max(28, wlen(78));
  ctx.strokeStyle = STEEL; ctx.lineWidth = lw(4);
  ctx.beginPath();
  ctx.moveTo(mastX - half, jibScreenY); ctx.lineTo(apexX, apexY);
  ctx.lineTo(mastX + half, jibScreenY); ctx.stroke();

  // ---- Jib (working arm) + counter-jib: bottom + top chords + web ----------
  const topOff = Math.max(10, wlen(26));
  // bottom chords
  ctx.strokeStyle = STEEL; ctx.lineWidth = lw(5);
  ctx.beginPath();
  ctx.moveTo(counterLeft, jibScreenY); ctx.lineTo(jibRight, jibScreenY); ctx.stroke();
  // top chords taper to the tips
  ctx.lineWidth = lw(3);
  ctx.beginPath();
  ctx.moveTo(counterLeft, jibScreenY);
  ctx.lineTo(mastX, jibScreenY - topOff);
  ctx.lineTo(jibRight - wlen(30), jibScreenY - topOff);
  ctx.lineTo(jibRight, jibScreenY); ctx.stroke();
  // web diagonals along the working arm
  ctx.lineWidth = lw(1.6);
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const x0 = mastX + (jibRight - mastX) * (i / segs);
    const x1 = mastX + (jibRight - mastX) * ((i + 1) / segs);
    ctx.beginPath();
    ctx.moveTo(x0, jibScreenY); ctx.lineTo(x1, jibScreenY - topOff); ctx.stroke();
  }
  // pendant tie cables from apex to both tips
  ctx.strokeStyle = STEEL_LT; ctx.lineWidth = lw(1.4);
  ctx.beginPath();
  ctx.moveTo(apexX, apexY); ctx.lineTo(jibRight - wlen(30), jibScreenY - topOff);
  ctx.moveTo(apexX, apexY); ctx.lineTo(counterLeft, jibScreenY - topOff * 0.5);
  ctx.stroke();

  // ---- Operator cab under the jib root -------------------------------------
  const cabW = Math.max(16, wlen(30)), cabH = Math.max(14, wlen(26));
  ctx.fillStyle = STEEL;
  ctx.fillRect(mastX - cabW / 2, jibScreenY + lw(2), cabW, cabH);
  ctx.fillStyle = 'rgba(180,205,220,0.8)';          // window glass
  ctx.fillRect(mastX - cabW / 2 + lw(3), jibScreenY + lw(5), cabW - lw(6), cabH * 0.5);

  // ---- Counterweight block (with a restrained terracotta stripe) -----------
  const cwW = Math.max(20, wlen(52)), cwH = Math.max(16, wlen(40));
  ctx.fillStyle = COL.inkSoft;
  ctx.fillRect(counterLeft - cwW / 2, jibScreenY - cwH * 0.5, cwW, cwH);
  ctx.fillStyle = COL.terracottaDeep;
  ctx.fillRect(counterLeft - cwW / 2, jibScreenY + cwH * 0.18, cwW, cwH * 0.16);

  // ---- Trolley carriage on the bottom chord --------------------------------
  const trolleyScreenX = wx(pivotX);
  ctx.fillStyle = STEEL;
  ctx.fillRect(trolleyScreenX - wlen(15), jibScreenY - lw(3), wlen(30), lw(11));
  ctx.fillStyle = STEEL_LT;
  ctx.fillRect(trolleyScreenX - wlen(15), jibScreenY - lw(3), wlen(30), lw(3));

  // ---- Cable + hook block + (slab drawn elsewhere) -------------------------
  if (m && Game.state === STATE.PLAYING) {
    const slabTopScreenY = wy(m.y);
    const slabScreenX = wx(m.x);
    ctx.strokeStyle = STEEL; ctx.lineWidth = lw(2);
    // two hoist lines for a beefier look
    ctx.beginPath();
    ctx.moveTo(trolleyScreenX - wlen(4), jibScreenY + lw(6));
    ctx.lineTo(slabScreenX - wlen(3), slabTopScreenY - wlen(8));
    ctx.moveTo(trolleyScreenX + wlen(4), jibScreenY + lw(6));
    ctx.lineTo(slabScreenX + wlen(3), slabTopScreenY - wlen(8));
    ctx.stroke();
    // hook block
    ctx.fillStyle = STEEL;
    ctx.fillRect(slabScreenX - wlen(6), slabTopScreenY - wlen(10), wlen(12), wlen(8));
  }

  ctx.restore();
}

// Decorative crown cap (win).
function drawCrown(ctx) {
  if (Game.state !== STATE.WIN_SEQ && Game.state !== STATE.WIN_OVERLAY) return;
  const cw = CFG.FLOOR_DRAW_W * 1.18;
  const ch = cw * (368 / 700);
  const dx = wx(-cw / 2);
  const dy = wy(Game.crownY - ch); // crownY = bottom rests on tower top
  drawImageOrRect(ctx, Assets.crown, dx, dy, wlen(cw), wlen(ch), COL.terracotta);
}

function drawOffcuts(ctx) {
  for (const o of Game.offcuts) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, o.alpha);
    const cx = wx(o.x);
    const cy = wy(o.y);
    ctx.translate(cx, cy);
    ctx.rotate(o.rot);
    const dw = wlen(o.w), dh = wlen(o.h);
    drawImageCropOrRect(ctx, o.img, o.sx, o.sy, o.sw, o.sh,
      -dw / 2, -dh / 2, dw, dh, COL.taupeDeep);
    ctx.restore();
  }
}

function drawFlashes(ctx) {
  for (const f of Game.flashes) {
    const p = f.t / 0.5;
    ctx.save();
    ctx.globalAlpha = (1 - p) * 0.9;
    ctx.strokeStyle = COL.paper;
    ctx.lineWidth = 3;
    const r = wlen(Game.topWidth * 0.5) + p * 40;
    ctx.beginPath();
    ctx.arc(wx(f.x), wy(f.y), r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawConfetti(ctx) {
  for (const c of Game.confetti) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, c.alpha);
    ctx.translate(wx(c.x), wy(c.y));
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-wlen(c.w) / 2, -wlen(c.h) / 2, wlen(c.w), wlen(c.h));
    ctx.restore();
  }
}

// -------- HUD + overlays (screen space) --------------------------------------

function drawHUD(ctx) {
  if (Game.state === STATE.START || Game.state === STATE.WIN_OVERLAY) return;

  const pad = 18;
  ctx.save();
  ctx.textBaseline = 'top';

  // Floor counter (top-left), restrained, well-kerned.
  ctx.fillStyle = COL.paper;
  ctx.font = '700 13px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('FLOOR', pad, pad);
  ctx.font = '800 34px "Helvetica Neue", Arial, sans-serif';
  const shown = Game.state === STATE.PLAYING && Game.moving ? Game.moving.floor : Game.score;
  ctx.fillText(`${String(shown).padStart(2, '0')}`, pad, pad + 16);
  ctx.font = '600 15px "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = 'rgba(243,234,217,0.7)';
  ctx.fillText(`/ ${CFG.TOTAL_FLOORS}`, pad + 44, pad + 30);

  // Stability meter (top-right) — how win/lose is communicated.
  const barW = 132, barH = 12;
  drawStabilityBar(ctx, View.cssW - pad - barW, pad + 2, barW, barH,
                   Game.stabShown / CFG.STAB_MAX, true);

  // Combo, tucked under the floor counter (left).
  if (Game.combo >= 2) {
    ctx.fillStyle = COL.terracotta;
    ctx.font = '800 15px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`PERFECT x${Game.combo}`, pad, pad + 44);
  }

  // Thin blueprint rule across the top.
  ctx.strokeStyle = 'rgba(243,234,217,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad + 58);
  ctx.lineTo(View.cssW - pad, pad + 58);
  ctx.stroke();

  ctx.restore();
}

// Shared editorial panel helper.
function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(243,234,217,0.96)';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  // thin double rule frame (blueprint feel)
  ctx.strokeStyle = 'rgba(31,42,46,0.55)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 8);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Stability meter: green (sound) -> amber -> red (near the 60% collapse line).
function stabColor(frac) {
  if (frac > 0.80) return '#5fa873';
  if (frac > 0.68) return '#d7a23e';
  return '#c0523b';
}

// Draw the stability bar. hud=true: light-on-dark for the in-game corner;
// hud=false: ink-on-paper, centred, for the end-screen panels.
function drawStabilityBar(ctx, x, y, w, h, frac, hud) {
  frac = Math.max(0, Math.min(1, frac));
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const labelX = hud ? x + w : x + w / 2;
  ctx.textAlign = hud ? 'right' : 'center';
  ctx.font = '700 10px "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = hud ? 'rgba(243,234,217,0.85)' : 'rgba(31,42,46,0.7)';
  ctx.fillText('S T A B I L I T Y', labelX, y - 5);
  // track
  ctx.fillStyle = hud ? 'rgba(243,234,217,0.16)' : 'rgba(31,42,46,0.10)';
  roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  // fill
  ctx.fillStyle = stabColor(frac);
  roundRect(ctx, x, y, Math.max(h, w * frac), h, h / 2); ctx.fill();
  // danger line at the 60% collapse threshold
  const tx = x + w * (CFG.LOSE_THRESHOLD / CFG.STAB_MAX);
  ctx.strokeStyle = hud ? 'rgba(243,234,217,0.65)' : 'rgba(31,42,46,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx, y - 2); ctx.lineTo(tx, y + h + 2); ctx.stroke();
  // outline
  ctx.strokeStyle = hud ? 'rgba(243,234,217,0.35)' : 'rgba(31,42,46,0.35)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, h / 2); ctx.stroke();
  // value
  ctx.font = '800 11px "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = hud ? COL.paper : COL.ink;
  ctx.fillText(Math.round(frac * 100) + '%', labelX, y + h + 13);
  ctx.restore();
}

// Buttons live as screen-space rects we hit-test in the input handler.
const Buttons = { build: null, again: null, retry: null, enquire: null };

function drawButton(ctx, rect, label, primary) {
  ctx.save();
  if (primary) {
    ctx.fillStyle = COL.terracotta;
  } else {
    ctx.fillStyle = 'rgba(31,42,46,0.06)';
  }
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  ctx.fill();
  if (!primary) {
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = 1.5;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
    ctx.stroke();
  }
  ctx.fillStyle = primary ? COL.paper : COL.ink;
  ctx.font = '800 17px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
  ctx.restore();
}

function drawStartScreen(ctx) {
  // Dim the scene a touch.
  ctx.fillStyle = 'rgba(20,28,31,0.45)';
  ctx.fillRect(0, 0, View.cssW, View.cssH);

  const w = Math.min(360, View.cssW - 40);
  const h = 300;
  const x = (View.cssW - w) / 2;
  const y = (View.cssH - h) / 2;
  panel(ctx, x, y, w, h);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(31,42,46,0.55)';
  ctx.font = '600 12px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('A  R E N E E V  L A N D M A R K', View.cssW / 2, y + 36);

  ctx.fillStyle = COL.ink;
  ctx.font = '900 56px Georgia, "Times New Roman", serif';
  ctx.fillText('PAGE 22', View.cssW / 2, y + 92);

  // thin rule + page number motif
  ctx.strokeStyle = 'rgba(31,42,46,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 50, y + 122);
  ctx.lineTo(x + w - 50, y + 122);
  ctx.stroke();

  ctx.fillStyle = COL.inkSoft;
  ctx.font = '500 15px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('Stack all 22 floors to top out the tower.', View.cssW / 2, y + 146);
  ctx.fillStyle = 'rgba(31,42,46,0.6)';
  ctx.font = '500 13px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('Tap / click / space to drop each floor.', View.cssW / 2, y + 170);

  // page number footer
  ctx.fillStyle = 'rgba(31,42,46,0.5)';
  ctx.font = 'italic 13px Georgia, serif';
  ctx.fillText('— 22 —', View.cssW / 2, y + h - 30);

  ctx.restore();

  Buttons.build = { x: View.cssW / 2 - 90, y: y + 200, w: 180, h: 52 };
  drawButton(ctx, Buttons.build, 'BUILD', true);
}

function drawLoseScreen(ctx) {
  // Light scrim so the collapsed tower stays visible above the card.
  ctx.fillStyle = 'rgba(20,28,31,0.30)';
  ctx.fillRect(0, 0, View.cssW, View.cssH);
  const w = Math.min(340, View.cssW - 40);
  const h = 286;
  const x = (View.cssW - w) / 2;
  const y = View.cssH - h - 18;            // bottom-anchored
  panel(ctx, x, y, w, h);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = COL.terracottaDeep;
  ctx.font = '600 12px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('S T A B I L I T Y   T O O   L O W', View.cssW / 2, y + 30);
  ctx.fillStyle = COL.ink;
  ctx.font = '900 26px Georgia, serif';
  ctx.fillText('Keep it steady', View.cssW / 2, y + 56);

  // Score.
  ctx.fillStyle = 'rgba(31,42,46,0.55)';
  ctx.font = '600 12px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('S C O R E', View.cssW / 2, y + 84);
  ctx.fillStyle = COL.terracotta;
  ctx.font = '900 44px Georgia, serif';
  ctx.fillText(`${Game.score}`, View.cssW / 2, y + 128);
  ctx.fillStyle = COL.inkSoft;
  ctx.font = '500 13px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(`floors of ${CFG.TOTAL_FLOORS}` +
    (Game.bestCombo >= 2 ? `   ·   best streak x${Game.bestCombo}` : ''),
    View.cssW / 2, y + 150);
  ctx.restore();

  // Final stability reading.
  drawStabilityBar(ctx, View.cssW / 2 - 75, y + 178, 150, 12,
                   Game.stabShown / CFG.STAB_MAX, false);

  Buttons.retry = { x: View.cssW / 2 - 90, y: y + h - 58, w: 180, h: 48 };
  drawButton(ctx, Buttons.retry, 'TRY AGAIN', true);
}

function drawWinOverlay(ctx) {
  // Soft scrim — keep the whole revealed tower visible above the card.
  ctx.fillStyle = 'rgba(20,28,31,0.22)';
  ctx.fillRect(0, 0, View.cssW, View.cssH);

  // Confetti continues over the overlay.
  drawConfetti(ctx);

  const w = Math.min(380, View.cssW - 32);
  const h = 336;
  const x = (View.cssW - w) / 2;
  const y = View.cssH - h - 16;            // bottom-anchored
  panel(ctx, x, y, w, h);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(31,42,46,0.55)';
  ctx.font = '600 12px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('T O P P E D   O U T', View.cssW / 2, y + 28);

  ctx.fillStyle = COL.ink;
  ctx.font = '800 24px Georgia, serif';
  ctx.fillText('Congratulations', View.cssW / 2, y + 52);

  // Wordmark image with styled text fallback.
  const wmY = y + 66;
  if (Assets.wordmark && Assets.wordmark.loaded) {
    const iw = Assets.wordmark.width, ih = Assets.wordmark.height;
    const dw = Math.min(w - 90, iw);
    const dh = dw * (ih / iw);
    ctx.drawImage(Assets.wordmark, View.cssW / 2 - dw / 2, wmY, dw, dh);
  } else {
    ctx.fillStyle = COL.terracotta;
    ctx.font = '900 52px Georgia, serif';
    ctx.fillText('PAGE 22', View.cssW / 2, wmY + 50);
    ctx.fillStyle = 'rgba(31,42,46,0.6)';
    ctx.font = '600 12px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('B Y   R E N E E V', View.cssW / 2, wmY + 80);
  }

  ctx.fillStyle = COL.inkSoft;
  ctx.font = '500 14px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('All 22 floors stacked. The landmark is complete.',
    View.cssW / 2, y + 196);
  ctx.restore();

  // Final stability reading.
  drawStabilityBar(ctx, View.cssW / 2 - 75, y + 216, 150, 12,
                   Game.stabShown / CFG.STAB_MAX, false);

  Buttons.enquire = { x: View.cssW / 2 - 150, y: y + h - 58, w: 144, h: 50 };
  Buttons.again = { x: View.cssW / 2 + 6, y: y + h - 58, w: 144, h: 50 };
  drawButton(ctx, Buttons.enquire, 'ENQUIRE', true);
  drawButton(ctx, Buttons.again, 'PLAY AGAIN', false);
}

// Master render.
function render() {
  const ctx = View.ctx;
  clearAndSky(ctx);

  // World-space scene with a subtle global pulse on perfect drops.
  ctx.save();
  if (Game.pulse > 0) {
    const s = 1 + Game.pulse * 0.012;
    ctx.translate(View.cssW / 2, View.cssH * 0.62);
    ctx.scale(s, s);
    ctx.translate(-View.cssW / 2, -View.cssH * 0.62);
  }

  // The BUILDING wobbles as it gets unstable (crane is excluded).
  const wob = wobbleAngle();
  ctx.save();
  if (wob !== 0) {
    const px = wx(0), py = wy(CFG.GROUND_Y);
    ctx.translate(px, py); ctx.rotate(wob); ctx.translate(-px, -py);
  }
  drawBase(ctx);
  for (const b of Game.blocks) drawBlock(ctx, b);
  drawOffcuts(ctx);
  drawCrown(ctx);
  if (Game.state === STATE.PLAYING || Game.state === STATE.DROPPING) drawMoving(ctx);
  ctx.restore();           // end wobble

  drawCrane(ctx);
  drawFlashes(ctx);
  if (Game.state === STATE.WIN_SEQ) drawConfetti(ctx);

  ctx.restore();

  // Screen-space chrome.
  drawHUD(ctx);
  if (Game.state === STATE.START) drawStartScreen(ctx);
  else if (Game.state === STATE.LOSE) drawLoseScreen(ctx);
  else if (Game.state === STATE.WIN_OVERLAY) drawWinOverlay(ctx);
}

/* ============================================================================
   10. INPUT  (unified tap / click / space)
   Buttons are hit-tested first; otherwise the action is "drop".
   ========================================================================== */

function pointInRect(px, py, r) {
  return r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function handlePrimaryAction(px, py) {
  // px/py in CSS px (null when from keyboard).
  switch (Game.state) {
    case STATE.START:
      if (px == null || pointInRect(px, py, Buttons.build)) { AudioFX.click(); startGame(); }
      break;
    case STATE.PLAYING:
      dropFloor();
      break;
    case STATE.LOSE:
      if (px == null || pointInRect(px, py, Buttons.retry)) { AudioFX.click(); startGame(); }
      break;
    case STATE.WIN_OVERLAY:
      if (px != null && pointInRect(px, py, Buttons.again)) { AudioFX.click(); startGame(); }
      else if (px != null && pointInRect(px, py, Buttons.enquire)) { AudioFX.click(); /* no-op CTA */ }
      else if (px == null) { AudioFX.click(); startGame(); }
      break;
    default:
      // DROPPING / SETTLE / WIN_SEQ ignore input.
      break;
  }
}

/* ============================================================================
   AUDIO  (WebAudio synth — SFX + party music, no external files)
   ========================================================================== */
const AudioFX = {
  ctx: null, master: null, musicOn: false, _timer: null,

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  },

  tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.03);
  },

  thunk() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * 0.08);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = 0.12;
    s.connect(g); g.connect(this.master); s.start(t);
  },

  click()   { this.ensure(); this.tone(520, 0.08, 'triangle', 0.25, 720); },
  place()   { this.ensure(); this.tone(190, 0.12, 'sine', 0.35, 120); this.thunk(); },
  perfect() { this.ensure(); this.tone(660, 0.10, 'triangle', 0.28, 880);
              this.tone(990, 0.12, 'sine', 0.20); },
  lose()    { this.ensure(); this.stopParty(); this.tone(320, 0.5, 'sawtooth', 0.3, 70); },

  startParty() {
    this.ensure();
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const beat = 60 / 132;
    const mel = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25,
                 587.33, 698.46, 880.0, 1174.7, 880.0, 698.46];
    let i = 0;
    const step = () => {
      if (!this.musicOn || !this.ctx) return;
      const f = mel[i % mel.length];
      this.tone(f, beat * 0.9, 'triangle', 0.22);
      if (i % 2 === 0) this.tone(f / 2, beat * 1.1, 'sine', 0.18);
      i++;
      this._timer = setTimeout(step, beat * 500);
    };
    step();
  },
  stopParty() {
    this.musicOn = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  },
};

function bindInput() {
  const cv = View.canvas;

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    AudioFX.ensure();
    const rect = cv.getBoundingClientRect();
    handlePrimaryAction(e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      AudioFX.ensure();
      handlePrimaryAction(null, null);
    } else if (e.code === 'Enter' &&
               (Game.state === STATE.START || Game.state === STATE.LOSE ||
                Game.state === STATE.WIN_OVERLAY)) {
      e.preventDefault();
      startGame();
    }
  });
}

/* ============================================================================
   11. MAIN LOOP  (rAF + fixed-timestep accumulator, pause on hidden)
   ========================================================================== */

let _lastT = 0;
let _acc = 0;
let _paused = false;

function tick(nowMs) {
  requestAnimationFrame(tick);
  const now = nowMs / 1000;
  if (_lastT === 0) _lastT = now;
  let frame = now - _lastT;
  _lastT = now;
  if (_paused) return;
  if (frame > 0.25) frame = 0.25; // avoid spiral of death after a stall

  _acc += frame;
  while (_acc >= CFG.DT) {
    update(CFG.DT);
    _acc -= CFG.DT;
  }
  render();
}

function update(dt) {
  switch (Game.state) {
    case STATE.PLAYING:
    case STATE.DROPPING:
      stepPhysics(dt);
      break;
    case STATE.SETTLE:
      Game.seqT += dt;
      if (Game.seqT >= 0.18) {
        spawnMovingFloor();
        Game.state = STATE.PLAYING;
      }
      break;
    case STATE.WIN_SEQ:
      stepWinSequence(dt);
      break;
  }
  updateCamera(dt);
  updateFx(dt);
}

/* ============================================================================
   BOOTSTRAP
   ========================================================================== */

function init() {
  View.canvas = document.getElementById('game');
  View.ctx = View.canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('visibilitychange', () => {
    _paused = document.hidden;
    if (!_paused) _lastT = 0; // reset clock so we don't jump on resume
  });

  bindInput();
  loadAssets();
  initBackground();

  // Initial camera framing on the base for the start screen backdrop.
  View.cameraY = (CFG.GROUND_Y - CFG.BASE_DRAW_H) + 60;
  Game.state = STATE.START;

  requestAnimationFrame(tick);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
