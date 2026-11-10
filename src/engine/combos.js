/**
 * Combination classifier, comparison rules, bomb ("chặt heo") hierarchy,
 * instant-win ("tới trắng") detector, and legal move generator for Thirteen.
 */

import { sortByRank, TWO_RANK_INDEX } from './cards.js';

export const COMBO_TYPES = Object.freeze({
  SINGLE: 'single',
  PAIR: 'pair',
  TRIPLE: 'triple',
  QUAD: 'quad',
  STRAIGHT: 'straight',
  DOUBLE_SEQ: 'double_seq',
});

/**
 * Returns the bomb tier of a classified combination:
 * - 0: regular play
 * - 1: 3 consecutive pairs (chops single 2)
 * - 2: four of a kind (chops single 2, pair of 2s, or 3 consecutive pairs)
 * - 3+: 4+ consecutive pairs (chops single 2, pair of 2s, four of a kind, or shorter pair sequences)
 */
export function getBombTier(combo) {
  if (!combo) return 0;
  if (combo.type === COMBO_TYPES.DOUBLE_SEQ) {
    if (combo.pairCount === 3) return 1;
    if (combo.pairCount >= 4) return combo.pairCount - 1;
  }
  if (combo.type === COMBO_TYPES.QUAD) {
    return 2;
  }
  return 0;
}

/**
 * Classifies an array of cards into a valid Thirteen combination, or returns null if invalid.
 */
export function classifyCombo(rawCards) {
  if (!Array.isArray(rawCards) || rawCards.length === 0) return null;

  const cards = sortByRank(rawCards);
  const len = cards.length;

  // Reject duplicate card IDs
  for (let i = 1; i < len; i += 1) {
    if (cards[i].id === cards[i - 1].id) return null;
  }

  const highCard = cards[len - 1];

  if (len === 1) {
    return buildCombo({
      type: COMBO_TYPES.SINGLE,
      cards,
      highCard,
      label: `Single ${highCard.label}`,
      shortLabel: highCard.label,
    });
  }

  if (len === 2) {
    if (cards[0].rankIndex === cards[1].rankIndex) {
      return buildCombo({
        type: COMBO_TYPES.PAIR,
        cards,
        highCard,
        label: `Pair of ${highCard.rank}s (${highCard.suitSymbol} high)`,
        shortLabel: `Pair ${highCard.rank}s`,
      });
    }
    return null;
  }

  if (len === 3) {
    if (cards[0].rankIndex === cards[2].rankIndex) {
      return buildCombo({
        type: COMBO_TYPES.TRIPLE,
        cards,
        highCard,
        label: `Triple ${highCard.rank}s`,
        shortLabel: `Triple ${highCard.rank}s`,
      });
    }
  }

  if (len === 4) {
    if (cards[0].rankIndex === cards[3].rankIndex) {
      return buildCombo({
        type: COMBO_TYPES.QUAD,
        cards,
        highCard,
        label: `Four of a Kind · ${highCard.rank}s`,
        shortLabel: `Quad ${highCard.rank}s`,
      });
    }
  }

  // Straight check: 3+ cards, strictly consecutive ranks, 2s never allowed
  if (len >= 3 && highCard.rankIndex < TWO_RANK_INDEX) {
    let isStraight = true;
    for (let i = 1; i < len; i += 1) {
      if (cards[i].rankIndex !== cards[i - 1].rankIndex + 1) {
        isStraight = false;
        break;
      }
    }
    if (isStraight) {
      return buildCombo({
        type: COMBO_TYPES.STRAIGHT,
        cards,
        highCard,
        label: `${len}-Card Straight (${cards[0].rank}–${highCard.label})`,
        shortLabel: `Straight ${cards[0].rank}–${highCard.label}`,
      });
    }
  }

  // Double sequence (consecutive pairs): 6, 8, 10, or 12 cards (3+ pairs), 2s never allowed
  if (len >= 6 && len % 2 === 0 && highCard.rankIndex < TWO_RANK_INDEX) {
    const pairCount = len / 2;
    let isDoubleSeq = true;
    for (let p = 0; p < pairCount; p += 1) {
      const first = cards[p * 2];
      const second = cards[p * 2 + 1];
      if (first.rankIndex !== second.rankIndex) {
        isDoubleSeq = false;
        break;
      }
      if (p > 0) {
        const prevPairRank = cards[(p - 1) * 2].rankIndex;
        if (first.rankIndex !== prevPairRank + 1) {
          isDoubleSeq = false;
          break;
        }
      }
    }
    if (isDoubleSeq) {
      return buildCombo({
        type: COMBO_TYPES.DOUBLE_SEQ,
        cards,
        highCard,
        pairCount,
        label: `${pairCount}-Pair Sequence (${cards[0].rank}${cards[0].rank}–${highCard.rank}${highCard.suitSymbol})`,
        shortLabel: `${pairCount}-Pair Bomb`,
      });
    }
  }

  return null;
}

function buildCombo({ type, cards, highCard, pairCount = 0, label, shortLabel }) {
  const isTwo =
    (type === COMBO_TYPES.SINGLE || type === COMBO_TYPES.PAIR) &&
    highCard.rankIndex === TWO_RANK_INDEX;

  const partial = {
    type,
    cards,
    length: cards.length,
    pairCount,
    highCard,
    power: highCard.power,
    isTwo,
    label,
    shortLabel,
  };
  const bombTier = getBombTier(partial);
  return Object.freeze({
    ...partial,
    bombTier,
    isBomb: bombTier > 0,
  });
}

/**
 * Determines whether `candidate` (a classified combo or card array) legally beats `target`.
 * If `target` is null/undefined (leading a fresh trick), any valid combo returns true.
 */
export function canBeat(candidateInput, target) {
  const candidate = candidateInput?.type ? candidateInput : classifyCombo(candidateInput);
  if (!candidate) return false;
  if (!target) return true;

  // Standard match: identical type and card count, strictly higher top card
  if (candidate.type === target.type && candidate.length === target.length) {
    return candidate.power > target.power;
  }

  // Bomb ("Chặt Heo") rules
  if (candidate.bombTier > 0) {
    // Chopping a single 2: 3+ pair sequence or four of a kind
    if (target.type === COMBO_TYPES.SINGLE && target.isTwo) {
      return candidate.bombTier >= 1;
    }
    // Chopping a pair of 2s: four of a kind or 4+ pair sequence
    if (target.type === COMBO_TYPES.PAIR && target.isTwo) {
      return candidate.bombTier >= 2;
    }
    // Bomb over lower-tier bomb
    if (target.bombTier > 0) {
      return candidate.bombTier > target.bombTier;
    }
  }

  return false;
}

/**
 * Checks whether a play represents a Bomb Chop ("Chặt") rather than a normal same-type raise.
 */
export function isBombChop(candidate, target) {
  if (!candidate || !target || !candidate.isBomb) return false;
  if (target.isTwo) return canBeat(candidate, target);
  if (target.isBomb) return canBeat(candidate, target);
  return false;
}

/**
 * Explains in plain language why a selection of cards is or isn't playable right now.
 */
export function explainSelection(selectedCards, target, mustIncludeCardId = null) {
  if (!selectedCards || selectedCards.length === 0) {
    if (mustIncludeCardId) {
      return { valid: false, combo: null, message: 'Lead must include 3♠ to open the match.' };
    }
    if (!target) {
      return { valid: false, combo: null, message: 'Select any valid combination to lead the trick.' };
    }
    return { valid: false, combo: null, message: `Beat ${target.label} or Pass.` };
  }

  const combo = classifyCombo(selectedCards);
  if (!combo) {
    return {
      valid: false,
      combo: null,
      message: `${selectedCards.length} cards selected — not a valid Thirteen combination.`,
    };
  }

  if (mustIncludeCardId && !combo.cards.some((c) => c.id === mustIncludeCardId)) {
    return {
      valid: false,
      combo,
      message: `${combo.label} — opening play must include 3♠.`,
    };
  }

  if (!target) {
    return {
      valid: true,
      combo,
      message: `${combo.label} — ready to lead.`,
    };
  }

  if (canBeat(combo, target)) {
    const chop = isBombChop(combo, target);
    return {
      valid: true,
      combo,
      isChop: chop,
      message: chop
        ? `${combo.label} — BOMB CHOP on ${target.shortLabel}!`
        : `${combo.label} — beats ${target.shortLabel}.`,
    };
  }

  if (combo.type !== target.type || combo.length !== target.length) {
    return {
      valid: false,
      combo,
      message: `${combo.label} — must match ${target.label}${target.isTwo ? ' (or play a Bomb)' : ''}.`,
    };
  }

  return {
    valid: false,
    combo,
    message: `${combo.label} — needs to be higher than ${target.highCard.label}.`,
  };
}

/**
 * Detects classic Thirteen Instant Win ("Tới Trắng") hands on a fresh 13-card deal:
 * - Dragon Straight (3 through A + a 2, i.e. 12 distinct non-2 ranks: 3-4-5-6-7-8-9-10-J-Q-K-A, or all 13 ranks 3..2)
 * - Four Twos (all four 2s)
 * - Six Pairs (6 pairs in 13 cards, including quads counted as 2 pairs)
 */
export function detectInstantWin(hand) {
  if (!hand || hand.length !== 13) return null;
  const counts = new Array(13).fill(0);
  for (const card of hand) {
    counts[card.rankIndex] += 1;
  }

  // Four 2s
  if (counts[TWO_RANK_INDEX] === 4) {
    return { type: 'four_twos', title: 'Four Twos (Tứ Quý Heo)', description: 'Dealt all four 2s!' };
  }

  // Dragon: one of every rank 3..A (with a 2 as 13th card = full 13-rank Dragon, or 3..A straight of 12)
  let has3ToAce = true;
  for (let r = 0; r < 12; r += 1) {
    if (counts[r] === 0) {
      has3ToAce = false;
      break;
    }
  }
  if (has3ToAce && counts[TWO_RANK_INDEX] === 1) {
    return { type: 'dragon', title: 'Dragon Hand (Sảnh Rồng)', description: '13-card run from 3 through 2!' };
  }
  if (has3ToAce) {
    return { type: 'dragon_12', title: 'Royal Dragon (Sảnh Rồng)', description: '12-card straight from 3 through Ace!' };
  }

  // Six pairs (a quad contributes 2 pairs)
  let pairCount = 0;
  for (let r = 0; r < 13; r += 1) {
    pairCount += Math.floor(counts[r] / 2);
  }
  if (pairCount >= 6) {
    return { type: 'six_pairs', title: 'Six Pairs (Sáu Đôi)', description: 'Dealt six pairs in 13 cards!' };
  }

  return null;
}

/**
 * Groups a sorted hand by rankIndex (0..12 -> Card[]).
 */
export function groupByRank(hand) {
  const groups = Array.from({ length: 13 }, () => []);
  for (const card of sortByRank(hand)) {
    groups[card.rankIndex].push(card);
  }
  return groups;
}

/**
 * Generates all valid combinations present in `hand` that legally beat `target`
 * (or all valid combinations if `target` is null), optionally requiring `mustIncludeCardId`.
 * Sorted ascending by combo length/complexity first or power so lowest clean plays come first.
 */
export function generateLegalMoves(hand, target = null, mustIncludeCardId = null) {
  const sorted = sortByRank(hand);
  if (sorted.length === 0) return [];

  const byRank = groupByRank(sorted);
  const candidates = [];

  const wantType = (type, len) => {
    if (!target) return true;
    if (target.type === type && target.length === len) return true;
    // Bombs might beat 2s or lower bombs
    if (type === COMBO_TYPES.QUAD || type === COMBO_TYPES.DOUBLE_SEQ) {
      return target.isTwo || target.isBomb;
    }
    return false;
  };

  // 1. Singles
  if (wantType(COMBO_TYPES.SINGLE, 1)) {
    for (const card of sorted) {
      candidates.push(classifyCombo([card]));
    }
  }

  // 2. Pairs
  if (wantType(COMBO_TYPES.PAIR, 2)) {
    for (let r = 0; r < 13; r += 1) {
      const g = byRank[r];
      for (let i = 0; i < g.length; i += 1) {
        for (let j = i + 1; j < g.length; j += 1) {
          candidates.push(classifyCombo([g[i], g[j]]));
        }
      }
    }
  }

  // 3. Triples
  if (wantType(COMBO_TYPES.TRIPLE, 3)) {
    for (let r = 0; r < 13; r += 1) {
      const g = byRank[r];
      if (g.length >= 3) {
        for (let i = 0; i < g.length; i += 1) {
          for (let j = i + 1; j < g.length; j += 1) {
            for (let k = j + 1; k < g.length; k += 1) {
              candidates.push(classifyCombo([g[i], g[j], g[k]]));
            }
          }
        }
      }
    }
  }

  // 4. Quads (Four of a Kind)
  if (wantType(COMBO_TYPES.QUAD, 4)) {
    for (let r = 0; r < 13; r += 1) {
      const g = byRank[r];
      if (g.length === 4) {
        candidates.push(classifyCombo(g));
      }
    }
  }

  // 5. Straights (ranks 0..11, lengths 3..12)
  for (let start = 0; start <= 9; start += 1) {
    if (byRank[start].length === 0) continue;
    for (let end = start + 2; end < 12; end += 1) {
      if (byRank[end].length === 0) break;
      const len = end - start + 1;
      if (!wantType(COMBO_TYPES.STRAIGHT, len)) continue;

      // Expand suit combinations across ranks start..end
      let partials = [[]];
      for (let r = start; r <= end; r += 1) {
        const nextPartials = [];
        for (const prefix of partials) {
          for (const card of byRank[r]) {
            nextPartials.push([...prefix, card]);
          }
        }
        partials = nextPartials;
      }
      for (const cards of partials) {
        candidates.push(classifyCombo(cards));
      }
    }
  }

  // 6. Double Sequences (ranks 0..11, 3..6 consecutive pairs)
  for (let start = 0; start <= 9; start += 1) {
    if (byRank[start].length < 2) continue;
    for (let end = start + 2; end < 12; end += 1) {
      if (byRank[end].length < 2) break;
      const pairCount = end - start + 1;
      const len = pairCount * 2;
      if (!wantType(COMBO_TYPES.DOUBLE_SEQ, len)) continue;

      // Build pair choices per rank
      let partials = [[]];
      for (let r = start; r <= end; r += 1) {
        const g = byRank[r];
        const rankPairs = [];
        for (let i = 0; i < g.length; i += 1) {
          for (let j = i + 1; j < g.length; j += 1) {
            rankPairs.push([g[i], g[j]]);
          }
        }
        const nextPartials = [];
        for (const prefix of partials) {
          for (const pair of rankPairs) {
            nextPartials.push([...prefix, ...pair]);
          }
        }
        partials = nextPartials;
      }
      for (const cards of partials) {
        candidates.push(classifyCombo(cards));
      }
    }
  }

  // Filter by mustIncludeCardId and canBeat
  return candidates.filter((combo) => {
    if (!combo) return false;
    if (mustIncludeCardId && !combo.cards.some((c) => c.id === mustIncludeCardId)) {
      return false;
    }
    return canBeat(combo, target);
  });
}
