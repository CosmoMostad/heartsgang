import { useRef } from 'react';

/** Six separate digit boxes that behave like one input, including paste. */
export function CodeInput({ value, onChange, onComplete, autoFocus }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  const setAt = (i: number, d: string) => {
    const arr = value.padEnd(6, ' ').slice(0, 6).split('');
    arr[i] = d;
    const next = arr.join('').replace(/\s+$/, '').replace(/\s/g, '');
    onChange(next);
    if (next.length === 6) onComplete?.(next);
  };
  return (
    <div className="code-input" role="group" aria-label="6-digit game code">
      {digits.map((d, i) => (
        <input
          key={i}
          id={`code-${i}`}
          ref={(el) => { refs.current[i] = el; }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={`Digit ${i + 1}`}
          value={d.trim()}
          autoFocus={autoFocus && i === 0}
          maxLength={1}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) return;
            if (v.length > 1) {
              const all = (value.slice(0, i) + v).replace(/\D/g, '').slice(0, 6);
              onChange(all);
              refs.current[Math.min(5, all.length)]?.focus();
              if (all.length === 6) onComplete?.(all);
              return;
            }
            setAt(i, v);
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (d.trim()) setAt(i, ' ');
              else if (i > 0) { refs.current[i - 1]?.focus(); setAt(i - 1, ' '); }
            } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            const v = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
            if (!v) return;
            e.preventDefault();
            onChange(v);
            refs.current[Math.min(5, v.length)]?.focus();
            if (v.length === 6) onComplete?.(v);
          }}
        />
      ))}
    </div>
  );
}
