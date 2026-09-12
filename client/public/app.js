const SESSION_STORAGE_KEY = 'spades.sessionToken';
let sessionToken = window.localStorage.getItem(SESSION_STORAGE_KEY);
if (!sessionToken) {
  sessionToken = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
}

const ACCOUNT_TOKEN_KEY = 'spades.accountToken';
let accountToken = window.localStorage.getItem(ACCOUNT_TOKEN_KEY);
let currentPlayer = null;

const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 12,
  auth: { sessionToken },
});

const authGateSection = document.getElementById('authGate');
const roomSelectSection = document.getElementById('roomSelect');
const roomViewSection = document.getElementById('roomView');
const lobbySection = document.getElementById('lobby');
const tableSection = document.getElementById('table');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const showSignupBtn = document.getElementById('showSignupBtn');
const signupScreenName = document.getElementById('signupScreenName');
const signupEmail = document.getElementById('signupEmail');
const signupPassword = document.getElementById('signupPassword');
const signupPasswordConfirm = document.getElementById('signupPasswordConfirm');
const showLoginBtn = document.getElementById('showLoginBtn');
const authErrorBox = document.getElementById('authErrorBox');
const lobbyPlayerNameInput = document.getElementById('lobbyPlayerName');
const roomCards = [...document.querySelectorAll('[data-lobby-room]')];
const quickJoinBtn = document.getElementById('quickJoinBtn');
const lobbyActivityLine = document.getElementById('lobbyActivityLine');
const showPrivateTableBtn = document.getElementById('showPrivateTableBtn');
const backToRoomsBtn = document.getElementById('backToRoomsBtn');
const backToRoomsFromPrivateBtn = document.getElementById('backToRoomsFromPrivateBtn');
const roomViewTitle = document.getElementById('roomViewTitle');
const roomViewSummary = document.getElementById('roomViewSummary');
const tableGrid = document.getElementById('tableGrid');
const rosterList = document.getElementById('rosterList');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const lobbyErrorBox = document.getElementById('lobbyErrorBox');
const showLeaderboardBtn = document.getElementById('showLeaderboardBtn');
const leaderboardModal = document.getElementById('leaderboardModal');
const leaderboardCloseBtn = document.getElementById('leaderboardCloseBtn');
const leaderboardList = document.getElementById('leaderboardList');
const statusBadge = document.getElementById('statusBadge');
const accountChip = document.getElementById('accountChip');
const accountScreenName = document.getElementById('accountScreenName');
const accountRating = document.getElementById('accountRating');
const logoutBtn = document.getElementById('logoutBtn');
const roomCodeLabel = document.getElementById('roomCodeLabel');
const stakeLabel = document.getElementById('stakeLabel');
const errorBox = document.getElementById('errorBox');
const roomCodeInput = document.getElementById('roomCodeInput');
const playerNameInput = document.getElementById('playerName');
const stakeSelect = document.getElementById('stakeSelect');
const tableStakeSelect = document.getElementById('tableStakeSelect');
const allowNilToggle = document.getElementById('allowNilToggle');
const blindNilThresholdSelect = document.getElementById('blindNilThresholdSelect');
const lowClubLeadToggle = document.getElementById('lowClubLeadToggle');
const tenFor200Toggle = document.getElementById('tenFor200Toggle');
const allowWatchersToggle = document.getElementById('allowWatchersToggle');
const tableOptionsGroup = document.getElementById('tableOptionsGroup');
const tableOptionsWrap = document.getElementById('tableOptionsWrap');
const tableOptionsBtn = document.getElementById('tableOptionsBtn');
const tableOptionsCloseBtn = document.getElementById('tableOptionsCloseBtn');
const createRankModeSelect = document.getElementById('createRankModeSelect');
const rankModeSelect = document.getElementById('rankModeSelect');
const tableStyleSelect = document.getElementById('tableStyleSelect');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const startGameBtn = document.getElementById('startGameBtn');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const leaveTableBtn = document.getElementById('leaveTableBtn');
const lockTableBtn = document.getElementById('lockTableBtn');
const lastTrickBtn = document.getElementById('lastTrickBtn');
const lastTrickModal = document.getElementById('lastTrickModal');
const lastTrickCloseBtn = document.getElementById('lastTrickCloseBtn');
const lastTrickWinner = document.getElementById('lastTrickWinner');
const lastTrickCards = document.getElementById('lastTrickCards');
const roomPeekBtn = document.getElementById('roomPeekBtn');
const roomPeekModal = document.getElementById('roomPeekModal');
const roomPeekCloseBtn = document.getElementById('roomPeekCloseBtn');
const roomPeekTitle = document.getElementById('roomPeekTitle');
const roomPeekGrid = document.getElementById('roomPeekGrid');
const roomPeekRoster = document.getElementById('roomPeekRoster');
const tableChatLog = document.getElementById('tableChatLog');
const tableChatInput = document.getElementById('tableChatInput');
const tableChatSendBtn = document.getElementById('tableChatSendBtn');
const tablePlayerList = document.getElementById('tablePlayerList');
const tableWatcherList = document.getElementById('tableWatcherList');
const turnTimerSelect = document.getElementById('turnTimerSelect');
const turnCountdownEl = document.getElementById('turnCountdown');
const turnStatusLine = document.getElementById('turnStatusLine');
const voiceSelect = document.getElementById('voiceSelect');
const deckSelect = document.getElementById('deckSelect');
const showQrBtn = document.getElementById('showQrBtn');
const ownerMenuWrap = document.getElementById('ownerMenuWrap');
const ownerMenuBtn = document.getElementById('ownerMenuBtn');
const ownerMenu = document.getElementById('ownerMenu');
const qrModal = document.getElementById('qrModal');
const qrCloseBtn = document.getElementById('qrCloseBtn');
const qrImage = document.getElementById('qrImage');
const qrInviteText = document.getElementById('qrInviteText');
const standUpBtn = document.getElementById('standUpBtn');
const blindBidRow = document.getElementById('blindBidRow');
const normalBidRow = document.querySelector('.bid-row');
const blindNilBtn = document.getElementById('blindNilBtn');
const viewHandBtn = document.getElementById('viewHandBtn');
const contractLabel = document.getElementById('contractLabel');
const awayHostPanel = document.getElementById('awayHostPanel');
const awayHostTitle = document.getElementById('awayHostTitle');
const awayHostText = document.getElementById('awayHostText');
const awayAutoBtn = document.getElementById('awayAutoBtn');
const awayWaitBtn = document.getElementById('awayWaitBtn');
const resumeGameBtn = document.getElementById('resumeGameBtn');
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
let quickJoinPending = false;
let countdownInterval = null;
const DECK_STORAGE_KEY = 'spades.deckStyle';

const LOBBY_ROOM_LABELS = {
  beginner: 'Beginner Room',
  advance: 'Advanced Room',
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
  socket.emit('joinRoom', { code: pendingRoomCode, name, accountToken });
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

function setAuthError(message) {
  if (!message) {
    authErrorBox.classList.add('hidden');
    authErrorBox.textContent = '';
    return;
  }
  authErrorBox.textContent = message;
  authErrorBox.classList.remove('hidden');
}

function activatePanel(section) {
  [authGateSection, roomSelectSection, roomViewSection, lobbySection, tableSection].forEach((panel) => {
    panel.classList.toggle('active', panel === section);
  });
  document.body.classList.toggle('game-active', section === tableSection);
  document.body.classList.toggle('room-browsing', section === roomViewSection);
  document.body.classList.toggle('room-select-active', section === roomSelectSection);
  document.body.classList.toggle('auth-gate-active', section === authGateSection);
}

function showRoomSelect() {
  activatePanel(roomSelectSection);
  refreshLobbyOverview();
}

function showAuthGate() {
  activatePanel(authGateSection);
}

function applyCurrentPlayer(player) {
  currentPlayer = player;
  lobbyPlayerNameInput.value = player.screenName;
  lobbyPlayerNameInput.readOnly = true;
  playerNameInput.value = player.screenName;
  playerNameInput.readOnly = true;
  accountScreenName.textContent = player.screenName;
  accountRating.textContent = `${player.eloRating}`;
  accountChip.classList.remove('hidden');
}

function clearCurrentPlayer() {
  currentPlayer = null;
  accountToken = null;
  window.localStorage.removeItem(ACCOUNT_TOKEN_KEY);
  accountChip.classList.add('hidden');
  lobbyPlayerNameInput.readOnly = false;
  playerNameInput.readOnly = false;
}

async function bootstrapAuth() {
  if (!accountToken) {
    showAuthGate();
    return;
  }
  try {
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${accountToken}` } });
    if (!res.ok) throw new Error('session invalid');
    const { player } = await res.json();
    applyCurrentPlayer(player);
    showRoomSelect();
  } catch {
    clearCurrentPlayer();
    showAuthGate();
  }
}

bootstrapAuth();

showSignupBtn.addEventListener('click', () => {
  setAuthError('');
  loginForm.classList.add('hidden');
  signupForm.classList.remove('hidden');
});

showLoginBtn.addEventListener('click', () => {
  setAuthError('');
  signupForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthError('');
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: loginEmail.value, password: loginPassword.value }),
    });
    const json = await res.json();
    if (!res.ok) {
      setAuthError(json.message || 'Could not log in.');
      return;
    }
    accountToken = json.token;
    window.localStorage.setItem(ACCOUNT_TOKEN_KEY, accountToken);
    applyCurrentPlayer(json.player);
    loginPassword.value = '';
    showRoomSelect();
  } catch {
    setAuthError('Could not reach the server, try again.');
  }
});

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthError('');
  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        screenName: signupScreenName.value,
        email: signupEmail.value,
        password: signupPassword.value,
        passwordConfirm: signupPasswordConfirm.value,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setAuthError(json.message || 'Could not create your account.');
      return;
    }
    accountToken = json.token;
    window.localStorage.setItem(ACCOUNT_TOKEN_KEY, accountToken);
    applyCurrentPlayer(json.player);
    signupPassword.value = '';
    signupPasswordConfirm.value = '';
    showRoomSelect();
  } catch {
    setAuthError('Could not reach the server, try again.');
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accountToken}` },
    });
  } catch {
    // best-effort, we clear local state regardless
  }
  clearCurrentPlayer();
  showAuthGate();
});

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

function isTrumpCard(card) {
  return card.suit === 'Spades';
}

// In 2s-high (deuces) mode, a 2 outranks the ace within its own suit;
// spades is still the only trump suit.
function rankValue(card, mode) {
  if (mode === 'deuces' && card.rank === '2') return 15;
  return RANK_ORDER[card.rank];
}

const SUIT_ORDER = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
// House rule: among the four boss deuces, hearts outranks spades. Kept
// separate from SUIT_ORDER, which still governs normal suit grouping.
const DEUCE_ORDER = ['Hearts', 'Spades', 'Clubs', 'Diamonds'];

function sortByTrumpAndSuit(cards, mode) {
  return [...cards].sort((a, b) => {
    const aTrump = isTrumpCard(a);
    const bTrump = isTrumpCard(b);
    const trumpDiff = Number(bTrump) - Number(aTrump);
    if (trumpDiff !== 0) return trumpDiff;
    if (aTrump && bTrump) return rankValue(b, mode) - rankValue(a, mode);
    const suitDiff = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return rankValue(b, mode) - rankValue(a, mode);
  });
}

// In 2s-high mode the deuces are grouped at the very front of the hand
// (heart 2 first, then spades/clubs/diamonds), ahead of the aces, matching
// how the server treats them as a top-of-hand group rather than just the
// top card within each suit's own section.
function sortHand(cards, mode = 'ace') {
  if (mode !== 'deuces') return sortByTrumpAndSuit(cards, mode);

  const twos = cards.filter((card) => card.rank === '2')
    .sort((a, b) => DEUCE_ORDER.indexOf(a.suit) - DEUCE_ORDER.indexOf(b.suit));
  const rest = cards.filter((card) => card.rank !== '2');
  return [...twos, ...sortByTrumpAndSuit(rest, mode)];
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

function formatBid(playerOrBid) {
  const bid = typeof playerOrBid === 'object' && playerOrBid ? playerOrBid.bid : playerOrBid;
  const blindNil = typeof playerOrBid === 'object' && playerOrBid ? playerOrBid.blindNil : false;
  if (blindNil) return 'Blind Nil';
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
      const canSit = Boolean(roomState.isSpectator);
      seatCard.innerHTML = `
        <div class="seat-medallion empty-medallion" aria-hidden="true">${seatIndex + 1}</div>
        <div class="seat-copy">
          <div class="seat-name">Open seat</div>
          <div class="seat-stats"><span>Waiting</span></div>
        </div>
        <span class="seat-badge">Open</span>
        ${canSit ? '<button type="button" class="sit-here-btn">Sit Here</button>' : ''}
      `;
      if (canSit) {
        seatCard.querySelector('.sit-here-btn').addEventListener('click', () => {
          socket.emit('claimSeat', { roomCode: roomState.roomCode, seat: seatIndex });
        });
      }
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
    if (player.away) seatCard.classList.add('away-seat');
    if (player.blindNil) seatCard.classList.add('blind-nil-seat');
    if (player.bid === 0 && !player.blindNil) seatCard.classList.add('nil-seat');
    if (player.isYou) seatCard.classList.add('is-you');
    if (isPartner) seatCard.classList.add('partner-seat');
    if (player.isBot) seatCard.classList.add('bot-seat');

    const badge = player.away
      ? (player.autoPlayingAway ? 'AUTO-PLAYING' : 'AWAY')
      : isDisconnected
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
    const canSitHere = Boolean(roomState.isSpectator) && player.isBot;
    const votes = player.votesAgainst || 0;
    const watchers = player.isYou ? (player.watchers || []) : [];

    seatCard.innerHTML = `
      <div class="seat-medallion" aria-hidden="true">${initials}</div>
      <div class="seat-copy">
        <div class="seat-name" title="${safeName}">${player.crowned ? '<span class="seat-crown" aria-hidden="true">&#128081;</span>' : ''}${safeName}</div>
        <div class="seat-stats">
          <span>Bid <strong>${formatBid(player)}</strong></span>
          <span>Tricks <strong>${tricks}</strong></span>
        </div>
      </div>
      <span class="seat-badge">${badge}</span>
      ${player.blindNil ? '<span class="seat-special-badge">BLIND NIL</span>' : player.bid === 0 ? '<span class="seat-special-badge nil-badge">NIL</span>' : ''}
      ${canVoteKick ? `<button type="button" class="vote-kick-btn" title="Vote to kick">Vote kick${votes ? ` (${votes}/2)` : ''}</button>` : ''}
      ${canSitHere ? '<button type="button" class="sit-here-btn">Sit Here</button>' : ''}
      ${watchers.length ? `<div class="watcher-list">${watchers.map((watcherEntry) => `
        <span class="watcher-chip">${escapeHtml(watcherEntry.name)}<button type="button" class="watcher-boot-btn" data-watcher-id="${watcherEntry.id}" title="Remove watcher">&times;</button></span>
      `).join('')}</div>` : ''}
    `;

    if (canVoteKick) {
      seatCard.querySelector('.vote-kick-btn').addEventListener('click', () => {
        socket.emit('voteKick', { roomCode: roomState.roomCode, targetSeat: seatIndex });
      });
    }

    if (canSitHere) {
      seatCard.querySelector('.sit-here-btn').addEventListener('click', () => {
        socket.emit('claimSeat', { roomCode: roomState.roomCode, seat: seatIndex });
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
  if (roomState.game && roomState.game.phase === 'bidding' && !myPlayer.handRevealed) {
    for (let index = 0; index < 13; index += 1) {
      const back = document.createElement('div');
      back.className = 'card-btn card-back preview-back';
      back.style.zIndex = String(index + 1);
      const fanOffset = index - 6;
      back.style.setProperty('--fan-angle', `${fanOffset * 3}deg`);
      back.style.setProperty('--fan-lift', `${Math.abs(fanOffset) * 1.2}px`);
      handArea.appendChild(back);
    }
    return;
  }

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
  const payload = { lobbyRoomId: currentLobbyRoomId, tableNumber, name, accountToken };
  if (typeof watchSeat === 'number') payload.watchSeat = watchSeat;
  socket.emit('joinTable', payload);
}

const TABLES_PER_PAGE = 8;
let tableGridPage = 0;

function tileSeatMarkup(name, seatIndex, position, locked) {
  if (name) {
    return `
      <button type="button" class="premium-seat ${position} premium-seat-filled" data-watch-seat="${seatIndex}" title="Watch ${escapeHtml(name)}">
        <span class="seat-chair"></span>
        <span class="seat-avatar">${escapeHtml(playerInitials(name))}</span>
        <span class="seat-name">${escapeHtml(name)}</span>
      </button>`;
  }
  if (locked) {
    return `
      <span class="premium-seat ${position} premium-seat-locked" title="Table locked">
        <span class="seat-chair"></span>
        <span class="seat-lock">&#128274;</span>
      </span>`;
  }
  return `
    <button type="button" class="premium-seat ${position} premium-seat-open" title="Join this seat">
      <span class="seat-chair"></span>
      <span class="seat-plus">+</span>
    </button>`;
}

function renderTableGrid(tables, targetEl = tableGrid, interactive = true) {
  targetEl.innerHTML = '';
  const pageCount = Math.max(1, Math.ceil(tables.length / TABLES_PER_PAGE));
  if (interactive && tableGridPage >= pageCount) tableGridPage = pageCount - 1;
  const page = interactive
    ? tables.slice(tableGridPage * TABLES_PER_PAGE, tableGridPage * TABLES_PER_PAGE + TABLES_PER_PAGE)
    : tables;

  page.forEach((table) => {
    const tile = document.createElement('div');
    tile.className = 'premium-table-card';
    const isFull = table.seatedCount >= 4;
    const isLocked = Boolean(table.locked);
    if (isFull) tile.classList.add('table-full');
    if (isLocked) tile.classList.add('table-locked');

    const [south, west, north, east] = table.seats;
    const statusKey = isLocked ? 'locked' : table.inProgress ? 'in-progress' : isFull ? 'full' : 'open';
    const statusLabel = isLocked ? 'Locked' : table.inProgress ? 'In progress' : isFull ? 'Full' : 'Open';
    const modeLabel = table.rankMode === 'deuces' ? '2s high' : 'Standard';

    tile.innerHTML = `
      <div class="premium-table-topline">
        <span class="premium-table-plaque">Table ${table.tableNumber}</span>
        <span class="premium-table-status status-${statusKey}">${statusLabel}</span>
      </div>
      <div class="premium-rail">
        <div class="premium-felt">
          ${tileSeatMarkup(north, 2, 'seat-n', isLocked)}
          ${tileSeatMarkup(west, 1, 'seat-w', isLocked)}
          ${tileSeatMarkup(east, 3, 'seat-e', isLocked)}
          ${tileSeatMarkup(south, 0, 'seat-s', isLocked)}
          <span class="premium-felt-plaque">$${table.stake}</span>
        </div>
      </div>
      <div class="premium-table-footer">
        <span class="premium-table-meta">${table.seatedCount}/4 seated${table.spectatorCount ? ` &middot; ${table.spectatorCount} watching` : ''} &middot; ${modeLabel}</span>
        <button type="button" class="premium-table-action" data-table-join>${isFull ? 'View' : 'Join'}</button>
      </div>
    `;

    if (interactive && !isLocked) {
      tile.querySelectorAll('.premium-seat-open').forEach((seatBtn) => {
        seatBtn.addEventListener('click', () => joinTable(table.tableNumber));
      });
      tile.querySelectorAll('.premium-seat-filled').forEach((seatBtn) => {
        seatBtn.addEventListener('click', () => joinTable(table.tableNumber, Number(seatBtn.dataset.watchSeat)));
      });
      const actionBtn = tile.querySelector('[data-table-join]');
      if (actionBtn) actionBtn.addEventListener('click', () => joinTable(table.tableNumber));
    } else {
      tile.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });
    }

    targetEl.appendChild(tile);
  });

  if (interactive) renderTablePager(tables.length, pageCount, targetEl);
}

function renderTablePager(totalTables, pageCount, gridEl) {
  const existing = gridEl.parentElement && gridEl.parentElement.querySelector('.table-pager');
  if (existing) existing.remove();
  if (pageCount <= 1) return;

  const pager = document.createElement('div');
  pager.className = 'table-pager';
  const start = tableGridPage * TABLES_PER_PAGE + 1;
  const end = Math.min(totalTables, start + TABLES_PER_PAGE - 1);
  pager.innerHTML = `
    <button type="button" data-page-dir="-1" ${tableGridPage === 0 ? 'disabled' : ''}>Prev</button>
    <span>Tables ${start}&ndash;${end} of ${totalTables}</span>
    <button type="button" data-page-dir="1" ${tableGridPage >= pageCount - 1 ? 'disabled' : ''}>Next</button>
  `;
  pager.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      tableGridPage += Number(btn.dataset.pageDir);
      if (latestLobbyState) renderTableGrid(latestLobbyState.tables);
    });
  });
  gridEl.insertAdjacentElement('afterend', pager);
}

function renderRoster(roster, targetEl = rosterList) {
  targetEl.innerHTML = '';
  roster.forEach((name) => {
    const item = document.createElement('li');
    item.innerHTML = `<span class="rating-star rating-star-${currentLobbyRoomId}">&#9733;</span> 1500 &middot; ${escapeHtml(name)}`;
    targetEl.appendChild(item);
  });
}

function appendChatMessage(message) {
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `<strong>${escapeHtml(message.name)}:</strong> ${escapeHtml(message.text)}`;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderTableChatLine(message) {
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `<strong>${escapeHtml(message.name)}:</strong> ${escapeHtml(message.text)}`;
  tableChatLog.appendChild(line);
  tableChatLog.scrollTop = tableChatLog.scrollHeight;
}

function renderTableRosters() {
  if (!roomState) return;
  tablePlayerList.innerHTML = '';
  roomState.players.filter(Boolean).forEach((player) => {
    const item = document.createElement('li');
    item.textContent = player.isBot ? `${player.name} (bot)` : player.name;
    tablePlayerList.appendChild(item);
  });

  const watchers = roomState.spectatorNames || [];
  if (watchers.length) {
    tableWatcherList.classList.remove('table-roster-empty');
    tableWatcherList.textContent = '';
    watchers.forEach((name) => {
      const item = document.createElement('li');
      item.textContent = name;
      tableWatcherList.appendChild(item);
    });
  } else {
    tableWatcherList.classList.add('table-roster-empty');
    tableWatcherList.textContent = 'Nobody yet';
  }
}

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

function sendTableOptions() {
  if (!roomState || !roomState.roomCode) return;
  socket.emit('setTableOptions', {
    roomCode: roomState.roomCode,
    stake: tableStakeSelect ? Number(tableStakeSelect.value) : roomState.stake,
    allowNil: allowNilToggle ? allowNilToggle.checked : roomState.allowNil !== false,
    lowClubLead: lowClubLeadToggle ? lowClubLeadToggle.checked : Boolean(roomState.lowClubLead),
    tenFor200Enabled: tenFor200Toggle ? tenFor200Toggle.checked : roomState.tenFor200Enabled !== false,
    allowWatchers: allowWatchersToggle ? allowWatchersToggle.checked : roomState.allowWatchers !== false,
    blindNilThreshold: blindNilThresholdSelect ? Number(blindNilThresholdSelect.value) : roomState.blindNilThreshold,
  });
}

function runOwnerCommand(command) {
  if (!command || !roomState || !roomState.roomCode) return;
  socket.emit('ownerCommand', { roomCode: roomState.roomCode, command, accountToken });
}

function render() {
  if (!roomState) return;

  roomCodeLabel.textContent = roomState.roomCode || '';
  syncRoomUrl(roomState.roomCode);
  renderTableRosters();
  lockTableBtn.textContent = roomState.locked ? 'Unlock table' : 'Lock table';
  lastTrickBtn.disabled = !(roomState.game && roomState.game.lastTrick);
  roomPeekBtn.classList.toggle('hidden', !currentLobbyRoomId);
  if (lastTrickBtn.disabled) lastTrickModal.classList.add('hidden');
  turnTimerSelect.disabled = !roomState.isHost;
  if (document.activeElement !== turnTimerSelect) {
    turnTimerSelect.value = String(roomState.turnTimerSeconds || 0);
  }
  const canChangeRankMode = roomState.isHost && (!roomState.game || roomState.game.phase === 'finished');
  rankModeSelect.disabled = !canChangeRankMode;
  if (document.activeElement !== rankModeSelect) {
    rankModeSelect.value = roomState.rankMode || 'ace';
  }
  const canChangeTableOptions = canChangeRankMode;
  if (tableOptionsWrap) {
    tableOptionsWrap.classList.toggle('hidden', !roomState.isHost);
    if (!roomState.isHost && tableOptionsGroup) tableOptionsGroup.classList.add('hidden');
  }
  if (tableStakeSelect) {
    tableStakeSelect.disabled = !canChangeTableOptions;
    if (document.activeElement !== tableStakeSelect) tableStakeSelect.value = String(roomState.stake || 250);
  }
  if (allowNilToggle) {
    allowNilToggle.disabled = !canChangeTableOptions;
    allowNilToggle.checked = roomState.allowNil !== false;
  }
  if (lowClubLeadToggle) {
    lowClubLeadToggle.disabled = !canChangeTableOptions;
    lowClubLeadToggle.checked = Boolean(roomState.lowClubLead);
  }
  if (tenFor200Toggle) {
    tenFor200Toggle.disabled = !canChangeTableOptions;
    tenFor200Toggle.checked = roomState.tenFor200Enabled !== false;
  }
  if (blindNilThresholdSelect) {
    blindNilThresholdSelect.disabled = !canChangeTableOptions;
    if (document.activeElement !== blindNilThresholdSelect) {
      blindNilThresholdSelect.value = String(roomState.blindNilThreshold || 150);
    }
  }
  if (allowWatchersToggle) {
    allowWatchersToggle.disabled = !roomState.isHost;
    allowWatchersToggle.checked = roomState.allowWatchers !== false;
  }
  if (bidSelect) {
    const nilOption = bidSelect.querySelector('option[value="0"]');
    if (nilOption) nilOption.disabled = roomState.allowNil === false;
    if (roomState.allowNil === false && bidSelect.value === '0') bidSelect.value = '1';
  }
  if (ownerMenuWrap) {
    ownerMenuWrap.classList.toggle('hidden', !roomState.isOwner);
    if (!roomState.isOwner && ownerMenu) ownerMenu.classList.add('hidden');
  }
  if (stakeLabel) stakeLabel.textContent = roomState.stake || '250';
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
  const needsBlindChoice = Boolean(isMyBidTurn && myPlayer && !alreadyBid && !myPlayer.handRevealed && !myPlayer.away);
  const showNormalBid = Boolean(isMyBidTurn && myPlayer && myPlayer.handRevealed && !alreadyBid && !myPlayer.away);
  tableSection.classList.toggle('show-blind-bid', needsBlindChoice);
  tableSection.classList.toggle('show-normal-bid', showNormalBid);
  if (blindBidRow) blindBidRow.classList.toggle('hidden', !needsBlindChoice);
  if (blindNilBtn) {
    const myTeam = myPlayer ? myPlayer.team : null;
    const otherTeam = myTeam === 0 ? 1 : 0;
    const scores = (roomState.game && roomState.game.scores) || { 0: 0, 1: 0 };
    const threshold = roomState.blindNilThreshold || 150;
    const blindNilEligible = myTeam != null && (scores[otherTeam] || 0) - (scores[myTeam] || 0) >= threshold;
    blindNilBtn.classList.toggle('hidden', !blindNilEligible);
  }
  if (normalBidRow) normalBidRow.classList.toggle('hidden', !showNormalBid);
  bidSelect.disabled = !showNormalBid;
  bidBtn.disabled = !showNormalBid;
  if (contractLabel) {
    const labels = activeTenFor200Labels();
    contractLabel.textContent = labels.join(' · ');
    contractLabel.classList.toggle('hidden', labels.length === 0);
  }
  if (standUpBtn) {
    standUpBtn.disabled = !myPlayer || Boolean(roomState.isSpectator);
    standUpBtn.textContent = myPlayer && myPlayer.away ? "I'm Back" : 'Stand Up';
  }
  renderAwayHostPanel();
  renderCountdown();
  if (biddingOpen && !isMyBidTurn && !alreadyBid) {
    const waiter = roomState.players[roomState.game.currentSeat];
    if (waiter && gameMessage && !String(gameMessage.textContent || '').includes('bids')) {
      gameMessage.textContent = `Waiting for ${waiter.name} to bid.`;
    }
  }showTable();
  renderSeats();
  renderHand();
  renderTrick();
}

tableStyleSelect.addEventListener('change', () => {
  applyTableTheme();
});

applyTableTheme();
function applyDeckStyle(value = (deckSelect && deckSelect.value) || 'classic') {
  document.body.dataset.deckStyle = value || 'classic';
  if (deckSelect && deckSelect.value !== value) deckSelect.value = value;
  window.localStorage.setItem(DECK_STORAGE_KEY, value || 'classic');
}

function populateVoiceSelect() {
  if (!voiceSelect || !window.SpadesAudio) return;
  const selected = SpadesAudio.getVoice ? SpadesAudio.getVoice() : 'auto';
  const voices = SpadesAudio.listVoices ? SpadesAudio.listVoices() : [];
  voiceSelect.innerHTML = '<option value="auto">Auto voice</option>';
  voices.forEach((voice) => {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = `${voice.name}${voice.lang ? ` (${voice.lang})` : ''}`;
    voiceSelect.appendChild(option);
  });
  voiceSelect.value = voices.some((voice) => voice.name === selected) ? selected : 'auto';
}

function countdownSeconds(game = roomState && roomState.game) {
  if (!game || !game.turnDeadlineAt || game.paused || game.resolving) return null;
  return Math.max(0, Math.ceil((Number(game.turnDeadlineAt) - Date.now()) / 1000));
}

function renderCountdown() {
  if (!turnCountdownEl || !turnStatusLine) return;
  const game = roomState && roomState.game;
  const seconds = countdownSeconds(game);
  turnCountdownEl.classList.remove('urgent', 'danger');
  if (seconds == null || !game || game.currentSeat == null) {
    turnCountdownEl.textContent = '';
    return;
  }
  const isMine = Number(game.currentSeat) === Number(mySeat);
  turnCountdownEl.textContent = `${isMine ? 'YOUR TURN' : 'TURN'} · ${seconds}s`;
  if (seconds <= 5) turnCountdownEl.classList.add('danger');
  else if (seconds <= 10) turnCountdownEl.classList.add('urgent');
}

function startCountdownLoop() {
  if (countdownInterval) window.clearInterval(countdownInterval);
  countdownInterval = window.setInterval(renderCountdown, 1000);
}

function activeTenFor200Labels() {
  const contracts = roomState && roomState.game && roomState.game.teamContracts;
  if (!contracts) return [];
  return [0, 1]
    .filter((team) => contracts[team] && contracts[team].tenFor200)
    .map((team) => `Team ${team + 1} 10 FOR 200`);
}

function renderAwayHostPanel() {
  if (!awayHostPanel || !roomState || !roomState.game) return;
  const game = roomState.game;
  const seat = game.awaitingHostResume ? game.waitingForAwaySeat : (game.awayPromptSeat ?? game.waitingForAwaySeat);
  const player = seat != null ? roomState.players[seat] : null;
  const show = Boolean(roomState.isHost && player && (player.away || game.awaitingHostResume || game.waitingForAwaySeat != null));
  awayHostPanel.classList.toggle('hidden', !show);
  if (!show) return;
  awayHostTitle.textContent = game.awaitingHostResume ? 'PLAYER BACK' : (game.waitingForAwaySeat != null ? 'WAITING FOR PLAYER' : 'AWAY PLAYER');
  awayHostText.textContent = game.awaitingHostResume
    ? `${player.name} is back. Resume when the table is ready.`
    : `${player.name} is away. Choose whether to auto-play that seat or wait.`;
  awayAutoBtn.classList.toggle('hidden', Boolean(game.awaitingHostResume));
  awayWaitBtn.classList.toggle('hidden', Boolean(game.awaitingHostResume));
  resumeGameBtn.classList.toggle('hidden', !game.awaitingHostResume);
  awayAutoBtn.dataset.seat = String(seat);
  awayWaitBtn.dataset.seat = String(seat);
}

function showQrInvite() {
  if (!roomState || !roomState.roomCode || !qrModal || !qrImage) return;
  const url = inviteUrl(roomState.roomCode);
  qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(url)}`;
  qrInviteText.textContent = url;
  qrModal.classList.remove('hidden');
}


applyDeckStyle(window.localStorage.getItem(DECK_STORAGE_KEY) || 'classic');
populateVoiceSelect();
if (window.SpadesAudio && SpadesAudio.onVoicesChanged) SpadesAudio.onVoicesChanged(populateVoiceSelect);
startCountdownLoop();
socket.on('connect', () => {
  markConnected();
  setError('');
  maybeAutoJoin();
  refreshLobbyOverview();
});

socket.on('roomState', (payload) => {
  roomState = payload;
  const myPlayer = roomState.players.find((player) => player && player.isYou);
  mySeat = myPlayer ? myPlayer.seat : null;
  playTableSounds(roomState);
  render();
});

let latestLobbyState = null;

socket.on('lobbyState', (payload) => {
  if (payload.lobbyRoomId !== currentLobbyRoomId) return;
  latestLobbyState = payload;
  renderTableGrid(payload.tables);
  renderRoster(payload.roster);
  if (roomViewSummary) {
    const seated = payload.tables.reduce((sum, table) => sum + table.seatedCount, 0);
    const openTables = payload.tables.filter((table) => table.seatedCount < 4 && !table.locked).length;
    roomViewSummary.textContent = `${seated} playing now · ${openTables} open tables`;
  }
  if (!roomPeekModal.classList.contains('hidden')) {
    renderTableGrid(payload.tables, roomPeekGrid, false);
    renderRoster(payload.roster, roomPeekRoster);
  }
  if (quickJoinPending) {
    quickJoinPending = false;
    const target = payload.tables.find((table) => table.seatedCount < 4 && !table.locked);
    if (target) {
      joinTable(target.tableNumber);
    } else {
      setLobbyError('Every table is full right now, pick a room to browse and watch instead.');
    }
  }
});

socket.on('lobbyOverview', (rooms) => {
  rooms.forEach((room) => {
    const el = document.querySelector(`[data-overview="${room.id}"]`);
    if (!el) return;
    el.textContent = `${room.online} online · ${room.openTables}/${room.totalTables} tables open`;
  });
  if (lobbyActivityLine) {
    const online = rooms.reduce((sum, room) => sum + room.online, 0);
    const inPlay = rooms.reduce((sum, room) => sum + room.inPlay, 0);
    lobbyActivityLine.textContent = online > 0
      ? `${online} players online right now · ${inPlay} hands in play`
      : 'Tables are quiet right now, be the first to sit down';
  }
});

function refreshLobbyOverview() {
  socket.emit('getLobbyOverview');
}

socket.on('tableChatHistory', (history) => {
  tableChatLog.innerHTML = '';
  (history || []).forEach(renderTableChatLine);
});

socket.on('tableChatMessage', (message) => {
  renderTableChatLine(message);
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

quickJoinBtn.addEventListener('click', () => {
  if (window.SpadesAudio) SpadesAudio.unlock();
  const name = lobbyPlayerNameInput.value.trim() || 'Player';
  currentLobbyRoomId = 'beginner';
  quickJoinPending = true;
  roomViewTitle.textContent = LOBBY_ROOM_LABELS.beginner;
  if (roomViewSummary) roomViewSummary.textContent = 'Finding you a table…';
  tableGrid.innerHTML = '';
  rosterList.innerHTML = '';
  chatLog.innerHTML = '';
  setLobbyError('');
  socket.emit('joinLobby', { lobbyRoomId: 'beginner', name });
  showRoomView();
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

function renderLeaderboard(entries) {
  leaderboardList.innerHTML = '';
  if (!entries.length) {
    leaderboardList.innerHTML = '<li class="leaderboard-empty">No rated matches played yet, be the first.</li>';
    return;
  }
  entries.forEach((entry, index) => {
    const row = document.createElement('li');
    row.className = 'leaderboard-row';
    row.innerHTML = `
      <span class="leaderboard-rank">${index + 1}</span>
      <span class="leaderboard-name">${escapeHtml(entry.screenName)}</span>
      <span class="leaderboard-rating">${entry.eloRating}</span>
    `;
    leaderboardList.appendChild(row);
  });
}

showLeaderboardBtn.addEventListener('click', async () => {
  leaderboardModal.classList.remove('hidden');
  leaderboardList.innerHTML = '<li class="leaderboard-empty">Loading&hellip;</li>';
  try {
    const res = await fetch('/api/leaderboard?limit=25');
    const json = await res.json();
    renderLeaderboard(json.leaderboard || []);
  } catch {
    leaderboardList.innerHTML = '<li class="leaderboard-empty">Could not load the leaderboard.</li>';
  }
});

leaderboardCloseBtn.addEventListener('click', () => {
  leaderboardModal.classList.add('hidden');
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
  socket.emit('createRoom', { name, stake, rankMode, sessionToken, accountToken });
  setError('');
});


if (blindNilBtn) {
  blindNilBtn.addEventListener('click', () => {
    if (!roomState || !roomState.roomCode) return;
    if (window.SpadesAudio) {
      SpadesAudio.unlock();
      SpadesAudio.chip();
    }
    socket.emit('submitBlindNil', { roomCode: roomState.roomCode });
  });
}

if (viewHandBtn) {
  viewHandBtn.addEventListener('click', () => {
    if (!roomState || !roomState.roomCode) return;
    if (window.SpadesAudio) SpadesAudio.unlock();
    socket.emit('viewHand', { roomCode: roomState.roomCode });
  });
}

if (standUpBtn) {
  standUpBtn.addEventListener('click', () => {
    if (!roomState || !roomState.roomCode || mySeat == null) return;
    const me = roomState.players[mySeat];
    socket.emit(me && me.away ? 'sitBackDown' : 'standUp', { roomCode: roomState.roomCode });
  });
}

if (awayAutoBtn) {
  awayAutoBtn.addEventListener('click', () => {
    if (!roomState || !roomState.roomCode) return;
    socket.emit('setAwayMode', { roomCode: roomState.roomCode, seat: Number(awayAutoBtn.dataset.seat), mode: 'auto' });
  });
}

if (awayWaitBtn) {
  awayWaitBtn.addEventListener('click', () => {
    if (!roomState || !roomState.roomCode) return;
    socket.emit('setAwayMode', { roomCode: roomState.roomCode, seat: Number(awayWaitBtn.dataset.seat), mode: 'wait' });
  });
}

if (resumeGameBtn) {
  resumeGameBtn.addEventListener('click', () => {
    if (!roomState || !roomState.roomCode) return;
    socket.emit('resumeGame', { roomCode: roomState.roomCode });
  });
}

if (showQrBtn) showQrBtn.addEventListener('click', showQrInvite);
if (qrCloseBtn) qrCloseBtn.addEventListener('click', () => qrModal.classList.add('hidden'));
if (deckSelect) deckSelect.addEventListener('change', () => applyDeckStyle(deckSelect.value));
if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    if (!window.SpadesAudio) return;
    SpadesAudio.setVoice(voiceSelect.value);
    SpadesAudio.say('Voice selected.');
  });
}
if (tableStakeSelect) tableStakeSelect.addEventListener('change', sendTableOptions);
if (allowNilToggle) allowNilToggle.addEventListener('change', sendTableOptions);
if (lowClubLeadToggle) lowClubLeadToggle.addEventListener('change', sendTableOptions);
if (tenFor200Toggle) tenFor200Toggle.addEventListener('change', sendTableOptions);
if (blindNilThresholdSelect) blindNilThresholdSelect.addEventListener('change', sendTableOptions);
if (allowWatchersToggle) allowWatchersToggle.addEventListener('change', sendTableOptions);
if (ownerMenuBtn && ownerMenu) {
  ownerMenuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const hidden = ownerMenu.classList.toggle('hidden');
    ownerMenuBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  });
}
if (ownerMenu) {
  ownerMenu.addEventListener('click', (event) => {
    const button = event.target.closest('[data-owner-command]');
    if (!button) return;
    runOwnerCommand(button.dataset.ownerCommand);
    ownerMenu.classList.add('hidden');
    if (ownerMenuBtn) ownerMenuBtn.setAttribute('aria-expanded', 'false');
  });
}
document.addEventListener('click', (event) => {
  if (!ownerMenu || !ownerMenuWrap || ownerMenu.classList.contains('hidden')) return;
  if (ownerMenuWrap.contains(event.target)) return;
  ownerMenu.classList.add('hidden');
  if (ownerMenuBtn) ownerMenuBtn.setAttribute('aria-expanded', 'false');
});
if (tableOptionsBtn && tableOptionsGroup) {
  tableOptionsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const hidden = tableOptionsGroup.classList.toggle('hidden');
    tableOptionsBtn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  });
}
document.addEventListener('click', (event) => {
  if (!tableOptionsGroup || !tableOptionsWrap || tableOptionsGroup.classList.contains('hidden')) return;
  if (tableOptionsWrap.contains(event.target)) return;
  tableOptionsGroup.classList.add('hidden');
  if (tableOptionsBtn) tableOptionsBtn.setAttribute('aria-expanded', 'false');
});
if (tableOptionsCloseBtn) {
  tableOptionsCloseBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    tableOptionsGroup.classList.add('hidden');
    if (tableOptionsBtn) tableOptionsBtn.setAttribute('aria-expanded', 'false');
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (tableOptionsGroup && !tableOptionsGroup.classList.contains('hidden')) {
    tableOptionsGroup.classList.add('hidden');
    if (tableOptionsBtn) tableOptionsBtn.setAttribute('aria-expanded', 'false');
  }
  if (ownerMenu && !ownerMenu.classList.contains('hidden')) {
    ownerMenu.classList.add('hidden');
    if (ownerMenuBtn) ownerMenuBtn.setAttribute('aria-expanded', 'false');
  }
});
socket.on('ownerCommandResult', (result) => {
  if (!result || !roomState || !roomState.isOwner) return;
  setError((result.ok ? 'Owner' : 'Owner blocked') + ': ' + result.message);
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

  socket.emit('joinRoom', { code: roomCode, name, sessionToken, accountToken });
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

function renderLastTrick() {
  const lastTrick = roomState && roomState.game && roomState.game.lastTrick;
  lastTrickCards.innerHTML = '';
  if (!lastTrick) {
    lastTrickWinner.textContent = '';
    return;
  }
  const winnerPlayer = roomState.players[lastTrick.winnerSeat];
  lastTrickWinner.textContent = winnerPlayer ? `${winnerPlayer.name} won this trick` : '';
  lastTrick.cards.forEach((entry) => {
    const player = roomState.players[entry.seat];
    const wrap = document.createElement('div');
    wrap.className = 'last-trick-entry';
    if (entry.seat === lastTrick.winnerSeat) wrap.classList.add('last-trick-winning-card');
    const cardEl = document.createElement('div');
    cardEl.className = `mini-card ${isRedSuit(entry.card.suit) ? 'red' : ''}`;
    cardEl.innerHTML = cardMarkup(entry.card);
    const label = document.createElement('span');
    label.className = 'last-trick-name';
    label.textContent = player ? player.name : `Seat ${entry.seat + 1}`;
    wrap.appendChild(cardEl);
    wrap.appendChild(label);
    lastTrickCards.appendChild(wrap);
  });
}

lastTrickBtn.addEventListener('click', () => {
  if (lastTrickBtn.disabled) return;
  renderLastTrick();
  lastTrickModal.classList.remove('hidden');
});

lastTrickCloseBtn.addEventListener('click', () => {
  lastTrickModal.classList.add('hidden');
});

roomPeekBtn.addEventListener('click', () => {
  roomPeekTitle.textContent = LOBBY_ROOM_LABELS[currentLobbyRoomId] || 'Room';
  if (latestLobbyState) {
    renderTableGrid(latestLobbyState.tables, roomPeekGrid, false);
    renderRoster(latestLobbyState.roster, roomPeekRoster);
  }
  roomPeekModal.classList.remove('hidden');
});

roomPeekCloseBtn.addEventListener('click', () => {
  roomPeekModal.classList.add('hidden');
});

leaveTableBtn.addEventListener('click', () => {
  if (!roomState || !roomState.roomCode) return;
  const wasLobbyTable = Boolean(roomState.lobbyRoomId);
  socket.emit('leaveTable', { roomCode: roomState.roomCode });
  roomState = null;
  mySeat = null;
  tableChatLog.innerHTML = '';
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

// Hidden owner debug drawer. Typing S P A D E S Q U E E N anywhere reveals
// a tiny command box for ANYONE, that's intentional, the box itself is
// harmless. Only the real owner account gets a real response, the server
// verifies that independently by session token, this client-side gesture
// grants nothing on its own.
(() => {
  const SEQUENCE = 'SPADESQUEEN';
  let buffer = '';
  let drawer = null;

  function closeDrawer() {
    if (drawer) drawer.remove();
    drawer = null;
  }

  function openDrawer() {
    if (drawer) return;
    drawer = document.createElement('div');
    drawer.className = 'owner-drawer';
    drawer.innerHTML = `
      <input type="text" class="owner-drawer-input" placeholder="/command" autocomplete="off" spellcheck="false" />
      <div class="owner-drawer-output"></div>
    `;
    document.body.appendChild(drawer);
    const input = drawer.querySelector('.owner-drawer-input');
    const output = drawer.querySelector('.owner-drawer-output');
    input.focus();

    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        closeDrawer();
        return;
      }
      if (event.key !== 'Enter') return;
      const command = input.value.trim();
      if (!command) return;
      input.value = '';
      output.textContent = 'Sending…';
      socket.emit('ownerCommand', { roomCode: roomState ? roomState.roomCode : null, command, accountToken });
    });

    socket.on('ownerCommandResult', (result) => {
      if (!drawer) return;
      output.textContent = `${result.ok ? 'OK' : 'No'}: ${result.message}`;
    });

    socket.on('ownerPeek', (payload) => {
      if (!drawer) return;
      const lines = Object.entries(payload.hands).map(([seat, hand]) => (
        `Seat ${seat}: ${hand.map((card) => `${card.rank}${card.suit[0]}`).join(' ')}`
      ));
      output.textContent = lines.join('\n');
    });
  }

  window.addEventListener('keydown', (event) => {
    if (drawer) return;
    if (event.key.length !== 1) return;
    buffer = (buffer + event.key.toUpperCase()).slice(-SEQUENCE.length);
    if (buffer === SEQUENCE) openDrawer();
  });

  socket.on('celebrate', () => {
    const burst = document.createElement('div');
    burst.className = 'confetti-burst';
    for (let i = 0; i < 60; i += 1) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.setProperty('--fall-delay', `${Math.random() * 0.6}s`);
      piece.style.setProperty('--fall-duration', `${1.6 + Math.random() * 1.2}s`);
      piece.style.background = ['#e9c66d', '#63d0c4', '#c4453a', '#4b93f0', '#7dcca6'][i % 5];
      burst.appendChild(piece);
    }
    document.body.appendChild(burst);
    window.setTimeout(() => burst.remove(), 3000);
  });
})();












