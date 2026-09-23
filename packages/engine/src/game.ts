import { Card, Rng, deckFor, shuffle, sortHand, suitOf, valueOf } from './cards';
import { PassDir, Rules, passDirFor, passTarget } from './rules';

export interface Play { seat: number; card: Card }
export interface Trick { leader: number; plays: Play[]; winner?: number }
export type Phase = 'passing' | 'playing' | 'handOver' | 'gameOver';

export interface HandResult {
  hand: number;
  /** Points each seat took in tricks, before moon adjustments. */
  raw: number[];
  /** What each seat actually scored for the hand. */
  scored: number[];
  /** Seat that shot the moon, if any. */
  moon: number | null;
  sun: boolean;
  /** Seats reset to 0 by landing exactly on the target. */
  resets: number[];
}

export interface GameState {
  rules: Rules;
  hand: number;
  phase: Phase;
  passDir: PassDir;
  hands: Card[][];
  /** Cards each seat chose to pass this hand, or null until it passes. */
  passes: (Card[] | null)[];
  /** Cards each seat received this hand. */
  received: Card[][];
  trick: Trick;
  tricks: Trick[];
  /** Seat to act while playing. */
  turn: number;
  heartsBroken: boolean;
  /** Point-carrying cards each seat has taken this hand (public information). */
  taken: Card[][];
  /** Tricks won this hand, per seat. */
  trickCount: number[];
  scores: number[];
  history: HandResult[];
  winners: number[];
}

export class RuleError extends Error {}

/** Points a single card carries under these rules (negative for the J♦). */
export function cardPoints(card: Card, rules: Rules): number {
  if (suitOf(card) === 'H') return 1;
  if (card === 'QS') return 13;
  if (rules.blackMaria && card === 'AS') return 7;
  if (rules.blackMaria && card === 'KS') return 10;
  if (rules.jackOfDiamonds && card === 'JD') return -10;
  return 0;
}

/** A positive penalty card: hearts, the Q♠, and Black Maria's A♠ and K♠. */
export function isPenalty(card: Card, rules: Rules): boolean {
  return cardPoints(card, rules) > 0;
}

/** Everything a moon shooter must take. */
export function penaltyTotal(rules: Rules): number {
  return 13 + 13 + (rules.blackMaria ? 17 : 0);
}

export function createGame(rules: Rules, rng: Rng): GameState {
  const state: GameState = {
    rules,
    hand: 0,
    phase: 'passing',
    passDir: 'hold',
    hands: [],
    passes: [],
    received: [],
    trick: { leader: 0, plays: [] },
    tricks: [],
    turn: 0,
    heartsBroken: false,
    taken: [],
    trickCount: [],
    scores: Array(rules.seats).fill(0),
    history: [],
    winners: [],
  };
  dealHand(state, rng);
  return state;
}

/** Shuffle a fresh deck and start the next hand. */
export function dealHand(state: GameState, rng: Rng): void {
  const n = state.rules.seats;
  const deck = shuffle(deckFor(n), rng);
  const per = deck.length / n;
  state.hand += 1;
  state.hands = Array.from({ length: n }, (_, i) => sortHand(deck.slice(i * per, (i + 1) * per)));
  state.passes = Array(n).fill(null);
  state.received = Array.from({ length: n }, () => []);
  state.tricks = [];
  state.heartsBroken = false;
  state.taken = Array.from({ length: n }, () => []);
  state.trickCount = Array(n).fill(0);
  state.winners = [];
  state.passDir = passDirFor(state.rules, state.hand);
  if (state.passDir === 'hold') beginPlay(state);
  else {
    state.phase = 'passing';
    state.trick = { leader: 0, plays: [] };
  }
}

function beginPlay(state: GameState): void {
  const opener = state.hands.findIndex((h) => h.includes('2C'));
  state.phase = 'playing';
  state.turn = opener;
  state.trick = { leader: opener, plays: [] };
}

export function passRecipient(state: GameState, seat: number): number {
  return passTarget(state.rules.seats, seat, state.passDir);
}

export function submitPass(state: GameState, seat: number, cards: Card[]): void {
  if (state.phase !== 'passing') throw new RuleError('It is not time to pass.');
  if (state.passes[seat]) throw new RuleError('This seat already passed.');
  const need = state.rules.passCount;
  const unique = [...new Set(cards)];
  if (unique.length !== need) throw new RuleError(`Pass exactly ${need} cards.`);
  if (!unique.every((c) => state.hands[seat].includes(c))) throw new RuleError('You can only pass cards in your hand.');
  state.passes[seat] = unique;
  if (state.passes.every(Boolean)) exchangePasses(state);
}

function exchangePasses(state: GameState): void {
  const n = state.rules.seats;
  const outgoing = state.passes as Card[][];
  const hands = state.hands.map((h, s) => h.filter((c) => !outgoing[s].includes(c)));
  for (let s = 0; s < n; s++) {
    const to = passRecipient(state, s);
    hands[to].push(...outgoing[s]);
    state.received[to] = outgoing[s].slice();
  }
  state.hands = hands.map(sortHand);
  beginPlay(state);
}

/** Pass for a seat that ran out of time: its preferred cards first, then random ones. */
export function autoPassCards(state: GameState, seat: number, preferred: Card[], rng: Rng): Card[] {
  const hand = state.hands[seat];
  const need = state.rules.passCount;
  const chosen = [...new Set(preferred.filter((c) => hand.includes(c)))].slice(0, need);
  const rest = shuffle(hand.filter((c) => !chosen.includes(c)), rng);
  return chosen.concat(rest.slice(0, need - chosen.length));
}

export function isFirstTrick(state: GameState): boolean {
  return state.tricks.length === 0;
}

/** The cards `seat` may play right now; empty when it is not that seat's turn. */
export function legalPlays(state: GameState, seat: number): Card[] {
  if (state.phase !== 'playing' || state.turn !== seat) return [];
  const hand = state.hands[seat];
  const { rules, trick } = state;
  if (trick.plays.length === 0) {
    if (isFirstTrick(state)) return hand.includes('2C') ? ['2C'] : hand.slice();
    if (rules.heartsMustBeBroken && !state.heartsBroken) {
      const nonHearts = hand.filter((c) => suitOf(c) !== 'H');
      if (nonHearts.length) return nonHearts;
    }
    return hand.slice();
  }
  const led = suitOf(trick.plays[0].card);
  const follow = hand.filter((c) => suitOf(c) === led);
  if (follow.length) return follow;
  if (isFirstTrick(state) && !rules.firstTrickPoints) {
    const safe = hand.filter((c) => !isPenalty(c, rules));
    if (safe.length) return safe;
    // Only point cards left: hearts are allowed, but the Q♠ only if nothing else is.
    const hearts = hand.filter((c) => suitOf(c) === 'H');
    if (hearts.length) return hearts;
  }
  return hand.slice();
}

export function trickWinner(trick: Trick): number {
  const led = suitOf(trick.plays[0].card);
  let best = trick.plays[0];
  for (const p of trick.plays) if (suitOf(p.card) === led && valueOf(p.card) > valueOf(best.card)) best = p;
  return best.seat;
}

export interface PlayOutcome { trick?: Trick; result?: HandResult }

export function playCard(state: GameState, seat: number, card: Card): PlayOutcome {
  if (state.phase !== 'playing') throw new RuleError('It is not time to play.');
  if (state.turn !== seat) throw new RuleError('It is not this seat’s turn.');
  if (!legalPlays(state, seat).includes(card)) throw new RuleError('That card cannot be played now.');
  const { rules } = state;
  state.hands[seat] = state.hands[seat].filter((c) => c !== card);
  state.trick.plays.push({ seat, card });
  if (suitOf(card) === 'H' || (rules.queenBreaksHearts && card === 'QS')) state.heartsBroken = true;

  const n = rules.seats;
  if (state.trick.plays.length < n) {
    state.turn = (seat + 1) % n;
    return {};
  }
  const done: Trick = { ...state.trick, winner: trickWinner(state.trick) };
  const winner = done.winner!;
  state.tricks.push(done);
  state.trickCount[winner] += 1;
  state.taken[winner].push(...done.plays.map((p) => p.card).filter((c) => cardPoints(c, rules) !== 0));
  state.trick = { leader: winner, plays: [] };
  state.turn = winner;
  if (state.hands.every((h) => h.length === 0)) return { trick: done, result: finishHand(state) };
  return { trick: done };
}

/** Points each seat has taken so far this hand (raw, before any moon). */
export function handPoints(state: GameState): number[] {
  return state.taken.map((cards) => cards.reduce((n, c) => n + cardPoints(c, state.rules), 0));
}

export function scoreHand(state: GameState): HandResult {
  const { rules } = state;
  const n = rules.seats;
  const raw = handPoints(state);
  const jack = state.taken.map((cards) => (rules.jackOfDiamonds && cards.includes('JD') ? -10 : 0));
  const penalty = raw.map((r, s) => r - jack[s]);
  const total = penaltyTotal(rules);
  const shooter = rules.moon === 'off' ? -1 : penalty.findIndex((p) => p === total);
  let scored = raw.slice();
  let sun = false;
  if (shooter >= 0) {
    const tricksPerHand = state.tricks.length;
    sun = rules.shootTheSun && state.trickCount[shooter] === tricksPerHand;
    const value = sun ? total * 2 : total;
    const add = jack.map((j, s) => (s === shooter ? j : j + value));
    const sub = jack.map((j, s) => (s === shooter ? j - value : j));
    if (rules.moon === 'addToOthers') scored = add;
    else if (rules.moon === 'subtractFromShooter') scored = sub;
    else {
      // Shooter's best: whichever option doesn't end the game with the shooter losing.
      const fine = (option: number[]) => {
        const after = state.scores.map((sc, s) => sc + option[s]);
        return !after.some((x) => x >= rules.target) || winnersOf(after).includes(shooter);
      };
      scored = fine(add) || !fine(sub) ? add : sub;
    }
  }
  return { hand: state.hand, raw, scored, moon: shooter >= 0 ? shooter : null, sun, resets: [] };
}

export function winnersOf(scores: number[]): number[] {
  const low = Math.min(...scores);
  return scores.map((s, i) => (s === low ? i : -1)).filter((i) => i >= 0);
}

function finishHand(state: GameState): HandResult {
  const result = scoreHand(state);
  const { rules } = state;
  state.scores = state.scores.map((s, i) => s + result.scored[i]);
  if (rules.exactReset) {
    state.scores = state.scores.map((s, i) => {
      if (s === rules.target) { result.resets.push(i); return 0; }
      return s;
    });
  }
  state.history.push(result);
  if (state.scores.some((s) => s >= rules.target)) {
    state.phase = 'gameOver';
    state.winners = winnersOf(state.scores);
  } else {
    state.phase = 'handOver';
  }
  return result;
}

/** Deal the next hand after a hand has been scored. */
export function nextHand(state: GameState, rng: Rng): void {
  if (state.phase !== 'handOver') throw new RuleError('The hand is not over.');
  dealHand(state, rng);
}

/** Start a fresh game with the same rules and seats. */
export function restartGame(state: GameState, rng: Rng): GameState {
  return createGame(state.rules, rng);
}
