require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const createdPlayerIds = [];
let sharedServer;
let sharedPort;
let db;

function uniqueName(prefix) {
  return `${prefix}${crypto.randomBytes(4).toString('hex')}`;
}

function randomPort(base) {
  return base + Math.floor(Math.random() * 200);
}

async function startServer(port) {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 8000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Spades server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}`));
    });
  });
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 1000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGKILL');
  });
}

async function signup(base, overrides = {}) {
  const body = {
    screenName: uniqueName('auth-test-'),
    email: `${uniqueName('auth-test-')}@example.com`,
    password: 'correct-horse',
    passwordConfirm: 'correct-horse',
    ...overrides,
  };
  const res = await fetch(`${base}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.player) createdPlayerIds.push(json.player.id);
  return { status: res.status, json, body };
}

before(async () => {
  db = require('./db');
  sharedPort = randomPort(4300);
  sharedServer = await startServer(sharedPort);
});

after(async () => {
  await stopServer(sharedServer);
  if (createdPlayerIds.length) {
    await db.query('delete from players where id = any($1::uuid[])', [createdPlayerIds]);
  }
  await db.pool.end();
});

test('signup: creates an account and returns a session token', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const { status, json, body } = await signup(base);
  assert.equal(status, 200);
  assert.ok(json.token);
  assert.equal(json.player.screenName, body.screenName);
  assert.equal(json.player.eloRating, 1500, 'new accounts start at 1500');
  assert.equal(json.player.wins, 0);
  assert.equal(json.player.losses, 0);
});

test('signup: rejects a duplicate screen name', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const first = await signup(base);
  const second = await signup(base, { screenName: first.body.screenName });
  assert.equal(second.status, 400);
  assert.equal(second.json.error, 'screen_name_taken');
});

test('signup: rejects a duplicate email', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const first = await signup(base);
  const second = await signup(base, { email: first.body.email });
  assert.equal(second.status, 400);
  assert.equal(second.json.error, 'email_taken');
});

test('signup: rejects mismatched password confirmation', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const res = await fetch(`${base}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      screenName: uniqueName('auth-test-'),
      email: `${uniqueName('auth-test-')}@example.com`,
      password: 'correct-horse',
      passwordConfirm: 'different',
    }),
  });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'password_mismatch');
});

test('login: succeeds with the right password and fails with the wrong one', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const { body } = await signup(base);

  const good = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
  });
  assert.equal(good.status, 200);
  const goodJson = await good.json();
  assert.ok(goodJson.token);

  const bad = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: 'wrong-password' }),
  });
  assert.equal(bad.status, 401);
  const badJson = await bad.json();
  assert.equal(badJson.error, 'invalid_credentials');
});

test('session persistence: a session token keeps working across separate requests, and survives what a page refresh would do', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const { json } = await signup(base);

  const me1 = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${json.token}` } });
  assert.equal(me1.status, 200);
  const me2 = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${json.token}` } });
  assert.equal(me2.status, 200);
  const me2Json = await me2.json();
  assert.equal(me2Json.player.id, json.player.id);
});

test('session persistence: a session survives an actual server process restart, not just repeated requests to the same process', async () => {
  const base1 = `http://127.0.0.1:${sharedPort}`;
  const { json } = await signup(base1);

  const restartedPort = randomPort(4600);
  const restartedServer = await startServer(restartedPort);
  try {
    const base2 = `http://127.0.0.1:${restartedPort}`;
    const me = await fetch(`${base2}/api/me`, { headers: { Authorization: `Bearer ${json.token}` } });
    assert.equal(me.status, 200, 'the session token, issued by one process, is honored by a brand new process because it is stored in Postgres, not server memory');
    const meJson = await me.json();
    assert.equal(meJson.player.id, json.player.id);
  } finally {
    await stopServer(restartedServer);
  }
});

test('logout: invalidates the session token', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const { json } = await signup(base);

  await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${json.token}` },
  });

  const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${json.token}` } });
  assert.equal(me.status, 401);
});

test('a saved Elo/stats value loads back correctly through /api/me', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const { json } = await signup(base);

  await db.query(
    'update players set elo_rating = $1, highest_rating = $2, wins = $3, losses = $4, games_played = $5 where id = $6',
    [1620, 1650, 4, 2, 6, json.player.id],
  );

  const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${json.token}` } });
  const meJson = await me.json();
  assert.equal(meJson.player.eloRating, 1620);
  assert.equal(meJson.player.highestRating, 1650);
  assert.equal(meJson.player.wins, 4);
  assert.equal(meJson.player.losses, 2);
  assert.equal(meJson.player.gamesPlayed, 6);
});

test('privacy: there is no endpoint that leaks another player\'s rating just by knowing their screen name', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  const { json } = await signup(base);

  const guesses = [
    `/api/player/${json.player.screenName}`,
    `/api/players/${json.player.screenName}`,
    `/api/player-by-name/${json.player.screenName}`,
    `/api/users/${json.player.screenName}`,
  ];
  for (const pathname of guesses) {
    const res = await fetch(`${base}${pathname}`);
    // The app has a catch-all SPA route that returns the HTML shell (200)
    // for anything unmatched, so a bare status check isn't meaningful here,
    // what matters is that no route actually returns player JSON.
    const contentType = res.headers.get('content-type') || '';
    assert.ok(!contentType.includes('application/json'), `${pathname} should not return JSON`);
  }
});

test('leaderboard: returns screen names and ratings only, no email or password fields', async () => {
  const base = `http://127.0.0.1:${sharedPort}`;
  await signup(base);

  const res = await fetch(`${base}/api/leaderboard?limit=5`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.leaderboard));
  json.leaderboard.forEach((entry) => {
    assert.ok('screenName' in entry);
    assert.ok('eloRating' in entry);
    assert.ok(!('email' in entry));
    assert.ok(!('passwordHash' in entry));
    assert.ok(!('password_hash' in entry));
  });
});
