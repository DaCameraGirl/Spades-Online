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
