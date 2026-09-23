/** Cards are two-character ids: rank then suit, e.g. "QS", "TH" (ten of hearts), "2C". */
export type Suit = 'C' | 'D' | 'H' | 'S';
export type Card = string;

export const RANKS = '23456789TJQKA';
export const SUITS: Suit[] = ['C', 'D', 'H', 'S'];
/** Order suits are shown in a hand: alternating colours. */
export const DISPLAY_SUITS: Suit[] = ['C', 'D', 'S', 'H'];
export const SUIT_SYMBOL: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' };
export const SUIT_NAME: Record<Suit, string> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };

export const FULL_DECK: Card[] = SUITS.flatMap((s) => RANKS.split('').map((r) => r + s));

export const rankOf = (c: Card) => c[0];
export const suitOf = (c: Card) => c[1] as Suit;
/** 2..14, ace high. */
export const valueOf = (c: Card) => RANKS.indexOf(c[0]) + 2;
export const isCard = (c: unknown): c is Card => typeof c === 'string' && c.length === 2 && FULL_DECK.includes(c);

/** Human label, e.g. "10♥". */
export function cardLabel(c: Card): string {
  const r = c[0] === 'T' ? '10' : c[0];
  return r + SUIT_SYMBOL[suitOf(c)];
}

/** Sorted for display: clubs, diamonds, spades, hearts; low to high. */
export function sortHand(cards: Card[]): Card[] {
  return cards.slice().sort((a, b) => DISPLAY_SUITS.indexOf(suitOf(a)) - DISPLAY_SUITS.indexOf(suitOf(b)) || valueOf(a) - valueOf(b));
}

/**
 * Cards removed so the deck deals evenly. Only low clubs and diamonds go,
 * never a point card, the J♦ or the 2♣ that opens the hand.
 */
export function removedCards(seats: number): Card[] {
  switch (seats) {
    case 3: return ['2D'];
    case 4: return [];
    case 5: return ['2D', '3D'];
    case 6: return ['2D', '3D', '3C', '4C'];
    default: throw new Error(`Unsupported seat count ${seats}`);
  }
}

export function deckFor(seats: number): Card[] {
  const removed = new Set(removedCards(seats));
  return FULL_DECK.filter((c) => !removed.has(c));
}

/** Random integer in [0, n). Injected so the server can use crypto and tests can be seeded. */
export type Rng = (n: number) => number;

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deterministic RNG for tests and simulations (mulberry32). */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return (n: number) => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    const f = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    return Math.floor(f * n);
  };
}
