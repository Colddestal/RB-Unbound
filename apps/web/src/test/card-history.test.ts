import { describe, expect, it } from 'vitest';
import { applyAction, emptyCardTimeline, recordCardEdit, stepCardTimeline, type TableState } from '@rb-unbound/tabletop';

describe('card undo and redo', () => {
  const initial: TableState = { version: 4, cards: [
    { id: 'one', label: 'One', owner: 1, zone: 'field', order: 0, x: 100, y: 200, rotation: 0, faceUp: true },
  ] };

  it('walks an unrestricted chain of card positions backward and forward', () => {
    let table = initial;
    let timeline = emptyCardTimeline();
    for (let index = 1; index <= 150; index += 1) {
      const action = { type: 'move' as const, id: 'one', actor: 1 as const, x: 100 + index, y: 200 };
      const next = applyAction(table, action);
      timeline = recordCardEdit(timeline, table, next, action);
      table = next;
    }
    expect(timeline.past).toHaveLength(150);
    for (let index = 0; index < 150; index += 1) {
      const step = stepCardTimeline(table, timeline, 1, 'undo')!;
      table = step.table; timeline = step.timeline;
    }
    expect(table.cards[0].x).toBe(100);
    expect(timeline.future).toHaveLength(150);
    for (let index = 0; index < 150; index += 1) {
      const step = stepCardTimeline(table, timeline, 1, 'redo')!;
      table = step.table; timeline = step.timeline;
    }
    expect(table.cards[0].x).toBe(250);
    expect(timeline.past).toHaveLength(150);
  });

  it('clears redo after a new move and cannot change another player’s card', () => {
    const first = { type: 'move' as const, id: 'one', actor: 1 as const, x: 150, y: 200 };
    const moved = applyAction(initial, first);
    const history = recordCardEdit(emptyCardTimeline(), initial, moved, first);
    expect(stepCardTimeline(moved, history, 2, 'undo')).toBeUndefined();
    const undone = stepCardTimeline(moved, history, 1, 'undo')!;
    const branch = { ...first, x: 170 };
    const branched = applyAction(undone.table, branch);
    const next = recordCardEdit(undone.timeline, undone.table, branched, branch);
    expect(next.future).toHaveLength(0);
    expect(stepCardTimeline(branched, next, 1, 'redo')).toBeUndefined();
  });
});
