import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { io, type Socket } from 'socket.io-client';
import { TabletopDock } from './tabletop-dock';
import { DeckPile } from './deck-pile';
import { ResizableDockColumn } from './resizable-dock-column';
import { CardContextMenu, type CardContextState } from './card-context-menu';
import { pointInRect } from './drag-drop';
import { toCanonicalPoint, toViewerPoint, toViewerSeat } from './board-perspective';
import { actionForCode, displayKey, type KeyBindings } from './controls';
import { automaticZoneCardPoint } from './zone-card-layout';
import { spatialDropZone } from './spatial-zone-drop';
import {
  builtInModulePackages,
  defaultGameModule,
  isModulePackage,
  zoneBehavior,
  modulePackageKey,
  type ClientTableAction,
  type GameModule,
  type ModulePackage,
  type ModuleZoneDefinition,
  type PlayerId,
  type PublicCard,
  type TableView,
} from '@rb-unbound/tabletop';

type MatchFormat = '1v1' | '2v2' | 'ffa4';
type Ruleset = 'standard' | 'unrestricted' | 'custom';

type RoomSnapshot = {
  code: string;
  status: 'lobby' | 'active' | 'closed';
  settingsLocked: boolean;
  modulePackage: ModulePackage;
  settings: {
    roomName: string;
    format: MatchFormat;
    moduleId: string;
    moduleVersion: string;
    ruleset: Ruleset;
    isPublic: boolean;
    allowSpectators: boolean;
    spectatorLimit: number;
    readyCheck: boolean;
    shareTeamHands: boolean;
    bestOf: 1 | 3;
    turnTimerSeconds: number | null;
  };
  seats: Array<{
    seat: 1 | 2 | 3 | 4;
    displayName?: string;
    team: 1 | 2 | 3 | 4;
    ready: boolean;
    occupied: boolean;
    owner: boolean;
  }>;
  spectators: Array<{ displayName: string }>;
  chat: Array<{ id: string; displayName: string; body: string; sentAt: string; system?: boolean }>;
  history: Array<{ id: string; text: string; createdAt: string; kind: string; actorSeat?: 1 | 2 | 3 | 4 }>;
  series?: {
    bestOf: 1 | 3;
    winsNeeded: 1 | 2;
    status: 'active' | 'complete';
    currentGame: number;
    winsByTeam: Partial<Record<1 | 2 | 3 | 4, number>>;
    games: Array<{
      gameNumber: number;
      status: 'setup' | 'active' | 'complete';
      firstPlayerSeat?: 1 | 2 | 3 | 4;
      winnerTeam?: 1 | 2 | 3 | 4;
      selectionsBySeat: Partial<Record<1 | 2 | 3 | 4, string[]>>;
    }>;
  };
};

type Identity = { code: string; seat?: PlayerId; spectator: boolean };
type MatchSnapshot = { seat?: PlayerId; spectator: boolean; revision: number; table: TableView };

const SERVER_URL = 'http://127.0.0.1:3001';

export function Multiplayer({ bindings, modulePackages }: { bindings: KeyBindings; modulePackages: ModulePackage[] }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('Player');
  const [roomName, setRoomName] = useState('Project Poor Table');
  const [format, setFormat] = useState<MatchFormat>('1v1');
  const [createModuleKey, setCreateModuleKey] = useState(modulePackageKey(defaultGameModule));
  const [createPublic, setCreatePublic] = useState(false);
  const [createSpectatorLimit, setCreateSpectatorLimit] = useState(4);
  const [joinCode, setJoinCode] = useState('');
  const [joinInviteCode, setJoinInviteCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [joinSeat, setJoinSeat] = useState<1 | 2 | 3 | 4>(2);
  const [chatText, setChatText] = useState('');
  const [selected, setSelected] = useState('');
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [hovered, setHovered] = useState('');
  const [pinned, setPinned] = useState('');
  const [dragPreview, setDragPreview] = useState<{ id: string; label: string; x: number; y: number } | null>(null);
  const [fieldDragId, setFieldDragId] = useState('');
  const [cardContext, setCardContext] = useState<CardContextState | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const handStripRef = useRef<HTMLElement | null>(null);
  const handDragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const actionSequenceRef = useRef(0);

  useEffect(() => {
    const client = io(SERVER_URL, { transports: ['websocket', 'polling'] });
    setSocket(client);

    client.on('connect', () => {
      setConnected(true);
      setError('');
      const token = window.sessionStorage.getItem('rb-unbound-session');
      if (token) client.emit('session:resume', { token });
    });
    client.on('disconnect', () => setConnected(false));
    client.on('connect_error', () => setError('Could not reach the local multiplayer server. Run npm run dev:server in another terminal.'));
    client.on('room:error', (payload: { message?: string }) => setError(payload.message ?? 'Room error.'));
    client.on('abuse:warning', (payload: { reason?: string }) => {
      setError(payload.reason === 'payload-too-large'
        ? 'That request was too large and was rejected.'
        : 'You are sending actions too quickly. Slow down for a moment.');
    });
    client.on('session:issued', (payload: { token: string }) => {
      window.sessionStorage.setItem('rb-unbound-session', payload.token);
      actionSequenceRef.current = 0;
    });
    client.on('session:resumed', (payload: { lastActionSequence?: number; roomCode?: string }) => {
      actionSequenceRef.current = Number.isSafeInteger(payload.lastActionSequence) ? Number(payload.lastActionSequence) : 0;
      if (payload.roomCode) {
        setInviteCode(window.localStorage.getItem(`rb-unbound-room-invite-${payload.roomCode}`) ?? '');
      }
    });
    client.on('session:invalid', () => {
      window.sessionStorage.removeItem('rb-unbound-session');
      setRoom(null);
      setIdentity(null);
      setMatch(null);
    });
    client.on('session:cleared', () => {
      window.sessionStorage.removeItem('rb-unbound-session');
      setRoom(null);
      setIdentity(null);
      setMatch(null);
      actionSequenceRef.current = 0;
    });
    client.on('room:identity', (payload: Identity) => setIdentity(payload));
    client.on('room:invite-code', (payload: { roomCode?: string; inviteCode?: string }) => {
      if (!payload.roomCode || !payload.inviteCode) return;
      setInviteCode(payload.inviteCode);
      window.localStorage.setItem(`rb-unbound-room-invite-${payload.roomCode}`, payload.inviteCode);
    });
    client.on('room:update', (payload: RoomSnapshot) => {
      if (!isModulePackage(payload.modulePackage)) {
        setError('The room requires an invalid or unsupported module package.');
        return;
      }
      setRoom(payload);
    });
    client.on('room:started', () => client.emit('match:request-state'));
    client.on('match:update', (payload: MatchSnapshot) => {
      setMatch(payload);
      setSelected(current => payload.table.cards.some(card => card.id === current) ? current : '');
    });
    client.on('match:action-rejected', (payload: { reason?: string }) => {
      setError(payload.reason === 'duplicate-or-out-of-order'
        ? 'A stale or duplicate action was ignored. Your view has been resynchronized.'
        : 'That action was rejected by the server.');
      client.emit('match:request-state');
    });

    return () => { client.disconnect(); };
  }, []);

  const activePackage = room?.modulePackage ?? builtInModulePackages[0];
  const activeModule = activePackage.module;
  const cardBack = activeModule.cardBacks[0];
  const zoneLabel = (kind: string) => activeModule.zones.find(zone => zone.kind === kind || zone.id === kind)?.label ?? kind;
  const perspectiveViewer = room?.settings.format === '1v1' && !identity?.spectator ? identity?.seat : undefined;
  const zoneAreaPosition = (zone: ModuleZoneDefinition, player?: PlayerId) => {
    if (zone.ownerScoped && player) {
      const visualSeat = toViewerSeat(player, perspectiveViewer, room?.settings.format ?? '1v1');
      const seatKey = String(visualSeat) as '1' | '2' | '3' | '4';
      return zone.seatPositions?.[seatKey] ??
        (zone.defaultPosition ? toViewerPoint(zone.defaultPosition, perspectiveViewer, room?.settings.format ?? '1v1') : undefined);
    }
    return zone.defaultPosition
      ? toViewerPoint(zone.defaultPosition, perspectiveViewer, room?.settings.format ?? '1v1')
      : undefined;
  };
  const canonicalZonePosition = (zone: ModuleZoneDefinition, player?: PlayerId) => {
    if (zone.ownerScoped && player) {
      const seatKey = String(player) as '1' | '2' | '3' | '4';
      return zone.seatPositions?.[seatKey] ?? zone.defaultPosition;
    }
    return zone.defaultPosition;
  };
  const compatibleCreatePackages = modulePackages.filter(bundle => bundle.module.supportedFormats.includes(format));
  const ownSeat = identity?.seat ? room?.seats.find(seat => seat.seat === identity.seat) : undefined;
  const isOwner = Boolean(ownSeat?.owner);
  const movableZoneSet = new Set(activeModule.zones.filter(zone => zone.stackable).map(zone => zone.id));
  const zoneGroups = new Map(activeModule.zones.map(zone => [zone.id, zone.group ?? zone.id] as const));
  const zoneGroupFor = (zoneId: string) => zoneGroups.get(zoneId) ?? zoneId;
  const canonicalCardPoint = (card: PublicCard) => {
    const zone = activeModule.zones.find(item => item.id === card.zone);
    if (zone?.stackable && card.x === 0 && card.y === 0) {
      const zoneCards = match?.table.cards
        .filter(item => item.owner === card.owner && item.zone === card.zone)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) ?? [];
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
    }, perspectiveViewer, room?.settings.format ?? '1v1');
  const spatialLayerForCard = (card: PublicCard, point: { x: number; y: number }) => {
    const sourceGroup = card.zone === 'hand' ? 'battlefield' : zoneGroupFor(card.zone);
    if (sourceGroup !== 'battlefield') return undefined;
    return spatialDropZone(activeModule, point, card.owner, sourceGroup);
  };
  const selectedCard = match?.table.cards.find(card => card.id === selected);
  const selectedCards = match?.table.cards.filter(card => multiSelected.includes(card.id)) ?? [];
  const inspectorCard = match?.table.cards.find(card => card.id === (hovered || pinned));
  const inspectorPinned = Boolean(pinned && !hovered);
  const canControlSelected = Boolean(identity?.seat && (selectedCards.length ? selectedCards.every(card => card.owner === identity.seat) : selectedCard?.owner === identity.seat));
  const ownStackCards = selectedCard
    ? match?.table.cards.filter(card =>
      card.owner === identity?.seat &&
      card.id !== selectedCard.id &&
      movableZoneSet.has(card.zone) &&
      zoneGroupFor(card.zone) === zoneGroupFor(selectedCard.zone)) ?? []
    : [];
  const contextCard = cardContext ? match?.table.cards.find(card => card.id === cardContext.cardId) : undefined;
  const handZoneId = activeModule.zones.find(zone => zone.kind === 'hand')?.id;
  const discardZoneId = activeModule.zones.find(zone => zone.kind === 'discard')?.id;
  const deckZoneId = activeModule.zones.find(zone => zone.kind === 'deck')?.id;
  const contextZones = activeModule.zones
    .filter(zone => zone.behavior !== 'subzone')
    .map(zone => ({ id: zone.id, label: zone.label }));

  const hiddenByOwner = useMemo(() => new Map(match?.table.hidden.map(summary => [summary.owner, summary]) ?? []), [match]);

  const emitAction = (action: ClientTableAction) => {
    actionSequenceRef.current += 1;
    socket?.emit('match:action', { sequence: actionSequenceRef.current, action });
  };

  const openCardContext = (event: { preventDefault: () => void; clientX: number; clientY: number }, card: PublicCard) => {
    event.preventDefault();
    const owned = identity?.seat === card.owner && !identity?.spectator;
    setSelected(owned ? card.id : '');
    setMultiSelected([]);
    setPinned(card.id);
    setCardContext({ cardId: card.id, x: event.clientX, y: event.clientY });
  };

  const canActOnContextCard = Boolean(
    contextCard &&
    identity?.seat &&
    !identity.spectator &&
    contextCard.owner === identity.seat,
  );

  const moveContextCard = (zone: string) => {
    if (!contextCard || !canActOnContextCard) return;
    emitAction({ type: 'to-zone', id: contextCard.id, zone });
    const targetZone = activeModule.zones.find(item => item.id === zone);
    const position = targetZone?.kind === 'custom' && targetZone.stackable
      ? canonicalZonePosition(targetZone, contextCard.owner)
      : undefined;
    if (position) emitAction({ type: 'move', id: contextCard.id, x: position.x, y: position.y });
  };

  const rotateContextCard = () => {
    if (!contextCard || !canActOnContextCard) return;
    emitAction({ type: 'rotate', id: contextCard.id });
  };

  const flipContextCard = () => {
    if (!contextCard || !canActOnContextCard) return;
    emitAction({ type: 'flip', id: contextCard.id });
  };

  const unstackContextCard = () => {
    if (!contextCard?.stackOn || !canActOnContextCard) return;
    emitAction({ type: 'unstack', id: contextCard.id });
  };

  const drawCards = (count: number, fromZone = 'deck') => {
    for (let index = 0; index < count; index += 1) emitAction({ type: 'draw', fromZone });
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

      const targets = selectedCards.length ? selectedCards : (selectedCard ? [selectedCard] : []);
      if (!action || !identity?.seat || identity.spectator || targets.length === 0 || targets.some(card => card.owner !== identity.seat)) return;

      if (action === 'rotate') for (const card of targets) emitAction({ type: 'rotate', id: card.id });
      else if (action === 'flip') for (const card of targets) emitAction({ type: 'flip', id: card.id });
      else if (action === 'discard') for (const card of targets) emitAction({ type: 'to-zone', id: card.id, zone: 'discard' });
      else if (action === 'moveHand') for (const card of targets) emitAction({ type: 'to-zone', id: card.id, zone: 'hand' });
      else if (action === 'playField') for (const card of targets) emitAction({ type: 'to-zone', id: card.id, zone: 'field' });
      else if (targets.every(card => movableZoneSet.has(card.zone)) && ['moveUp', 'moveDown', 'moveLeft', 'moveRight'].includes(action)) {
        const step = event.shiftKey ? 50 : 15;
        const dx = action === 'moveLeft' ? -step : action === 'moveRight' ? step : 0;
        const dy = action === 'moveUp' ? -step : action === 'moveDown' ? step : 0;
        for (const card of targets) {
          const point = canonicalCardPoint(card);
          emitAction({ type: 'move', id: card.id, x: point.x + dx, y: point.y + dy });
        }
      } else return;

      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCard, selectedCards, identity?.seat, identity?.spectator, socket, bindings]);

  const create = () => {
    setError('');
    const selectedPackage = modulePackages.find(bundle => modulePackageKey(bundle.module) === createModuleKey) ?? builtInModulePackages[0];
    socket?.emit('room:create', {
      displayName,
      roomName,
      format,
      moduleId: selectedPackage.module.id,
      moduleVersion: selectedPackage.module.version,
      modulePackage: selectedPackage,
      isPublic: createPublic,
      spectatorLimit: createSpectatorLimit,
    });
  };

  const join = (spectator = false) => {
    setError('');
    const code = joinCode.trim().toUpperCase();
    const invite = joinInviteCode.trim().toUpperCase();
    if (spectator) socket?.emit('room:join-spectator', { code, displayName, inviteCode: invite || undefined });
    else socket?.emit('room:join-seat', { code, displayName, seat: joinSeat, inviteCode: invite || undefined });
  };

  const sendChat = () => {
    const body = chatText.trim();
    if (!body) return;
    socket?.emit('chat:send', { body });
    setChatText('');
  };

  const renderFieldCard = (card: PublicCard) => {
    const owned = identity?.seat === card.owner;
    const point = toViewerPoint({ x: card.x, y: card.y }, perspectiveViewer, room?.settings.format ?? '1v1');
    const style: CSSProperties = {
      left: `${point.x / 10}%`,
      top: `${point.y / 6}%`,
      transform: `rotate(${card.rotation}deg)`,
    };

    return <button
      key={card.id}
      className={`card ${selected === card.id || multiSelected.includes(card.id) ? 'selected' : ''} ${card.faceUp ? '' : `back back-${cardBack.pattern}`} ${owned ? '' : 'locked'}`}
      style={style}
      onMouseEnter={() => setHovered(card.id)}
      onMouseLeave={() => setHovered('')}
      onClick={event => {
        if (event.shiftKey && owned) {
          setMultiSelected(current => current.includes(card.id) ? current.filter(id => id !== card.id) : [...current, card.id]);
          setSelected('');
        } else {
          setSelected(card.id);
          setMultiSelected([]);
        }
        setPinned(card.id);
      }}
      onContextMenu={event => openCardContext(event, card)}
      onDoubleClick={() => { if (owned) emitAction({ type: 'flip', id: card.id }); }}
      onPointerDown={event => {
        if (!owned || event.button !== 0) return;
        setSelected(card.id);
        setFieldDragId(card.id);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!owned || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect || !pointInRect({ x: event.clientX, y: event.clientY }, rect)) return;
        const point = toCanonicalPoint({
          x: ((event.clientX - rect.left - event.currentTarget.offsetWidth / 2) / rect.width) * 1000,
          y: ((event.clientY - rect.top - event.currentTarget.offsetHeight / 2) / rect.height) * 600,
        }, perspectiveViewer, room?.settings.format ?? '1v1');
        emitAction({
          type: 'move',
          id: card.id,
          x: point.x,
          y: point.y,
        });
      }}
      onPointerCancel={event => {
        setFieldDragId('');
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerUp={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const handRect = handStripRef.current?.getBoundingClientRect();
        const boardRect = boardRef.current?.getBoundingClientRect();
        if (owned && handRect && pointInRect({ x: event.clientX, y: event.clientY }, handRect)) {
          emitAction({ type: 'to-zone', id: card.id, zone: 'hand' });
        } else if (owned && boardRect && pointInRect({ x: event.clientX, y: event.clientY }, boardRect)) {
          const targetZone = spatialLayerForCard(card, dropCursorPoint(event.clientX, event.clientY, boardRect)) ??
            (zoneGroupFor(card.zone) === 'battlefield' && card.zone !== 'field' ? 'field' : undefined);
          if (targetZone && targetZone !== card.zone) emitAction({ type: 'to-zone', id: card.id, zone: targetZone });
        }
        setFieldDragId('');
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span>
      <span>{card.label ?? 'Hidden card'}</span>
      <small>P{card.owner} · {zoneLabel(card.zone)}</small>
    </button>;
  };

  if (!room) {
    return <div className="app multiplayer-shell">
      <header>
        <div><span className="eyebrow">PROJECT POOR PRESENTS</span><h1>RB UNBOUND</h1><p>Multiplayer development alpha</p></div>
        <span className={`connection-pill ${connected ? 'online' : ''}`}>{connected ? 'Server connected' : 'Server offline'}</span>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="lobby-grid">
        <section className="panel">
          <h2>Create a room</h2>
          <label>Display name<input value={displayName} maxLength={32} onChange={e => setDisplayName(e.target.value)} /></label>
          <label>Room name<input value={roomName} maxLength={60} onChange={e => setRoomName(e.target.value)} /></label>
          <label>Format<select value={format} onChange={e => {
            const next = e.target.value as MatchFormat;
            setFormat(next);
            const current = modulePackages.find(bundle => modulePackageKey(bundle.module) === createModuleKey);
            if (!current?.module.supportedFormats.includes(next)) {
              const fallback = modulePackages.find(bundle => bundle.module.supportedFormats.includes(next)) ?? builtInModulePackages[0];
              setCreateModuleKey(modulePackageKey(fallback.module));
            }
          }}>
            <option value="1v1">1v1</option><option value="2v2">2v2</option><option value="ffa4">1v1v1v1</option>
          </select></label>
          <p className="muted">{format === '1v1' ? '2 player seats' : '4 player seats'} · spectators are separate and optional.</p>
          <label>Spectator slots<select value={createSpectatorLimit} onChange={e => setCreateSpectatorLimit(Number(e.target.value))}>
            <option value={0}>0 · Disabled</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4 · Max</option>
          </select></label>
          <label>Game module<select value={createModuleKey} onChange={e => setCreateModuleKey(e.target.value)}>
            {compatibleCreatePackages.map(bundle => {
              const module: GameModule = bundle.module;
              const key = modulePackageKey(module);
              return <option key={key} value={key}>{module.name} · v{module.version}</option>;
            })}
          </select></label>
          <label className="inline-check"><input type="checkbox" checked={createPublic} onChange={e => setCreatePublic(e.target.checked)} /> Public room</label>
          <p className="muted">{createPublic ? 'Public rooms only require the room code.' : 'Private rooms require both the room code and a separate invite code.'}</p>
          <button className="primary" disabled={!connected} onClick={create}>Create room</button>
        </section>

        <section className="panel">
          <h2>Join a room</h2>
          <label>Display name<input value={displayName} maxLength={32} onChange={e => setDisplayName(e.target.value)} /></label>
          <label>Room code<input value={joinCode} maxLength={6} onChange={e => setJoinCode(e.target.value.toUpperCase())} /></label>
          <label>Invite code <span className="muted">(private rooms only)</span><input value={joinInviteCode} maxLength={8} onChange={e => setJoinInviteCode(e.target.value.toUpperCase())} /></label>
          <label>Player seat<select value={joinSeat} onChange={e => setJoinSeat(Number(e.target.value) as 1 | 2 | 3 | 4)}>
            <option value={1}>Seat 1</option><option value={2}>Seat 2</option><option value={3}>Seat 3</option><option value={4}>Seat 4</option>
          </select></label>
          <p className="muted">1v1 rooms use Seats 1–2. 2v2 / FFA use Seats 1–4. Use Spectate for an optional spectator slot.</p>
          <div className="button-row">
            <button className="primary" disabled={!connected} onClick={() => join(false)}>Join seat</button>
            <button disabled={!connected} onClick={() => join(true)}>Spectate</button>
          </div>
        </section>
      </div>
    </div>;
  }

  const fieldCards = match?.table.cards.filter(card => card.zone === 'field') ?? [];
  const movableCards = match?.table.cards.filter(card => movableZoneSet.has(card.zone)) ?? [];
  const ownHand = match?.table.cards.filter(card => card.zone === 'hand' && card.owner === identity?.seat) ?? [];
  const teammateHands = match?.table.cards.filter(card => card.zone === 'hand' && card.owner !== identity?.seat) ?? [];
  const discards = match?.table.cards.filter(card => card.zone === 'discard') ?? [];

  return <div className="app multiplayer-shell">
    <header>
      <div><span className="eyebrow">ROOM {room.code}</span><h1>{room.settings.roomName}</h1><p>{activeModule.name} v{activeModule.version} · {room.settings.format.toUpperCase()} · {room.settings.ruleset} · {room.settings.isPublic ? 'public' : 'private'} · {room.status}</p></div>
      <span className={`connection-pill ${connected ? 'online' : ''}`}>{connected ? 'Connected' : 'Reconnecting…'}</span>
    </header>

    {error && <p className="error" role="alert">{error}</p>}

    {room.status === 'lobby' && <div className="lobby-grid">
      <section className="panel">
        <h2>Seats</h2>
        <div className="seat-list">{room.seats
          .filter(seat => room.settings.format !== '1v1' || seat.seat <= 2)
          .map(seat =>
          <div className={`seat-row ${seat.occupied ? 'occupied' : ''}`} key={seat.seat}>
            <strong>Seat {seat.seat}</strong><span>{seat.displayName ?? 'Open'}</span><span>Team {seat.team}</span><span>{seat.ready ? 'Ready' : 'Not ready'}</span>{seat.owner && <span className="chip">Owner</span>}
          </div>)}</div>
        <h3 className="spectator-heading">Spectators · {room.spectators.length}/{room.settings.spectatorLimit}</h3>
        <div className="spectator-slot-list">{Array.from({ length: room.settings.spectatorLimit }, (_, index) => {
          const spectator = room.spectators[index];
          return <div className={`spectator-slot ${spectator ? 'occupied' : ''}`} key={index}>
            <strong>Spectator {index + 1}</strong>
            <span>{spectator?.displayName ?? 'Open'}</span>
            <span className="muted">Optional</span>
          </div>;
        })}</div>
        {identity?.seat && <button onClick={() => socket?.emit('room:ready', { ready: !ownSeat?.ready })}>{ownSeat?.ready ? 'Unready' : 'Ready up'}</button>}
      </section>

      <section className="panel">
        <h2>Room settings</h2>
        {!room.settings.isPublic && inviteCode && isOwner && <div className="invite-code-box">
          <span className="muted">Private invite code</span>
          <strong>{inviteCode}</strong>
          <small>Share this together with room code {room.code}.</small>
        </div>}
        <label>Format<select disabled={!isOwner} value={room.settings.format} onChange={e => socket?.emit('room:settings', { format: e.target.value })}>
          <option value="1v1">1v1</option><option value="2v2">2v2</option><option value="ffa4">1v1v1v1</option>
        </select></label>
        <label>Game module<select disabled={!isOwner} value={modulePackageKey(activeModule)} onChange={e => {
          const bundle = modulePackages.find(item => modulePackageKey(item.module) === e.target.value);
          if (bundle) socket?.emit('room:settings', {
            moduleId: bundle.module.id,
            moduleVersion: bundle.module.version,
            modulePackage: bundle,
          });
        }}>
          {modulePackages.filter(bundle => bundle.module.supportedFormats.includes(room.settings.format)).map(bundle => {
            const module = bundle.module;
            const key = modulePackageKey(module);
            return <option key={key} value={key}>{module.name} · v{module.version}</option>;
          })}
        </select></label>
        <label>Ruleset<select disabled={!isOwner} value={room.settings.ruleset} onChange={e => socket?.emit('room:settings', { ruleset: e.target.value })}>
          <option value="standard">Standard</option><option value="unrestricted">Unrestricted</option><option value="custom">Custom</option>
        </select></label>
        <label className="inline-check"><input disabled={!isOwner} type="checkbox" checked={room.settings.isPublic} onChange={e => socket?.emit('room:settings', { isPublic: e.target.checked })}/> Public room</label>
        <label>Spectator slots<select disabled={!isOwner} value={room.settings.spectatorLimit} onChange={e => {
          const spectatorLimit = Number(e.target.value);
          socket?.emit('room:settings', { spectatorLimit, allowSpectators: spectatorLimit > 0 });
        }}>
          <option value={0}>0 · Disabled</option>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4 · Max</option>
        </select></label>
        <p className="muted">Spectators never count toward player seats, readiness, or match start requirements.</p>
        <label className="inline-check"><input disabled={!isOwner} type="checkbox" checked={room.settings.readyCheck} onChange={e => socket?.emit('room:settings', { readyCheck: e.target.checked })}/> Require ready check</label>
        {room.settings.format === '2v2' && <label className="inline-check"><input disabled={!isOwner} type="checkbox" checked={room.settings.shareTeamHands} onChange={e => socket?.emit('room:settings', { shareTeamHands: e.target.checked })}/> Share teammate hands</label>}
        {isOwner && <div className="button-row"><button className="primary" onClick={() => socket?.emit('room:start', { force: false })}>Start</button><button onClick={() => socket?.emit('room:start', { force: true })}>Force start</button></div>}
      </section>

      <Chat room={room} value={chatText} setValue={setChatText} send={sendChat} />
    </div>}

    {room.status === 'active' && match && <div className="match-layout">
      <ResizableDockColumn>
        <div className="left-stack">
        <TabletopDock
          card={inspectorCard}
          pinned={inspectorPinned}
          onClear={() => setPinned('')}
          module={activeModule}
          catalog={activePackage.cards}
          chat={{
            messages: room.chat,
            value: chatText,
            setValue: setChatText,
            send: sendChat,
          }}
          history={room.history ?? []}
        />
        <aside className="panel match-info">
        <h2>Match</h2>
        <p>{identity?.spectator ? 'Spectating' : `You are Seat ${identity?.seat}`}</p>
        <p className="muted">Server revision {match.revision}</p>
        {[1,2,3,4].map(value => {
          const player = value as PlayerId;
          const summary = hiddenByOwner.get(player);
          const seat = room.seats.find(item => item.seat === player);
          if (!seat?.occupied) return null;
          return <div className="player-summary" key={player}><strong>P{player} · Team {seat.team}</strong><span>Deck {summary?.deckCount ?? 0}</span><span>Hand {summary?.handCount ?? 0}</span></div>;
        })}
        </aside>
        </div>
      </ResizableDockColumn>

      <main className="match-main">
        {!identity?.spectator && <section className="shortcut-bar compact" aria-label="Keyboard shortcuts">
          <strong>Keyboard</strong>
          <kbd>R</kbd><span>Rotate</span>
          <kbd>F</kbd><span>Flip</span>
          <kbd>P</kbd><span>Field</span>
          <kbd>H</kbd><span>Hand</span>
          <kbd>Del</kbd><span>Discard</span>
          <kbd>{displayKey(bindings.moveUp)}{displayKey(bindings.moveLeft)}{displayKey(bindings.moveDown)}{displayKey(bindings.moveRight)}</kbd><span>Nudge</span>
          <kbd>Esc</kbd><span>Clear</span>
        </section>}

        {!identity?.spectator && <section className="toolbar">
          <strong>{selectedCards.length ? `${selectedCards.length} cards selected` : selectedCard ? (selectedCard.label ?? 'Hidden card') : 'Select one of your cards'}</strong>
          <button disabled={!canControlSelected} onClick={() => { const targets = selectedCards.length ? selectedCards : (selectedCard ? [selectedCard] : []); for (const card of targets) emitAction({ type: 'rotate', id: card.id }); }}>Rotate</button>
          <button disabled={!canControlSelected} onClick={() => { const targets = selectedCards.length ? selectedCards : (selectedCard ? [selectedCard] : []); for (const card of targets) emitAction({ type: 'flip', id: card.id }); }}>Flip</button>
          <button disabled={!canControlSelected} onClick={() => { const targets = selectedCards.length ? selectedCards : (selectedCard ? [selectedCard] : []); for (const card of targets) emitAction({ type: 'to-zone', id: card.id, zone: 'hand' }); }}>To hand</button>
          <button disabled={!canControlSelected} onClick={() => { const targets = selectedCards.length ? selectedCards : (selectedCard ? [selectedCard] : []); for (const card of targets) emitAction({ type: 'to-zone', id: card.id, zone: 'discard' }); }}>Discard</button>
          <select disabled={!canControlSelected || !selectedCard || !movableZoneSet.has(selectedCard.zone)} onChange={e => {
            if (selectedCard && e.target.value) emitAction({ type: 'stack', id: selectedCard.id, targetId: e.target.value });
            e.currentTarget.value = '';
          }} defaultValue="">
            <option value="">Stack on…</option>{ownStackCards.map(card => <option value={card.id} key={card.id}>{card.label ?? 'Card'}</option>)}
          </select>
          <button disabled={!selectedCard?.stackOn || !canControlSelected} onClick={() => selectedCard && emitAction({ type: 'unstack', id: selectedCard.id })}>Unstack</button>
        </section>}

        <div
          className="board multiplayer-board"
          ref={boardRef}
          onPointerDown={event => {
            if (event.button !== 0 || event.currentTarget !== event.target || identity?.spectator) return;
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
            if (!selectionBox || !identity?.seat) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const left = Math.min(selectionBox.startX, selectionBox.endX);
            const right = Math.max(selectionBox.startX, selectionBox.endX);
            const top = Math.min(selectionBox.startY, selectionBox.endY);
            const bottom = Math.max(selectionBox.startY, selectionBox.endY);
            const renderedCard = event.currentTarget.querySelector<HTMLElement>('.card');
            const cardHalfWidth = (renderedCard?.offsetWidth ?? 64) / 2;
            const cardHalfHeight = (renderedCard?.offsetHeight ?? 88) / 2;
            const ids = movableCards
              .filter(card => card.owner === identity.seat)
              .filter(card => {
                const point = toViewerPoint(canonicalCardPoint(card), perspectiveViewer, room.settings.format);
                const cx = (point.x / 1000) * rect.width + cardHalfWidth;
                const cy = (point.y / 600) * rect.height + cardHalfHeight;
                return cx >= left && cx <= right && cy >= top && cy <= bottom;
              })
              .map(card => card.id);
            setMultiSelected(ids);
            setSelectionBox(null);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        >
          {activeModule.zones
            .filter(zone => zone.size && zoneBehavior(zone) === 'pile' && Boolean(zone.pile?.drawToZoneId))
            .flatMap(zone => {
              return room.seats.filter(seat => seat.occupied).flatMap(seat => {
                const player = seat.seat as PlayerId;
                const position = zoneAreaPosition(zone, player);
                if (!position || !zone.size) return [];
                const summary = hiddenByOwner.get(player);
                const count = summary?.zoneCounts?.[zone.id] ?? (zone.id === 'deck' ? summary?.deckCount ?? 0 : 0);
                const interactive = !identity?.spectator && identity?.seat === player;
                return [<DeckPile
                  key={`${zone.id}-pile-${player}`}
                  label={zone.label}
                  count={count}
                  pattern={cardBack.pattern}
                  interactive={interactive}
                  style={{
                    left: `${position.x / 10}%`,
                    top: `${position.y / 6}%`,
                    width: `${zone.size.width / 10}%`,
                    height: `${zone.size.height / 6}%`,
                    transform: 'translate(-50%,-50%)',
                  }}
                  onDraw={amount => drawCards(amount, zone.id)}
                  onShuffle={() => emitAction({ type: 'shuffle', zone: zone.id })}
                />];
              });
            })}
          {activeModule.zones.filter(zone => zone.kind !== 'hand' && zone.size).flatMap(zone => {
            const players: Array<PlayerId | undefined> = zone.ownerScoped
              ? room.seats.filter(seat => seat.occupied).map(seat => seat.seat as PlayerId)
              : [undefined];
            return players.flatMap(player => {
              const position = zoneAreaPosition(zone, player);
              if (!position || !zone.size) return [];
              const count = player
                ? (zoneBehavior(zone) === 'pile'
                  ? hiddenByOwner.get(player)?.zoneCounts?.[zone.id] ?? (zone.id === 'deck' ? hiddenByOwner.get(player)?.deckCount ?? 0 : 0)
                  : match.table.cards.filter(card => card.owner === player && card.zone === zone.id).length)
                : match.table.cards.filter(card => card.zone === zone.id).length;
              return [<div
                className={`module-zone-area module-zone-${zone.kind} module-zone-behavior-${zone.behavior ?? 'legacy'} module-zone-role-${zone.role ?? 'none'}`}
                key={`${zone.id}-${player ?? 'shared'}`}
                style={{
                  left: `${position.x / 10}%`,
                  top: `${position.y / 6}%`,
                  width: `${zone.size.width / 10}%`,
                  height: `${zone.size.height / 6}%`,
                }}
              >
                <strong>{zone.label}</strong>
                {(zone.kind === 'deck' || zone.kind === 'discard' || zone.kind === 'custom') && <span>{count ? `${count} card${count === 1 ? '' : 's'}` : ''}</span>}
              </div>];
            });
          })}
          {selectionBox && <div className="selection-box" style={{
            left: Math.min(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            width: Math.abs(selectionBox.endX - selectionBox.startX),
            height: Math.abs(selectionBox.endY - selectionBox.startY),
          }} />}
          {fieldCards.map(renderFieldCard)}
          {activeModule.zones.filter(zone => zone.kind === 'custom' && zoneBehavior(zone) !== 'pile').flatMap(zone => {
            return match.table.cards
              .filter(card => card.zone === zone.id)
              .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
              .flatMap((card, index, cards) => {
              const rawPositions = !zone.ownerScoped && zone.displayCopies?.length
                ? zone.displayCopies
                : [zoneAreaPosition(zone, card.owner) ?? { x: 500, y: 300 }];
              const owned = identity?.seat === card.owner && !identity?.spectator;
              const movable = Boolean(zone.stackable);
              return rawPositions.map((rawPosition, copyIndex) => {
                const hasFreePosition = movable && (card.x !== 0 || card.y !== 0);
                const automaticPoint = !hasFreePosition && movable
                  ? automaticZoneCardPoint(zone, card.owner, index, cards.length)
                  : undefined;
                const position = hasFreePosition
                  ? toViewerPoint({ x: card.x, y: card.y }, perspectiveViewer, room.settings.format)
                  : automaticPoint
                    ? toViewerPoint(automaticPoint, perspectiveViewer, room.settings.format)
                    : (!zone.ownerScoped && zone.displayCopies?.length
                      ? toViewerPoint(rawPosition, perspectiveViewer, room.settings.format)
                      : rawPosition);
                const styleOffset = hasFreePosition || automaticPoint ? 0 : index * 7;
                return <button
                  key={`${card.id}-${copyIndex}`}
                  className={`card custom-zone-card ${movable ? 'movable-zone-card' : ''} ${zone.displayCopies?.length ? 'shared-card-copy' : ''} ${selected === card.id || multiSelected.includes(card.id) ? 'selected' : ''} ${card.faceUp ? '' : `back back-${cardBack.pattern}`} ${owned ? '' : 'locked'}`}
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
                    const point = toCanonicalPoint({
                      x: ((event.clientX - rect.left - event.currentTarget.offsetWidth / 2) / rect.width) * 1000,
                      y: ((event.clientY - rect.top - event.currentTarget.offsetHeight / 2) / rect.height) * 600,
                    }, perspectiveViewer, room.settings.format);
                    emitAction({ type: 'move', id: card.id, x: point.x, y: point.y });
                  }}
                  onPointerCancel={event => {
                    setFieldDragId('');
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                  onPointerUp={event => {
                    if (!owned || !movable || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    const handRect = handStripRef.current?.getBoundingClientRect();
                    const boardRect = boardRef.current?.getBoundingClientRect();
                    if (handRect && pointInRect({ x: event.clientX, y: event.clientY }, handRect)) {
                      emitAction({ type: 'to-zone', id: card.id, zone: 'hand' });
                    } else if (boardRect && pointInRect({ x: event.clientX, y: event.clientY }, boardRect)) {
                      const targetZone = spatialLayerForCard(card, dropCursorPoint(event.clientX, event.clientY, boardRect)) ??
                        (zoneGroupFor(card.zone) === 'battlefield' && card.zone !== 'field' ? 'field' : undefined);
                      if (targetZone && targetZone !== card.zone) emitAction({ type: 'to-zone', id: card.id, zone: targetZone });
                    }
                    setFieldDragId('');
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }}
                >
                  <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span>
                  <span>{card.label ?? 'Hidden card'}</span>
                  <small>{zone.group === 'battlefield' ? `Battlefield · ${zone.label}` : zone.label}</small>
                </button>;
              });
            });
          })}
          {discards.map((card, index) => {
            const discardZone = activeModule.zones.find(zone => zone.kind === 'discard');
            const position = discardZone ? zoneAreaPosition(discardZone, card.owner) : undefined;
            return <button key={card.id} className={`card discard-card ${card.faceUp ? '' : `back back-${cardBack.pattern}`}`} style={{
              left: `calc(${(position?.x ?? 900) / 10}% + ${index * 2}px)`,
              top: `calc(${(position?.y ?? 80) / 6}% + ${index * 2}px)`,
              transform: `translate(-50%,-50%) rotate(${card.rotation}deg)`,
            }} onMouseEnter={() => setHovered(card.id)} onMouseLeave={() => setHovered('')} onClick={() => { setSelected(identity?.seat === card.owner ? card.id : ''); setPinned(card.id); }} onContextMenu={event => openCardContext(event, card)}>
            <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span><span>{card.label ?? 'Hidden card'}</span><small>P{card.owner} · {zoneLabel('discard')}</small>
          </button>;
          })}
        </div>

        {!identity?.spectator && <section ref={handStripRef} className={`hand-strip ${fieldDragId ? 'hand-drop-active' : ''}`}>
          <strong>Your hand</strong>
          <div className="hand-cards">{ownHand.map(card => <button
            key={card.id}
            className={`mini-card ${selected === card.id ? 'selected' : ''} ${dragPreview?.id === card.id ? 'drag-source' : ''}`}
            onMouseEnter={() => setHovered(card.id)}
            onMouseLeave={() => setHovered('')}
            onClick={() => { setSelected(card.id); setPinned(card.id); }}
            onContextMenu={event => openCardContext(event, card)}
            onDoubleClick={() => emitAction({ type: 'to-zone', id: card.id, zone: 'field' })}
            onPointerDown={event => {
              if (event.button !== 0) return;
              handDragRef.current = { id: card.id, startX: event.clientX, startY: event.clientY };
              setDragPreview({ id: card.id, label: card.label ?? 'Card', x: event.clientX, y: event.clientY });
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              if (event.currentTarget.hasPointerCapture(event.pointerId) && handDragRef.current?.id === card.id) {
                setDragPreview({ id: card.id, label: card.label ?? 'Card', x: event.clientX, y: event.clientY });
              }
            }}
            onPointerCancel={event => {
              handDragRef.current = null;
              setDragPreview(null);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerUp={event => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId) || handDragRef.current?.id !== card.id) return;
              const drag = handDragRef.current;
              const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
              const rect = boardRef.current?.getBoundingClientRect();
              if (rect && distance > 6 &&
                event.clientX >= rect.left && event.clientX <= rect.right &&
                event.clientY >= rect.top && event.clientY <= rect.bottom) {
                const cursorPoint = dropCursorPoint(event.clientX, event.clientY, rect);
                const targetZone = spatialLayerForCard(card, cursorPoint) ?? 'field';
                emitAction({ type: 'to-zone', id: card.id, zone: targetZone });
                const point = toCanonicalPoint({
                  x: ((event.clientX - rect.left - 43) / rect.width) * 1000,
                  y: ((event.clientY - rect.top - 58) / rect.height) * 600,
                }, perspectiveViewer, room?.settings.format ?? '1v1');
                emitAction({
                  type: 'move',
                  id: card.id,
                  x: point.x,
                  y: point.y,
                });
              }
              handDragRef.current = null;
              setDragPreview(null);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          ><span>✦</span>{card.label}</button>)}</div>
        </section>}

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
          canAct={canActOnContextCard}
          zones={contextZones}
          handZoneId={handZoneId}
          discardZoneId={discardZoneId}
          deckZoneId={deckZoneId}
          onInspect={() => setPinned(contextCard.id)}
          onRotate={rotateContextCard}
          onFlip={flipContextCard}
          onMove={moveContextCard}
          onUnstack={unstackContextCard}
          onClose={() => setCardContext(null)}
        />}

        {!identity?.spectator && teammateHands.length > 0 && <section className="hand-strip teammate-hand-strip">
          <strong>Teammate hand · read-only</strong>
          <div className="hand-cards">{teammateHands.map(card => <button key={card.id} className="mini-card locked" onMouseEnter={() => setHovered(card.id)} onMouseLeave={() => setHovered('')} onClick={() => setPinned(card.id)} onContextMenu={event => openCardContext(event, card)}><span>✦</span>{card.label}</button>)}</div>
        </section>}
      </main>
    </div>}
  </div>;
}

function Chat({ room, value, setValue, send }: { room: RoomSnapshot; value: string; setValue: (value: string) => void; send: () => void }) {
  return <section className="panel chat-panel">
    <h2>Room chat</h2>
    <div className="chat-log" aria-live="polite">{room.chat.length ? room.chat.map(message => <p key={message.id}><strong>{message.displayName}</strong> {message.body}</p>) : <p className="muted">No messages yet.</p>}</div>
    <form onSubmit={event => { event.preventDefault(); send(); }}>
      <input value={value} maxLength={500} placeholder="Message the room…" onChange={e => setValue(e.target.value)} />
      <button type="submit">Send</button>
    </form>
  </section>;
}
