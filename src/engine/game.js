/**
 * Core game state engine for Thirteen (Tiến Lên).
 * Pure/immutable-friendly state transitions for dealing, playing, passing,
 * bomb chop bonuses, instant wins, round placements, and match scoring.
 */

import { dealHands, sortByRank, THREE_OF_SPADES_ID, TWO_RANK_INDEX } from './cards.js';
import {
  canBeat,
  classifyCombo,
  detectInstantWin,
  generateLegalMoves,
  isBombChop,
} from './combos.js';

export const DEFAULT_PLAYERS = Object.freeze([
  { index: 0, name: 'You', isHuman: true, seat: 'south' },
  { index: 1, name: 'Linh', isHuman: false, seat: 'west' },
  { index: 2, name: 'Minh', isHuman: false, seat: 'north' },
  { index: 3, name: 'Khai', isHuman: false, seat: 'east' },
]);

export const PLACEMENT_POINTS = Object.freeze([3, 1, -1, -3]);
export const CHOP_BONUS_POINTS = 2;
export const BURNED_TWO_PENALTY = 1;

/**
 * Creates a brand-new 4-player match and deals Round 1.
 */
export function createMatch(options = {}) {
  const players = options.players
    ? options.players.map((p, idx) => ({ ...DEFAULT_PLAYERS[idx], ...p, index: idx }))
    : DEFAULT_PLAYERS.map((p) => ({ ...p }));

  const match = {
    players,
    scores: [0, 0, 0, 0],
    roundNumber: 0,
    lastWinnerIndex: null,
    settings: {
      difficulty: options.difficulty || 'standard',
      instantWins: options.instantWins !== false,
    },
    round: null,
  };

  return startNextRound(match, options.rng, options.presetHands);
}

/**
 * Deals and initializes the next round in an existing match.
 */
export function startNextRound(matchState, rng = Math.random, presetHands = null) {
  const roundNumber = matchState.roundNumber + 1;
  const hands = presetHands
    ? presetHands.map((h) => sortByRank(h))
    : dealHands(rng);

  const isFirstMatchRound = matchState.lastWinnerIndex === null;
  let startingPlayer = matchState.lastWinnerIndex ?? 0;
  let mustIncludeCardId = null;

  if (isFirstMatchRound) {
    const holder = hands.findIndex((hand) => hand.some((c) => c.id === THREE_OF_SPADES_ID));
    if (holder !== -1) {
      startingPlayer = holder;
      mustIncludeCardId = THREE_OF_SPADES_ID;
    }
  }

  const round = {
    number: roundNumber,
    hands,
    currentTurn: startingPlayer,
    mustIncludeCardId,
    trick: createEmptyTrick(),
    previousTrickCombo: null,
    chopEvents: [],
    finishedOrder: [],
    status: 'playing',
    instantWin: null,
    summary: null,
    log: [
      {
        type: 'deal',
        playerIndex: startingPlayer,
        message: mustIncludeCardId
          ? `Round ${roundNumber} dealt — ${matchState.players[startingPlayer].name} holds 3♠ and leads.`
          : `Round ${roundNumber} dealt — ${matchState.players[startingPlayer].name} leads as reigning winner.`,
      },
    ],
  };

  const nextState = {
    ...matchState,
    scores: [...matchState.scores],
    roundNumber,
    round,
  };

  // Check Instant Win ("Tới Trắng") starting from startingPlayer in turn order
  if (nextState.settings.instantWins) {
    for (let offset = 0; offset < 4; offset += 1) {
      const idx = (startingPlayer + offset) % 4;
      const instant = detectInstantWin(hands[idx]);
      if (instant) {
        return resolveInstantWin(nextState, idx, instant);
      }
    }
  }

  return nextState;
}

function createEmptyTrick() {
  return {
    leadCombo: null,
    leaderIndex: null,
    passed: [false, false, false, false],
    plays: [],
  };
}

function resolveInstantWin(state, winnerIndex, instantDetails) {
  // Remaining seats ranked by fewest 2s / lowest card count tie-break or turn order
  const others = [0, 1, 2, 3].filter((i) => i !== winnerIndex);
  const finishedOrder = [winnerIndex, ...others];
  const deltas = [0, 0, 0, 0];
  const bonuses = [];

  for (let i = 0; i < 4; i += 1) {
    if (i === winnerIndex) {
      deltas[i] += 6;
    } else {
      deltas[i] -= 2;
    }
  }
  bonuses.push({
    type: 'instant_win',
    playerIndex: winnerIndex,
    points: 6,
    description: `${state.players[winnerIndex].name}: ${instantDetails.title} (+6)`,
  });

  const newScores = state.scores.map((s, i) => s + deltas[i]);
  const summary = {
    placements: finishedOrder,
    placementDeltas: [...deltas],
    bonuses,
    totalDeltas: deltas,
    scoresAfter: newScores,
    instantWin: { winnerIndex, ...instantDetails },
  };

  return {
    ...state,
    scores: newScores,
    lastWinnerIndex: winnerIndex,
    round: {
      ...state.round,
      finishedOrder,
      status: 'round_over',
      instantWin: { winnerIndex, ...instantDetails },
      summary,
      log: [
        ...state.round.log,
        {
          type: 'instant_win',
          playerIndex: winnerIndex,
          message: `Instant Victory! ${state.players[winnerIndex].name} reveals ${instantDetails.title}!`,
        },
      ],
    },
  };
}

/**
 * Returns players other than `leaderIndex` who still hold cards and haven't passed this trick.
 */
export function getEligibleResponders(round, leaderIndex) {
  const eligible = [];
  for (let i = 0; i < 4; i += 1) {
    if (i !== leaderIndex && round.hands[i].length > 0 && !round.trick.passed[i]) {
      eligible.push(i);
    }
  }
  return eligible;
}

/**
 * Finds the next seat clockwise after `fromIndex` matching `predicate`.
 */
function findNextClockwise(fromIndex, predicate) {
  for (let step = 1; step <= 4; step += 1) {
    const candidate = (fromIndex + step) % 4;
    if (predicate(candidate)) return candidate;
  }
  return -1;
}

/**
 * Plays a selected array of cards (or card IDs) for `playerIndex`.
 * Throws a descriptive Error if the move is illegal.
 */
export function playCards(state, playerIndex, cardInput) {
  const { round } = state;
  if (round.status !== 'playing') {
    throw new Error('Round is already finished.');
  }
  if (playerIndex !== round.currentTurn) {
    throw new Error(`It is not ${state.players[playerIndex].name}'s turn.`);
  }

  const playerHand = round.hands[playerIndex];
  const selectedCards = cardInput.map((item) => {
    const id = typeof item === 'string' ? item : item.id;
    const found = playerHand.find((c) => c.id === id);
    if (!found) {
      throw new Error(`Card ${id} is not in ${state.players[playerIndex].name}'s hand.`);
    }
    return found;
  });

  const combo = classifyCombo(selectedCards);
  if (!combo) {
    throw new Error('Selected cards do not form a valid Thirteen combination.');
  }

  if (round.mustIncludeCardId && !combo.cards.some((c) => c.id === round.mustIncludeCardId)) {
    throw new Error('The opening play of the match must include 3♠.');
  }

  if (!canBeat(combo, round.trick.leadCombo)) {
    throw new Error(`${combo.label} cannot beat ${round.trick.leadCombo?.label}.`);
  }

  const playedIds = new Set(combo.cards.map((c) => c.id));
  const newHands = round.hands.map((hand, idx) =>
    idx === playerIndex ? hand.filter((c) => !playedIds.has(c.id)) : hand
  );

  const chop = isBombChop(combo, round.trick.leadCombo);
  const newChopEvents = [...round.chopEvents];
  if (chop && round.trick.leaderIndex !== null && round.trick.leaderIndex !== playerIndex) {
    newChopEvents.push({
      bomberIndex: playerIndex,
      victimIndex: round.trick.leaderIndex,
      targetCombo: round.trick.leadCombo,
      bombCombo: combo,
      points: CHOP_BONUS_POINTS,
    });
  }

  const newFinishedOrder = [...round.finishedOrder];
  const wentOut = newHands[playerIndex].length === 0;
  if (wentOut) {
    newFinishedOrder.push(playerIndex);
  }

  const playerName = state.players[playerIndex].name;
  const playMessage = chop
    ? `${playerName} CHOPS ${round.trick.leadCombo.shortLabel} with ${combo.label}!`
    : round.trick.leadCombo
      ? `${playerName} plays ${combo.label}.`
      : `${playerName} leads ${combo.label}.`;

  const updatedTrick = {
    ...round.trick,
    leadCombo: combo,
    leaderIndex: playerIndex,
    plays: [...round.trick.plays, { playerIndex, combo, isChop: chop }],
  };

  let nextRound = {
    ...round,
    hands: newHands,
    mustIncludeCardId: null,
    trick: updatedTrick,
    chopEvents: newChopEvents,
    finishedOrder: newFinishedOrder,
    log: [
      ...round.log,
      {
        type: 'play',
        playerIndex,
        combo,
        isChop: chop,
        wentOut,
        message: wentOut
          ? `${playMessage} (${ordinal(newFinishedOrder.length)} place!)`
          : playMessage,
      },
    ],
  };

  // Check if round is complete (3 players out -> only 1 or 0 players still holding cards)
  const remainingPlayers = [0, 1, 2, 3].filter((i) => nextRound.hands[i].length > 0);
  if (remainingPlayers.length <= 1) {
    if (remainingPlayers.length === 1) {
      nextRound.finishedOrder = [...nextRound.finishedOrder, remainingPlayers[0]];
    }
    return finalizeRound({ ...state, round: nextRound });
  }

  // Check if any other player with cards is still unpassed in this trick
  const responders = getEligibleResponders(nextRound, playerIndex);
  if (responders.length === 0) {
    nextRound = concludeTrick(nextRound, state.players);
  } else {
    const nextTurn = findNextClockwise(
      playerIndex,
      (i) => i !== playerIndex && nextRound.hands[i].length > 0 && !nextRound.trick.passed[i]
    );
    nextRound.currentTurn = nextTurn;
  }

  return {
    ...state,
    round: nextRound,
  };
}

/**
 * Passes the current trick for `playerIndex`.
 * Note: Cannot pass when leading an open trick (`trick.leadCombo === null`).
 */
export function passTurn(state, playerIndex) {
  const { round } = state;
  if (round.status !== 'playing') {
    throw new Error('Round is already finished.');
  }
  if (playerIndex !== round.currentTurn) {
    throw new Error(`It is not ${state.players[playerIndex].name}'s turn.`);
  }
  if (!round.trick.leadCombo) {
    throw new Error('Cannot pass when leading a new trick.');
  }

  const newPassed = [...round.trick.passed];
  newPassed[playerIndex] = true;

  let nextRound = {
    ...round,
    trick: {
      ...round.trick,
      passed: newPassed,
    },
    log: [
      ...round.log,
      {
        type: 'pass',
        playerIndex,
        message: `${state.players[playerIndex].name} passes.`,
      },
    ],
  };

  const leaderIndex = nextRound.trick.leaderIndex;
  const responders = getEligibleResponders(nextRound, leaderIndex);

  if (responders.length === 0) {
    nextRound = concludeTrick(nextRound, state.players);
  } else {
    const nextTurn = findNextClockwise(
      playerIndex,
      (i) => i !== leaderIndex && nextRound.hands[i].length > 0 && !nextRound.trick.passed[i]
    );
    nextRound.currentTurn = nextTurn;
  }

  return {
    ...state,
    round: nextRound,
  };
}

function concludeTrick(round, players) {
  const { leaderIndex, leadCombo } = round.trick;
  let nextLeader = leaderIndex;

  if (round.hands[leaderIndex].length === 0) {
    nextLeader = findNextClockwise(leaderIndex, (i) => round.hands[i].length > 0);
  }

  const winMessage =
    nextLeader === leaderIndex
      ? `${players[leaderIndex].name} wins the trick and leads next.`
      : `All passed — ${players[nextLeader].name} inherits the lead.`;

  return {
    ...round,
    currentTurn: nextLeader,
    previousTrickCombo: leadCombo,
    trick: createEmptyTrick(),
    log: [
      ...round.log,
      {
        type: 'trick_won',
        playerIndex: nextLeader,
        message: winMessage,
      },
    ],
  };
}

function finalizeRound(state) {
  const { round, players } = state;
  const placements = round.finishedOrder;
  const placementDeltas = [0, 0, 0, 0];
  const bonusDeltas = [0, 0, 0, 0];
  const bonuses = [];

  placements.forEach((playerIdx, rankIdx) => {
    placementDeltas[playerIdx] = PLACEMENT_POINTS[rankIdx] ?? 0;
  });

  // Apply Bomb Chop ("Chặt Heo") bonuses
  for (const chop of round.chopEvents) {
    bonusDeltas[chop.bomberIndex] += chop.points;
    bonusDeltas[chop.victimIndex] -= chop.points;
    bonuses.push({
      type: 'chop',
      playerIndex: chop.bomberIndex,
      victimIndex: chop.victimIndex,
      points: chop.points,
      description: `${players[chop.bomberIndex].name} chopped ${players[chop.victimIndex].name}'s ${chop.targetCombo.shortLabel} (+${chop.points})`,
    });
  }

  // Apply Burned Two ("Thối Heo") penalty on 4th-place finisher holding unused 2s
  const lastPlaceIndex = placements[3];
  const firstPlaceIndex = placements[0];
  if (lastPlaceIndex !== undefined && firstPlaceIndex !== undefined) {
    const unusedTwos = round.hands[lastPlaceIndex].filter((c) => c.rankIndex === TWO_RANK_INDEX);
    if (unusedTwos.length > 0) {
      const penalty = unusedTwos.length * BURNED_TWO_PENALTY;
      bonusDeltas[lastPlaceIndex] -= penalty;
      bonusDeltas[firstPlaceIndex] += penalty;
      bonuses.push({
        type: 'burned_two',
        playerIndex: firstPlaceIndex,
        victimIndex: lastPlaceIndex,
        points: penalty,
        description: `${players[lastPlaceIndex].name} caught holding ${unusedTwos.map((c) => c.label).join(' ')} (-${penalty} to ${players[firstPlaceIndex].name})`,
      });
    }
  }

  const totalDeltas = [0, 1, 2, 3].map((i) => placementDeltas[i] + bonusDeltas[i]);
  const newScores = state.scores.map((s, i) => s + totalDeltas[i]);

  const summary = {
    placements,
    placementDeltas,
    bonusDeltas,
    bonuses,
    totalDeltas,
    scoresAfter: newScores,
    instantWin: null,
  };

  return {
    ...state,
    scores: newScores,
    lastWinnerIndex: firstPlaceIndex,
    round: {
      ...round,
      status: 'round_over',
      summary,
      log: [
        ...round.log,
        {
          type: 'round_over',
          playerIndex: firstPlaceIndex,
          message: `Round ${round.number} complete! ${players[firstPlaceIndex].name} takes 1st place.`,
        },
      ],
    },
  };
}

/**
 * Convenience helper to list all currently legal moves for the active player.
 */
export function getActiveLegalMoves(state) {
  const { round } = state;
  if (round.status !== 'playing') return [];
  const hand = round.hands[round.currentTurn];
  return generateLegalMoves(hand, round.trick.leadCombo, round.mustIncludeCardId);
}

function ordinal(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}
