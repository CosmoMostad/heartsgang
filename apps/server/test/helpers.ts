import { WebSocket } from 'ws';
import type { ClientMsg, RoomView, ServerMsg } from '@heartsgang/engine';

export const FAST = { second: 20, botDelay: 8, trickPause: 15, handSummary: 30, forcedDelay: 10, absentGrace: 200 };

let tokenSeq = 0;
export const newToken = () => `test-token-${Date.now().toString(36)}-${++tokenSeq}`;

export class Client {
  ws: WebSocket;
  room: RoomView | null = null;
  errors: string[] = [];
  emotes: Extract<ServerMsg, { t: 'emote' }>[] = [];
  raw: string[] = [];
  left = false;
  token: string;
  private waiters: { pred: () => boolean; resolve: () => void }[] = [];
  opened: Promise<void>;

  constructor(url: string, token = newToken()) {
    this.token = token;
    this.ws = new WebSocket(url);
    this.opened = new Promise((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); });
    this.ws.on('message', (data) => {
      const text = String(data);
      this.raw.push(text);
      const msg = JSON.parse(text) as ServerMsg;
      if (msg.t === 'state') this.room = msg.room;
      else if (msg.t === 'error') this.errors.push(msg.message);
      else if (msg.t === 'emote') this.emotes.push(msg);
      else if (msg.t === 'left') this.left = true;
      this.check();
    });
  }

  private check() {
    this.waiters = this.waiters.filter((w) => { if (w.pred()) { w.resolve(); return false; } return true; });
  }

  send(msg: ClientMsg | Record<string, unknown>) {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor(pred: (room: RoomView) => boolean, timeout = 5000, label = 'condition'): Promise<RoomView> {
    return new Promise((resolve, reject) => {
      const ok = () => !!this.room && pred(this.room);
      if (ok()) return resolve(this.room!);
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}. Last errors: ${this.errors.slice(-3).join(' | ')}`)), timeout);
      this.waiters.push({ pred: ok, resolve: () => { clearTimeout(timer); resolve(this.room!); } });
    });
  }

  waitError(match: RegExp, timeout = 3000): Promise<string> {
    return new Promise((resolve, reject) => {
      const find = () => this.errors.find((e) => match.test(e));
      if (find()) return resolve(find()!);
      const timer = setTimeout(() => reject(new Error(`No error matching ${match}; got ${this.errors.join(' | ')}`)), timeout);
      this.waiters.push({ pred: () => !!find(), resolve: () => { clearTimeout(timer); resolve(find()!); } });
    });
  }

  close() { this.ws.close(); }
}
