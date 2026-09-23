import { useState } from 'react';
import { defaultRules, normalizeRules, ruleChips, type Rules, type TableConfig } from '@heartsgang/engine';
import { ModePicker, RulesForm } from '../components/RulesForm';
import { createTable, useStore } from '../store';

export function Create({ name, onBack }: { name: string; onBack: () => void }) {
  const [table, setTable] = useState<TableConfig>({ mode: 'street', seats: 4, maxPerSeat: 2 });
  const [rules, setRules] = useState<Rules>(defaultRules(4));
  const pending = useStore((s) => s.pending);

  const changeTable = (t: TableConfig) => {
    setTable(t);
    // A new table size brings its own pass count and target.
    if (t.seats !== rules.seats) setRules(normalizeRules({ ...rules, passCount: undefined, target: undefined }, t.seats));
  };

  return (
    <main className="create">
      <header className="page-head">
        <button className="link-btn" onClick={onBack}>← Back</button>
        <h1>Set up your table</h1>
        <p className="muted">Playing as <b>{name}</b>. Everything here can be changed in the lobby before you start.</p>
      </header>

      <section className="panel">
        <h2>Mode</h2>
        <ModePicker table={table} onChange={changeTable} />
      </section>

      <section className="panel">
        <h2>House rules</h2>
        <RulesForm rules={rules} onChange={(patch) => setRules(normalizeRules({ ...rules, ...patch }, table.seats))} />
        <div className="chips">{ruleChips(rules).map((c) => <span key={c} className="chip">{c}</span>)}</div>
      </section>

      <div className="create-foot">
        <button className="btn primary big" id="create-table-btn" disabled={pending} onClick={() => createTable(name, table, rules)}>
          {pending ? 'Opening table…' : 'Create table'}
        </button>
      </div>
    </main>
  );
}
