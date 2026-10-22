import {
  builtInCardCatalog,
  type CardDefinition,
  type GameModule,
  type PlayerId,
} from '@rb-unbound/tabletop';

export type InspectableCard = {
  id: string;
  label: string | null;
  definitionId?: string | null;
  owner: PlayerId;
  zone: string;
  faceUp: boolean;
  rotation: number;
  stackOn?: string;
};

function metadataValue(value: string | number | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === undefined ? '' : String(value);
}

export function CardInspector({
  card,
  pinned,
  onClear,
  module,
  catalog = builtInCardCatalog,
}: {
  card?: InspectableCard;
  pinned: boolean;
  onClear: () => void;
  module?: GameModule;
  catalog?: readonly CardDefinition[];
}) {
  const definition = card?.definitionId && module
    ? catalog.find(item =>
      item.id === card.definitionId &&
      item.moduleId === module.id &&
      item.moduleVersion === module.version)
    : undefined;
  const zoneLabel = card && module
    ? module.zones.find(zone => zone.id === card.zone || zone.kind === card.zone)?.label ?? card.zone
    : card?.zone;

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
        <div><dt>Zone</dt><dd>{zoneLabel}</dd></div>
        <div><dt>Facing</dt><dd>{card.faceUp ? 'Face up' : 'Face down'}</dd></div>
        <div><dt>Rotation</dt><dd>{card.rotation}°</dd></div>
        <div><dt>Stacked</dt><dd>{card.stackOn ? 'Yes' : 'No'}</dd></div>
      </dl>

      {definition && module?.cardFields?.length ? <section className="inspector-metadata">
        <span className="eyebrow">{module.name.toUpperCase()} DATA</span>
        <dl className="inspector-details">
          {module.cardFields.map(field => {
            const value = metadataValue(definition.metadata[field.id]);
            if (!value) return null;
            return <div key={field.id}><dt>{field.label}</dt><dd>{value}</dd></div>;
          })}
        </dl>
      </section> : null}

      <p className="inspector-note">{pinned ? 'Pinned — click another card to replace it.' : 'Hover preview — click a card to pin it here.'}</p>
    </> : <div className="inspector-empty">
      <span>◇</span>
      <p>Hover over a visible card to preview it. Click a card to keep its information pinned here.</p>
    </div>}
  </aside>;
}
