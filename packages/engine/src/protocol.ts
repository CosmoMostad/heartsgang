import type { Card } from './cards';
import type { HandResult, Phase, Trick } from './game';
import type { PassDir, Rules } from './rules';

/** Messages and views shared by the browser and the game server. */

export const EMOTES = ['👍', '😂', '😬', '😱', '😡', '🔥', '🙏', '💀', '🌙', '👑', '🫡', '🥲'] as const;
export type Emote = (typeof EMOTES)[number];

export const SEAT_COLORS = [
  { name: 'Crimson', hex: '#e0525a' },
  { name: 'Sapphire', hex: '#4c8ce6' },
  { name: 'Emerald', hex: '#35b27a' },
  { name: 'Gold', hex: '#e9b23c' },
  { name: 'Violet', hex: '#a371ec' },
  { name: 'Teal', hex: '#2cc3bd' },
];

/** Colours for players' highlight rings and chat names. */
export const PLAYER_COLORS = ['#e03131', '#1c7ed6', '#2f9e44', '#e8590c', '#9c36b5', '#0c8599', '#d6336c', '#5f3dc4', '#66a80f', '#1098ad', '#c2255c', '#f08c00'];

export interface ModePreset { key: string; label: string; seats: number; maxPerSeat: number; blurb: string }
export const MODES: ModePreset[] = [
  { key: 'classic', label: 'Classic Four', seats: 4, maxPerSeat: 1, blurb: 'Four players, everyone for themselves.' },
  { key: 'street', label: 'Street Rules', seats: 4, maxPerSeat: 2, blurb: '2v2v1v1: two pairs share a hand, two solos.' },
  { key: 'gang', label: 'Gang of Three', seats: 3, maxPerSeat: 2, blurb: '2v2v2: three pairs, three hands, 17 cards each.' },
  { key: 'six', label: 'Six Solo', seats: 6, maxPerSeat: 1, blurb: 'Six players, 8 cards each, to 75.' },
  { key: 'custom', label: 'Custom', seats: 4, maxPerSeat: 2, blurb: 'Pick the seats and how many can share one.' },
];

export interface TableConfig { mode: string; seats: number; maxPerSeat: number }

export interface PlayerView { id: string; name: string; color: string; connected: boolean; seat: number | null; host: boolean }
export interface SeatView { index: number; colorName: string; color: string; players: PlayerView[]; bot: string | null; label: string }
export interface ChatMsg { id: number; at: number; from: string | null; name: string; color: string; text: string }

export interface GameView {
  hand: number;
  phase: Phase;
  passDir: PassDir;
  passCount: number;
  /** Seat your seat passes to this hand (null when holding or spectating). */
  passTo: number | null;
  myHand: Card[];
  handCounts: number[];
  passed: boolean[];
  received: Card[];
  trick: Trick;
  lastTrick: Trick | null;
  trickNumber: number;
  tricksPerHand: number;
  turn: number;
  heartsBroken: boolean;
  taken: Card[][];
  handPoints: number[];
  scores: number[];
  history: HandResult[];
  winners: number[];
  /** Cards your seat may play right now. */
  legal: Card[];
}

export interface RoomView {
  code: string;
  you: { id: string; seat: number | null; host: boolean; name: string; color: string };
  phase: 'lobby' | 'game';
  table: TableConfig;
  rules: Rules;
  seats: SeatView[];
  spectators: PlayerView[];
  chat: ChatMsg[];
  teamChat: ChatMsg[];
  game: GameView | null;
  /** Your seat's highlights: pass picks (card → player) and play suggestions (player → card). */
  picks: { pass: Record<string, string>; play: Record<string, string> };
  deadline: number | null;
  deadlineKind: 'pass' | 'play' | null;
  /** A just-finished trick held on the table for a moment. */
  pause: { until: number; trick: Trick } | null;
  nextHandAt: number | null;
  serverNow: number;
}

export type ClientMsg =
  | { t: 'create'; name: string; token: string; table: TableConfig; rules: Partial<Rules> }
  | { t: 'join'; code: string; name: string; token: string }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'bot'; seat: number; on: boolean }
  | { t: 'fillBots' }
  | { t: 'config'; table?: TableConfig; rules?: Partial<Rules> }
  | { t: 'start' }
  | { t: 'highlight'; card: Card; on: boolean }
  | { t: 'pass' }
  | { t: 'play'; card: Card }
  | { t: 'chat'; text: string; scope: 'table' | 'team' }
  | { t: 'emote'; emote: string }
  | { t: 'dealNow' }
  | { t: 'playAgain' }
  | { t: 'toLobby' }
  | { t: 'kick'; playerId: string }
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'state'; room: RoomView }
  | { t: 'error'; message: string }
  | { t: 'emote'; playerId: string; name: string; seat: number | null; emote: string }
  | { t: 'left' }
  | { t: 'pong' };
