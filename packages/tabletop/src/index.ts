export type PlayerId = 1 | 2;
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

export type TableState = { version: 2; cards: Card[] };

export type TableAction =
  | { type: 'move'; id: string; x: number; y: number; actor: PlayerId }
  | { type: 'rotate'; id: string; actor: PlayerId }
  | { type: 'flip'; id: string; actor: PlayerId }
  | { type: 'draw'; player: PlayerId }
  | { type: 'to-zone'; id: string; zone: CardZone; actor: PlayerId }
  | { type: 'shuffle'; player: PlayerId; orderedIds: string[] }
  | { type: 'stack'; id: string; targetId: string; actor: PlayerId }
  | { type: 'unstack'; id: string; actor: PlayerId }
  | { type: 'reset' };

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
    rotation: owner === 2 ? 180 : 0,
    faceUp: false,
  }));
}

export const initialTable: TableState = {
  version: 2,
  cards: [...buildDeck(1, 'p1'), ...buildDeck(2, 'p2')],
};

export function canManipulate(card: Card, actor: PlayerId): boolean {
  return card.owner === actor;
}

function nextOrder(cards: Card[], owner: PlayerId, zone: CardZone): number {
  const orders = cards.filter(c => c.owner === owner && c.zone === zone).map(c => c.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

export function applyAction(state: TableState, action: TableAction): TableState {
  if (action.type === 'reset') return structuredClone(initialTable);

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
        return {
          ...current,
          zone: action.zone,
          order: nextOrder(state.cards, current.owner, action.zone),
          faceUp: action.zone === 'deck' ? false : current.faceUp,
          stackOn: undefined,
          x: enteringField ? (current.owner === 1 ? 430 : 520) : current.x,
          y: enteringField ? (current.owner === 1 ? 360 : 125) : current.y,
        };
      }
      return current;
    }),
  };
}

export function isTableState(value: unknown): value is TableState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<TableState>;
  const zones: CardZone[] = ['deck', 'hand', 'field', 'discard'];
  return v.version === 2 && Array.isArray(v.cards) && v.cards.length <= 500 && v.cards.every(c =>
    typeof c.id === 'string' && c.id.length <= 100 &&
    typeof c.label === 'string' && c.label.length <= 120 &&
    (c.owner === 1 || c.owner === 2) &&
    zones.includes(c.zone) &&
    Number.isFinite(c.order) && Number.isFinite(c.x) && Number.isFinite(c.y) &&
    Number.isFinite(c.rotation) && typeof c.faceUp === 'boolean' &&
    (c.stackOn === undefined || (typeof c.stackOn === 'string' && c.stackOn.length <= 100)));
}
