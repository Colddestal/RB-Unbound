import { useEffect, useRef } from 'react';
import type { InspectableCard } from './card-inspector';

export type CardContextZone = {
  id: string;
  label: string;
};

export type CardContextState = {
  cardId: string;
  x: number;
  y: number;
};

export function CardContextMenu({
  state,
  card,
  canAct,
  zones,
  handZoneId,
  discardZoneId,
  deckZoneId,
  onInspect,
  onRotate,
  onFlip,
  onMove,
  onUnstack,
  onClose,
}: {
  state: CardContextState;
  card: InspectableCard;
  canAct: boolean;
  zones: readonly CardContextZone[];
  handZoneId?: string;
  discardZoneId?: string;
  deckZoneId?: string;
  onInspect: () => void;
  onRotate: () => void;
  onFlip: () => void;
  onMove: (zoneId: string) => void;
  onUnstack: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeEscape);
    };
  }, [onClose]);

  const primaryZones = new Set([handZoneId, discardZoneId, deckZoneId].filter(Boolean));
  const moveZones = zones.filter(zone => zone.id !== card.zone && !primaryZones.has(zone.id));

  const act = (action: () => void) => {
    if (!canAct) return;
    action();
    onClose();
  };

  const menuWidth = 230;
  const menuHeight = 430;
  const left = Math.max(8, Math.min(state.x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(state.y, window.innerHeight - menuHeight - 8));

  return <div
    ref={ref}
    className="card-context-menu"
    role="menu"
    style={{ left, top }}
    onContextMenu={event => event.preventDefault()}
  >
    <div className="card-context-heading">
      <strong>{card.label ?? 'Hidden card'}</strong>
      <span>{canAct ? 'Card actions' : 'Read only'}</span>
    </div>

    <button type="button" onClick={() => { onInspect(); onClose(); }}>Inspect card</button>

    {canAct && <>
      <div className="card-context-separator" />
      <button type="button" onClick={() => act(onRotate)}>{card.rotation === 90 ? 'Untap' : 'Tap'}</button>
      <button type="button" onClick={() => act(onFlip)}>{card.faceUp ? 'Flip face-down' : 'Flip face-up'}</button>

      {handZoneId && card.zone !== handZoneId &&
        <button type="button" onClick={() => act(() => onMove(handZoneId))}>Return to Hand</button>}
      {discardZoneId && card.zone !== discardZoneId &&
        <button type="button" onClick={() => act(() => onMove(discardZoneId))}>Send to Trash / Discard</button>}
      {deckZoneId && card.zone !== deckZoneId &&
        <button type="button" onClick={() => act(() => onMove(deckZoneId))}>Move to {zones.find(zone => zone.id === deckZoneId)?.label ?? 'Deck'}</button>}
      {card.stackOn &&
        <button type="button" onClick={() => act(onUnstack)}>Unstack</button>}

      {moveZones.length > 0 && <>
        <div className="card-context-separator" />
        <span className="card-context-label">Move to…</span>
        <div className="card-context-scroll">
          {moveZones.map(zone =>
            <button type="button" key={zone.id} onClick={() => act(() => onMove(zone.id))}>{zone.label}</button>)}
        </div>
      </>}
    </>}
  </div>;
}
