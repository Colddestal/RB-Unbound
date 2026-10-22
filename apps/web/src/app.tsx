import { useState } from 'react';
import type { ModulePackage } from '@rb-unbound/tabletop';
import { ControlsOptions } from './controls-options';
import { loadBindings, saveBindings, type KeyBindings } from './controls';
import { loadInstalledModulePackages, saveInstalledModulePackages } from './module-library';
import { ModuleOptions } from './module-options';
import { Multiplayer } from './multiplayer';
import { Table } from './table';

export function App() {
  const [mode, setMode] = useState<'local' | 'multiplayer'>('local');
  const [bindings, setBindings] = useState<KeyBindings>(() => loadBindings());
  const [modulePackages, setModulePackages] = useState<ModulePackage[]>(() => loadInstalledModulePackages());
  const [showControls, setShowControls] = useState(false);
  const [showModules, setShowModules] = useState(false);

  const updateBindings = (next: KeyBindings) => {
    setBindings(next);
    saveBindings(next);
  };

  const updateModulePackages = (next: ModulePackage[]) => {
    setModulePackages(next);
    saveInstalledModulePackages(next);
  };

  return <>
    <nav className="mode-switch" aria-label="Play mode">
      <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>Local sandbox</button>
      <button className={mode === 'multiplayer' ? 'active' : ''} onClick={() => setMode('multiplayer')}>Multiplayer alpha</button>
      <button onClick={() => setShowModules(true)}>Modules</button>
      <button onClick={() => setShowControls(true)}>Options</button>
    </nav>

    {mode === 'local'
      ? <Table bindings={bindings} modulePackages={modulePackages} />
      : <Multiplayer bindings={bindings} modulePackages={modulePackages} />}

    {showModules && <ModuleOptions packages={modulePackages} onChange={updateModulePackages} onClose={() => setShowModules(false)} />}
    {showControls && <ControlsOptions bindings={bindings} onChange={updateBindings} onClose={() => setShowControls(false)} />}
  </>;
}
