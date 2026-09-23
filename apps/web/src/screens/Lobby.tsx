import { useEffect, useState } from 'react';

/** True on phone-width screens, where the table is too small to hold the start button. */
function useNarrow(): boolean {
  const query = '(max-width: 760px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}
import { ruleChips, type RoomView } from '@heartsgang/engine';
import { Avatar, Table } from '../components/Table';
import { Chat } from '../components/Chat';
import { ModePicker, RulesForm } from '../components/RulesForm';
import { leaveTable, send, toast, useStore } from '../store';

export function Lobby({ room }: { room: RoomView }) {
  const emotes = useStore((s) => s.emotes);
  const [editing, setEditing] = useState(false);
  const narrow = useNarrow();
  const host = room.you.host;
  const empty = room.seats.filter((s) => !s.players.length && !s.bot);
  const link = `${location.origin}/${room.code}`;

  const startBlock = (
    <div className="lobby-center">
                {host ? (
                  <>
                    <button className="btn primary big" id="start-btn" disabled={empty.length > 0} onClick={() => send({ t: 'start' })}>Start game</button>
                    {empty.length > 0 && <p className="muted">Fill {empty.map((s) => s.colorName).join(', ')} to start{' '}
                      <button className="link-btn" onClick={() => send({ t: 'fillBots' })}>or add bots</button></p>}
                  </>
                ) : <p className="muted">Waiting for the host to start…</p>}
              </div>
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied.', 'info');
    } catch {
      toast(`Share this link: ${link}`, 'info');
    }
  };

  return (
    <main className="lobby">
      <header className="lobby-head">
        <div className="code-block">
          <span className="eyebrow">Table code</span>
          <div className="big-code" aria-label={`Code ${room.code.split('').join(' ')}`} id="table-code">
            {room.code.slice(0, 3)}<span className="gap" />{room.code.slice(3)}
          </div>
          <div className="row">
            <button className="btn small" onClick={copy}>Copy invite link</button>
            <button className="btn small ghost" onClick={leaveTable}>Leave</button>
          </div>
        </div>
        <div className="lobby-status">
          <h1>Waiting room</h1>
          <p className="muted">Friends join at <b>{location.host}</b> with the code. Sit in a seat to play; sit with a friend to share their hand as a team.</p>
          <div className="chips">{ruleChips(room.rules).map((c) => <span key={c} className="chip">{c}</span>)}</div>
        </div>
      </header>

      <div className="lobby-body">
        <section className="lobby-table">
          <Table room={room} emotes={emotes} center={narrow ? undefined : startBlock} />
          {narrow && <div className="lobby-center-below">{startBlock}</div>}

          <div className="seat-list">
            {room.seats.map((s) => {
              const mine = room.you.seat === s.index;
              const room_ = s.players.length < room.table.maxPerSeat;
              return (
                <div key={s.index} className={`seat-card ${mine ? 'mine' : ''}`} style={{ ['--seat' as string]: s.color }}>
                  <div className="seat-card-head">
                    <span className="seat-dot" style={{ background: s.color }} />
                    <b>{s.colorName}</b>
                    <small>{room.table.maxPerSeat > 1 ? `${s.players.length}/${room.table.maxPerSeat}` : ''}</small>
                  </div>
                  <ul>
                    {s.players.map((p) => (
                      <li key={p.id}>
                        <Avatar name={p.name} color={p.color} connected={p.connected} size={26} />
                        <span>{p.name}{p.host && <em className="host-tag">host</em>}{p.id === room.you.id && <em className="you-tag">you</em>}</span>
                        {host && p.id !== room.you.id && <button className="icon-btn" title={`Remove ${p.name}`} onClick={() => send({ t: 'kick', playerId: p.id })}>✕</button>}
                      </li>
                    ))}
                    {s.bot && <li><Avatar name={s.bot} color={s.color} bot size={26} /><span>{s.bot}</span>{host && <button className="icon-btn" title="Remove bot" onClick={() => send({ t: 'bot', seat: s.index, on: false })}>✕</button>}</li>}
                    {!s.players.length && !s.bot && <li className="muted">Empty seat</li>}
                  </ul>
                  <div className="seat-card-actions">
                    {!mine && (room_ || s.bot) && (
                      <button className="btn small" data-join-seat={s.index} onClick={() => send({ t: 'sit', seat: s.index })}>
                        {s.players.length ? `Team up with ${s.players.map((p) => p.name).join(' & ')}` : s.bot ? 'Take this seat' : 'Sit here'}
                      </button>
                    )}
                    {mine && <button className="btn small ghost" onClick={() => send({ t: 'stand' })}>Stand up</button>}
                    {host && !s.players.length && !s.bot && <button className="btn small ghost" onClick={() => send({ t: 'bot', seat: s.index, on: true })}>Add bot</button>}
                  </div>
                </div>
              );
            })}
          </div>
          {room.spectators.length > 0 && (
            <p className="watchers"><b>Not seated:</b> {room.spectators.map((p) => p.name).join(', ')}</p>
          )}
        </section>

        <aside className="lobby-side">
          {host && (
            <section className="panel">
              <div className="panel-head">
                <h2>Mode and rules</h2>
                <button className="link-btn" onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Edit'}</button>
              </div>
              {editing ? (
                <>
                  <ModePicker table={room.table} onChange={(t) => send({ t: 'config', table: t })} />
                  <RulesForm rules={room.rules} onChange={(patch) => send({ t: 'config', rules: patch })} />
                </>
              ) : <p className="muted">Only you can change these. Everyone sees the chips up top.</p>}
            </section>
          )}
          <Chat room={room} />
        </aside>
      </div>
    </main>
  );
}
