import { describe, expect, it } from 'vitest';
import { applyAction, type TableState } from '@rb-unbound/tabletop';

function state(): TableState {
  return {
    version: 4,
    cards: [
      { id: 'main-1', label: 'Main One', owner: 1, zone: 'main-deck', order: 0, x: 0, y: 0, rotation: 0, faceUp: false },
      { id: 'main-2', label: 'Main Two', owner: 1, zone: 'main-deck', order: 1, x: 0, y: 0, rotation: 0, faceUp: false },
      { id: 'resource-1', label: 'Resource One', owner: 1, zone: 'resource-deck', order: 0, x: 0, y: 0, rotation: 0, faceUp: false },
    ],
  };
}

describe('generic pile actions', () => {
  const zones = ['main-deck', 'resource-deck', 'hand', 'resources'];

  it('draws from a named pile into a named destination', () => {
    const result = applyAction(state(), {
      type: 'draw',
      player: 1,
      fromZone: 'resource-deck',
      toZone: 'resources',
    }, zones);

    expect(result.cards.find(card => card.id === 'resource-1')).toMatchObject({
      zone: 'resources',
      order: 0,
    });
    expect(result.cards.find(card => card.id === 'main-1')?.zone).toBe('main-deck');
  });

  it('shuffles only the requested pile', () => {
    const result = applyAction(state(), {
      type: 'shuffle',
      player: 1,
      zone: 'main-deck',
      orderedIds: ['main-2', 'main-1'],
    }, zones);

    expect(result.cards.find(card => card.id === 'main-2')?.order).toBe(0);
    expect(result.cards.find(card => card.id === 'main-1')?.order).toBe(1);
    expect(result.cards.find(card => card.id === 'resource-1')?.order).toBe(0);
  });

  it('rejects pile transfers into undeclared zones', () => {
    const original = state();
    const result = applyAction(original, {
      type: 'draw',
      player: 1,
      fromZone: 'resource-deck',
      toZone: 'nowhere',
    }, zones);
    expect(result).toBe(original);
  });
});
