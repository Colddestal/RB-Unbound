import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialTableForModule,
  defaultGameModule,
  frontierSkirmishModule,
  projectTable,
} from '@rb-unbound/tabletop';

describe('default full mat', () => {
  it('uses the full location mat as the product default', () => {
    expect(defaultGameModule.id).toBe(frontierSkirmishModule.id);
  });

  it('exposes the requested Legend Champion Rune Deck and Runes zones', () => {
    const labels = Object.fromEntries(frontierSkirmishModule.zones.map(zone => [zone.id, zone.label]));
    expect(labels.commander).toBe('Legend');
    expect(labels.vanguard).toBe('Champion');
    expect(labels['resource-deck']).toBe('Rune Deck');
    expect(labels.resources).toBe('Runes');
    expect(labels.base).toBe('Base');
    expect(labels.deck).toBe('Main Deck');
    expect(labels.discard).toBe('Trash');
  });

  it('seeds a real 12-card Rune Deck for every player', () => {
    const table = createInitialTableForModule([1, 2], frontierSkirmishModule);
    for (const owner of [1, 2] as const) {
      expect(table.cards.filter(card => card.owner === owner && card.zone === 'resource-deck')).toHaveLength(12);
      expect(table.cards.filter(card => card.owner === owner && card.zone === 'deck').length).toBeGreaterThan(0);
      expect(table.cards.filter(card => card.owner === owner && card.zone === 'resources')).toHaveLength(0);
    }
  });

  it('draws a rune face-up into the Runes row', () => {
    const initial = createInitialTableForModule([1], frontierSkirmishModule);
    const zones = frontierSkirmishModule.zones.map(zone => zone.id);
    const next = applyAction(initial, {
      type: 'draw',
      player: 1,
      fromZone: 'resource-deck',
      toZone: 'resources',
      faceUp: true,
    }, zones);

    expect(next.cards.filter(card => card.owner === 1 && card.zone === 'resource-deck')).toHaveLength(11);
    const rune = next.cards.find(card => card.owner === 1 && card.zone === 'resources');
    expect(rune).toBeTruthy();
    expect(rune?.faceUp).toBe(true);
  });

  it('publishes Rune Deck counts without publishing hidden rune identities', () => {
    const table = createInitialTableForModule([1], frontierSkirmishModule);
    const view = projectTable(table, 1, [1], ['field', 'discard', 'base', 'resources'], ['deck', 'resource-deck']);

    expect(view.cards.some(card => card.zone === 'resource-deck')).toBe(false);
    const summary = view.hidden.find(item => item.owner === 1);
    expect(summary?.zoneCounts?.['resource-deck']).toBe(12);
    expect(summary?.zoneCounts?.deck).toBeGreaterThan(0);
  });
});
