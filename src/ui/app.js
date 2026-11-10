/**
 * Main UI controller for Thirteen (Tiến Lên).
 * Connects game state engine, AI scheduler, card rendering, sound, and modals.
 */

import { sortByRank, sortBySuit } from '../engine/cards.js';
import { explainSelection } from '../engine/combos.js';
import {
  createMatch,
  passTurn,
  playCards,
  startNextRound,
} from '../engine/game.js';
import { chooseBotAction, rankLegalMoves } from '../ai/bot.js';
import { sound } from './audio.js';
import { renderCardBackFan, renderPlayingCard } from './cards-svg.js';

const STORAGE_PREFS_KEY = 'thirteen_prefs_v1';

class ThirteenApp {
  constructor() {
    this.prefs = this.loadPrefs();
    sound.setMuted(this.prefs.muted);

    this.state = createMatch({ difficulty: this.prefs.difficulty });
    this.selectedIds = new Set();
    this.hintCursor = 0;
    this.botTimer = null;

    this.cacheDom();
    this.bindEvents();
    this.syncPrefsControls();
    this.render();
    this.scheduleNextBotIfNeeded();
  }

  loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          difficulty: parsed.difficulty || 'standard',
          muted: Boolean(parsed.muted),
          sortMode: parsed.sortMode === 'suit' ? 'suit' : 'rank',
        };
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
    return { difficulty: 'standard', muted: false, sortMode: 'rank' };
  }

  savePrefs() {
    try {
      localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Ignore storage errors
    }
  }

  cacheDom() {
    this.dom = {
      roundLabel: document.getElementById('round-label'),
      difficultySelect: document.getElementById('difficulty-select'),
      sortBtn: document.getElementById('btn-sort'),
      soundBtn: document.getElementById('btn-sound'),
      rulesBtn: document.getElementById('btn-rules'),
      newMatchBtn: document.getElementById('btn-new-match'),

      tableFelt: document.getElementById('table-felt'),
      seatWest: document.getElementById('seat-west'),
      seatNorth: document.getElementById('seat-north'),
      seatEast: document.getElementById('seat-east'),

      watermark: document.getElementById('table-watermark'),
      trickStack: document.getElementById('trick-stack'),
      trickPrev: document.getElementById('trick-prev-play'),
      trickActive: document.getElementById('trick-active-play'),
      trickCaption: document.getElementById('trick-caption'),
      eventTicker: document.getElementById('event-ticker'),

      youBadge: document.getElementById('you-badge'),
      youStatusText: document.getElementById('you-status-text'),
      youScore: document.getElementById('you-score'),
      selectionFeedback: document.getElementById('selection-feedback'),

      clearBtn: document.getElementById('btn-clear'),
      hintBtn: document.getElementById('btn-hint'),
      passBtn: document.getElementById('btn-pass'),
      playBtn: document.getElementById('btn-play'),
      handTray: document.getElementById('hand-tray'),

      summaryModal: document.getElementById('summary-modal'),
      summaryTitle: document.getElementById('summary-title'),
      summarySubtitle: document.getElementById('summary-subtitle'),
      summaryBonuses: document.getElementById('summary-bonuses'),
      summaryTableBody: document.getElementById('summary-table-body'),
      nextRoundBtn: document.getElementById('btn-next-round'),
      summaryNewMatchBtn: document.getElementById('btn-summary-new-match'),

      rulesModal: document.getElementById('rules-modal'),
      closeRulesBtn: document.getElementById('btn-close-rules'),
      gotItRulesBtn: document.getElementById('btn-got-it-rules'),
    };
  }

  bindEvents() {
    this.dom.difficultySelect.addEventListener('change', (e) => {
      this.prefs.difficulty = e.target.value;
      this.state.settings.difficulty = this.prefs.difficulty;
      this.savePrefs();
    });

    this.dom.sortBtn.addEventListener('click', () => {
      this.toggleSortMode();
    });

    this.dom.soundBtn.addEventListener('click', () => {
      this.prefs.muted = !this.prefs.muted;
      sound.setMuted(this.prefs.muted);
      this.savePrefs();
      this.syncPrefsControls();
    });

    this.dom.rulesBtn.addEventListener('click', () => {
      this.dom.rulesModal.hidden = false;
    });

    this.dom.closeRulesBtn.addEventListener('click', () => {
      this.dom.rulesModal.hidden = true;
    });

    this.dom.gotItRulesBtn.addEventListener('click', () => {
      this.dom.rulesModal.hidden = true;
    });

    this.dom.rulesModal.addEventListener('click', (e) => {
      if (e.target === this.dom.rulesModal) {
        this.dom.rulesModal.hidden = true;
      }
    });

    this.dom.newMatchBtn.addEventListener('click', () => {
      this.resetMatch();
    });

    this.dom.summaryNewMatchBtn.addEventListener('click', () => {
      this.dom.summaryModal.hidden = true;
      this.resetMatch();
    });

    this.dom.nextRoundBtn.addEventListener('click', () => {
      this.dom.summaryModal.hidden = true;
      this.beginNextRound();
    });

    this.dom.clearBtn.addEventListener('click', () => {
      this.clearSelection();
    });

    this.dom.hintBtn.addEventListener('click', () => {
      this.cycleHint();
    });

    this.dom.passBtn.addEventListener('click', () => {
      this.handleHumanPass();
    });

    this.dom.playBtn.addEventListener('click', () => {
      this.handleHumanPlay();
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;

      if (e.key === 'Escape') {
        if (!this.dom.rulesModal.hidden) {
          this.dom.rulesModal.hidden = true;
          return;
        }
        this.clearSelection();
        return;
      }

      if (!this.dom.summaryModal.hidden) {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.dom.summaryModal.hidden = true;
          this.beginNextRound();
        }
        return;
      }

      if (!this.dom.rulesModal.hidden) return;

      const key = e.key.toLowerCase();
      if (key === 'c') {
        this.clearSelection();
      } else if (key === 's') {
        this.toggleSortMode();
      } else if (key === 'h') {
        this.cycleHint();
      } else if (key === 'p') {
        this.handleHumanPass();
      } else if (e.key === 'Enter' && document.activeElement?.dataset?.cardId === undefined) {
        e.preventDefault();
        this.handleHumanPlay();
      }
    });
  }

  syncPrefsControls() {
    this.dom.difficultySelect.value = this.prefs.difficulty;
    this.dom.soundBtn.textContent = this.prefs.muted ? 'Sound: Off' : 'Sound: On';
    this.dom.soundBtn.setAttribute('aria-pressed', String(!this.prefs.muted));
    this.dom.sortBtn.textContent =
      this.prefs.sortMode === 'rank' ? 'Sort: Rank' : 'Sort: Suit';
  }

  toggleSortMode() {
    this.prefs.sortMode = this.prefs.sortMode === 'rank' ? 'suit' : 'rank';
    this.savePrefs();
    this.syncPrefsControls();
    sound.cardSelect(true);
    this.renderHand();
  }

  clearBotTimer() {
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  resetMatch() {
    this.clearBotTimer();
    this.selectedIds.clear();
    this.hintCursor = 0;
    this.dom.summaryModal.hidden = true;
    this.state = createMatch({ difficulty: this.prefs.difficulty });
    sound.cardPlay(4);
    this.render();
    this.scheduleNextBotIfNeeded();
  }

  beginNextRound() {
    this.clearBotTimer();
    this.selectedIds.clear();
    this.hintCursor = 0;
    this.state = startNextRound(this.state);
    sound.cardPlay(4);
    this.render();
    this.scheduleNextBotIfNeeded();
  }

  clearSelection() {
    if (this.selectedIds.size === 0) return;
    this.selectedIds.clear();
    sound.cardSelect(false);
    this.renderSouthHudAndHand();
  }

  toggleCard(cardId) {
    if (this.state.round.status !== 'playing') return;
    if (this.selectedIds.has(cardId)) {
      this.selectedIds.delete(cardId);
      sound.cardSelect(false);
    } else {
      this.selectedIds.add(cardId);
      sound.cardSelect(true);
    }
    this.renderSouthHudAndHand();
  }

  /**
   * Double-clicking a card selects the strongest-fitting multi-card legal play containing it.
   */
  autoCompleteComboForCard(cardId) {
    const { round } = this.state;
    if (round.status !== 'playing') return;
    const ranked = rankLegalMoves(this.state, 0, 'sharp');
    const match =
      ranked.find((r) => r.move.length > 1 && r.move.cards.some((c) => c.id === cardId)) ||
      ranked.find((r) => r.move.cards.some((c) => c.id === cardId));

    if (match) {
      this.selectedIds = new Set(match.move.cards.map((c) => c.id));
      sound.cardSelect(true);
      this.renderSouthHudAndHand();
    }
  }

  cycleHint() {
    const { round } = this.state;
    if (round.status !== 'playing' || round.currentTurn !== 0) return;

    const ranked = rankLegalMoves(this.state, 0, 'sharp');
    if (ranked.length === 0) {
      this.selectedIds.clear();
      sound.passTap();
      this.renderSouthHudAndHand();
      this.dom.selectionFeedback.textContent = 'No legal beating hand — click Pass.';
      this.dom.selectionFeedback.className = 'selection-feedback is-invalid';
      return;
    }

    const pick = ranked[this.hintCursor % ranked.length].move;
    this.hintCursor = (this.hintCursor + 1) % ranked.length;
    this.selectedIds = new Set(pick.cards.map((c) => c.id));
    sound.cardSelect(true);
    this.renderSouthHudAndHand();
  }

  getSelectedHumanCards() {
    const hand = this.state.round.hands[0];
    return hand.filter((c) => this.selectedIds.has(c.id));
  }

  handleHumanPlay() {
    const { round } = this.state;
    if (round.status !== 'playing' || round.currentTurn !== 0) return;

    const selected = this.getSelectedHumanCards();
    const check = explainSelection(selected, round.trick.leadCombo, round.mustIncludeCardId);
    if (!check.valid) return;

    this.applyPlay(0, selected);
  }

  handleHumanPass() {
    const { round } = this.state;
    if (round.status !== 'playing' || round.currentTurn !== 0) return;
    if (!round.trick.leadCombo) return;

    this.selectedIds.clear();
    this.hintCursor = 0;
    this.state = passTurn(this.state, 0);
    sound.passTap();
    this.render();
    this.scheduleNextBotIfNeeded();
  }

  applyPlay(playerIndex, cards) {
    const prevLead = this.state.round.trick.leadCombo;
    this.state = playCards(this.state, playerIndex, cards);
    if (playerIndex === 0) {
      this.selectedIds.clear();
      this.hintCursor = 0;
    }

    const lastLog = this.state.round.log[this.state.round.log.length - 1];
    if (lastLog?.isChop && prevLead) {
      sound.bombChop();
      this.triggerTableShake();
    } else {
      sound.cardPlay(cards.length);
    }

    if (this.state.round.status === 'round_over' && this.state.round.finishedOrder[0] === 0) {
      sound.roundWin();
    }

    this.render();
    this.scheduleNextBotIfNeeded();
  }

  triggerTableShake() {
    this.dom.tableFelt.classList.remove('is-shaking');
    void this.dom.tableFelt.offsetWidth;
    this.dom.tableFelt.classList.add('is-shaking');
  }

  scheduleNextBotIfNeeded() {
    this.clearBotTimer();
    const { round, players } = this.state;

    if (round.status === 'round_over') {
      this.showRoundSummaryModal();
      return;
    }

    const activePlayer = players[round.currentTurn];
    if (!activePlayer || activePlayer.isHuman) {
      return;
    }

    // Speed up bot resolution once the human player has already finished their hand
    const humanFinished = round.hands[0].length === 0;
    const delayMs = humanFinished ? 250 : 620;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.state.round.status !== 'playing') return;
      const seat = this.state.round.currentTurn;
      const decision = chooseBotAction(this.state, seat);
      if (decision.action === 'play') {
        this.applyPlay(seat, decision.cards);
      } else {
        this.state = passTurn(this.state, seat);
        sound.passTap();
        this.render();
        this.scheduleNextBotIfNeeded();
      }
    }, delayMs);
  }

  render() {
    const { round } = this.state;
    this.dom.roundLabel.textContent = `Round ${round.number}`;

    this.renderOpponentSeat(1, this.dom.seatWest);
    this.renderOpponentSeat(2, this.dom.seatNorth);
    this.renderOpponentSeat(3, this.dom.seatEast);

    this.renderTrickArena();
    this.renderSouthHudAndHand();
  }

  renderOpponentSeat(playerIndex, container) {
    const { players, scores, round } = this.state;
    const player = players[playerIndex];
    const cardCount = round.hands[playerIndex].length;
    const isTurn = round.status === 'playing' && round.currentTurn === playerIndex;
    const isPassed = round.trick.passed[playerIndex];
    const finishRank = round.finishedOrder.indexOf(playerIndex);

    let statusHtml = '';
    if (finishRank !== -1) {
      statusHtml = `<span class="seat-status-tag tag-finished">${ordinalBadge(finishRank + 1)} Place</span>`;
    } else if (isTurn) {
      statusHtml = `<span class="seat-status-tag tag-thinking">Thinking…</span>`;
    } else if (isPassed) {
      statusHtml = `<span class="seat-status-tag tag-passed">Passed</span>`;
    } else if (round.trick.leaderIndex === playerIndex) {
      statusHtml = `<span class="seat-status-tag tag-thinking">Trick Lead</span>`;
    }

    const scoreVal = scores[playerIndex];
    const formattedScore = scoreVal > 0 ? `+${scoreVal}` : `${scoreVal}`;

    container.className = [
      'opponent-card',
      isTurn ? 'is-active-turn' : '',
      isPassed && finishRank === -1 ? 'is-passed' : '',
    ]
      .filter(Boolean)
      .join(' ');

    container.innerHTML = `
      <div class="opponent-header">
        <span class="opponent-name">${player.name}</span>
        <span class="opponent-score">${formattedScore} pts</span>
      </div>
      <div class="opponent-body" data-fan-slot>
        <span class="card-count-badge ${cardCount > 0 && cardCount <= 3 ? 'is-low' : ''}">
          ${cardCount} ${cardCount === 1 ? 'card' : 'cards'}
        </span>
      </div>
      ${statusHtml}
    `;

    if (cardCount > 0) {
      const slot = container.querySelector('[data-fan-slot]');
      slot.prepend(renderCardBackFan(cardCount, player.seat));
    }
  }

  renderTrickArena() {
    const { round, players } = this.state;
    const { trick } = round;
    const plays = trick.plays;

    this.dom.trickPrev.innerHTML = '';
    this.dom.trickActive.innerHTML = '';

    if (!trick.leadCombo) {
      this.dom.watermark.hidden = false;
      this.dom.trickStack.hidden = true;
      this.dom.trickCaption.hidden = true;
    } else {
      this.dom.watermark.hidden = true;
      this.dom.trickStack.hidden = false;
      this.dom.trickCaption.hidden = false;

      if (plays.length >= 2) {
        const prevCombo = plays[plays.length - 2].combo;
        for (const card of prevCombo.cards) {
          this.dom.trickPrev.appendChild(renderPlayingCard(card, { compact: true }));
        }
      }

      const activePlay = plays[plays.length - 1];
      for (const card of trick.leadCombo.cards) {
        this.dom.trickActive.appendChild(renderPlayingCard(card, { compact: true }));
      }

      const leaderName = players[trick.leaderIndex].name;
      this.dom.trickCaption.className = activePlay?.isChop
        ? 'trick-caption is-chop-banner'
        : 'trick-caption';
      this.dom.trickCaption.innerHTML = activePlay?.isChop
        ? `<span>BOMB CHOP!</span> <span class="trick-leader-name">${leaderName}</span> · <span>${trick.leadCombo.label}</span>`
        : `<span class="trick-leader-name">${leaderName}</span> · <span>${trick.leadCombo.label}</span>`;
    }

    const latestEvent = round.log[round.log.length - 1];
    this.dom.eventTicker.textContent = latestEvent ? latestEvent.message : '';
  }

  renderSouthHudAndHand() {
    const { round, scores } = this.state;
    const isYourTurn = round.status === 'playing' && round.currentTurn === 0;
    const isPassed = round.trick.passed[0];
    const finishRank = round.finishedOrder.indexOf(0);

    this.dom.youBadge.className = isYourTurn ? 'you-badge is-your-turn' : 'you-badge';
    if (finishRank !== -1) {
      this.dom.youStatusText.textContent = `You (${ordinalBadge(finishRank + 1)} Place)`;
    } else if (isYourTurn) {
      this.dom.youStatusText.textContent = 'You · Your Turn';
    } else if (isPassed) {
      this.dom.youStatusText.textContent = 'You · Passed';
    } else {
      this.dom.youStatusText.textContent = 'You';
    }

    const humanScore = scores[0];
    this.dom.youScore.textContent = `${humanScore > 0 ? `+${humanScore}` : humanScore} pts`;

    const selectedCards = this.getSelectedHumanCards();
    const evaluation = explainSelection(
      selectedCards,
      round.trick.leadCombo,
      round.mustIncludeCardId
    );

    if (finishRank !== -1 && round.status === 'playing') {
      this.dom.selectionFeedback.textContent = 'Hand complete — watching remaining players finish…';
      this.dom.selectionFeedback.className = 'selection-feedback';
    } else if (!isYourTurn && round.status === 'playing') {
      if (selectedCards.length > 0) {
        this.dom.selectionFeedback.textContent = evaluation.combo
          ? `Pre-selected: ${evaluation.combo.label}`
          : `${selectedCards.length} cards staged`;
        this.dom.selectionFeedback.className = 'selection-feedback';
      } else {
        this.dom.selectionFeedback.textContent = isPassed
          ? 'Locked out until next trick.'
          : `Waiting on ${this.state.players[round.currentTurn].name}…`;
        this.dom.selectionFeedback.className = 'selection-feedback';
      }
    } else {
      this.dom.selectionFeedback.textContent = evaluation.message;
      this.dom.selectionFeedback.className = [
        'selection-feedback',
        selectedCards.length > 0 ? (evaluation.valid ? 'is-valid' : 'is-invalid') : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    this.dom.clearBtn.disabled = selectedCards.length === 0;
    this.dom.hintBtn.disabled = !isYourTurn;
    this.dom.passBtn.disabled = !isYourTurn || !round.trick.leadCombo;
    this.dom.playBtn.disabled = !isYourTurn || !evaluation.valid;

    this.renderHand();
  }

  renderHand() {
    const { round } = this.state;
    const rawHand = round.hands[0];
    const sortedHand =
      this.prefs.sortMode === 'suit' ? sortBySuit(rawHand) : sortByRank(rawHand);

    this.dom.handTray.innerHTML = '';

    for (const card of sortedHand) {
      const isSelected = this.selectedIds.has(card.id);
      const cardEl = renderPlayingCard(card, {
        interactive: true,
        selected: isSelected,
        mustPlayBadge: round.mustIncludeCardId === '3S' && round.currentTurn === 0,
      });

      cardEl.addEventListener('click', () => {
        this.toggleCard(card.id);
      });

      cardEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        this.autoCompleteComboForCard(card.id);
      });

      this.dom.handTray.appendChild(cardEl);
    }
  }

  showRoundSummaryModal() {
    const { round, players } = this.state;
    const summary = round.summary;
    if (!summary) return;

    const winnerName = players[summary.placements[0]].name;
    if (summary.instantWin) {
      this.dom.summaryTitle.textContent = `Instant Victory · ${summary.instantWin.title}!`;
      this.dom.summarySubtitle.textContent = `${winnerName} wins Round ${round.number} immediately on the deal.`;
    } else {
      const humanRank = summary.placements.indexOf(0) + 1;
      this.dom.summaryTitle.textContent =
        humanRank === 1
          ? `Victory! You Won Round ${round.number}`
          : `Round ${round.number} Complete · ${ordinalBadge(humanRank)} Place`;
      this.dom.summarySubtitle.textContent = `${winnerName} leads the opening trick of Round ${round.number + 1}.`;
    }

    if (summary.bonuses.length > 0) {
      this.dom.summaryBonuses.hidden = false;
      this.dom.summaryBonuses.innerHTML = summary.bonuses
        .map((b) => `<li>${b.description}</li>`)
        .join('');
    } else {
      this.dom.summaryBonuses.hidden = true;
      this.dom.summaryBonuses.innerHTML = '';
    }

    this.dom.summaryTableBody.innerHTML = summary.placements
      .map((playerIdx, rankIdx) => {
        const p = players[playerIdx];
        const delta = summary.totalDeltas[playerIdx];
        const total = summary.scoresAfter[playerIdx];
        const deltaClass = delta >= 0 ? 'delta-pos' : 'delta-neg';
        const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
        const totalStr = total > 0 ? `+${total}` : `${total}`;
        return `
          <tr class="${p.isHuman ? 'is-human-row' : ''}">
            <td>${ordinalBadge(rankIdx + 1)}</td>
            <td>${p.name}</td>
            <td class="${deltaClass}">${deltaStr}</td>
            <td><strong>${totalStr}</strong></td>
          </tr>
        `;
      })
      .join('');

    this.dom.summaryModal.hidden = false;
  }
}

function ordinalBadge(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

window.addEventListener('DOMContentLoaded', () => {
  window.thirteenApp = new ThirteenApp();
});
