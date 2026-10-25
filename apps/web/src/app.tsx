import { useState } from 'react';
import type { ModulePackage } from '@rb-unbound/tabletop';
import { ControlsOptions } from './controls-options';
import { loadBindings, saveBindings, type KeyBindings } from './controls';
import { loadInstalledModulePackages, saveInstalledModulePackages } from './module-library';
import { ModuleOptions } from './module-options';
import { Multiplayer } from './multiplayer';
import { Table } from './table';
import { Home } from './home';
import { Discovery } from './discovery';
import { AccountControls, AccountProvider } from './account';

type Mode = 'home' | 'local' | 'multiplayer' | 'decks' | 'discovery';

const modeLabels: Record<Mode, string> = {
  home: 'Home', local: 'Local sandbox', decks: 'Deck editor', discovery: 'Discover decks', multiplayer: 'Multiplayer alpha',
};

function NavIcon({ mode }: { mode: Mode }) {
  const paths: Record<Mode, string> = {
    home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
    local: 'M4 4h16v16H4z M4 12h16 M12 4v16',
    decks: 'M7 3h12v16H7z M4 6v15h12',
    discovery: 'M3 5h18v14H3z M7 9h10 M7 13h7',
    multiplayer: 'M16 21v-2a4 4 0 0 0-4-4H4a4 4 0 0 0-4 4v2 M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M24 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[mode]} /></svg>;
}

export function App() {
  return <AccountProvider><AppBody /></AccountProvider>;
}

function AppBody() {
  const [mode, setMode] = useState<Mode>('home');
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

  return <div className="site-shell">
    <aside className="site-rail" aria-label="Sidebar">
      <button className="site-logo" aria-label="RB Unbound home" onClick={() => setMode('home')}><span>R</span><span>B</span></button>
      <nav className="rail-nav" aria-label="Quick navigation">
        {(Object.keys(modeLabels) as Mode[]).map(item => <button key={item} className={mode === item ? 'active' : ''}
          aria-label={`Open ${modeLabels[item]} from sidebar`} title={modeLabels[item]} onClick={() => setMode(item)}><NavIcon mode={item} /></button>)}
      </nav>
      <div className="rail-bottom">
        <button title="Modules" aria-label="Open modules" onClick={() => setShowModules(true)}>◇</button>
        <button title="Options" aria-label="Open options" onClick={() => setShowControls(true)}>⚙</button>
      </div>
    </aside>

    <div className="site-workspace">
      <header className="site-topbar">
        <div className="site-identity"><span className="site-title">RB UNBOUND<span className="site-title-dot">.</span></span><span className="site-subtitle">A tabletop for your next match</span></div>
        <nav className="mode-switch" aria-label="Play mode">
          {(Object.keys(modeLabels) as Mode[]).map(item => <button key={item} className={mode === item ? 'active' : ''} aria-current={mode === item ? 'page' : undefined}
            onClick={() => setMode(item)}>{modeLabels[item]}</button>)}
        </nav>
        <div className="site-top-actions">
          {import.meta.env.BASE_URL === '/' && <AccountControls />}
          <button aria-label="Modules" title="Modules" onClick={() => setShowModules(true)}>◇</button>
          <button aria-label="Options" title="Options" onClick={() => setShowControls(true)}>⚙</button>
          <a href="https://github.com/Colddestal/RB-Unbound" target="_blank" rel="noreferrer" aria-label="View RB Unbound on GitHub" title="GitHub">↗</a>
        </div>
      </header>

      <main className="site-content">
        {mode === 'home' ? <Home moduleCount={modulePackages.length} onNavigate={setMode} />
          : mode === 'multiplayer' ? <Multiplayer bindings={bindings} modulePackages={modulePackages} />
            : mode === 'discovery' ? <Discovery modulePackages={modulePackages} onOpenEditor={() => setMode('decks')} />
            : <Table bindings={bindings} modulePackages={modulePackages} showEditor={mode === 'decks'} onOpenTable={() => setMode('local')} />}
      </main>
    </div>
    {showModules && <ModuleOptions packages={modulePackages} onChange={updateModulePackages} onClose={() => setShowModules(false)} />}
    {showControls && <ControlsOptions bindings={bindings} onChange={updateBindings} onClose={() => setShowControls(false)} />}
  </div>;
}
