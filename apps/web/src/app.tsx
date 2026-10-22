import { useState } from 'react';
import { ControlsOptions } from './controls-options';
import { loadBindings, saveBindings, type KeyBindings } from './controls';
import { Multiplayer } from './multiplayer';
import { Table } from './table';

export function App() {
  const [mode, setMode] = useState<'local' | 'multiplayer'>('local');
  const [bindings, setBindings] = useState<KeyBindings>(() => loadBindings());
  const [showControls, setShowControls] = useState(false);

  const updateBindings = (next: KeyBindings) => {
    setBindings(next);
    saveBindings(next);
  };

  return <>
    <nav className="mode-switch" aria-label="Play mode">
      <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>Local sandbox</button>
      <button className={mode === 'multiplayer' ? 'active' : ''} onClick={() => setMode('multiplayer')}>Multiplayer alpha</button>
      <button onClick={() => setShowControls(true)}>Options</button>
    </nav>

    {mode === 'local' ? <Table bindings={bindings} /> : <Multiplayer bindings={bindings} />}

    {showControls && <ControlsOptions bindings={bindings} onChange={updateBindings} onClose={() => setShowControls(false)} />}
  </>;
}
