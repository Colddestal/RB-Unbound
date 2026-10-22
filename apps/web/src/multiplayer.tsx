import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { io, type Socket } from 'socket.io-client';
import { CardInspector } from './card-inspector';
import type { ClientTableAction, PlayerId, PublicCard, TableView } from '@rb-unbound/tabletop';

type MatchFormat = '1v1' | '2v2' | 'ffa4';
type Ruleset = 'standard' | 'unrestricted' | 'custom';

type RoomSnapshot = {
  code: string;
  status: 'lobby' | 'active' | 'closed';
  settingsLocked: boolean;
  settings: {
    roomName: string;
    format: MatchFormat;
    ruleset: Ruleset;
    isPublic: boolean;
    allowSpectators: boolean;
    readyCheck: boolean;
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
};

type Identity = { code: string; seat?: PlayerId; spectator: boolean };
type MatchSnapshot = { seat?: PlayerId; spectator: boolean; revision: number; table: TableView };

const SERVER_URL = 'http://127.0.0.1:3001';

export function Multiplayer() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [error, setError] = useState('');
  const [displayName, setDisplayName] = useState('Player');
  const [roomName, setRoomName] = useState('Project Poor Table');
  const [format, setFormat] = useState<MatchFormat>('1v1');
  const [joinCode, setJoinCode] = useState('');
  const [joinSeat, setJoinSeat] = useState<1 | 2 | 3 | 4>(2);
  const [chatText, setChatText] = useState('');
  const [selected, setSelected] = useState('');
  const [hovered, setHovered] = useState('');
  const [pinned, setPinned] = useState('');
  const boardRef = useRef<HTMLDivElement>(null);
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
    client.on('session:resumed', (payload: { lastActionSequence?: number }) => {
      actionSequenceRef.current = Number.isSafeInteger(payload.lastActionSequence) ? Number(payload.lastActionSequence) : 0;
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
    client.on('room:update', (payload: RoomSnapshot) => setRoom(payload));
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

  const ownSeat = identity?.seat ? room?.seats.find(seat => seat.seat === identity.seat) : undefined;
  const isOwner = Boolean(ownSeat?.owner);
  const selectedCard = match?.table.cards.find(card => card.id === selected);
  const inspectorCard = match?.table.cards.find(card => card.id === (hovered || pinned));
  const inspectorPinned = Boolean(pinned && !hovered);
  const canControlSelected = Boolean(identity?.seat && selectedCard?.owner === identity.seat);
  const ownFieldCards = match?.table.cards.filter(card => card.zone === 'field' && card.owner === identity?.seat && card.id !== selected) ?? [];

  const hiddenByOwner = useMemo(() => new Map(match?.table.hidden.map(summary => [summary.owner, summary]) ?? []), [match]);

  const emitAction = (action: ClientTableAction) => {
    actionSequenceRef.current += 1;
    socket?.emit('match:action', { sequence: actionSequenceRef.current, action });
  };

  const create = () => {
    setError('');
    socket?.emit('room:create', { displayName, roomName, format });
  };

  const join = (spectator = false) => {
    setError('');
    const code = joinCode.trim().toUpperCase();
    if (spectator) socket?.emit('room:join-spectator', { code, displayName });
    else socket?.emit('room:join-seat', { code, displayName, seat: joinSeat });
  };

  const sendChat = () => {
    const body = chatText.trim();
    if (!body) return;
    socket?.emit('chat:send', { body });
    setChatText('');
  };

  const renderFieldCard = (card: PublicCard) => {
    const owned = identity?.seat === card.owner;
    const style: CSSProperties = {
      left: `${card.x / 10}%`,
      top: `${card.y / 6}%`,
      transform: `rotate(${card.rotation}deg)`,
    };

    return <button
      key={card.id}
      className={`card ${selected === card.id ? 'selected' : ''} ${card.faceUp ? '' : 'back'} ${owned ? '' : 'locked'}`}
      style={style}
      onMouseEnter={() => setHovered(card.id)}
      onMouseLeave={() => setHovered('')}
      onClick={() => { setSelected(card.id); setPinned(card.id); }}
      onDoubleClick={() => { if (owned) emitAction({ type: 'flip', id: card.id }); }}
      onPointerDown={event => {
        if (!owned || event.button !== 0) return;
        setSelected(card.id);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!owned || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const rect = boardRef.current?.getBoundingClientRect();
        if (!rect) return;
        emitAction({
          type: 'move',
          id: card.id,
          x: ((event.clientX - rect.left - 43) / rect.width) * 1000,
          y: ((event.clientY - rect.top - 58) / rect.height) * 600,
        });
      }}
    >
      <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span>
      <span>{card.label ?? 'Hidden card'}</span>
      <small>P{card.owner} · field</small>
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
          <label>Format<select value={format} onChange={e => setFormat(e.target.value as MatchFormat)}>
            <option value="1v1">1v1</option><option value="2v2">2v2</option><option value="ffa4">1v1v1v1</option>
          </select></label>
          <button className="primary" disabled={!connected} onClick={create}>Create room</button>
        </section>

        <section className="panel">
          <h2>Join a room</h2>
          <label>Display name<input value={displayName} maxLength={32} onChange={e => setDisplayName(e.target.value)} /></label>
          <label>Room code<input value={joinCode} maxLength={6} onChange={e => setJoinCode(e.target.value.toUpperCase())} /></label>
          <label>Seat<select value={joinSeat} onChange={e => setJoinSeat(Number(e.target.value) as 1 | 2 | 3 | 4)}>
            <option value={1}>Seat 1</option><option value={2}>Seat 2</option><option value={3}>Seat 3</option><option value={4}>Seat 4</option>
          </select></label>
          <div className="button-row">
            <button className="primary" disabled={!connected} onClick={() => join(false)}>Join seat</button>
            <button disabled={!connected} onClick={() => join(true)}>Spectate</button>
          </div>
        </section>
      </div>
    </div>;
  }

  const fieldCards = match?.table.cards.filter(card => card.zone === 'field') ?? [];
  const ownHand = match?.table.cards.filter(card => card.zone === 'hand' && card.owner === identity?.seat) ?? [];
  const discards = match?.table.cards.filter(card => card.zone === 'discard') ?? [];

  return <div className="app multiplayer-shell">
    <header>
      <div><span className="eyebrow">ROOM {room.code}</span><h1>{room.settings.roomName}</h1><p>{room.settings.format.toUpperCase()} · {room.settings.ruleset} · {room.status}</p></div>
      <span className={`connection-pill ${connected ? 'online' : ''}`}>{connected ? 'Connected' : 'Reconnecting…'}</span>
    </header>

    {error && <p className="error" role="alert">{error}</p>}

    {room.status === 'lobby' && <div className="lobby-grid">
      <section className="panel">
        <h2>Seats</h2>
        <div className="seat-list">{room.seats.map(seat =>
          <div className={`seat-row ${seat.occupied ? 'occupied' : ''}`} key={seat.seat}>
            <strong>Seat {seat.seat}</strong><span>{seat.displayName ?? 'Open'}</span><span>Team {seat.team}</span><span>{seat.ready ? 'Ready' : 'Not ready'}</span>{seat.owner && <span className="chip">Owner</span>}
          </div>)}</div>
        {identity?.seat && <button onClick={() => socket?.emit('room:ready', { ready: !ownSeat?.ready })}>{ownSeat?.ready ? 'Unready' : 'Ready up'}</button>}
      </section>

      <section className="panel">
        <h2>Room settings</h2>
        <label>Format<select disabled={!isOwner} value={room.settings.format} onChange={e => socket?.emit('room:settings', { format: e.target.value })}>
          <option value="1v1">1v1</option><option value="2v2">2v2</option><option value="ffa4">1v1v1v1</option>
        </select></label>
        <label>Ruleset<select disabled={!isOwner} value={room.settings.ruleset} onChange={e => socket?.emit('room:settings', { ruleset: e.target.value })}>
          <option value="standard">Standard</option><option value="unrestricted">Unrestricted</option><option value="custom">Custom</option>
        </select></label>
        <label className="inline-check"><input disabled={!isOwner} type="checkbox" checked={room.settings.allowSpectators} onChange={e => socket?.emit('room:settings', { allowSpectators: e.target.checked })}/> Allow spectators</label>
        <label className="inline-check"><input disabled={!isOwner} type="checkbox" checked={room.settings.readyCheck} onChange={e => socket?.emit('room:settings', { readyCheck: e.target.checked })}/> Require ready check</label>
        {isOwner && <div className="button-row"><button className="primary" onClick={() => socket?.emit('room:start', { force: false })}>Start</button><button onClick={() => socket?.emit('room:start', { force: true })}>Force start</button></div>}
      </section>

      <Chat room={room} value={chatText} setValue={setChatText} send={sendChat} />
    </div>}

    {room.status === 'active' && match && <div className="match-layout">
      <div className="left-stack">
        <CardInspector card={inspectorCard} pinned={inspectorPinned} onClear={() => setPinned('')} />
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
        {!identity?.spectator && <div className="button-column"><button onClick={() => emitAction({ type: 'draw' })}>Draw</button><button onClick={() => emitAction({ type: 'shuffle' })}>Shuffle deck</button></div>}
        </aside>
      </div>

      <main className="match-main">
        {!identity?.spectator && <section className="toolbar">
          <strong>{selectedCard ? (selectedCard.label ?? 'Hidden card') : 'Select one of your cards'}</strong>
          <button disabled={!canControlSelected} onClick={() => selectedCard && emitAction({ type: 'rotate', id: selectedCard.id })}>Rotate</button>
          <button disabled={!canControlSelected} onClick={() => selectedCard && emitAction({ type: 'flip', id: selectedCard.id })}>Flip</button>
          <button disabled={!canControlSelected} onClick={() => selectedCard && emitAction({ type: 'to-zone', id: selectedCard.id, zone: 'hand' })}>To hand</button>
          <button disabled={!canControlSelected} onClick={() => selectedCard && emitAction({ type: 'to-zone', id: selectedCard.id, zone: 'discard' })}>Discard</button>
          <select disabled={!canControlSelected || selectedCard?.zone !== 'field'} onChange={e => {
            if (selectedCard && e.target.value) emitAction({ type: 'stack', id: selectedCard.id, targetId: e.target.value });
            e.currentTarget.value = '';
          }} defaultValue="">
            <option value="">Stack on…</option>{ownFieldCards.map(card => <option value={card.id} key={card.id}>{card.label ?? 'Card'}</option>)}
          </select>
          <button disabled={!selectedCard?.stackOn || !canControlSelected} onClick={() => selectedCard && emitAction({ type: 'unstack', id: selectedCard.id })}>Unstack</button>
        </section>}

        <div className="board multiplayer-board" ref={boardRef}>
          <div className="midline"><span>SERVER-SYNCED FIELD</span></div>
          {fieldCards.map(renderFieldCard)}
          {discards.map((card, index) => <button key={card.id} className={`card discard-card ${card.faceUp ? '' : 'back'}`} style={{right:`${16 + card.owner * 18}px`, top:`${18 + index * 2}px`}} onMouseEnter={() => setHovered(card.id)} onMouseLeave={() => setHovered('')} onClick={() => { setSelected(card.id); setPinned(card.id); }}>
            <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span><span>{card.label ?? 'Hidden card'}</span><small>P{card.owner} · discard</small>
          </button>)}
        </div>

        {!identity?.spectator && <section className="hand-strip">
          <strong>Your hand</strong>
          <div className="hand-cards">{ownHand.map(card => <button key={card.id} className={`mini-card ${selected === card.id ? 'selected' : ''}`} onMouseEnter={() => setHovered(card.id)} onMouseLeave={() => setHovered('')} onClick={() => { setSelected(card.id); setPinned(card.id); }} onDoubleClick={() => emitAction({ type: 'to-zone', id: card.id, zone: 'field' })}><span>✦</span>{card.label}</button>)}</div>
        </section>}
      </main>

      <Chat room={room} value={chatText} setValue={setChatText} send={sendChat} />
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
