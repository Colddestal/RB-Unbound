import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { TabletopDock, type DockHistoryEntry } from './tabletop-dock';
import { DeckTools } from './deck-tools';
import { DeckPile } from './deck-pile';
import { DuelTurnControl } from './duel-turn-control';
import { ResizableDockColumn } from './resizable-dock-column';
import { CardContextMenu, type CardContextState } from './card-context-menu';
import { localHandDropRect, pointInRect } from './drag-drop';
import { toCanonicalPoint, toViewerPoint, toViewerSeat } from './board-perspective';
import { actionForCode, displayKey, type KeyBindings } from './controls';
import { automaticZoneCardPoint, orderZoneCards, runeColor } from './zone-card-layout';
import { spatialDropZone } from './spatial-zone-drop';
import {
  applyAction,
  canManipulate,
  builtInModulePackages,
  createInitialTableForModule,
  defaultGameModule,
  pileCapabilities,
  sectionCards,
  zoneBehavior,
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

export function Table({ bindings, modulePackages, showEditor = false, onOpenTable }: {
  bindings: KeyBindings;
  modulePackages: ModulePackage[];
  showEditor?: boolean;
  onOpenTable?: () => void;
}) {
  const defaultPackage = modulePackages.find(bundle => bundle.module.id === defaultGameModule.id) ??
    builtInModulePackages.find(bundle => bundle.module.id === defaultGameModule.id) ??
    builtInModulePackages[0];
  const [moduleKey, setModuleKey] = useState(modulePackageKey(defaultPackage.module));
  const activePackage = modulePackages.find(bundle => modulePackageKey(bundle.module) === moduleKey) ?? defaultPackage;
  const activeModule = activePackage.module;
  const cardDefinitions = useMemo(() => new Map(activePackage.cards.map(card => [card.id, card])), [activePackage]);
  const zoneFor = (kind: Card['zone']) => activeModule.zones.find(zone => zone.id === kind || zone.kind === kind);
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
  const canonicalZonePosition = (zone: ModuleZoneDefinition, player?: PlayerId) => {
    if (zone.ownerScoped && player) {
      const seatKey = String(player) as '1' | '2' | '3' | '4';
      return zone.seatPositions?.[seatKey] ?? zone.defaultPosition;
    }
    return zone.defaultPosition;
  };
  const [table, setTable] = useState<TableState>(() =>
    createInitialTableForModule([1, 2], defaultPackage.module, defaultPackage.cards));
  const [viewer, setViewer] = useState<PlayerId>(1);
  const [turnNumber, setTurnNumber] = useState(1);
  const [confirmEndTurn, setConfirmEndTurn] = useState(false);
  const [selected, setSelected] = useState<string>('');
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [hovered, setHovered] = useState<string>('');
  const [pinned, setPinned] = useState<string>('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<DockHistoryEntry[]>([]);
  const [dragPreview, setDragPreview] = useState<{ id: string; label: string; x: number; y: number } | null>(null);
  const [fieldDragId, setFieldDragId] = useState('');
  const [cardContext, setCardContext] = useState<CardContextState | null>(null);
  const historyCounterRef = useRef(0);
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
  const movableZoneSet = new Set(stackableZones);
  const zoneGroups = new Map(activeModule.zones.map(zone => [zone.id, zone.group ?? zone.id] as const));
  const zoneGroupFor = (zoneId: string) => zoneGroups.get(zoneId) ?? zoneId;
  const canonicalCardPoint = (card: Card) => {
    const zone = activeModule.zones.find(item => item.id === card.zone);
    if (zone?.stackable && card.x === 0 && card.y === 0) {
      const zoneCards = orderZoneCards(zone, table.cards
        .filter(item => item.owner === card.owner && item.zone === card.zone), cardDefinitions);
      const index = Math.max(0, zoneCards.findIndex(item => item.id === card.id));
      return automaticZoneCardPoint(zone, card.owner, index, zoneCards.length) ??
        canonicalZonePosition(zone, card.owner) ??
        { x: card.x, y: card.y };
    }
    return { x: card.x, y: card.y };
  };
  const dropCursorPoint = (clientX: number, clientY: number, rect: DOMRect) =>
    toCanonicalPoint({
      x: ((clientX - rect.left) / rect.width) * 1000,
      y: ((clientY - rect.top) / rect.height) * 600,
    }, viewer, '1v1');
  const spatialLayerForCard = (card: Card, point: { x: number; y: number }) => {
    const sourceGroup = card.zone === 'hand' ? 'battlefield' : zoneGroupFor(card.zone);
    if (sourceGroup !== 'battlefield') return undefined;
    return spatialDropZone(activeModule, point, card.owner, sourceGroup);
  };
  const execute = (action: Parameters<typeof applyAction>[1]) =>
    setTable(state => applyAction(state, action, allowedZones, stackableZones, zoneGroups));
  const selectedCard = table.cards.find(card => card.id === selected);
  const selectedCards = table.cards.filter(card => multiSelected.includes(card.id));
  const inspectorCard = table.cards.find(card => card.id === (hovered || pinned));
  const inspectorPinned = Boolean(pinned && !hovered);
  const contextCard = cardContext ? table.cards.find(card => card.id === cardContext.cardId) : undefined;
  const contextStackTargets = contextCard
    ? table.cards.filter(card =>
      card.owner === viewer &&
      card.id !== contextCard.id &&
      movableZoneSet.has(card.zone) &&
      zoneGroupFor(card.zone) === zoneGroupFor(contextCard.zone))
    : [];
  const draggedCard = fieldDragId ? table.cards.find(card => card.id === fieldDragId) : undefined;
  const draggedGroup = draggedCard ? zoneGroupFor(draggedCard.zone) : undefined;
  const handZoneId = activeModule.zones.find(zone => zone.kind === 'hand')?.id;
  const discardZoneId = activeModule.zones.find(zone => zone.kind === 'discard')?.id;
  const deckZoneId = activeModule.zones.find(zone => zone.kind === 'deck')?.id;
  const contextZones = activeModule.zones
    .filter(zone => zone.behavior !== 'subzone')
    .map(zone => ({ id: zone.id, label: zone.label }));

  const cardsByPlayer = useMemo(() => ({
    1: table.cards.filter(card => card.owner === 1),
    2: table.cards.filter(card => card.owner === 2),
  }), [table.cards]);

  const drawCards = (player: PlayerId, count: number, fromZone = 'deck') => {
    const sourceZone = activeModule.zones.find(zone => zone.id === fromZone);
    const capabilities = sourceZone ? pileCapabilities(activeModule, sourceZone) : undefined;
    const destination = capabilities?.drawToZoneId
      ? activeModule.zones.find(zone => zone.id === capabilities.drawToZoneId)
      : undefined;
    const faceUp = destination ? (destination.visibility === 'public' || zoneBehavior(destination) === 'hand') : false;

    for (let index = 0; index < count; index += 1) {
      execute({
        type: 'draw',
        player,
        fromZone,
        toZone: capabilities?.drawToZoneId ?? 'hand',
        faceUp,
      });
    }
    addLocalHistory(`Player ${player} drew ${count === 1 ? 'a card' : `${count} cards`} from ${sourceZone?.label ?? fromZone}.`);
  };

  const shufflePile = (player: PlayerId, zone = 'deck') => {
    const ids = table.cards
      .filter(card => card.owner === player && card.zone === zone)
      .sort((a, b) => a.order - b.order)
      .map(card => card.id);
    execute({ type: 'shuffle', player, zone, orderedIds: shuffled(ids) });
    addLocalHistory(`Player ${player} shuffled ${activeModule.zones.find(item => item.id === zone)?.label ?? zone}.`);
  };

  const loadDeckForPlayer = (deck: DeckDefinition, player: 1 | 2) => {
    if (deck.moduleId !== activeModule.id || deck.moduleVersion !== activeModule.version) {
      setError('That deck does not match the active module.');
      return;
    }
    const catalog = new Map(activePackage.cards.map(card => [card.id, card]));
    const createCards = (ids: string[], zone: string, faceUp = false) => ids.map((definitionId, index) => {
      const definition = catalog.get(definitionId);
      if (!definition) return null;
      return {
        id: `p${player}-${zone}-${crypto.randomUUID()}`,
        definitionId,
        label: definition.name,
        owner: player as PlayerId,
        zone,
        order: index,
        x: 0,
        y: 0,
        rotation: 0,
        faceUp,
      };
    }).filter((card): card is NonNullable<typeof card> => Boolean(card));
    const cards = [
      ...createCards(deck.cards, 'deck'),
      ...(deck.sections ? [
        ...createCards(sectionCards(deck, 'legend'), 'commander', true),
        ...createCards(sectionCards(deck, 'champion'), 'vanguard', true),
        ...createCards(sectionCards(deck, 'runes'), 'resource-deck'),
      ] : []),
    ];
    const replacedZones = new Set(deck.sections
      ? ['deck', 'commander', 'vanguard', 'resource-deck'] : ['deck']);

    setTable(state => ({
      ...state,
      cards: [...state.cards.filter(card => card.owner !== player || !replacedZones.has(card.zone)), ...cards],
    }));
    setSelected('');
    setMultiSelected([]);
    setPinned('');
    setError('');
    addLocalHistory(`Loaded ${deck.name} for Player ${player}.`);
    onOpenTable?.();
  };

  const targets = selectedCards.length ? selectedCards : (selectedCard ? [selectedCard] : []);

  const moveCardToZone = (card: Card, zone: Card['zone']) => {
    execute({ type: 'to-zone', id: card.id, zone, actor: viewer });
    const targetZone = activeModule.zones.find(item => item.id === zone);
    const position = targetZone?.kind === 'custom' && targetZone.stackable
      ? canonicalZonePosition(targetZone, card.owner)
      : undefined;
    if (position) execute({ type: 'move', id: card.id, actor: viewer, x: position.x, y: position.y });
  };

  const moveTargets = (zone: Card['zone']) => {
    const ownedTargets = targets.filter(card => card.owner === viewer);
    for (const card of ownedTargets) moveCardToZone(card, zone);
    if (ownedTargets.length) {
      addLocalHistory(`Player ${viewer} moved ${ownedTargets.length === 1 ? 'a card' : `${ownedTargets.length} cards`} to ${zoneLabel(zone)}.`);
    }
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

  const openCardContext = (event: ReactMouseEvent, card: Card) => {
    event.preventDefault();
    setSelected(card.owner === viewer ? card.id : '');
    setMultiSelected([]);
    setPinned(card.id);
    setCardContext({ cardId: card.id, x: event.clientX, y: event.clientY });
  };

  const moveContextCard = (zone: string) => {
    if (!contextCard || contextCard.owner !== viewer) return;
    moveCardToZone(contextCard, zone);
    addLocalHistory(`Player ${viewer} moved a card to ${zoneLabel(zone)}.`);
  };

  const rotateContextCard = () => {
    if (!contextCard || contextCard.owner !== viewer) return;
    execute({ type: 'rotate', id: contextCard.id, actor: viewer });
    addLocalHistory(`Player ${viewer} changed a card's tap state.`);
  };

  const flipContextCard = () => {
    if (!contextCard || contextCard.owner !== viewer) return;
    execute({ type: 'flip', id: contextCard.id, actor: viewer });
    addLocalHistory(`Player ${viewer} flipped a card.`);
  };

  const unstackContextCard = () => {
    if (!contextCard?.stackOn || contextCard.owner !== viewer) return;
    execute({ type: 'unstack', id: contextCard.id, actor: viewer });
    addLocalHistory(`Player ${viewer} unstacked a card.`);
  };

  const stackContextCard = (targetId: string) => {
    if (!contextCard || contextCard.owner !== viewer || !movableZoneSet.has(contextCard.zone)) return;
    execute({ type: 'stack', id: contextCard.id, targetId, actor: viewer });
    addLocalHistory(`Player ${viewer} stacked ${contextCard.label}.`);
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
        event.preventDefault();
        return;
      }

      if (!action || targets.length === 0) return;

      if (action === 'rotate') rotateTargets();
      else if (action === 'flip') flipTargets();
      else if (action === 'discard') moveTargets('discard');
      else if (action === 'moveHand') moveTargets('hand');
      else if (action === 'playField') moveTargets('field');
      else if (targets.every(card => movableZoneSet.has(card.zone)) && ['moveUp', 'moveDown', 'moveLeft', 'moveRight'].includes(action)) {
        const step = event.shiftKey ? 50 : 15;
        const dx = action === 'moveLeft' ? -step : action === 'moveRight' ? step : 0;
        const dy = action === 'moveUp' ? -step : action === 'moveDown' ? step : 0;
        for (const card of targets) {
          if (card.owner !== viewer) continue;
          const point = canonicalCardPoint(card);
          execute({ type: 'move', id: card.id, actor: viewer, x: point.x + dx, y: point.y + dy });
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
      style.transform = `translate(-50%,-50%) translate(${target ? 9 : 0}px, ${target ? 9 : 0}px) rotate(${card.rotation}deg)`;
      style.zIndex = target ? 4 : 3;
    }

    if (mode === 'hand') {
      const spread = Math.min(58, Math.max(27, 650 / Math.max(collection.length, 1)));
      const width = Math.min(680, collection.length * spread + 55);
      const visualSeat = toViewerSeat(card.owner, viewer, '1v1') as 1 | 2;
      const handZone = activeModule.zones.find(zone => zone.kind === 'hand');
      const seatKey = visualSeat === 1 ? '1' : '2';
      const handCenter = handZone?.seatPositions?.[seatKey] ?? {
        x: 500,
        y: visualSeat === 2 ? 30 : 570,
      };
      style.left = `calc(${handCenter.x / 10}% - ${width / 2}px + ${index * spread}px)`;
      style.top = `calc(${handCenter.y / 6}% - 54px)`;
      style.transform = 'rotate(0deg)';
      style.zIndex = 20 + index;
    }

    if (mode === 'discard') {
      const position = zonePosition('discard', card.owner as 1 | 2);
      style.left = `${position.x / 10}%`;
      style.top = `${position.y / 6}%`;
      style.transform = `translate(calc(-50% + ${index * 2}px),calc(-50% + ${index * 2}px)) rotate(${card.rotation}deg)`;
      style.zIndex = 8 + index;
    }

    return <button
      key={card.id}
      aria-label={`${faceVisible ? card.label : 'Hidden card'}, Player ${card.owner}`}
      aria-pressed={selected === card.id}
      className={`card ${selected === card.id || multiSelected.includes(card.id) ? 'selected' : ''} ${dragPreview?.id === card.id && mode === 'hand' ? 'drag-source' : ''} ${faceVisible ? '' : `back back-${cardBack.pattern}`} ${owned ? '' : 'locked'}`}
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
      onContextMenu={event => openCardContext(event, card)}
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
        if (mode === 'hand') {
          setDragPreview({ id: card.id, label: card.label, x: event.clientX, y: event.clientY });
        } else {
          setFieldDragId(card.id);
        }
      }}
      onPointerMove={event => {
        if (!owned || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        if (mode === 'hand' && handDragRef.current?.id === card.id) {
          setDragPreview({ id: card.id, label: card.label, x: event.clientX, y: event.clientY });
          return;
        }
        if (mode !== 'field') return;
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect || !pointInRect({ x: event.clientX, y: event.clientY }, rect)) return;
        const point = dropCursorPoint(event.clientX, event.clientY, rect);
        execute({
          type: 'move',
          id: card.id,
          actor: viewer,
          x: point.x,
          y: point.y,
        });
      }}
      onPointerCancel={event => {
        handDragRef.current = null;
        setDragPreview(null);
        setFieldDragId('');
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerUp={event => {
        if (!owned || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = boardRef.current?.getBoundingClientRect();

        if (mode === 'hand' && handDragRef.current?.id === card.id) {
          const drag = handDragRef.current;
          const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
          if (rect && distance > 6 && pointInRect({ x: event.clientX, y: event.clientY }, rect)) {
            const cursorPoint = dropCursorPoint(event.clientX, event.clientY, rect);
            const targetZone = spatialLayerForCard(card, cursorPoint) ?? 'field';
            execute({ type: 'to-zone', id: card.id, zone: targetZone, actor: viewer, ...cursorPoint });
            addLocalHistory(`Player ${viewer} played a card to ${zoneLabel(targetZone)} face-down.`);
          }
        } else if (mode === 'field' && rect && pointInRect({ x: event.clientX, y: event.clientY }, localHandDropRect(rect))) {
          execute({ type: 'to-zone', id: card.id, zone: 'hand', actor: viewer });
          addLocalHistory(`Player ${viewer} returned a card to their hand.`);
        } else if (mode === 'field' && rect && pointInRect({ x: event.clientX, y: event.clientY }, rect)) {
          const point = dropCursorPoint(event.clientX, event.clientY, rect);
          const targetZone = spatialLayerForCard(card, point) ??
            (zoneGroupFor(card.zone) === 'battlefield' && card.zone !== 'field' ? 'field' : undefined);
          if (targetZone && targetZone !== card.zone) {
            execute({ type: 'to-zone', id: card.id, zone: targetZone, actor: viewer, ...point });
            addLocalHistory(`Player ${viewer} moved a card into ${zoneLabel(targetZone)}.`);
          } else execute({ type: 'move', id: card.id, actor: viewer, ...point });
        }

        handDragRef.current = null;
        setDragPreview(null);
        setFieldDragId('');
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <span className="card-symbol">{faceVisible ? '✦' : '◆'}</span>
      <span>{faceVisible ? card.label : 'Hidden card'}</span>
      {mode !== 'field' && <small>P{card.owner} · {zoneLabel(card.zone)}</small>}
    </button>;
  };

  const selectModule = (key: string) => {
    const nextPackage = modulePackages.find(bundle => modulePackageKey(bundle.module) === key);
    if (!nextPackage) return;
    setModuleKey(key);
    setTable(createInitialTableForModule([1, 2], nextPackage.module, nextPackage.cards));
    setViewer(1);
    setTurnNumber(1);
    setConfirmEndTurn(false);
    setSelected('');
    setMultiSelected([]);
    setPinned('');
    setHistory([]);
    setError('');
  };

  const renderPlayer = (player: 1 | 2) => {
    const cards = cardsByPlayer[player];
    const deck = cards.filter(card => card.zone === 'deck').sort((a, b) => a.order - b.order);
    const hand = cards.filter(card => card.zone === 'hand').sort((a, b) => a.order - b.order);
    const field = cards.filter(card => card.zone === 'field');
    const discard = cards.filter(card => card.zone === 'discard').sort((a, b) => a.order - b.order);
    const active = viewer === player;

    return <>
      <DeckPile
        label={zoneLabel('deck')}
        count={deck.length}
        pattern={cardBack.pattern}
        interactive={active}
        style={{
          left: `${zonePosition('deck', player).x / 10}%`,
          top: `${zonePosition('deck', player).y / 6}%`,
          ...(zoneFor('deck')?.size ? {
            width: `${zoneFor('deck')!.size!.width / 10}%`,
            height: `${zoneFor('deck')!.size!.height / 6}%`,
          } : {}),
          transform: 'translate(-50%,-50%)',
        }}
        onDraw={count => drawCards(player, count, 'deck')}
        onShuffle={() => shufflePile(player, 'deck')}
      />
      {activeModule.zones
        .filter(zone => zone.ownerScoped && zone.id !== 'deck' && zone.id !== 'discard' && zoneBehavior(zone) === 'pile' && zone.size)
        .map(zone => {
          const pileCards = cards.filter(card => card.zone === zone.id).sort((a, b) => a.order - b.order);
          const position = zoneAreaPosition(zone, player);
          if (!position || !zone.size) return null;
          const capabilities = pileCapabilities(activeModule, zone);
          return <DeckPile
            key={`${zone.id}-pile-${player}`}
            label={zone.label}
            count={pileCards.length}
            pattern={cardBack.pattern}
            interactive={active && Boolean(capabilities.drawToZoneId)}
            style={{
              left: `${position.x / 10}%`,
              top: `${position.y / 6}%`,
              width: `${zone.size.width / 10}%`,
              height: `${zone.size.height / 6}%`,
              transform: 'translate(-50%,-50%)',
            }}
            onDraw={count => drawCards(player, count, zone.id)}
            onShuffle={() => shufflePile(player, zone.id)}
          />;
        })}
      <div className="discard-zone" style={{
        left: `${zonePosition('discard', player).x / 10}%`,
        top: `${zonePosition('discard', player).y / 6}%`,
        ...(zoneFor('discard')?.size ? {
          width: `${zoneFor('discard')!.size!.width / 10}%`,
          height: `${zoneFor('discard')!.size!.height / 6}%`,
        } : {}),
        transform: 'translate(-50%,-50%)',
      }} aria-label={`${zoneLabel('discard')} · ${discard.length} cards`} />
      {discard.slice(-6).map((card, index) => renderCard(card, index, discard, 'discard'))}
      {hand.map((card, index) => renderCard(card, index, hand, 'hand'))}
      {field.map((card, index) => renderCard(card, index, field, 'field'))}
      {activeModule.zones.filter(zone => zone.kind === 'custom' && zoneBehavior(zone) !== 'pile').flatMap(zone => {
        const cards = orderZoneCards(zone, table.cards
          .filter(card => card.owner === player && card.zone === zone.id), cardDefinitions);
        return cards.flatMap((card, index) => {
          const rawPositions = !zone.ownerScoped && zone.displayCopies?.length
            ? zone.displayCopies
            : [zoneAreaPosition(zone, player) ?? { x: 500, y: 300 }];
          return rawPositions.map((rawPosition, copyIndex) => {
            const hasFreePosition = Boolean(zone.stackable && (card.x !== 0 || card.y !== 0));
            const automaticPoint = !hasFreePosition && zone.stackable
              ? automaticZoneCardPoint(zone, card.owner, index, cards.length)
              : undefined;
            const position = hasFreePosition
              ? toViewerPoint({ x: card.x, y: card.y }, viewer, '1v1')
              : automaticPoint
                ? toViewerPoint(automaticPoint, viewer, '1v1')
                : (!zone.ownerScoped && zone.displayCopies?.length
                  ? toViewerPoint(rawPosition, viewer, '1v1')
                  : rawPosition);
            const styleOffset = hasFreePosition || automaticPoint ? 0 : index * 7;
            const owned = card.owner === viewer;
            const movable = Boolean(zone.stackable);
            return <button
              key={`${card.id}-${copyIndex}`}
              className={`card custom-zone-card ${movable ? 'movable-zone-card' : ''} ${runeColor(card, cardDefinitions) && zone.role === 'runes' ? `rune-color-${runeColor(card, cardDefinitions)}` : ''} ${zone.displayCopies?.length ? 'shared-card-copy' : ''} ${selected === card.id || multiSelected.includes(card.id) ? 'selected' : ''} ${card.faceUp ? '' : `back back-${cardBack.pattern}`}`}
              style={{
                left: `calc(${position.x / 10}% + ${styleOffset}px)`,
                top: `calc(${position.y / 6}% + ${styleOffset}px)`,
                transform: `translate(-50%,-50%) rotate(${card.rotation}deg)`,
                zIndex: 30 + index,
              }}
              onMouseEnter={() => setHovered(card.id)}
              onMouseLeave={() => setHovered('')}
              onClick={event => {
                if (event.shiftKey && owned && movable) {
                  setMultiSelected(current => current.includes(card.id) ? current.filter(id => id !== card.id) : [...current, card.id]);
                  setSelected('');
                } else {
                  setSelected(owned ? card.id : '');
                  setMultiSelected([]);
                }
                setPinned(card.id);
              }}
              onContextMenu={event => openCardContext(event, card)}
              onPointerDown={event => {
                if (!owned || !movable || event.button !== 0) return;
                setSelected(card.id);
                setFieldDragId(card.id);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={event => {
                if (!owned || !movable || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const rect = boardRef.current?.getBoundingClientRect();
                if (!rect || !pointInRect({ x: event.clientX, y: event.clientY }, rect)) return;
                const point = dropCursorPoint(event.clientX, event.clientY, rect);
                execute({ type: 'move', id: card.id, actor: viewer, x: point.x, y: point.y });
              }}
              onPointerCancel={event => {
                setFieldDragId('');
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerUp={event => {
                if (!owned || !movable || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const rect = boardRef.current?.getBoundingClientRect();
                if (rect && pointInRect({ x: event.clientX, y: event.clientY }, localHandDropRect(rect))) {
                  execute({ type: 'to-zone', id: card.id, zone: 'hand', actor: viewer });
                  addLocalHistory(`Player ${viewer} returned a card to their hand.`);
                } else if (rect && pointInRect({ x: event.clientX, y: event.clientY }, rect)) {
                  const point = dropCursorPoint(event.clientX, event.clientY, rect);
                  const targetZone = spatialLayerForCard(card, point);
                  if (targetZone && targetZone !== card.zone) {
                    execute({ type: 'to-zone', id: card.id, zone: targetZone, actor: viewer, ...point });
                    addLocalHistory(`Player ${viewer} moved a card into ${zoneLabel(targetZone)}.`);
                  } else execute({ type: 'move', id: card.id, actor: viewer, ...point });
                }
                setFieldDragId('');
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
            >
              <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span>
              <span>{card.faceUp ? card.label : 'Hidden card'}</span>
            </button>;
          });
        });
      })}
    </>;
  };

  return <div className="app">
    <header>
      <div><span className="eyebrow">{showEditor ? 'BUILD YOUR LOADOUT' : 'LOCAL PLAY'}</span><h1>{showEditor ? 'Deck editor' : 'Local tabletop'}</h1><p>{showEditor ? 'Create and refine a deck before bringing it to the table.' : 'Manual tabletop play · decks, hands, discard and stacks'}</p></div>
    </header>

    {showEditor ? <>
      <label className="deck-module-picker">Module
        <select value={modulePackageKey(activeModule)} onChange={event => selectModule(event.target.value)}>
          {modulePackages.map(bundle => <option key={modulePackageKey(bundle.module)} value={modulePackageKey(bundle.module)}>{bundle.module.name}</option>)}
        </select>
      </label>
      <DeckTools key={modulePackageKey(activeModule)} module={activeModule} catalog={activePackage.cards} onLoadDeck={loadDeckForPlayer} />
    </> : <>

    {error && <p className="error" role="alert">{error}</p>}

    <div className="play-area">
      <ResizableDockColumn>
        <TabletopDock
          card={inspectorCard}
          pinned={inspectorPinned}
          onClear={() => setPinned('')}
          module={activeModule}
          catalog={activePackage.cards}
          history={history}
        />
      </ResizableDockColumn>
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
            .filter(card => card.owner === viewer && movableZoneSet.has(card.zone))
            .filter(card => {
              const point = toViewerPoint(canonicalCardPoint(card), viewer, '1v1');
              const cx = (point.x / 1000) * rect.width;
              const cy = (point.y / 600) * rect.height;
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
        {activeModule.zones.filter(zone => zone.size).flatMap(zone => {
          const players: Array<1 | 2 | undefined> = zone.ownerScoped ? [1, 2] : [undefined];
          return players.flatMap(player => {
            const position = zoneAreaPosition(zone, player);
            if (!position || !zone.size) return [];
            return [<div
              key={`${zone.id}-${player ?? 'shared'}`}
              className={`module-zone-area module-zone-${zone.kind} module-zone-behavior-${zone.behavior ?? 'legacy'} module-zone-role-${zone.role ?? 'none'} ${draggedGroup === 'battlefield' && zone.group === 'battlefield' ? 'spatial-drop-target' : ''}`}
              style={{
                left: `${position.x / 10}%`,
                top: `${position.y / 6}%`,
                width: `${zone.size.width / 10}%`,
                height: `${zone.size.height / 6}%`,
              }}
              aria-hidden="true"
            />];
          });
        })}
        {fieldDragId && <div className="local-hand-drop-zone active">Drop here to return to hand</div>}
        {selectionBox && <div className="selection-box" style={{
          left: Math.min(selectionBox.startX, selectionBox.endX),
          top: Math.min(selectionBox.startY, selectionBox.endY),
          width: Math.abs(selectionBox.endX - selectionBox.startX),
          height: Math.abs(selectionBox.endY - selectionBox.startY),
        }} />}
        {renderPlayer(2)}
        {renderPlayer(1)}
        <DuelTurnControl
          status={`Player ${viewer}'s turn · Turn ${turnNumber}`}
          confirming={confirmEndTurn}
          onBegin={() => setConfirmEndTurn(true)}
          onCancel={() => setConfirmEndTurn(false)}
          onConfirm={() => {
            const next = viewer === 1 ? 2 : 1;
            addLocalHistory(`Player ${viewer} ended their turn. Player ${next} is up.`);
            setViewer(next);
            setTurnNumber(number => number + 1);
            setSelected('');
            setMultiSelected([]);
            setHovered('');
            setPinned('');
            setCardContext(null);
            setConfirmEndTurn(false);
          }}
        />
      </div>
      <section className="shortcut-bar below-board-shortcuts" aria-label="Keyboard shortcuts">
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
    </div>

    {dragPreview && <div
      className="drag-card-ghost"
      style={{ left: dragPreview.x, top: dragPreview.y, transform: 'translate(-50%,-50%) rotate(2deg) scale(1.04)' }}
      aria-hidden="true"
    >
      <span className="card-symbol">✦</span>
      <span>{dragPreview.label}</span>
    </div>}

    {cardContext && contextCard && <CardContextMenu
      state={cardContext}
      card={contextCard}
      canAct={contextCard.owner === viewer}
      zones={contextZones}
      handZoneId={handZoneId}
      discardZoneId={discardZoneId}
      deckZoneId={deckZoneId}
      onInspect={() => setPinned(contextCard.id)}
      onRotate={rotateContextCard}
      onFlip={flipContextCard}
      onMove={moveContextCard}
      stackTargets={movableZoneSet.has(contextCard.zone) ? contextStackTargets.map(card => ({ id: card.id, label: card.label })) : []}
      onStack={stackContextCard}
      onUnstack={unstackContextCard}
      onClose={() => setCardContext(null)}
    />}

    <footer>
      {activeModule.description} · Draw from your {zoneLabel('deck').toLowerCase()} · Double-click a {zoneLabel('hand').toLowerCase()} card to play it · Drag your {zoneLabel('field').toLowerCase()} cards.
    </footer>
    </>}
  </div>;
}
