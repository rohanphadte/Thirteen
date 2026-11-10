/**
 * Crisp playing card & SVG suit artwork renderer for Thirteen.
 */

const SUIT_PATHS = {
  S: `<svg viewBox="0 0 24 24" aria-hidden="true" class="suit-svg"><path fill="currentColor" d="M12 2C9 6.2 4 10.1 4 14.2c0 2.7 2.1 4.6 4.6 4.6 1.5 0 2.6-.7 3.4-1.7-.2 1.8-.9 3.4-2.3 4.4h4.6c-1.4-1-2.1-2.6-2.3-4.4.8 1 1.9 1.7 3.4 1.7 2.5 0 4.6-1.9 4.6-4.6C20 10.1 15 6.2 12 2z"/></svg>`,
  C: `<svg viewBox="0 0 24 24" aria-hidden="true" class="suit-svg"><path fill="currentColor" d="M12 2.5a4.2 4.2 0 0 0-4.2 4.2c0 1.4.7 2.7 1.8 3.4a4.3 4.3 0 0 0-6.1 3.9 4.3 4.3 0 0 0 4.3 4.3c1.6 0 3-.8 3.7-2.1-.2 1.9-.9 3.6-2.2 4.8h5.4c-1.3-1.2-2-2.9-2.2-4.8.7 1.3 2.1 2.1 3.7 2.1a4.3 4.3 0 0 0 4.3-4.3 4.3 4.3 0 0 0-6.1-3.9c1.1-.7 1.8-2 1.8-3.4A4.2 4.2 0 0 0 12 2.5z"/></svg>`,
  D: `<svg viewBox="0 0 24 24" aria-hidden="true" class="suit-svg"><path fill="currentColor" d="M12 2L4.5 12 12 22l7.5-10L12 2z"/></svg>`,
  H: `<svg viewBox="0 0 24 24" aria-hidden="true" class="suit-svg"><path fill="currentColor" d="M12 21.3l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5L12 21.3z"/></svg>`,
};

const COURT_TITLES = {
  J: 'JACK',
  Q: 'QUEEN',
  K: 'KING',
  A: 'ACE',
  '2': 'TWO',
};

/**
 * Creates a DOM element representing a face-up playing card.
 */
export function renderPlayingCard(card, options = {}) {
  const {
    interactive = false,
    selected = false,
    hinted = false,
    compact = false,
    mustPlayBadge = false,
  } = options;

  const el = document.createElement(interactive ? 'button' : 'div');
  if (interactive) {
    el.type = 'button';
    el.setAttribute('aria-pressed', String(selected));
    el.setAttribute('aria-label', `${card.rank} of ${card.suitName}`);
  }

  const classes = [
    'playing-card',
    `card-${card.color}`,
    compact ? 'card-compact' : '',
    interactive ? 'card-interactive' : '',
    selected ? 'is-selected' : '',
    hinted ? 'is-hinted' : '',
    card.rank === '2' ? 'is-power-two' : '',
  ]
    .filter(Boolean)
    .join(' ');

  el.className = classes;
  el.dataset.cardId = card.id;

  const suitSvg = SUIT_PATHS[card.suit];
  const centerBadge = COURT_TITLES[card.rank]
    ? `<span class="card-court-rank">${card.rank}</span><span class="card-court-suit">${suitSvg}</span>`
    : `<span class="card-center-pip">${suitSvg}</span>`;

  const starterTag =
    mustPlayBadge && card.id === '3S'
      ? `<span class="card-starter-pill" title="Must include 3♠ on opening lead">LEAD</span>`
      : '';

  el.innerHTML = `
    <span class="card-corner card-corner-top">
      <span class="card-rank">${card.rank}</span>
      <span class="card-mini-suit">${suitSvg}</span>
    </span>
    <span class="card-art">
      ${centerBadge}
    </span>
    <span class="card-corner card-corner-bottom" aria-hidden="true">
      <span class="card-rank">${card.rank}</span>
      <span class="card-mini-suit">${suitSvg}</span>
    </span>
    ${starterTag}
  `;

  return el;
}

/**
 * Renders a compact opponent card-back fan displaying remaining card count.
 */
export function renderCardBackFan(count, seat) {
  const wrapper = document.createElement('div');
  wrapper.className = `card-back-fan fan-${seat}`;
  const visibleBacks = Math.min(count, 6);
  for (let i = 0; i < visibleBacks; i += 1) {
    const back = document.createElement('span');
    back.className = 'card-back-mini';
    back.style.setProperty('--fan-idx', String(i));
    back.style.setProperty('--fan-total', String(visibleBacks));
    wrapper.appendChild(back);
  }
  return wrapper;
}
