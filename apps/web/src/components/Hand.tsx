import { useLayoutEffect, useRef, useState } from 'react';
import { cardLabel, type Card } from '@heartsgang/engine';
import { CardFace } from './Card';

export interface Marker { id: string; name: string; color: string }

interface Props {
  cards: Card[];
  /** Who highlighted each card (teammates included). */
  marks: Record<string, Marker[]>;
  myId: string;
  /** Cards that can be played now; null = not restricting (passing or not our turn). */
  legal: Set<Card> | null;
  received: Set<Card>;
  onToggle: (card: Card) => void;
  disabled?: boolean;
  dealKey: string;
}

export function Hand({ cards, marks, myId, legal, received, onToggle, disabled, dealKey }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = cards.length;
  const cw = Math.round(Math.max(56, Math.min(108, width / 7.2, (window.innerHeight || 800) / 7.6)));
  const ch = Math.round(cw * 1.4);
  const maxStep = cw * 0.66;
  const step = n > 1 ? Math.min(maxStep, (width - cw * 1.3 - 16) / (n - 1)) : 0;
  const rot = Math.min(3.2, 34 / Math.max(n, 1));
  const curve = Math.min(1.3, 15 / Math.max(n, 1));
  // How far the outermost cards dip, so the fan never spills past the bottom edge.
  const drop = ((n - 1) / 2) ** 2 * curve + Math.sin((((n - 1) / 2) * rot * Math.PI) / 180) * cw * 0.5;

  return (
    <div className="hand" ref={ref} style={{ height: ch + 40 + drop, ['--cw' as string]: `${cw}px`, ['--lift' as string]: `${Math.round(drop) + 8}px` }}>
      {cards.map((c, i) => {
        const o = i - (n - 1) / 2;
        const who = marks[c] ?? [];
        const mine = who.some((m) => m.id === myId);
        const raised = who.length > 0;
        const illegal = legal !== null && !legal.has(c);
        const ring = who.map((m, k) => `0 0 0 ${3 + k * 3}px ${m.color}`).join(', ');
        const style = {
          left: `calc(50% + ${o * step}px - ${cw / 2}px)`,
          transform: `translateY(${o * o * curve - (raised ? 26 : 0)}px) rotate(${o * rot}deg)`,
          zIndex: i + 1,
          ['--deal-delay' as string]: `${i * 35}ms`,
          boxShadow: raised ? `${ring}, 0 14px 26px rgba(0,0,0,.45)` : undefined,
        };
        return (
          <button
            key={`${dealKey}-${c}`}
            className={`hand-card ${raised ? 'raised' : ''} ${mine ? 'mine' : ''} ${illegal ? 'illegal' : ''}`}
            style={style}
            onClick={() => !disabled && onToggle(c)}
            disabled={disabled}
            aria-pressed={raised}
            aria-label={`${cardLabel(c)}${raised ? `, highlighted by ${who.map((w) => w.name).join(' and ')}` : ''}${illegal ? ', not playable now' : ''}`}
          >
            <CardFace card={c} />
            {received.has(c) && <span className="new-tag">new</span>}
            {who.length > 0 && (
              <span className="markers">
                {who.map((m) => (
                  <span key={m.id} className="marker" style={{ background: m.color }} title={m.name}>{m.name.slice(0, 1).toUpperCase()}</span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
