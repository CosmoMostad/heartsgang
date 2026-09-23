import { useEffect, useMemo, useRef, useState } from 'react';
import { EMOTES, type ChatMsg, type RoomView } from '@heartsgang/engine';
import { send } from '../store';

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function Messages({ list, myId }: { list: ChatMsg[]; myId: string }) {
  const box = useRef<HTMLDivElement>(null);
  const last = list[list.length - 1]?.id;
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);
  return (
    <div className="messages" ref={box} role="log" aria-live="polite">
      {list.length === 0 && <p className="empty-chat">No messages yet. Say hi.</p>}
      {list.map((m) =>
        m.from === null ? (
          <p key={m.id} className="msg system">{m.text}</p>
        ) : (
          <p key={m.id} className={`msg ${m.from === myId ? 'mine' : ''}`}>
            <b style={{ color: m.color }}>{m.name}</b>
            <span className="msg-text">{m.text}</span>
            <time>{time(m.at)}</time>
          </p>
        ),
      )}
    </div>
  );
}

export function EmoteBar({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`emote-bar ${compact ? 'compact' : ''}`} role="toolbar" aria-label="Emotes">
      {EMOTES.map((e) => (
        <button key={e} className="emote-btn" onClick={() => send({ t: 'emote', emote: e })} aria-label={`Send ${e}`}>{e}</button>
      ))}
    </div>
  );
}

export function Chat({ room, onUnread }: { room: RoomView; onUnread?: (n: number) => void }) {
  const mySeat = room.you.seat;
  const hasTeam = mySeat !== null && room.seats[mySeat]?.players.length > 1;
  const [tab, setTab] = useState<'table' | 'team'>('table');
  const [text, setText] = useState('');
  const [seen, setSeen] = useState({ table: 0, team: 0 });
  const active = tab === 'team' && hasTeam ? 'team' : 'table';
  const list = active === 'team' ? room.teamChat : room.chat;

  const lastTable = room.chat[room.chat.length - 1]?.id ?? 0;
  const lastTeam = room.teamChat[room.teamChat.length - 1]?.id ?? 0;
  useEffect(() => {
    setSeen((s) => (active === 'team' ? { ...s, team: lastTeam } : { ...s, table: lastTable }));
  }, [active, lastTable, lastTeam]);

  const unread = useMemo(() => ({
    table: room.chat.filter((m) => m.id > seen.table && m.from !== null && m.from !== room.you.id).length,
    team: room.teamChat.filter((m) => m.id > seen.team && m.from !== room.you.id).length,
  }), [room.chat, room.teamChat, seen, room.you.id]);

  useEffect(() => { onUnread?.(unread.table + unread.team); }, [unread.table, unread.team, onUnread]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send({ t: 'chat', text: t, scope: active });
    setText('');
  };

  return (
    <section className="chat" aria-label="Chat">
      <div className="chat-tabs" role="tablist">
        <button role="tab" aria-selected={active === 'table'} className={active === 'table' ? 'on' : ''} onClick={() => setTab('table')}>
          Table {active !== 'table' && unread.table > 0 && <span className="badge">{unread.table}</span>}
        </button>
        {hasTeam && (
          <button role="tab" aria-selected={active === 'team'} className={active === 'team' ? 'on team' : 'team'} onClick={() => setTab('team')} style={{ ['--seat' as string]: room.seats[mySeat!].color }}>
            Team {active !== 'team' && unread.team > 0 && <span className="badge">{unread.team}</span>}
          </button>
        )}
      </div>
      {active === 'team' && <p className="team-note">Only {room.seats[mySeat!].label} can see this.</p>}
      <Messages list={list} myId={room.you.id} />
      <EmoteBar />
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          id="chat-input"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder={active === 'team' ? 'Message your team…' : 'Message the table…'}
          autoComplete="off"
        />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}
