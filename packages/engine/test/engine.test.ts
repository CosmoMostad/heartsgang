import { describe, expect, it } from 'vitest';
import {
  FULL_DECK, GameState, RuleError, autoPassCards, botPass, botPlay, cardLabel, cardPoints, cardsPerSeat, createGame,
  deckFor, defaultRules, legalPlays, nextHand, normalizeRules, passCycle, passDirFor, passTarget, penaltyTotal,
  playCard, randomLegal, removedCards, scoreHand, seededRng, sortHand, submitPass, suitOf, trickWinner, Rules,
} from '../src';

const rules = (seats: number, over: Partial<Rules> = {}) => normalizeRules({ ...defaultRules(seats), ...over }, seats);

/** A playing-phase state with hand-picked hands, for rule tests. */
function fixture(hands: string[][], over: Partial<Rules> = {}, extra: Partial<GameState> = {}): GameState {
  const r = rules(hands.length, over);
  const g = createGame(r, seededRng(1));
  g.hands = hands.map((h) => sortHand(h));
  g.phase = 'playing';
  g.tricks = [];
  g.trick = { leader: 0, plays: [] };
  g.turn = 0;
  g.heartsBroken = false;
  g.taken = hands.map(() => []);
  g.trickCount = hands.map(() => 0);
  return Object.assign(g, extra);
}
/** Pretend one trick has already been played so first-trick rules no longer apply. */
const afterTrickOne = { tricks: [{ leader: 0, plays: [], winner: 0 }] } as Partial<GameState>;

describe('decks', () => {
  it('deals evenly at every table size without touching point cards', () => {
    for (const seats of [3, 4, 5, 6]) {
      const deck = deckFor(seats);
      expect(deck.length % seats).toBe(0);
      expect(new Set(deck).size).toBe(deck.length);
      for (const c of ['2C', 'QS', 'JD', ...FULL_DECK.filter((x) => suitOf(x) === 'H')]) expect(deck).toContain(c);
      for (const c of removedCards(seats)) expect(['C', 'D']).toContain(suitOf(c));
    }
    expect([3, 4, 5, 6].map(cardsPerSeat)).toEqual([17, 13, 10, 8]);
  });

  it('labels and sorts cards', () => {
    expect(cardLabel('TH')).toBe('10♥');
    expect(cardLabel('QS')).toBe('Q♠');
    expect(sortHand(['AH', '2C', 'KS', '3D', '2S'])).toEqual(['2C', '3D', '2S', 'KS', 'AH']);
  });
});

describe('rules', () => {
  it('fills defaults by table size', () => {
    expect(defaultRules(4).passCount).toBe(3);
    expect(defaultRules(6).passCount).toBe(2);
    expect(defaultRules(6).target).toBe(75);
    expect(defaultRules(4).target).toBe(100);
  });

  it('clamps and repairs untrusted input', () => {
    const r = normalizeRules({ seats: 9, passCount: 12, target: -4, moon: 'banana' as never, playSeconds: 7, jackOfDiamonds: 'yes' as never });
    expect(r.seats).toBe(6);
    expect(r.passCount).toBe(4);
    expect(r.target).toBe(25);
    expect(r.moon).toBe('addToOthers');
    expect(r.playSeconds).toBe(60);
    expect(r.jackOfDiamonds).toBe(false);
  });

  it('never rotates across at an odd table', () => {
    expect(passCycle(rules(4))).toEqual(['left', 'right', 'across', 'hold']);
    expect(passCycle(rules(6))).toEqual(['left', 'right', 'across', 'hold']);
    expect(passCycle(rules(3))).toEqual(['left', 'right', 'hold']);
    expect(passCycle(rules(5))).toEqual(['left', 'right', 'hold']);
    expect(passCycle(rules(4, { rotation: 'noHold' }))).toEqual(['left', 'right', 'across']);
    expect(passCycle(rules(4, { rotation: 'leftOnly' }))).toEqual(['left']);
    expect(passCycle(rules(4, { passCount: 0 }))).toEqual(['hold']);
    expect(passDirFor(rules(4), 5)).toBe('left');
    expect(passDirFor(rules(4), 4)).toBe('hold');
  });

  it('passes to the right seats', () => {
    expect(passTarget(4, 0, 'left')).toBe(1);
    expect(passTarget(4, 0, 'right')).toBe(3);
    expect(passTarget(4, 1, 'across')).toBe(3);
    expect(passTarget(6, 2, 'across')).toBe(5);
    expect(passTarget(3, 0, 'right')).toBe(2);
  });
});

describe('dealing and passing', () => {
  it('deals every card exactly once, sorted', () => {
    for (const seats of [3, 4, 5, 6]) {
      const g = createGame(rules(seats), seededRng(seats));
      const all = g.hands.flat();
      expect(all.sort()).toEqual(deckFor(seats).slice().sort());
      for (const h of g.hands) {
        expect(h.length).toBe(cardsPerSeat(seats));
        expect(h).toEqual(sortHand(h));
      }
      expect(g.phase).toBe('passing');
      expect(g.passDir).toBe('left');
    }
  });

  it('exchanges passes once every seat has passed, then the 2♣ leads', () => {
    const g = createGame(rules(4), seededRng(7));
    const before = g.hands.map((h) => h.slice());
    const picks = g.hands.map((h) => h.slice(0, 3));
    submitPass(g, 0, picks[0]);
    submitPass(g, 1, picks[1]);
    submitPass(g, 2, picks[2]);
    expect(g.phase).toBe('passing');
    submitPass(g, 3, picks[3]);
    expect(g.phase).toBe('playing');
    for (let s = 0; s < 4; s++) {
      const from = (s + 3) % 4; // left pass: I receive from the seat on my right
      expect(g.received[s].sort()).toEqual(picks[from].slice().sort());
      for (const c of picks[from]) expect(g.hands[s]).toContain(c);
      for (const c of picks[s]) expect(g.hands[s]).not.toContain(c);
      expect(g.hands[s].length).toBe(13);
      expect(before[s].length).toBe(13);
    }
    expect(g.hands[g.turn]).toContain('2C');
    expect(legalPlays(g, g.turn)).toEqual(['2C']);
  });

  it('rejects bad passes', () => {
    const g = createGame(rules(4), seededRng(3));
    expect(() => submitPass(g, 0, g.hands[0].slice(0, 2))).toThrow(RuleError);
    expect(() => submitPass(g, 0, [g.hands[1][0], g.hands[0][0], g.hands[0][1]])).toThrow(RuleError);
    expect(() => submitPass(g, 0, [g.hands[0][0], g.hands[0][0], g.hands[0][1]])).toThrow(RuleError);
    submitPass(g, 0, g.hands[0].slice(0, 3));
    expect(() => submitPass(g, 0, g.hands[0].slice(0, 3))).toThrow(RuleError);
  });

  it('goes straight to play on a hold hand', () => {
    const g = createGame(rules(4, { passCount: 0 }), seededRng(3));
    expect(g.passDir).toBe('hold');
    expect(g.phase).toBe('playing');
  });

  it('fills a timed-out pass with highlighted cards first, then random ones', () => {
    const g = createGame(rules(4), seededRng(11));
    const hand = g.hands[0];
    const chosen = autoPassCards(g, 0, [hand[5], hand[5], 'ZZ', g.hands[1][0]], seededRng(2));
    expect(chosen.length).toBe(3);
    expect(chosen[0]).toBe(hand[5]);
    expect(new Set(chosen).size).toBe(3);
    for (const c of chosen) expect(hand).toContain(c);
    const none = autoPassCards(g, 0, [], seededRng(2));
    expect(none.length).toBe(3);
    const tooMany = autoPassCards(g, 0, hand.slice(0, 6), seededRng(2));
    expect(tooMany).toEqual(hand.slice(0, 3));
  });
});

describe('legal plays', () => {
  const four = [
    ['2C', '5C', 'QS', '4H', '9H', 'AD', 'KD', '3D', '7S', '8S', '2D', '6C', 'TC'],
    ['3C', '4C', '7C', '8C', '9C', 'JC', 'QC', 'KC', 'AC', '2S', '3S', '4S', '5S'],
    ['2H', '3H', '5H', '6H', '7H', '8H', 'TH', 'JH', 'QH', 'KH', 'AH', 'AS', 'KS'],
    ['4D', '5D', '6D', '7D', '8D', '9D', 'TD', 'JD', 'QD', '6S', '9S', 'TS', 'JS'],
  ];

  it('forces the 2♣ lead and only allows the current seat to act', () => {
    const g = fixture(four);
    expect(legalPlays(g, 0)).toEqual(['2C']);
    expect(legalPlays(g, 1)).toEqual([]);
    expect(() => playCard(g, 1, '3C')).toThrow(RuleError);
    expect(() => playCard(g, 0, '5C')).toThrow(RuleError);
  });

  it('must follow suit', () => {
    const g = fixture(four);
    playCard(g, 0, '2C');
    expect(legalPlays(g, 1).every((c) => suitOf(c) === 'C')).toBe(true);
  });

  it('blocks points on the first trick unless only points remain', () => {
    const g = fixture(four);
    playCard(g, 0, '2C');
    playCard(g, 1, '3C');
    // Seat 2 is void in clubs and holds only hearts plus A♠ K♠: spades are fine, hearts are not.
    expect(legalPlays(g, 2).sort()).toEqual(['AS', 'KS']);
    const all = fixture([['2C'], ['3C'], ['2H', 'QS'], ['4C']]);
    playCard(all, 0, '2C');
    playCard(all, 1, '3C');
    expect(legalPlays(all, 2)).toEqual(['2H']);
    const queenOnly = fixture([['2C'], ['3C'], ['QS'], ['4C']]);
    playCard(queenOnly, 0, '2C');
    playCard(queenOnly, 1, '3C');
    expect(legalPlays(queenOnly, 2)).toEqual(['QS']);
    const allowed = fixture(four, { firstTrickPoints: true });
    playCard(allowed, 0, '2C');
    playCard(allowed, 1, '3C');
    expect(legalPlays(allowed, 2)).toContain('AH');
  });

  it('keeps hearts from being led until broken', () => {
    const g = fixture([['2H', '5C'], ['3C', '4C'], ['6C', '7C'], ['8C', '9C']], {}, afterTrickOne);
    expect(legalPlays(g, 0)).toEqual(['5C']);
    const onlyHearts = fixture([['2H', '5H'], ['3C'], ['6C'], ['8C']], {}, afterTrickOne);
    expect(legalPlays(onlyHearts, 0)).toEqual(['2H', '5H']);
    const broken = fixture([['2H', '5C'], ['3C'], ['6C'], ['8C']], {}, { ...afterTrickOne, heartsBroken: true });
    expect(legalPlays(broken, 0)).toEqual(['5C', '2H']);
    const free = fixture([['2H', '5C'], ['3C'], ['6C'], ['8C']], { heartsMustBeBroken: false }, afterTrickOne);
    expect(legalPlays(free, 0)).toEqual(['5C', '2H']);
  });

  it('breaks hearts on a heart, and on the Q♠ only when that rule is on', () => {
    const g = fixture([['5D', '2C'], ['QS', '3C'], ['6D', '4C'], ['7D', '5C']], {}, afterTrickOne);
    playCard(g, 0, '5D');
    playCard(g, 1, 'QS');
    expect(g.heartsBroken).toBe(false);
    const q = fixture([['5D', '2C'], ['QS', '3C'], ['6D', '4C'], ['7D', '5C']], { queenBreaksHearts: true }, afterTrickOne);
    playCard(q, 0, '5D');
    playCard(q, 1, 'QS');
    expect(q.heartsBroken).toBe(true);
  });

  it('gives the trick to the highest card of the led suit', () => {
    expect(trickWinner({ leader: 0, plays: [{ seat: 0, card: '5D' }, { seat: 1, card: 'AS' }, { seat: 2, card: 'KD' }, { seat: 3, card: '2D' }] })).toBe(2);
  });
});

describe('scoring', () => {
  function scored(seats: number, taken: string[][], over: Partial<Rules> = {}, scores?: number[], trickCount?: number[]) {
    const g = fixture(Array.from({ length: seats }, () => []), over);
    g.taken = taken;
    g.tricks = Array.from({ length: 13 }, () => ({ leader: 0, plays: [], winner: 0 }));
    g.trickCount = trickCount ?? taken.map(() => 3);
    if (scores) g.scores = scores;
    return scoreHand(g);
  }
  const hearts = FULL_DECK.filter((c) => suitOf(c) === 'H');

  it('scores hearts and the queen', () => {
    const r = scored(4, [['QS', '2H'], ['3H', '4H'], [], hearts.slice(3)]);
    expect(r.scored).toEqual([14, 2, 0, 10]);
    expect(r.moon).toBeNull();
  });

  it('applies the J♦ only when the rule is on', () => {
    expect(scored(4, [['JD', '2H'], [], [], []]).scored[0]).toBe(1);
    expect(scored(4, [['JD', '2H'], [], [], []], { jackOfDiamonds: true }).scored[0]).toBe(-9);
    expect(cardPoints('JD', rules(4, { jackOfDiamonds: true }))).toBe(-10);
  });

  it('shoots the moon every supported way', () => {
    const all = [...hearts, 'QS'];
    expect(scored(4, [all, [], [], []]).scored).toEqual([0, 26, 26, 26]);
    expect(scored(4, [all, [], [], []], { moon: 'subtractFromShooter' }).scored).toEqual([-26, 0, 0, 0]);
    expect(scored(4, [all, [], [], []], { moon: 'off' }).scored).toEqual([26, 0, 0, 0]);
    expect(scored(6, [[], all, [], [], [], []]).scored).toEqual([26, 0, 26, 26, 26, 26]);
  });

  it('keeps the J♦ separate from the moon', () => {
    const all = [...hearts, 'QS'];
    expect(scored(4, [[...all, 'JD'], [], [], []], { jackOfDiamonds: true }).scored).toEqual([-10, 26, 26, 26]);
    expect(scored(4, [all, ['JD'], [], []], { jackOfDiamonds: true }).scored).toEqual([0, 16, 26, 26]);
  });

  it('needs A♠ and K♠ for the moon under Black Maria', () => {
    const all = [...hearts, 'QS'];
    const r = rules(4, { blackMaria: true });
    expect(penaltyTotal(r)).toBe(43);
    expect(scored(4, [all, ['AS', 'KS'], [], []], { blackMaria: true }).moon).toBeNull();
    expect(scored(4, [[...all, 'AS', 'KS'], [], [], []], { blackMaria: true }).scored).toEqual([0, 43, 43, 43]);
  });

  it('doubles the moon when the shooter takes every trick', () => {
    const all = [...hearts, 'QS'];
    expect(scored(4, [all, [], [], []], { shootTheSun: true }, undefined, [13, 0, 0, 0]).scored).toEqual([0, 52, 52, 52]);
    expect(scored(4, [all, [], [], []], { shootTheSun: true }, undefined, [12, 1, 0, 0]).sun).toBe(false);
  });

  it('lets the shooter avoid handing someone else the win', () => {
    const all = [...hearts, 'QS'];
    // Adding 26 would end the game with seat 1 winning, so the shooter subtracts instead.
    const r = scored(4, [all, [], [], []], { moon: 'shooterBest' }, [60, 10, 80, 80]);
    expect(r.scored).toEqual([-26, 0, 0, 0]);
    // When adding does not end the game, it adds as usual.
    expect(scored(4, [all, [], [], []], { moon: 'shooterBest' }, [0, 0, 0, 0]).scored).toEqual([0, 26, 26, 26]);
  });
});

/** Play a whole game with bots; returns the finished state. */
function simulate(r: Rules, seed: number, useRandom = false): GameState {
  const rng = seededRng(seed);
  const g = createGame(r, rng);
  let guard = 0;
  while (g.phase !== 'gameOver') {
    if (++guard > 10000) throw new Error('game did not finish');
    if (g.phase === 'passing') {
      for (let s = 0; s < r.seats; s++) if (!g.passes[s]) submitPass(g, s, useRandom ? autoPassCards(g, s, [], rng) : botPass(g, s));
      continue;
    }
    if (g.phase === 'handOver') {
      nextHand(g, rng);
      continue;
    }
    const seat = g.turn;
    const card = useRandom ? randomLegal(g, seat, rng) : botPlay(g, seat, rng);
    expect(legalPlays(g, seat)).toContain(card);
    const deckSize = deckFor(r.seats).length;
    const out = playCard(g, seat, card);
    if (out.result) {
      const played = g.tricks.flatMap((t) => t.plays.map((p) => p.card));
      expect(played.length).toBe(deckSize);
      expect(new Set(played).size).toBe(deckSize);
      const raw = out.result.raw.reduce((a, b) => a + b, 0);
      expect(raw).toBe(penaltyTotal(r) + (r.jackOfDiamonds ? -10 : 0));
      expect(g.tricks[0].plays[0].card).toBe('2C');
    }
  }
  return g;
}

describe('full games', () => {
  it('finishes thousands of games at every size and rule mix with consistent scores', () => {
    let games = 0;
    const variants: Partial<Rules>[] = [
      {}, { jackOfDiamonds: true }, { blackMaria: true, moon: 'subtractFromShooter' }, { moon: 'shooterBest', shootTheSun: true },
      { firstTrickPoints: true, heartsMustBeBroken: false, queenBreaksHearts: true }, { passCount: 0 }, { rotation: 'leftOnly', exactReset: true },
    ];
    for (const seats of [3, 4, 5, 6]) {
      for (const [i, v] of variants.entries()) {
        for (let seed = 0; seed < 12; seed++) {
          const r = rules(seats, v);
          const g = simulate(r, seats * 1000 + i * 100 + seed, seed % 3 === 0);
          const total = g.history.reduce((acc, h) => acc.map((x, s) => x + h.scored[s]), Array(seats).fill(0));
          if (!r.exactReset) expect(g.scores).toEqual(total);
          expect(g.scores.some((s) => s >= r.target)).toBe(true);
          expect(g.winners.length).toBeGreaterThan(0);
          for (const w of g.winners) expect(g.scores[w]).toBe(Math.min(...g.scores));
          games++;
        }
      }
    }
    expect(games).toBe(4 * 7 * 12);
  });

  it('bots beat random play', () => {
    // Seat 0 is the bot, the rest play randomly: over many games the bot should average fewer points per hand.
    let bot = 0;
    let rand = 0;
    let hands = 0;
    for (let seed = 0; seed < 60; seed++) {
      const rng = seededRng(seed + 99);
      const g = createGame(rules(4), rng);
      while (g.phase !== 'gameOver') {
        if (g.phase === 'passing') {
          for (let s = 0; s < 4; s++) submitPass(g, s, s === 0 ? botPass(g, s) : autoPassCards(g, s, [], rng));
        } else if (g.phase === 'handOver') nextHand(g, rng);
        else {
          const s = g.turn;
          const out = playCard(g, s, s === 0 ? botPlay(g, s, rng) : randomLegal(g, s, rng));
          if (out.result) {
            bot += out.result.raw[0];
            rand += (out.result.raw[1] + out.result.raw[2] + out.result.raw[3]) / 3;
            hands++;
          }
        }
      }
    }
    expect(bot / hands).toBeLessThan(rand / hands);
  });
});
