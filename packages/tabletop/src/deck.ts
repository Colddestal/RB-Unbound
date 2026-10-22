import type { GameModule } from './game-module.js';

export type CardMetadataValue = string | number | string[];

export type CardDefinition = {
  id: string;
  moduleId: string;
  moduleVersion: string;
  name: string;
  metadata: Record<string, CardMetadataValue>;
};

export type DeckDefinition = {
  schemaVersion: 1;
  moduleId: string;
  moduleVersion: string;
  name: string;
  cards: string[];
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isCardDefinition(value: unknown, module?: GameModule): value is CardDefinition {
  if (!value || typeof value !== 'object') return false;
  const card = value as Partial<CardDefinition>;
  if (typeof card.id !== 'string' || !ID_PATTERN.test(card.id)) return false;
  if (typeof card.moduleId !== 'string' || !ID_PATTERN.test(card.moduleId)) return false;
  if (typeof card.moduleVersion !== 'string' || card.moduleVersion.length < 1 || card.moduleVersion.length > 40) return false;
  if (typeof card.name !== 'string' || card.name.length < 1 || card.name.length > 120) return false;
  if (!card.metadata || typeof card.metadata !== 'object' || Array.isArray(card.metadata)) return false;
  if (module && (card.moduleId !== module.id || card.moduleVersion !== module.version)) return false;

  const allowedFields = new Set(module?.cardFields?.map(field => field.id) ?? Object.keys(card.metadata));
  for (const [key, item] of Object.entries(card.metadata)) {
    if (!ID_PATTERN.test(key) || !allowedFields.has(key)) return false;
    if (typeof item === 'string') {
      if (item.length > 1000) return false;
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) return false;
    } else if (Array.isArray(item)) {
      if (item.length > 32 || item.some(entry => typeof entry !== 'string' || entry.length > 80)) return false;
    } else return false;
  }
  return true;
}

export function isDeckDefinition(
  value: unknown,
  module: GameModule,
  catalog: readonly CardDefinition[],
): value is DeckDefinition {
  if (!value || typeof value !== 'object') return false;
  const deck = value as Partial<DeckDefinition>;
  if (deck.schemaVersion !== 1) return false;
  if (deck.moduleId !== module.id || deck.moduleVersion !== module.version) return false;
  if (typeof deck.name !== 'string' || deck.name.length < 1 || deck.name.length > 100) return false;
  if (!Array.isArray(deck.cards) || deck.cards.length < 1 || deck.cards.length > 500) return false;

  const allowedCards = new Set(catalog.filter(card => isCardDefinition(card, module)).map(card => card.id));
  return deck.cards.every(cardId => typeof cardId === 'string' && allowedCards.has(cardId));
}

export function searchCardCatalog(
  catalog: readonly CardDefinition[],
  module: GameModule,
  query: string,
): CardDefinition[] {
  const needle = query.trim().toLowerCase();
  return catalog
    .filter(card => isCardDefinition(card, module))
    .filter(card => {
      if (!needle) return true;
      const haystack = [
        card.name,
        card.id,
        ...Object.values(card.metadata).flatMap(value => Array.isArray(value) ? value : [String(value)]),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
}

export const builtInCardCatalog: CardDefinition[] = [
  { id: 'wandering-scout', moduleId: 'generic-duel', moduleVersion: '1.0.0', name: 'Wandering Scout', metadata: { type: 'Unit', rules: 'Original placeholder scout.', tags: ['starter', 'unit'] } },
  { id: 'moss-guardian', moduleId: 'generic-duel', moduleVersion: '1.0.0', name: 'Moss Guardian', metadata: { type: 'Unit', rules: 'Original placeholder guardian.', tags: ['starter', 'unit'] } },
  { id: 'amber-wisp', moduleId: 'generic-duel', moduleVersion: '1.0.0', name: 'Amber Wisp', metadata: { type: 'Spirit', rules: 'Original placeholder spirit.', tags: ['starter', 'spirit'] } },
  { id: 'moon-courier', moduleId: 'generic-duel', moduleVersion: '1.0.0', name: 'Moon Courier', metadata: { type: 'Unit', rules: 'Original placeholder courier.', tags: ['starter', 'unit'] } },

  { id: 'dust-runner', moduleId: 'frontier-skirmish', moduleVersion: '1.0.0', name: 'Dust Runner', metadata: { class: 'Scout', power: 2, tags: ['mobile', 'starter'] } },
  { id: 'iron-sentry', moduleId: 'frontier-skirmish', moduleVersion: '1.0.0', name: 'Iron Sentry', metadata: { class: 'Defender', power: 4, tags: ['guard', 'starter'] } },
  { id: 'ridge-captain', moduleId: 'frontier-skirmish', moduleVersion: '1.0.0', name: 'Ridge Captain', metadata: { class: 'Leader', power: 3, tags: ['leader', 'starter'] } },
  { id: 'spark-drone', moduleId: 'frontier-skirmish', moduleVersion: '1.0.0', name: 'Spark Drone', metadata: { class: 'Drone', power: 1, tags: ['drone', 'starter'] } },
];

export function starterDeckForModule(module: GameModule): DeckDefinition {
  const ids = builtInCardCatalog.filter(card => card.moduleId === module.id && card.moduleVersion === module.version).map(card => card.id);
  return {
    schemaVersion: 1,
    moduleId: module.id,
    moduleVersion: module.version,
    name: `${module.name} Starter`,
    cards: ids.length ? [...ids, ...ids, ...ids] : [],
  };
}
