const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');

function waitFor(socket, event, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const onEvent = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    };
    socket.on(event, onEvent);
  });
}

async function startServer(dataFile, port) {
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      SPADES_DATA_FILE: dataFile,
      SPADES_RECONNECT_GRACE_MS: '1200',
      SPADES_BOT_DELAY_MS: '20',
      SPADES_TRICK_PAUSE_MS: '20',
      SPADES_NEXT_HAND_MS: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 5000);
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
    const timer = setTimeout(resolve, 1000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGKILL');
  });
}

async function connect(port, token) {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    auth: { sessionToken: token },
  });
  await waitFor(socket, 'connect');
  return socket;
}

function createState(socket) {
  let latest = null;
  socket.on('roomState', (state) => { latest = state; });
  return () => latest;
}

function waitState(getState, predicate, timeout = 5000, label = 'state') {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const state = getState();
      if (state && predicate(state)) return resolve(state);
      if (Date.now() - started > timeout) return reject(new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`));
      setTimeout(check, 10);
    };
    check();
  });
}

function playableCard(player, game) {
  if (!player || !player.hand.length) return null;
  if (!game.trick.length) {
    const nonTrump = player.hand.find((card) => card.suit !== 'Spades');
    return game.spadesBroken || !nonTrump ? player.hand[0] : nonTrump;
  }
  const follow = player.hand.find((card) => card.suit === game.leadSuit);
  return follow || player.hand[0];
}

test('multiplayer identity, reconnect, privacy, synchronization, and restart recovery', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spades-online-'));
  const dataFile = path.join(tempDir, 'rooms.json');
  const port = 3400 + Math.floor(Math.random() * 200);
  let server = await startServer(dataFile, port);
  const tokens = ['host-token', 'second-token', 'third-token', 'fourth-token'];
  const sockets = [];
  const views = [];

  t.after(async () => {
    sockets.forEach((socket) => socket.close());
    if (server.exitCode === null) await stopServer(server);
  });

  let host = await connect(port, tokens[0]);
  sockets.push(host);
  let hostState = createState(host);
  views[0] = hostState;
  host.emit('createRoom', { name: 'Host', stake: 250 });
  let state = await waitFor(host, 'roomState', (payload) => payload.roomCode);
  const roomCode = state.roomCode;
  assert.equal(state.players.filter(Boolean).length, 1);
  assert.equal(state.players[0].isYou, true);
  assert.notEqual(state.players[0].id, host.id);

  for (let index = 1; index < tokens.length; index += 1) {
    const client = await connect(port, tokens[index]);
    sockets.push(client);
    views[index] = createState(client);
    client.emit('joinRoom', { code: roomCode, name: `Player ${index + 1}` });
    state = await waitFor(client, 'roomState', (payload) => payload.players.filter(Boolean).length === index + 1);
  }
  assert.equal(state.players.filter(Boolean).length, 4);

  const hostSeat = state.players.find((player) => player && player.isYou).seat;
  host.disconnect();
  state = await waitFor(sockets[1], 'roomState', (payload) => payload.players[hostSeat].connected === false);
  host = await connect(port, tokens[0]);
  sockets[0] = host;
  hostState = createState(host);
  views[0] = hostState;
  state = await waitFor(host, 'roomState', (payload) => payload.isHost && payload.players[hostSeat].connected);
  assert.equal(state.players.find((player) => player && player.isYou).seat, hostSeat);

  const fifth = await connect(port, 'fifth-token');
  sockets.push(fifth);
  const fifthError = waitFor(fifth, 'errorMessage');
  fifth.emit('joinRoom', { code: roomCode, name: 'Fifth' });
  assert.equal(await fifthError, 'That table is full.');
  fifth.close();

  const duplicateHost = await connect(port, tokens[0]);
  sockets.push(duplicateHost);
  const duplicateError = waitFor(duplicateHost, 'errorMessage');
  assert.equal(await duplicateError, 'That session is already connected.');
  duplicateHost.close();

  host.emit('startGame', { roomCode });
  state = await waitFor(host, 'roomState', (payload) => payload.game && payload.game.phase === 'bidding');
  assert.equal(state.players.find((player) => player && player.isYou).hand.length, 13);
  assert.equal(state.players.filter((player) => player && !player.isYou).every((player) => player.hand.length === 0), true);

  const second = sockets[1];
  const secondState = createState(second);
  const secondView = await waitFor(second, 'roomState', (payload) => payload.game);
  views[1] = secondState;
  const secondSeat = secondView.players.find((player) => player && player.isYou).seat;
  const secondHand = secondView.players[secondSeat].hand;
  second.disconnect();
  state = await waitFor(host, 'roomState', (payload) => payload.players[secondSeat].connected === false);
  assert.equal(state.players[secondSeat].seat, secondSeat);

  const secondReconnected = await connect(port, tokens[1]);
  sockets[1] = secondReconnected;
  const recovered = createState(secondReconnected);
  views[1] = recovered;
  state = await waitFor(secondReconnected, 'roomState', (payload) => payload.game);
  assert.equal(state.players.find((player) => player && player.isYou).seat, secondSeat);
  assert.deepEqual(state.players[secondSeat].hand, secondHand);
  assert.equal(state.game.phase, 'bidding');
  assert.deepEqual(state.game.bids, { 0: null, 1: null, 2: null, 3: null });
  assert.equal(recovered().players[secondSeat].team, secondSeat % 2 === 0 ? 0 : 1);

  const clients = sockets.slice(0, 4);
  for (let bids = 0; bids < 4; bids += 1) {
    const bidState = await waitState(hostState, (payload) => payload.game.phase === 'bidding');
    const seat = bidState.game.currentSeat;
    clients[seat].emit('submitBid', { roomCode, bid: 2 });
    state = await waitState(hostState, (payload) => payload.players[seat].bid === 2);
  }
  state = await waitState(hostState, (payload) => payload.game.phase === 'playing');
  assert.deepEqual(state.game.bids, { 0: 2, 1: 2, 2: 2, 3: 2 });

  let trickState = state;
  while (!trickState.game.trick.length) {
    const currentSeat = trickState.game.currentSeat;
    const currentClient = clients[currentSeat];
    if (!currentClient) break;
    const current = views[currentSeat]();
    const me = current.players.find((player) => player && player.isYou);
    const card = playableCard(me, current.game);
    currentClient.emit('playCard', { roomCode, cardCode: card.code });
    trickState = await waitState(hostState, (payload) => payload.game.trick.length > 0);
  }
  assert.ok(trickState.game.trick.length > 0);
  const reconnectSeat = trickState.game.trick[0].seat;
  const reconnectClient = clients[reconnectSeat];
  reconnectClient.disconnect();
  state = await waitFor(host, 'roomState', (payload) => payload.players[reconnectSeat].connected === false);
  assert.equal(state.players[reconnectSeat].connected, false);
  const activeRecovered = await connect(port, tokens[reconnectSeat]);
  sockets[reconnectSeat] = activeRecovered;
  views[reconnectSeat] = createState(activeRecovered);
  state = await waitFor(activeRecovered, 'roomState', (payload) => payload.game.trick.length > 0);
  assert.equal(state.players.find((player) => player && player.isYou).seat, reconnectSeat);
  assert.deepEqual(state.game.trick, trickState.game.trick);

  const savedPhase = state.game.phase;
  host.close();
  await stopServer(server);
  server = await startServer(dataFile, port);
  const restartClient = await connect(port, tokens[0]);
  sockets[0] = restartClient;
  views[0] = createState(restartClient);
  state = await waitFor(restartClient, 'roomState', (payload) => payload.roomCode === roomCode);
  assert.equal(state.game.phase, savedPhase);
  assert.equal(state.players.find((player) => player && player.isYou).seat, 0);
  assert.equal(state.players[0].hand.length > 0, true);
  assert.equal(hostState() === null || hostState().roomCode === roomCode, true);
});
