const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const openSockets = new Set();

function waitFor(socket, event, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const onEvent = (payload) => {
      let matches = false;
      try {
        matches = predicate(payload);
      } catch {
        matches = false;
      }
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
      } catch {
        matches = false;
      }
      if (matches) return resolve(state);
      if (Date.now() - started > timeout) {
        return reject(new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`));
      }
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
      SPADES_RECONNECT_GRACE_MS: '1500',
      SPADES_BOT_DELAY_MS: '20',
      SPADES_TRICK_PAUSE_MS: '20',
      SPADES_NEXT_HAND_MS: '100',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'ignore'],
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
    if (child.exitCode !== null) return resolve();
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

function playableCard(hand, game) {
  if (!hand || !hand.length) return null;
  if (!game.trick.length) {
    const nonSpade = hand.find((card) => card.suit !== 'Spades');
    return game.spadesBroken || !nonSpade ? hand[0] : nonSpade;
  }
  const follow = hand.find((card) => card.suit === game.leadSuit);
  return follow || hand[0];
}

// Seats four humans into a brand new room in join order, so seat index
// always matches tokens/sockets index (0 = host). Returns live per-socket
// state getters — reading "my seat/hand" must always go through the
// getter for THAT socket, never through another client's last payload,
// since `isYou` is only meaningful relative to whichever socket received it.
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

// Drives a freshly-seated 4-human room from lobby through bidding into the
// 'playing' phase, with every seat bidding 2. Relies on seat === join index,
// which only holds for a room nobody has left/reconnected out of order.
async function startAndBid(sockets, states, roomCode) {
  sockets[0].emit('startGame', { roomCode });
  await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');
  for (let bids = 0; bids < 4; bids += 1) {
    const bidState = await waitState(states[0], (state) => state.game.phase === 'bidding');
    const seat = bidState.game.currentSeat;
    sockets[seat].emit('submitBid', { roomCode, bid: 2 });
    await waitState(states[0], (state) => state.players[seat] && state.players[seat].bid === 2);
  }
  return waitState(states[0], (state) => state.game.phase === 'playing');
}

let sharedServer;
let sharedPort;

before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spades-shared-'));
  sharedPort = randomPort(4000);
  sharedServer = await startServer(path.join(dataDir, 'rooms.json'), sharedPort);
});

after(async () => {
  for (const socket of [...openSockets]) closeSocket(socket);
  if (sharedServer) await stopServer(sharedServer);
});

test('lobby: host creates room, three humans join in order, a fifth is rejected once full', async (t) => {
  const tokens = ['lobby-host', 'lobby-p2', 'lobby-p3', 'lobby-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  assert.equal(states[3]().players.filter(Boolean).length, 4);
  tokens.forEach((_token, index) => {
    const mine = states[index]().players.find((player) => player && player.isYou);
    assert.equal(mine.seat, index);
  });

  const fifth = await connect(sharedPort, 'lobby-fifth');
  t.after(() => closeSocket(fifth));
  const fifthError = waitFor(fifth, 'errorMessage');
  fifth.emit('joinRoom', { code: roomCode, name: 'Fifth' });
  assert.equal(await fifthError, 'That table is full.');
});

test('host can start with empty seats and bots fill the rest', async (t) => {
  const host = await connect(sharedPort, 'solo-host');
  t.after(() => closeSocket(host));
  const hostState = createState(host);

  host.emit('createRoom', { name: 'Solo Host', stake: 250, rankMode: 'ace' });
  const created = await waitFor(host, 'roomState', (payload) => payload.roomCode);
  host.emit('startGame', { roomCode: created.roomCode });

  const state = await waitState(hostState, (payload) => payload.game && payload.game.phase === 'bidding');
  assert.equal(state.players.filter(Boolean).length, 4);
  assert.equal(state.players.filter((player) => player.isBot).length, 3);
  const me = state.players.find((player) => player.isYou);
  assert.equal(me.hand.length, 13);
});

test('four humans: private hands, bid sync, and card-play sync', async (t) => {
  const tokens = ['sync-host', 'sync-p2', 'sync-p3', 'sync-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  const playingState = await startAndBid(sockets, states, roomCode);

  states.forEach((getState) => {
    getState().players.forEach((player) => {
      if (!player) return;
      assert.equal(player.hand.length, player.isYou ? 13 : 0);
    });
  });

  const expectedBids = { 0: 2, 1: 2, 2: 2, 3: 2 };
  states.forEach((getState) => assert.deepEqual(getState().game.bids, expectedBids));

  const seat = playingState.game.currentSeat;
  const me = states[seat]().players.find((player) => player.isYou);
  const card = playableCard(me.hand, playingState.game);
  sockets[seat].emit('playCard', { roomCode, cardCode: card.code });

  await Promise.all(states.map((getState) => waitState(getState, (state) => state.game.trick.length === 1)));
  states.forEach((getState) => {
    const trick = getState().game.trick;
    assert.equal(trick[0].seat, seat);
    assert.equal(trick[0].card.code, card.code);
  });
});

test('disconnect during bidding is observable, and reconnecting within the grace period restores seat, hand, and identity', async (t) => {
  const tokens = ['bid-recon-host', 'bid-recon-p2', 'bid-recon-p3', 'bid-recon-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  sockets[0].emit('startGame', { roomCode });
  await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');

  const targetSeat = 1;
  const handBefore = states[targetSeat]().players.find((player) => player.isYou).hand;
  const teamBefore = states[targetSeat]().players[targetSeat].team;

  sockets[targetSeat].disconnect();
  await waitState(states[0], (state) => state.players[targetSeat]?.connected === false, 5000, 'disconnect observed by another client');
  assert.ok(states[0]().players[targetSeat], 'seat is retained (not removed) during the grace period');

  const reconnected = await connect(sharedPort, tokens[targetSeat]);
  sockets[targetSeat] = reconnected;
  states[targetSeat] = createState(reconnected);
  const recovered = await waitFor(reconnected, 'roomState', (payload) => payload.game);

  const me = recovered.players.find((player) => player.isYou);
  assert.equal(me.seat, targetSeat);
  assert.deepEqual(me.hand, handBefore);
  assert.equal(me.team, teamBefore);
  assert.equal(recovered.game.phase, 'bidding');
  assert.equal(recovered.players[targetSeat].connected, true);
});

test('reconnect during an active trick preserves the trick, and the player retains bid, tricks, and team', async (t) => {
  const tokens = ['trick-recon-host', 'trick-recon-p2', 'trick-recon-p3', 'trick-recon-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  const playingState = await startAndBid(sockets, states, roomCode);
  const leaderSeat = playingState.game.currentSeat;
  const leaderHand = states[leaderSeat]().players.find((player) => player.isYou).hand;
  const leaderCard = playableCard(leaderHand, playingState.game);
  sockets[leaderSeat].emit('playCard', { roomCode, cardCode: leaderCard.code });
  const trickState = await waitState(states[0], (state) => state.game.trick.length === 1);

  const targetSeat = (leaderSeat + 1) % 4;
  const beforeBid = trickState.players[targetSeat].bid;
  const beforeTeam = trickState.players[targetSeat].team;
  const beforeTricks = trickState.players[targetSeat].tricks;

  sockets[targetSeat].disconnect();
  await waitState(states[0], (state) => state.players[targetSeat]?.connected === false);

  const reconnected = await connect(sharedPort, tokens[targetSeat]);
  sockets[targetSeat] = reconnected;
  states[targetSeat] = createState(reconnected);
  const recovered = await waitFor(reconnected, 'roomState', (payload) => payload.game && payload.game.trick.length === 1);

  const me = recovered.players.find((player) => player.isYou);
  assert.equal(me.seat, targetSeat);
  assert.equal(me.bid, beforeBid);
  assert.equal(me.team, beforeTeam);
  assert.equal(me.tricks, beforeTricks);
  assert.deepEqual(recovered.game.trick, trickState.game.trick);
});

test('host reconnect restores host status and seat', async (t) => {
  const tokens = ['host-recon-host', 'host-recon-p2', 'host-recon-p3', 'host-recon-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  assert.equal(states[0]().isHost, true);

  sockets[0].disconnect();
  await waitState(states[1], (state) => state.players[0]?.connected === false);
  assert.equal(states[1]().isHost, false, 'no one holds host while the host is disconnected');

  const reconnectedHost = await connect(sharedPort, tokens[0]);
  sockets[0] = reconnectedHost;
  states[0] = createState(reconnectedHost);
  const recovered = await waitFor(reconnectedHost, 'roomState', (payload) => payload.isHost);

  assert.equal(recovered.players.find((player) => player.isYou).seat, 0);
  assert.equal(recovered.isHost, true);
});

test('a stolen or fabricated session token cannot hijack an occupied seat', async (t) => {
  const tokens = ['hijack-host', 'hijack-p2', 'hijack-p3', 'hijack-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  const stranger = await connect(sharedPort, 'hijack-fabricated-token');
  t.after(() => closeSocket(stranger));
  const strangerError = waitFor(stranger, 'errorMessage');
  stranger.emit('joinRoom', { code: roomCode, name: 'Stranger' });
  assert.equal(await strangerError, 'That table is full.', 'an unrecognized token cannot displace a seated player');

  const impersonator = await connect(sharedPort, tokens[1]);
  t.after(() => closeSocket(impersonator));
  const impersonatorError = await waitFor(impersonator, 'errorMessage');
  assert.equal(impersonatorError, 'That session is already connected.');

  sockets[0].emit('startGame', { roomCode });
  await waitState(states[0], (state) => state.game && state.game.phase === 'bidding');

  const bidBefore = states[0]().players[1].bid;
  const impersonatorBidError = waitFor(impersonator, 'errorMessage');
  impersonator.emit('submitBid', { roomCode, bid: 9 });
  assert.equal(await impersonatorBidError, 'You are not seated at this table.');
  assert.equal(states[0]().players[1].bid, bidBefore, 'the impersonating socket cannot act on the real seat');
});

test('grace-period expiry converts an abandoned seat to a bot so the hand can continue', async (t) => {
  const tokens = ['expiry-host', 'expiry-p2', 'expiry-p3', 'expiry-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(sharedPort, tokens);
  t.after(() => sockets.forEach(closeSocket));

  await startAndBid(sockets, states, roomCode);
  const targetSeat = 2;
  const nameBefore = states[targetSeat]().players[targetSeat].name;

  sockets[targetSeat].disconnect();

  const converted = await waitState(
    states[0],
    (state) => state.players[targetSeat]?.isBot === true,
    5000,
    'grace-period expiry converting the seat to a bot'
  );
  assert.equal(converted.players[targetSeat].connected, true);
  assert.equal(converted.players[targetSeat].name, nameBefore);
  assert.ok(converted.game, 'the room keeps broadcasting normally after the takeover');
});

test('restarting the server recovers room state and host identity, without exposing hands prematurely', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spades-restart-'));
  const dataFile = path.join(dataDir, 'rooms.json');
  const port = randomPort(4300);
  let server = await startServer(dataFile, port);

  const tokens = ['restart-host', 'restart-p2', 'restart-p3', 'restart-p4'];
  const { sockets, states, roomCode } = await seatFourHumans(port, tokens);
  t.after(async () => {
    sockets.forEach(closeSocket);
    await stopServer(server);
  });

  await startAndBid(sockets, states, roomCode);
  const hostHandBefore = states[0]().players.find((player) => player.isYou).hand;

  sockets.forEach(closeSocket);
  await stopServer(server);
  server = await startServer(dataFile, port);

  const restartedHost = await connect(port, tokens[0]);
  sockets[0] = restartedHost;
  states[0] = createState(restartedHost);
  const recovered = await waitFor(restartedHost, 'roomState', (payload) => payload.roomCode === roomCode);

  assert.equal(recovered.game.phase, 'playing');
  assert.equal(recovered.isHost, true);
  const me = recovered.players.find((player) => player.isYou);
  assert.equal(me.seat, 0);
  assert.deepEqual(me.hand, hostHandBefore);

  const notYetReconnected = recovered.players.find((player) => player && !player.isYou && !player.isBot);
  assert.ok(notYetReconnected, 'the other human seats survive the restart as disconnected, not removed');
  assert.equal(notYetReconnected.connected, false);
  assert.equal(notYetReconnected.hand.length, 0, 'a recovered hand is never sent to anyone but its owner');
});
