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
  sections?: {
    legend: string[];
    runes: string[];
    champion: string[];
    battlefields?: string[];
    sideDeck: string[];
  };
};

export const DECK_SECTIONS = ['legend', 'runes', 'champion', 'deck', 'sideDeck', 'battlefields'] as const;
export type DeckSection = typeof DECK_SECTIONS[number];
export const AFFINITIES = ['blue', 'red', 'green', 'orange', 'yellow', 'purple'] as const;
export type Affinity = typeof AFFINITIES[number];

export function cardSection(card: CardDefinition): DeckSection {
  const slot = card.metadata.slot;
  return typeof slot === 'string' && DECK_SECTIONS.includes(slot as DeckSection) ? slot as DeckSection : 'deck';
}

export function sectionCards(deck: DeckDefinition, section: DeckSection): string[] {
  return section === 'deck' ? deck.cards : deck.sections?.[section] ?? [];
}

export function deckWarnings(deck: DeckDefinition, catalog: readonly CardDefinition[]): string[] {
  if (deck.moduleId !== 'frontier-skirmish') return [];
  const byId = new Map(catalog.map(card => [card.id, card]));
  const warnings: string[] = [];
  const limits: Record<DeckSection, [number, number]> = {
    legend: [1, 1], runes: [12, 12], champion: [1, 1], deck: [39, 39], sideDeck: [0, 8], battlefields: [3, 3],
  };
  for (const section of DECK_SECTIONS) {
    const cards = sectionCards(deck, section);
    const [min, max] = limits[section];
    if (cards.length < min) warnings.push(`${sectionLabel(section)} needs ${min - cards.length} more card${min - cards.length === 1 ? '' : 's'} (${cards.length}/${min}).`);
    if (cards.length > max) warnings.push(`${sectionLabel(section)} has ${cards.length - max} too many cards (limit ${max}).`);
    for (const id of cards) {
      const card = byId.get(id);
      if (!card || cardSection(card) !== (section === 'sideDeck' ? 'deck' : section)) warnings.push(`${sectionLabel(section)} contains an unknown or misplaced card.`);
    }
  }
  const legend = byId.get(sectionCards(deck, 'legend')[0]);
  const legendColors = legend?.metadata.affinities;
  if (legend && (!Array.isArray(legendColors) || legendColors.length !== 2)) warnings.push('Legend must have two affinities.');
  const allowed = new Set(Array.isArray(legendColors) ? legendColors : []);
  if (allowed.size === 2) {
    for (const section of DECK_SECTIONS) {
      if (section === 'legend') continue;
      if (sectionCards(deck, section).some(id => {
        const colors = byId.get(id)?.metadata.affinities;
        return !Array.isArray(colors) || colors.some(color => !allowed.has(color));
      })) warnings.push(`${sectionLabel(section)} has cards outside the Legend's affinities.`);
    }
  }
  const champion = byId.get(sectionCards(deck, 'champion')[0]);
  if (legend && champion && champion.metadata.identity !== legend.metadata.identity)
    warnings.push('Champion must have the same character name as the Legend.');
  const copies = new Map<string, number>();
  for (const id of [...deck.cards, ...sectionCards(deck, 'sideDeck')]) {
    const count = (copies.get(id) ?? 0) + 1;
    copies.set(id, count);
    if (count === 4) warnings.push(`${byId.get(id)?.name ?? id} exceeds three copies across Deck and Side deck.`);
  }
  const battlefields = sectionCards(deck, 'battlefields');
  if (new Set(battlefields).size !== battlefields.length) warnings.push('Choose three different Battlefields.');
  return warnings;
}

export function sectionLabel(section: DeckSection): string {
  return ({ legend: 'Legend', runes: 'Runes', champion: 'Champion', deck: 'Deck', sideDeck: 'Side deck', battlefields: 'Battlefields' })[section];
}

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
  if (card.moduleId === 'frontier-skirmish' && 'slot' in card.metadata) {
    const colors = card.metadata.affinities;
    if (typeof card.metadata.slot !== 'string' || !DECK_SECTIONS.includes(card.metadata.slot as DeckSection)) return false;
    if (!Array.isArray(colors) || colors.length < 1 || colors.length > 2 ||
      new Set(colors).size !== colors.length || colors.some(color => !AFFINITIES.includes(color as Affinity))) return false;
    if (card.metadata.slot === 'legend' && colors.length !== 2) return false;
    if (['legend', 'champion'].includes(card.metadata.slot) && typeof card.metadata.identity !== 'string') return false;
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
  if (!Array.isArray(deck.cards) || deck.cards.length > 500) return false;

  const allowedCards = new Set(catalog.filter(card => isCardDefinition(card, module)).map(card => card.id));
  if (!deck.cards.every(cardId => typeof cardId === 'string' && allowedCards.has(cardId))) return false;
  if (deck.sections === undefined) return deck.cards.length > 0;
  if (!deck.sections || typeof deck.sections !== 'object' || Array.isArray(deck.sections)) return false;
  return (['legend', 'runes', 'champion', 'sideDeck'] as const).every(section =>
    Array.isArray(deck.sections?.[section]) && deck.sections[section].length <= 500 &&
    deck.sections[section].every(id => typeof id === 'string' && allowedCards.has(id))) &&
    (deck.sections.battlefields === undefined || (Array.isArray(deck.sections.battlefields) &&
      deck.sections.battlefields.length <= 500 && deck.sections.battlefields.every(id => typeof id === 'string' && allowedCards.has(id))));
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

  // Keep the original demo cards available for older exported decks and module tests.
  { id: 'dust-runner', moduleId: 'frontier-skirmish', moduleVersion: '1.0.0', name: 'Dust Runner', metadata: { class: 'Scout', power: 2, tags: ['mobile', 'starter'] } },
  { id: 'iron-sentry', moduleId: 'frontier-skirmish', moduleVersion: '1.0.0', name: 'Iron Sentry', metadata: { class: 'Defender', power: 4, tags: ['guard', 'starter'] } },
  { id: 'ridge-captain', moduleId: 'frontier-skirmish', moduleVersion: '1.0.0', name: 'Ridge Captain', metadata: { class: 'Leader', power: 3, tags: ['leader', 'starter'] } },
  { id: 'spark-drone', moduleId: 'frontier-skirmish', moduleVersion: '1.0.0', name: 'Spark Drone', metadata: { class: 'Drone', power: 1, tags: ['drone', 'starter'] } },
  ...frontierSamples(),
];

function frontierSamples(): CardDefinition[] {
  const card = (id: string, name: string, slot: DeckSection, affinities: Affinity[], extras: Record<string, CardMetadataValue> = {}): CardDefinition => ({
    id, name, moduleId: 'frontier-skirmish', moduleVersion: '1.0.0',
    metadata: { slot, affinities, ...extras },
  });
  const names: Record<Affinity, string[]> = {
    blue: ['Tide Scout', 'Mist Cartographer', 'Harbor Sentry', 'Glass Current', 'Deepwater Signal', 'Rainward Owl', 'Azure Compass'],
    red: ['Cinder Runner', 'Ember Smith', 'Ashen Vanguard', 'Firebreak', 'Crimson Signal', 'Sparksmith', 'Furnace Fox'],
    green: ['Moss Guardian', 'Fern Tracker', 'Grove Keeper', 'Rootbound', 'Canopy Watch', 'Wildwood Map', 'Bramble Guide'],
    orange: ['Dune Runner', 'Copper Sentinel', 'Sunlit Trail', 'Amber Beacon', 'Sandward', 'Rust Scout', 'Horizon Flare'],
    yellow: ['Lantern Bearer', 'Dawn Courier', 'Golden Watch', 'Sunrise Signal', 'Meadow Guard', 'Bright Path', 'Gleam Weaver'],
    purple: ['Dusk Scribe', 'Moon Courier', 'Violet Echo', 'Shadow Lantern', 'Nightfall Scout', 'Amethyst Ward', 'Twilight Map'],
  };
  const legends = [
    card('legend-tidekeeper', 'Mira, Tidekeeper', 'legend', ['blue', 'green'], { identity: 'Mira', rules: 'Build with blue and green cards. Once per turn, you may ready a unit. Resolve this manually.' }),
    card('legend-emberguide', 'Orin, Emberguide', 'legend', ['red', 'orange'], { identity: 'Orin', rules: 'Build with red and orange cards. Once per turn, give a unit +1 power. Resolve this manually.' }),
    card('legend-dawnwatch', 'Sera, Dawnwatch', 'legend', ['yellow', 'purple'], { identity: 'Sera', rules: 'Build with yellow and purple cards. Once per turn, look at the top card of your deck. Resolve this manually.' }),
  ];
  const champions = [
    card('champion-mira', 'Mira, Riverward', 'champion', ['blue', 'green'], { identity: 'Mira', rules: 'When played, ready one of your units. Resolve this manually.' }),
    card('champion-orin', 'Orin, Trailblazer', 'champion', ['red', 'orange'], { identity: 'Orin', rules: 'When played, give another unit +1 power this turn. Resolve this manually.' }),
    card('champion-sera', 'Sera, Starlight', 'champion', ['yellow', 'purple'], { identity: 'Sera', rules: 'When played, look at the top card of your deck. Resolve this manually.' }),
  ];
  const runes = AFFINITIES.map(color => card(`rune-${color}`, `${color[0].toUpperCase()}${color.slice(1)} Rune`, 'runes', [color], { rules: `A basic ${color} sample rune. Track its use manually.` }));
  const battlefields = [
    card('battlefield-glass-current', 'Glass Current', 'battlefields', ['blue', 'green'], { image: 'tide', rules: 'When this battlefield opens, each player may ready one unit here. Resolve manually.' }),
    card('battlefield-moss-crossing', 'Moss Crossing', 'battlefields', ['blue', 'green'], { image: 'grove', rules: 'A unit here gains +1 power while its player controls a Base. Resolve manually.' }),
    card('battlefield-fog-harbor', 'Fog Harbor', 'battlefields', ['blue', 'green'], { image: 'harbor', rules: 'Once per turn, a player here may look at the top card of their deck. Resolve manually.' }),
    card('battlefield-ember-pass', 'Ember Pass', 'battlefields', ['red', 'orange'], { image: 'tide', rules: 'The first unit to enter here each turn gains +1 power. Resolve manually.' }),
    card('battlefield-copper-grove', 'Copper Grove', 'battlefields', ['red', 'orange'], { image: 'grove', rules: 'After a unit leaves here, its player may ready another unit. Resolve manually.' }),
    card('battlefield-amber-port', 'Amber Port', 'battlefields', ['red', 'orange'], { image: 'harbor', rules: 'Once per turn, a player here may move a unit to a Base. Resolve manually.' }),
    card('battlefield-dawn-ridge', 'Dawn Ridge', 'battlefields', ['yellow', 'purple'], { image: 'tide', rules: 'At the start of a turn, a player here may look at their top card. Resolve manually.' }),
    card('battlefield-moonwood', 'Moonwood', 'battlefields', ['yellow', 'purple'], { image: 'grove', rules: 'Once per turn, a player here may give a unit +1 power. Resolve manually.' }),
    card('battlefield-twilight-quay', 'Twilight Quay', 'battlefields', ['yellow', 'purple'], { image: 'harbor', rules: 'After playing a card here, a player may move another unit. Resolve manually.' }),
  ];
  const sampleEffects = [
    'When played, ready one of your cards. Resolve this manually.',
    'Look at the top card of your deck. Resolve this manually.',
    'Give one of your units +1 power this turn. Resolve this manually.',
    'When played, draw one card. Resolve this manually.',
    'Move one of your units to another area. Resolve this manually.',
    'If you control a base, this gains +1 power this turn. Resolve this manually.',
    'Return one of your cards to your hand. Resolve this manually.',
  ];
  const main = AFFINITIES.flatMap(color => names[color].map((name, index) =>
    card(`${color}-${index + 1}`, name, 'deck', [color], { class: index % 3 === 0 ? 'Unit' : 'Spell', power: index % 5 + 1, rules: sampleEffects[index] })));
  const mixed = [
    card('river-canopy', 'River Canopy', 'deck', ['blue', 'green'], { class: 'Spell', power: 2, rules: 'Ready one of your units, then move it to another area. Resolve this manually.' }),
    card('ember-dune', 'Ember Dune', 'deck', ['red', 'orange'], { class: 'Spell', power: 2, rules: 'Give one of your units +2 power this turn. Resolve this manually.' }),
    card('dusk-dawn', 'Dusk and Dawn', 'deck', ['yellow', 'purple'], { class: 'Spell', power: 2, rules: 'Look at the top card of your deck, then draw a card. Resolve this manually.' }),
  ];
  return [...legends, ...champions, ...runes, ...main, ...mixed, ...battlefields];
}

export function starterDeckForModule(
  module: GameModule,
  catalog: readonly CardDefinition[] = builtInCardCatalog,
): DeckDefinition {
  const ids = catalog.filter(card => card.moduleId === module.id && card.moduleVersion === module.version).map(card => card.id);
  if (module.id === 'frontier-skirmish') {
  const byId = new Map(catalog.filter(card => isCardDefinition(card)).map(card => [card.id, card]));
    const compatible = ids.filter(id => {
      const card = byId.get(id)!;
      return cardSection(card) === 'deck' &&
        Array.isArray(card.metadata.affinities) &&
        card.metadata.affinities.every(color => color === 'blue' || color === 'green');
    });
    return {
      schemaVersion: 1, moduleId: module.id, moduleVersion: module.version,
      name: `${module.name} Starter`,
      cards: compatible.slice(0, 13).flatMap(id => [id, id, id]),
      sections: {
        legend: ids.includes('legend-tidekeeper') ? ['legend-tidekeeper'] : [],
        champion: ids.includes('champion-mira') ? ['champion-mira'] : [],
        runes: Array.from({ length: 6 }, () => ['rune-blue', 'rune-green']).flat().filter(id => ids.includes(id)),
        battlefields: ['battlefield-glass-current', 'battlefield-moss-crossing', 'battlefield-fog-harbor'].filter(id => ids.includes(id)),
        sideDeck: [],
      },
    };
  }
  return {
    schemaVersion: 1,
    moduleId: module.id,
    moduleVersion: module.version,
    name: `${module.name} Starter`,
    cards: ids.length ? [...ids, ...ids, ...ids] : [],
  };
}
