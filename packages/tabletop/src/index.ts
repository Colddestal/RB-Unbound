export type Card = { id: string; label: string; x: number; y: number; rotation: number; faceUp: boolean; owner: 1 | 2 };
export type TableState = { version: 1; cards: Card[] };
export type TableAction =
  | { type: 'move'; id: string; x: number; y: number }
  | { type: 'rotate'; id: string }
  | { type: 'flip'; id: string }
  | { type: 'reset' };

export const initialTable: TableState = {
  version: 1,
  cards: [
    { id: 'sample-1', label: 'Wandering Scout', x: 60, y: 100, rotation: 0, faceUp: true, owner: 1 },
    { id: 'sample-2', label: 'Moss Guardian', x: 200, y: 100, rotation: 0, faceUp: true, owner: 1 },
    { id: 'sample-3', label: 'Amber Wisp', x: 390, y: 50, rotation: 0, faceUp: true, owner: 2 },
    { id: 'sample-4', label: 'Moon Courier', x: 530, y: 50, rotation: 0, faceUp: false, owner: 2 },
  ],
};

export function applyAction(state: TableState, action: TableAction): TableState {
  if (action.type === 'reset') return structuredClone(initialTable);
  return {
    ...state,
    cards: state.cards.map(card => {
      if (card.id !== action.id) return card;
      if (action.type === 'move') return { ...card, x: Math.max(0, Math.min(1000, action.x)), y: Math.max(0, Math.min(600, action.y)) };
      if (action.type === 'rotate') return { ...card, rotation: (card.rotation + 90) % 360 };
      return { ...card, faceUp: !card.faceUp };
    }),
  };
}

export function isTableState(value: unknown): value is TableState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<TableState>;
  return v.version === 1 && Array.isArray(v.cards) && v.cards.length <= 200 && v.cards.every(c =>
    typeof c.id === 'string' && c.id.length <= 100 && typeof c.label === 'string' && c.label.length <= 120 &&
    Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.rotation) && typeof c.faceUp === 'boolean' &&
    (c.owner === 1 || c.owner === 2));
}
