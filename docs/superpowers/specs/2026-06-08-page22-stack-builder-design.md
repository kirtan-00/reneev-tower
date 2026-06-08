# PAGE 22 — Crane Stack-Builder (Design Spec)

**Date:** 2026-06-08
**Client:** Reneev — project **PAGE 22** (a 22-storey residential tower; "Page 22" = 22 floors)
**Purpose:** Browser promo game. Reference: CBC Kids *Stack Builder*. Stack all 22 floors of the
real building; land floor 22 → crown caps the tower + "Congratulations" logo reveal.

## Decisions (locked with Kirtan)
- **Assets:** real building render, floors cut from the photo. (DONE — see Asset Pipeline.)
- **Platform:** mobile-first portrait; also works desktop. Tap / click / spacebar to drop.
- **Fail model:** **true classic trim & shrink** — overhang slices off, blocks narrow over time.
- **Lives:** **1 life / sudden death** — a drop with zero overlap = game over.
- **Win payoff:** big logo + "Congratulations" reveal (logo art + project copy from Kirtan later).
- **Crane:** realistic — trolley on a jib, cable + hooked floor swings as a pendulum; released
  floor carries its horizontal velocity + sway, then gravity. Swing speed/amplitude **ramps** with
  height so the floor-22 reveal stays reachable.
- **Background:** chosen later; built as a single swappable slot.

## Tech
- Vanilla HTML5 Canvas + JS. No physics engine (custom trim mechanic + pendulum), no framework,
  no build step. Runs from a static server / opened file. Precedent: Palladium Cycle.
- Files: `index.html`, `game.js` (engine), `style.css`. Assets under `assets/`.
- Graceful fallback: if an image fails to load, draw a colored rect so the game still runs.

## Asset Pipeline (DONE)
Source: `assets/building-photos/page22_alpha.png` — Magnific cutout (sky+nature removed), white
background floodfilled to true transparency in-repo.
Sliced into `assets/floors/`:
- `floor_01.png` (bottom) … `floor_22.png` (top): canonical **602×93**, transparent-padded.
- `crown.png` 700×368 — winged roof + glass penthouse (decorative cap on win).
- `base.png` 1085×166 — podium + PAGE 22 gate (ground platform).
- `manifest.json` — dimensions + order. **This is the asset contract; engine builds against it.**
Verified by re-stacking all 24 pieces into the original tower (`building-photos/restack_check.png`).

## Game Loop
1. `base.png` sits on the ground, centred. Camera starts at the base.
2. Crane at top: jib + trolley + cable + the current floor slab hooked beneath, swinging (pendulum).
3. Player drops → floor falls with current horizontal velocity + residual sway, then gravity.
4. **Placement:** overlap with the slab below → overhang is sliced off (the offcut tumbles away);
   the slab + its photo crop **narrow to the overlap**. New floor spawns at the reduced width.
5. **Perfect drop** (within tolerance): no trim, combo++, small reward feel (sfx/flash). Optional
   tiny width regrant on a streak to keep runs alive.
6. **Sudden death:** zero overlap → floor falls past, game over screen + score + retry.
7. **Camera** scrolls up to keep the crane + current top in frame as the tower grows.
8. **Difficulty:** swing speed & amplitude increase with floor number.
9. **Win (floor 22 placed):** crane lifts away, `crown.png` caps the tower, camera pulls back to
   reveal the full tower, then "Congratulations" + big PAGE 22 / Reneev logo + (project copy TBD)
   + celebration (confetti). CTA button slot for later.

## HUD / Art Direction
- Editorial, handcrafted — NOT AI-default. Warm palette pulled from the render (beige / terracotta
  + petrol-ink / charcoal). No Claude-orange. Clean typographic "Floor X / 22" counter + combo.
- "Page 22" book/architectural motif welcome on menu + win screen.

## Out of scope (alpha)
- Final background image (placeholder sky/skyline for now).
- Final logo lockup + project copy + CTA target (placeholders wired, swappable).
- Sound design beyond simple synth/sfx hooks.
- Leaderboard / sharing / analytics.
