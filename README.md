# Thirteen (Tiến Lên)

A playable web implementation of **Thirteen** (*Tiến Lên* / Southern Vietnamese Poker), the classic 4-player shedding card game. Built with semantic HTML, Vanilla CSS, and zero-dependency ES Modules.

## Features

- **Authentic Southern Tiến Lên Rules:**
  - **Rank Hierarchy:** `3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2`
  - **Suit Hierarchy:** `♠ Spades < ♣ Clubs < ♦ Diamonds < ♥ Hearts` (`3♠` lowest, `2♥` highest)
  - **Opening Lead:** Player holding `3♠` opens Round 1 with a combination containing `3♠`; subsequent rounds are led freely by the previous round's winner.
  - **Valid Combinations:** Singles, Pairs, Triples, Four of a Kind, Straights (3–12 consecutive cards, `2`s excluded), and Consecutive Pairs (`3+` adjacent pairs).
  - **Bombs ("Chặt Heo"):**
    - Chop a **Single `2`** with **3+ Consecutive Pairs** or **Four of a Kind** (`+2` bonus points).
    - Chop a **Pair of `2`s** with **Four of a Kind** or **4+ Consecutive Pairs**.
    - Bomb-over-bomb escalation (`3-Pair < Quad < 4-Pair < ...`).
  - **Instant Wins ("Tới Trắng"):** Automatic detection for Dragon Straights, Four `2`s, and Six Pairs on the deal.
  - **Match Scoring:** Placement points (`+3 / +1 / -1 / -3`), Bomb Chop transfers (`±2`), and Burned `2` penalties on 4th place.
- **Partition-Aware AI Opponents:** Three difficulty profiles (`Casual`, `Standard`, and `Sharp`) that evaluate hand structure, conserve `2`s and bombs, and defend against low-card opponents.
- **Tactile Card-Room Interface:**
  - **Double-click** any card to auto-select a legal multi-card combination containing it.
  - Press **`H`** (or click **Hint**) to cycle through all legal plays in your hand.
  - Keyboard shortcuts: `Enter` (Play), `P` (Pass), `H` (Hint), `C` / `Esc` (Clear), `S` (Toggle Rank/Suit sort).
  - Synthesized Web Audio card & table sound effects with mute toggle.

## Quick Start

Serve the root directory with any static HTTP server:

```bash
npm start
# Serves at http://localhost:3000
```

## Running Tests

The rule engine and AI simulation suite run natively on Node's built-in test runner:

```bash
npm test
```

## Project Structure

```text
├── index.html             # Card table UI, scoreboard modal, and rules reference
├── styles/
│   └── index.css          # Heritage baize & ivory card design system
├── src/
│   ├── engine/
│   │   ├── cards.js       # Deck, card power encoding, parsing, and sorting
│   │   ├── combos.js      # Combo classifier, bomb hierarchy, and legal move generator
│   │   └── game.js        # Pure state machine for tricks, pass-locks, and match scoring
│   ├── ai/
│   │   └── bot.js         # Partition-aware AI & Hint ranking heuristics
│   └── ui/
│       ├── app.js         # Interactive table controller, shortcuts, and turn pacing
│       ├── audio.js       # Web Audio synthesizer for card snaps & table effects
│       └── cards-svg.js   # Crisp SVG suit & playing card DOM renderer
└── tests/
    └── engine.test.mjs    # Automated unit & 40-round AI simulation tests
```
