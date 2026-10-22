import type { PlayerId } from '@rb-unbound/tabletop';

export type InspectableCard = {
  id: string;
  label: string | null;
  owner: PlayerId;
  zone: string;
  faceUp: boolean;
  rotation: number;
  stackOn?: string;
};

export function CardInspector({
  card,
  pinned,
  onClear,
}: {
  card?: InspectableCard;
  pinned: boolean;
  onClear: () => void;
}) {
  return <aside className="card-inspector panel" aria-live="polite">
    <div className="inspector-heading">
      <div>
        <span className="eyebrow">CARD INFORMATION</span>
        <h2>{card?.label ?? (card ? 'Hidden card' : 'No card selected')}</h2>
      </div>
      {pinned && <button onClick={onClear} aria-label="Clear pinned card">×</button>}
    </div>

    {card ? <>
      <div className={`inspector-card-preview ${card.faceUp ? '' : 'back'}`}>
        <span className="card-symbol">{card.faceUp ? '✦' : '◆'}</span>
        <strong>{card.label ?? 'Hidden card'}</strong>
        <small>Player {card.owner}</small>
      </div>
      <dl className="inspector-details">
        <div><dt>Owner</dt><dd>Player {card.owner}</dd></div>
        <div><dt>Zone</dt><dd>{card.zone}</dd></div>
        <div><dt>Facing</dt><dd>{card.faceUp ? 'Face up' : 'Face down'}</dd></div>
        <div><dt>Rotation</dt><dd>{card.rotation}°</dd></div>
        <div><dt>Stacked</dt><dd>{card.stackOn ? 'Yes' : 'No'}</dd></div>
      </dl>
      <p className="inspector-note">{pinned ? 'Pinned — click another card to replace it.' : 'Hover preview — click a card to pin it here.'}</p>
    </> : <div className="inspector-empty">
      <span>◇</span>
      <p>Hover over a visible card to preview it. Click a card to keep its information pinned here.</p>
    </div>}
  </aside>;
}
