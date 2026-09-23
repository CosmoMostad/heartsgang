import { useEffect, useState } from 'react';
import { cardLabel, type RoomView } from '@heartsgang/engine';
import { CardFace } from './Card';
import { send, serverNow } from '../store';

function SeatDot({ color }: { color: string }) {
  return <span className="seat-dot" style={{ background: color }} />;
}

export function HandSummary({ room }: { room: RoomView }) {
  const g = room.game!;
  const r = g.history[g.history.length - 1];
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(t); }, []);
  if (!r) return null;
  const left = room.nextHandAt ? Math.max(0, Math.ceil((room.nextHandAt - serverNow()) / 1000)) : null;
  const order = room.seats.map((s) => s.index).sort((a, b) => g.scores[a] - g.scores[b]);
  return (
    <div className="panel summary" role="dialog" aria-label={`Hand ${r.hand} results`}>
      <h3>Hand {r.hand}</h3>
      {r.moon !== null && <div className="moon-banner">🌙 {room.seats[r.moon].label} shot the {r.sun ? 'sun' : 'moon'}!</div>}
      <table className="score-table">
        <thead><tr><th>Seat</th><th>This hand</th><th>Total</th></tr></thead>
        <tbody>
          {order.map((i) => (
            <tr key={i}>
              <td><SeatDot color={room.seats[i].color} />{room.seats[i].label}</td>
              <td className={r.scored[i] > 0 ? 'bad' : r.scored[i] < 0 ? 'good' : ''}>{r.scored[i] > 0 ? '+' : ''}{r.scored[i]}</td>
              <td className="num">{g.scores[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="summary-foot">
        {left !== null && <span>Next hand in {left}s · playing to {room.rules.target}</span>}
        {room.you.host && <button className="btn small" onClick={() => send({ t: 'dealNow' })}>Deal now</button>}
      </div>
    </div>
  );
}

export function GameOver({ room }: { room: RoomView }) {
  const g = room.game!;
  const order = room.seats.map((s) => s.index).sort((a, b) => g.scores[a] - g.scores[b]);
  const names = g.winners.map((w) => room.seats[w].label).join(' and ');
  const iWon = room.you.seat !== null && g.winners.includes(room.you.seat);
  return (
    <div className="panel gameover" role="dialog" aria-label="Game over">
      <div className="confetti" aria-hidden>
        {Array.from({ length: 40 }, (_, i) => (
          <i key={i} style={{ ['--i' as string]: i, left: `${(i * 37) % 100}%`, animationDelay: `${(i * 53) % 900}ms`, animationDuration: `${2200 + ((i * 71) % 1400)}ms` }} />
        ))}
      </div>
      <div className="trophy">🏆</div>
      <h3>{iWon ? 'You win!' : `${names} ${g.winners.length > 1 ? 'win' : 'wins'}!`}</h3>
      <ol className="standings">
        {order.map((i, place) => (
          <li key={i} className={g.winners.includes(i) ? 'winner' : ''}>
            <span className="place">{place + 1}</span><SeatDot color={room.seats[i].color} /><span className="who">{room.seats[i].label}</span><span className="num">{g.scores[i]}</span>
          </li>
        ))}
      </ol>
      {room.you.host ? (
        <div className="row center">
          <button className="btn primary" onClick={() => send({ t: 'playAgain' })}>Play again</button>
          <button className="btn" onClick={() => send({ t: 'toLobby' })}>Change seats or rules</button>
        </div>
      ) : <p className="muted">Waiting for the host to start the next game.</p>}
    </div>
  );
}

export function Scoreboard({ room, onClose }: { room: RoomView; onClose: () => void }) {
  const g = room.game!;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel modal" role="dialog" aria-label="Scoreboard" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Scoreboard</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="table-scroll">
          <table className="score-table grid">
            <thead>
              <tr><th>Hand</th>{room.seats.map((s) => <th key={s.index}><SeatDot color={s.color} />{s.label}</th>)}</tr>
            </thead>
            <tbody>
              {g.history.map((h) => (
                <tr key={h.hand}>
                  <td>{h.hand}{h.moon !== null ? ' 🌙' : ''}</td>
                  {h.scored.map((x, i) => <td key={i} className={`num ${h.moon === i ? 'good' : ''}`}>{x > 0 ? '+' : ''}{x}</td>)}
                </tr>
              ))}
              {g.history.length === 0 && <tr><td colSpan={room.seats.length + 1} className="muted">No hands finished yet.</td></tr>}
            </tbody>
            <tfoot>
              <tr><th>Total</th>{g.scores.map((x, i) => <th key={i} className="num">{x}</th>)}</tr>
            </tfoot>
          </table>
        </div>
        <p className="muted">Playing to {room.rules.target}. Lowest score wins.</p>
        {room.you.host && (
          <div className="row">
            <button className="btn small danger" onClick={() => { if (confirm('End this game for everyone and go back to the lobby?')) { send({ t: 'toLobby' }); onClose(); } }}>End game for everyone</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function LastTrick({ room, onClose }: { room: RoomView; onClose: () => void }) {
  const t = room.game?.lastTrick;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel modal small" role="dialog" aria-label="Last trick" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Last trick</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        {!t ? <p className="muted">No tricks played yet this hand.</p> : (
          <>
            <div className="last-trick">
              {t.plays.map((p) => (
                <figure key={p.card} className={p.seat === t.winner ? 'won' : ''}>
                  <CardFace card={p.card} />
                  <figcaption>{room.seats[p.seat].label}</figcaption>
                </figure>
              ))}
            </div>
            <p className="muted">{room.seats[t.winner!].label} took it{t.plays.some((p) => /H$/.test(p.card) || p.card === 'QS') ? ` with ${t.plays.filter((p) => /H$/.test(p.card) || p.card === 'QS').map((p) => cardLabel(p.card)).join(' ')}` : ''}.</p>
          </>
        )}
      </div>
    </div>
  );
}
