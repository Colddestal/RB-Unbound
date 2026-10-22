import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CardInspector } from './card-inspector';
import { actionForCode, displayKey, type KeyBindings } from './controls';
import {
  applyAction,
  canManipulate,
  builtInGameModules,
  genericDuelModule,
  initialTable,
  migrateTableState,
  type Card,
  type GameModule,
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

export function Table({ bindings }: { bindings: KeyBindings }) {
  const [moduleId, setModuleId] = useState(genericDuelModule.id);
  const activeModule = builtInGameModules.find(module => module.id === moduleId) ?? genericDuelModule;
  const zoneFor = (kind: Card['zone']) => activeModule.zones.find(zone => zone.kind === kind);
  const zoneLabel = (kind: Card['zone']) => zoneFor(kind)?.label ?? kind;
  const cardBack = activeModule.cardBacks[0];
  const zonePosition = (kind: Card['zone'], player: 1 | 2) => {
    const zone = zoneFor(kind);
    const fallback = kind === 'deck'
      ? (player === 1 ? { x: 70, y: 470 } : { x: 850, y: 40 })
      : (player === 1 ? { x: 850, y: 470 } : { x: 90, y: 45 });
    const seatKey = player === 1 ? '1' : '2';
    return zone?.seatPositions?.[seatKey] ?? zone?.defaultPosition ?? fallback;
  };
  const [table, setTable] = useState<TableState>(() => structuredClone(initialTable));
  const [viewer, setViewer] = useState<PlayerId>(1);
  const [selected, setSelected] = useState<string>('');
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [hovered, setHovered] = useState<string>('');
  const [pinned, setPinned] = useState<string>('');
  const [stackTarget, setStackTarget] = useState<string>('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const allowedZones = activeModule.zones.map(zone => zone.id);
  const stackableZones = activeModule.zones.filter(zone => zone.stackable).map(zone => zone.id);
  const execute = (action: Parameters<typeof applyAction>[1]) =>
    setTable(state => applyAction(state, action, allowedZones, stackableZones));
  const selectedCard = table.cards.find(card => card.id === selected);
  const selectedCards = table.cards.filter(card => multiSelected.includes(card.id));
  const inspectorCard = table.cards.find(card => card.id === (hovered || pinned));
  const inspectorPinned = Boolean(pinned && !hovered);
  const ownFieldCards = table.cards.filter(card => card.owner === viewer && card.zone === 'field' && card.id !== selected);

  const cardsByPlayer = useMemo(() => ({
    1: table.cards.filter(card => card.owner === 1),
    2: table.cards.filter(card => card.owner === 2),
  }), [table.cards]);

  const save = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(table, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'rb-unbound-table-v4.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const load = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 250_000) throw Error('File too large');
      const parsed: unknown = JSON.parse(await file.text());
      const migrated = migrateTableState(parsed);
      if (!migrated) throw Error('Invalid table file');
      setTable(migrated);
      setSelected('');
      setStackTarget('');
      setError('');
    } catch {
      setError('Could not load this table file. RB Unbound v3/v4 table files are supported.');
    }
  };

  const shuffleDeck = (player: PlayerId) => {
    const ids = table.cards
      .filter(card => card.owner === player && card.zone === 'deck')
      .sort((a, b) => a.order - b.order)
      .map(card => card.id);
    execute({ type: 'shuffle', player, orderedIds: shuffled(ids) });
  };

  const targets = selectedCards.length ? selectedCards : (selectedCard ? [selectedCard] : []);

  const moveTargets = (zone: Card['zone']) => {
    for (const card of targets) {
      if (card.owner === viewer) execute({ type: 'to-zone', id: card.id, zone, actor: viewer });
    }
    if (zone !== 'field') setStackTarget('');
  };

  const rotateTargets = () => {
    for (const card of targets) if (card.owner === viewer) execute({ type: 'rotate', id: card.id, actor: viewer });
  };

  const flipTargets = () => {
    for (const card of targets) if (card.owner === viewer) execute({ type: 'flip', id: card.id, actor: viewer });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;

      const action = actionForCode(bindings, event.code);

      if (action === 'clear') {
        setSelected('');
        setMultiSelected([]);
        setPinned('');
        setStackTarget('');
        event.preventDefault();
        return;
      }

      if (!action || targets.length === 0) return;

      if (action === 'rotate') rotateTargets();
      else if (action === 'flip') flipTargets();
      else if (action === 'discard') moveTargets('discard');
      else if (action === 'moveHand') moveTargets('hand');
      else if (action === 'playField') moveTargets('field');
      else if (targets.every(card => card.zone === 'field') && ['moveUp', 'moveDown', 'moveLeft', 'moveRight'].includes(action)) {
        const step = event.shiftKey ? 50 : 15;
        const dx = action === 'moveLeft' ? -step : action === 'moveRight' ? step : 0;
        const dy = action === 'moveUp' ? -step : action === 'moveDown' ? step : 0;
        for (const card of targets) {
          if (card.owner === viewer) execute({ type: 'move', id: card.id, actor: viewer, x: card.x + dx, y: card.y + dy });
        }
      } else return;

      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCard, selectedCards, viewer, bindings]);

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
      const position = zonePosition('discard', card.owner as 1 | 2);
      style.left = `${position.x / 10}%`;
      style.top = `${position.y / 6}%`;
      style.transform = `translate(${index * 2}px,${index * 2}px) rotate(${card.rotation}deg)`;
      style.zIndex = 8 + index;
    }

    return <button
      key={card.id}
      aria-label={`${faceVisible ? card.label : 'Hidden card'}, Player ${card.owner}`}
      aria-pressed={selected === card.id}
      className={`card ${selected === card.id || multiSelected.includes(card.id) ? 'selected' : ''} ${faceVisible ? '' : `back back-${cardBack.pattern}`} ${owned ? '' : 'locked'}`}
      style={style}
      onMouseEnter={() => setHovered(card.id)}
      onMouseLeave={() => setHovered('')}
      onClick={event => {
        if (owned || mode === 'field') {
          if (event.shiftKey && owned) {
            setMultiSelected(current => current.includes(card.id) ? current.filter(id => id !== card.id) : [...current, card.id]);
            setSelected('');
          } else {
            setSelected(card.id);
            setMultiSelected([]);
          }
        }
        setPinned(card.id);
      }}
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
      <small>P{card.owner} · {zoneLabel(card.zone)}</small>
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
      <div className="deck-zone" style={{
        left: `${zonePosition('deck', player).x / 10}%`,
        top: `${zonePosition('deck', player).y / 6}%`,
      }}>
        <div className={`pile-card back-${cardBack.pattern}`}>◆<strong>{zoneLabel('deck').toUpperCase()}</strong><span>{deck.length} cards</span></div>
        {active && <div className="pile-actions">
          <button disabled={!deck.length} onClick={() => execute({ type: 'draw', player })}>Draw</button>
          <button disabled={deck.length < 2} onClick={() => shuffleDeck(player)}>Shuffle</button>
        </div>}
      </div>
      <div className="discard-zone" style={{
        left: `${zonePosition('discard', player).x / 10}%`,
        top: `${zonePosition('discard', player).y / 6}%`,
      }}><span>{zoneLabel('discard').toUpperCase()} · {discard.length}</span></div>
      {discard.slice(-6).map((card, index) => renderCard(card, index, discard, 'discard'))}
      {hand.map((card, index) => renderCard(card, index, hand, 'hand'))}
      {field.map((card, index) => renderCard(card, index, field, 'field'))}
      {activeModule.zones.filter(zone => zone.kind === 'custom').flatMap(zone => {
        const cards = table.cards.filter(card => card.owner === player && card.zone === zone.id);
        return cards.map((card, index) => {
          const position = zone.defaultPosition ?? { x: 500, y: 300 };
          const styleOffset = index * 10;
          return <button
            key={card.id}
            className={`card custom-zone-card ${selected === card.id || multiSelected.includes(card.id) ? 'selected' : ''} ${card.faceUp ? '' : `back back-${cardBack.pattern}`}`}
            style={{ left: `calc(${position.x / 10}% + ${styleOffset}px)`, top: `calc(${position.y / 6}% + ${styleOffset}px)`, zIndex: 30 + index }}
            onMouseEnter={() => setHovered(card.id)}
            onMouseLeave={() => setHovered('')}
            onClick={() => { setSelected(card.id); setMultiSelected([]); setPinned(card.id); }}
          >
            <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span>
            <span>{card.faceUp ? card.label : 'Hidden card'}</span>
            <small>P{card.owner} · {zone.label}</small>
          </button>;
        });
      })}
    </>;
  };

  return <div className="app">
    <header>
      <div><span className="eyebrow">PROJECT POOR PRESENTS</span><h1>RB UNBOUND</h1><p>Manual tabletop alpha · Decks, hands, discard and stacks</p></div>
      <a href="https://github.com/Colddestal/RB-Unbound" target="_blank" rel="noreferrer">View GitHub ↗</a>
    </header>

    <section className="viewer-bar">
      <strong>Local player view</strong>
      <label className="module-picker">Module
        <select value={moduleId} onChange={e => setModuleId(e.target.value)}>
          {builtInGameModules.map((module: GameModule) => <option key={module.id} value={module.id}>{module.name}</option>)}
        </select>
      </label>
      <button className={viewer === 1 ? 'active' : ''} onClick={() => { setViewer(1); setSelected(''); }}>Player 1</button>
      <button className={viewer === 2 ? 'active' : ''} onClick={() => { setViewer(2); setSelected(''); }}>Player 2</button>
      <span className="chip">Opponent hand stays hidden</span>
      <span className="chip">PC controls enabled</span>
      <span className="chip">{activeModule.name} · {cardBack.label}</span>
    </section>

    <section className="toolbar">
      <strong>{selectedCards.length ? `${selectedCards.length} cards selected` : selectedCard ? `Selected: ${selectedCard.owner === viewer ? selectedCard.label : 'Opponent card'}` : 'Select one of your cards'}</strong>
      <button disabled={!targets.length} onClick={rotateTargets}>Rotate</button>
      <button disabled={!targets.length} onClick={flipTargets}>Flip</button>
      <button disabled={!targets.length} onClick={() => moveTargets('hand')}>To {zoneLabel('hand')}</button>
      <button disabled={!targets.length} onClick={() => moveTargets('field')}>To {zoneLabel('field')}</button>
      <button disabled={!targets.length} onClick={() => moveTargets('discard')}>{zoneLabel('discard')}</button>
      <button disabled={!targets.length} onClick={() => moveTargets('deck')}>To {zoneLabel('deck')}</button>
      {activeModule.zones.filter(zone => zone.kind === 'custom').map(zone =>
        <button key={zone.id} disabled={!targets.length} onClick={() => moveTargets(zone.id)}>To {zone.label}</button>
      )}
      <select value={stackTarget} onChange={e => setStackTarget(e.target.value)} disabled={!selectedCard || selectedCard.zone !== 'field'}>
        <option value="">Stack target…</option>
        {ownFieldCards.map(card => <option key={card.id} value={card.id}>{card.label}</option>)}
      </select>
      <button disabled={!selectedCard || !stackTarget || selectedCard.zone !== 'field'} onClick={() => selectedCard && execute({ type: 'stack', id: selectedCard.id, targetId: stackTarget, actor: viewer })}>Stack</button>
      <button disabled={!selectedCard?.stackOn} onClick={() => selectedCard && execute({ type: 'unstack', id: selectedCard.id, actor: viewer })}>Unstack</button>
    </section>

    <section className="shortcut-bar" aria-label="Keyboard shortcuts">
      <strong>Keyboard</strong>
      <kbd>R</kbd><span>Rotate</span>
      <kbd>F</kbd><span>Flip</span>
      <kbd>P</kbd><span>Play / field</span>
      <kbd>H</kbd><span>Hand</span>
      <kbd>Del</kbd><span>Discard</span>
      <kbd>{displayKey(bindings.moveUp)}{displayKey(bindings.moveLeft)}{displayKey(bindings.moveDown)}{displayKey(bindings.moveRight)}</kbd><span>Nudge</span>
      <kbd>Shift + movement</kbd><span>Large nudge</span>
      <kbd>Esc</kbd><span>Clear</span>
    </section>

    <section className="filebar">
      <button onClick={save}>Export table</button>
      <button onClick={() => fileRef.current?.click()}>Import table</button>
      <button onClick={() => { execute({ type: 'reset' }); setSelected(''); }}>Reset</button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} />
      <span className="chip">Manual rules · Local sandbox</span>
    </section>

    {error && <p className="error" role="alert">{error}</p>}

    <div className="play-area">
      <CardInspector card={inspectorCard} pinned={inspectorPinned} onClear={() => setPinned('')} />
      <div
        className="board"
        ref={boardRef}
        aria-label="RB Unbound tabletop board"
        onPointerDown={event => {
          if (event.button !== 0 || event.currentTarget !== event.target) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          setSelectionBox({ startX: x, startY: y, endX: x, endY: y });
          setSelected('');
          setMultiSelected([]);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!selectionBox || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setSelectionBox(box => box ? { ...box, endX: event.clientX - rect.left, endY: event.clientY - rect.top } : null);
        }}
        onPointerUp={event => {
          if (!selectionBox) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const left = Math.min(selectionBox.startX, selectionBox.endX);
          const right = Math.max(selectionBox.startX, selectionBox.endX);
          const top = Math.min(selectionBox.startY, selectionBox.endY);
          const bottom = Math.max(selectionBox.startY, selectionBox.endY);
          const ids = table.cards
            .filter(card => card.owner === viewer && card.zone === 'field')
            .filter(card => {
              const cx = (card.x / 1000) * rect.width + 43;
              const cy = (card.y / 600) * rect.height + 58;
              return cx >= left && cx <= right && cy >= top && cy <= bottom;
            })
            .map(card => card.id);
          setMultiSelected(ids);
          setSelectionBox(null);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onClick={event => {
          if (event.currentTarget === event.target) setPinned('');
        }}
      >
        <div className="midline"><span>{zoneLabel('field').toUpperCase()}</span></div>
        {activeModule.zones.filter(zone => zone.defaultPosition && zone.kind === 'custom').map(zone => {
          const cards = table.cards.filter(card => card.zone === zone.id);
          return <div
            key={zone.id}
            className="module-zone-marker interactive"
            style={{ left: `${zone.defaultPosition!.x / 10}%`, top: `${zone.defaultPosition!.y / 6}%` }}
          >
            <strong>{zone.label}</strong>
            <span>{cards.length} card{cards.length === 1 ? '' : 's'}</span>
          </div>;
        })}
        {selectionBox && <div className="selection-box" style={{
          left: Math.min(selectionBox.startX, selectionBox.endX),
          top: Math.min(selectionBox.startY, selectionBox.endY),
          width: Math.abs(selectionBox.endX - selectionBox.startX),
          height: Math.abs(selectionBox.endY - selectionBox.startY),
        }} />}
        {renderPlayer(2)}
        {renderPlayer(1)}
      </div>
    </div>

    <footer>
      {activeModule.description} · Draw from your {zoneLabel('deck').toLowerCase()} · Double-click a {zoneLabel('hand').toLowerCase()} card to play it · Drag your {zoneLabel('field').toLowerCase()} cards.
    </footer>
  </div>;
}
