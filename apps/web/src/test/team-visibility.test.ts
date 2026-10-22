import { describe, expect, it } from 'vitest';
import { applyAction, createInitialTable, projectTable } from '@rb-unbound/tabletop';

function tableWithP1AndP3Hands() {
  let table = createInitialTable([1, 2, 3, 4]);
  table = applyAction(table, { type: 'draw', player: 1 });
  table = applyAction(table, { type: 'draw', player: 3 });
  return table;
}

describe('team-aware hidden information', () => {
  it('shows only the viewer hand by default', () => {
    const view = projectTable(tableWithP1AndP3Hands(), 1);
    expect(view.cards.some(card => card.owner === 1 && card.zone === 'hand' && card.label)).toBe(true);
    expect(view.cards.some(card => card.owner === 3 && card.zone === 'hand')).toBe(false);
  });

  it('can explicitly reveal a teammate hand', () => {
    const view = projectTable(tableWithP1AndP3Hands(), 1, [1, 3]);
    expect(view.cards.some(card => card.owner === 3 && card.zone === 'hand' && card.label)).toBe(true);
  });

  it('does not reveal the teammate hand to an opponent', () => {
    const view = projectTable(tableWithP1AndP3Hands(), 2, [2]);
    expect(view.cards.some(card => card.owner === 1 && card.zone === 'hand')).toBe(false);
    expect(view.cards.some(card => card.owner === 3 && card.zone === 'hand')).toBe(false);
  });

  it('never projects deck identities even for authorized hand owners', () => {
    const view = projectTable(tableWithP1AndP3Hands(), 1, [1, 3]);
    expect(view.cards.some(card => card.zone === 'deck')).toBe(false);
  });

  it('spectators receive no private hands', () => {
    const view = projectTable(tableWithP1AndP3Hands());
    expect(view.cards.some(card => card.zone === 'hand')).toBe(false);
  });
});
