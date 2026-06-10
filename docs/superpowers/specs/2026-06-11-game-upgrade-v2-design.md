# PAGE 22 Game Upgrade v2 — Design

Date: 2026-06-11. Approved by Kirtan in session.

Upgrades the existing stack-builder (`game.js`, vanilla canvas, no libs) with realistic
physics, a polished finished-game end UI, blended scoring, tiered messages, a live
street-progression system, and a 10% easier tuning pass. No new files except this spec;
all work stays in `game.js` / `style.css` / `index.html`.

Hard rules that still apply:
- The client's building NEVER falls or collapses on screen. Loss = stability bar + copy only.
- Floors always place at full width, never trimmed.
- Mobile-first portrait; must stay smooth on mid-range phones.

## 1. Realistic crane pendulum physics

Replace the parametric swing (`theta = A*sin(omega*t)`, game.js `stepPhysics`) with an
integrated damped driven pendulum at the existing fixed timestep (DT = 1/120):

- State: `theta`, `thetaDot`. Semi-implicit Euler:
  `thetaDotDot = -(g/L)*sin(theta) - c*thetaDot - (trolleyAccelX/L)*cos(theta)`
- Pivot = trolley. Trolley moves with a smooth periodic traverse along the jib
  (position via sin, accel computed analytically) — the trolley motion *drives* the swing.
- Difficulty per floor ramps trolley traverse speed and shortens effective cable length L
  (shorter L = faster pendulum). Tune so motion stays periodic and readable, never chaotic.
  Calibrate so floor-22 difficulty ~= old SWING_AMP_MAX/OMEGA_MAX feel minus the 10% easing.
- The slab TILTS with the cable: draw rotated by `theta` (cable + hook + slab as one rotated unit).
- Release: slab inherits true velocity (tangential from `thetaDot` + trolley velocity),
  plus angular velocity -> slight rotation while falling.
- Landing: impact squash (scaleY dip ~6%, ~120ms, eased), 2–3 damped settle wobbles of the
  placed slab's rotation back to 0, and a small wobble impulse added to the existing tower
  `wobbleAngle()` system. Perfect drops get a crisper, smaller squash + flash (existing).
- Offcut/missed slabs keep rotating realistically while falling.

## 2. Smooth mobile pass

- Canvas backed at `devicePixelRatio` capped at 2 (verify `resizeCanvas` does this; fix if not).
- Render interpolation: keep previous+current physics state for the moving slab and lerp by
  accumulator alpha in `render()` so 120Hz physics looks glassy at any display rate.
- Camera easing stays exponential; add tiny ease-out overshoot when a floor lands.
- Buttons get pressed states (scale 0.96 + darken while pointer down).
- Screen transitions: result card slides up + fades in (~280ms cubic-out); start screen fades out.
- Score count-up and stability dial animate with rAF time, no allocations per frame.
- No per-frame object allocation in any new code (mirror existing fxTime patterns).

## 3. Scoring — points x stability multiplier

- Floor placed: +100.
- Perfect drop: bonus `50 * combo` (combo = consecutive perfects, existing counter).
- Running score shown in HUD (replaces floor-count-as-score; floor count stays visible as "FLOOR n/22").
- Final score = `round(points * (stability/100))`. Stability is 61–100 in practice (lose at <=60).
- Max possible points: 22*100 + 50*(1+2+...+22) = 2200 + 12650 = 14850 (all-perfect run); realistic
  good runs land ~2000–4000.
- End card shows the math: `POINTS x STABILITY = SCORE` e.g. `1,800 x 0.87 = 1,566`, animated count-up.
- `scoreProgress` (for street tiers + lose messages) = `floorsPlaced / 22` (clean 5% chunks ≈ ~1 floor each).

## 4. End screens — finished-game UI

ONE redesigned result-card component used by both win and lose (states differ in copy/stamp/buttons):

- Card slides up from bottom, paper texture panel (existing `panel()` style), drop shadow.
- Contents top->bottom: kicker line (TOPPED OUT / STABILITY TOO LOW), tier message (below),
  animated score count-up (large Georgia serif), score math line, animated stability dial
  (arc gauge, needle eases to final value, colored by `stabColor`), grade stamp, buttons.
- Grade stamp (rubber-stamp style, slight rotation, stamped-in scale animation):
  A+ (win, stab >= 95) / A (win, >= 85) / B (win, >= 70) / C (win, <= 69) / SITE VISIT REQUIRED (lose).
- Buttons (both states): primary `CHECK OUT PAGE 22` -> opens https://www.reneevdevelopers.com/
  (new tab, `CFG.PROJECT_URL`); secondary `TRY AGAIN` / `PLAY AGAIN`.
- Win keeps confetti + party music; ENQUIRE button is replaced by CHECK OUT PAGE 22.

### Message tiers

Win (by final stability):
| Stability | Message |
|---|---|
| 100 | We'd like to talk to you, Mr. Architect. |
| 95–99 | Show-off. The penthouse is yours to brag about. |
| 90–94 | Smooth hands. The chandeliers barely swung. |
| 85–89 | Solid build. The residents are already moving in. |
| 80–84 | 22 floors, minor heart attacks only. |
| 75–79 | The residents felt that. They're fine. Probably. |
| 71–74 | Inspector squinted, then signed anyway. |
| 61–70 | Don't worry — our building is far safer than your gaming skills. |

Lose (by floors placed — every ~5% chunk; 22 floors ≈ 1 floor per 4.5%):
| Floors | Message |
|---|---|
| 0–1 | The ground floor. Bold place to stop. |
| 2–3 | Floor 3? Even the parking isn't done. |
| 4–6 | The watchman has seen taller piles of bricks. |
| 7–9 | A third of the way. The crane is judging you. |
| 10–12 | Halfway! The view was just getting good. |
| 13–15 | Floor 15. The pigeons were starting to respect you. |
| 16–18 | So high, so unstable. Just like the market. |
| 19–20 | Two floors short. The penthouse weeps. |
| 21 | So close, the crown was watching. |

Copy rules: no em dashes overdone, playful Indian-builder humour, never imply the real
building is unsafe (jokes punch at the PLAYER, not the tower).

## 5. 10% easier

- `SWING_OMEGA_*` x0.9 (or trolley-speed equivalent in new physics)
- max swing energy/amplitude x0.9
- `PERFECT_TOL` 9 -> 10
- `STAB_SAFE` 14 -> 15.4
- `STAB_DMG_SCALE` 62 -> 56
- Recalibrate after physics swap so overall feel = "old game minus ~10% difficulty".

## 6. Street progression (live as you climb)

`streetTier = floor(scoreProgress * 20)` (0–20; ticks every 5% ≈ each floor). New tiers
apply to newly spawned/looping cars and static street furniture (redrawn each frame anyway).
Player glimpses changes during play; full payoff on the end-of-game camera pull-back.

Upgrade ladder (cumulative):
| Tier (floors) | Upgrade |
|---|---|
| 0 (start) | 3 basic hatchbacks, plain road, current trees |
| 2 | 4th car joins; lane dashes brighten |
| 4 | Zebra crossing appears at one end |
| 6 | Hatchbacks -> sedans (longer body, sleeker cabin) |
| 8 | Streetlight poles appear (unlit) |
| 10 | Streetlights switch ON (warm glow pools on road) |
| 12 | Extra trees + kerbside planters |
| 14 | Sedans -> luxury cars (lower, longer, brighter paint, chrome line) |
| 16 | 5th car; footpath gets clean paving + bollards |
| 18 | Lit "PAGE 22" hoarding board near the kerb |
| 20–22 | Hoarding sparkles; one premium black car parks in front (arrives, stops) |

All procedural canvas in `drawGroundScene`/`drawCars`/`drawGreenery` style; no new assets.

## Architecture / boundaries

- `Physics` (pendulum integration + release + settle) — pure functions of state + CFG.
- `Scoring` (points, multiplier, grade, message lookup) — pure; trivially testable in console.
- `StreetTiers` (tier from progress; draw helpers take tier param).
- `ResultCard` (single draw + animation state machine for win/lose).
- CFG gains: `PROJECT_URL`, physics constants, score constants, message tables live near CFG.

## Error handling

- `window.open` for CTA wrapped so popup-block failure falls back to location.href.
- Physics clamped: |theta| capped, thetaDot capped — guarantees no blow-up on tab-resume dt spikes
  (existing accumulator already clamps, verify).

## Testing / verification

- Console-test scoring math + message lookup at boundaries (60/61, 70/71, 100; floors 1,3,21).
- Play on desktop + phone-sized viewport: full run win, instant lose, mid lose.
- Verify 60fps via DevTools performance on mobile emulation; no long tasks > 16ms during play.
- Verify CTA opens reneevdevelopers.com from both end states.
- Verify the tower never visually falls in any state.
