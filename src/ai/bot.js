/**
 * Partition-aware heuristic AI & player Hint recommender for Thirteen (Tiến Lên).
 *
 * Supports three difficulty profiles:
 * - 'casual': greedy low-card play, occasionally holds back less optimally
 * - 'standard': preserves natural combos (straights, pairs, bombs) and manages 2s wisely
 * - 'sharp': tracks opponent card counts, blocks 1-card threats, sequences endgame winning lines
 */

import { sortByRank, TWO_RANK_INDEX } from '../engine/cards.js';
import {
  COMBO_TYPES,
  generateLegalMoves,
  groupByRank,
  isBombChop,
} from '../engine/combos.js';

/**
 * Partitions a hand into non-overlapping natural combinations (bombs, straights, triples, pairs, singles)
 * to estimate structural cost when breaking combos.
 */
export function partitionHand(hand) {
  let remaining = sortByRank(hand);
  const combos = {
    bombs: [],
    straights: [],
    triples: [],
    pairs: [],
    singles: [],
  };

  const removeCards = (cardsToRemove) => {
    const ids = new Set(cardsToRemove.map((c) => c.id));
    remaining = remaining.filter((c) => !ids.has(c.id));
  };

  // 1. Extract Quads (excluding 2s which already dominate)
  let byRank = groupByRank(remaining);
  for (let r = 0; r < TWO_RANK_INDEX; r += 1) {
    if (byRank[r].length === 4) {
      combos.bombs.push(byRank[r]);
      removeCards(byRank[r]);
    }
  }

  // 2. Extract 3+ Consecutive Pairs (Double Sequences)
  byRank = groupByRank(remaining);
  let r = 0;
  while (r <= 9) {
    if (byRank[r].length >= 2 && byRank[r + 1].length >= 2 && byRank[r + 2].length >= 2) {
      let end = r + 2;
      while (end + 1 < TWO_RANK_INDEX && byRank[end + 1].length >= 2) {
        end += 1;
      }
      const seqCards = [];
      for (let k = r; k <= end; k += 1) {
        seqCards.push(byRank[k][0], byRank[k][1]);
      }
      combos.bombs.push(seqCards);
      removeCards(seqCards);
      byRank = groupByRank(remaining);
    } else {
      r += 1;
    }
  }

  // 3. Extract greedy Straights (preferring singletons/low-duplication ranks)
  let foundStraight = true;
  while (foundStraight) {
    foundStraight = false;
    byRank = groupByRank(remaining);
    for (let start = 0; start <= 9; start += 1) {
      if (byRank[start].length === 0) continue;
      let end = start;
      while (end + 1 < TWO_RANK_INDEX && byRank[end + 1].length > 0) {
        end += 1;
      }
      const span = end - start + 1;
      if (span >= 3) {
        // Check that extracting this straight reduces or equals singleton count
        let singletonsUsed = 0;
        let pairsBroken = 0;
        for (let k = start; k <= end; k += 1) {
          if (byRank[k].length === 1) singletonsUsed += 1;
          else if (byRank[k].length === 2) pairsBroken += 1;
        }
        if (singletonsUsed >= pairsBroken) {
          const stCards = [];
          for (let k = start; k <= end; k += 1) {
            stCards.push(byRank[k][0]);
          }
          combos.straights.push(stCards);
          removeCards(stCards);
          foundStraight = true;
          break;
        }
      }
    }
  }

  // 4. Extract Triples, Pairs, and remaining Singles
  byRank = groupByRank(remaining);
  for (let rank = 0; rank < 13; rank += 1) {
    const g = byRank[rank];
    if (g.length === 3) {
      combos.triples.push(g);
    } else if (g.length === 2) {
      combos.pairs.push(g);
    } else if (g.length === 1) {
      combos.singles.push(g[0]);
    } else if (g.length === 4) {
      // Four 2s if instantWin disabled
      combos.bombs.push(g);
    }
  }

  return combos;
}

/**
 * Scores candidate legal moves and returns ordered recommendations (best first).
 */
export function rankLegalMoves(state, playerIndex = state.round.currentTurn, difficulty = 'standard') {
  const { round } = state;
  const hand = round.hands[playerIndex];
  const target = round.trick.leadCombo;
  const legalMoves = generateLegalMoves(hand, target, round.mustIncludeCardId);

  if (legalMoves.length === 0) return [];

  // Immediate win check: if a single legal move sheds the entire remaining hand, prioritize it!
  const winningMoves = legalMoves.filter((m) => m.length === hand.length);
  if (winningMoves.length > 0) {
    return winningMoves
      .sort((a, b) => b.power - a.power)
      .map((move) => ({ move, score: 1000 + move.power, turnDelta: 1, afterTurns: 0 }));
  }

  // Opponent threat analysis
  const opponentCounts = [0, 1, 2, 3]
    .filter((i) => i !== playerIndex && round.hands[i].length > 0)
    .map((i) => round.hands[i].length);
  const minOpponentCards = opponentCounts.length > 0 ? Math.min(...opponentCounts) : 13;

  // Next active player's card count (crucial when leading!)
  let nextActiveCount = 13;
  for (let step = 1; step <= 3; step += 1) {
    const seat = (playerIndex + step) % 4;
    if (round.hands[seat].length > 0) {
      nextActiveCount = round.hands[seat].length;
      break;
    }
  }

  const basePartition = partitionHand(hand);
  const baseTurns = countPartitionTurns(basePartition);

  const scored = legalMoves.map((move) => {
    const playedIds = new Set(move.cards.map((c) => c.id));
    const remaining = hand.filter((c) => !playedIds.has(c.id));
    const afterPartition = partitionHand(remaining);
    const afterTurns = countPartitionTurns(afterPartition);

    // Lower score = more desirable play? Let's make HIGHER score = BETTER move.
    let score = 0;

    // 1. Structural efficiency: strongly prefer plays that reduce estimated turns to go out
    const turnDelta = baseTurns - afterTurns; // ideally +1 (cleanly shed one combo), <= 0 means broke a combo!
    if (difficulty !== 'casual') {
      score += turnDelta * 42;
    } else {
      score += turnDelta * 18;
    }

    // 2. Leading a fresh trick (`!target`)
    if (!target) {
      // Shed multi-card combos first (straights, triples, pairs) while keeping bombs
      if (move.isBomb && remaining.length > 2) {
        score -= 95;
      } else {
        score += move.length * 14;
      }

      // Prefer shedding lower ranks first so high control cards remain for endgame
      score -= move.power * 0.9;

      // Avoid leading a 2 early when lower cards exist
      if (move.isTwo && remaining.length > 2) {
        score -= 80;
      }

      // Sharp endgame awareness: if next player has 1 card left, avoid leading low singles!
      if (difficulty === 'sharp' && nextActiveCount === 1) {
        if (move.type === COMBO_TYPES.SINGLE) {
          // Play high singles to block 1-card opponent, or play multi-card combos instead!
          score += move.power * 2.2 - 35;
        } else {
          score += 40;
        }
      }

      // Endgame setup: if leaving exactly 1combo in `remaining`, huge bonus if we play high/controlling now!
      if (afterTurns === 1) {
        score += 55 + move.power * 0.8;
      }
    } else {
      // 3. Responding to an active trick (`target` exists)
      // Bomb chop! Always exciting and awards +2 pts
      if (isBombChop(move, target)) {
        score += 120 - move.power * 0.3;
      } else {
        // Prefer winning the trick as cheaply as possible
        score -= move.power * 1.15;

        // Conserve 2s unless opponent is dangerously low on cards or we're close to winning
        if (move.isTwo) {
          if (minOpponentCards <= 2 || afterTurns <= 2) {
            score += 18;
          } else if (remaining.length >= 6 && target.highCard.rankIndex <= 9) {
            // Don't burn a 2 on a 3..Q early in the round!
            score -= 65;
          } else {
            score -= 22;
          }
        }

        // Urgent defense if an opponent is down to 1-2 cards
        if (difficulty === 'sharp' && minOpponentCards <= 2) {
          score += 35;
        }
      }
    }

    return { move, score, turnDelta, afterTurns };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function countPartitionTurns(p) {
  return (
    p.bombs.length +
    p.straights.length +
    p.triples.length +
    p.pairs.length +
    p.singles.length
  );
}

/**
 * Decides the AI's next action: `{ action: 'play', cards }` or `{ action: 'pass' }`.
 */
export function chooseBotAction(state, playerIndex = state.round.currentTurn) {
  const { round, settings } = state;
  const difficulty = settings?.difficulty || 'standard';
  const target = round.trick.leadCombo;

  const ranked = rankLegalMoves(state, playerIndex, difficulty);
  if (ranked.length === 0) {
    return { action: 'pass' };
  }

  // Must play when leading a trick
  if (!target) {
    const pickIndex =
      difficulty === 'casual' && ranked.length > 1 && Math.random() < 0.25 ? 1 : 0;
    return { action: 'play', combo: ranked[pickIndex].move, cards: ranked[pickIndex].move.cards };
  }

  const best = ranked[0];

  // Strategic Pass heuristic: don't shatter valuable combos or waste sole 2s early unless urgent
  const opponentCounts = [0, 1, 2, 3]
    .filter((i) => i !== playerIndex && round.hands[i].length > 0)
    .map((i) => round.hands[i].length);
  const minOpponentCards = opponentCounts.length > 0 ? Math.min(...opponentCounts) : 13;
  const handSize = round.hands[playerIndex].length;

  if (difficulty !== 'casual' && minOpponentCards > 2 && handSize > 4) {
    // Pass if our best move has a badly negative score (e.g., wastes a 2 on a low card or shatters two combos)
    if (best.score < -78 && !isBombChop(best.move, target)) {
      return { action: 'pass' };
    }
  }

  return { action: 'play', combo: best.move, cards: best.move.cards };
}
