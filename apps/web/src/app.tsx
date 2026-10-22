import { useState } from 'react';
import { Multiplayer } from './multiplayer';
import { Table } from './table';

export function App() {
  const [mode, setMode] = useState<'local' | 'multiplayer'>('local');
  return <>
    <nav className="mode-switch" aria-label="Play mode">
      <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>Local sandbox</button>
      <button className={mode === 'multiplayer' ? 'active' : ''} onClick={() => setMode('multiplayer')}>Multiplayer alpha</button>
    </nav>
    {mode === 'local' ? <Table /> : <Multiplayer />}
  </>;
}
