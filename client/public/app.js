const SESSION_STORAGE_KEY = 'spades.sessionToken';
let sessionToken = window.localStorage.getItem(SESSION_STORAGE_KEY);
if (!sessionToken) {
  sessionToken = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
}

const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 12,
  auth: { sessionToken },
});

const roomSelectSection = document.getElementById('roomSelect');
const roomViewSection = document.getElementById('roomView');
const lobbySection = document.getElementById('lobby');
const tableSection = document.getElementById('table');
const lobbyPlayerNameInput = document.getElementById('lobbyPlayerName');
const roomCards = [...document.querySelectorAll('[data-lobby-room]')];
const showPrivateTableBtn = document.getElementById('showPrivateTableBtn');
const backToRoomsBtn = document.getElementById('backToRoomsBtn');
const backToRoomsFromPrivateBtn = document.getElementById('backToRoomsFromPrivateBtn');
const roomViewTitle = document.getElementById('roomViewTitle');
const tableGrid = document.getElementById('tableGrid');
const rosterList = document.getElementById('rosterList');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const lobbyErrorBox = document.getElementById('lobbyErrorBox');
const statusBadge = document.getElementById('statusBadge');
const roomCodeLabel = document.getElementById('roomCodeLabel');
const stakeLabel = document.getElementById('stakeLabel');
const errorBox = document.getElementById('errorBox');
const roomCodeInput = document.getElementById('roomCodeInput');
const playerNameInput = document.getElementById('playerName');
const stakeSelect = document.getElementById('stakeSelect');
const createRankModeSelect = document.getElementById('createRankModeSelect');
const rankModeSelect = document.getElementById('rankModeSelect');
const tableStyleSelect = document.getElementById('tableStyleSelect');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const startGameBtn = document.getElementById('startGameBtn');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const leaveTableBtn = document.getElementById('leaveTableBtn');
const lockTableBtn = document.getElementById('lockTableBtn');
const tableChatToggleBtn = document.getElementById('tableChatToggleBtn');
const tableChatBadge = document.getElementById('tableChatBadge');
const tableChatPanel = document.getElementById('tableChatPanel');
const tableChatCloseBtn = document.getElementById('tableChatCloseBtn');
const tableChatLog = document.getElementById('tableChatLog');
const tableChatInput = document.getElementById('tableChatInput');
const tableChatSendBtn = document.getElementById('tableChatSendBtn');
const turnTimerSelect = document.getElementById('turnTimerSelect');
const soundToggles = [...document.querySelectorAll('[data-sound-toggle]')];
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
const chipPanel = document.querySelector('.chip-panel');
const chipStacks = [...document.querySelectorAll('.chip-stack')];
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
let currentLobbyRoomId = null;
let lastDealtRound = null;

const LOBBY_ROOM_LABELS = {
  beginner: 'Beginner Room',
  advance: 'Advance Room',
  expert: 'Expert Room',
};

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

let chipJingleTimer = null;
function jingleChips() {
  if (!chipPanel) return;
  chipPanel.classList.add('jingle');
  window.clearTimeout(chipJingleTimer);
  chipJingleTimer = window.setTimeout(() => chipPanel.classList.remove('jingle'), 420);
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
      bidsBySeat: nextState.players.map((player) => (player ? player.bid : null)),
      matchOver: Boolean(game && game.matchOver),
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
    jingleChips();
    nextState.players.forEach((player, seatIndex) => {
      const justBidNil = player && player.bid === 0 && prev.bidsBySeat[seatIndex] == null;
      if (justBidNil) {
        SpadesAudio.say(`${player.isYou ? 'You are' : `${player.name} is`} going for Nil!`);
        showTableCall(`${player.name} is going for Nil!`);
      }
    });
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
    jingleChips();
  }

  if (game.phase === 'finished' && prev.phase !== 'finished') {
    const one = game.scores ? game.scores[0] : 0;
    const two = game.scores ? game.scores[1] : 0;
    if (game.matchOver) {
      const wonMyTeam = mySeat != null && game.matchWinner === (mySeat % 2);
      SpadesAudio.matchWin(wonMyTeam);
      SpadesAudio.say(`Team ${game.matchWinner + 1} wins the match!`);
      showTableCall(`Team ${game.matchWinner + 1} wins the match!`);
    } else {
      SpadesAudio.say('Hand complete.');
      showTableCall(`Hand complete  ${one} – ${two}`);
    }
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

function setLobbyError(message) {
  if (!message) {
    lobbyErrorBox.classList.add('hidden');
    lobbyErrorBox.textContent = '';
    return;
  }

  lobbyErrorBox.textContent = message;
  lobbyErrorBox.classList.remove('hidden');
}

function activatePanel(section) {
  [roomSelectSection, roomViewSection, lobbySection, tableSection].forEach((panel) => {
    panel.classList.toggle('active', panel === section);
  });
  document.body.classList.toggle('game-active', section === tableSection);
}

function showRoomSelect() {
  activatePanel(roomSelectSection);
}

function showRoomView() {
  activatePanel(roomViewSection);
}

function showPrivateTablePanel() {
  activatePanel(lobbySection);
}

function showTable() {
  activatePanel(tableSection);
}

function markConnected() {
  statusBadge.textContent = 'Connected';
  statusBadge.style.color = '#7dcca6';
  statusBadge.style.borderColor = 'rgba(125, 204, 166, 0.35)';
  statusBadge.style.background = 'rgba(125, 204, 166, 0.12)';
}

socket.on('disconnect', () => {
  statusBadge.textContent = 'Reconnecting…';
  statusBadge.style.color = '#e9c66d';
  statusBadge.style.borderColor = 'rgba(233, 198, 109, 0.35)';
  statusBadge.style.background = 'rgba(233, 198, 109, 0.12)';
});

const RANK_ORDER = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

function isTrumpCard(card, mode) {
  if (card.suit === 'Spades') return true;
  return mode === 'deuces' && card.rank === '2' && card.suit === 'Diamonds';
}

function trumpPower(card, mode) {
  if (!isTrumpCard(card, mode)) return 0;
  if (mode === 'deuces') {
    if (card.rank === '2' && card.suit === 'Spades') return 100;
    if (card.rank === '2' && card.suit === 'Diamonds') return 99;
  }
  return RANK_ORDER[card.rank];
}

function sortHand(cards, mode = 'ace') {
  const suitOrder = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];

  return [...cards].sort((a, b) => {
    const aTrump = isTrumpCard(a, mode);
    const bTrump = isTrumpCard(b, mode);
    const trumpDiff = Number(bTrump) - Number(aTrump);
    if (trumpDiff !== 0) return trumpDiff;
    if (aTrump && bTrump) return trumpPower(b, mode) - trumpPower(a, mode);
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[char]));
}

function playerInitials(name) {
  const words = String(name || 'Player').trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word[0] || '').join('').toUpperCase() || 'P';
}

function formatBid(bid) {
  if (bid === 0) return 'Nil';
  return bid ?? '&mdash;';
}

function renderSeats() {
  if (!roomState) return;

  tableSeats.innerHTML = '';

  roomState.players.forEach((player, seatIndex) => {
    const seatCard = document.createElement('div');
    const pos = seatLayout(seatIndex);
    seatCard.className = `seat-card seat-${pos.slot}`;
    seatCard.style.left = `${pos.left}%`;
    seatCard.style.top = `${pos.top}%`;

    if (roomState.game && roomState.game.dealerSeat === seatIndex) {
      seatCard.classList.add('dealer');
    }

    if (!player) {
      seatCard.classList.add('empty');
      seatCard.innerHTML = `
        <div class="seat-medallion empty-medallion" aria-hidden="true">${seatIndex + 1}</div>
        <div class="seat-copy">
          <div class="seat-name">Open seat</div>
          <div class="seat-stats"><span>Waiting</span></div>
        </div>
        <span class="seat-badge">Open</span>
      `;
      tableSeats.appendChild(seatCard);
      return;
    }

    if (roomState.game && roomState.game.currentSeat === player.seat && !roomState.game.resolving) {
      seatCard.classList.add('current-turn');
    }

    const partnerSeat = mySeat == null ? null : (mySeat + 2) % 4;
    const isDisconnected = !player.isBot && player.connected === false;
    const isPartner = partnerSeat === player.seat;
    if (isDisconnected) seatCard.classList.add('disconnected');
    if (player.isYou) seatCard.classList.add('is-you');
    if (isPartner) seatCard.classList.add('partner-seat');
    if (player.isBot) seatCard.classList.add('bot-seat');

    const badge = isDisconnected
      ? 'Disconnected'
      : player.isYou
        ? 'You'
        : isPartner
          ? 'Partner'
          : player.isBot
            ? 'Bot'
            : 'Player';
    const tricks = player.tricks ?? 0;
    const safeName = escapeHtml(player.name);
    const initials = player.isBot ? 'AI' : escapeHtml(playerInitials(player.name));
    const canVoteKick = mySeat != null && !player.isYou && !player.isBot;
    const votes = player.votesAgainst || 0;
    const watchers = player.isYou ? (player.watchers || []) : [];

    seatCard.innerHTML = `
      <div class="seat-medallion" aria-hidden="true">${initials}</div>
      <div class="seat-copy">
        <div class="seat-name" title="${safeName}">${safeName}</div>
        <div class="seat-stats">
          <span>Bid <strong>${formatBid(player.bid)}</strong></span>
          <span>Tricks <strong>${tricks}</strong></span>
        </div>
      </div>
      <span class="seat-badge">${badge}</span>
      ${canVoteKick ? `<button type="button" class="vote-kick-btn" title="Vote to kick">Vote kick${votes ? ` (${votes}/2)` : ''}</button>` : ''}
      ${watchers.length ? `<div class="watcher-list">${watchers.map((watcherEntry) => `
        <span class="watcher-chip">${escapeHtml(watcherEntry.name)}<button type="button" class="watcher-boot-btn" data-watcher-id="${watcherEntry.id}" title="Remove watcher">&times;</button></span>
      `).join('')}</div>` : ''}
    `;

    if (canVoteKick) {
      seatCard.querySelector('.vote-kick-btn').addEventListener('click', () => {
        socket.emit('voteKick', { roomCode: roomState.roomCode, targetSeat: seatIndex });
      });
    }

    seatCard.querySelectorAll('.watcher-boot-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        socket.emit('removeWatcher', { roomCode: roomState.roomCode, watcherId: btn.dataset.watcherId });
      });
    });

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
  const cards = sortHand(myPlayer.hand || [], roomState.rankMode);
  const isMyTurn = roomState.game
    && roomState.game.currentSeat === mySeat
    && roomState.game.phase === 'playing'
    && !roomState.game.resolving;

  const isFreshDeal = roomState.game && cards.length === 13 && roomState.game.round !== lastDealtRound;
  if (isFreshDeal) lastDealtRound = roomState.game.round;

  cards.forEach((card, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `card-btn ${isRedSuit(card.suit) ? 'red' : ''}${isFreshDeal ? ' card-dealt' : ''}`;
    button.disabled = !isMyTurn;
    button.innerHTML = cardMarkup(card);
    button.title = `${card.rank} of ${card.suit}`;
    button.style.zIndex = String(index + 1);
    const fanOffset = index - ((cards.length - 1) / 2);
    button.style.setProperty('--fan-angle', `${fanOffset * 3}deg`);
    button.style.setProperty('--fan-lift', `${Math.abs(fanOffset) * 1.2}px`);
    if (isFreshDeal) button.style.setProperty('--deal-delay', `${index * 55}ms`);
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

function joinTable(tableNumber, watchSeat) {
  if (window.SpadesAudio) SpadesAudio.unlock();
  const name = lobbyPlayerNameInput.value.trim() || 'Player';
  const payload = { lobbyRoomId: currentLobbyRoomId, tableNumber, name };
  if (typeof watchSeat === 'number') payload.watchSeat = watchSeat;
  socket.emit('joinTable', payload);
}

function tileSeatMarkup(name, seatIndex, position, locked) {
  if (name) {
    return `<button type="button" class="tile-seat ${position} tile-seat-filled" data-watch-seat="${seatIndex}" title="Watch ${escapeHtml(name)}">${escapeHtml(playerInitials(name))}</button>`;
  }
  if (locked) {
    return `<span class="tile-seat ${position} tile-seat-locked" title="Table locked">&#128274;</span>`;
  }
  return `<button type="button" class="tile-seat ${position} tile-seat-open" title="Join this seat">+</button>`;
}

function renderTableGrid(tables) {
  tableGrid.innerHTML = '';
  tables.forEach((table) => {
    const tile = document.createElement('div');
    tile.className = 'table-tile';
    const isFull = table.seatedCount >= 4;
    const isLocked = Boolean(table.locked);
    if (isFull) tile.classList.add('table-full');
    if (isLocked) tile.classList.add('table-locked');

    const [south, west, north, east] = table.seats;

    tile.innerHTML = `
      <span class="table-tile-number">Table ${table.tableNumber}${isLocked ? ' &#128274;' : ''}</span>
      <div class="tile-felt">
        ${tileSeatMarkup(north, 2, 'seat-n', isLocked)}
        ${tileSeatMarkup(west, 1, 'seat-w', isLocked)}
        <span class="tile-deck" aria-hidden="true"></span>
        ${tileSeatMarkup(east, 3, 'seat-e', isLocked)}
        ${tileSeatMarkup(south, 0, 'seat-s', isLocked)}
      </div>
      <span class="table-tile-occupancy">${table.seatedCount}/4${table.spectatorCount ? ` &middot; ${table.spectatorCount} watching` : ''}</span>
    `;

    if (!isLocked) {
      tile.querySelectorAll('.tile-seat-open').forEach((seatBtn) => {
        seatBtn.addEventListener('click', () => joinTable(table.tableNumber));
      });
      tile.querySelectorAll('.tile-seat-filled').forEach((seatBtn) => {
        seatBtn.addEventListener('click', () => joinTable(table.tableNumber, Number(seatBtn.dataset.watchSeat)));
      });
    }

    tableGrid.appendChild(tile);
  });
}

function renderRoster(roster) {
  rosterList.innerHTML = '';
  roster.forEach((name) => {
    const item = document.createElement('li');
    item.innerHTML = `<span class="rating-star rating-star-${currentLobbyRoomId}">&#9733;</span> 1500 &middot; ${escapeHtml(name)}`;
    rosterList.appendChild(item);
  });
}

function appendChatMessage(message) {
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `<strong>${escapeHtml(message.name)}:</strong> ${escapeHtml(message.text)}`;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}

let tableChatUnread = 0;

function setTableChatUnread(count) {
  tableChatUnread = count;
  tableChatBadge.textContent = String(count);
  tableChatBadge.classList.toggle('hidden', count === 0);
}

function renderTableChatLine(message) {
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `<strong>${escapeHtml(message.name)}:</strong> ${escapeHtml(message.text)}`;
  tableChatLog.appendChild(line);
  tableChatLog.scrollTop = tableChatLog.scrollHeight;
}

function appendTableChatMessage(message) {
  renderTableChatLine(message);
  if (tableChatPanel.classList.contains('hidden')) {
    setTableChatUnread(tableChatUnread + 1);
  }
}

function openTableChat() {
  tableChatPanel.classList.remove('hidden');
  setTableChatUnread(0);
  tableChatInput.focus();
}

function closeTableChat() {
  tableChatPanel.classList.add('hidden');
}

tableChatToggleBtn.addEventListener('click', () => {
  if (tableChatPanel.classList.contains('hidden')) openTableChat();
  else closeTableChat();
});

tableChatCloseBtn.addEventListener('click', closeTableChat);

function sendTableChat() {
  const text = tableChatInput.value.trim();
  if (!text || !roomState || !roomState.roomCode) return;
  socket.emit('sendTableChat', { roomCode: roomState.roomCode, text });
  tableChatInput.value = '';
}

tableChatSendBtn.addEventListener('click', sendTableChat);
tableChatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendTableChat();
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !currentLobbyRoomId) return;
  socket.emit('sendLobbyChat', { lobbyRoomId: currentLobbyRoomId, text });
  chatInput.value = '';
}

function render() {
  if (!roomState) return;

  roomCodeLabel.textContent = roomState.roomCode || '';
  syncRoomUrl(roomState.roomCode);
  lockTableBtn.textContent = roomState.locked ? 'Unlock table' : 'Lock table';
  turnTimerSelect.disabled = !roomState.isHost;
  if (document.activeElement !== turnTimerSelect) {
    turnTimerSelect.value = String(roomState.turnTimerSeconds || 0);
  }
  const canChangeRankMode = roomState.isHost && (!roomState.game || roomState.game.phase === 'finished');
  rankModeSelect.disabled = !canChangeRankMode;
  if (document.activeElement !== rankModeSelect) {
    rankModeSelect.value = roomState.rankMode || 'ace';
  }
  stakeLabel.textContent = roomState.stake || '250';
  if (potValueEl) {
    potValueEl.textContent = `$${roomState.stake || 250}`;
  }
  chipStacks.forEach((stack) => {
    stack.classList.toggle('active-chip', Number(stack.querySelector('span').textContent) === Number(roomState.stake || 250));
  });

  const playerCount = roomState.players.filter(Boolean).length;
  const matchOver = Boolean(roomState.game && roomState.game.matchOver);
  const finished = roomState.game && roomState.game.phase === 'finished' && !matchOver;
  const canStart = roomState.isHost && playerCount > 0 && (!roomState.game || matchOver);
  const canDealNext = roomState.isHost && finished;

  startGameBtn.disabled = !(canStart || canDealNext);
  if (canDealNext) {
    startGameBtn.textContent = 'Deal next hand';
    startGameBtn.disabled = false;
  } else if (finished) {
    startGameBtn.textContent = 'Dealing next hand...';
    startGameBtn.disabled = true;
  } else if (matchOver && canStart) {
    startGameBtn.textContent = 'Start new match';
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
  tableSection.classList.toggle('is-bidding', Boolean(biddingOpen));
  tableSection.dataset.phase = roomState.game ? roomState.game.phase : 'lobby';
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

socket.on('lobbyState', (payload) => {
  if (payload.lobbyRoomId !== currentLobbyRoomId) return;
  renderTableGrid(payload.tables);
  renderRoster(payload.roster);
});

socket.on('tableChatHistory', (history) => {
  tableChatLog.innerHTML = '';
  setTableChatUnread(0);
  (history || []).forEach(renderTableChatLine);
});

socket.on('tableChatMessage', (message) => {
  appendTableChatMessage(message);
});

socket.on('lobbyChatHistory', (history) => {
  chatLog.innerHTML = '';
  (history || []).forEach(appendChatMessage);
});

socket.on('lobbyChatMessage', (message) => {
  appendChatMessage(message);
});

socket.on('errorMessage', (message) => {
  if (roomViewSection.classList.contains('active') || roomSelectSection.classList.contains('active')) {
    setLobbyError(message);
  } else if (tableSection.classList.contains('active')) {
    showTableCall(message);
  } else {
    setError(message);
  }
});

roomCards.forEach((card) => {
  card.addEventListener('click', () => {
    if (window.SpadesAudio) SpadesAudio.unlock();
    const lobbyRoomId = card.dataset.lobbyRoom;
    const name = lobbyPlayerNameInput.value.trim() || 'Player';
    currentLobbyRoomId = lobbyRoomId;
    roomViewTitle.textContent = LOBBY_ROOM_LABELS[lobbyRoomId] || 'Room';
    tableGrid.innerHTML = '';
    rosterList.innerHTML = '';
    chatLog.innerHTML = '';
    setLobbyError('');
    socket.emit('joinLobby', { lobbyRoomId, name });
    showRoomView();
  });
});

backToRoomsBtn.addEventListener('click', () => {
  socket.emit('leaveLobby');
  currentLobbyRoomId = null;
  showRoomSelect();
});

backToRoomsFromPrivateBtn.addEventListener('click', () => {
  showRoomSelect();
});

showPrivateTableBtn.addEventListener('click', () => {
  playerNameInput.value = lobbyPlayerNameInput.value;
  showPrivateTablePanel();
});

chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendChatMessage();
});

createRoomBtn.addEventListener('click', () => {
  if (window.SpadesAudio) SpadesAudio.unlock();
  const name = playerNameInput.value.trim() || 'Host';
  const stake = Number(stakeSelect.value);
  const rankMode = createRankModeSelect.value;
  socket.emit('createRoom', { name, stake, rankMode, sessionToken });
  setError('');
});

rankModeSelect.addEventListener('change', () => {
  if (!roomState || !roomState.roomCode) return;
  socket.emit('setRankMode', { roomCode: roomState.roomCode, rankMode: rankModeSelect.value });
});

joinRoomBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Player';
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    setError('Enter a room code to join.');
    return;
  }

  socket.emit('joinRoom', { code: roomCode, name, sessionToken });
  setError('');
});

startGameBtn.addEventListener('click', () => {
  if (!roomState || !roomState.roomCode) return;
  if (window.SpadesAudio) {
    SpadesAudio.unlock();
    SpadesAudio.deal();
  }
  if (roomState.game && roomState.game.phase === 'finished' && !roomState.game.matchOver) {
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
  if (!soundToggles.length || !window.SpadesAudio) return;
  const on = !SpadesAudio.isMuted();
  soundToggles.forEach((toggle) => {
    toggle.textContent = on ? 'Sound test' : 'Sound off';
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggle.title = on ? 'Play test sound' : 'Turn sound on';
  });
}

function activateSoundToggle() {
  if (!window.SpadesAudio) return;
  SpadesAudio.unlock();
  if (SpadesAudio.isMuted()) SpadesAudio.setMuted(false);
  else SpadesAudio.ping();
  syncSoundToggle();
}

soundToggles.forEach((toggle) => {
  let lastPointerSoundAt = 0;
  syncSoundToggle();
  toggle.addEventListener('pointerdown', () => {
    lastPointerSoundAt = Date.now();
    activateSoundToggle();
  });
  toggle.addEventListener('click', () => {
    if (Date.now() - lastPointerSoundAt < 500) return;
    activateSoundToggle();
  });
  toggle.addEventListener('dblclick', () => {
    SpadesAudio.setMuted(true);
    syncSoundToggle();
  });
});

turnTimerSelect.addEventListener('change', () => {
  if (!roomState || !roomState.roomCode) return;
  socket.emit('setTurnTimer', { roomCode: roomState.roomCode, seconds: Number(turnTimerSelect.value) });
});

lockTableBtn.addEventListener('click', () => {
  if (!roomState || !roomState.roomCode) return;
  socket.emit('toggleTableLock', { roomCode: roomState.roomCode });
});

leaveTableBtn.addEventListener('click', () => {
  if (!roomState || !roomState.roomCode) return;
  const wasLobbyTable = Boolean(roomState.lobbyRoomId);
  socket.emit('leaveTable', { roomCode: roomState.roomCode });
  roomState = null;
  mySeat = null;
  tableChatLog.innerHTML = '';
  setTableChatUnread(0);
  closeTableChat();
  if (wasLobbyTable) {
    showRoomView();
  } else {
    showRoomSelect();
  }
});

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
