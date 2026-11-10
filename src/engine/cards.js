/**
 * Card definitions, ordering, deck generation, and sorting for Thirteen (Tiến Lên).
 *
 * Rank order (low -> high): 3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2
 * Suit order (low -> high): Spades (♠) < Clubs (♣) < Diamonds (♦) < Hearts (♥)
 */

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

export const SUITS = [
  { code: 'S', symbol: '♠', name: 'Spades', color: 'black', index: 0 },
  { code: 'C', symbol: '♣', name: 'Clubs', color: 'black', index: 1 },
  { code: 'D', symbol: '♦', name: 'Diamonds', color: 'red', index: 2 },
  { code: 'H', symbol: '♥', name: 'Hearts', color: 'red', index: 3 },
];

export const SUIT_BY_CODE = Object.fromEntries(SUITS.map((s) => [s.code, s]));
export const RANK_INDEX = Object.fromEntries(RANKS.map((r, i) => [r, i]));

export const THREE_OF_SPADES_ID = '3S';
export const TWO_RANK_INDEX = 12;

/**
 * Creates a canonical immutable card object from rank ('3'..'2') and suit code ('S'|'C'|'D'|'H').
 */
export function createCard(rank, suitCode) {
  const rankIndex = RANK_INDEX[rank];
  const suit = SUIT_BY_CODE[suitCode];
  if (rankIndex === undefined || !suit) {
    throw new Error(`Invalid card specification: ${rank}${suitCode}`);
  }
  const power = rankIndex * 4 + suit.index;
  return Object.freeze({
    id: `${rank}${suitCode}`,
    rank,
    rankIndex,
    suit: suit.code,
    suitSymbol: suit.symbol,
    suitName: suit.name,
    suitIndex: suit.index,
    color: suit.color,
    power,
    label: `${rank}${suit.symbol}`,
  });
}

/**
 * Parses shorthand card codes like '3S', '10D', 'QH', '2H'.
 */
export function parseCard(code) {
  const trimmed = String(code).trim().toUpperCase();
  const suitCode = trimmed.slice(-1);
  const rank = trimmed.slice(0, -1);
  return createCard(rank, suitCode);
}

/**
 * Parses an array or space-separated string of shorthand codes into sorted cards.
 */
export function parseCards(input) {
  if (Array.isArray(input)) {
    return input.map((item) => (typeof item === 'string' ? parseCard(item) : item));
  }
  const tokens = String(input).trim().split(/\s+/).filter(Boolean);
  return tokens.map(parseCard);
}

/**
 * Creates a standard 52-card Thirteen deck ordered from 3♠ (power 0) to 2♥ (power 51).
 */
export function createDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(createCard(rank, suit.code));
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle returning a new array. Accepts an optional RNG for deterministic tests.
 */
export function shuffleDeck(deck = createDeck(), rng = Math.random) {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Sorts cards ascending by Thirteen power (3♠ lowest -> 2♥ highest).
 */
export function sortByRank(cards) {
  return [...cards].sort((a, b) => a.power - b.power);
}

/**
 * Sorts cards grouped by suit first (♠, ♣, ♦, ♥), then rank ascending within suit.
 */
export function sortBySuit(cards) {
  return [...cards].sort((a, b) => {
    if (a.suitIndex !== b.suitIndex) return a.suitIndex - b.suitIndex;
    return a.rankIndex - b.rankIndex;
  });
}

/**
 * Deals 52 cards into 4 hands of 13 sorted cards each.
 */
export function dealHands(rng = Math.random) {
  const deck = shuffleDeck(createDeck(), rng);
  const hands = [[], [], [], []];
  for (let i = 0; i < deck.length; i += 1) {
    hands[i % 4].push(deck[i]);
  }
  return hands.map(sortByRank);
}
