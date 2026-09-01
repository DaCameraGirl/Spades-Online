const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 12,
});

const lobbySection = document.getElementById('lobby');
const tableSection = document.getElementById('table');
const statusBadge = document.getElementById('statusBadge');
const roomCodeLabel = document.getElementById('roomCodeLabel');
const stakeLabel = document.getElementById('stakeLabel');
const errorBox = document.getElementById('errorBox');
const roomCodeInput = document.getElementById('roomCodeInput');
const playerNameInput = document.getElementById('playerName');
const stakeSelect = document.getElementById('stakeSelect');
const tableStyleSelect = document.getElementById('tableStyleSelect');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const startGameBtn = document.getElementById('startGameBtn');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const soundToggle = document.getElementById('soundToggle');
const tableCall = document.getElementById('tableCall');
const bidSelect = document.getElementById('bidSelect');
const bidBtn = document.getElementById('bidBtn');
const handArea = document.getElementById('handArea');
const tableSeats = document.getElementById('tableSeats');
const gameMessage = document.getElementById('gameMessage');
const turnLabel = document.getElementById('turnLabel');
const teamOneScoreEl = document.getElementById('teamOneScore');
const teamTwoScoreEl = document.getElementById('teamTwoScore');
const handMeterValueEl = document.getElementById('handMeterValue');
const handMeterFillEl = document.getElementById('handMeterFill');
const potValueEl = document.getElementById('potValue');
const trickSlots = {
  north: document.getElementById('trickNorth'),
  east: document.getElementById('trickEast'),
  south: document.getElementById('trickSouth'),
  west: document.getElementById('trickWest'),
};

const SUIT_MARK = {
  Spades: '♠',
  Hearts: '♥',
  Clubs: '♣',
  Diamonds: '♦',
};

let roomState = null;
let mySeat = null;
let didAutoJoin = false;
let lastAudio = null;
let callTimer = null;

const pendingRoomCode = (new URLSearchParams(window.location.search).get('room') || '').trim().toUpperCase();
if (pendingRoomCode) {
  roomCodeInput.value = pendingRoomCode;
}

function inviteUrl(roomCode) {
  const url = new URL(window.location.origin);
  url.searchParams.set('room', roomCode);
  return url.toString();
}

function syncRoomUrl(roomCode) {
  if (!roomCode) return;
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomCode);
  window.history.replaceState({}, '', url);
}

function showTableCall(text) {
  if (!tableCall || !text) return;
  tableCall.textContent = text;
  tableCall.classList.remove('hidden');
  window.clearTimeout(callTimer);
  callTimer = window.setTimeout(() => {
    tableCall.classList.add('hidden');
  }, text.toLowerCase().includes('hand complete') ? 4000 : 2200);
}

function bidTotal(players) {
  return (players || []).reduce((sum, player) => sum + (player && player.bid != null ? 1 : 0), 0);
}

function trickSignature(trick) {
  return (trick || []).map((entry) => `${entry.seat}:${entry.card && entry.card.code}`).join('|');
}

function playTableSounds(nextState) {
  if (!window.SpadesAudio || !nextState) return;
  const game = nextState.game;
  const prev = lastAudio;
  lastAudio = game
    ? {
      phase: game.phase,
      currentSeat: game.currentSeat,
      trick: trickSignature(game.trick),
      trickCount: (game.trick || []).length,
      resolving: Boolean(game.resolving),
      spadesBroken: Boolean(game.spadesBroken),
      bids: bidTotal(nextState.players),
      mySeat,
    }
    : null;

  if (!game) return;

  if (!prev) {
    if (game.phase === 'bidding') {
      SpadesAudio.deal();
      SpadesAudio.say('Bidding is open.');
      showTableCall('Bidding is open');
    }
    return;
  }

  if (prev.phase !== 'bidding' && game.phase === 'bidding') {
    SpadesAudio.deal();
    SpadesAudio.say('Bidding is open.');
    showTableCall('Bidding is open');
  }

  if (game.bids && prev.bids < bidTotal(nextState.players)) {
    SpadesAudio.chip();
  }

  if (prev.phase === 'bidding' && game.phase === 'playing') {
    SpadesAudio.say("Let's play.");
    showTableCall("Let's play");
  }

  if (!prev.spadesBroken && game.spadesBroken) {
    SpadesAudio.spadesBroken();
    showTableCall('Spades are broken');
  } else if (prev.trick !== trickSignature(game.trick) && (game.trick || []).length > prev.trickCount) {
    const lastCard = game.trick[game.trick.length - 1];
    const isTrump = lastCard && lastCard.card && lastCard.card.suit === 'Spades' && game.leadSuit && game.leadSuit !== 'Spades';
    if (isTrump) SpadesAudio.trump();
    else SpadesAudio.card();
  }

  if (!prev.resolving && game.resolving) {
    SpadesAudio.trickWon();
  }

  if (game.phase === 'finished' && prev.phase !== 'finished') {
    const one = game.scores ? game.scores[0] : 0;
    const two = game.scores ? game.scores[1] : 0;
    SpadesAudio.say('Hand complete.');
    showTableCall(`Hand complete  ${one} – ${two}`);
  }

  const becameMyTurn = game.currentSeat === mySeat && prev.currentSeat !== mySeat && !game.resolving;
  if (becameMyTurn && game.phase === 'bidding') {
    SpadesAudio.turn();
    SpadesAudio.say('Your bid.');
  }
  if (becameMyTurn && game.phase === 'playing') {
    SpadesAudio.turn();
    if (!(game.trick && game.trick.length)) SpadesAudio.say('Your lead.');
  }
}

function maybeAutoJoin() {
  if (didAutoJoin || roomState) return;
  if (!pendingRoomCode) return;
  didAutoJoin = true;
  const name = playerNameInput.value.trim() || 'Player';
  socket.emit('joinRoom', { code: pendingRoomCode, name });
}

function applyTableTheme(theme = tableStyleSelect.value) {
  document.body.dataset.tableTheme = theme;
}

function setError(message) {
  if (!message) {
    errorBox.classList.add('hidden');
    errorBox.textContent = '';
    return;
  }

  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function showTable() {
  lobbySection.classList.remove('active');
  tableSection.classList.add('active');
}

function markConnected() {
  statusBadge.textContent = 'Connected';
  statusBadge.style.color = '#7dcca6';
  statusBadge.style.borderColor = 'rgba(125, 204, 166, 0.35)';
  statusBadge.style.background = 'rgba(125, 204, 166, 0.12)';
}

function sortHand(cards) {
  const suitOrder = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
  const rankOrder = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

  return [...cards].sort((a, b) => {
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return rankOrder[b.rank] - rankOrder[a.rank];
  });
}

function relativeSeat(seatIndex) {
  const origin = mySeat == null ? 0 : mySeat;
  return (seatIndex - origin + 4) % 4;
}

function seatLayout(seatIndex) {
  const rel = relativeSeat(seatIndex);
  const map = {
    0: { left: 50, top: 88, slot: 'south' },
    1: { left: 9, top: 50, slot: 'west' },
    2: { left: 50, top: 12, slot: 'north' },
    3: { left: 91, top: 50, slot: 'east' },
  };
  return map[rel];
}

function isRedSuit(suit) {
  return suit === 'Hearts' || suit === 'Diamonds';
}

const PIP_SLOTS = {
  A: ['c'],
  '2': ['t', 'bi'],
  '3': ['t', 'c', 'bi'],
  '4': ['tl', 'tr', 'bl', 'br'],
  '5': ['tl', 'tr', 'c', 'bl', 'br'],
  '6': ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
  '7': ['tl', 'tr', 'tc', 'ml', 'mr', 'bl', 'br'],
  '8': ['tl', 'tr', 'tc', 'ml', 'mr', 'bc', 'bl', 'br'],
  '9': ['tl', 'tr', 'ul', 'ur', 'c', 'll', 'lr', 'bl', 'br'],
  '10': ['tl', 'tr', 'tc', 'ul', 'ur', 'll', 'lr', 'bc', 'bl', 'br'],
};

function cardMarkup(card) {
  const mark = SUIT_MARK[card.suit] || card.suit[0];
  const isFace = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
  const body = isFace
    ? `<div class="pc-court"><span class="pc-court-rank">${card.rank}</span><span class="pc-court-suit">${mark}</span></div>`
    : `<div class="pc-pips">${(PIP_SLOTS[card.rank] || ['c']).map((slot) => `<span class="pip ${slot}">${mark}</span>`).join('')}</div>`;

  return `
    <span class="pc-index top"><b>${card.rank}</b><i>${mark}</i></span>
    ${body}
    <span class="pc-index bot"><b>${card.rank}</b><i>${mark}</i></span>
  `;
}

function renderSeats() {
  if (!roomState) return;

  tableSeats.innerHTML = '';

  roomState.players.forEach((player, seatIndex) => {
    const seatCard = document.createElement('div');
    seatCard.className = 'seat-card';
    const pos = seatLayout(seatIndex);
    seatCard.style.left = `${pos.left}%`;
    seatCard.style.top = `${pos.top}%`;

    if (roomState.game && roomState.game.dealerSeat === seatIndex) {
      seatCard.classList.add('dealer');
    }

    if (!player) {
      seatCard.classList.add('empty');
      seatCard.innerHTML = `
        <div class="seat-topline">
          <span class="seat-tag">Seat ${seatIndex + 1}</span>
          <span class="seat-badge">Open</span>
        </div>
        <h4>Open seat</h4>
        <p>Waiting for a player</p>
      `;
      tableSeats.appendChild(seatCard);
      return;
    }

    if (roomState.game && roomState.game.currentSeat === player.seat && !roomState.game.resolving) {
      seatCard.classList.add('current-turn');
    }

    const partnerSeat = mySeat == null ? null : (mySeat + 2) % 4;
    const badge = player.isYou
      ? 'You'
      : partnerSeat === player.seat
        ? 'Partner'
        : player.isBot
          ? 'Bot'
          : 'Player';
    const tricks = player.tricks ?? 0;

    seatCard.innerHTML = `
      <div class="seat-topline">
        <span class="seat-tag">Seat ${player.seat + 1}</span>
        <span class="seat-badge">${badge}</span>
      </div>
      <h4>${player.name}</h4>
      <p>Bid <strong>${player.bid === 0 ? 'Nil' : player.bid ?? '—'}</strong> · Tricks <strong>${tricks}</strong></p>
    `;
    tableSeats.appendChild(seatCard);
  });
}

function renderHand() {
  if (!roomState || mySeat === null || typeof mySeat === 'undefined') {
    handArea.innerHTML = '';
    return;
  }

  const myPlayer = roomState.players[mySeat];
  if (!myPlayer) {
    handArea.innerHTML = '';
    return;
  }

  handArea.innerHTML = '';
  const cards = sortHand(myPlayer.hand || []);
  const isMyTurn = roomState.game
    && roomState.game.currentSeat === mySeat
    && roomState.game.phase === 'playing'
    && !roomState.game.resolving;

  cards.forEach((card, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `card-btn ${isRedSuit(card.suit) ? 'red' : ''}`;
    button.disabled = !isMyTurn;
    button.innerHTML = cardMarkup(card);
    button.title = `${card.rank} of ${card.suit}`;
    button.style.zIndex = String(index + 1);
    button.addEventListener('click', () => {
      if (!roomState || !roomState.game) return;
      if (roomState.game.phase !== 'playing' || roomState.game.resolving) return;
      if (window.SpadesAudio) {
        SpadesAudio.unlock();
        SpadesAudio.card();
      }
      socket.emit('playCard', { roomCode: roomState.roomCode, cardCode: card.code });
    });
    handArea.appendChild(button);
  });
}

function renderTrick() {
  Object.values(trickSlots).forEach((slot) => {
    if (slot) slot.innerHTML = '';
  });

  if (!roomState || !roomState.game || !roomState.game.trick || roomState.game.trick.length === 0) {
    return;
  }

  roomState.game.trick.forEach((entry) => {
    const slotName = seatLayout(entry.seat).slot;
    const slot = trickSlots[slotName];
    if (!slot) return;
    const cardDiv = document.createElement('div');
    cardDiv.className = `trick-card mini-card ${isRedSuit(entry.card.suit) ? 'red' : ''}`;
    cardDiv.innerHTML = cardMarkup(entry.card);
    slot.appendChild(cardDiv);
  });
}

function renderScores() {
  if (!roomState || !roomState.game || !roomState.game.scores) return;

  const teamOneScore = roomState.game.scores[0] ?? 0;
  const teamTwoScore = roomState.game.scores[1] ?? 0;
  const tricksWon = roomState.game.tricksWon || { 0: 0, 1: 0 };
  const tricksPlayed = (tricksWon[0] || 0) + (tricksWon[1] || 0);
  const tricksLeft = roomState.game.phase === 'finished' ? 0 : Math.max(0, 13 - tricksPlayed);

  teamOneScoreEl.textContent = String(teamOneScore);
  teamTwoScoreEl.textContent = String(teamTwoScore);
  handMeterValueEl.textContent = String(tricksLeft);
  handMeterFillEl.style.width = `${Math.max(8, (tricksLeft / 13) * 100)}%`;
}

function render() {
  if (!roomState) return;

  roomCodeLabel.textContent = roomState.roomCode || '';
  syncRoomUrl(roomState.roomCode);
  stakeLabel.textContent = roomState.stake || '250';
  if (potValueEl) {
    potValueEl.textContent = `$${roomState.stake || 250}`;
  }

  const playerCount = roomState.players.filter(Boolean).length;
  const finished = roomState.game && roomState.game.phase === 'finished';
  const canStart = roomState.isHost && playerCount > 0 && !roomState.game;
  const canDealNext = roomState.isHost && finished;

  startGameBtn.disabled = !(canStart || canDealNext);
  if (canDealNext) {
    startGameBtn.textContent = 'Deal next hand';
    startGameBtn.disabled = false;
  } else if (finished) {
    startGameBtn.textContent = 'Dealing next hand...';
    startGameBtn.disabled = true;
  } else if (canStart) {
    startGameBtn.textContent = 'Start game';
  } else if (roomState.game) {
    startGameBtn.textContent = 'Hand in play';
  } else if (!roomState.isHost) {
    startGameBtn.textContent = 'Waiting for host';
  } else {
    startGameBtn.textContent = 'Waiting for players';
  }

  const currentSeatInfo = roomState.game && roomState.players[roomState.game.currentSeat]
    ? roomState.players[roomState.game.currentSeat].name
    : '—';
  turnLabel.textContent = currentSeatInfo;

  if (roomState.game) {
    gameMessage.textContent = roomState.game.message;
    renderScores();
  } else {
    gameMessage.textContent = playerCount >= 4 ? 'Ready to start.' : 'Waiting for players. Bots fill empty seats when you start.';
    teamOneScoreEl.textContent = '0';
    teamTwoScoreEl.textContent = '0';
    handMeterValueEl.textContent = '13';
    handMeterFillEl.style.width = '100%';
  }

  const myPlayer = mySeat == null ? null : roomState.players[mySeat];
  const biddingOpen = roomState.game && roomState.game.phase === 'bidding';
  const alreadyBid = myPlayer && Number.isInteger(myPlayer.bid);
  const isMyBidTurn = biddingOpen && Number(roomState.game.currentSeat) === Number(mySeat);
  bidSelect.disabled = !isMyBidTurn;
  bidBtn.disabled = !isMyBidTurn || alreadyBid;
  if (biddingOpen && !isMyBidTurn && !alreadyBid) {
    const waiter = roomState.players[roomState.game.currentSeat];
    if (waiter && gameMessage && !String(gameMessage.textContent || '').includes('bids')) {
      gameMessage.textContent = `Waiting for ${waiter.name} to bid.`;
    }
  }

  showTable();
  renderSeats();
  renderHand();
  renderTrick();
}

tableStyleSelect.addEventListener('change', () => {
  applyTableTheme();
});

applyTableTheme();

socket.on('connect', () => {
  markConnected();
  setError('');
  maybeAutoJoin();
});

socket.on('roomState', (payload) => {
  roomState = payload;
  const myPlayer = roomState.players.find((player) => player && player.isYou);
  mySeat = myPlayer ? myPlayer.seat : null;
  playTableSounds(roomState);
  render();
});

socket.on('errorMessage', (message) => {
  setError(message);
});

createRoomBtn.addEventListener('click', () => {
  if (window.SpadesAudio) SpadesAudio.unlock();
  const name = playerNameInput.value.trim() || 'Host';
  const stake = Number(stakeSelect.value);
  socket.emit('createRoom', { name, stake });
  setError('');
});

joinRoomBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Player';
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    setError('Enter a room code to join.');
    return;
  }

  socket.emit('joinRoom', { code: roomCode, name });
  setError('');
});

startGameBtn.addEventListener('click', () => {
  if (!roomState || !roomState.roomCode) return;
  if (window.SpadesAudio) {
    SpadesAudio.unlock();
    SpadesAudio.deal();
  }
  if (roomState.game && roomState.game.phase === 'finished') {
    socket.emit('nextHand', { roomCode: roomState.roomCode });
    return;
  }
  socket.emit('startGame', { roomCode: roomState.roomCode });
});

bidBtn.addEventListener('click', () => {
  if (!roomState || !roomState.roomCode) return;
  if (window.SpadesAudio) {
    SpadesAudio.unlock();
    SpadesAudio.chip();
  }
  const bidValue = Number(bidSelect.value);
  socket.emit('submitBid', { roomCode: roomState.roomCode, bid: bidValue });
});

roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});

function syncSoundToggle() {
  if (!soundToggle || !window.SpadesAudio) return;
  const on = !SpadesAudio.isMuted();
  soundToggle.textContent = on ? 'Test sound' : 'Sound off';
  soundToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
}

if (soundToggle) {
  syncSoundToggle();
  soundToggle.addEventListener('click', () => {
    SpadesAudio.unlock();
    if (SpadesAudio.isMuted()) SpadesAudio.setMuted(false);
    else SpadesAudio.ping();
    syncSoundToggle();
  });
  soundToggle.addEventListener('dblclick', () => {
    SpadesAudio.setMuted(true);
    syncSoundToggle();
  });
}

if (copyInviteBtn) {
  copyInviteBtn.addEventListener('click', async () => {
    if (!roomState || !roomState.roomCode) return;
    const url = inviteUrl(roomState.roomCode);
    try {
      await navigator.clipboard.writeText(url);
      copyInviteBtn.textContent = 'Copied! Send this to your table';
    } catch (error) {
      window.prompt('Copy this invite link', url);
      copyInviteBtn.textContent = 'Copy invite link';
      return;
    }
    window.setTimeout(() => {
      copyInviteBtn.textContent = 'Copy invite link';
    }, 1800);
  });
}
