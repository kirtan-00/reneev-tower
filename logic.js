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
