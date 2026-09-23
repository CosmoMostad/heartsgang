import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cardLabel, type RoomView, type SeatView, type Trick } from '@heartsgang/engine';
import { CardBack, CardFace } from './Card';
import { serverNow, type EmoteEvent } from '../store';

/** Where seat `seat` sits, as a clock angle in degrees (0 = top), with the viewer at the bottom. */
export function seatAngle(seat: number, bottomSeat: number, n: number): number {
  const k = (seat - bottomSeat + n) % n;
  return 180 + (k * 360) / n;
}

export function seatXY(angle: number, rx: number, ry: number): { x: number; y: number } {
  const t = (angle * Math.PI) / 180;
  return { x: 50 + rx * Math.sin(t), y: 50 - ry * Math.cos(t) };
}

/** A stable little tilt per card so tricks look hand-thrown, not machine-placed. */
function tilt(card: string): number {
  let h = 0;
  for (const ch of card) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return (h % 17) - 8;
}

/** A thin bar under a seat's name that drains until the timer runs out. */
function TimerBar({ deadline, total }: { deadline: number; total: number }) {
  const remaining = Math.max(0, deadline - serverNow());
  return (
    <span className="plate-timer" aria-hidden>
      <i key={deadline} style={{ ['--from' as string]: `${Math.min(1, remaining / total)}`, animationDuration: `${remaining}ms` }} />
    </span>
  );
}

interface TableProps {
  room: RoomView;
  emotes: EmoteEvent[];
  center?: ReactNode;
}

export function Table({ room, emotes, center }: TableProps) {
  const g = room.game;
  const n = room.seats.length;
  const bottom = room.you.seat ?? 0;
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 480 });
  const [, force] = useState(0);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Re-render when a paused trick should start sweeping to its winner.
  useEffect(() => {
    if (!room.pause) return;
    const sweepAt = room.pause.until - 520 - serverNow();
    const t = setTimeout(() => force((x) => x + 1), Math.max(0, sweepAt));
    return () => clearTimeout(t);
  }, [room.pause]);

  const trick: Trick | null = room.pause ? room.pause.trick : g?.trick ?? null;
  const sweeping = !!room.pause && serverNow() >= room.pause.until - 540;
  const winnerAngle = trick?.winner !== undefined ? seatAngle(trick.winner, bottom, n) : 0;
  const wpos = seatXY(winnerAngle, 44, 44);

  const px = (dxPct: number, dyPct: number) => ({ x: (dxPct / 100) * size.w, y: (dyPct / 100) * size.h });

  return (
    <div className="table-wrap" ref={wrap}>
      <div className="rail">
        <div className="felt">
          <div className="felt-logo" aria-hidden>
            <span>Hearts</span><em>Gang</em>
          </div>
        </div>
      </div>

      {/* Cards in the middle */}
      <div className="trick">
        {trick?.plays.map((p, i) => {
          const a = seatAngle(p.seat, bottom, n);
          const at = seatXY(a, 11.5, 13.5);
          const from = seatXY(a, 46, 46);
          const fly = px(from.x - at.x, from.y - at.y);
          const sweep = px(wpos.x - at.x, wpos.y - at.y);
          const winning = trick.winner === p.seat;
          return (
            <div
              key={p.card}
              className={`trick-card ${sweeping ? 'sweep' : ''} ${winning && room.pause ? 'winning' : ''}`}
              style={{
                left: `${at.x}%`, top: `${at.y}%`, zIndex: 10 + i,
                ['--fx' as string]: `${fly.x}px`, ['--fy' as string]: `${fly.y}px`,
                ['--wx' as string]: `${sweep.x}px`, ['--wy' as string]: `${sweep.y}px`,
                ['--tilt' as string]: `${tilt(p.card)}deg`,
              }}
              title={cardLabel(p.card)}
            >
              <CardFace card={p.card} />
            </div>
          );
        })}
      </div>

      {center && <div className="table-center">{center}</div>}

      {room.seats.map((s) => (
        <Seat key={s.index} seat={s} room={room} bottom={bottom} narrow={size.w < 640} emotes={emotes.filter((e) => e.seat === s.index)} />
      ))}
    </div>
  );
}

function Seat({ seat, room, bottom, emotes, narrow }: { seat: SeatView; room: RoomView; bottom: number; emotes: EmoteEvent[]; narrow: boolean }) {
  const g = room.game;
  const n = room.seats.length;
  const angle = seatAngle(seat.index, bottom, n);
  const pos = seatXY(angle, 47, 47);
  const fanPos = seatXY(angle, narrow ? 22 : 31, narrow ? 30 : 33);
  const isMe = room.you.seat === seat.index;
  const isTurn = !!g && g.phase === 'playing' && g.turn === seat.index && !room.pause;
  const passing = g?.phase === 'passing';
  const count = g?.handCounts[seat.index] ?? 0;
  const score = g?.scores[seat.index] ?? 0;
  const pts = g?.handPoints[seat.index] ?? 0;
  const side = pos.x < 26 ? 'left' : pos.x > 74 ? 'right' : pos.y > 50 ? 'bottom' : 'top';
  const label =seat.players.length || seat.bot ? seat.label : 'Open seat';
  const away = seat.players.length > 0 && seat.players.every((p) => !p.connected);
  const total = (passing ? room.rules.passSeconds : room.rules.playSeconds) * 1000;
  const showTimer = !!room.deadline && ((isTurn && room.deadlineKind === 'play') || (passing && !g?.passed[seat.index]));

  return (
    <>
      {g && !isMe && count > 0 && (
        <div className="mini-fan" style={{ left: `${fanPos.x}%`, top: `${fanPos.y}%`, transform: `translate(-50%, -50%) rotate(${angle}deg)` }} aria-hidden>
          {Array.from({ length: Math.min(count, 9) }, (_, i) => {
            const o = i - (Math.min(count, 9) - 1) / 2;
            return <CardBack key={i} className="mini" style={{ transform: `translateX(${o * 9}px) rotate(${o * 5}deg)` }} />;
          })}
        </div>
      )}
      <div className={`seat seat-${side} ${isTurn ? 'turn' : ''} ${isMe ? 'me' : ''} ${away ? 'away' : ''}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }} data-seat={seat.index}>
        <div className="plate">
          <span className="plate-name" title={away ? `${label} (away)` : label}>{label}</span>
          {g && (
            <span className="plate-score">
              <span className="total" title="Game score">{score}</span>
              {pts > 0 && <span className="hand-pts" title="Points taken this hand">+{pts}</span>}
            </span>
          )}
          {showTimer && room.deadline && <TimerBar deadline={room.deadline} total={total} />}
          {passing && g?.passed[seat.index] && <span className="passed-badge" title="Passed">✓</span>}
        </div>
        {emotes.map((e) => (
          <span key={e.key} className="emote-bubble" title={e.name}>
            <span className="emote-glyph">{e.emote}</span>
            {seat.players.length > 1 && <span className="emote-who">{e.name}</span>}
          </span>
        ))}
      </div>
    </>
  );
}
