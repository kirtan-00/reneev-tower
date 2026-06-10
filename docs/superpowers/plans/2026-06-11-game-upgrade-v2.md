# PAGE 22 Game Upgrade v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realistic crane physics, points×stability scoring, finished-game end UI with tiered messages + project CTA, 10% easier tuning, and live street-progression tiers in the PAGE 22 stack-builder.

**Architecture:** All gameplay stays in the existing single-file vanilla-canvas app (`game.js`). New PURE logic (scoring, grades, messages, street tier) goes in a new `logic.js` loaded before `game.js` and exported for Node so it can be TDD'd with `node --test`. Visual/physics work is verified by rendering (local server + screenshots), not unit tests.

**Tech Stack:** Vanilla HTML5 canvas, WebAudio (existing), `node:test` for pure logic. No libraries, no build step.

**Spec:** `docs/superpowers/specs/2026-06-11-game-upgrade-v2-design.md`

**Hard rules (from client):** the building NEVER falls/collapses on screen; floors always full width; mobile-first portrait; the repo is local-only — commit after every task.

**Verification environment:** `python3 -m http.server 8123` in repo root, open `http://localhost:8123`. For screenshots use the webapp-testing skill (Playwright). ALWAYS render and look at the result before calling a visual task done (house rule).

---

### Task 1: Pure logic module (`logic.js`) with TDD

**Files:**
- Create: `logic.js`
- Create: `tests/logic.test.cjs`
- Modify: `index.html` (add script tag before game.js)

- [ ] **Step 1: Write failing tests**

`tests/logic.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

test('floorPoints', () => {
  assert.equal(L.floorPoints(0), 100);          // plain placement
  assert.equal(L.floorPoints(1), 150);          // 1st perfect: 100 + 50*1
  assert.equal(L.floorPoints(3), 250);          // 100 + 50*3
});

test('finalScore = points x stability multiplier', () => {
  assert.equal(L.finalScore(1800, 87), 1566);
  assert.equal(L.finalScore(2200, 100), 2200);
  assert.equal(L.finalScore(1000, 61), 610);
  assert.equal(L.finalScore(0, 100), 0);
});

test('grade tiers', () => {
  assert.equal(L.grade(true, 100), 'A+');
  assert.equal(L.grade(true, 95), 'A+');
  assert.equal(L.grade(true, 94.9), 'A');
  assert.equal(L.grade(true, 85), 'A');
  assert.equal(L.grade(true, 84.9), 'B');
  assert.equal(L.grade(true, 70), 'B');
  assert.equal(L.grade(true, 69.9), 'C');
  assert.equal(L.grade(false, 99), 'SITE VISIT REQUIRED');
});

test('win messages at boundaries', () => {
  assert.match(L.winMessage(100), /Mr\. Architect/);
  assert.match(L.winMessage(99.2), /Show-off/);
  assert.match(L.winMessage(61), /far safer than your gaming skills/);
  assert.match(L.winMessage(70), /far safer than your gaming skills/);
  assert.match(L.winMessage(71), /Inspector/);
});

test('lose messages at boundaries', () => {
  assert.match(L.loseMessage(0), /ground floor/i);
  assert.match(L.loseMessage(3), /parking/);
  assert.match(L.loseMessage(11), /Halfway/);
  assert.match(L.loseMessage(21), /crown was watching/);
});

test('streetTier', () => {
  assert.equal(L.streetTier(0), 0);
  assert.equal(L.streetTier(5), 5);
  assert.equal(L.streetTier(22), 22);
});
```

- [ ] **Step 2: Run and verify FAIL**

Run: `node --test tests/` → expect `Cannot find module '../logic.js'`.

- [ ] **Step 3: Implement `logic.js`**

```js
/* PAGE 22 — pure game logic (scoring, grades, messages, street tier).
   Loaded in the browser BEFORE game.js (window.P22Logic) and require()-able in Node. */
(function (root) {
  'use strict';

  const FLOOR_PTS = 100;
  const PERFECT_BONUS = 50;

  function floorPoints(combo) {
    return FLOOR_PTS + (combo > 0 ? PERFECT_BONUS * combo : 0);
  }

  function finalScore(points, stability) {
    return Math.round(points * (stability / 100));
  }

  function grade(won, stability) {
    if (!won) return 'SITE VISIT REQUIRED';
    if (stability >= 95) return 'A+';
    if (stability >= 85) return 'A';
    if (stability >= 70) return 'B';
    return 'C';
  }

  const WIN_MSGS = [
    [100,  "We'd like to talk to you, Mr. Architect."],
    [95,   'Show-off. The penthouse is yours to brag about.'],
    [90,   'Smooth hands. The chandeliers barely swung.'],
    [85,   'Solid build. The residents are already moving in.'],
    [80,   '22 floors, minor heart attacks only.'],
    [75,   "The residents felt that. They're fine. Probably."],
    [71,   'Inspector squinted, then signed anyway.'],
    [0,    "Don't worry, our building is far safer than your gaming skills."],
  ];

  function winMessage(stability) {
    for (const [min, msg] of WIN_MSGS) if (stability >= min) return msg;
    return WIN_MSGS[WIN_MSGS.length - 1][1];
  }

  const LOSE_MSGS = [
    [21, 'So close, the crown was watching.'],
    [19, 'Two floors short. The penthouse weeps.'],
    [16, 'So high, so unstable. Just like the market.'],
    [13, 'Floor 15. The pigeons were starting to respect you.'],
    [10, 'Halfway! The view was just getting good.'],
    [7,  'A third of the way. The crane is judging you.'],
    [4,  'The watchman has seen taller piles of bricks.'],
    [2,  "Floor 3? Even the parking isn't done."],
    [0,  'The ground floor. Bold place to stop.'],
  ];

  function loseMessage(floors) {
    for (const [min, msg] of LOSE_MSGS) if (floors >= min) return msg;
    return LOSE_MSGS[LOSE_MSGS.length - 1][1];
  }

  // Street upgrades are keyed directly off floors placed (0..22).
  function streetTier(floorsPlaced) {
    return Math.max(0, Math.min(22, floorsPlaced | 0));
  }

  const api = { floorPoints, finalScore, grade, winMessage, loseMessage, streetTier,
                FLOOR_PTS, PERFECT_BONUS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.P22Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run and verify PASS** — `node --test tests/` → all pass.

- [ ] **Step 5: Load in browser** — in `index.html`, add `<script src="logic.js"></script>` immediately BEFORE the `game.js` script tag.

- [ ] **Step 6: Commit** — `git add logic.js tests/ index.html && git commit -m "feat: pure scoring/message/street-tier logic with node tests"`

---

### Task 2: Wire scoring into game.js (points, HUD, CFG)

**Files:**
- Modify: `game.js` — CFG block (~line 26), `Game` state (~249), `startGame` (~288), `resolvePlacement` (~433), `drawHUD` (~1296)

- [ ] **Step 1: CFG + state additions**

In `CFG` add:
```js
  PROJECT_URL: 'https://www.reneevdevelopers.com/',
```
In `Game` add fields: `points: 0, finalScore: 0, result: null` (result is set by Task 6).
In `startGame()` reset: `Game.points = 0; Game.finalScore = 0; Game.result = null;`

- [ ] **Step 2: Points in `resolvePlacement()`**

`Game.score = m.floor;` stays (floor counter). After the perfect/non-perfect if/else, add ONE line (combo already updated above it):
```js
  Game.points += P22Logic.floorPoints(Game.combo);
```
(Perfect branch increments combo first → bonus applies; miss resets combo to 0 → plain 100.)

- [ ] **Step 3: Running score in HUD**

In `drawHUD`, under the stability bar (top-right), add:
```js
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(243,234,217,0.85)';
  ctx.font = '700 11px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText('S C O R E', View.cssW - pad, pad + 34);
  ctx.font = '800 20px "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = COL.paper;
  ctx.fillText(Game.points.toLocaleString('en-IN'), View.cssW - pad, pad + 50);
  ctx.textAlign = 'left';
```
(Adjust y so it clears the stability % label — render and check.)

- [ ] **Step 4: Verify in browser** — play a few floors; score climbs 100/placement, 150+ on perfects. Screenshot HUD.

- [ ] **Step 5: Commit** — `git commit -am "feat: points scoring wired into gameplay + HUD"`

---

### Task 3: Realistic integrated pendulum physics

**Files:**
- Modify: `game.js` — CFG pendulum constants (~54-65), section 5 (`swingParams`/`trolleyX`/`stepPhysics`, lines 332-404), `spawnMovingFloor` (~314), `dropFloor` (~411), `drawMoving` (~1082)

- [ ] **Step 1: Replace pendulum constants in CFG**

Delete `SWING_AMP_MIN/MAX`, `SWING_OMEGA_MIN/MAX`, `TROLLEY_DRIFT`, `TROLLEY_OMEGA`. Add:
```js
  // Driven-pendulum physics (integrated; trolley motion drives the swing).
  PEND_G: 2600,            // matches fall gravity
  PEND_DAMP: 0.32,         // angular damping (keeps motion periodic, not chaotic)
  PEND_L_MIN: 100,         // cable length at floor 22 (shorter = faster)
  PEND_L_MAX: 150,         // cable length at floor 1
  TROLLEY_AMP_MIN: 52,     // trolley traverse half-range, floor 1
  TROLLEY_AMP_MAX: 96,     // floor 22  (already includes the 10%-easier pass)
  TROLLEY_W_MIN: 1.25,     // trolley angular speed rad/s, floor 1
  TROLLEY_W_MAX: 2.42,     // floor 22
  THETA_CLAMP: 1.0,        // |theta| hard cap (rad) — guarantees no blow-up
  THETA_DOT_CLAMP: 7.0,
```

- [ ] **Step 2: Replace section 5 functions**

```js
// Difficulty-scaled pendulum/trolley params for the current floor.
function pendParams(floor) {
  const t = (floor - 1) / (CFG.TOTAL_FLOORS - 1);
  const ease = t * t * (3 - 2 * t);
  return {
    L: CFG.PEND_L_MAX + (CFG.PEND_L_MIN - CFG.PEND_L_MAX) * ease,
    tAmp: CFG.TROLLEY_AMP_MIN + (CFG.TROLLEY_AMP_MAX - CFG.TROLLEY_AMP_MIN) * ease,
    tW: CFG.TROLLEY_W_MIN + (CFG.TROLLEY_W_MAX - CFG.TROLLEY_W_MIN) * ease,
  };
}

function trolleyX() {
  if (!Game.moving) return 0;
  const p = pendParams(Game.moving.floor);
  return Math.sin(Game.time * p.tW) * p.tAmp;
}
function trolleyVX() {
  const p = pendParams(Game.moving.floor);
  return Math.cos(Game.time * p.tW) * p.tAmp * p.tW;
}
function trolleyAX() {
  const p = pendParams(Game.moving.floor);
  return -Math.sin(Game.time * p.tW) * p.tAmp * p.tW * p.tW;
}
```

In `spawnMovingFloor()` add to the moving object: `theta: 0, thetaDot: 0, rot: 0, rotV: 0, prevX: 0, prevY: 0, prevRot: 0` and after creation seed `m.prevX = m.x; m.prevY = m.y;`. Also reset `Game.time = 0;` per floor so each floor's drive phase starts clean.

Replace the PLAYING branch of `stepPhysics` with the integrated pendulum:
```js
  if (Game.state === STATE.PLAYING) {
    Game.time += dt;
    const p = pendParams(m.floor);
    // theta'' = -(g/L)sin(theta) - c*theta' - (a_pivot/L)cos(theta)
    const thetaDD = -(CFG.PEND_G / p.L) * Math.sin(m.theta)
                    - CFG.PEND_DAMP * m.thetaDot
                    - (trolleyAX() / p.L) * Math.cos(m.theta);
    m.thetaDot += thetaDD * dt;
    m.thetaDot = Math.max(-CFG.THETA_DOT_CLAMP, Math.min(CFG.THETA_DOT_CLAMP, m.thetaDot));
    m.theta += m.thetaDot * dt;
    m.theta = Math.max(-CFG.THETA_CLAMP, Math.min(CFG.THETA_CLAMP, m.theta));

    m.prevX = m.x; m.prevY = m.y; m.prevRot = m.rot;
    const pivotX = trolleyX();
    const jibY = craneJibY();
    m.x = pivotX + p.L * Math.sin(m.theta);
    m.y = jibY + p.L * Math.cos(m.theta) - p.L + 40;
    m.rot = m.theta * 0.6;            // slab tilts with the cable
    m.vx = trolleyVX() + p.L * Math.cos(m.theta) * m.thetaDot; // true release velocity
  } else if (Game.state === STATE.DROPPING) {
    m.prevX = m.x; m.prevY = m.y; m.prevRot = m.rot;
    // ...existing fall integration stays...
    m.rot += m.rotV * dt;
    m.rotV *= Math.pow(0.5, dt * 4);   // self-rights a little while falling
```
Keep the rest of DROPPING (landing check, sudden-death) unchanged. Delete `swingParams` and `_prevSlabX`.

- [ ] **Step 3: `dropFloor()` release**

After the existing vx clamp add:
```js
  m.vy = Math.max(0, -p.L * Math.sin(m.theta) * m.thetaDot) * 0.3; // tiny vertical kick
  m.rotV = m.thetaDot * 0.5;
```
(Compute `const p = pendParams(m.floor);` locally. Keep swayAmp/Phase lines — they're harmless; the new rot replaces their visual job, so DELETE `m.swayAmp/swayPhase` uses in stepPhysics/drawMoving instead.)

- [ ] **Step 4: Tilted slab rendering + cable in `drawMoving`**

The cable must run pivot→hook along angle theta, and the slab block must be drawn rotated by `m.rot` about its hook point: wrap the existing slab draw in
```js
  ctx.save();
  ctx.translate(wx(rx), wy(ry));         // rx/ry = interpolated slab centre (Task 4)
  ctx.rotate(m.rot);
  // draw slab centred on origin (offset existing draw by -w/2, -h/2)
  ctx.restore();
```
Read the current `drawMoving`/`drawCrane` implementations first and keep the hook/cable visuals — just make the cable endpoint + slab angle follow theta.

- [ ] **Step 5: Render + tune.** Serve, play floors 1, 10, 22. The swing must feel like a real load: lag behind the trolley, overshoot, settle. If it drifts chaotic, raise `PEND_DAMP` (0.32→0.45). If too tame, raise `TROLLEY_AMP_MAX`/`TROLLEY_W_MAX` ~5%. Screenshot mid-swing at floor 1 and floor 20 — slab must be visibly tilted.

- [ ] **Step 6: Commit** — `git commit -am "feat: integrated driven-pendulum crane physics with slab tilt"`

---

### Task 4: Landing feel + render interpolation

**Files:**
- Modify: `game.js` — `tick` (~1747), `resolvePlacement` (~433), `updateFx` (~629), `wobbleAngle` (~619), `drawBlock` (~1066), `drawMoving` (~1082)

- [ ] **Step 1: Interpolation alpha**

In `tick()` after the accumulator loop: `View.alpha = _acc / CFG.DT;`
In `drawMoving`, use interpolated values:
```js
  const a = View.alpha || 0;
  const rx = m.prevX + (m.x - m.prevX) * a;
  const ry = m.prevY + (m.y - m.prevY) * a;
  const rrot = m.prevRot + (m.rot - m.prevRot) * a;
```
and draw with these instead of m.x/m.y/m.rot.

- [ ] **Step 2: Land FX state**

In `resolvePlacement()` right after `Game.blocks.push(...)`:
```js
  Game.landFx = { t: 0, rot: m.rot, mag: Math.min(1, absOff / (m.w * 0.25)) };
  Game.kick = { t: 0, amp: Math.min(0.018, 0.004 + absOff * 0.00035) };
```
In `updateFx(dt)`: `if (Game.landFx) Game.landFx.t += dt; if (Game.kick) Game.kick.t += dt;`
In `startGame()` reset both to `null`.

- [ ] **Step 3: Squash + settle wobble on the top block**

In `drawBlock(ctx, b)`, when `b` is the LAST block and `Game.landFx && Game.landFx.t < 0.7`:
```js
  const t = Game.landFx.t;
  const squash = t < 0.12 ? 1 - 0.06 * Math.sin(Math.PI * (t / 0.12)) : 1; // scaleY dip
  const rot = Game.landFx.rot * Math.exp(-t * 6) * Math.cos(t * 22);        // damped settle
  // apply: translate to block centre, rotate(rot), scale(1, squash), draw, restore
```

- [ ] **Step 4: Tower kick in `wobbleAngle()`**

Add to the returned angle:
```js
  let kick = 0;
  if (Game.kick && Game.kick.t < 1.2) {
    kick = Game.kick.amp * Math.sin(Game.kick.t * 16) * Math.exp(-Game.kick.t * 3.5);
  }
  return baseWobble + kick;
```
(Note: `wobbleAngle` currently returns 0 outside play states — keep that, kick included.)

- [ ] **Step 5: Render-verify** — drop one centred and one badly off-centre floor; watch squash, settle wobble, tower kick. Confirm 60fps in DevTools performance (mobile emulation, 4x CPU throttle: no frame > 16ms during normal play).

- [ ] **Step 6: Commit** — `git commit -am "feat: impact squash, settle wobble, tower kick, render interpolation"`

---

### Task 5: 10% easier tuning pass

**Files:**
- Modify: `game.js` CFG (~67-75)

- [ ] **Step 1: Apply numbers**
```js
  PERFECT_TOL: 10,        // was 9
  STAB_SAFE: 15.4,        // was 14
  STAB_DMG_SCALE: 56,     // was 62
```
(Trolley/pendulum ranges in Task 3 were already set ~10% under the old top-end feel.)

- [ ] **Step 2: Playtest calibration** — full run attempt: floors 1-5 should feel easy, 18-22 demanding but fair. A deliberate half-floor-width miss should cost ~15-20 stability.

- [ ] **Step 3: Commit** — `git commit -am "tune: 10% easier (tolerance, safe zone, damage)"`

---

### Task 6: Street progression tiers

**Files:**
- Modify: `game.js` — `initBackground` (~700), `drawGroundScene` (~808), `drawGreenery` (~867), `drawCars` (~906), `drawCar` (~926)

Tier source: `const tier = P22Logic.streetTier(Game.blocks.length);` computed once in `drawGroundScene` and passed down. Upgrades are CUMULATIVE by floors placed:

| Floors ≥ | Upgrade |
|---|---|
| 2 | 4th car joins; lane-dash alpha 0.55 → 0.85 |
| 4 | zebra crossing at x ≈ 0.18·W |
| 6 | cars become sedans (style 1) |
| 8 | streetlight poles (unlit) at x ≈ 0.08/0.5/0.92·W |
| 10 | streetlights ON: warm glow pools on the road |
| 12 | two extra trees + kerbside planters |
| 14 | cars become luxury (style 2) |
| 16 | 5th car; footpath bollards |
| 18 | lit "PAGE 22" hoarding board on the footpath |
| 20 | hoarding sparkle + parked premium black car in front |

- [ ] **Step 1: Car styles**

`drawCar(ctx, x, y, w, h, color, dir, style)`:
- style 0 (current code = hatchback): unchanged.
- style 1 sedan: body `w*1.15`, cabin lower (`ch = h*0.42`) and centred, add thin rocker line `rgba(255,255,255,0.10)` along the bottom.
- style 2 luxury: body `w*1.3`, height `h*0.9`, cabin long + raked, chrome line (`rgba(255,255,255,0.35)`, 1px) full length, brighter palette pick (`#1a1a22`, `#4a1f1f`, `#dcd7c9` rotate by car index).
In `drawCars`, only draw `BG.cars[i]` for `i < (tier >= 16 ? 5 : tier >= 2 ? 4 : 3)`; style = `tier >= 14 ? 2 : tier >= 6 ? 1 : 0`.

- [ ] **Step 2: Road furniture in `drawGroundScene`** (all sized via `wlen`, positioned off `groundScreenY`; draw between road and footpath layers)

Zebra (tier≥4): 5 paper-white bars `rgba(243,234,217,0.75)`, bar w `wlen(10)`, gap `wlen(8)`, spanning road height at `x = W*0.18`.
Streetlights (tier≥8): ink poles `wlen(4)` wide, `wlen(86)` tall from road top, curved arm (arcTo) + lamp head; if tier≥10 add radial-gradient glow ellipse on the road (`rgba(247,222,190,0.18)` → transparent, radius `wlen(60)`).
Planters (tier≥12): footpath boxes `wlen(26)×wlen(12)` terracotta `COL.terracotta` with green dome `#2c4a34`, at x = 0.3/0.7·W; plus 2 extra trees in `drawGreenery` (`treeXs` gains 0.22, 0.68 when tier≥12).
Bollards (tier≥16): 6 short ink posts `wlen(3)×wlen(10)` evenly spaced along the footpath edge.
Hoarding (tier≥18): board `wlen(150)×wlen(46)` on two legs on the footpath right side; paper fill, ink frame, text `PAGE 22` in `800 ${Math.max(8, wlen(16))}px Georgia` terracotta; if tier≥20 add 3 small 4-point sparkles (two crossed lines) twinkling via `0.5+0.5*Math.sin(Game.fxTime*3 + i*2)` alpha.
Parked car (tier≥20): style-2 car, color `#16161c`, parked (static x = W*0.62, near-lane y), drawn BEFORE moving cars.

- [ ] **Step 3: Render-verify** — temporarily set `Game.blocks.length` via console (`Game.blocks.push({})` × N is fine pre-play on a test run) or just play; screenshot street at floors 0, 6, 12, 20. Verify the end-of-game pull-back shows the full upgraded street. Check style consistency (flat editorial shapes, palette colours, nothing neon).

- [ ] **Step 4: Commit** — `git commit -am "feat: street levels up as the tower climbs (cars, lights, hoarding)"`

---

### Task 7: Finished-game result card (win + lose) with CTA

**Files:**
- Modify: `game.js` — `triggerLose` (~516), `beginWinSequence`/`stepWinSequence` (~529), `updateCamera` card heights (~594), DELETE `drawLoseScreen` + `drawWinOverlay` (~1473-1568), new `drawResultCard`, `render()` dispatch (~1571), `handlePrimaryAction` (~1620), `Buttons` (~1401), `drawButton` (~1403), `updateFx` (~629)

- [ ] **Step 1: Result state**

New helper:
```js
function makeResult(won) {
  const pts = Game.points;
  const stab = Game.stability;
  return {
    won,
    points: pts,
    stability: stab,
    final: P22Logic.finalScore(pts, stab),
    grade: P22Logic.grade(won, stab),
    message: won ? P22Logic.winMessage(stab) : P22Logic.loseMessage(Game.blocks.length),
    t: 0,
  };
}
```
`triggerLose()`: add `Game.result = makeResult(false); Game.finalScore = Game.result.final;`
`stepWinSequence` stage 2→3 transition (state → WIN_OVERLAY): add `Game.result = makeResult(true); Game.finalScore = Game.result.final;`
`updateFx`: `if (Game.result) Game.result.t += dt;`

- [ ] **Step 2: One card, both endings — `drawResultCard(ctx)`**

Replaces `drawLoseScreen` AND `drawWinOverlay` (delete both; `render()` calls `drawResultCard` for STATE.LOSE and STATE.WIN_OVERLAY). Card `w = Math.min(380, View.cssW - 32)`, `h = 360`, bottom-anchored. Update BOTH `cardH` usages in `updateCamera` to `360`.

Animation timeline off `r.t` (all eased, `easeOut = 1 - Math.pow(1 - p, 3)`):
- 0→0.28s: card slides up 60px + fades in (draw everything inside a translated/alpha'd group).
- Layout top→bottom (y offsets from card top): kicker (28), message (52, `500 14px Helvetica`, ink-soft, wrap to 2 lines max with simple split if `measureText` > w-60), score count-up (large `900 46px Georgia` terracotta, centred ~118): `shown = Math.round(r.final * easeOut(clamp((r.t - 0.3) / 0.9)))`, formatted `toLocaleString('en-IN')`; math line under it (`600 12px Helvetica`, ink 55%): `${r.points.toLocaleString('en-IN')} pts × ${(r.stability/100).toFixed(2)} stability`.
- Stability dial (centred ~205, radius 46): background arc 135°→405°, track `rgba(31,42,46,0.10)` lw 9; value arc same range × `dialP = easeOut(clamp((r.t-0.5)/0.8)) * r.stability/100`, colour `stabColor()`, butt caps; needle = ink line from centre to arc at dialP with 6% overshoot at p≈0.8 (`dialP * (1 + 0.06*Math.sin(Math.min(1,p)*Math.PI))`); centred % text inside.
- Grade stamp (right of dial, ~x = cardX + w - 78): appears at `r.t > 1.2`, scale `1.6→1` over 0.18s ease-out + rotation `-0.12rad`, double-ring circle (terracotta stroke lw 3 + inner lw 1), grade text `900 20px Georgia` (or `700 9px` two-line for SITE VISIT REQUIRED); play `AudioFX.thunk()` once when it lands (guard flag `r.stamped = true`).
- Kicker text: win `T O P P E D   O U T`, lose `S T A B I L I T Y   T O O   L O W`. Win keeps wordmark/`PAGE 22` block ABOVE the message (existing code from drawWinOverlay, compressed).
- Buttons (fade in at `r.t > 0.5`), both states:
```js
  Buttons.project = { x: cx - 150, y: cardY + h - 58, w: 176, h: 48 };
  Buttons.again   = { x: cx + 34,  y: cardY + h - 58, w: 116, h: 48 };
  drawButton(ctx, Buttons.project, 'CHECK OUT PAGE 22', true);
  drawButton(ctx, Buttons.again, r.won ? 'PLAY AGAIN' : 'TRY AGAIN', false);
```
Shrink button font to `800 13px` for the long label (make `drawButton` accept optional `fontPx`). Confetti still drawn over card on win (keep existing call order).

- [ ] **Step 3: Pressed states + CTA**

`Buttons.pressed = null;` On pointerdown over a button set `Buttons.pressed = {key, t: Game.fxTime}`; in `drawButton` scale rect 0.96 about centre + darken fill 8% while `Game.fxTime - t < 0.15`.
```js
function openProject() {
  const w = window.open(CFG.PROJECT_URL, '_blank', 'noopener');
  if (!w) location.href = CFG.PROJECT_URL;
}
```
`handlePrimaryAction`: for LOSE and WIN_OVERLAY states, hit-test `Buttons.project` → `openProject()`, `Buttons.again`/`retry` → `startGame()`. Remove the old enquire no-op. Keyboard (null px): keep restart behaviour. Delete `Buttons.enquire`/`Buttons.retry` keys (use `again` for both states).

- [ ] **Step 4: Start-screen + transition polish**

Start screen: on `startGame()` it just vanishes — add `Game.startFade` (0→1 over 0.25s in updateFx) and draw the start overlay with `alpha = 1 - ease(startFade)` for one last frame batch. Buttons everywhere get the pressed state from Step 3.

- [ ] **Step 5: Render-verify (webapp-testing skill)** — three full scenarios screenshotted: (a) win run (use a temporary `CFG.TOTAL_FLOORS = 3` hack DURING TESTING ONLY, revert before commit) with high stability → A+ stamp + Mr. Architect line; (b) barely-win → "far safer than your gaming skills"; (c) early lose at floor 3 → parking line + SITE VISIT REQUIRED stamp. Verify CTA opens reneevdevelopers.com in a new tab from both end states. Verify card animation runs smooth, count-up works, dial eases, no text overflow at 360×740 viewport.

- [ ] **Step 6: Commit** — `git commit -am "feat: finished-game result card with score count-up, stability dial, grade stamp, project CTA"`

---

### Task 8: Final QA pass

- [ ] **Step 1: `node --test tests/`** — all green.
- [ ] **Step 2: Full manual run on phone-size viewport (390×844 + 360×740):** complete win, mid lose, instant lose; tower NEVER shown falling; floors never trimmed; 60fps during play (DevTools perf, 4x throttle, no >16ms frames); CTA works win+lose; street fully upgraded on pull-back after a long run.
- [ ] **Step 3: Boundary spot-checks in console:** `P22Logic.winMessage(61)`, `P22Logic.winMessage(100)`, `P22Logic.grade(true, 94.9)`, `P22Logic.loseMessage(21)`.
- [ ] **Step 4: Commit any tuning deltas** — `git commit -am "polish: final tuning pass for v2"`
