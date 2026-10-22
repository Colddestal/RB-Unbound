export type PlayerId = 1 | 2 | 3 | 4;
export type CardZone = 'deck' | 'hand' | 'field' | 'discard';

export type Card = {
  id: string;
  label: string;
  owner: PlayerId;
  zone: CardZone;
  order: number;
  x: number;
  y: number;
  rotation: number;
  faceUp: boolean;
  stackOn?: string;
};

export type TableState = { version: 3; cards: Card[] };

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

export type PublicCard = Omit<Card, 'label' | 'id'> & {
  id: string;
  label: string | null;
};

export type TableView = {
  version: 3;
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
    zone: 'deck' as const,
    order: index,
    x: 0,
    y: 0,
    rotation: owner === 2 ? 180 : owner === 3 ? 90 : owner === 4 ? 270 : 0,
    faceUp: false,
  }));
}

export function createInitialTable(players: PlayerId[]): TableState {
  const unique = [...new Set(players)].filter((player): player is PlayerId => player >= 1 && player <= 4);
  return {
    version: 3,
    cards: unique.flatMap(player => buildDeck(player, `p${player}`)),
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

export function applyAction(state: TableState, action: TableAction): TableState {
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
    if (!target || target.id === card.id || target.owner !== action.actor || target.zone !== 'field' || card.zone !== 'field') return state;
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
        if (current.zone !== 'field') return current;
        return { ...current, x: Math.max(0, Math.min(1000, action.x)), y: Math.max(0, Math.min(600, action.y)), stackOn: undefined };
      }
      if (action.type === 'rotate') return { ...current, rotation: (current.rotation + 90) % 360 };
      if (action.type === 'flip') return { ...current, faceUp: !current.faceUp };
      if (action.type === 'unstack') return { ...current, stackOn: undefined, x: Math.min(1000, current.x + 35), y: Math.min(600, current.y + 35) };
      if (action.type === 'to-zone') {
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
          faceUp: action.zone === 'deck' ? false : current.faceUp,
          stackOn: undefined,
          x: enteringField ? defaults[current.owner].x : current.x,
          y: enteringField ? defaults[current.owner].y : current.y,
        };
      }
      return current;
    }),
  };
}

export function projectTable(state: TableState, viewer?: PlayerId): TableView {
  const hidden = ([1, 2, 3, 4] as PlayerId[])
    .map(owner => ({
      owner,
      deckCount: state.cards.filter(card => card.owner === owner && card.zone === 'deck').length,
      handCount: state.cards.filter(card => card.owner === owner && card.zone === 'hand').length,
    }))
    .filter(summary => summary.deckCount || summary.handCount);

  const cards: PublicCard[] = [];
  for (const card of state.cards) {
    const ownHand = viewer === card.owner && card.zone === 'hand';
    const publicZone = card.zone === 'field' || card.zone === 'discard';
    if (!ownHand && !publicZone) continue;

    const hideIdentity = viewer !== card.owner && !card.faceUp;
    cards.push({
      ...card,
      id: hideIdentity ? `hidden-${card.owner}-${card.zone}-${card.order}` : card.id,
      label: hideIdentity ? null : card.label,
      stackOn: hideIdentity ? undefined : card.stackOn,
    });
  }

  return { version: 3, cards, hidden };
}

export function isClientTableAction(value: unknown): value is ClientTableAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  if (action.type === 'draw' || action.type === 'shuffle') return true;
  if (typeof action.id !== 'string' || action.id.length > 100) return false;
  if (action.type === 'rotate' || action.type === 'flip' || action.type === 'unstack') return true;
  if (action.type === 'move') return typeof action.x === 'number' && Number.isFinite(action.x) && typeof action.y === 'number' && Number.isFinite(action.y);
  if (action.type === 'to-zone') return action.zone === 'deck' || action.zone === 'hand' || action.zone === 'field' || action.zone === 'discard';
  return action.type === 'stack' && typeof action.targetId === 'string' && action.targetId.length <= 100;
}

export function isTableState(value: unknown): value is TableState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<TableState>;
  const zones: CardZone[] = ['deck', 'hand', 'field', 'discard'];
  return v.version === 3 && Array.isArray(v.cards) && v.cards.length <= 500 && v.cards.every(c =>
    typeof c.id === 'string' && c.id.length <= 100 &&
    typeof c.label === 'string' && c.label.length <= 120 &&
    (c.owner === 1 || c.owner === 2 || c.owner === 3 || c.owner === 4) &&
    zones.includes(c.zone) &&
    Number.isFinite(c.order) && Number.isFinite(c.x) && Number.isFinite(c.y) &&
    Number.isFinite(c.rotation) && typeof c.faceUp === 'boolean' &&
    (c.stackOn === undefined || (typeof c.stackOn === 'string' && c.stackOn.length <= 100)));
}
