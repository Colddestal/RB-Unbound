import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  applyAction,
  canManipulate,
  initialTable,
  isTableState,
  type Card,
  type PlayerId,
  type TableState,
} from '@rb-unbound/tabletop';

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function Table() {
  const [table, setTable] = useState<TableState>(() => structuredClone(initialTable));
  const [viewer, setViewer] = useState<PlayerId>(1);
  const [selected, setSelected] = useState<string>('');
  const [stackTarget, setStackTarget] = useState<string>('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const execute = (action: Parameters<typeof applyAction>[1]) => setTable(state => applyAction(state, action));
  const selectedCard = table.cards.find(card => card.id === selected);
  const ownFieldCards = table.cards.filter(card => card.owner === viewer && card.zone === 'field' && card.id !== selected);

  const cardsByPlayer = useMemo(() => ({
    1: table.cards.filter(card => card.owner === 1),
    2: table.cards.filter(card => card.owner === 2),
  }), [table.cards]);

  const save = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(table, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'rb-unbound-table-v3.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const load = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 250_000) throw Error('File too large');
      const parsed: unknown = JSON.parse(await file.text());
      if (!isTableState(parsed)) throw Error('Invalid table file');
      setTable(parsed);
      setSelected('');
      setStackTarget('');
      setError('');
    } catch {
      setError('Could not load this table file. Alpha v3 table files are required.');
    }
  };

  const shuffleDeck = (player: PlayerId) => {
    const ids = table.cards
      .filter(card => card.owner === player && card.zone === 'deck')
      .sort((a, b) => a.order - b.order)
      .map(card => card.id);
    execute({ type: 'shuffle', player, orderedIds: shuffled(ids) });
  };

  const moveSelected = (zone: Card['zone']) => {
    if (!selectedCard || selectedCard.owner !== viewer) return;
    execute({ type: 'to-zone', id: selectedCard.id, zone, actor: viewer });
    if (zone !== 'field') setStackTarget('');
  };

  const renderCard = (card: Card, index: number, collection: Card[], mode: 'hand' | 'field' | 'discard') => {
    const owned = canManipulate(card, viewer);
    const hidden = card.zone === 'hand' && card.owner !== viewer;
    const faceVisible = !hidden && card.faceUp;
    const style: CSSProperties = {};

    if (mode === 'field') {
      const target = card.stackOn ? table.cards.find(item => item.id === card.stackOn) : undefined;
      style.left = `${((target?.x ?? card.x) / 10)}%`;
      style.top = `${((target?.y ?? card.y) / 6)}%`;
      style.transform = `translate(${target ? 9 : 0}px, ${target ? 9 : 0}px) rotate(${card.rotation}deg)`;
      style.zIndex = target ? 4 : 3;
    }

    if (mode === 'hand') {
      const spread = Math.min(58, Math.max(27, 650 / Math.max(collection.length, 1)));
      const width = Math.min(680, collection.length * spread + 55);
      const start = 50 - width / 2 / 10;
      style.left = `calc(${start}% + ${index * spread}px)`;
      style.top = card.owner === 2 ? '4px' : 'calc(100% - 108px)';
      style.transform = `rotate(${card.owner === 2 ? 180 : 0}deg)`;
      style.zIndex = 20 + index;
    }

    if (mode === 'discard') {
      style.left = card.owner === 1 ? 'calc(100% - 188px)' : '102px';
      style.top = card.owner === 1 ? 'calc(100% - 172px)' : '55px';
      style.transform = `translate(${index * 2}px,${index * 2}px) rotate(${card.rotation}deg)`;
      style.zIndex = 8 + index;
    }

    return <button
      key={card.id}
      aria-label={`${faceVisible ? card.label : 'Hidden card'}, Player ${card.owner}`}
      aria-pressed={selected === card.id}
      className={`card ${selected === card.id ? 'selected' : ''} ${faceVisible ? '' : 'back'} ${owned ? '' : 'locked'}`}
      style={style}
      onClick={() => { if (owned || mode === 'field') setSelected(card.id); }}
      onDoubleClick={() => { if (owned && mode === 'hand') execute({ type: 'to-zone', id: card.id, zone: 'field', actor: viewer }); }}
      onPointerDown={event => {
        if (!owned || mode !== 'field' || event.button !== 0) return;
        setSelected(card.id);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!owned || mode !== 'field' || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return;
        execute({
          type: 'move',
          id: card.id,
          actor: viewer,
          x: ((event.clientX - rect.left - 43) / rect.width) * 1000,
          y: ((event.clientY - rect.top - 58) / rect.height) * 600,
        });
      }}
    >
      <span className="card-symbol">{faceVisible ? '✦' : '◆'}</span>
      <span>{faceVisible ? card.label : 'Hidden card'}</span>
      <small>P{card.owner} · {card.zone}</small>
    </button>;
  };

  const renderPlayer = (player: 1 | 2) => {
    const cards = cardsByPlayer[player];
    const deck = cards.filter(card => card.zone === 'deck').sort((a, b) => a.order - b.order);
    const hand = cards.filter(card => card.zone === 'hand').sort((a, b) => a.order - b.order);
    const field = cards.filter(card => card.zone === 'field');
    const discard = cards.filter(card => card.zone === 'discard').sort((a, b) => a.order - b.order);
    const active = viewer === player;

    return <>
      <div className={`zone-label player-${player}`}>PLAYER {player} {active ? '· ACTIVE VIEW' : ''}</div>
      <div className={`deck-zone deck-${player}`}>
        <div className="pile-card">◆<strong>DECK</strong><span>{deck.length} cards</span></div>
        {active && <div className="pile-actions">
          <button disabled={!deck.length} onClick={() => execute({ type: 'draw', player })}>Draw</button>
          <button disabled={deck.length < 2} onClick={() => shuffleDeck(player)}>Shuffle</button>
        </div>}
      </div>
      <div className={`discard-zone discard-${player}`}><span>DISCARD · {discard.length}</span></div>
      {discard.slice(-6).map((card, index) => renderCard(card, index, discard, 'discard'))}
      {hand.map((card, index) => renderCard(card, index, hand, 'hand'))}
      {field.map((card, index) => renderCard(card, index, field, 'field'))}
    </>;
  };

  return <div className="app">
    <header>
      <div><span className="eyebrow">PROJECT POOR PRESENTS</span><h1>RB UNBOUND</h1><p>Manual tabletop alpha · Decks, hands, discard and stacks</p></div>
      <a href="https://github.com/Colddestal/RB-Unbound" target="_blank" rel="noreferrer">View GitHub ↗</a>
    </header>

    <section className="viewer-bar">
      <strong>Local player view</strong>
      <button className={viewer === 1 ? 'active' : ''} onClick={() => { setViewer(1); setSelected(''); }}>Player 1</button>
      <button className={viewer === 2 ? 'active' : ''} onClick={() => { setViewer(2); setSelected(''); }}>Player 2</button>
      <span className="chip">Opponent hand stays hidden</span>
    </section>

    <section className="toolbar">
      <strong>{selectedCard ? `Selected: ${selectedCard.owner === viewer ? selectedCard.label : 'Opponent card'}` : 'Select one of your cards'}</strong>
      <button disabled={!selectedCard || selectedCard.owner !== viewer} onClick={() => selectedCard && execute({ type: 'rotate', id: selectedCard.id, actor: viewer })}>Rotate</button>
      <button disabled={!selectedCard || selectedCard.owner !== viewer} onClick={() => selectedCard && execute({ type: 'flip', id: selectedCard.id, actor: viewer })}>Flip</button>
      <button disabled={!selectedCard || selectedCard.owner !== viewer} onClick={() => moveSelected('hand')}>To hand</button>
      <button disabled={!selectedCard || selectedCard.owner !== viewer} onClick={() => moveSelected('field')}>To field</button>
      <button disabled={!selectedCard || selectedCard.owner !== viewer} onClick={() => moveSelected('discard')}>Discard</button>
      <button disabled={!selectedCard || selectedCard.owner !== viewer} onClick={() => moveSelected('deck')}>To deck</button>
      <select value={stackTarget} onChange={e => setStackTarget(e.target.value)} disabled={!selectedCard || selectedCard.zone !== 'field'}>
        <option value="">Stack target…</option>
        {ownFieldCards.map(card => <option key={card.id} value={card.id}>{card.label}</option>)}
      </select>
      <button disabled={!selectedCard || !stackTarget || selectedCard.zone !== 'field'} onClick={() => selectedCard && execute({ type: 'stack', id: selectedCard.id, targetId: stackTarget, actor: viewer })}>Stack</button>
      <button disabled={!selectedCard?.stackOn} onClick={() => selectedCard && execute({ type: 'unstack', id: selectedCard.id, actor: viewer })}>Unstack</button>
    </section>

    <section className="filebar">
      <button onClick={save}>Export table</button>
      <button onClick={() => fileRef.current?.click()}>Import table</button>
      <button onClick={() => { execute({ type: 'reset' }); setSelected(''); }}>Reset</button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} />
      <span className="chip">Manual rules · Local sandbox</span>
    </section>

    {error && <p className="error" role="alert">{error}</p>}

    <div className="board" ref={boardRef} aria-label="RB Unbound tabletop board">
      <div className="midline"><span>SHARED FIELD</span></div>
      {renderPlayer(2)}
      {renderPlayer(1)}
    </div>

    <footer>
      Draw from your deck · Double-click a hand card to play it · Drag your field cards · Opponent hand information and controls are hidden in the other player view.
    </footer>
  </div>;
}
