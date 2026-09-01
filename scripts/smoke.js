const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = Number(process.env.SMOKE_PORT || 3017);
const ROOT = path.join(__dirname, '..');

function pickPlayable(hand, leadSuit, spadesBroken) {
  if (!hand.length) return null;
  if (!leadSuit) {
    if (!spadesBroken && hand.some((card) => card.suit !== 'Spades')) {
      return hand.find((card) => card.suit !== 'Spades');
    }
    return hand[0];
  }
  const follow = hand.filter((card) => card.suit === leadSuit);
  return follow[0] || hand[0];
}

function waitUntil(getState, predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const state = getState();
      if (state && predicate(state)) {
        resolve(state);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(check, 15);
    };
    check();
  });
}

async function main() {
  const server = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      SPADES_BOT_DELAY_MS: '20',
      SPADES_TRICK_PAUSE_MS: '30',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let sawTrick = false;
  let sawNextHand = false;

  const shutdown = () => {
    if (!server.killed) server.kill();
  };

  process.on('exit', shutdown);

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server failed to start')), 8000);
      server.stdout.on('data', (chunk) => {
        if (String(chunk).includes('Spades server running')) {
          clearTimeout(timer);
          resolve();
        }
      });
      server.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
      });
      server.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited early with code ${code}`));
      });
    });

    const socket = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
    });

    let latest = null;
    socket.on('errorMessage', (message) => {
      throw new Error(`Server error: ${message}`);
    });
    socket.on('roomState', (payload) => {
      latest = payload;
    });
    const getState = () => latest;

    socket.emit('createRoom', { name: 'Smoke Host', stake: 250 });
    let state = await waitUntil(getState, (payload) => payload.roomCode && payload.isHost, 5000, 'room create');

    socket.emit('startGame', { roomCode: state.roomCode });
    state = await waitUntil(getState, (payload) => payload.game && payload.game.phase === 'bidding', 5000, 'bidding');

    if (state.players.filter(Boolean).length !== 4) {
      throw new Error('Expected 4 seated players after start');
    }

    while (state.game.phase === 'bidding') {
      const snapshot = state;
      const me = snapshot.players.find((player) => player && player.isYou);
      if (snapshot.game.currentSeat === me.seat && snapshot.players[me.seat].bid == null) {
        socket.emit('submitBid', { roomCode: snapshot.roomCode, bid: 3 });
      }
      state = await waitUntil(
        getState,
        (payload) => payload.game && (
          payload.game.phase === 'playing'
          || payload.game.currentSeat !== snapshot.game.currentSeat
          || (payload.game.bids && payload.game.bids[snapshot.game.currentSeat] != null && snapshot.game.currentSeat !== me.seat)
          || (me && payload.players[me.seat] && payload.players[me.seat].bid != null && snapshot.players[me.seat].bid == null)
        ),
        5000,
        'next bid'
      );
    }

    if (state.game.phase !== 'playing') {
      throw new Error(`Expected playing phase, got ${state.game.phase}`);
    }

    let safety = 0;
    while (state.game.phase === 'playing' && safety < 200) {
      safety += 1;
      const snapshot = state;
      if (snapshot.game.trick && snapshot.game.trick.length > 0) sawTrick = true;

      const me = snapshot.players.find((player) => player && player.isYou);
      if (!snapshot.game.resolving && snapshot.game.currentSeat === me.seat) {
        const card = pickPlayable(me.hand, snapshot.game.leadSuit, false);
        if (!card) throw new Error('No playable card in hand');
        socket.emit('playCard', { roomCode: snapshot.roomCode, cardCode: card.code });
      }

      state = await waitUntil(getState, (payload) => {
        if (!payload.game) return false;
        if (payload.game.phase === 'finished') return true;
        if (payload.game.trick && payload.game.trick.length > 0) sawTrick = true;
        return payload.game.message !== snapshot.game.message
          || payload.game.currentSeat !== snapshot.game.currentSeat
          || (payload.game.trick || []).length !== (snapshot.game.trick || []).length
          || Boolean(payload.game.resolving) !== Boolean(snapshot.game.resolving)
          || (payload.players[me.seat].hand || []).length !== (me.hand || []).length;
      }, 5000, 'next play');
    }

    if (state.game.phase !== 'finished') {
      throw new Error(`Hand did not finish, last phase ${state.game.phase}`);
    }

    const firstScores = { ...state.game.scores };
    socket.emit('nextHand', { roomCode: state.roomCode });
    state = await waitUntil(getState, (payload) => payload.game && payload.game.phase === 'bidding' && payload.game.round === 2, 5000, 'next hand');
    sawNextHand = true;

    if (state.game.scores[0] !== firstScores[0] || state.game.scores[1] !== firstScores[1]) {
      throw new Error('Next hand wiped the match score');
    }

    if (!sawTrick) {
      throw new Error('Never observed a visible trick');
    }

    socket.close();
    console.log(`Smoke OK: finished a hand, saw the trick, dealt round 2, scores ${firstScores[0]}-${firstScores[1]}`);
  } finally {
    shutdown();
  }

  if (!sawNextHand) {
    throw new Error('Next hand did not deal');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
