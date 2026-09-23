import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { ServerMsg } from '@heartsgang/engine';
import { GameError, Room, Timing } from './room';
import { RoomManager } from './rooms';

export interface ServerOptions {
  port: number;
  host?: string;
  staticDir?: string | null;
  dataDir?: string | null;
  timing?: Partial<Timing>;
  version?: string;
}

interface Conn { ws: WebSocket; room: Room | null; playerId: string | null; alive: boolean; bucket: number; bucketAt: number }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

export function startServer(opts: ServerOptions): Promise<{ server: Server; manager: RoomManager; close: () => Promise<void>; port: number }> {
  const conns = new Set<Conn>();
  const byPlayer = new Map<string, Set<Conn>>();

  const send = (playerId: string, msg: ServerMsg) => {
    const set = byPlayer.get(playerId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const c of set) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  };

  const manager = new RoomManager({ dataDir: opts.dataDir, timing: opts.timing, send });
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;

  const serveStatic = (req: IncomingMessage, res: ServerResponse) => {
    if (!staticRoot) { res.writeHead(404).end('Not found'); return; }
    let path: string;
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    let file = join(staticRoot, path);
    if (!file.startsWith(staticRoot)) { res.writeHead(403).end(); return; }
    if (!path || !existsSync(file) || statSync(file).isDirectory()) {
      if (extname(path)) { res.writeHead(404).end('Not found'); return; }
      file = join(staticRoot, 'index.html'); // single-page app: /123456 opens the join screen
      path = 'index.html';
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    const cache = path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  };

  const server = createServer((req, res) => {
    try {
      route(req, res);
    } catch (e) {
      console.error('[http] request failed', e);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  const route = (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, tables: manager.rooms.size, version: opts.version ?? 'dev' }));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    serveStatic(req, res);
  };

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  const attach = (c: Conn, room: Room, playerId: string) => {
    if (c.playerId) byPlayer.get(c.playerId)?.delete(c);
    c.room = room;
    c.playerId = playerId;
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Set());
    byPlayer.get(playerId)!.add(c);
    room.setConnected(playerId, true);
  };

  const detach = (c: Conn) => {
    if (!c.playerId) return;
    const set = byPlayer.get(c.playerId);
    set?.delete(c);
    if (c.room && (!set || set.size === 0)) {
      byPlayer.delete(c.playerId);
      c.room.setConnected(c.playerId, false);
      c.room.tick();
      c.room.broadcast();
    }
  };

  wss.on('connection', (ws) => {
    const c: Conn = { ws, room: null, playerId: null, alive: true, bucket: 30, bucketAt: Date.now() };
    conns.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => {
      // Token bucket: 30 messages, refilling 10 a second.
      const now = Date.now();
      c.bucket = Math.min(30, c.bucket + ((now - c.bucketAt) / 1000) * 10);
      c.bucketAt = now;
      if (c.bucket < 1) return;
      c.bucket -= 1;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
        if (!msg || typeof msg !== 'object') throw new Error();
      } catch {
        return;
      }
      try {
        if (msg.t === 'ping') { ws.send(JSON.stringify({ t: 'pong' })); return; }
        if (msg.t === 'create' || msg.t === 'join') {
          const prev = c.room;
          const { room, playerId } = msg.t === 'create'
            ? manager.create(String(msg.token), String(msg.name ?? ''), msg.table as never, (msg.rules ?? {}) as never)
            : manager.join(msg.code, String(msg.token), String(msg.name ?? ''));
          if (prev && prev !== room) detach(c);
          attach(c, room, playerId);
          room.tick();
          room.broadcast();
          return;
        }
        if (!c.room || !c.playerId) throw new GameError('Join a table first.');
        const room = c.room;
        if (!room.players.some((p) => p.id === c.playerId)) {
          c.room = null;
          ws.send(JSON.stringify({ t: 'left' }));
          return;
        }
        const leaving = msg.t === 'leave';
        room.handle(c.playerId, msg);
        room.broadcast();
        if (leaving) {
          ws.send(JSON.stringify({ t: 'left' }));
          byPlayer.get(c.playerId)?.delete(c);
          c.room = null;
          c.playerId = null;
        }
      } catch (e) {
        const message = e instanceof GameError ? e.message : 'Something went wrong. Try again.';
        if (!(e instanceof GameError)) console.error('[ws] error handling', msg.t, e);
        ws.send(JSON.stringify({ t: 'error', message }));
      }
    });
    ws.on('close', () => { conns.delete(c); detach(c); });
    ws.on('error', () => { /* close follows */ });
  });

  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* ignore */ }
    }
  }, 25000);
  heartbeat.unref();

  return new Promise((resolveStart) => {
    server.listen(opts.port, opts.host ?? '0.0.0.0', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolveStart({
        server,
        manager,
        port,
        close: () => new Promise<void>((done) => {
          clearInterval(heartbeat);
          manager.stop();
          for (const c of conns) c.ws.terminate();
          wss.close();
          server.close(() => done());
        }),
      });
    });
  });
}
