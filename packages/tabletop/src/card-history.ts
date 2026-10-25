import type { Card, PlayerId, TableAction, TableState } from './index.js';

export type CardEdit = { before: Card; after: Card };
export type CardTimeline = { past: CardEdit[]; future: CardEdit[] };

export function emptyCardTimeline(): CardTimeline { return { past: [], future: [] }; }

export function recordCardEdit(timeline: CardTimeline, before: TableState, after: TableState, action: TableAction): CardTimeline {
  if (before === after) return timeline;
  if (!['move', 'to-zone', 'rotate', 'flip', 'stack', 'unstack'].includes(action.type) || !('id' in action))
    return { ...timeline, future: [] };
  const previous = before.cards.find(card => card.id === action.id);
  const current = after.cards.find(card => card.id === action.id);
  if (!previous || !current || JSON.stringify(previous) === JSON.stringify(current)) return timeline;
  return { past: [...timeline.past, { before: { ...previous }, after: { ...current } }], future: [] };
}

export function stepCardTimeline(table: TableState, timeline: CardTimeline, actor: PlayerId, direction: 'undo' | 'redo'):
  { table: TableState; timeline: CardTimeline } | undefined {
  const entry = (direction === 'undo' ? timeline.past : timeline.future).at(-1);
  if (!entry) return undefined;
  const expected = direction === 'undo' ? entry.after : entry.before;
  const replacement = direction === 'undo' ? entry.before : entry.after;
  const current = table.cards.find(card => card.id === expected.id);
  if (!current || current.owner !== actor || JSON.stringify(current) !== JSON.stringify(expected)) return undefined;
  return {
    table: { ...table, cards: table.cards.map(card => card.id === current.id ? { ...replacement } : card) },
    timeline: direction === 'undo'
      ? { past: timeline.past.slice(0, -1), future: [...timeline.future, entry] }
      : { past: [...timeline.past, entry], future: timeline.future.slice(0, -1) },
  };
}
