import { useStore } from '../store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const status = useStore((s) => s.status);
  return (
    <div className="toasts" aria-live="assertive">
      {status === 'closed' && <div className="toast info">Reconnecting…</div>}
      {toasts.map((t) => <div key={t.key} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}
