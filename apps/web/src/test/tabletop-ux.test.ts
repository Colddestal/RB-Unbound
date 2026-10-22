import { describe, expect, it } from 'vitest';
import { applyAction, createInitialTable, migrateTableState } from '@rb-unbound/tabletop';

describe('tabletop interaction UX', () => {
  it('uses rotation as a 0/90 tap toggle', () => {
    let table = createInitialTable([1]);
    const card = table.cards[0];

    table = applyAction(table, { type: 'rotate', id: card.id, actor: 1 });
    expect(table.cards.find(item => item.id === card.id)?.rotation).toBe(90);

    table = applyAction(table, { type: 'rotate', id: card.id, actor: 1 });
    expect(table.cards.find(item => item.id === card.id)?.rotation).toBe(0);
  });

  it('plays cards from hand to field face-down', () => {
    let table = createInitialTable([1]);
    table = applyAction(table, { type: 'draw', player: 1 });
    const card = table.cards.find(item => item.zone === 'hand')!;
    expect(card.faceUp).toBe(true);

    table = applyAction(table, { type: 'to-zone', id: card.id, zone: 'field', actor: 1 });
    const played = table.cards.find(item => item.id === card.id)!;
    expect(played.zone).toBe('field');
    expect(played.faceUp).toBe(false);
  });

  it('returns field cards to hand as owner-visible cards', () => {
    let table = createInitialTable([1]);
    table = applyAction(table, { type: 'draw', player: 1 });
    const card = table.cards.find(item => item.zone === 'hand')!;
    table = applyAction(table, { type: 'to-zone', id: card.id, zone: 'field', actor: 1 });
    expect(table.cards.find(item => item.id === card.id)?.faceUp).toBe(false);

    table = applyAction(table, { type: 'to-zone', id: card.id, zone: 'hand', actor: 1 });
    const returned = table.cards.find(item => item.id === card.id)!;
    expect(returned.zone).toBe('hand');
    expect(returned.faceUp).toBe(true);
  });

  it('normalizes old 180/270 degree orientations to upright', () => {
    const table = createInitialTable([1, 2]);
    const old = {
      ...table,
      cards: table.cards.map((card, index) => ({ ...card, rotation: index % 2 === 0 ? 180 : 270 })),
    };
    const migrated = migrateTableState(old)!;
    expect(migrated.cards.every(card => card.rotation === 0)).toBe(true);
  });
});
