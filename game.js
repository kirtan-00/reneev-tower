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
  SWING_AMP_MIN: 0.18,    // radians at floor 1 (~10 deg)
  SWING_AMP_MAX: 0.62,    // radians near floor 22 (~36 deg)
  SWING_OMEGA_MIN: 1.25,  // rad/s
  SWING_OMEGA_MAX: 2.55,
  TROLLEY_DRIFT: 26,      // px of slow trolley traverse for extra life
  TROLLEY_OMEGA: 0.55,

  // Drop physics.
  GRAVITY: 2600,          // world px / s^2
  SWAY_DAMP: 0.86,        // residual sway damping per second factor
  MAX_FALL_VX: 900,

  // Placement rules.
  PERFECT_TOL: 7,         // center within this many px = perfect (no trim)
  MIN_WIDTH: 26,          // below this the slab is essentially gone (still alive)
  PERFECT_REGRANT: 8,     // px width regranted per perfect on a streak
  REGRANT_STREAK: 2,      // perfects in a row before regrant kicks in

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
  scale: 1,        // world px -> screen px
  originX: 0,      // screen x of world x=0 (column center)
  cameraY: 0,      // world y currently centered-ish in frame
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
  View.originX = View.cssW / 2; // world x=0 is the column center
}

// World coords -> screen CSS px.
function wx(worldX) { return View.originX + worldX * View.scale; }
function wy(worldY) {
  // Place cameraY around 62% down the screen so the tower top has headroom.
  const anchor = View.cssH * 0.62;
  return anchor + (worldY - View.cameraY) * View.scale;
}
function wlen(v) { return v * View.scale; }

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
  time: 0,             // accumulated game time (s) for pendulum phase

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
  Game.combo = 0;
  Game.score = 0;
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

// Compute overlap, trim/shrink, place the slab, spawn the offcut, or LOSE.
function resolvePlacement() {
  const m = Game.moving;
  const ref = landingReference();

  const movLeft = m.x - m.w / 2;
  const movRight = m.x + m.w / 2;
  const refLeft = ref.cx - ref.w / 2;
  const refRight = ref.cx + ref.w / 2;

  const overlapLeft = Math.max(movLeft, refLeft);
  const overlapRight = Math.min(movRight, refRight);
  const overlap = overlapRight - overlapLeft;

  // SUDDEN DEATH: no overlap at all -> the slab missed entirely.
  // Let projectile motion carry it PAST the tower; the fall-past guard in
  // stepPhysics (m.y > GROUND_Y + 400) then triggers game over.
  if (overlap <= 0) {
    m.missed = true;
    m.vy = Math.max(m.vy, 360);
    Game.state = STATE.DROPPING;
    return;
  }

  const centerDelta = Math.abs(m.x - ref.cx);
  let placedW = overlap;
  let placedCx = (overlapLeft + overlapRight) / 2;
  let perfect = false;

  // PERFECT: center within tolerance AND near full current width.
  if (centerDelta <= CFG.PERFECT_TOL) {
    perfect = true;
    // No trim — keep the moving floor's full width, snap onto reference center.
    placedW = m.w;
    placedCx = ref.cx;
    Game.combo += 1;
    Game.bestCombo = Math.max(Game.bestCombo, Game.combo);

    // Regrant a few px on a streak (capped at original FLOOR_DRAW_W).
    if (Game.combo >= CFG.REGRANT_STREAK) {
      placedW = Math.min(CFG.FLOOR_DRAW_W, placedW + CFG.PERFECT_REGRANT);
    }
    Game.pulse = 1;
    Game.flashes.push({ x: placedCx, y: towerTopY() - m.h / 2, t: 0 });
  } else {
    Game.combo = 0;
  }

  // Map the placed world-range back into the MOVING block's OWN u-range.
  // The moving block displays floor PNG N across [0,1] over [movLeft,movRight].
  let u0, u1;
  if (perfect) {
    // Perfect keeps full PNG, but may have regranted width beyond the slab;
    // center the full [0,1] on placedCx at placedW.
    u0 = 0; u1 = 1;
  } else {
    u0 = (overlapLeft - movLeft) / m.w;
    u1 = (overlapRight - movLeft) / m.w;
    u0 = Math.max(0, Math.min(1, u0));
    u1 = Math.max(0, Math.min(1, u1));
  }

  // Place the block. topY is the world-y of its TOP surface.
  const placedTopY = towerTopY() - m.h;
  const block = {
    floor: m.floor,
    cx: placedCx,
    w: placedW,
    h: m.h,
    topY: placedTopY,
    botY: placedTopY + m.h,
    u0, u1,
    imgIndex: m.floor - 1,
  };
  Game.blocks.push(block);
  // Keep a minimum buildable top so an ultra-thin sliver doesn't end the run
  // outright (sudden death is reserved for an actual full miss).
  Game.topWidth = Math.max(CFG.MIN_WIDTH, placedW);
  Game.score = m.floor;

  // Spawn the tumbling offcut(s) for trimmed overhang.
  if (!perfect && overlap < m.w - 0.5) {
    spawnOffcuts(m, ref, overlapLeft, overlapRight, placedTopY);
  }

  // WIN or continue.
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
    if (p >= 1) { Game.seqStage = 2; Game.seqT = 0; spawnConfetti(); }
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
  let target;
  if (Game.state === STATE.WIN_SEQ && Game.seqStage >= 2 ||
      Game.state === STATE.WIN_OVERLAY) {
    // Pull back: frame the whole tower (mid-point of base-to-top).
    const topY = towerTopY();
    const mid = (topY + (CFG.GROUND_Y - CFG.BASE_DRAW_H)) / 2;
    target = mid;
    // Also zoom out a touch by lerping scale handled below.
    View._winZoom = true;
  } else {
    // Follow the active build region: keep crane + tower top in frame.
    const topY = towerTopY();
    target = topY - CFG.CRANE_CLEARANCE * 0.55;
    View._winZoom = false;
  }
  const k = 1 - Math.exp(-CFG.CAM_LERP * dt);
  View.cameraY += (target - View.cameraY) * k;
}

function updateFx(dt) {
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

function clearAndSky(ctx) {
  ctx.clearRect(0, 0, View.cssW, View.cssH);
  if (Assets.skyline && Assets.skyline.loaded) {
    // Cover-fit the skyline image.
    const img = Assets.skyline;
    const ir = img.width / img.height;
    const cr = View.cssW / View.cssH;
    let dw, dh;
    if (cr > ir) { dw = View.cssW; dh = dw / ir; }
    else { dh = View.cssH; dw = dh * ir; }
    ctx.drawImage(img, (View.cssW - dw) / 2, (View.cssH - dh) / 2, dw, dh);
  } else {
    // Soft dusk gradient.
    const g = ctx.createLinearGradient(0, 0, 0, View.cssH);
    g.addColorStop(0, '#3a4f57');
    g.addColorStop(0.45, '#6f7d76');
    g.addColorStop(0.75, '#c39c7e');
    g.addColorStop(1, '#e6c9a6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, View.cssW, View.cssH);
    // faint sun glow
    const sun = ctx.createRadialGradient(View.cssW * 0.5, View.cssH * 0.74, 10,
                                         View.cssW * 0.5, View.cssH * 0.74, View.cssW * 0.7);
    sun.addColorStop(0, 'rgba(255,238,210,0.45)');
    sun.addColorStop(1, 'rgba(255,238,210,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, View.cssW, View.cssH);
  }
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

  const jibScreenY = wy(jibY) - awayShift;
  const mastX = wx(-CFG.WORLD_W * 0.42); // mast off to the left
  const jibLeft = mastX;
  const jibRight = wx(CFG.JIB_LEN * 0.55);
  const counterLeft = mastX - wlen(CFG.COUNTERJIB_LEN);

  // Mast (vertical lattice) from jib up off the top of screen.
  ctx.strokeStyle = COL.craneInk;
  ctx.lineWidth = Math.max(3, wlen(10));
  ctx.beginPath();
  ctx.moveTo(mastX, jibScreenY);
  ctx.lineTo(mastX, -40);
  ctx.stroke();
  // mast cross-bracing
  ctx.lineWidth = Math.max(1, wlen(2.5));
  for (let yy = jibScreenY; yy > -40; yy -= wlen(28)) {
    ctx.beginPath();
    ctx.moveTo(mastX - wlen(5), yy);
    ctx.lineTo(mastX + wlen(5), yy - wlen(14));
    ctx.moveTo(mastX + wlen(5), yy);
    ctx.lineTo(mastX - wlen(5), yy - wlen(14));
    ctx.stroke();
  }

  // Jib (working arm) + counter-jib.
  ctx.lineWidth = Math.max(3, wlen(8));
  ctx.strokeStyle = COL.craneInk;
  ctx.beginPath();
  ctx.moveTo(counterLeft, jibScreenY);
  ctx.lineTo(jibRight, jibScreenY);
  ctx.stroke();
  // jib top chord (triangle truss to a small apex over the mast)
  const apexY = jibScreenY - wlen(46);
  ctx.lineWidth = Math.max(2, wlen(4));
  ctx.beginPath();
  ctx.moveTo(counterLeft, jibScreenY);
  ctx.lineTo(mastX, apexY);
  ctx.lineTo(jibRight, jibScreenY);
  ctx.stroke();
  // truss verticals
  ctx.lineWidth = Math.max(1, wlen(2));
  for (let t = 0.15; t < 1; t += 0.18) {
    const xr = mastX + (jibRight - mastX) * t;
    const yr = apexY + (jibScreenY - apexY) * t;
    ctx.beginPath(); ctx.moveTo(xr, jibScreenY); ctx.lineTo(xr, yr); ctx.stroke();
  }

  // Counterweight block.
  ctx.fillStyle = COL.inkSoft;
  const cwW = wlen(46), cwH = wlen(30);
  ctx.fillRect(counterLeft - cwW / 2, jibScreenY - cwH / 2, cwW, cwH);

  // Trolley (rides the jib above the slab) + cable + hook + slab.
  const trolleyScreenX = wx(pivotX);
  ctx.fillStyle = COL.terracottaDeep;
  ctx.fillRect(trolleyScreenX - wlen(14), jibScreenY - wlen(4), wlen(28), wlen(12));

  // Cable to the hooked slab (only while attached: PLAYING).
  if (m && Game.state === STATE.PLAYING) {
    const slabTopScreenY = wy(m.y);
    const slabScreenX = wx(m.x);
    ctx.strokeStyle = COL.craneInk;
    ctx.lineWidth = Math.max(1.5, wlen(2.5));
    ctx.beginPath();
    ctx.moveTo(trolleyScreenX, jibScreenY + wlen(8));
    ctx.lineTo(slabScreenX, slabTopScreenY - wlen(6));
    ctx.stroke();
    // hook
    ctx.beginPath();
    ctx.arc(slabScreenX, slabTopScreenY - wlen(3), wlen(4), 0, Math.PI * 2);
    ctx.fillStyle = COL.craneInk;
    ctx.fill();
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

  // Combo (top-right).
  if (Game.combo >= 2) {
    ctx.textAlign = 'right';
    ctx.fillStyle = COL.terracotta;
    ctx.font = '800 22px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`PERFECT  x${Game.combo}`, View.cssW - pad, pad + 4);
    ctx.textAlign = 'left';
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
  ctx.fillStyle = 'rgba(20,28,31,0.55)';
  ctx.fillRect(0, 0, View.cssW, View.cssH);
  const w = Math.min(340, View.cssW - 40);
  const h = 240;
  const x = (View.cssW - w) / 2;
  const y = (View.cssH - h) / 2;
  panel(ctx, x, y, w, h);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = COL.terracottaDeep;
  ctx.font = '600 12px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('S I T E   H A L T E D', View.cssW / 2, y + 34);
  ctx.fillStyle = COL.ink;
  ctx.font = '900 30px Georgia, serif';
  ctx.fillText('Off the slab!', View.cssW / 2, y + 64);

  ctx.font = '500 15px "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = COL.inkSoft;
  ctx.fillText('Floors completed', View.cssW / 2, y + 108);
  ctx.fillStyle = COL.terracotta;
  ctx.font = '900 46px Georgia, serif';
  ctx.fillText(`${Game.score} / ${CFG.TOTAL_FLOORS}`, View.cssW / 2, y + 150);
  ctx.restore();

  Buttons.retry = { x: View.cssW / 2 - 90, y: y + h - 64, w: 180, h: 48 };
  drawButton(ctx, Buttons.retry, 'TRY AGAIN', true);
}

function drawWinOverlay(ctx) {
  // Keep the revealed tower visible behind a soft scrim.
  ctx.fillStyle = 'rgba(20,28,31,0.40)';
  ctx.fillRect(0, 0, View.cssW, View.cssH);

  // Confetti continues over the overlay.
  drawConfetti(ctx);

  const w = Math.min(380, View.cssW - 32);
  const h = 360;
  const x = (View.cssW - w) / 2;
  const y = (View.cssH - h) / 2;
  panel(ctx, x, y, w, h);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(31,42,46,0.55)';
  ctx.font = '600 12px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('T O P P E D   O U T', View.cssW / 2, y + 34);

  ctx.fillStyle = COL.ink;
  ctx.font = '800 26px Georgia, serif';
  ctx.fillText('Congratulations', View.cssW / 2, y + 58);

  // Wordmark image with styled text fallback.
  const wmY = y + 96;
  if (Assets.wordmark && Assets.wordmark.loaded) {
    const iw = Assets.wordmark.width, ih = Assets.wordmark.height;
    const maxW = w - 80;
    const dw = Math.min(maxW, iw);
    const dh = dw * (ih / iw);
    ctx.drawImage(Assets.wordmark, View.cssW / 2 - dw / 2, wmY, dw, dh);
  } else {
    ctx.fillStyle = COL.terracotta;
    ctx.font = '900 60px Georgia, serif';
    ctx.fillText('PAGE 22', View.cssW / 2, wmY + 56);
    ctx.fillStyle = 'rgba(31,42,46,0.6)';
    ctx.font = '600 13px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('B Y   R E N E E V', View.cssW / 2, wmY + 92);
  }

  ctx.fillStyle = COL.inkSoft;
  ctx.font = '500 15px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('All 22 floors stacked. The landmark is complete.',
    View.cssW / 2, y + 232);
  ctx.restore();

  Buttons.enquire = { x: View.cssW / 2 - 150, y: y + 264, w: 144, h: 50 };
  Buttons.again = { x: View.cssW / 2 + 6, y: y + 264, w: 144, h: 50 };
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

  drawBase(ctx);
  for (const b of Game.blocks) drawBlock(ctx, b);
  drawOffcuts(ctx);
  drawCrown(ctx);
  if (Game.state === STATE.PLAYING || Game.state === STATE.DROPPING) drawMoving(ctx);
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
      if (px == null || pointInRect(px, py, Buttons.build)) startGame();
      break;
    case STATE.PLAYING:
      dropFloor();
      break;
    case STATE.LOSE:
      if (px == null || pointInRect(px, py, Buttons.retry)) startGame();
      break;
    case STATE.WIN_OVERLAY:
      if (px != null && pointInRect(px, py, Buttons.again)) startGame();
      else if (px != null && pointInRect(px, py, Buttons.enquire)) { /* no-op CTA */ }
      else if (px == null) startGame();
      break;
    default:
      // DROPPING / SETTLE / WIN_SEQ ignore input.
      break;
  }
}

function bindInput() {
  const cv = View.canvas;

  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    handlePrimaryAction(e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
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
