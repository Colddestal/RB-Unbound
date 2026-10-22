import { builtInCardCatalog, starterDeckForModule } from './deck.js';
import type { GameModule } from './game-module.js';

export type PlayerId = 1 | 2 | 3 | 4;
export type CoreCardZone = 'deck' | 'hand' | 'field' | 'discard';
export type CardZone = string;

const CORE_ZONES: CoreCardZone[] = ['deck', 'hand', 'field', 'discard'];
const ZONE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type Card = {
  id: string;
  label: string;
  definitionId?: string;
  owner: PlayerId;
  zone: CardZone;
  order: number;
  x: number;
  y: number;
  rotation: number;
  faceUp: boolean;
  stackOn?: string;
};

export type TableState = { version: 4; cards: Card[] };
export type LegacyTableStateV3 = { version: 3; cards: Array<Omit<Card, 'zone'> & { zone: CoreCardZone }> };

export type TableAction =
  | { type: 'move'; id: string; x: number; y: number; actor: PlayerId }
  | { type: 'rotate'; id: string; actor: PlayerId }
  | { type: 'flip'; id: string; actor: PlayerId }
  | { type: 'draw'; player: PlayerId }
  | { type: 'to-zone'; id: string; zone: CardZone; actor: PlayerId }
  | { type: 'shuffle'; player: PlayerId; orderedIds: string[] }
  | { type: 'stack'; id: string; targetId: string; actor: PlayerId }
  | { type: 'unstack'; id: string; actor: PlayerId }
  | { type: 'reset'; players?: PlayerId[] };

export type ClientTableAction =
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'rotate'; id: string }
  | { type: 'flip'; id: string }
  | { type: 'draw' }
  | { type: 'to-zone'; id: string; zone: CardZone }
  | { type: 'shuffle' }
  | { type: 'stack'; id: string; targetId: string }
  | { type: 'unstack'; id: string };

export type PublicCard = Omit<Card, 'label' | 'id' | 'definitionId'> & {
  id: string;
  label: string | null;
  definitionId: string | null;
};

export type TableView = {
  version: 4;
  cards: PublicCard[];
  hidden: Array<{ owner: PlayerId; deckCount: number; handCount: number }>;
};

const samples = [
  'Wandering Scout', 'Moss Guardian', 'Amber Wisp', 'Moon Courier',
  'River Adept', 'Ironwing', 'Dust Scribe', 'Thorn Keeper',
  'Glass Fox', 'Northwind Seer', 'Lantern Bearer', 'Stonebound'
];

function buildDeck(owner: PlayerId, prefix: string): Card[] {
  return samples.map((label, index) => ({
    id: `${prefix}-${index + 1}`,
    label,
    owner,
    zone: 'deck',
    order: index,
    x: 0,
    y: 0,
    rotation: 0,
    faceUp: false,
  }));
}

export function createInitialTable(players: PlayerId[]): TableState {
  const unique = [...new Set(players)].filter((player): player is PlayerId => player >= 1 && player <= 4);
  return {
    version: 4,
    cards: unique.flatMap(player => buildDeck(player, `p${player}`)),
  };
}

export function createInitialTableForModule(
  players: PlayerId[],
  module: GameModule,
  cardCatalog = builtInCardCatalog,
): TableState {
  const unique = [...new Set(players)].filter((player): player is PlayerId => player >= 1 && player <= 4);
  const deck = starterDeckForModule(module, cardCatalog);
  const catalog = new Map(cardCatalog
    .filter(card => card.moduleId === module.id && card.moduleVersion === module.version)
    .map(card => [card.id, card]));

  return {
    version: 4,
    cards: unique.flatMap(owner => deck.cards.flatMap((definitionId, index) => {
      const definition = catalog.get(definitionId);
      if (!definition) return [];
      return [{
        id: `p${owner}-${definitionId}-${index + 1}`,
        definitionId,
        label: definition.name,
        owner,
        zone: 'deck',
        order: index,
        x: 0,
        y: 0,
        rotation: 0,
        faceUp: false,
      } satisfies Card];
    })),
  };
}

export const initialTable: TableState = createInitialTable([1, 2]);

export function canManipulate(card: Card, actor: PlayerId): boolean {
  return card.owner === actor;
}

function nextOrder(cards: Card[], owner: PlayerId, zone: CardZone): number {
  const orders = cards.filter(c => c.owner === owner && c.zone === zone).map(c => c.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

export function applyAction(
  state: TableState,
  action: TableAction,
  allowedZones: readonly string[] = CORE_ZONES,
  stackableZones: readonly string[] = ['field'],
): TableState {
  const zoneSet = new Set(allowedZones);
  const stackableSet = new Set(stackableZones);
  if (action.type === 'reset') return createInitialTable(action.players ?? [1, 2]);

  if (action.type === 'draw') {
    const deck = state.cards
      .filter(c => c.owner === action.player && c.zone === 'deck')
      .sort((a, b) => a.order - b.order);
    const top = deck[0];
    if (!top) return state;
    return {
      ...state,
      cards: state.cards.map(card => card.id === top.id
        ? { ...card, zone: 'hand', order: nextOrder(state.cards, action.player, 'hand'), faceUp: true, stackOn: undefined }
        : card),
    };
  }

  if (action.type === 'shuffle') {
    const deckIds = new Set(state.cards.filter(c => c.owner === action.player && c.zone === 'deck').map(c => c.id));
    if (action.orderedIds.length !== deckIds.size || action.orderedIds.some(id => !deckIds.has(id))) return state;
    const order = new Map(action.orderedIds.map((id, index) => [id, index]));
    return { ...state, cards: state.cards.map(card => deckIds.has(card.id) ? { ...card, order: order.get(card.id)! } : card) };
  }

  const card = state.cards.find(c => c.id === action.id);
  if (!card || !('actor' in action) || !canManipulate(card, action.actor)) return state;

  if (action.type === 'stack') {
    const target = state.cards.find(c => c.id === action.targetId);
    if (!target || target.id === card.id || target.owner !== action.actor || !stackableSet.has(target.zone) || target.zone !== card.zone || !stackableSet.has(card.zone)) return state;
    let cursor: Card | undefined = target;
    const seen = new Set<string>();
    while (cursor?.stackOn) {
      if (cursor.stackOn === card.id || seen.has(cursor.id)) return state;
      seen.add(cursor.id);
      cursor = state.cards.find(c => c.id === cursor?.stackOn);
    }
    return { ...state, cards: state.cards.map(c => c.id === card.id ? { ...c, stackOn: target.id, x: target.x, y: target.y } : c) };
  }

  return {
    ...state,
    cards: state.cards.map(current => {
      if (current.id !== card.id) return current;
      if (action.type === 'move') {
        if (!stackableSet.has(current.zone) && current.zone !== 'field') return current;
        return { ...current, x: Math.max(0, Math.min(1000, action.x)), y: Math.max(0, Math.min(600, action.y)), stackOn: undefined };
      }
      if (action.type === 'rotate') return { ...current, rotation: current.rotation === 90 ? 0 : 90 };
      if (action.type === 'flip') return { ...current, faceUp: !current.faceUp };
      if (action.type === 'unstack') return { ...current, stackOn: undefined, x: Math.min(1000, current.x + 35), y: Math.min(600, current.y + 35) };
      if (action.type === 'to-zone') {
        if (!zoneSet.has(action.zone)) return current;
        const enteringField = action.zone === 'field';
        const defaults: Record<PlayerId, { x: number; y: number }> = {
          1: { x: 430, y: 360 },
          2: { x: 520, y: 125 },
          3: { x: 220, y: 245 },
          4: { x: 730, y: 245 },
        };
        return {
          ...current,
          zone: action.zone,
          order: nextOrder(state.cards, current.owner, action.zone),
          faceUp: action.zone === 'deck'
            ? false
            : (current.zone === 'hand' && action.zone === 'field' ? false : current.faceUp),
          stackOn: undefined,
          x: enteringField ? defaults[current.owner].x : current.x,
          y: enteringField ? defaults[current.owner].y : current.y,
        };
      }
      return current;
    }),
  };
}

export function projectTable(
  state: TableState,
  viewer?: PlayerId,
  visibleHandOwners?: PlayerId[],
  publicZones: readonly string[] = ['field', 'discard'],
): TableView {
  const privateHandOwners = new Set<PlayerId>(visibleHandOwners ?? (viewer ? [viewer] : []));
  const publicZoneIds = new Set(publicZones);
  const hidden = ([1, 2, 3, 4] as PlayerId[])
    .map(owner => ({
      owner,
      deckCount: state.cards.filter(card => card.owner === owner && card.zone === 'deck').length,
      handCount: state.cards.filter(card => card.owner === owner && card.zone === 'hand').length,
    }))
    .filter(summary => summary.deckCount || summary.handCount);

  const cards: PublicCard[] = [];
  for (const card of state.cards) {
    const visiblePrivateHand = card.zone === 'hand' && privateHandOwners.has(card.owner);
    const publicZone = publicZoneIds.has(card.zone);
    if (!visiblePrivateHand && !publicZone) continue;

    const privateIdentityVisible = privateHandOwners.has(card.owner);
    const hideIdentity = !privateIdentityVisible && !card.faceUp;
    cards.push({
      ...card,
      id: hideIdentity ? `hidden-${card.owner}-${card.zone}-${card.order}` : card.id,
      label: hideIdentity ? null : card.label,
      definitionId: hideIdentity ? null : (card.definitionId ?? null),
      stackOn: hideIdentity ? undefined : card.stackOn,
    });
  }

  return { version: 4, cards, hidden };
}

export function isClientTableAction(value: unknown): value is ClientTableAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  if (action.type === 'draw' || action.type === 'shuffle') return true;
  if (typeof action.id !== 'string' || action.id.length > 100) return false;
  if (action.type === 'rotate' || action.type === 'flip' || action.type === 'unstack') return true;
  if (action.type === 'move') return typeof action.x === 'number' && Number.isFinite(action.x) && typeof action.y === 'number' && Number.isFinite(action.y);
  if (action.type === 'to-zone') return typeof action.zone === 'string' && ZONE_ID_PATTERN.test(action.zone);
  return action.type === 'stack' && typeof action.targetId === 'string' && action.targetId.length <= 100;
}

function validCardShape(c: Partial<Card>): boolean {
  return typeof c.id === 'string' && c.id.length <= 100 &&
    typeof c.label === 'string' && c.label.length <= 120 &&
    (c.definitionId === undefined || (typeof c.definitionId === 'string' && c.definitionId.length <= 100)) &&
    (c.owner === 1 || c.owner === 2 || c.owner === 3 || c.owner === 4) &&
    typeof c.zone === 'string' && ZONE_ID_PATTERN.test(c.zone) &&
    Number.isFinite(c.order) && Number.isFinite(c.x) && Number.isFinite(c.y) &&
    Number.isFinite(c.rotation) && typeof c.faceUp === 'boolean' &&
    (c.stackOn === undefined || (typeof c.stackOn === 'string' && c.stackOn.length <= 100));
}

export function isTableState(value: unknown): value is TableState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<TableState>;
  return v.version === 4 && Array.isArray(v.cards) && v.cards.length <= 500 && v.cards.every(validCardShape);
}



export type TableSaveFile = {
  fileSchemaVersion: 1;
  moduleId: string;
  moduleVersion: string;
  table: TableState;
};

export function createTableSaveFile(state: TableState, module: Pick<GameModule, 'id' | 'version'>): TableSaveFile {
  return {
    fileSchemaVersion: 1,
    moduleId: module.id,
    moduleVersion: module.version,
    table: state,
  };
}

export function isTableSaveFile(value: unknown): value is TableSaveFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<TableSaveFile>;
  return file.fileSchemaVersion === 1 &&
    typeof file.moduleId === 'string' && ZONE_ID_PATTERN.test(file.moduleId) &&
    typeof file.moduleVersion === 'string' && file.moduleVersion.length >= 1 && file.moduleVersion.length <= 40 &&
    isTableState(file.table);
}

function normalizeTableRotations(state: TableState): TableState {
  return {
    ...state,
    cards: state.cards.map(card => ({ ...card, rotation: card.rotation === 90 ? 90 : 0 })),
  };
}

export function migrateTableState(value: unknown): TableState | null {
  if (isTableState(value)) return normalizeTableRotations(value);
  if (!value || typeof value !== 'object') return null;
  const legacy = value as Partial<LegacyTableStateV3>;
  if (legacy.version !== 3 || !Array.isArray(legacy.cards) || legacy.cards.length > 500) return null;
  if (!legacy.cards.every(card => validCardShape(card) && CORE_ZONES.includes(card.zone as CoreCardZone))) return null;
  return normalizeTableRotations({ version: 4, cards: legacy.cards.map(card => ({ ...card })) });
}

export * from './game-module.js';

export * from './deck.js';

export * from './module-package.js';
