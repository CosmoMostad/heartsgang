import { deckFor } from './cards';

export type PassDir = 'left' | 'right' | 'across' | 'hold';
export type MoonRule = 'addToOthers' | 'subtractFromShooter' | 'shooterBest' | 'off';
export type Rotation = 'standard' | 'noHold' | 'leftOnly';

export interface Rules {
  /** Number of seats (hands) at the table, 3 to 6. A seat can be one player or a team. */
  seats: number;
  /** Cards each seat passes; 0 turns passing off. */
  passCount: number;
  rotation: Rotation;
  /** May a heart or the Q♠ be discarded on the first trick? */
  firstTrickPoints: boolean;
  heartsMustBeBroken: boolean;
  queenBreaksHearts: boolean;
  /** Taking the J♦ is worth −10. */
  jackOfDiamonds: boolean;
  /** A♠ counts 7 and K♠ counts 10. */
  blackMaria: boolean;
  moon: MoonRule;
  /** Winning every trick doubles the moon. */
  shootTheSun: boolean;
  target: number;
  /** Landing exactly on the target resets you to 0. */
  exactReset: boolean;
  /** Seconds to choose a pass; 0 = no limit. */
  passSeconds: number;
  /** Seconds to play a card; 0 = no limit. */
  playSeconds: number;
  /** Play a seat's only legal card for it. */
  autoPlayForced: boolean;
}

export const TIMER_CHOICES = [0, 15, 30, 45, 60, 90, 120];
export const TARGET_CHOICES = [50, 75, 100, 150];

export function cardsPerSeat(seats: number): number {
  return deckFor(seats).length / seats;
}

export function defaultRules(seats = 4): Rules {
  return {
    seats,
    passCount: seats <= 4 ? 3 : 2,
    rotation: 'standard',
    firstTrickPoints: false,
    heartsMustBeBroken: true,
    queenBreaksHearts: false,
    jackOfDiamonds: false,
    blackMaria: false,
    moon: 'addToOthers',
    shootTheSun: false,
    target: seats === 6 ? 75 : 100,
    exactReset: false,
    passSeconds: 60,
    playSeconds: 60,
    autoPlayForced: true,
  };
}

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const pick = <T>(v: unknown, options: readonly T[], d: T): T => (options.includes(v as T) ? (v as T) : d);
const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d;
  return Math.min(hi, Math.max(lo, n));
};

/** Validate untrusted input into a complete, legal rule set. */
export function normalizeRules(input: Partial<Rules> | undefined | null, seatsOverride?: number): Rules {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<Rules>;
  const seats = int(seatsOverride ?? src.seats, 3, 6, 4);
  const d = defaultRules(seats);
  const maxPass = Math.min(4, cardsPerSeat(seats) - 1);
  return {
    seats,
    passCount: int(src.passCount, 0, maxPass, Math.min(d.passCount, maxPass)),
    rotation: pick(src.rotation, ['standard', 'noHold', 'leftOnly'] as const, d.rotation),
    firstTrickPoints: bool(src.firstTrickPoints, d.firstTrickPoints),
    heartsMustBeBroken: bool(src.heartsMustBeBroken, d.heartsMustBeBroken),
    queenBreaksHearts: bool(src.queenBreaksHearts, d.queenBreaksHearts),
    jackOfDiamonds: bool(src.jackOfDiamonds, d.jackOfDiamonds),
    blackMaria: bool(src.blackMaria, d.blackMaria),
    moon: pick(src.moon, ['addToOthers', 'subtractFromShooter', 'shooterBest', 'off'] as const, d.moon),
    shootTheSun: bool(src.shootTheSun, d.shootTheSun),
    target: int(src.target, 25, 500, d.target),
    exactReset: bool(src.exactReset, d.exactReset),
    passSeconds: pick(src.passSeconds, TIMER_CHOICES, d.passSeconds),
    playSeconds: pick(src.playSeconds, TIMER_CHOICES, d.playSeconds),
    autoPlayForced: bool(src.autoPlayForced, d.autoPlayForced),
  };
}

/** The pass directions in order, for this table size. Odd tables have nobody across. */
export function passCycle(rules: Rules): PassDir[] {
  if (rules.passCount === 0) return ['hold'];
  const even = rules.seats % 2 === 0;
  switch (rules.rotation) {
    case 'leftOnly': return ['left'];
    case 'noHold': return even ? ['left', 'right', 'across'] : ['left', 'right'];
    default: return even ? ['left', 'right', 'across', 'hold'] : ['left', 'right', 'hold'];
  }
}

export function passDirFor(rules: Rules, handNumber: number): PassDir {
  const cycle = passCycle(rules);
  return cycle[(handNumber - 1) % cycle.length];
}

/** Seat that receives `from`'s pass. Seats are numbered clockwise; left is the next seat to play. */
export function passTarget(seats: number, from: number, dir: PassDir): number {
  switch (dir) {
    case 'left': return (from + 1) % seats;
    case 'right': return (from - 1 + seats) % seats;
    case 'across': return (from + seats / 2) % seats;
    case 'hold': return from;
  }
}

/** A short list of the rules that differ from standard Hearts, for chips in the UI. */
export function ruleChips(r: Rules): string[] {
  const chips: string[] = [`${r.seats} seats`, `to ${r.target}`];
  chips.push(r.passCount === 0 ? 'no passing' : `pass ${r.passCount}`);
  if (r.jackOfDiamonds) chips.push('J♦ −10');
  if (r.blackMaria) chips.push('Black Maria');
  if (r.moon === 'subtractFromShooter') chips.push('moon −26');
  if (r.moon === 'shooterBest') chips.push('moon: shooter’s best');
  if (r.moon === 'off') chips.push('no moon');
  if (r.shootTheSun) chips.push('shoot the sun');
  if (r.firstTrickPoints) chips.push('points on trick 1');
  if (!r.heartsMustBeBroken) chips.push('lead hearts any time');
  if (r.queenBreaksHearts) chips.push('Q♠ breaks hearts');
  if (r.exactReset) chips.push(`exactly ${r.target} resets`);
  if (r.rotation === 'noHold') chips.push('no hold hand');
  if (r.rotation === 'leftOnly') chips.push('always pass left');
  chips.push(r.playSeconds ? `${r.playSeconds}s turns` : 'no turn timer');
  return chips;
}
