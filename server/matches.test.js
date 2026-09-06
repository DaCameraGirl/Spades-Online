require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool, query } = require('./db');
const { recordRatedMatch } = require('./matches');

const createdPlayerIds = [];

async function makePlayer(elo = 1500) {
  const result = await query(
    `insert into players (screen_name, email, password_hash, elo_rating, highest_rating)
     values ($1, $2, 'test-hash', $3, $3)
     returning id`,
    [`match-test-${crypto.randomBytes(4).toString('hex')}`, `${crypto.randomBytes(4).toString('hex')}@example.com`, elo],
  );
  const id = result.rows[0].id;
  createdPlayerIds.push(id);
  return id;
}

async function getPlayer(id) {
  const result = await query(
    'select elo_rating as "eloRating", highest_rating as "highestRating", wins, losses, games_played as "gamesPlayed" from players where id = $1',
    [id],
  );
  return result.rows[0];
}

after(async () => {
  if (createdPlayerIds.length) {
    await query('delete from rated_matches where team_a_player1 = any($1::uuid[]) or team_b_player1 = any($1::uuid[])', [createdPlayerIds]);
    await query('delete from players where id = any($1::uuid[])', [createdPlayerIds]);
  }
  await pool.end();
});

test('recordRatedMatch: applies the exact tested Elo formula and updates both teams atomically', async () => {
  const a1 = await makePlayer(1560);
  const a2 = await makePlayer(1560);
  const b1 = await makePlayer(2000);
  const b2 = await makePlayer(2000);

  const result = await recordRatedMatch({
    idempotencyKey: crypto.randomUUID(),
    teamAPlayerIds: [a1, a2],
    teamBPlayerIds: [b1, b2],
    winningTeam: 'B',
  });

  assert.equal(result.applied, true);
  assert.equal(result.winnerDelta, 1, 'favorite (2000) beating an underdog (1560) moves about +1');
  assert.equal(result.loserDelta, -1);

  const winnerA = await getPlayer(b1);
  const winnerB = await getPlayer(b2);
  const loserA = await getPlayer(a1);
  const loserB = await getPlayer(a2);

  assert.equal(winnerA.eloRating, 2001);
  assert.equal(winnerB.eloRating, 2001);
  assert.equal(winnerA.wins, 1);
  assert.equal(winnerA.losses, 0);
  assert.equal(winnerA.gamesPlayed, 1);
  assert.equal(winnerA.highestRating, 2001, 'highest_rating tracks the new peak');

  assert.equal(loserA.eloRating, 1559);
  assert.equal(loserB.eloRating, 1559);
  assert.equal(loserA.wins, 0);
  assert.equal(loserA.losses, 1);
  assert.equal(loserA.highestRating, 1560, 'highest_rating does not fall when the rating drops');
});

test('recordRatedMatch: an upset moves the delta by the tested amount, +14/-14', async () => {
  const a1 = await makePlayer(1560);
  const a2 = await makePlayer(1560);
  const b1 = await makePlayer(2000);
  const b2 = await makePlayer(2000);

  const result = await recordRatedMatch({
    idempotencyKey: crypto.randomUUID(),
    teamAPlayerIds: [a1, a2],
    teamBPlayerIds: [b1, b2],
    winningTeam: 'A',
  });

  assert.equal(result.winnerDelta, 14);
  assert.equal(result.loserDelta, -14);
});

test('recordRatedMatch: idempotent, calling twice with the same match id only applies once', async () => {
  const a1 = await makePlayer(1500);
  const a2 = await makePlayer(1500);
  const b1 = await makePlayer(1500);
  const b2 = await makePlayer(1500);
  const idempotencyKey = crypto.randomUUID();

  const first = await recordRatedMatch({ idempotencyKey, teamAPlayerIds: [a1, a2], teamBPlayerIds: [b1, b2], winningTeam: 'A' });
  const second = await recordRatedMatch({ idempotencyKey, teamAPlayerIds: [a1, a2], teamBPlayerIds: [b1, b2], winningTeam: 'A' });

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'already_recorded');

  const winner = await getPlayer(a1);
  assert.equal(winner.gamesPlayed, 1, 'the second call did not double-apply the rating change');
  assert.equal(winner.wins, 1);
});

test('recordRatedMatch: two different matches for the same players both apply, zero-sum holds each time', async () => {
  const a1 = await makePlayer(1500);
  const a2 = await makePlayer(1500);
  const b1 = await makePlayer(1500);
  const b2 = await makePlayer(1500);

  await recordRatedMatch({ idempotencyKey: crypto.randomUUID(), teamAPlayerIds: [a1, a2], teamBPlayerIds: [b1, b2], winningTeam: 'A' });
  const winnerAfterFirst = await getPlayer(a1);
  assert.equal(winnerAfterFirst.eloRating, 1508);

  await recordRatedMatch({ idempotencyKey: crypto.randomUUID(), teamAPlayerIds: [a1, a2], teamBPlayerIds: [b1, b2], winningTeam: 'B' });
  const a1AfterSecond = await getPlayer(a1);
  const b1AfterSecond = await getPlayer(b1);
  assert.equal(a1AfterSecond.gamesPlayed, 2);
  assert.equal(a1AfterSecond.wins, 1);
  assert.equal(a1AfterSecond.losses, 1);
  assert.equal(b1AfterSecond.gamesPlayed, 2);
});
