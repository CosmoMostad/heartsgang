import { memo, type CSSProperties } from 'react';
import { SUIT_SYMBOL, suitOf, type Card as CardId } from '@heartsgang/engine';

/** Pip positions (x%, y%) inside the card's pip box, following a real deck's layouts. */
const PIPS: Record<string, [number, number][]> = {
  '2': [[50, 8], [50, 92]],
  '3': [[50, 8], [50, 50], [50, 92]],
  '4': [[26, 8], [74, 8], [26, 92], [74, 92]],
  '5': [[26, 8], [74, 8], [50, 50], [26, 92], [74, 92]],
  '6': [[26, 8], [74, 8], [26, 50], [74, 50], [26, 92], [74, 92]],
  '7': [[26, 8], [74, 8], [50, 29], [26, 50], [74, 50], [26, 92], [74, 92]],
  '8': [[26, 8], [74, 8], [50, 29], [26, 50], [74, 50], [50, 71], [26, 92], [74, 92]],
  '9': [[26, 8], [74, 8], [26, 36], [74, 36], [50, 50], [26, 64], [74, 64], [26, 92], [74, 92]],
  T: [[26, 8], [74, 8], [50, 22], [26, 36], [74, 36], [26, 64], [74, 64], [50, 78], [26, 92], [74, 92]],
};

const FACE_GLYPH: Record<string, string> = { J: '⚜', Q: '♛', K: '♚' };

export interface CardProps {
  card: CardId;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export const CardFace = memo(function CardFace({ card, className = '', style, title }: CardProps) {
  const rank = card[0];
  const suit = suitOf(card);
  const sym = SUIT_SYMBOL[suit];
  const red = suit === 'H' || suit === 'D';
  const label = rank === 'T' ? '10' : rank;
  const face = rank === 'J' || rank === 'Q' || rank === 'K';
  return (
    <div className={`card face ${red ? 'red' : 'black'} ${face ? 'court' : ''} ${card === 'QS' ? 'lady' : ''} ${className}`} style={style} title={title} data-card={card}>
      <span className="idx tl"><b>{label}</b><i>{sym}</i></span>
      <span className="idx br"><b>{label}</b><i>{sym}</i></span>
      {rank === 'A' && <span className={`ace ${suit === 'S' ? 'spade' : ''}`}>{sym}</span>}
      {PIPS[rank] && (
        <span className="pips">
          {PIPS[rank].map(([x, y], i) => (
            <i key={i} style={{ left: `${x}%`, top: `${y}%` }} className={y > 55 ? 'flip' : ''}>{sym}</i>
          ))}
        </span>
      )}
      {face && (
        <span className="courtframe">
          <span className="glyph">{FACE_GLYPH[rank]}</span>
          <span className="courtletter">{label}</span>
          <span className="courtsuit">{sym}</span>
        </span>
      )}
    </div>
  );
});

export const CardBack = memo(function CardBack({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`card back ${className}`} style={style} aria-hidden>
      <span className="emblem">♥</span>
    </div>
  );
});
