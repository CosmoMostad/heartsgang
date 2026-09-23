import { useState } from 'react';
import { CardFace } from '../components/Card';
import { CodeInput } from '../components/CodeInput';
import { joinTable, session, useStore } from '../store';

export function Home({ initialCode, onCreate }: { initialCode: string; onCreate: (name: string) => void }) {
  const [name, setName] = useState(session.name());
  const [code, setCode] = useState(initialCode);
  const [nameError, setNameError] = useState(false);
  const pending = useStore((s) => s.pending);
  const status = useStore((s) => s.status);

  const needName = () => {
    if (name.trim()) return false;
    setNameError(true);
    document.getElementById('name')?.focus();
    return true;
  };
  const join = (c = code) => {
    if (needName() || c.length !== 6) return;
    joinTable(c, name.trim());
  };

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-fan" aria-hidden>
          {['2C', 'JD', 'QS', 'KH', 'AH'].map((c, i) => (
            <CardFace key={c} card={c} style={{ ['--i' as string]: i - 2 }} className="hero-card" />
          ))}
        </div>
        <h1 className="logo"><span>Hearts</span> <em>Gang</em></h1>
        <p className="tagline">Hearts with your friends. Solo, or in teams that share one hand and talk it through.</p>
      </section>

      <section className="home-panel">
        <label className="field" htmlFor="name">
          <span>Your name</span>
          <input
            id="name"
            value={name}
            maxLength={20}
            placeholder="What should the table call you?"
            onChange={(e) => { setName(e.target.value); setNameError(false); }}
            autoComplete="nickname"
            className={nameError ? 'invalid' : ''}
          />
          {nameError && <small className="field-error">Enter a name first.</small>}
        </label>

        <div className="home-actions">
          <div className="action-card create">
            <h2>Start a table</h2>
            <p>Pick the mode and house rules. You get a 6-digit code to share.</p>
            <button className="btn primary big" id="create-btn" onClick={() => { if (!needName()) { session.setName(name.trim()); onCreate(name.trim()); } }}>
              Create game
            </button>
          </div>
          <div className="or" aria-hidden>or</div>
          <form className="action-card join" onSubmit={(e) => { e.preventDefault(); join(); }}>
            <h2>Join a table</h2>
            <p>Enter the code your friend shared.</p>
            <CodeInput value={code} onChange={setCode} onComplete={(c) => { if (name.trim()) join(c); }} autoFocus={!!initialCode === false && !!session.name()} />
            <button className="btn big" id="join-btn" type="submit" disabled={code.length !== 6 || pending}>
              {pending ? 'Joining…' : 'Join game'}
            </button>
          </form>
        </div>
        {status !== 'open' && <p className="muted center">Connecting to the card room…</p>}
      </section>

      <footer className="home-foot">
        <span>No accounts, no downloads. Share the code and deal.</span>
      </footer>
    </main>
  );
}
