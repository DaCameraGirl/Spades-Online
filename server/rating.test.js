const { test } = require('node:test');
const assert = require('node:assert/strict');
const { teamRating, applyMatchResult, eloDelta, expectedScore, K_FACTOR } = require('./rating');

test('K factor is 15', () => {
  assert.equal(K_FACTOR, 15);
});

test('team rating is the arithmetic mean of its two players', () => {
  assert.equal(teamRating(1500, 1600), 1550);
  assert.equal(teamRating(1560, 1560), 1560);
});

test('favorite wins normally: 1560 vs 2000, the 2000 team winning moves about +1/-1', () => {
  const { winnerDelta, loserDelta } = applyMatchResult(2000, 1560);
  assert.equal(winnerDelta, 1);
  assert.equal(loserDelta, -1);
});

test('underdog upset: 1560 vs 2000, the 1560 team winning moves about +14/-14', () => {
  const { winnerDelta, loserDelta } = applyMatchResult(1560, 2000);
  assert.equal(winnerDelta, 14);
  assert.equal(loserDelta, -14);
});

test('equal-rated teams: 1700 vs 1700, the winner moves about +8/-8', () => {
  const { winnerDelta, loserDelta } = applyMatchResult(1700, 1700);
  assert.equal(winnerDelta, 8);
  assert.equal(loserDelta, -8);
});

test('winner and loser deltas are always exact opposites, never independently rounded', () => {
  for (const [a, b] of [[1500, 1500], [1200, 1800], [999, 2200], [1650, 1651]]) {
    const { winnerDelta, loserDelta } = applyMatchResult(a, b);
    assert.equal(winnerDelta, -loserDelta);
  }
});

test('expectedScore is symmetric: expectedA + expectedB always equals 1', () => {
  assert.equal(expectedScore(1600, 1400) + expectedScore(1400, 1600), 1);
});

test('eloDelta only rounds the final result, not the expected-score math', () => {
  // 1700 vs 1700 win: raw delta is 15 * (1 - 0.5) = 7.5, rounds to 8.
  assert.equal(eloDelta(1700, 1700, 1), 8);
});
