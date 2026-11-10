import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDeck,
  parseCard,
  parseCards,
  sortByRank,
} from '../src/engine/cards.js';
import {
  canBeat,
  classifyCombo,
  COMBO_TYPES,
  detectInstantWin,
  generateLegalMoves,
  isBombChop,
} from '../src/engine/combos.js';
import {
  createMatch,
  passTurn,
  playCards,
  startNextRound,
} from '../src/engine/game.js';
import { chooseBotAction } from '../src/ai/bot.js';

test('Deck has 52 unique cards ordered from 3S (0) to 2H (51)', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(deck[0].id, '3S');
  assert.equal(deck[0].power, 0);
  assert.equal(deck[51].id, '2H');
  assert.equal(deck[51].power, 51);

  const powers = new Set(deck.map((c) => c.power));
  assert.equal(powers.size, 52);
});

test('Suit order strictly follows Spades < Clubs < Diamonds < Hearts', () => {
  const cards = parseCards('7H 7S 7D 7C');
  const sorted = sortByRank(cards);
  assert.deepEqual(sorted.map((c) => c.id), ['7S', '7C', '7D', '7H']);
});

test('Combination classifier identifies Singles, Pairs, Triples, Quads, Straights, and Double Sequences', () => {
  assert.equal(classifyCombo(parseCards('3S')).type, COMBO_TYPES.SINGLE);
  assert.equal(classifyCombo(parseCards('9S 9H')).type, COMBO_TYPES.PAIR);
  assert.equal(classifyCombo(parseCards('9S 10S')), null);
  assert.equal(classifyCombo(parseCards('KS KC KD')).type, COMBO_TYPES.TRIPLE);

  const quad = classifyCombo(parseCards('JS JC JD JH'));
  assert.equal(quad.type, COMBO_TYPES.QUAD);
  assert.equal(quad.isBomb, true);

  const straight = classifyCombo(parseCards('3H 4S 5D 6C 7S'));
  assert.equal(straight.type, COMBO_TYPES.STRAIGHT);
  assert.equal(straight.length, 5);

  // Q-K-A is valid, K-A-2 and 2-3-4 are invalid
  assert.equal(classifyCombo(parseCards('QS KD AH')).type, COMBO_TYPES.STRAIGHT);
  assert.equal(classifyCombo(parseCards('KS AD 2H')), null);
  assert.equal(classifyCombo(parseCards('2S 3D 4H')), null);

  // Double sequence (3 consecutive pairs)
  const doubleSeq = classifyCombo(parseCards('4S 4D 5C 5H 6S 6C'));
  assert.equal(doubleSeq.type, COMBO_TYPES.DOUBLE_SEQ);
  assert.equal(doubleSeq.pairCount, 3);
  assert.equal(doubleSeq.isBomb, true);

  // Double sequence cannot include 2s
  assert.equal(classifyCombo(parseCards('KS KD AC AH 2S 2D')), null);
});

test('Same-type combo comparison uses rank first, then highest suit tie-breaker', () => {
  const pairLow = classifyCombo(parseCards('8C 8D'));
  const pairHigh = classifyCombo(parseCards('8S 8H')); // 8H > 8D
  assert.equal(canBeat(pairHigh, pairLow), true);
  assert.equal(canBeat(pairLow, pairHigh), false);

  const st1 = classifyCombo(parseCards('4H 5H 6D'));
  const st2 = classifyCombo(parseCards('4S 5C 6H')); // 6H > 6D
  const stLen4 = classifyCombo(parseCards('4S 5C 6D 7H'));
  assert.equal(canBeat(st2, st1), true);
  assert.equal(canBeat(stLen4, st1), false); // Different straight lengths cannot beat each other
});

test('Bomb ("Chặt Heo") hierarchy follows Southern Tiến Lên rules', () => {
  const singleTwo = classifyCombo(parseCards('2H'));
  const pairTwos = classifyCombo(parseCards('2S 2C'));
  const singleAce = classifyCombo(parseCards('AH'));

  const threePairs = classifyCombo(parseCards('3S 3C 4D 4H 5S 5D'));
  const quadSixes = classifyCombo(parseCards('6S 6C 6D 6H'));
  const fourPairs = classifyCombo(parseCards('7S 7C 8D 8H 9S 9C 10D 10H'));

  // Bombs cannot chop non-2 regular plays
  assert.equal(canBeat(quadSixes, singleAce), false);
  assert.equal(canBeat(threePairs, singleAce), false);

  // Single 2 beaten by 3-pair seq, quad, or 4-pair seq
  assert.equal(canBeat(threePairs, singleTwo), true);
  assert.equal(isBombChop(threePairs, singleTwo), true);
  assert.equal(canBeat(quadSixes, singleTwo), true);
  assert.equal(canBeat(fourPairs, singleTwo), true);

  // Pair of 2s beaten by quad or 4-pair seq, NOT 3-pair seq
  assert.equal(canBeat(threePairs, pairTwos), false);
  assert.equal(canBeat(quadSixes, pairTwos), true);
  assert.equal(canBeat(fourPairs, pairTwos), true);

  // Bomb over Bomb hierarchy: 3-pair < quad < 4-pair
  assert.equal(canBeat(quadSixes, threePairs), true);
  assert.equal(canBeat(threePairs, quadSixes), false);
  assert.equal(canBeat(fourPairs, quadSixes), true);
  assert.equal(canBeat(quadSixes, fourPairs), false);
});

test('Instant win detector catches Dragon, Four Twos, and Six Pairs', () => {
  const dragon = parseCards('3S 4C 5D 6H 7S 8C 9D 10H JS QC KD AH 2S');
  assert.equal(detectInstantWin(dragon)?.type, 'dragon');

  const fourTwos = parseCards('3S 4C 5S 7D 8H 9C JD QS KH 2S 2C 2D 2H');
  assert.equal(detectInstantWin(fourTwos)?.type, 'four_twos');

  const sixPairs = parseCards('3S 3C 5D 5H 7S 7C 9D 9H JS JC KD KH AS');
  assert.equal(detectInstantWin(sixPairs)?.type, 'six_pairs');
});

test('Opening play of Round 1 enforces 3S, pass locks players per trick, and lead hands off cleanly when going out', () => {
  const presetHands = [
    parseCards('3S 8S'),
    parseCards('4S 9S'),
    parseCards('5S 10S'),
    parseCards('6S JS'),
  ];

  let state = createMatch({ presetHands, instantWins: false });
  assert.equal(state.round.currentTurn, 0);
  assert.equal(state.round.mustIncludeCardId, '3S');

  // Cannot play 8S without 3S on opening move
  assert.throws(() => playCards(state, 0, [parseCard('8S')]), /must include 3♠/);

  // Player 0 leads 3S
  state = playCards(state, 0, ['3S']);
  assert.equal(state.round.currentTurn, 1);

  // Player 1 passes (locked out for rest of trick)
  state = passTurn(state, 1);
  assert.equal(state.round.trick.passed[1], true);
  assert.equal(state.round.currentTurn, 2);

  // Player 2 plays 5S
  state = playCards(state, 2, ['5S']);
  assert.equal(state.round.currentTurn, 3);

  // Player 3 passes
  state = passTurn(state, 3);
  // Turn skips passed Player 1 and goes back to Player 0
  assert.equal(state.round.currentTurn, 0);

  // Player 0 plays 8S (last card! Goes out in 1st place!)
  state = playCards(state, 0, ['8S']);
  assert.deepEqual(state.round.finishedOrder, [0]);
  // Only Player 2 is still unpassed in this trick
  assert.equal(state.round.currentTurn, 2);

  // Player 2 passes -> trick ends; since Player 0 has 0 cards, lead passes clockwise from 0 -> Player 1!
  state = passTurn(state, 2);
  assert.equal(state.round.trick.leadCombo, null);
  assert.equal(state.round.currentTurn, 1);
  assert.deepEqual(state.round.trick.passed, [false, false, false, false]);
});

test('AI bots play 40 complete multi-round matches without any illegal move or deadlock', () => {
  let seed = 1337;
  const seededRng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  let state = createMatch({
    rng: seededRng,
    difficulty: 'sharp',
    players: [
      { name: 'Bot A', isHuman: false },
      { name: 'Bot B', isHuman: false },
      { name: 'Bot C', isHuman: false },
      { name: 'Bot D', isHuman: false },
    ],
  });

  for (let roundIdx = 0; roundIdx < 40; roundIdx += 1) {
    if (roundIdx > 0) {
      state = startNextRound(state, seededRng);
    }

    let safetyCounter = 0;
    while (state.round.status === 'playing') {
      safetyCounter += 1;
      assert.ok(safetyCounter < 500, `Round ${roundIdx + 1} exceeded 500 actions`);

      const turn = state.round.currentTurn;
      const decision = chooseBotAction(state, turn);
      if (decision.action === 'play') {
        state = playCards(state, turn, decision.cards);
      } else {
        state = passTurn(state, turn);
      }
    }

    assert.equal(state.round.status, 'round_over');
    assert.equal(state.round.summary.placements.length, 4);
    // Zero-sum score check! Placement points (+3+1-1-3 = 0) and chop/burn transfers are zero-sum
    const totalScoreSum = state.scores.reduce((acc, n) => acc + n, 0);
    assert.equal(totalScoreSum, 0);
  }
});

test('generateLegalMoves finds double sequences and straights accurately', () => {
  const hand = parseCards('3S 3D 4C 4H 5S 5C 6D 7H 8S 2H');
  const movesAgainstTwo = generateLegalMoves(hand, classifyCombo(parseCards('2S')));
  // Should include single 2H AND the 3-pair bomb (33-44-55)
  assert.ok(movesAgainstTwo.some((m) => m.type === COMBO_TYPES.SINGLE && m.highCard.id === '2H'));
  assert.ok(movesAgainstTwo.some((m) => m.type === COMBO_TYPES.DOUBLE_SEQ && m.pairCount === 3));
});
