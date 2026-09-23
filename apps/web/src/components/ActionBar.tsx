import { useEffect, useState } from 'react';
import { cardLabel, type RoomView } from '@heartsgang/engine';
import { send, serverNow } from '../store';

export function useCountdown(deadline: number | null): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - serverNow()) / 1000));
}

/** The card the Play button will play: your own highlight, else your teammates' single choice. */
export function playChoice(room: RoomView): string | null {
  const picks = room.picks.play;
  const legal = new Set(room.game?.legal ?? []);
  const mine = picks[room.you.id];
  if (mine && legal.has(mine)) return mine;
  const others = [...new Set(Object.values(picks))].filter((c) => legal.has(c));
  return others.length === 1 ? others[0] : null;
}

export function ActionBar({ room }: { room: RoomView }) {
  const g = room.game!;
  const seat = room.you.seat;
  const secs = useCountdown(room.deadline);
  const total = room.deadlineKind === 'pass' ? room.rules.passSeconds : room.rules.playSeconds;
  const urgent = secs !== null && secs <= 10;
  const seatLabel = (i: number) => room.seats[i]?.label ?? '';

  let text: React.ReactNode = null;
  let button: React.ReactNode = null;

  if (seat === null) {
    const open = room.seats.filter((s) => s.bot || s.players.length < room.table.maxPerSeat);
    text = open.length ? 'You’re watching. Take a bot’s seat or join a team to play.' : 'You’re watching this game.';
    button = open.length ? (
      <div className="join-seats">
        {open.map((s) => (
          <button key={s.index} className="btn small" style={{ ['--seat' as string]: s.color }} onClick={() => send({ t: 'sit', seat: s.index })}>
            Join {s.bot ? `(replace ${s.bot})` : s.label}
          </button>
        ))}
      </div>
    ) : null;
  } else if (room.pause) {
    const w = room.pause.trick.winner!;
    text = <>Trick to <b>{seatLabel(w)}</b></>;
  } else if (g.phase === 'passing') {
    const need = g.passCount;
    const picked = Object.keys(room.picks.pass).length;
    if (g.passed[seat]) {
      const waiting = room.seats.filter((s) => !g.passed[s.index]).map((s) => s.label);
      text = <>Passed. Waiting for {waiting.join(', ')}…</>;
    } else {
      const to = g.passTo !== null ? seatLabel(g.passTo) : '';
      text = picked < need
        ? <>Highlight <b>{need - picked}</b> more card{need - picked > 1 ? 's' : ''} to pass <b>{g.passDir}</b> to {to}.</>
        : <>Ready to pass <b>{g.passDir}</b> to {to}.</>;
      button = (
        <button className="btn primary big" disabled={picked !== need} onClick={() => send({ t: 'pass' })} id="pass-btn">
          Pass {need} card{need > 1 ? 's' : ''} <span className="arrow">{g.passDir === 'left' ? '←' : g.passDir === 'right' ? '→' : '↑'}</span>
        </button>
      );
    }
  } else if (g.phase === 'playing') {
    if (g.turn === seat) {
      const choice = playChoice(room);
      const conflict = !choice && new Set(Object.values(room.picks.play)).size > 1;
      text = choice ? null : conflict ? 'Your team picked different cards. Tap one to choose.' : g.legal.length === 1 ? 'Only one card you can play.' : 'Your turn. Tap a card, then press Play.';
      button = (
        <button className="btn primary big" disabled={!choice} onClick={() => choice && send({ t: 'play', card: choice })} id="play-btn">
          {choice ? <>Play <span className={`play-card ${/[HD]$/.test(choice) ? 'red' : ''}`}>{cardLabel(choice)}</span></> : 'Play'}
        </button>
      );
    } else {
      text = <>Waiting for <b>{seatLabel(g.turn)}</b>…{room.seats[seat].players.length > 1 ? ' Highlight cards to plan with your team.' : ''}</>;
    }
  }

  return (
    <div className={`action-bar ${urgent ? 'urgent' : ''}`}>
      {secs !== null && total > 0 && (
        <div className="clock" aria-label={`${secs} seconds left`}>
          <div className="clock-bar"><div key={room.deadline} className="clock-fill" style={{ animationDuration: `${Math.max(0, room.deadline! - serverNow())}ms`, ['--from' as string]: Math.min(1, (room.deadline! - serverNow()) / (total * 1000)) }} /></div>
          <span className="clock-num">{secs}s</span>
        </div>
      )}
      {text && <p className="action-text">{text}</p>}
      {button}
    </div>
  );
}
