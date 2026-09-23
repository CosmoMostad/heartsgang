import { useCallback, useEffect, useMemo, useState } from 'react';
import { cardLabel, type Card, type RoomView } from '@heartsgang/engine';
import { Table } from '../components/Table';
import { Hand, type Marker } from '../components/Hand';
import { ActionBar, playChoice } from '../components/ActionBar';
import { Chat, EmoteBar } from '../components/Chat';
import { GameOver, HandSummary, LastTrick, Scoreboard } from '../components/Overlays';
import { leaveTable, send, serverNow, useStore } from '../store';

function PassBanner({ room }: { room: RoomView }) {
  const g = room.game!;
  if (g.passDir === 'hold') return null;
  const arrow = { left: '←', right: '→', across: '↑', hold: '' }[g.passDir];
  const to = g.passTo !== null ? room.seats[g.passTo]?.label : null;
  return (
    <div className="pass-banner">
      <span className="pass-arrow">{arrow}</span>
      <b>Pass {g.passCount} {g.passDir}</b>
      {to && <small>to {to}</small>}
    </div>
  );
}

export function Game({ room }: { room: RoomView }) {
  const g = room.game!;
  const emotes = useStore((s) => s.emotes);
  const [showScores, setShowScores] = useState(false);
  const [showLast, setShowLast] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [emotesOpen, setEmotesOpen] = useState(false);
  const [, tick] = useState(0);

  // Show the hand summary only after the final trick has been swept away.
  const pauseLeft = room.pause ? room.pause.until - serverNow() : 0;
  useEffect(() => {
    if (pauseLeft <= 0) return;
    const t = setTimeout(() => tick((x) => x + 1), pauseLeft + 30);
    return () => clearTimeout(t);
  }, [pauseLeft]);

  const players = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const s of room.seats) for (const p of s.players) m.set(p.id, p);
    return m;
  }, [room.seats]);

  const marks = useMemo(() => {
    const out: Record<string, Marker[]> = {};
    const add = (card: string, id: string) => {
      const p = players.get(id);
      if (p) (out[card] ??= []).push({ id, name: p.name, color: p.color });
    };
    if (g.phase === 'passing') for (const [card, id] of Object.entries(room.picks.pass)) add(card, id);
    if (g.phase === 'playing') for (const [id, card] of Object.entries(room.picks.play)) add(card, id);
    return out;
  }, [g.phase, room.picks, players]);

  const mySeat = room.you.seat;
  const myTurn = g.phase === 'playing' && mySeat !== null && g.turn === mySeat && !room.pause;
  const legal = useMemo(() => (myTurn ? new Set(g.legal) : null), [myTurn, g.legal]);
  // Cards you were passed wear a 'new' tag until the first trick is over.
  const received = useMemo(() => new Set(g.phase === 'playing' && g.trickNumber <= 1 && !g.lastTrick ? g.received : []), [g.phase, g.received, g.trickNumber, g.lastTrick]);

  const toggle = useCallback((card: Card) => {
    if (g.phase === 'passing') {
      if (mySeat !== null && g.passed[mySeat]) return;
      send({ t: 'highlight', card, on: !room.picks.pass[card] });
    } else if (g.phase === 'playing') {
      send({ t: 'highlight', card, on: room.picks.play[room.you.id] !== card });
    }
  }, [g.phase, g.passed, mySeat, room.picks, room.you.id]);

  // Enter plays or passes, like pressing the big button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (g.phase === 'passing' && mySeat !== null && !g.passed[mySeat] && Object.keys(room.picks.pass).length === g.passCount) send({ t: 'pass' });
      if (myTurn) { const c = playChoice(room); if (c) send({ t: 'play', card: c }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [g, mySeat, myTurn, room]);

  const summaryVisible = g.phase === 'handOver' && !room.pause;
  const overVisible = g.phase === 'gameOver' && !room.pause;
  const center = overVisible ? <GameOver room={room} /> : summaryVisible ? <HandSummary room={room} /> : g.phase === 'passing' ? <PassBanner room={room} /> : null;
  const spectatorEmotes = emotes.filter((e) => e.seat === null);

  return (
    <main className={`game ${chatOpen ? 'chat-open' : ''}`}>
      <header className="topbar">
        <div className="brand"><span>Hearts</span> <em>Gang</em></div>
        <div className="top-info">
          <span className="chip strong">Hand {g.hand}</span>
          <span className="chip">{g.phase === 'passing' ? (g.passDir === 'hold' ? 'No pass' : `Pass ${g.passDir}`) : `Trick ${g.trickNumber}/${g.tricksPerHand}`}</span>
          <span className={`chip ${g.heartsBroken ? 'hearts-on' : ''}`} title={g.heartsBroken ? 'Hearts are broken' : 'Hearts not broken yet'}>♥ {g.heartsBroken ? 'broken' : 'unbroken'}</span>
          {room.rules.jackOfDiamonds && <span className="chip gold">J♦ −10</span>}
          <span className="chip">to {room.rules.target}</span>
        </div>
        <div className="top-actions">
          <div className="mobile-dock">
            <button className="dock-btn" onClick={() => setEmotesOpen((o) => !o)} aria-expanded={emotesOpen} aria-label="Emotes">😀</button>
            <button className="dock-btn" onClick={() => setChatOpen(true)} aria-label="Open chat">💬{unread > 0 && <span className="badge">{unread}</span>}</button>
            {emotesOpen && <div className="dock-emotes" onClick={() => setEmotesOpen(false)}><EmoteBar compact /></div>}
          </div>
          <button className="btn small ghost" onClick={() => setShowLast(true)} disabled={!g.lastTrick}>Last trick</button>
          <button className="btn small ghost" onClick={() => setShowScores(true)}>Scores</button>
          <span className="code-chip" title="Table code">#{room.code}</span>
          <button className="btn small ghost" onClick={() => { if (confirm('Leave this game? A bot will take your seat if you were the last one in it.')) leaveTable(); }}>Leave</button>
        </div>
      </header>

      <div className="game-body">
        <div className="play-area">
          <Table room={room} emotes={emotes} center={center} />
          {spectatorEmotes.map((e) => <span key={e.key} className="floating-emote">{e.emote} <small>{e.name}</small></span>)}
          <ActionBar room={room} />
          {mySeat !== null && g.myHand.length > 0 && (
            <Hand
              cards={g.myHand}
              marks={marks}
              myId={room.you.id}
              legal={legal}
              received={received}
              onToggle={toggle}
              disabled={g.phase === 'handOver' || g.phase === 'gameOver' || (g.phase === 'passing' && g.passed[mySeat])}
              dealKey={`${g.hand}-${g.phase === 'passing' ? 'p' : 'x'}`}
            />
          )}
          {mySeat !== null && room.seats[mySeat].players.length > 1 && (
            <p className="team-hint">You share this hand with {room.seats[mySeat].players.filter((p) => p.id !== room.you.id).map((p) => p.name).join(' & ')}. Your highlights show on their screen too.</p>
          )}
        </div>

        <aside className="side">
          <Chat room={room} onUnread={setUnread} />
        </aside>
      </div>

      {chatOpen && (
        <div className="sheet-backdrop" onClick={() => setChatOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn sheet-close" onClick={() => setChatOpen(false)} aria-label="Close chat">✕</button>
            <Chat room={room} />
          </div>
        </div>
      )}

      {showScores && <Scoreboard room={room} onClose={() => setShowScores(false)} />}
      {showLast && <LastTrick room={room} onClose={() => setShowLast(false)} />}
      <span className="sr-only" aria-live="polite">{myTurn ? `Your turn. You can play ${g.legal.map(cardLabel).join(', ')}.` : ''}</span>
    </main>
  );
}
