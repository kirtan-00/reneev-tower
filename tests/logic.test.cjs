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
