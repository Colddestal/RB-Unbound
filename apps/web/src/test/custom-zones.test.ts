import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialTable,
  frontierSkirmishModule,
  migrateTableState,
  projectTable,
  type LegacyTableStateV3,
} from '@rb-unbound/tabletop';

const allowed = frontierSkirmishModule.zones.map(zone => zone.id);
const stackable = frontierSkirmishModule.zones.filter(zone => zone.stackable).map(zone => zone.id);
const publicZones = frontierSkirmishModule.zones.filter(zone => zone.visibility === 'public').map(zone => zone.id);

describe('interactive custom zones', () => {
  it('moves an owned card into a module-defined custom zone', () => {
    let table = createInitialTable([1, 2]);
    table = applyAction(table, { type: 'draw', player: 1 }, allowed, stackable);
    const card = table.cards.find(item => item.owner === 1 && item.zone === 'hand')!;
    table = applyAction(table, { type: 'to-zone', id: card.id, zone: 'base', actor: 1 }, allowed, stackable);
    expect(table.cards.find(item => item.id === card.id)?.zone).toBe('base');
  });

  it('rejects zones not declared by the active module', () => {
    let table = createInitialTable([1]);
    table = applyAction(table, { type: 'draw', player: 1 }, allowed, stackable);
    const card = table.cards.find(item => item.zone === 'hand')!;
    const next = applyAction(table, { type: 'to-zone', id: card.id, zone: 'not-real', actor: 1 }, allowed, stackable);
    expect(next).toBe(table);
    expect(next.cards.find(item => item.id === card.id)?.zone).toBe('hand');
  });

  it('projects public custom zones', () => {
    let table = createInitialTable([1, 2]);
    table = applyAction(table, { type: 'draw', player: 1 }, allowed, stackable);
    const card = table.cards.find(item => item.owner === 1 && item.zone === 'hand')!;
    table = applyAction(table, { type: 'to-zone', id: card.id, zone: 'base', actor: 1 }, allowed, stackable);
    const view = projectTable(table, 2, [2], publicZones);
    expect(view.cards.some(item => item.zone === 'base' && item.id === card.id)).toBe(true);
  });

  it('migrates legacy v3 saves to v4', () => {
    const current = createInitialTable([1]);
    const legacy: LegacyTableStateV3 = {
      version: 3,
      cards: current.cards.map(card => ({ ...card, zone: card.zone as 'deck' | 'hand' | 'field' | 'discard' })),
    };
    const migrated = migrateTableState(legacy);
    expect(migrated?.version).toBe(4);
    expect(migrated?.cards).toHaveLength(current.cards.length);
  });
});
