import { useEffect, useState } from 'react';
import { connect, useStore } from './store';
import { Home } from './screens/Home';
import { Create } from './screens/Create';
import { Lobby } from './screens/Lobby';
import { Game } from './screens/Game';
import { Toasts } from './components/Toasts';

function codeFromPath(): string {
  const m = location.pathname.match(/^\/(\d{6})\/?$/);
  return m ? m[1] : '';
}

export function App() {
  const room = useStore((s) => s.room);
  const [creating, setCreating] = useState<string | null>(null);
  const [initialCode] = useState(codeFromPath);

  useEffect(() => { connect(); }, []);
  useEffect(() => { if (room) setCreating(null); }, [room]);

  let screen;
  if (room?.phase === 'game' && room.game) screen = <Game room={room} />;
  else if (room) screen = <Lobby room={room} />;
  else if (creating !== null) screen = <Create name={creating} onBack={() => setCreating(null)} />;
  else screen = <Home initialCode={initialCode} onCreate={(n) => setCreating(n)} />;

  return (
    <>
      <div className="room-bg" aria-hidden />
      {screen}
      <Toasts />
    </>
  );
}
