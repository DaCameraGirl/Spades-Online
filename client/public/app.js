const socket = io();

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
const bidSelect = document.getElementById('bidSelect');
const bidBtn = document.getElementById('bidBtn');
const handArea = document.getElementById('handArea');
const tableSeats = document.getElementById('tableSeats');
const gameMessage = document.getElementById('gameMessage');
const turnLabel = document.getElementById('turnLabel');
const trickArea = document.getElementById('trickArea');
const teamOneScoreEl = document.getElementById('teamOneScore');
const teamTwoScoreEl = document.getElementById('teamTwoScore');
const handMeterValueEl = document.getElementById('handMeterValue');
const handMeterFillEl = document.getElementById('handMeterFill');
const potValueEl = document.getElementById('potValue');

let roomState = null;
let mySeat = null;

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
  statusBadge.style.color = '#4de0a4';
  statusBadge.style.borderColor = 'rgba(77, 224, 164, 0.35)';
  statusBadge.style.background = 'rgba(77, 224, 164, 0.12)';
}

function sortHand(cards) {
  const suitOrder = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
  const rankOrder = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

  return [...cards].sort((a, b) => {
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return rankOrder[a.rank] - rankOrder[b.rank];
  });
}

function renderSeats() {
  if (!roomState) return;

  tableSeats.innerHTML = '';
  const positions = [
    { left: 50, top: 12 },
    { left: 82, top: 38 },
    { left: 50, top: 88 },
    { left: 18, top: 38 },
  ];

  roomState.players.forEach((player, seatIndex) => {
    const seatCard = document.createElement('div');
    seatCard.className = 'seat-card';
    const pos = positions[seatIndex] || positions[0];
    seatCard.style.left = `${pos.left}%`;
    seatCard.style.top = `${pos.top}%`;

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

    if (roomState.game && roomState.game.currentSeat === player.seat) {
      seatCard.classList.add('current-turn');
    }

    const badge = player.isBot ? 'Bot' : player.isYou ? 'You' : 'Player';
    seatCard.innerHTML = `
      <div class="seat-topline">
        <span class="seat-tag">Seat ${player.seat + 1}</span>
        <span class="seat-badge">${badge}</span>
      </div>
      <h4>${player.name}</h4>
      <p>Bid: <strong>${player.bid ?? '—'}</strong></p>
      <p>Team ${player.team + 1}</p>
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
  const isMyTurn = roomState.game && roomState.game.currentSeat === mySeat;

  cards.forEach((card, index) => {
    const button = document.createElement('button');
    button.className = `card-btn ${card.suit === 'Hearts' || card.suit === 'Diamonds' ? 'red' : ''}`;
    button.disabled = !isMyTurn || !roomState.game || roomState.game.phase !== 'playing';
    button.textContent = `${card.rank} ${card.suit}`;
    button.title = `${card.suit} ${card.rank}`;
    const tilt = (index - (cards.length - 1) / 2) * 4;
    button.style.setProperty('--card-rotate', `${tilt}deg`);
    button.addEventListener('click', () => {
      if (!roomState || !roomState.game) return;
      if (roomState.game.phase !== 'playing') return;
      socket.emit('playCard', { roomCode: roomState.roomCode, cardCode: card.code });
    });
    handArea.appendChild(button);
  });
}

function renderTrick() {
  if (!roomState || !roomState.game || !roomState.game.trick || roomState.game.trick.length === 0) {
    trickArea.innerHTML = '<div class="trick-card">No cards in play yet</div>';
    return;
  }

  trickArea.innerHTML = '';
  roomState.game.trick.forEach((entry) => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'trick-card card-pop';
    cardDiv.textContent = `${entry.card.rank}${entry.card.suit[0]}`;
    trickArea.appendChild(cardDiv);
  });
}

function renderScores() {
  if (!roomState || !roomState.game || !roomState.game.scores) return;

  const teamOneScore = roomState.game.scores[0] ?? 0;
  const teamTwoScore = roomState.game.scores[1] ?? 0;
  const cardsLeft = roomState.players.reduce((sum, player) => sum + ((player && player.hand) ? player.hand.length : 0), 0);

  teamOneScoreEl.textContent = String(teamOneScore);
  teamTwoScoreEl.textContent = String(teamTwoScore);
  handMeterValueEl.textContent = String(cardsLeft || 13);
  handMeterFillEl.style.width = `${Math.max(10, (cardsLeft / 52) * 100)}%`;

  const scoreText = `Team 1: ${teamOneScore} | Team 2: ${teamTwoScore}`;
  gameMessage.textContent = `${roomState.game.message} ${scoreText}`;
}

function render() {
  if (!roomState) return;

  roomCodeLabel.textContent = roomState.roomCode || '';
  stakeLabel.textContent = roomState.stake || '250';
  if (potValueEl) {
    potValueEl.textContent = `$${roomState.stake || 250}`;
  }

  const playerCount = roomState.players.filter(Boolean).length;
  const canStart = playerCount > 0 && !roomState.game;
  startGameBtn.disabled = !canStart;
  startGameBtn.textContent = canStart ? 'Start game' : 'Waiting for players';

  const currentSeatInfo = roomState.game && roomState.players[roomState.game.currentSeat]
    ? roomState.players[roomState.game.currentSeat].name
    : '—';
  turnLabel.textContent = currentSeatInfo;

  if (roomState.game) {
    gameMessage.textContent = roomState.game.message;
    renderScores();
  } else {
    gameMessage.textContent = playerCount >= 4 ? 'Ready to start.' : 'Waiting for players.';
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
});

socket.on('roomState', (payload) => {
  roomState = payload;
  const myPlayer = roomState.players.find((player) => player && player.isYou);
  mySeat = myPlayer ? myPlayer.seat : null;
  render();
});

socket.on('errorMessage', (message) => {
  setError(message);
});

createRoomBtn.addEventListener('click', () => {
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
  socket.emit('startGame', { roomCode: roomState.roomCode });
});

bidBtn.addEventListener('click', () => {
  if (!roomState || !roomState.roomCode) return;
  const bidValue = Number(bidSelect.value);
  socket.emit('submitBid', { roomCode: roomState.roomCode, bid: bidValue });
});

roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});
