import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TabletopDock, type DockHistoryEntry } from './tabletop-dock';
import { DeckTools } from './deck-tools';
import { DeckPile } from './deck-pile';
import { toCanonicalPoint, toViewerPoint, toViewerSeat } from './board-perspective';
import { actionForCode, displayKey, type KeyBindings } from './controls';
import {
  applyAction,
  canManipulate,
  builtInModulePackages,
  createTableSaveFile,
  genericDuelModule,
  initialTable,
  isTableSaveFile,
  migrateTableState,
  modulePackageKey,
  type Card,
  type DeckDefinition,
  type GameModule,
  type ModulePackage,
  type ModuleZoneDefinition,
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

export function Table({ bindings, modulePackages }: { bindings: KeyBindings; modulePackages: ModulePackage[] }) {
  const [moduleKey, setModuleKey] = useState(modulePackageKey(genericDuelModule));
  const activePackage = modulePackages.find(bundle => modulePackageKey(bundle.module) === moduleKey) ?? builtInModulePackages[0];
  const activeModule = activePackage.module;
  const zoneFor = (kind: Card['zone']) => activeModule.zones.find(zone => zone.kind === kind);
  const zoneLabel = (kind: Card['zone']) => zoneFor(kind)?.label ?? kind;
  const cardBack = activeModule.cardBacks[0];
  const zonePosition = (kind: Card['zone'], player: 1 | 2) => {
    const zone = zoneFor(kind);
    const visualSeat = toViewerSeat(player, viewer, '1v1') as 1 | 2;
    const fallback = kind === 'deck'
      ? (visualSeat === 1 ? { x: 70, y: 470 } : { x: 850, y: 40 })
      : (visualSeat === 1 ? { x: 850, y: 470 } : { x: 90, y: 45 });
    const seatKey = visualSeat === 1 ? '1' : '2';
    if (zone?.seatPositions?.[seatKey]) return zone.seatPositions[seatKey]!;
    if (zone?.defaultPosition) return toViewerPoint(zone.defaultPosition, viewer, '1v1');
    return fallback;
  };
  const zoneAreaPosition = (zone: ModuleZoneDefinition, player?: 1 | 2) => {
    if (zone.ownerScoped && player) {
      const visualSeat = toViewerSeat(player, viewer, '1v1') as 1 | 2;
      const seatKey = visualSeat === 1 ? '1' : '2';
      return zone.seatPositions?.[seatKey] ?? (zone.defaultPosition ? toViewerPoint(zone.defaultPosition, viewer, '1v1') : undefined);
    }
    return zone.defaultPosition ? toViewerPoint(zone.defaultPosition, viewer, '1v1') : undefined;
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
  const [history, setHistory] = useState<DockHistoryEntry[]>([]);
  const historyCounterRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const handDragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const addLocalHistory = (text: string) => {
    historyCounterRef.current += 1;
    setHistory(current => [...current, {
      id: `local-${Date.now()}-${historyCounterRef.current}`,
      text,
      createdAt: new Date().toISOString(),
    }].slice(-200));
  };

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
    const saveFile = createTableSaveFile(table, activeModule);
    const url = URL.createObjectURL(new Blob([JSON.stringify(saveFile, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `rb-unbound-${activeModule.id}-table.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const load = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 250_000) throw Error('File too large');
      const parsed: unknown = JSON.parse(await file.text());
      if (isTableSaveFile(parsed)) {
        const required = modulePackages.find(bundle =>
          bundle.module.id === parsed.moduleId && bundle.module.version === parsed.moduleVersion);
        if (!required) {
          setError(`This table requires ${parsed.moduleId} v${parsed.moduleVersion}, which is not installed.`);
          return;
        }
        setModuleKey(modulePackageKey(required.module));
        setTable(migrateTableState(parsed.table) ?? parsed.table);
      } else {
        const migrated = migrateTableState(parsed);
        if (!migrated) throw Error('Invalid table file');
        setTable(migrated);
      }
      setSelected('');
      setStackTarget('');
      setError('');
    } catch {
      setError('Could not load this table file. Current saves and legacy v3/v4 table files are supported.');
    }
  };

  const drawCards = (player: PlayerId, count: number) => {
    for (let index = 0; index < count; index += 1) execute({ type: 'draw', player });
    addLocalHistory(`Player ${player} drew ${count === 1 ? 'a card' : `${count} cards`}.`);
  };

  const shuffleDeck = (player: PlayerId) => {
    const ids = table.cards
      .filter(card => card.owner === player && card.zone === 'deck')
      .sort((a, b) => a.order - b.order)
      .map(card => card.id);
    execute({ type: 'shuffle', player, orderedIds: shuffled(ids) });
    addLocalHistory(`Player ${player} shuffled their deck.`);
  };

  const loadDeckForPlayerOne = (deck: DeckDefinition) => {
    if (deck.moduleId !== activeModule.id || deck.moduleVersion !== activeModule.version) {
      setError('That deck does not match the active module.');
      return;
    }
    const catalog = new Map(activePackage.cards.map(card => [card.id, card]));
    const cards = deck.cards.map((definitionId, index) => {
      const definition = catalog.get(definitionId);
      if (!definition) return null;
      return {
        id: `p1-${definitionId}-${index + 1}`,
        definitionId,
        label: definition.name,
        owner: 1 as PlayerId,
        zone: 'deck',
        order: index,
        x: 0,
        y: 0,
        rotation: 0,
        faceUp: false,
      };
    }).filter((card): card is NonNullable<typeof card> => Boolean(card));

    setTable(state => ({
      ...state,
      cards: [...state.cards.filter(card => card.owner !== 1), ...cards],
    }));
    setSelected('');
    setMultiSelected([]);
    setPinned('');
    setError('');
    addLocalHistory(`Loaded ${deck.name} for Player 1.`);
  };

  const targets = selectedCards.length ? selectedCards : (selectedCard ? [selectedCard] : []);

  const moveTargets = (zone: Card['zone']) => {
    const ownedTargets = targets.filter(card => card.owner === viewer);
    for (const card of ownedTargets) {
      execute({ type: 'to-zone', id: card.id, zone, actor: viewer });
    }
    if (ownedTargets.length) {
      addLocalHistory(`Player ${viewer} moved ${ownedTargets.length === 1 ? 'a card' : `${ownedTargets.length} cards`} to ${zoneLabel(zone)}.`);
    }
    if (zone !== 'field') setStackTarget('');
  };

  const rotateTargets = () => {
    const ownedTargets = targets.filter(card => card.owner === viewer);
    for (const card of ownedTargets) execute({ type: 'rotate', id: card.id, actor: viewer });
    if (ownedTargets.length) addLocalHistory(`Player ${viewer} changed the tap state of ${ownedTargets.length === 1 ? 'a card' : `${ownedTargets.length} cards`}.`);
  };

  const flipTargets = () => {
    const ownedTargets = targets.filter(card => card.owner === viewer);
    for (const card of ownedTargets) execute({ type: 'flip', id: card.id, actor: viewer });
    if (ownedTargets.length) addLocalHistory(`Player ${viewer} flipped ${ownedTargets.length === 1 ? 'a card' : `${ownedTargets.length} cards`}.`);
  };

  const stackSelected = () => {
    if (!selectedCard || !stackTarget || selectedCard.zone !== 'field') return;
    execute({ type: 'stack', id: selectedCard.id, targetId: stackTarget, actor: viewer });
    addLocalHistory(`Player ${viewer} stacked ${selectedCard.label}.`);
  };

  const unstackSelected = () => {
    if (!selectedCard?.stackOn) return;
    execute({ type: 'unstack', id: selectedCard.id, actor: viewer });
    addLocalHistory(`Player ${viewer} unstacked ${selectedCard.label}.`);
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
      const point = toViewerPoint({ x: target?.x ?? card.x, y: target?.y ?? card.y }, viewer, '1v1');
      style.left = `${point.x / 10}%`;
      style.top = `${point.y / 6}%`;
      style.transform = `translate(${target ? 9 : 0}px, ${target ? 9 : 0}px) rotate(${card.rotation}deg)`;
      style.zIndex = target ? 4 : 3;
    }

    if (mode === 'hand') {
      const spread = Math.min(58, Math.max(27, 650 / Math.max(collection.length, 1)));
      const width = Math.min(680, collection.length * spread + 55);
      const start = 50 - width / 2 / 10;
      style.left = `calc(${start}% + ${index * spread}px)`;
      const visualSeat = toViewerSeat(card.owner, viewer, '1v1');
      style.top = visualSeat === 2 ? '4px' : 'calc(100% - 108px)';
      style.transform = 'rotate(0deg)';
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
      onDoubleClick={() => {
        if (owned && mode === 'hand') {
          execute({ type: 'to-zone', id: card.id, zone: 'field', actor: viewer });
          addLocalHistory(`Player ${viewer} played a card to ${zoneLabel('field')} face-down.`);
        }
      }}
      onPointerDown={event => {
        if (!owned || event.button !== 0 || (mode !== 'field' && mode !== 'hand')) return;
        setSelected(card.id);
        event.currentTarget.setPointerCapture(event.pointerId);
        handDragRef.current = mode === 'hand'
          ? { id: card.id, startX: event.clientX, startY: event.clientY }
          : null;
      }}
      onPointerMove={event => {
        if (!owned || mode !== 'field' || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return;
        const point = toCanonicalPoint({
          x: ((event.clientX - rect.left - 43) / rect.width) * 1000,
          y: ((event.clientY - rect.top - 58) / rect.height) * 600,
        }, viewer, '1v1');
        execute({
          type: 'move',
          id: card.id,
          actor: viewer,
          x: point.x,
          y: point.y,
        });
      }}
      onPointerUp={event => {
        if (!owned || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        if (mode === 'hand' && handDragRef.current?.id === card.id) {
          const drag = handDragRef.current;
          const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
          const rect = boardRef.current?.getBoundingClientRect();
          if (rect && distance > 6 &&
            event.clientX >= rect.left && event.clientX <= rect.right &&
            event.clientY >= rect.top && event.clientY <= rect.bottom) {
            execute({ type: 'to-zone', id: card.id, zone: 'field', actor: viewer });
            addLocalHistory(`Player ${viewer} played a card to ${zoneLabel('field')} face-down.`);
            const point = toCanonicalPoint({
              x: ((event.clientX - rect.left - 43) / rect.width) * 1000,
              y: ((event.clientY - rect.top - 58) / rect.height) * 600,
            }, viewer, '1v1');
            execute({
              type: 'move',
              id: card.id,
              actor: viewer,
              x: point.x,
              y: point.y,
            });
          }
        }
        handDragRef.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
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
      <DeckPile
        label={zoneLabel('deck')}
        count={deck.length}
        pattern={cardBack.pattern}
        interactive={active}
        style={{
          left: `${zonePosition('deck', player).x / 10}%`,
          top: `${zonePosition('deck', player).y / 6}%`,
        }}
        onDraw={count => drawCards(player, count)}
        onShuffle={() => shuffleDeck(player)}
      />
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
          const position = zoneAreaPosition(zone, player) ?? { x: 500, y: 300 };
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
        <select value={modulePackageKey(activeModule)} onChange={e => setModuleKey(e.target.value)}>
          {modulePackages.map(bundle => {
            const module: GameModule = bundle.module;
            return <option key={modulePackageKey(module)} value={modulePackageKey(module)}>{module.name} · v{module.version}</option>;
          })}
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
      <button disabled={!selectedCard || !stackTarget || selectedCard.zone !== 'field'} onClick={stackSelected}>Stack</button>
      <button disabled={!selectedCard?.stackOn} onClick={unstackSelected}>Unstack</button>
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
      <button onClick={() => { execute({ type: 'reset' }); setSelected(''); addLocalHistory('Reset the local table.'); }}>Reset</button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} />
      <span className="chip">Manual rules · Local sandbox</span>
    </section>

    {error && <p className="error" role="alert">{error}</p>}

    <div className="play-area">
      <TabletopDock
        card={inspectorCard}
        pinned={inspectorPinned}
        onClear={() => setPinned('')}
        module={activeModule}
        catalog={activePackage.cards}
        history={history}
      />
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
              const point = toViewerPoint({ x: card.x, y: card.y }, viewer, '1v1');
              const cx = (point.x / 1000) * rect.width + 43;
              const cy = (point.y / 600) * rect.height + 58;
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
        {activeModule.zones.filter(zone => zone.kind !== 'hand' && zone.size).flatMap(zone => {
          const players: Array<1 | 2 | undefined> = zone.ownerScoped ? [1, 2] : [undefined];
          return players.flatMap(player => {
            const position = zoneAreaPosition(zone, player);
            if (!position || !zone.size) return [];
            const count = player
              ? table.cards.filter(card => card.owner === player && card.zone === zone.id).length
              : table.cards.filter(card => card.zone === zone.id).length;
            return [<div
              key={`${zone.id}-${player ?? 'shared'}`}
              className={`module-zone-area module-zone-${zone.kind}`}
              style={{
                left: `${position.x / 10}%`,
                top: `${position.y / 6}%`,
                width: `${zone.size.width / 10}%`,
                height: `${zone.size.height / 6}%`,
              }}
            >
              <strong>{zone.label}</strong>
              {zone.kind === 'custom' && <span>{count ? `${count} card${count === 1 ? '' : 's'}` : ''}</span>}
            </div>];
          });
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

    <DeckTools module={activeModule} catalog={activePackage.cards} onLoadDeck={loadDeckForPlayerOne} />

    <footer>
      {activeModule.description} · Draw from your {zoneLabel('deck').toLowerCase()} · Double-click a {zoneLabel('hand').toLowerCase()} card to play it · Drag your {zoneLabel('field').toLowerCase()} cards.
    </footer>
  </div>;
}
