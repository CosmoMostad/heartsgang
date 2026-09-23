import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FULL_DECK, RoomView } from '@heartsgang/engine';
import { startServer } from '../src/server';
import { Client, FAST } from './helpers';

type Started = Awaited<ReturnType<typeof startServer>>;
let srv: Started;
let url: string;
const clients: Client[] = [];
const staticDir = mkdtempSync(join(tmpdir(), 'hg-static-'));

beforeAll(async () => {
  mkdirSync(join(staticDir, 'assets'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Hearts Gang</title>');
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log(1)');
  srv = await startServer({ port: 0, host: '127.0.0.1', staticDir, timing: FAST, version: 'test' });
  url = `ws://127.0.0.1:${srv.port}/ws`;
});
afterAll(async () => {
  for (const c of clients) c.close();
  await srv.close();
});

async function client(token?: string) {
  const c = new Client(url, token);
  clients.push(c);
  await c.opened;
  return c;
}

async function hostTable(table = { mode: 'classic', seats: 4, maxPerSeat: 1 }, rules: Record<string, unknown> = {}, name = 'Olly') {
  const host = await client();
  host.send({ t: 'create', name, token: host.token, table, rules });
  await host.waitFor((r) => !!r.code, 3000, 'create');
  return host;
}

async function joiner(code: string, name: string) {
  const c = await client();
  c.send({ t: 'join', code, name, token: c.token });
  await c.waitFor((r) => r.code === code, 3000, `${name} join`);
  return c;
}

const mySeat = (r: RoomView) => r.you.seat!;

describe('http', () => {
  it('reports health and serves the app with a single-page fallback', async () => {
    const base = `http://127.0.0.1:${srv.port}`;
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({ ok: true, version: 'test' });
    const page = await fetch(`${base}/482913`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Hearts Gang');
    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/../../etc/passwd`)).status).not.toBe(500);
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
    expect((await fetch(`${base}/health`)).status).toBe(200); // still alive
  });
});

describe('lobby', () => {
  it('creates a table with a 6-digit code and seats the host', async () => {
    const host = await hostTable();
    const r = host.room!;
    expect(r.code).toMatch(/^\d{6}$/);
    expect(r.phase).toBe('lobby');
    expect(r.you.host).toBe(true);
    expect(r.seats[0].players[0].name).toBe('Olly');
    expect(r.rules.seats).toBe(4);
  });

  it('joins by code, auto-seats, and rejects bad codes and names', async () => {
    const host = await hostTable();
    const sam = await joiner(host.room!.code, 'Sam');
    expect(mySeat(sam.room!)).toBe(1);
    await host.waitFor((r) => r.seats[1].players.length === 1, 2000, 'host sees Sam');
    const lost = await client();
    lost.send({ t: 'join', code: '000000x', name: 'Nobody', token: lost.token });
    await lost.waitError(/No game with code/);
    const noName = await client();
    noName.send({ t: 'join', code: host.room!.code, name: '   ', token: noName.token });
    await noName.waitError(/name/);
    const dup = await joiner(host.room!.code, 'Sam');
    expect(dup.room!.you.name).toBe('Sam 2');
  });

  it('lets friends share a seat as a team, up to the limit', async () => {
    const host = await hostTable({ mode: 'street', seats: 4, maxPerSeat: 2 });
    const code = host.room!.code;
    const sam = await joiner(code, 'Sam');
    sam.send({ t: 'sit', seat: 0 });
    await sam.waitFor((r) => r.you.seat === 0, 2000, 'Sam joins host seat');
    await host.waitFor((r) => r.seats[0].players.length === 2 && r.seats[0].label === 'Olly & Sam', 2000, 'team label');
    const third = await joiner(code, 'Kim');
    third.send({ t: 'sit', seat: 0 });
    await third.waitError(/full/);
  });

  it('only lets the host change rules, add bots and start; start needs every seat filled', async () => {
    const host = await hostTable();
    const sam = await joiner(host.room!.code, 'Sam');
    sam.send({ t: 'start' });
    await sam.waitError(/Only the host/);
    host.send({ t: 'start' });
    await host.waitError(/Fill every seat/);
    host.send({ t: 'config', rules: { jackOfDiamonds: true, target: 50 } });
    await sam.waitFor((r) => r.rules.jackOfDiamonds && r.rules.target === 50, 2000, 'rules sync');
    host.send({ t: 'config', table: { mode: 'six', seats: 6, maxPerSeat: 1 } });
    await sam.waitFor((r) => r.seats.length === 6 && r.rules.seats === 6 && r.rules.passCount === 2, 2000, 'six seats');
    host.send({ t: 'fillBots' });
    await host.waitFor((r) => r.seats.filter((s) => s.bot).length === 4, 2000, 'bots');
    host.send({ t: 'start' });
    const g = await host.waitFor((r) => r.phase === 'game', 2000, 'started');
    expect(g.game!.myHand.length).toBe(8);
  });
});

describe('playing', () => {
  it('never sends another seat’s cards to a browser', async () => {
    const host = await hostTable();
    const code = host.room!.code;
    const sam = await joiner(code, 'Sam');
    const watcher = await joiner(code, 'Watcher');
    watcher.send({ t: 'stand' });
    await watcher.waitFor((r) => r.you.seat === null, 2000, 'stand');
    host.send({ t: 'fillBots' });
    host.send({ t: 'start' });
    await host.waitFor((r) => r.phase === 'game', 2000, 'start');
    await sam.waitFor((r) => r.phase === 'game', 2000, 'start sam');
    await watcher.waitFor((r) => r.phase === 'game', 2000, 'start watcher');
    const hostHand = host.room!.game!.myHand;
    const samHand = sam.room!.game!.myHand;
    expect(hostHand.length).toBe(13);
    expect(hostHand.some((c) => samHand.includes(c))).toBe(false);
    expect(watcher.room!.game!.myHand).toEqual([]);
    // No raw message to Sam ever contains a card from the host's hand in a hand-like position.
    for (const text of sam.raw) {
      const msg = JSON.parse(text);
      if (msg.t !== 'state' || !msg.room.game) continue;
      expect(JSON.stringify(msg.room.game.myHand)).not.toContain(hostHand[0]);
      expect(msg.room.game).not.toHaveProperty('hands');
      expect(msg.room.game).not.toHaveProperty('passes');
    }
  });

  it('shares one hand across a team: highlights, passing and team chat', async () => {
    const host = await hostTable({ mode: 'street', seats: 4, maxPerSeat: 2 }, { passSeconds: 0, playSeconds: 0 });
    const code = host.room!.code;
    const sam = await joiner(code, 'Sam');
    sam.send({ t: 'sit', seat: 0 });
    await sam.waitFor((r) => r.you.seat === 0, 2000, 'team up');
    const rival = await joiner(code, 'Rival');
    await rival.waitFor((r) => r.you.seat === 1, 2000, 'rival seat');
    host.send({ t: 'fillBots' });
    host.send({ t: 'start' });
    await sam.waitFor((r) => r.game?.phase === 'passing', 2000, 'passing');
    const hand = host.room!.game!.myHand;
    expect(sam.room!.game!.myHand).toEqual(hand);

    host.send({ t: 'highlight', card: hand[0], on: true });
    await sam.waitFor((r) => r.picks.pass[hand[0]] === host.room!.you.id, 2000, 'teammate sees highlight');
    expect(rival.room!.picks.pass[hand[0]]).toBeUndefined();

    sam.send({ t: 'pass' });
    await sam.waitError(/exactly 3/);
    sam.send({ t: 'highlight', card: hand[1], on: true });
    sam.send({ t: 'highlight', card: hand[2], on: true });
    sam.send({ t: 'highlight', card: hand[3], on: true });
    await sam.waitError(/Clear one first/);
    await host.waitFor((r) => Object.keys(r.picks.pass).length === 3, 2000, 'three picked');

    host.send({ t: 'chat', text: 'pass the queen?', scope: 'team' });
    await sam.waitFor((r) => r.teamChat.some((m) => m.text === 'pass the queen?'), 2000, 'team chat');
    await new Promise((r) => setTimeout(r, 300));
    host.send({ t: 'chat', text: 'good luck all', scope: 'table' });
    await rival.waitFor((r) => r.chat.some((m) => m.text === 'good luck all'), 2000, 'table chat');
    expect(rival.room!.teamChat.some((m) => m.text === 'pass the queen?')).toBe(false);

    // The teammate presses Pass, and the seat's three highlighted cards go.
    sam.send({ t: 'pass' });
    await host.waitFor((r) => r.game!.passed[0], 2000, 'seat passed');
    rival.send({ t: 'highlight', card: rival.room!.game!.myHand[0], on: true });
    rival.send({ t: 'highlight', card: rival.room!.game!.myHand[1], on: true });
    rival.send({ t: 'highlight', card: rival.room!.game!.myHand[2], on: true });
    await rival.waitFor((r) => Object.keys(r.picks.pass).length === 3, 2000, 'rival picks');
    rival.send({ t: 'pass' });
    const playing = await host.waitFor((r) => r.game!.phase === 'playing', 3000, 'exchange');
    for (const c of hand.slice(0, 3)) expect(playing.game!.myHand).not.toContain(c);
    expect(playing.game!.received.length).toBe(3);
  });

  it('plays the pressing player’s highlighted card and rejects illegal or out-of-turn plays', async () => {
    const host = await hostTable({ mode: 'classic', seats: 4, maxPerSeat: 1 }, { passCount: 0, playSeconds: 0, autoPlayForced: false });
    host.send({ t: 'fillBots' });
    host.send({ t: 'start' });
    await host.waitFor((r) => r.phase === 'game', 2000, 'start');
    // Wait for our turn; bots play automatically.
    const r = await host.waitFor((x) => x.game!.turn === 0 && !x.pause && x.game!.legal.length > 0, 5000, 'our turn');
    const illegal = r.game!.myHand.find((c) => !r.game!.legal.includes(c));
    if (illegal) {
      host.send({ t: 'play', card: illegal });
      await host.waitError(/can’t be played/);
      host.send({ t: 'highlight', card: illegal, on: true });
      await host.waitError(/can’t be played/);
    }
    const card = r.game!.legal[0];
    host.send({ t: 'play', card });
    await host.waitFor((x) => !x.game!.myHand.includes(card), 2000, 'card played');
    host.send({ t: 'play', card: host.room!.game!.myHand[0] });
    await host.waitError(/isn’t your turn|trick is being collected|can’t be played/);
  });

  it('passes highlighted cards then random ones, and plays a random legal card, when time runs out', async () => {
    // passSeconds 15 at 20ms per second = 300ms.
    const host = await hostTable({ mode: 'classic', seats: 4, maxPerSeat: 1 }, { passSeconds: 15, playSeconds: 15, autoPlayForced: false });
    host.send({ t: 'fillBots' });
    host.send({ t: 'start' });
    const r = await host.waitFor((x) => x.game?.phase === 'passing', 2000, 'passing');
    expect(r.deadlineKind).toBe('pass');
    const keep = r.game!.myHand[4];
    host.send({ t: 'highlight', card: keep, on: true });
    const after = await host.waitFor((x) => x.game!.phase === 'playing', 3000, 'timed pass');
    expect(after.game!.myHand).not.toContain(keep);
    expect(after.chat.some((m) => /Time!.*passed the highlighted cards/.test(m.text))).toBe(true);
    // Now sit still: the play clock should play for us.
    await host.waitFor((x) => x.chat.some((m) => /Time!.*played .* at random/.test(m.text)), 8000, 'timed play');
  });

  it('runs whole games: redeals shuffled hands, scores every hand, and ends at the target', async () => {
    const host = await hostTable({ mode: 'gang', seats: 3, maxPerSeat: 2 }, { target: 50, playSeconds: 0, passSeconds: 0 });
    const code = host.room!.code;
    const mate = await joiner(code, 'Mate');
    mate.send({ t: 'sit', seat: 0 });
    await mate.waitFor((r) => r.you.seat === 0, 2000, 'mate');
    host.send({ t: 'fillBots' });
    host.send({ t: 'start' });
    const hands = new Set<string>();
    // Play for the seat like a real player would: highlight, then the teammate presses the button.
    const auto = setInterval(() => {
      const r = host.room;
      if (!r?.game) return;
      const g = r.game;
      hands.add(`${g.hand}:${[...g.myHand].sort().join('')}`);
      if (g.phase === 'passing' && !g.passed[0]) {
        const picked = Object.keys(r.picks.pass);
        if (picked.length < g.passCount) host.send({ t: 'highlight', card: g.myHand.find((c) => !picked.includes(c))!, on: true });
        else mate.send({ t: 'pass' });
      }
      if (g.phase === 'playing' && g.turn === 0 && g.legal.length && !r.pause) mate.send({ t: 'play', card: g.legal[g.legal.length - 1] });
    }, 15);
    try {
      // Between hands the table must clear, so the hand summary can show.
      const summary = await host.waitFor((r) => r.game?.phase === 'handOver' && r.pause === null, 60000, 'hand summary visible');
      expect(summary.nextHandAt).not.toBeNull();
      const done = await host.waitFor((r) => r.game?.phase === 'gameOver' && r.pause === null, 60000, 'game over, table cleared');
      const g = done.game!;
      expect(g.scores.some((s) => s >= 50)).toBe(true);
      expect(g.history.length).toBeGreaterThan(1);
      const sums = g.history.reduce((acc, h) => acc.map((x, i) => x + h.scored[i]), [0, 0, 0]);
      expect(g.scores).toEqual(sums);
      for (const h of g.history) expect(h.raw.reduce((a, b) => a + b, 0)).toBe(26);
      expect(g.winners.length).toBeGreaterThan(0);
      expect(done.chat.some((m) => /wins the game|win the game/.test(m.text))).toBe(true);
      expect(hands.size).toBeGreaterThan(1);
      // Play again resets the scores with the same seats.
      host.send({ t: 'playAgain' });
      const again = await host.waitFor((r) => r.game?.hand === 1 && r.game.scores.every((s) => s === 0), 3000, 'play again');
      expect(again.seats[0].players.length).toBe(2);
    } finally {
      clearInterval(auto);
    }
  });

  it('broadcasts emotes, and rejects unknown ones', async () => {
    const host = await hostTable();
    const sam = await joiner(host.room!.code, 'Sam');
    host.send({ t: 'emote', emote: '🔥' });
    await new Promise((r) => setTimeout(r, 150));
    expect(sam.emotes.some((e) => e.emote === '🔥' && e.name === 'Olly' && e.seat === 0)).toBe(true);
    host.send({ t: 'emote', emote: '<script>' });
    await host.waitError(/Unknown emote/);
  });

  it('keeps your seat when you reconnect, and hands a deserted seat to a bot', async () => {
    const host = await hostTable({ mode: 'classic', seats: 4, maxPerSeat: 1 }, { passSeconds: 0, playSeconds: 0 });
    const code = host.room!.code;
    const sam = await joiner(code, 'Sam');
    host.send({ t: 'fillBots' });
    host.send({ t: 'start' });
    await sam.waitFor((r) => r.phase === 'game', 2000, 'start');
    const hand = sam.room!.game!.myHand;
    const id = sam.room!.you.id;
    sam.close();
    await host.waitFor((r) => r.seats[1].players[0]?.connected === false, 2000, 'sam offline');
    const back = await client(sam.token);
    back.send({ t: 'join', code, name: 'Sam', token: sam.token });
    const r = await back.waitFor((x) => x.phase === 'game', 2000, 'rejoin');
    expect(r.you.id).toBe(id);
    expect(r.you.seat).toBe(1);
    expect(r.game!.myHand).toEqual(hand);
    back.send({ t: 'leave' });
    await host.waitFor((x) => !!x.seats[1].bot && x.seats[1].players.length === 0, 2000, 'bot takes over');
    for (let i = 0; i < 50 && !back.left; i++) await new Promise((r) => setTimeout(r, 20));
    expect(back.left).toBe(true);
  });

  it('moves the host role on when the host leaves', async () => {
    const host = await hostTable();
    const sam = await joiner(host.room!.code, 'Sam');
    host.send({ t: 'leave' });
    await sam.waitFor((r) => r.you.host, 2000, 'sam is host');
  });
});

describe('cleanup', () => {
  it('removes tables once no human has been connected for half an hour, even if bots keep playing', async () => {
    const { RoomManager } = await import('../src/rooms');
    let now = 1_000_000;
    const m = new RoomManager({ send: () => {}, now: () => now, timing: FAST });
    const kept = m.create('token-aaaaaaaa', 'Olly', { mode: 'classic', seats: 4, maxPerSeat: 1 }, {});
    const left = m.create('token-bbbbbbbb', 'Sam', { mode: 'classic', seats: 4, maxPerSeat: 1 }, {});
    left.room.leave(left.playerId);
    m.sweep();
    expect(m.rooms.has(left.room.code)).toBe(false);
    expect(m.rooms.has(kept.room.code)).toBe(true);
    kept.room.setConnected(kept.playerId, false);
    now += 29 * 60 * 1000;
    kept.room.lastActive = now; // bots still moving
    m.sweep();
    expect(m.rooms.has(kept.room.code)).toBe(true);
    now += 2 * 60 * 1000;
    kept.room.lastActive = now;
    m.sweep();
    expect(m.rooms.has(kept.room.code)).toBe(false);
    m.stop();
  });
});

describe('restarts', () => {
  it('restores tables and hands from disk after a restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hg-data-'));
    const a = await startServer({ port: 0, host: '127.0.0.1', dataDir, timing: FAST });
    const c1 = new Client(`ws://127.0.0.1:${a.port}/ws`);
    await c1.opened;
    c1.send({ t: 'create', name: 'Olly', token: c1.token, table: { mode: 'classic', seats: 4, maxPerSeat: 1 }, rules: { passSeconds: 0, playSeconds: 0 } });
    await c1.waitFor((r) => !!r.code);
    c1.send({ t: 'fillBots' });
    c1.send({ t: 'start' });
    const before = await c1.waitFor((r) => r.game?.phase === 'passing');
    const code = before.code;
    const hand = before.game!.myHand;
    c1.close();
    await a.close();

    const b = await startServer({ port: 0, host: '127.0.0.1', dataDir, timing: FAST });
    const c2 = new Client(`ws://127.0.0.1:${b.port}/ws`, c1.token);
    await c2.opened;
    c2.send({ t: 'join', code, name: 'Olly', token: c1.token });
    const after = await c2.waitFor((r) => r.code === code);
    expect(after.phase).toBe('game');
    expect(after.game!.myHand).toEqual(hand);
    expect(after.you.host).toBe(true);
    c2.close();
    await b.close();
  });
});

it('covers the whole deck in test fixtures', () => expect(FULL_DECK.length).toBe(52));
