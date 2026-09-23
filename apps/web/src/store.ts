import { useSyncExternalStore } from 'react';
import type { ClientMsg, RoomView, ServerMsg } from '@heartsgang/engine';

export interface EmoteEvent { key: number; playerId: string; name: string; seat: number | null; emote: string; at: number }
export interface Toast { key: number; text: string; kind: 'error' | 'info' }

interface State {
  status: 'connecting' | 'open' | 'closed';
  room: RoomView | null;
  /** serverNow − Date.now(), so countdowns match the server's clock. */
  clockOffset: number;
  emotes: EmoteEvent[];
  toasts: Toast[];
  /** Set while a create/join is in flight, so the UI can show a spinner. */
  pending: boolean;
}

const TOKEN_KEY = 'hg.token';
const NAME_KEY = 'hg.name';
const CODE_KEY = 'hg.code';

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'[b % 64]).join('');
}

const safe = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export const session = {
  token(): string {
    let t = safe.get(TOKEN_KEY);
    if (!t || !/^[A-Za-z0-9_-]{8,64}$/.test(t)) { t = randomToken(); safe.set(TOKEN_KEY, t); }
    return t;
  },
  name: () => safe.get(NAME_KEY) ?? '',
  setName: (n: string) => safe.set(NAME_KEY, n),
  code: () => safe.get(CODE_KEY),
  setCode: (c: string | null) => safe.set(CODE_KEY, c),
};

let state: State = { status: 'connecting', room: null, clockOffset: 0, emotes: [], toasts: [], pending: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };

let ws: WebSocket | null = null;
let retry = 0;
let seq = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
const queue: ClientMsg[] = [];

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function toast(text: string, kind: Toast['kind'] = 'error') {
  const key = ++seq;
  set({ toasts: [...state.toasts, { key, text, kind }].slice(-3) });
  setTimeout(() => set({ toasts: state.toasts.filter((t) => t.key !== key) }), kind === 'error' ? 4200 : 2600);
}

function onMessage(ev: MessageEvent) {
  let msg: ServerMsg;
  try { msg = JSON.parse(String(ev.data)); } catch { return; }
  switch (msg.t) {
    case 'state': {
      const room = msg.room;
      session.setCode(room.code);
      if (location.pathname !== `/${room.code}`) history.replaceState(null, '', `/${room.code}`);
      set({ room, clockOffset: room.serverNow - Date.now(), pending: false });
      break;
    }
    case 'error':
      set({ pending: false });
      toast(msg.message);
      if (/No game with code/.test(msg.message)) {
        session.setCode(null);
        if (state.room === null && /^\/\d{6}$/.test(location.pathname)) history.replaceState(null, '', '/');
      }
      break;
    case 'emote': {
      const e: EmoteEvent = { key: ++seq, playerId: msg.playerId, name: msg.name, seat: msg.seat, emote: msg.emote, at: Date.now() };
      set({ emotes: [...state.emotes, e].slice(-24) });
      setTimeout(() => set({ emotes: state.emotes.filter((x) => x.key !== e.key) }), 3200);
      break;
    }
    case 'left':
      session.setCode(null);
      history.replaceState(null, '', '/');
      set({ room: null });
      break;
  }
}

export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  set({ status: 'connecting' });
  const sock = new WebSocket(url());
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    set({ status: 'open' });
    // Resume the table we were at, if any.
    const code = state.room?.code ?? session.code();
    if (code && /^\d{6}$/.test(code)) sock.send(JSON.stringify({ t: 'join', code, name: session.name(), token: session.token() }));
    while (queue.length) sock.send(JSON.stringify(queue.shift()));
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => { if (sock.readyState === WebSocket.OPEN) sock.send('{"t":"ping"}'); }, 20000);
  };
  sock.onmessage = onMessage;
  sock.onclose = () => {
    if (ws !== sock) return;
    set({ status: 'closed' });
    const delay = Math.min(8000, 400 * 2 ** retry++);
    setTimeout(connect, delay);
  };
  sock.onerror = () => sock.close();
}

export function send(msg: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else { queue.push(msg); connect(); }
}

export function createTable(name: string, table: Extract<ClientMsg, { t: 'create' }>['table'], rules: Extract<ClientMsg, { t: 'create' }>['rules']) {
  session.setName(name);
  set({ pending: true });
  send({ t: 'create', name, token: session.token(), table, rules });
}

export function joinTable(code: string, name: string) {
  session.setName(name);
  set({ pending: true });
  send({ t: 'join', code, name, token: session.token() });
}

export function leaveTable() {
  send({ t: 'leave' });
  session.setCode(null);
  history.replaceState(null, '', '/');
  set({ room: null });
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => select(state),
  );
}

export function serverNow(): number {
  return Date.now() + state.clockOffset;
}
