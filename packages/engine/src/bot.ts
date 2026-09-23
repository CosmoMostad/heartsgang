import { Card, Rng, deckFor, suitOf, valueOf, Suit } from './cards';
import { GameState, cardPoints, isPenalty, legalPlays } from './game';

/**
 * A rule-based Hearts player that works at any table size. It is not a
 * genius, but it protects the Q♠, ducks, dumps on voids and hunts the queen,
 * which is enough to keep an empty seat honest.
 */

const bySuit = (cards: Card[], s: Suit) => cards.filter((c) => suitOf(c) === s);
const low = (cards: Card[]) => cards.reduce((m, c) => (valueOf(c) < valueOf(m) ? c : m));
const high = (cards: Card[]) => cards.reduce((m, c) => (valueOf(c) > valueOf(m) ? c : m));

function passDanger(card: Card, hand: Card[], state: GameState): number {
  const { rules } = state;
  const s = suitOf(card);
  const v = valueOf(card);
  const spades = bySuit(hand, 'S');
  const lowSpades = spades.filter((c) => valueOf(c) < 12).length;
  const suitLen = bySuit(hand, s).length;
  if (s === 'S') {
    if (card === 'QS') return lowSpades >= 3 ? 20 : lowSpades === 2 ? 60 : 100;
    if (v >= 13) return hand.includes('QS') && spades.length >= 4 ? 15 : lowSpades >= 3 ? 40 : 85;
    return -50;
  }
  if (s === 'H') {
    const base = [0, 0, -35, -25, -15, -5, 5, 15, 25, 35, 45, 55, 70, 80, 85][v];
    return base + (bySuit(hand, 'H').length >= 5 && v >= 10 ? -20 : 0);
  }
  if (rules.jackOfDiamonds && s === 'D') {
    if (card === 'JD') return -60;
    if (v > 11) return 10; // high diamonds capture the jack; keep them more often
  }
  const club = s === 'C';
  let d = club ? [0, 0, -12, -12, -12, 0, 0, 0, 2, 5, 10, 18, 28, 36, 42][v] : [0, 0, -12, -12, -12, 0, 0, 0, 2, 6, 14, 25, 38, 50, 60][v];
  if (suitLen === 1) d += 45;
  else if (suitLen === 2) d += 25;
  return d;
}

export function botPass(state: GameState, seat: number): Card[] {
  const hand = state.hands[seat];
  return hand
    .map((c) => ({ c, d: passDanger(c, hand, state) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, state.rules.passCount)
    .map((x) => x.c);
}

/** Cards not yet seen by this seat: not in its hand and not played. */
function unseen(state: GameState, seat: number): Set<Card> {
  const seen = new Set<Card>(state.hands[seat]);
  for (const t of state.tricks) for (const p of t.plays) seen.add(p.card);
  for (const p of state.trick.plays) seen.add(p.card);
  return new Set(deckFor(state.rules.seats).filter((c) => !seen.has(c)));
}

function queenGone(state: GameState): boolean {
  return state.tricks.some((t) => t.plays.some((p) => p.card === 'QS')) || state.trick.plays.some((p) => p.card === 'QS');
}

export function botPlay(state: GameState, seat: number, rng?: Rng): Card {
  const legal = legalPlays(state, seat);
  if (legal.length === 1) return legal[0];
  const { rules, trick } = state;
  const hand = state.hands[seat];
  const out = unseen(state, seat);
  const qsOut = !queenGone(state) && !hand.includes('QS');

  // Leading.
  if (trick.plays.length === 0) {
    const lowSpades = legal.filter((c) => suitOf(c) === 'S' && valueOf(c) < 12);
    if (qsOut && lowSpades.length) return low(lowSpades);
    let best = legal[0];
    let bestScore = -Infinity;
    for (const c of legal) {
      const inSuit = [...out].filter((x) => suitOf(x) === suitOf(c));
      const higher = inSuit.filter((x) => valueOf(x) > valueOf(c)).length;
      let score = inSuit.length ? higher / inSuit.length : -1; // nobody else holds the suit: everyone dumps on it
      if (suitOf(c) === 'H') score -= 0.3;
      if (c === 'QS' || (qsOut && suitOf(c) === 'S' && valueOf(c) > 12)) score -= 2;
      if (rules.jackOfDiamonds && c === 'JD') score -= 1;
      score -= valueOf(c) / 100;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  const led = suitOf(trick.plays[0].card);
  const following = suitOf(legal[0]) === led && legal.every((c) => suitOf(c) === led);
  const winning = trick.plays.filter((p) => suitOf(p.card) === led).reduce((m, p) => (valueOf(p.card) > valueOf(m.card) ? p : m));
  const pointsOnTable = trick.plays.reduce((n, p) => n + cardPoints(p.card, rules), 0);
  const last = trick.plays.length === rules.seats - 1;

  if (following) {
    const under = legal.filter((c) => valueOf(c) < valueOf(winning.card));
    const over = legal.filter((c) => valueOf(c) > valueOf(winning.card));
    if (legal.includes('QS') && valueOf(winning.card) > 12) return 'QS';
    // The J♦ is worth grabbing when it is on the table and the trick is otherwise cheap.
    if (rules.jackOfDiamonds && trick.plays.some((p) => p.card === 'JD') && over.length && pointsOnTable < 0) return high(over);
    if (last && pointsOnTable <= 0 && over.length) {
      const safe = over.filter((c) => c !== 'QS');
      if (safe.length) return high(safe);
    }
    if (under.length) {
      const noQueen = under.filter((c) => c !== 'QS');
      return high(noQueen.length ? noQueen : under);
    }
    const noQueen = over.filter((c) => c !== 'QS');
    const pool = noQueen.length ? noQueen : over;
    return last ? high(pool) : low(pool);
  }

  // Void in the led suit: a free discard.
  if (legal.includes('QS')) return 'QS';
  if (qsOut) {
    const catchers = legal.filter((c) => suitOf(c) === 'S' && valueOf(c) > 12);
    if (catchers.length) return high(catchers);
  }
  const hearts = legal.filter((c) => suitOf(c) === 'H');
  if (hearts.length) return high(hearts);
  const keep = (c: Card) => (rules.jackOfDiamonds && c === 'JD') || (suitOf(c) === 'S' && valueOf(c) < 12 && qsOut);
  const pool = legal.filter((c) => !keep(c) && !isPenalty(c, rules));
  const choices = pool.length ? pool : legal;
  // Prefer high cards from short suits.
  let best = choices[0];
  let bestScore = -Infinity;
  for (const c of choices) {
    const len = bySuit(hand, suitOf(c)).length;
    const score = valueOf(c) * 2 - len * 3 + (rng ? rng(3) : 0);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/** A random legal card, used when a turn timer runs out. */
export function randomLegal(state: GameState, seat: number, rng: Rng): Card {
  const legal = legalPlays(state, seat);
  if (!legal.length) throw new Error('No legal plays for this seat.');
  return legal[rng(legal.length)];
}
