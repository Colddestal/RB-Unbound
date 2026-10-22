import { useRef, useState } from 'react';
import { applyAction, initialTable, isTableState, type TableState } from '@rb-unbound/tabletop';

export function Table() {
  const [table, setTable] = useState<TableState>(() => structuredClone(initialTable));
  const [selected, setSelected] = useState<string>('sample-1');
  const fileRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const execute = (action: Parameters<typeof applyAction>[1]) => setTable(s => applyAction(s, action));
  const save = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(table, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rb-unbound-table.json'; anchor.click(); URL.revokeObjectURL(url);
  };
  const load = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 200_000) throw Error('File too large');
      const parsed: unknown = JSON.parse(await file.text());
      if (!isTableState(parsed)) throw Error('Invalid table file');
      setTable(parsed); setError('');
    } catch { setError('Could not load this table file.'); }
  };
  return <div className="app">
    <header><div><span className="eyebrow">PROJECT POOR PRESENTS</span><h1>RB UNBOUND</h1><p>Manual tabletop alpha · Original placeholder cards</p></div><a href="https://github.com/Colddestal/RB-Unbound" target="_blank" rel="noreferrer">View GitHub ↗</a></header>
    <section className="toolbar"><strong>Local Sandbox</strong><span className="chip">No automatic rules</span><button onClick={() => execute({ type: 'rotate', id: selected })}>Rotate selected</button><button onClick={() => execute({ type: 'flip', id: selected })}>Flip selected</button><button onClick={save}>Export JSON</button><button onClick={() => fileRef.current?.click()}>Import JSON</button><button onClick={() => execute({ type: 'reset' })}>Reset</button><input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => {void load(e.target.files?.[0]);e.target.value='';}}/></section>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="board" ref={boardRef} aria-label="Tabletop board">
      <div className="zone zone-top">PLAYER TWO — MANUAL AREA</div><div className="zone zone-bottom">PLAYER ONE — MANUAL AREA</div>
      {table.cards.map(card => <button key={card.id} aria-label={`${card.label}, ${card.faceUp ? 'face up' : 'face down'}`} aria-pressed={selected === card.id} className={`card ${selected === card.id ? 'selected' : ''} ${card.faceUp ? '' : 'back'}`} style={{left:`${card.x/10}%`,top:`${card.y/6}%`,transform:`rotate(${card.rotation}deg)`}}
        onClick={() => setSelected(card.id)}
        onPointerDown={e => { if (e.button !== 0) return; setSelected(card.id); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const rect = boardRef.current?.getBoundingClientRect(); if (!rect) return; execute({type:'move',id:card.id,x:((e.clientX-rect.left-43)/rect.width)*1000,y:((e.clientY-rect.top-58)/rect.height)*600}); }}>
        <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span><span>{card.faceUp ? card.label : 'Hidden card'}</span><small>Player {card.owner}</small>
      </button>)}
    </div>
    <footer>Drag to move · Click to select · Rotate and flip with toolbar · Local-only demo. Multiplayer and authorized game modules are future milestones.</footer>
  </div>;
}
