import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Rng, Rules, ServerMsg, TableConfig } from '@heartsgang/engine';
import { DEFAULT_TIMING, GameError, Room, RoomDeps, RoomSnapshot, Timing, sanitizeName } from './room';

export interface ManagerOptions {
  dataDir?: string | null;
  timing?: Partial<Timing>;
  rng?: Rng;
  now?: () => number;
  send: (playerId: string, msg: ServerMsg) => void;
  /** Rooms nobody has touched for this long are removed. */
  idleMs?: number;
  maxRooms?: number;
}

export const cryptoRng: Rng = (n) => randomInt(0, n);
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export class RoomManager {
  rooms = new Map<string, Room>();
  private opts: ManagerOptions;
  private deps: RoomDeps;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: ManagerOptions) {
    this.opts = opts;
    this.deps = {
      rng: opts.rng ?? cryptoRng,
      now: opts.now ?? Date.now,
      send: opts.send,
      timing: { ...DEFAULT_TIMING, ...(opts.timing ?? {}) },
      onChange: () => { this.dirty = true; },
    };
    if (opts.dataDir) {
      mkdirSync(opts.dataDir, { recursive: true });
      this.load();
      this.saveTimer = setInterval(() => this.save(), 2000);
      this.saveTimer.unref?.();
    }
    this.sweepTimer = setInterval(() => this.sweep(), 60000);
    this.sweepTimer.unref?.();
  }

  private file(): string {
    return join(this.opts.dataDir!, 'rooms.json');
  }

  private load(): void {
    try {
      const snaps = JSON.parse(readFileSync(this.file(), 'utf8')) as RoomSnapshot[];
      for (const s of snaps) this.rooms.set(s.code, Room.restore(s, this.deps));
      if (snaps.length) console.log(`[rooms] restored ${snaps.length} table(s)`);
    } catch {
      /* first boot, or nothing saved */
    }
  }

  save(force = false): void {
    if (!this.opts.dataDir || (!this.dirty && !force)) return;
    this.dirty = false;
    const data = JSON.stringify([...this.rooms.values()].map((r) => r.snapshot()));
    const tmp = this.file() + '.tmp';
    writeFileSync(tmp, data);
    renameSync(tmp, this.file());
  }

  /** Remove tables nobody is at. Bot moves don't count as somebody being there. */
  sweep(): void {
    const idle = this.opts.idleMs ?? 6 * 3600 * 1000;
    const now = this.deps.now();
    for (const [code, room] of this.rooms) {
      const lastHuman = room.players.reduce((t, p) => Math.max(t, p.connected ? now : p.lastSeen), 0);
      const abandoned = room.players.length === 0 || now - lastHuman > 30 * 60 * 1000;
      if (abandoned || now - room.lastActive > idle) {
        room.dispose();
        this.rooms.delete(code);
        this.dirty = true;
      }
    }
  }

  stop(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.save(true);
    for (const r of this.rooms.values()) r.dispose();
  }

  private newCode(): string {
    for (let i = 0; i < 1000; i++) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError('Could not find a free table code. Try again.');
  }

  static checkToken(token: unknown): string {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new GameError('Your browser sent a bad session. Reload the page.');
    return token;
  }

  create(token: string, name: string, table: TableConfig, rules: Partial<Rules>): { room: Room; playerId: string } {
    RoomManager.checkToken(token);
    const clean = sanitizeName(name);
    if (!clean) throw new GameError('Enter your name first.');
    if (this.rooms.size >= (this.opts.maxRooms ?? 2000)) throw new GameError('The server is full right now. Try again soon.');
    const id = randomBytes(8).toString('hex');
    const room = new Room(this.newCode(), { id, token, name: clean }, table, rules, this.deps);
    this.rooms.set(room.code, room);
    this.dirty = true;
    return { room, playerId: id };
  }

  join(code: unknown, token: string, name: string): { room: Room; playerId: string } {
    RoomManager.checkToken(token);
    const c = String(code ?? '').replace(/\D/g, '');
    const room = this.rooms.get(c);
    if (!room) throw new GameError(`No game with code ${c || '(blank)'}. Check the number and try again.`);
    const existing = room.playerByToken(token);
    if (!existing && !sanitizeName(name)) throw new GameError('Enter your name first.');
    const p = room.join(existing?.id ?? randomBytes(8).toString('hex'), token, name);
    return { room, playerId: p.id };
  }
}
