import { describe, expect, it } from 'vitest';
import {
  applyAction,
  frontierSkirmishModule,
  type TableState,
} from '@rb-unbound/tabletop';

const allowedZones = frontierSkirmishModule.zones.map(zone => zone.id);
const stackableZones = frontierSkirmishModule.zones.filter(zone => zone.stackable).map(zone => zone.id);
const zoneGroups = new Map(frontierSkirmishModule.zones.map(zone => [zone.id, zone.group ?? zone.id] as const));

function state(): TableState {
  return {
    version: 4,
    cards: [
      { id: 'rune-1', label: 'Rune 1', owner: 1, zone: 'resources', order: 0, x: 500, y: 485, rotation: 0, faceUp: true },
      { id: 'base-unit', label: 'Base Unit', owner: 1, zone: 'base', order: 0, x: 500, y: 410, rotation: 0, faceUp: true },
      { id: 'field-unit', label: 'Field Unit', owner: 1, zone: 'field', order: 0, x: 500, y: 320, rotation: 0, faceUp: true },
    ],
  };
}

describe('movable mat zones', () => {
  it('marks Runes and Base as freely movable zones', () => {
    const runes = frontierSkirmishModule.zones.find(zone => zone.id === 'resources');
    const base = frontierSkirmishModule.zones.find(zone => zone.id === 'base');
    const field = frontierSkirmishModule.zones.find(zone => zone.id === 'field');

    expect(runes?.stackable).toBe(true);
    expect(base?.stackable).toBe(true);
    expect(base?.group).toBe('battlefield');
    expect(field?.group).toBe('battlefield');
  });

  it('moves Rune cards with the same move action used by field cards', () => {
    const result = applyAction(state(), {
      type: 'move',
      id: 'rune-1',
      actor: 1,
      x: 615,
      y: 505,
    }, allowedZones, stackableZones, zoneGroups);

    expect(result.cards.find(card => card.id === 'rune-1')).toMatchObject({ x: 615, y: 505, zone: 'resources' });
  });

  it('preserves coordinates when moving from Base into the Combat Area', () => {
    const moved = applyAction(state(), {
      type: 'move',
      id: 'base-unit',
      actor: 1,
      x: 610,
      y: 320,
    }, allowedZones, stackableZones, zoneGroups);
    const result = applyAction(moved, {
      type: 'to-zone',
      id: 'base-unit',
      zone: 'field',
      actor: 1,
    }, allowedZones, stackableZones, zoneGroups);

    expect(result.cards.find(card => card.id === 'base-unit')).toMatchObject({
      zone: 'field',
      x: 610,
      y: 320,
    });
  });

  it('plays a hand card face-down when spatially assigned directly to Base', () => {
    const withHandCard: TableState = {
      ...state(),
      cards: [
        ...state().cards,
        { id: 'hand-card', label: 'Hand Card', owner: 1, zone: 'hand', order: 0, x: 0, y: 0, rotation: 0, faceUp: true },
      ],
    };
    const result = applyAction(withHandCard, {
      type: 'to-zone',
      id: 'hand-card',
      zone: 'base',
      actor: 1,
    }, allowedZones, stackableZones, zoneGroups);

    expect(result.cards.find(card => card.id === 'hand-card')).toMatchObject({
      zone: 'base',
      faceUp: false,
    });
  });

  it('treats Base and field as one battlefield interaction group', () => {
    const result = applyAction(state(), {
      type: 'stack',
      id: 'base-unit',
      targetId: 'field-unit',
      actor: 1,
    }, allowedZones, stackableZones, zoneGroups);

    expect(result.cards.find(card => card.id === 'base-unit')?.stackOn).toBe('field-unit');
  });
});
