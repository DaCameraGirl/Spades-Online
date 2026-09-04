const test = require('node:test');
const assert = require('node:assert/strict');
const { sortHand, pickBotCard, determineWinner } = require('./spades');

function card(rank, suit) {
  return { rank, suit, code: `${rank}${suit[0]}` };
}

test('sorts each suit ace-high down to 2', () => {
  const sorted = sortHand([
    card('8', 'Spades'),
    card('A', 'Spades'),
    card('2', 'Hearts'),
    card('K', 'Hearts'),
    card('10', 'Clubs'),
  ]);
  assert.deepEqual(
    sorted.map((entry) => `${entry.rank}${entry.suit[0]}`),
    ['AS', '8S', 'KH', '2H', '10C']
  );
});

test('void bot trumps an opponent ace even if spades are not broken', () => {
  const hand = [card('3', 'Spades'), card('9', 'Diamonds'), card('4', 'Hearts')];
  const trick = [{ seat: 0, card: card('A', 'Clubs') }];
  const played = pickBotCard(hand, 'Clubs', false, trick, 1);
  assert.equal(played.suit, 'Spades');
  assert.equal(played.rank, '3');
});

test('void bot does not trump when partner is already winning', () => {
  const hand = [card('Q', 'Spades'), card('2', 'Diamonds')];
  const trick = [
    { seat: 0, card: card('A', 'Clubs') },
    { seat: 1, card: card('9', 'Clubs') },
  ];
  const played = pickBotCard(hand, 'Clubs', false, trick, 2);
  assert.equal(played.suit, 'Diamonds');
});

test('bot cannot lead spades until they are broken', () => {
  const hand = [card('A', 'Spades'), card('3', 'Hearts')];
  const played = pickBotCard(hand, null, false, [], 1);
  assert.equal(played.suit, 'Hearts');
});

test('void bot trumps a walking 4 of clubs', () => {
  const hand = [card('2', 'Spades'), card('9', 'Hearts'), card('6', 'Diamonds')];
  const trick = [{ seat: 0, card: card('4', 'Clubs') }];
  const played = pickBotCard(hand, 'Clubs', false, trick, 1);
  assert.equal(played.suit, 'Spades');
});

test('bot with a higher club takes a walking 5', () => {
  const hand = [card('2', 'Clubs'), card('9', 'Clubs'), card('3', 'Hearts')];
  const trick = [{ seat: 0, card: card('5', 'Clubs') }];
  const played = pickBotCard(hand, 'Clubs', false, trick, 1);
  assert.equal(played.rank, '9');
  assert.equal(played.suit, 'Clubs');
});

test('last-to-play bot trumps if void and a low club is winning', () => {
  const hand = [card('4', 'Spades'), card('8', 'Hearts')];
  const trick = [
    { seat: 0, card: card('5', 'Clubs') },
    { seat: 1, card: card('2', 'Clubs') },
    { seat: 2, card: card('3', 'Clubs') },
  ];
  const played = pickBotCard(hand, 'Clubs', false, trick, 3);
  assert.equal(played.suit, 'Spades');
});

test('bot does not lead a 4 when it has a higher legal card', () => {
  const hand = [card('4', 'Clubs'), card('Q', 'Hearts'), card('2', 'Spades')];
  const played = pickBotCard(hand, null, false, [], 1);
  assert.equal(played.rank, 'Q');
});

test('in 2s high, 2 of spades beats ace of spades', () => {
  const trick = [
    { seat: 0, card: card('A', 'Spades') },
    { seat: 1, card: card('2', 'Spades') },
  ];
  assert.equal(determineWinner(trick, 'Spades', 'deuces'), 1);
  assert.equal(determineWinner(trick, 'Spades', 'ace'), 0);
});

test('in 2s high, 2 of diamonds is the second trump', () => {
  const twoDBeatsAce = [
    { seat: 0, card: card('A', 'Spades') },
    { seat: 1, card: card('2', 'Diamonds') },
  ];
  assert.equal(determineWinner(twoDBeatsAce, 'Spades', 'deuces'), 1);

  const twoSBeatsTwoD = [
    { seat: 0, card: card('2', 'Diamonds') },
    { seat: 1, card: card('2', 'Spades') },
  ];
  assert.equal(determineWinner(twoSBeatsTwoD, 'Spades', 'deuces'), 1);
});

test('in 2s high, 2 of diamonds does not count as a diamond', () => {
  const { effectiveSuit } = require('./spades');
  assert.equal(effectiveSuit(card('2', 'Diamonds'), 'deuces'), 'Spades');
  assert.equal(effectiveSuit(card('2', 'Diamonds'), 'ace'), 'Diamonds');
});

test('ace of clubs wins unless a spade is played', () => {
  const noTrump = [
    { seat: 0, card: card('A', 'Clubs') },
    { seat: 1, card: card('K', 'Clubs') },
    { seat: 2, card: card('9', 'Hearts') },
    { seat: 3, card: card('2', 'Clubs') },
  ];
  assert.equal(determineWinner(noTrump, 'Clubs'), 0);

  const trumped = [
    { seat: 0, card: card('A', 'Clubs') },
    { seat: 1, card: card('K', 'Clubs') },
    { seat: 2, card: card('2', 'Spades') },
    { seat: 3, card: card('Q', 'Clubs') },
  ];
  assert.equal(determineWinner(trumped, 'Clubs'), 2);
});
