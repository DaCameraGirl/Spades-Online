require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const openSockets = new Set();
let sharedServer;
let sharedPort;
let ownerAccount;
let regularAccount;
const createdPlayerIds = [];

function randomPort(base) {
  return base + Math.floor(Math.random() * 200);
}

function waitFor(socket, event, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const onEvent = (payload) => {
      let matches = false;
      try { matches = predicate(payload); } catch { matches = false; }
      if (!matches) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    };
    socket.on(event, onEvent);
  });
}

function waitState(getState, predicate, timeout = 5000, label = 'state') {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      let state;
      let matches = false;
      try {
        state = getState();
        matches = state != null && predicate(state);
      } catch { matches = false; }
      if (matches) return resolve(state);
      if (Date.now() - started > timeout) return reject(new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`));
      setTimeout(check, 20);
    };
    check();
  });
}

function neverFires(socket, event, timeout = 600) {
  return new Promise((resolve, reject) => {
    const onEvent = (payload) => {
      clearTimeout(timer);
      reject(new Error(`${event} unexpectedly fired: ${JSON.stringify(payload)}`));
    };
    socket.on(event, onEvent);
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      resolve();
    }, timeout);
  });
}

async function connect(port, token) {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { sessionToken: token },
  });
  openSockets.add(socket);
  await waitFor(socket, 'connect');
  return socket;
}

function closeSocket(socket) {
  if (!socket) return;
  openSockets.delete(socket);
  socket.close();
}

function createState(socket) {
  let latest = null;
  socket.on('roomState', (state) => { latest = state; });
  return () => latest;
}

async function startServer(port, extraEnv) {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      SPADES_DATA_FILE: path.join(require('node:os').tmpdir(), `owner-cmd-rooms-${port}.json`),
      SPADES_BOT_DELAY_MS: '20',
      SPADES_TRICK_PAUSE_MS: '20',
      SPADES_NEXT_HAND_MS: '100',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 8000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Spades server running')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited with ${code}`)); });
  });
  return child;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 1000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGKILL');
  });
}

async function signup(httpBase, prefix) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const res = await fetch(`${httpBase}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      screenName: `${prefix}${suffix}`,
      email: `${prefix}${suffix}@example.com`,
      password: 'correct-horse',
      passwordConfirm: 'correct-horse',
    }),
  });
  const json = await res.json();
  if (!json.player) throw new Error(`signup(${prefix}) failed: ${JSON.stringify(json)}`);
  createdPlayerIds.push(json.player.id);
  return json;
}

// Connection/array index and actual seat number are not the same thing,
// joinRoom calls race, seat assignment is whichever arrives first. Always
// resolve "who is seat N" from each socket's own isYou state, never assume
// sockets[N] landed in seat N.
function socketIndexForSeat(states, seat) {
  return states.findIndex((getState) => {
    const state = getState();
    const me = state && state.players.find((p) => p.isYou);
    return me && me.seat === seat;
  });
}

function playableCard(hand, game) {
  if (!hand || !hand.length) return null;
  if (!game.trick.length) {
    const nonSpade = hand.find((card) => card.suit !== 'Spades');
    return game.spadesBroken || !nonSpade ? hand[0] : nonSpade;
  }
  const follow = hand.find((card) => card.suit === game.leadSuit);
  return follow || hand[0];
}

// A throwaway owner account decided once, up front, then the server is
// started with SPADES_OWNER_PLAYER_ID pointing at it, mirroring exactly
// how this would be configured in production, just with test values.
before(async () => {
  const bootstrapPort = randomPort(4700);
  const bootstrapServer = await startServer(bootstrapPort, {});
  const bootstrapBase = `http://127.0.0.1:${bootstrapPort}`;
  ownerAccount = await signup(bootstrapBase, 'owner-');
  regularAccount = await signup(bootstrapBase, 'reg-');
  await stopServer(bootstrapServer);

  sharedPort = randomPort(4900);
  sharedServer = await startServer(sharedPort, { SPADES_OWNER_PLAYER_ID: ownerAccount.player.id });
});

after(async () => {
  for (const socket of [...openSockets]) closeSocket(socket);
  if (sharedServer) await stopServer(sharedServer);
  const { pool, query } = require('./db');
  if (createdPlayerIds.length) {
    await query('delete from rated_matches where team_a_player1 = any($1::uuid[]) or team_b_player1 = any($1::uuid[])', [createdPlayerIds]);
    await query('delete from players where id = any($1::uuid[])', [createdPlayerIds]);
  }
  await pool.end();
});

async function seatFourForOwnerTests(tableNumber) {
  const httpBase = `http://127.0.0.1:${sharedPort}`;
  const partner1 = await signup(httpBase, 'p1-');
  const partner2 = await signup(httpBase, 'p2-');
  const accounts = [ownerAccount, partner1, regularAccount, partner2];

  const sockets = await Promise.all(accounts.map((_, i) => connect(sharedPort, `owner-cmd-${tableNumber}-${i}`)));
  const states = sockets.map((socket) => createState(socket));

  sockets[0].emit('createRoom', { name: accounts[0].player.screenName, stake: 250, rankMode: 'ace', accountToken: accounts[0].token });
  const created = await waitFor(sockets[0], 'roomState', (payload) => payload.roomCode);
  const roomCode = created.roomCode;

  for (let i = 1; i < 4; i += 1) {
    sockets[i].emit('joinRoom', { code: roomCode, name: accounts[i].player.screenName, accountToken: accounts[i].token });
  }
  await Promise.all(states.map((getState) => waitState(getState, (state) => state.players.filter(Boolean).length === 4, 5000, 'all 4 seated')));

  sockets[0].emit('startGame', { roomCode });
  await Promise.all(states.map((getState) => waitState(getState, (state) => state.game && state.game.phase === 'bidding', 5000, 'first hand dealt')));

  return { accounts, sockets, states, roomCode };
}

test('a normal user cannot execute owner commands', async (t) => {
  const { sockets, states, roomCode } = await seatFourForOwnerTests(1);
  t.after(() => sockets.forEach(closeSocket));

  const before1 = states[2]();
  sockets[2].emit('ownerCommand', { roomCode, command: '/peek', accountToken: regularAccount.token });
  await neverFires(sockets[2], 'ownerCommandResult');
  await neverFires(sockets[2], 'ownerPeek');
  assert.deepEqual(states[2]().game.bids, before1.game.bids, 'no state changed');
});

test('spoofing the owner\'s screen name on your own account grants nothing, authorization is by UUID only', async (t) => {
  const { sockets, roomCode } = await seatFourForOwnerTests(2);
  t.after(() => sockets.forEach(closeSocket));

  sockets[2].emit('ownerCommand', {
    roomCode,
    command: '/peek',
    accountToken: regularAccount.token,
    name: ownerAccount.player.screenName,
    screenName: ownerAccount.player.screenName,
  });
  await neverFires(sockets[2], 'ownerCommandResult');
});

test('spoofing the owner\'s account id directly (not a real session token) grants nothing', async (t) => {
  const { sockets, roomCode } = await seatFourForOwnerTests(3);
  t.after(() => sockets.forEach(closeSocket));

  sockets[2].emit('ownerCommand', { roomCode, command: '/peek', accountToken: ownerAccount.player.id });
  await neverFires(sockets[2], 'ownerCommandResult');

  sockets[2].emit('ownerCommand', { roomCode, command: '/peek', accountToken: 'not-even-a-real-token' });
  await neverFires(sockets[2], 'ownerCommandResult');
});

test('the configured owner can execute /peek, and only the owner sees the hands', async (t) => {
  const { sockets, roomCode } = await seatFourForOwnerTests(4);
  t.after(() => sockets.forEach(closeSocket));

  const othersNeverPeeked = Promise.all([1, 2, 3].map((i) => neverFires(sockets[i], 'ownerPeek', 1500)));
  sockets[0].emit('ownerCommand', { roomCode, command: '/peek', accountToken: ownerAccount.token });
  const result = await waitFor(sockets[0], 'ownerCommandResult');
  const peek = await waitFor(sockets[0], 'ownerPeek');

  assert.equal(result.ok, true);
  assert.equal(Object.keys(peek.hands).length, 4, 'all four current hands revealed to the owner');
  await othersNeverPeeked;
});

test('/redeal preserves a valid 52-card deck with no duplicates', async (t) => {
  const { sockets, states, roomCode } = await seatFourForOwnerTests(5);
  t.after(() => sockets.forEach(closeSocket));

  sockets[0].emit('ownerCommand', { roomCode, command: '/redeal', accountToken: ownerAccount.token });
  const result = await waitFor(sockets[0], 'ownerCommandResult');
  assert.equal(result.ok, true);

  await waitState(states[0], (state) => state.players.find((p) => p.isYou).hand.length === 13, 3000, 'owner hand redealt');

  const peekPromise = waitFor(sockets[0], 'ownerPeek');
  sockets[0].emit('ownerCommand', { roomCode, command: '/peek', accountToken: ownerAccount.token });
  const peek = await peekPromise;
  const allCards = Object.values(peek.hands).flat();
  assert.equal(allCards.length, 52, 'exactly 52 cards across all four hands after redeal');
  const uniqueCodes = new Set(allCards.map((card) => card.code));
  assert.equal(uniqueCodes.size, 52, 'no duplicate cards after redeal');
});

test('/redeal is rejected once bidding has actually started', async (t) => {
  const { sockets, states, roomCode } = await seatFourForOwnerTests(6);
  t.after(() => sockets.forEach(closeSocket));

  const firstBidder = states[0]().game.currentSeat;
  const firstBidderSocket = socketIndexForSeat(states, firstBidder);
  sockets[firstBidderSocket].emit('viewHand', { roomCode });
  sockets[firstBidderSocket].emit('submitBid', { roomCode, bid: 3 });
  await waitState(states[0], (state) => state.game.bids[firstBidder] === 3, 3000, 'first bid landed');

  sockets[0].emit('ownerCommand', { roomCode, command: '/redeal', accountToken: ownerAccount.token });
  const result = await waitFor(sockets[0], 'ownerCommandResult');
  assert.equal(result.ok, false);
});

test('/oops undoes the owner\'s last card, but is rejected once the next player has already acted', async (t) => {
  const { sockets, states, roomCode } = await seatFourForOwnerTests(7);
  t.after(() => sockets.forEach(closeSocket));

  let bidState = states[0]();
  while (bidState.game.phase === 'bidding') {
    const seat = bidState.game.currentSeat;
    const socketIndex = socketIndexForSeat(states, seat);
    sockets[socketIndex].emit('viewHand', { roomCode });
    sockets[socketIndex].emit('submitBid', { roomCode, bid: 2 });
    bidState = await waitState(states[0], (payload) => payload.game.phase === 'playing' || payload.game.currentSeat !== seat, 5000, 'bid progress');
  }
  await Promise.all(states.map((getState) => waitState(getState, (state) => state.game.phase === 'playing', 5000, 'playing phase')));

  // /oops only needs the owner's card to not be the 4th, trick-completing
  // one, it does not need to be the trick's first card. Trick 1 always has
  // the owner (the dealer here) playing exactly 4th (fixed by dealer
  // rotation, not by who wins), but the dealer advances every hand
  // regardless of trick outcomes, so hand 2's rotation already puts the
  // owner somewhere other than last. No need to depend on winning a trick.
  let state = states[0]();
  let safety = 0;
  while (!(state.game.phase === 'playing' && state.game.currentSeat === 0 && state.game.trick.length < 3) && safety < 400) {
    safety += 1;
    if (state.game.phase === 'bidding') {
      const seat = state.game.currentSeat;
      const socketIndex = socketIndexForSeat(states, seat);
      sockets[socketIndex].emit('viewHand', { roomCode });
    sockets[socketIndex].emit('submitBid', { roomCode, bid: 2 });
      state = await waitState(states[0], (payload) => payload.game.currentSeat !== seat || payload.game.phase === 'playing', 5000, 'bid progress');
      continue;
    }
    const seat = state.game.currentSeat;
    if (seat === 0 && state.game.trick.length < 3) break;
    const socketIndex = socketIndexForSeat(states, seat);
    const me = states[socketIndex]().players.find((p) => p.isYou);
    const card = playableCard(me.hand, state.game);
    if (!card) break;
    const trickLenBefore = state.game.trick.length;
    sockets[socketIndex].emit('playCard', { roomCode, cardCode: card.code });
    // waitState checks the (possibly stale, pre-response) cached state
    // synchronously on its first tick, so a target value that could already
    // be true before this play even lands (like "trick.length === 0", true
    // of any state right before someone leads) resolves instantly on stale
    // data. A single play always changes trick.length by exactly one or
    // resets it, so "differs from its captured before-value" is the one
    // signal that can't spuriously already be true.
    state = await waitState(states[0], (payload) => (
      payload.game.trick.length !== trickLenBefore || payload.game.phase === 'bidding'
    ), 5000, 'trick progress');
  }
  assert.equal(state.game.phase, 'playing', 'reached the playing phase');
  assert.equal(state.game.currentSeat, 0, "reached the owner's turn");
  assert.ok(state.game.trick.length < 3, "owner's card will not be the trick-completing 4th one");

  const ownerHandBefore = states[0]().players.find((p) => p.isYou).hand.length;
  const ownerCard = playableCard(states[0]().players.find((p) => p.isYou).hand, states[0]().game);
  sockets[0].emit('playCard', { roomCode, cardCode: ownerCard.code });
  await waitState(states[0], (payload) => payload.players.find((p) => p.isYou).hand.length === ownerHandBefore - 1, 3000, 'owner card played');

  sockets[0].emit('ownerCommand', { roomCode, command: '/oops', accountToken: ownerAccount.token });
  const undoResult = await waitFor(sockets[0], 'ownerCommandResult');
  assert.equal(undoResult.ok, true, 'undo succeeds, nobody has acted since the owner led');
  await waitState(states[0], (payload) => payload.players.find((p) => p.isYou).hand.length === ownerHandBefore, 3000, 'card restored');
  assert.equal(states[0]().game.currentSeat, 0, 'turn returned to the owner');

  const nextSeat = 1;
  const nextSocketIndex = socketIndexForSeat(states, nextSeat);
  const ownerCard2 = playableCard(states[0]().players.find((p) => p.isYou).hand, states[0]().game);
  sockets[0].emit('playCard', { roomCode, cardCode: ownerCard2.code });
  await waitState(states[nextSocketIndex], (payload) => payload.game.currentSeat === nextSeat, 3000, 'turn moved on');
  const nextCard = playableCard(states[nextSocketIndex]().players.find((p) => p.isYou).hand, states[nextSocketIndex]().game);
  sockets[nextSocketIndex].emit('playCard', { roomCode, cardCode: nextCard.code });
  await waitState(states[0], (payload) => payload.game.currentSeat !== nextSeat, 3000, 'next player acted');

  sockets[0].emit('ownerCommand', { roomCode, command: '/oops', accountToken: ownerAccount.token });
  const tooLate = await waitFor(sockets[0], 'ownerCommandResult');
  assert.equal(tooLate.ok, false, 'undo rejected once the next player has already acted');
});

test('/blessme still produces a legal 13-card hand and a valid 52-card deck', async (t) => {
  const { sockets, states, roomCode } = await seatFourForOwnerTests(8);
  t.after(() => sockets.forEach(closeSocket));

  sockets[0].emit('ownerCommand', { roomCode, command: '/blessme', accountToken: ownerAccount.token });
  const result = await waitFor(sockets[0], 'ownerCommandResult');
  assert.equal(result.ok, true);

  const ownerHand = await waitState(states[0], (state) => state.players.find((p) => p.isYou).hand.length === 13, 3000, 'owner hand updated');
  const myHand = ownerHand.players.find((p) => p.isYou).hand;
  assert.equal(myHand.length, 13);
  assert.equal(new Set(myHand.map((c) => c.code)).size, 13, 'no duplicates within the blessed hand');

  const peekPromise = waitFor(sockets[0], 'ownerPeek');
  sockets[0].emit('ownerCommand', { roomCode, command: '/peek', accountToken: ownerAccount.token });
  const peek = await peekPromise;
  const allCards = Object.values(peek.hands).flat();
  assert.equal(allCards.length, 52);
  assert.equal(new Set(allCards.map((c) => c.code)).size, 52, 'no duplicates across the whole deck after blessing');
});

test('gameplay-affecting commands permanently mark the match unrated (cheatsUsed), cosmetic ones do not', async (t) => {
  const { sockets, states, roomCode } = await seatFourForOwnerTests(9);
  t.after(() => sockets.forEach(closeSocket));

  assert.equal(states[0]().game.cheatsUsed, false, 'starts rated');

  sockets[0].emit('ownerCommand', { roomCode, command: '/crown', accountToken: ownerAccount.token });
  await waitFor(sockets[0], 'ownerCommandResult');
  assert.equal(states[0]().game.cheatsUsed, false, '/crown is cosmetic, does not unrate');

  sockets[0].emit('ownerCommand', { roomCode, command: '/confetti', accountToken: ownerAccount.token });
  await waitFor(sockets[0], 'ownerCommandResult');
  assert.equal(states[0]().game.cheatsUsed, false, '/confetti is cosmetic, does not unrate');

  sockets[0].emit('ownerCommand', { roomCode, command: '/peek', accountToken: ownerAccount.token });
  const peekResult = await waitFor(sockets[0], 'ownerCommandResult');
  assert.equal(peekResult.message.includes('unranked test mode'), true, 'owner is explicitly told the match just converted');
  await waitState(states[0], (state) => state.game.cheatsUsed === true, 10000, 'match permanently unrated after a gameplay-affecting command');
});

test('a match with cheatsUsed never awards Elo or permanent stats, even with 4 authenticated humans', async (t) => {
  const { query } = require('./db');

  const { accounts, sockets, states, roomCode } = await seatFourForOwnerTests(10);
  t.after(() => sockets.forEach(closeSocket));

  sockets[0].emit('ownerCommand', { roomCode, command: '/peek', accountToken: ownerAccount.token });
  await waitFor(sockets[0], 'ownerCommandResult');
  // The owner-command handler does a real DB session lookup before doing
  // anything else, under heavy concurrent test-suite load against a
  // free-tier connection pooler that can genuinely take a few seconds,
  // not a sign anything is broken.
  await waitState(states[0], (state) => state.game.cheatsUsed === true, 10000, 'unrated now');

  let matchOver = false;
  let safety = 0;
  while (!matchOver && safety < 2000) {
    safety += 1;
    for (let seat = 0; seat < 4; seat += 1) {
      const state = states[seat]();
      if (!state || !state.game) continue;
      if (state.game.matchOver) { matchOver = true; break; }
      const me = state.players.find((p) => p.isYou);
      if (!me) continue;
      if (state.game.phase === 'bidding' && state.game.currentSeat === me.seat && me.bid == null) {
        sockets[seat].emit('viewHand', { roomCode });
        sockets[seat].emit('submitBid', { roomCode, bid: 3 });
      } else if (state.game.phase === 'playing' && !state.game.resolving && state.game.currentSeat === me.seat) {
        const card = playableCard(me.hand, state.game);
        if (card) sockets[seat].emit('playCard', { roomCode, cardCode: card.code });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.equal(matchOver, true);

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const playersAfter = await query(
    'select games_played as "gamesPlayed", elo_rating as "eloRating" from players where id = any($1::uuid[])',
    [accounts.map((a) => a.player.id)],
  );
  playersAfter.rows.forEach((row) => {
    assert.equal(row.gamesPlayed, 0, 'a cheats-used match never counts as a game played');
    assert.equal(row.eloRating, 1500, 'a cheats-used match never touches Elo');
  });

  const ratedRows = await query(
    'select 1 from rated_matches where team_a_player1 = any($1::uuid[]) or team_a_player2 = any($1::uuid[]) or team_b_player1 = any($1::uuid[]) or team_b_player2 = any($1::uuid[])',
    [accounts.map((a) => a.player.id)],
  );
  assert.equal(ratedRows.rowCount, 0, 'a cheats-used match never appears in rated match history');
});

