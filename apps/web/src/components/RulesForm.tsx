import { useState } from 'react';
import { MODES, TARGET_CHOICES, TIMER_CHOICES, cardsPerSeat, type ModePreset, type Rules, type TableConfig } from '@heartsgang/engine';

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="switch" aria-hidden />
      <span className="toggle-text"><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

function Choice<T extends string | number>({ id, label, value, options, onChange, format, disabled }: { id: string; label: string; value: T; options: readonly T[]; onChange: (v: T) => void; format?: (v: T) => string; disabled?: boolean }) {
  return (
    <div className="choice">
      <span className="choice-label" id={`${id}-label`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map((o) => (
          <button type="button" key={String(o)} role="radio" aria-checked={o === value} className={o === value ? 'on' : ''} onClick={() => onChange(o)} disabled={disabled} id={`${id}-${o}`}>
            {format ? format(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A little top-down seat diagram for a mode card. */
export function SeatDiagram({ seats, maxPerSeat }: { seats: number; maxPerSeat: number }) {
  const colors = ['#e0525a', '#4c8ce6', '#35b27a', '#e9b23c', '#a371ec', '#2cc3bd'];
  return (
    <svg className="seat-diagram" viewBox="0 0 100 64" aria-hidden>
      <ellipse cx="50" cy="32" rx="30" ry="17" className="dg-table" />
      {Array.from({ length: seats }, (_, i) => {
        const a = ((180 + (i * 360) / seats) * Math.PI) / 180;
        const x = 50 + 40 * Math.sin(a);
        const y = 32 - 25 * Math.cos(a);
        return (
          <g key={i}>
            {Array.from({ length: maxPerSeat }, (_, k) => (
              <circle key={k} cx={x + (k - (maxPerSeat - 1) / 2) * 7} cy={y} r={maxPerSeat > 1 ? 4.2 : 5.2} fill={colors[i]} opacity={k === 0 ? 1 : 0.55} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function ModePicker({ table, onChange, disabled }: { table: TableConfig; onChange: (t: TableConfig) => void; disabled?: boolean }) {
  const pick = (m: ModePreset) => onChange(m.key === 'custom' ? { mode: 'custom', seats: table.seats, maxPerSeat: Math.max(2, table.maxPerSeat) } : { mode: m.key, seats: m.seats, maxPerSeat: m.maxPerSeat });
  return (
    <>
      <div className="modes" role="radiogroup" aria-label="Game mode">
        {MODES.map((m) => (
          <button key={m.key} type="button" role="radio" aria-checked={table.mode === m.key} className={`mode ${table.mode === m.key ? 'on' : ''}`} onClick={() => pick(m)} disabled={disabled} id={`mode-${m.key}`}>
            <SeatDiagram seats={m.key === 'custom' && table.mode === 'custom' ? table.seats : m.seats} maxPerSeat={m.key === 'custom' && table.mode === 'custom' ? table.maxPerSeat : m.maxPerSeat} />
            <b>{m.label}</b>
            <small>{m.blurb}</small>
          </button>
        ))}
      </div>
      {table.mode === 'custom' && (
        <div className="custom-row">
          <Choice id="seats" label="Seats at the table" value={table.seats} options={[3, 4, 5, 6] as const} onChange={(v) => onChange({ ...table, seats: v })} disabled={disabled} format={(v) => `${v} (${cardsPerSeat(v)} cards)`} />
          <Choice id="per-seat" label="Players per seat" value={table.maxPerSeat} options={[1, 2, 3] as const} onChange={(v) => onChange({ ...table, maxPerSeat: v })} disabled={disabled} format={(v) => (v === 1 ? 'Solo' : `Up to ${v}`)} />
        </div>
      )}
    </>
  );
}

export function RulesForm({ rules, onChange, disabled }: { rules: Rules; onChange: (patch: Partial<Rules>) => void; disabled?: boolean }) {
  const [more, setMore] = useState(false);
  const maxPass = Math.min(4, cardsPerSeat(rules.seats) - 1);
  const passOptions = [0, 1, 2, 3, 4].filter((x) => x <= maxPass);
  return (
    <div className="rules-form">
      <Toggle id="rule-jack" label="Jack of diamonds −10" hint="Whoever takes the J♦ subtracts 10 points." checked={rules.jackOfDiamonds} onChange={(v) => onChange({ jackOfDiamonds: v })} disabled={disabled} />
      <Choice id="rule-target" label="Play to" value={rules.target} options={TARGET_CHOICES} onChange={(v) => onChange({ target: v })} disabled={disabled} />
      <Choice id="rule-pass" label="Cards passed" value={rules.passCount} options={passOptions} onChange={(v) => onChange({ passCount: v })} disabled={disabled} format={(v) => (v === 0 ? 'None' : String(v))} />
      <Choice id="rule-moon" label="Shooting the moon" value={rules.moon} options={['addToOthers', 'subtractFromShooter', 'shooterBest', 'off'] as const} onChange={(v) => onChange({ moon: v })} disabled={disabled}
        format={(v) => ({ addToOthers: '+26 to others', subtractFromShooter: '−26 to shooter', shooterBest: 'Shooter’s best', off: 'Off' })[v]} />
      <Choice id="rule-play-timer" label="Turn timer" value={rules.playSeconds} options={TIMER_CHOICES} onChange={(v) => onChange({ playSeconds: v })} disabled={disabled} format={(v) => (v ? `${v}s` : 'Off')} />
      <Choice id="rule-pass-timer" label="Pass timer" value={rules.passSeconds} options={TIMER_CHOICES} onChange={(v) => onChange({ passSeconds: v })} disabled={disabled} format={(v) => (v ? `${v}s` : 'Off')} />
      <button type="button" className="link-btn" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? 'Fewer rules' : 'More house rules'}</button>
      {more && (
        <div className="more-rules">
          <Toggle id="rule-first" label="Points on the first trick" hint="Allow hearts and the Q♠ on trick one." checked={rules.firstTrickPoints} onChange={(v) => onChange({ firstTrickPoints: v })} disabled={disabled} />
          <Toggle id="rule-broken" label="Hearts must be broken" hint="No leading hearts until one has been played." checked={rules.heartsMustBeBroken} onChange={(v) => onChange({ heartsMustBeBroken: v })} disabled={disabled} />
          <Toggle id="rule-queen" label="Q♠ breaks hearts" checked={rules.queenBreaksHearts} onChange={(v) => onChange({ queenBreaksHearts: v })} disabled={disabled} />
          <Toggle id="rule-maria" label="Black Maria" hint="A♠ counts 7 and K♠ counts 10." checked={rules.blackMaria} onChange={(v) => onChange({ blackMaria: v })} disabled={disabled} />
          <Toggle id="rule-sun" label="Shoot the sun" hint="Win every trick and the moon doubles." checked={rules.shootTheSun} onChange={(v) => onChange({ shootTheSun: v })} disabled={disabled} />
          <Toggle id="rule-exact" label="Exactly-on-target reset" hint="Land exactly on the target and drop to 0." checked={rules.exactReset} onChange={(v) => onChange({ exactReset: v })} disabled={disabled} />
          <Toggle id="rule-forced" label="Auto-play forced cards" hint="Plays your only legal card for you." checked={rules.autoPlayForced} onChange={(v) => onChange({ autoPlayForced: v })} disabled={disabled} />
          <Choice id="rule-rotation" label="Pass rotation" value={rules.rotation} options={['standard', 'noHold', 'leftOnly'] as const} onChange={(v) => onChange({ rotation: v })} disabled={disabled}
            format={(v) => ({ standard: 'Standard', noHold: 'No hold hand', leftOnly: 'Always left' })[v]} />
        </div>
      )}
    </div>
  );
}
