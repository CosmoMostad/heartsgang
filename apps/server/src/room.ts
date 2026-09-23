import {
  Card, ChatMsg, EMOTES, GameState, GameView, PLAYER_COLORS, PlayerView, Rng, RoomView, Rules, SEAT_COLORS,
  SeatView, ServerMsg, TableConfig, MODES, Trick, autoPassCards, botPass, botPlay, cardLabel, createGame, handPoints,
  isCard, legalPlays, nextHand, normalizeRules, passRecipient, playCard, randomLegal, submitPass, cardsPerSeat,
} from '@heartsgang/engine';

export interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  seat: number | null;
  connected: boolean;
  lastSeen: number;
  lastChat: number;
  lastEmote: number;
}

export interface Timing {
  /** Milliseconds per rules "second"; tests shrink it. */
  second: number;
  botDelay: number;
  trickPause: number;
  handSummary: number;
  forcedDelay: number;
  /** How long a fully disconnected seat may hold up play when timers are off. */
  absentGrace: number;
}

export const DEFAULT_TIMING: Timing = {
  second: 1000,
  botDelay: 900,
  trickPause: 1500,
  handSummary: 9000,
  forcedDelay: 700,
  absentGrace: 30000,
};

export interface RoomDeps {
  rng: Rng;
  now: () => number;
  send: (playerId: string, msg: ServerMsg) => void;
  timing: Timing;
  onChange?: () => void;
}

interface SeatPicks { pass: Record<string, string>; play: Record<string, string> }

const BOT_NAMES = ['Bot Rosie', 'Bot Otto', 'Bot Pixel', 'Bot Jax', 'Bot Nova', 'Bot Duke'];
const MAX_PLAYERS = 24;
const CHAT_KEEP = 80;

export class GameError extends Error {}

/** Everything that survives a server restart. */
export interface RoomSnapshot {
  code: string;
  hostId: string;
  createdAt: number;
  lastActive: number;
  table: TableConfig;
  rules: Rules;
  players: Player[];
  bots: (string | null)[];
  phase: 'lobby' | 'game';
  game: GameState | null;
  picks: SeatPicks[];
  chat: ChatMsg[];
  teamChat: ChatMsg[][];
  chatSeq: number;
  passDeadline: number | null;
  dealtAt: number;
  turnStartedAt: number;
  turnDeadline: number | null;
  pause: { until: number; trick: Trick } | null;
  nextHandAt: number | null;
}

export function sanitizeName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return s;
}

export function normalizeTable(input: Partial<TableConfig> | undefined): TableConfig {
  const preset = MODES.find((m) => m.key === input?.mode) ?? MODES[0];
  const seats = Math.min(6, Math.max(3, Math.round(Number(input?.seats ?? preset.seats)) || preset.seats));
  const maxPerSeat = Math.min(3, Math.max(1, Math.round(Number(input?.maxPerSeat ?? preset.maxPerSeat)) || preset.maxPerSeat));
  return { mode: preset.key, seats, maxPerSeat };
}

export class Room implements RoomSnapshot {
  code: string;
  hostId: string;
  createdAt: number;
  lastActive: number;
  table: TableConfig;
  rules: Rules;
  players: Player[] = [];
  bots: (string | null)[];
  phase: 'lobby' | 'game' = 'lobby';
  game: GameState | null = null;
  picks: SeatPicks[];
  chat: ChatMsg[] = [];
  teamChat: ChatMsg[][];
  chatSeq = 0;
  passDeadline: number | null = null;
  dealtAt = 0;
  turnStartedAt = 0;
  turnDeadline: number | null = null;
  pause: { until: number; trick: Trick } | null = null;
  nextHandAt: number | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private deps: RoomDeps;

  constructor(code: string, host: { id: string; token: string; name: string }, table: TableConfig, rules: Partial<Rules>, deps: RoomDeps) {
    this.deps = deps;
    this.code = code;
    this.hostId = host.id;
    this.createdAt = this.lastActive = deps.now();
    this.table = normalizeTable(table);
    this.rules = normalizeRules(rules, this.table.seats);
    this.bots = Array(this.table.seats).fill(null);
    this.picks = this.emptyPicks();
    this.teamChat = Array.from({ length: this.table.seats }, () => []);
    this.addPlayer(host.id, host.token, host.name);
    this.players[0].seat = 0;
    this.system(`Table ${code} is open. Share the code so friends can join.`);
  }

  static restore(snap: RoomSnapshot, deps: RoomDeps): Room {
    const room = Object.create(Room.prototype) as Room;
    Object.assign(room, snap);
    room.deps = deps;
    room.timer = null;
    for (const p of room.players) p.connected = false;
    // Give everyone a moment to reconnect before any clock that expired while we were down fires.
    const grace = deps.now() + 15000;
    if (room.passDeadline) room.passDeadline = Math.max(room.passDeadline, grace);
    if (room.turnDeadline) room.turnDeadline = Math.max(room.turnDeadline, grace);
    if (room.nextHandAt) room.nextHandAt = Math.max(room.nextHandAt, grace);
    room.schedule();
    return room;
  }

  snapshot(): RoomSnapshot {
    const { deps, timer, ...rest } = this as unknown as Record<string, unknown>;
    void deps; void timer;
    return JSON.parse(JSON.stringify(rest)) as RoomSnapshot;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------------ players

  private emptyPicks(): SeatPicks[] {
    return Array.from({ length: this.table.seats }, () => ({ pass: {}, play: {} }));
  }

  private uniqueName(name: string, exceptId?: string): string {
    const base = name || 'Player';
    const taken = new Set(this.players.filter((p) => p.id !== exceptId).map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base.slice(0, 17)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private addPlayer(id: string, token: string, name: string): Player {
    const used = new Set(this.players.map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.players.length % PLAYER_COLORS.length];
    const p: Player = { id, token, name: this.uniqueName(sanitizeName(name)), color, seat: null, connected: true, lastSeen: this.deps.now(), lastChat: 0, lastEmote: 0 };
    this.players.push(p);
    return p;
  }

  playerByToken(token: string): Player | undefined {
    return this.players.find((p) => p.token === token);
  }

  player(id: string): Player {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new GameError('You are not at this table.');
    return p;
  }

  /** Join or rejoin. Returns the player. */
  join(id: string, token: string, name: string): Player {
    const existing = this.playerByToken(token);
    if (existing) {
      existing.connected = true;
      existing.lastSeen = this.deps.now();
      const clean = sanitizeName(name);
      if (clean && clean !== existing.name) existing.name = this.uniqueName(clean, existing.id);
      this.touch();
      return existing;
    }
    if (this.players.length >= MAX_PLAYERS) throw new GameError('This table is full.');
    const p = this.addPlayer(id, token, name);
    // In the lobby, drop newcomers into the first empty seat so a quick game needs no clicking.
    if (this.phase === 'lobby') {
      const open = this.seatMembers().findIndex((m, i) => m.length === 0 && !this.bots[i]);
      if (open >= 0) p.seat = open;
    }
    this.system(`${p.name} joined.`);
    this.touch();
    return p;
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    p.connected = connected;
    p.lastSeen = this.deps.now();
    this.touch();
  }

  connectedCount(): number {
    return this.players.filter((p) => p.connected).length;
  }

  seatMembers(): Player[][] {
    return Array.from({ length: this.table.seats }, (_, i) => this.players.filter((p) => p.seat === i));
  }

  private isBotSeat(seat: number): boolean {
    return !!this.bots[seat];
  }

  private requireHost(id: string): void {
    if (id !== this.hostId) throw new GameError('Only the host can do that.');
  }

  private requireSeat(id: string): { p: Player; seat: number } {
    const p = this.player(id);
    if (p.seat === null) throw new GameError('Take a seat first.');
    return { p, seat: p.seat };
  }

  sit(id: string, seat: number): void {
    const p = this.player(id);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.table.seats) throw new GameError('No such seat.');
    if (p.seat === seat) return;
    const members = this.seatMembers()[seat];
    if (this.phase === 'game' && p.seat !== null) throw new GameError('You can’t change seats in the middle of a game.');
    if (members.length >= this.table.maxPerSeat) throw new GameError('That seat is full.');
    if (this.bots[seat]) {
      this.system(`${p.name} took over from ${this.bots[seat]}.`);
      this.bots[seat] = null;
    } else if (this.phase === 'game') {
      this.system(`${p.name} joined ${this.seatLabel(seat)}.`);
    }
    p.seat = seat;
    this.touch();
  }

  stand(id: string): void {
    const p = this.player(id);
    if (this.phase === 'game') throw new GameError('You can’t leave your seat mid-game. Use Leave instead.');
    p.seat = null;
    this.touch();
  }

  setBot(id: string, seat: number, on: boolean): void {
    this.requireHost(id);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.table.seats) throw new GameError('No such seat.');
    if (this.phase === 'game') throw new GameError('Bots can only be changed in the lobby.');
    if (on) {
      if (this.seatMembers()[seat].length) throw new GameError('Someone is sitting there.');
      const used = new Set(this.bots.filter(Boolean));
      this.bots[seat] = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${seat + 1}`;
    } else {
      this.bots[seat] = null;
    }
    this.touch();
  }

  fillBots(id: string): void {
    this.requireHost(id);
    if (this.phase !== 'lobby') throw new GameError('Bots can only be changed in the lobby.');
    this.seatMembers().forEach((m, i) => { if (!m.length && !this.bots[i]) this.setBot(id, i, true); });
  }

  kick(id: string, target: string): void {
    this.requireHost(id);
    if (target === id) throw new GameError('You can’t remove yourself; use Leave.');
    const p = this.player(target);
    this.removePlayer(p.id, `${p.name} was removed by the host.`);
    this.deps.send(p.id, { t: 'left' });
  }

  leave(id: string): void {
    const p = this.players.find((x) => x.id === id);
    if (!p) return;
    this.removePlayer(p.id, `${p.name} left.`);
  }

  private removePlayer(id: string, message: string): void {
    const p = this.player(id);
    const seat = p.seat;
    this.players = this.players.filter((x) => x.id !== id);
    this.system(message);
    if (this.phase === 'game' && seat !== null && !this.seatMembers()[seat].length) {
      const used = new Set(this.bots.filter(Boolean));
      this.bots[seat] = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${seat + 1}`;
      this.system(`${this.bots[seat]} is keeping seat ${seat + 1} warm.`);
    }
    if (this.picks[seat ?? -1]) {
      const picks = this.picks[seat!];
      for (const [card, pid] of Object.entries(picks.pass)) if (pid === id) delete picks.pass[card];
      delete picks.play[id];
    }
    if (this.hostId === id) {
      const next = this.players.find((x) => x.connected) ?? this.players[0];
      if (next) {
        this.hostId = next.id;
        this.system(`${next.name} is now the host.`);
      }
    }
    this.touch();
  }

  configure(id: string, table?: Partial<TableConfig>, rules?: Partial<Rules>): void {
    this.requireHost(id);
    if (this.phase !== 'lobby') throw new GameError('Rules can only change in the lobby.');
    if (table) {
      const next = normalizeTable({ ...this.table, ...table });
      this.table = next;
      this.bots = Array.from({ length: next.seats }, (_, i) => this.bots[i] ?? null);
      const counts = Array(next.seats).fill(0);
      for (const p of this.players) {
        if (p.seat === null) continue;
        if (p.seat >= next.seats || counts[p.seat] >= next.maxPerSeat) p.seat = null;
        else counts[p.seat]++;
      }
      this.picks = this.emptyPicks();
      this.teamChat = Array.from({ length: next.seats }, (_, i) => this.teamChat[i] ?? []);
    }
    const seatsChanged = this.rules.seats !== this.table.seats;
    this.rules = normalizeRules(rules ? { ...this.rules, ...rules } : seatsChanged ? { ...this.rules, passCount: undefined, target: undefined } : this.rules, this.table.seats);
    this.touch();
  }

  // ------------------------------------------------------------------ game flow

  start(id: string): void {
    this.requireHost(id);
    if (this.phase !== 'lobby') throw new GameError('The game has already started.');
    const empty = this.seatMembers().map((m, i) => (m.length || this.bots[i] ? -1 : i)).filter((i) => i >= 0);
    if (empty.length) throw new GameError(`Fill every seat first: ${empty.length > 1 ? `seats ${empty.map((i) => i + 1).join(', ')} are` : `seat ${empty[0] + 1} is`} empty.`);
    this.phase = 'game';
    this.game = createGame(this.rules, this.deps.rng);
    this.onDealt();
    this.touch();
  }

  playAgain(id: string): void {
    this.requireHost(id);
    if (!this.game || this.game.phase !== 'gameOver') throw new GameError('The game is still going.');
    this.game = createGame(this.rules, this.deps.rng);
    this.system('New game! Same seats, fresh scores.');
    this.onDealt();
    this.touch();
  }

  toLobby(id: string): void {
    this.requireHost(id);
    if (this.phase !== 'game') return;
    this.phase = 'lobby';
    this.game = null;
    this.clearClocks();
    this.picks = this.emptyPicks();
    this.system('Back in the lobby. Change seats or rules, then start again.');
    this.touch();
  }

  dealNow(id: string): void {
    this.requireHost(id);
    if (!this.game || this.game.phase !== 'handOver') throw new GameError('The hand is not over yet.');
    this.dealNext();
  }

  private clearClocks(): void {
    this.passDeadline = null;
    this.turnDeadline = null;
    this.pause = null;
    this.nextHandAt = null;
  }

  private onDealt(): void {
    const g = this.game!;
    const now = this.deps.now();
    this.clearClocks();
    this.picks = this.emptyPicks();
    this.dealtAt = now;
    const dirText = g.passDir === 'hold' ? 'No passing this hand.' : `Pass ${g.rules.passCount} ${g.passDir}.`;
    this.system(`Hand ${g.hand} dealt. ${dirText}`);
    if (g.phase === 'passing') {
      this.passDeadline = this.rules.passSeconds ? now + this.rules.passSeconds * this.deps.timing.second : null;
    } else {
      this.startTurn();
    }
  }

  private startTurn(): void {
    const now = this.deps.now();
    this.turnStartedAt = now;
    this.turnDeadline = this.rules.playSeconds ? now + this.rules.playSeconds * this.deps.timing.second : null;
    // Suggestions that are no longer legal would only mislead.
    const g = this.game!;
    const picks = this.picks[g.turn];
    const legal = legalPlays(g, g.turn);
    for (const [pid, card] of Object.entries(picks.play)) if (!legal.includes(card)) delete picks.play[pid];
  }

  private dealNext(): void {
    nextHand(this.game!, this.deps.rng);
    this.onDealt();
    this.touch();
  }

  highlight(id: string, card: Card, on: boolean): void {
    const { p, seat } = this.requireSeat(id);
    const g = this.game;
    if (!g || !isCard(card)) throw new GameError('Nothing to highlight.');
    if (!g.hands[seat].includes(card)) throw new GameError('That card isn’t in your hand.');
    const picks = this.picks[seat];
    if (g.phase === 'passing') {
      if (g.passes[seat]) throw new GameError('Your seat already passed.');
      if (on) {
        if (!picks.pass[card] && Object.keys(picks.pass).length >= g.rules.passCount) throw new GameError(`You’re passing ${g.rules.passCount}. Clear one first.`);
        picks.pass[card] = p.id;
      } else delete picks.pass[card];
    } else if (g.phase === 'playing') {
      if (on) {
        if (g.turn === seat && !this.pause && !legalPlays(g, seat).includes(card)) throw new GameError('That card can’t be played right now.');
        picks.play[p.id] = card;
      } else if (picks.play[p.id] === card) delete picks.play[p.id];
    } else {
      throw new GameError('Wait for the next deal.');
    }
    this.touch();
  }

  pass(id: string): void {
    const { p, seat } = this.requireSeat(id);
    const g = this.game;
    if (!g || g.phase !== 'passing') throw new GameError('It isn’t time to pass.');
    const cards = Object.keys(this.picks[seat].pass);
    if (cards.length !== g.rules.passCount) throw new GameError(`Highlight exactly ${g.rules.passCount} cards to pass.`);
    this.doPass(seat, cards, `${p.name} passed for ${this.seatLabel(seat)}.`);
  }

  private doPass(seat: number, cards: Card[], note?: string): void {
    const g = this.game!;
    try {
      submitPass(g, seat, cards);
    } catch (e) {
      throw new GameError((e as Error).message);
    }
    this.picks[seat].pass = {};
    if (note && this.seatMembers()[seat].length > 1) this.system(note);
    if (g.phase === 'playing') {
      this.passDeadline = null;
      this.system('Cards exchanged. The 2♣ leads.');
      this.startTurn();
    }
    this.touch();
  }

  play(id: string, card: Card): void {
    const { seat } = this.requireSeat(id);
    const g = this.game;
    if (!g || g.phase !== 'playing') throw new GameError('It isn’t time to play.');
    if (this.pause) throw new GameError('Hold on, the trick is being collected.');
    if (g.turn !== seat) throw new GameError('It isn’t your turn.');
    if (!isCard(card) || !legalPlays(g, seat).includes(card)) throw new GameError('That card can’t be played right now.');
    this.doPlay(seat, card);
  }

  private doPlay(seat: number, card: Card): void {
    const g = this.game!;
    let outcome;
    try {
      outcome = playCard(g, seat, card);
    } catch (e) {
      throw new GameError((e as Error).message);
    }
    this.picks[seat].play = {};
    const now = this.deps.now();
    if (outcome.trick) {
      this.turnDeadline = null;
      this.pause = { until: now + this.deps.timing.trickPause, trick: outcome.trick };
    } else {
      this.startTurn();
    }
    if (outcome.result) {
      const r = outcome.result;
      if (r.moon !== null) {
        this.system(`🌙 ${this.seatLabel(r.moon)} shot the ${r.sun ? 'SUN' : 'moon'}!`);
      }
      const line = r.scored.map((s, i) => `${this.seatLabel(i)} ${s > 0 ? '+' : ''}${s}`).join(' · ');
      this.system(`Hand ${r.hand}: ${line}`);
      for (const s of r.resets) this.system(`${this.seatLabel(s)} hit exactly ${g.rules.target} and resets to 0!`);
      if (g.phase === 'gameOver') {
        this.system(`🏆 ${g.winners.map((w) => this.seatLabel(w)).join(' and ')} ${g.winners.length > 1 ? 'win' : 'wins'} the game!`);
      } else {
        this.nextHandAt = now + this.deps.timing.trickPause + this.deps.timing.handSummary;
      }
    }
    this.touch();
  }

  // ------------------------------------------------------------------ clocks and bots

  /** Run anything that is due, then arm the timer for the next thing. */
  tick(): void {
    const now = this.deps.now();
    let guard = 0;
    let acted = true;
    while (acted && guard++ < 200) {
      acted = false;
      const g = this.game;
      if (!g || this.phase !== 'game') break;
      // A finished trick sits on the table briefly, whatever phase follows it.
      if (this.pause) {
        if (now < this.pause.until) break;
        this.pause = null;
        if (g.phase === 'playing') this.startTurn();
        this.touch();
        acted = true;
        continue;
      }
      if (g.phase === 'passing') {
        for (let s = 0; s < g.rules.seats && g.phase === 'passing'; s++) {
          if (g.passes[s]) continue;
          if (this.isBotSeat(s) && now >= this.dealtAt + this.botDelay(s)) {
            this.doPass(s, botPass(g, s));
            acted = true;
          }
        }
        if (g.phase === 'passing' && this.passDeadline !== null && now >= this.passDeadline) {
          for (let s = 0; s < g.rules.seats && g.phase === 'passing'; s++) {
            if (g.passes[s]) continue;
            const preferred = Object.keys(this.picks[s].pass);
            this.doPass(s, autoPassCards(g, s, preferred, this.deps.rng));
            if (this.seatMembers()[s].length) this.system(`⏰ Time! ${this.seatLabel(s)} passed ${preferred.length ? 'the highlighted cards' : 'at random'}.`);
          }
          acted = true;
        }
      } else if (g.phase === 'playing') {
        const seat = g.turn;
        const legal = legalPlays(g, seat);
        if (this.isBotSeat(seat)) {
          if (now >= this.turnStartedAt + this.botDelay(seat)) {
            this.doPlay(seat, botPlay(g, seat, this.deps.rng));
            acted = true;
          }
        } else if (this.rules.autoPlayForced && legal.length === 1 && now >= this.turnStartedAt + this.deps.timing.forcedDelay) {
          this.doPlay(seat, legal[0]);
          acted = true;
        } else if (this.turnDeadline !== null && now >= this.turnDeadline) {
          const card = randomLegal(g, seat, this.deps.rng);
          this.system(`⏰ Time! ${this.seatLabel(seat)} played ${cardLabel(card)} at random.`);
          this.doPlay(seat, card);
          acted = true;
        } else if (this.turnDeadline === null && this.seatAbsent(seat) && now >= this.turnStartedAt + this.deps.timing.absentGrace) {
          this.doPlay(seat, botPlay(g, seat, this.deps.rng));
          acted = true;
        }
      } else if (g.phase === 'handOver') {
        if (this.nextHandAt !== null && now >= this.nextHandAt) {
          this.dealNext();
          acted = true;
        }
      }
    }
    this.schedule();
  }

  private seatAbsent(seat: number): boolean {
    const m = this.seatMembers()[seat];
    return m.length > 0 && m.every((p) => !p.connected);
  }

  /** A per-seat, per-turn wobble so bots don't all move in lockstep. */
  private botDelay(seat: number): number {
    const g = this.game!;
    const wobble = ((seat * 7 + g.hand * 13 + g.tricks.length * 5 + g.trick.plays.length * 3) % 7) / 7;
    return this.deps.timing.botDelay * (0.7 + wobble * 0.8);
  }

  /** The next moment something automatic could happen, or null. */
  nextEventAt(): number | null {
    const g = this.game;
    if (!g || this.phase !== 'game') return null;
    const times: number[] = [];
    if (this.pause) return this.pause.until;
    if (g.phase === 'passing') {
      for (let s = 0; s < g.rules.seats; s++) if (!g.passes[s] && this.isBotSeat(s)) times.push(this.dealtAt + this.botDelay(s));
      if (this.passDeadline !== null) times.push(this.passDeadline);
    } else if (g.phase === 'playing') {
      const seat = g.turn;
      if (this.isBotSeat(seat)) times.push(this.turnStartedAt + this.botDelay(seat));
      else {
        if (this.rules.autoPlayForced && legalPlays(g, seat).length === 1) times.push(this.turnStartedAt + this.deps.timing.forcedDelay);
        if (this.turnDeadline !== null) times.push(this.turnDeadline);
        else if (this.seatAbsent(seat)) times.push(this.turnStartedAt + this.deps.timing.absentGrace);
      }
    } else if (g.phase === 'handOver' && this.nextHandAt !== null) times.push(this.nextHandAt);
    return times.length ? Math.min(...times) : null;
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const at = this.nextEventAt();
    if (at === null) return;
    const delay = Math.max(0, at - this.deps.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (e) {
        console.error(`[room ${this.code}] tick failed`, e);
      }
      this.broadcast();
    }, delay + 5);
  }

  // ------------------------------------------------------------------ chat

  private system(text: string): void {
    this.pushChat(this.chat, { from: null, name: '', color: '', text });
  }

  private pushChat(list: ChatMsg[], m: Omit<ChatMsg, 'id' | 'at'>): void {
    list.push({ ...m, id: ++this.chatSeq, at: this.deps.now() });
    if (list.length > CHAT_KEEP) list.splice(0, list.length - CHAT_KEEP);
  }

  say(id: string, text: string, scope: 'table' | 'team'): void {
    const p = this.player(id);
    const clean = String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 300);
    if (!clean) return;
    const now = this.deps.now();
    if (now - p.lastChat < 250) throw new GameError('Slow down a little.');
    p.lastChat = now;
    if (scope === 'team') {
      if (p.seat === null) throw new GameError('Sit down to use team chat.');
      this.pushChat(this.teamChat[p.seat], { from: p.id, name: p.name, color: p.color, text: clean });
    } else {
      this.pushChat(this.chat, { from: p.id, name: p.name, color: p.color, text: clean });
    }
    this.touch();
  }

  emote(id: string, emote: string): void {
    const p = this.player(id);
    if (!(EMOTES as readonly string[]).includes(emote)) throw new GameError('Unknown emote.');
    const now = this.deps.now();
    if (now - p.lastEmote < 800) return;
    p.lastEmote = now;
    for (const other of this.players) this.deps.send(other.id, { t: 'emote', playerId: p.id, name: p.name, seat: p.seat, emote });
  }

  // ------------------------------------------------------------------ views

  seatLabel(seat: number): string {
    const members = this.seatMembers()[seat];
    if (this.bots[seat] && !members.length) return this.bots[seat]!;
    if (members.length === 1) return members[0].name;
    if (members.length > 1) return members.map((m) => m.name).join(' & ');
    return `Seat ${seat + 1}`;
  }

  private playerView(p: Player): PlayerView {
    return { id: p.id, name: p.name, color: p.color, connected: p.connected, seat: p.seat, host: p.id === this.hostId };
  }

  view(playerId: string): RoomView {
    const me = this.player(playerId);
    const seats: SeatView[] = this.seatMembers().map((members, i) => ({
      index: i,
      colorName: SEAT_COLORS[i].name,
      color: SEAT_COLORS[i].hex,
      players: members.map((m) => this.playerView(m)),
      bot: this.bots[i],
      label: this.seatLabel(i),
    }));
    const g = this.game;
    let game: GameView | null = null;
    let deadline: number | null = null;
    let deadlineKind: 'pass' | 'play' | null = null;
    if (g) {
      const mySeat = me.seat;
      const last = g.tricks.length ? g.tricks[g.tricks.length - 1] : null;
      game = {
        hand: g.hand,
        phase: g.phase,
        passDir: g.passDir,
        passCount: g.rules.passCount,
        passTo: mySeat !== null && g.passDir !== 'hold' ? passRecipient(g, mySeat) : null,
        myHand: mySeat !== null ? g.hands[mySeat].slice() : [],
        handCounts: g.hands.map((h) => h.length),
        passed: g.passes.map((x) => !!x),
        received: mySeat !== null ? g.received[mySeat].slice() : [],
        trick: g.trick,
        lastTrick: last,
        trickNumber: Math.min(g.tricks.length + 1, cardsPerSeat(g.rules.seats)),
        tricksPerHand: cardsPerSeat(g.rules.seats),
        turn: g.turn,
        heartsBroken: g.heartsBroken,
        taken: g.taken,
        handPoints: handPoints(g),
        scores: g.scores,
        history: g.history,
        winners: g.winners,
        legal: mySeat !== null && !this.pause ? legalPlays(g, mySeat) : [],
      };
      if (g.phase === 'passing' && this.passDeadline) { deadline = this.passDeadline; deadlineKind = 'pass'; }
      if (g.phase === 'playing' && this.turnDeadline && !this.pause) { deadline = this.turnDeadline; deadlineKind = 'play'; }
    }
    return {
      code: this.code,
      you: { id: me.id, seat: me.seat, host: me.id === this.hostId, name: me.name, color: me.color },
      phase: this.phase,
      table: this.table,
      rules: this.rules,
      seats,
      spectators: this.players.filter((p) => p.seat === null).map((p) => this.playerView(p)),
      chat: this.chat,
      teamChat: me.seat !== null ? this.teamChat[me.seat] ?? [] : [],
      game,
      picks: me.seat !== null ? this.picks[me.seat] : { pass: {}, play: {} },
      deadline,
      deadlineKind,
      pause: this.pause,
      nextHandAt: this.nextHandAt,
      serverNow: this.deps.now(),
    };
  }

  broadcast(): void {
    for (const p of this.players) {
      if (!p.connected) continue;
      this.deps.send(p.id, { t: 'state', room: this.view(p.id) });
    }
  }

  private touch(): void {
    this.lastActive = this.deps.now();
    this.deps.onChange?.();
  }

  /** Apply a validated client action. Errors are thrown as GameError. */
  handle(playerId: string, msg: Record<string, unknown>): void {
    switch (msg.t) {
      case 'sit': this.sit(playerId, Number(msg.seat)); break;
      case 'stand': this.stand(playerId); break;
      case 'bot': this.setBot(playerId, Number(msg.seat), !!msg.on); break;
      case 'fillBots': this.fillBots(playerId); break;
      case 'config': this.configure(playerId, msg.table as Partial<TableConfig> | undefined, msg.rules as Partial<Rules> | undefined); break;
      case 'start': this.start(playerId); break;
      case 'highlight': this.highlight(playerId, String(msg.card), !!msg.on); break;
      case 'pass': this.pass(playerId); break;
      case 'play': this.play(playerId, String(msg.card)); break;
      case 'chat': this.say(playerId, String(msg.text ?? ''), msg.scope === 'team' ? 'team' : 'table'); break;
      case 'emote': this.emote(playerId, String(msg.emote)); return; // emotes are events, not state
      case 'dealNow': this.dealNow(playerId); break;
      case 'playAgain': this.playAgain(playerId); break;
      case 'toLobby': this.toLobby(playerId); break;
      case 'kick': this.kick(playerId, String(msg.playerId)); break;
      case 'leave': this.leave(playerId); break;
      default: throw new GameError('Unknown action.');
    }
    this.tick();
  }
}

