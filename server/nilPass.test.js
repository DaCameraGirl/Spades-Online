require('dotenv').config();
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const openSockets = new Set();
let sharedServer;
let sharedPort;
let sharedDataDir;

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
      setTimeout(check, 10);
    };
    check();
  });
}

function randomPort(base) {
  return base + Math.floor(Math.random() * 200);
}

async function startServer(dataFile, port, extraEnv = {}) {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      SPADES_DATA_FILE: dataFile,
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

async function seatFourHumans(port, tokens) {
  const sockets = [];
  const states = [];

  const host = await connect(port, tokens[0]);
  sockets.push(host);
  states.push(createState(host));
  host.emit('createRoom', { name: 'Host', stake: 250, rankMode: 'ace' });
  const created = await waitFor(host, 'roomState', (payload) => payload.roomCode);
  const roomCode = created.roomCode;

  for (let index = 1; index < tokens.length; index += 1) {
    const client = await connect(port, tokens[index]);
    sockets.push(client);
    states.push(createState(client));
    client.emit('joinRoom', { code: roomCode, name: `Player ${index + 1}` });
    await waitFor(client, 'roomState', (payload) => payload.players.filter(Boolean).length === index + 1);
  }

  return { sockets, states, roomCode };
}

before(async () => {
  sharedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spades-nilpass-'));
  sharedPort = randomPort(4600);
  // Default Blind Nil threshold (150), so nobody starts this deficit-free
  // match eligible for it, hands auto-reveal normally and sighted Nil is
  // reachable without an extra viewHand round trip.
  sharedServer = await startServer(path.join(sharedDataDir, 'rooms.json'), sharedPort, {});
});

after(async () => {
  for (const socket of [...openSockets]) closeSocket(socket);
  if (sharedServer) await stopServer(sharedServer);
});

test('sighted nil: a 1-for-1 card exchange moves real cards between the bidder and partner, then play starts', async (t) => {
  const tokens = ['nilpass-1', 'nilpass-2', 'nilpass-3', 'nilpass-4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  sockets[0].emit('startGame', { roomCode });
  const bidding = await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');
  const nilSeat = bidding.game.currentSeat;
  const partnerSeat = (nilSeat + 2) % 4;

  const nilCardBefore = states[nilSeat]().players[nilSeat].hand[0];
  sockets[nilSeat].emit('submitBid', { roomCode, bid: 0 });

  const exchangeStarted = await waitState(states[nilSeat], (state) => state.game.nilExchange, 3000, 'exchange started');
  assert.equal(exchangeStarted.game.nilExchange.partnerSeat, partnerSeat);
  assert.equal(exchangeStarted.game.nilExchange.count, 1);
  assert.equal(exchangeStarted.game.nilExchange.nilGiven, null);

  sockets[nilSeat].emit('submitNilPassCards', { roomCode, cardCodes: [nilCardBefore.code] });
  const partnerSees = await waitState(states[partnerSeat], (state) => state.game.nilExchange && state.game.nilExchange.nilGiven, 3000, "partner sees the passed card");
  assert.equal(partnerSees.players[partnerSeat].hand.length, 14, 'partner temporarily holds 14 cards mid-exchange');
  assert.ok(partnerSees.players[partnerSeat].hand.some((card) => card.code === nilCardBefore.code), "the exact passed card landed in partner's hand");

  const partnerCardBack = partnerSees.players[partnerSeat].hand.find((card) => card.code !== nilCardBefore.code);
  sockets[partnerSeat].emit('submitNilReturnCards', { roomCode, cardCodes: [partnerCardBack.code] });

  const settled = await waitState(states[nilSeat], (state) => state.game.nilExchange === null, 3000, 'exchange settled');
  const partnerSettled = await waitState(states[partnerSeat], (state) => state.players[partnerSeat].hand.length === 13, 3000, 'partner settled at 13');
  assert.equal(settled.players[nilSeat].hand.length, 13);
  assert.equal(partnerSettled.players[partnerSeat].hand.length, 13);
  assert.ok(settled.players[nilSeat].hand.some((card) => card.code === partnerCardBack.code), "the returned card landed in the nil bidder's hand");
  assert.ok(!settled.players[nilSeat].hand.some((card) => card.code === nilCardBefore.code), 'the passed-away card is gone from the nil bidder');

  const others = [1, 2, 3].map((offset) => (nilSeat + offset) % 4);
  for (const seat of others) {
    const upNext = await waitState(states[seat], (state) => state.game.phase === 'bidding' && state.game.currentSeat === seat, 3000, `seat ${seat}'s bid turn`);
    if (upNext.players[seat].bid == null) {
      sockets[seat].emit('submitBid', { roomCode, bid: 2 });
    }
  }
  await waitState(states[0], (state) => state.game.phase === 'playing', 5000, 'play begins once bidding and the pass both finish');
});

test('blind nil: a 2-for-2 exchange lets the bidder pick blind by card position, hand stays hidden until they commit', async (t) => {
  const tokens = ['nilpass-blind-1', 'nilpass-blind-2', 'nilpass-blind-3', 'nilpass-blind-4'];
  const port = randomPort(4800);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spades-nilpass-blind-'));
  const server = await startServer(path.join(dataDir, 'rooms.json'), port, { SPADES_BLIND_NIL_MIN_DEFICIT: '0' });
  t.after(() => stopServer(server));

  const { sockets, states, roomCode } = await seatFourHumans(port, tokens);
  t.after(() => sockets.forEach(closeSocket));

  sockets[0].emit('startGame', { roomCode });
  const bidding = await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');
  const nilSeat = bidding.game.currentSeat;
  const partnerSeat = (nilSeat + 2) % 4;

  assert.equal(states[nilSeat]().players[nilSeat].hand.length, 0, 'not revealed yet, hand contents are hidden');
  assert.equal(states[nilSeat]().players[nilSeat].handCount, 13, 'but the count is always visible so a blind pick is possible');

  sockets[nilSeat].emit('submitBlindNil', { roomCode });
  const exchangeStarted = await waitState(states[nilSeat], (state) => state.game.nilExchange, 3000, 'blind exchange started');
  assert.equal(exchangeStarted.game.nilExchange.count, 2);
  assert.equal(exchangeStarted.players[nilSeat].handRevealed, false, 'still hidden, the blind pass has not been made yet');

  sockets[nilSeat].emit('submitBlindNilPassCards', { roomCode, cardIndexes: [0, 1] });
  const revealed = await waitState(states[nilSeat], (state) => state.players[nilSeat].handRevealed === true, 3000, 'revealed after committing the blind pass');
  assert.equal(revealed.players[nilSeat].hand.length, 11, '13 minus the 2 passed away');

  const partnerSees = await waitState(states[partnerSeat], (state) => state.game.nilExchange && state.game.nilExchange.nilGiven, 3000, 'partner receives the 2 blind cards');
  assert.equal(partnerSees.players[partnerSeat].hand.length, 15);
  const backCards = partnerSees.players[partnerSeat].hand.slice(0, 2).map((card) => card.code);
  sockets[partnerSeat].emit('submitNilReturnCards', { roomCode, cardCodes: backCards });

  const settled = await waitState(states[nilSeat], (state) => state.game.nilExchange === null, 3000, 'blind exchange settled');
  const partnerSettled = await waitState(states[partnerSeat], (state) => state.players[partnerSeat].hand.length === 13, 3000, 'partner settled at 13');
  assert.equal(settled.players[nilSeat].hand.length, 13);
  assert.equal(partnerSettled.players[partnerSeat].hand.length, 13);
});

test('table setting: turning off Nil card passing skips the exchange entirely', async (t) => {
  const tokens = ['nilpass-off-1', 'nilpass-off-2', 'nilpass-off-3', 'nilpass-off-4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  sockets[0].emit('setTableOptions', { roomCode, nilPassEnabled: false });
  await waitState(states[0], (state) => state.nilPassEnabled === false);

  sockets[0].emit('startGame', { roomCode });
  const bidding = await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');
  const nilSeat = bidding.game.currentSeat;

  sockets[nilSeat].emit('submitBid', { roomCode, bid: 0 });
  await waitState(states[nilSeat], (state) => state.players[nilSeat].bid === 0, 3000, 'nil bid recorded');
  assert.equal(states[nilSeat]().game.nilExchange, null, 'no exchange starts when the table setting is off');
});
