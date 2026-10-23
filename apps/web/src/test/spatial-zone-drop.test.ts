import { describe, expect, it } from 'vitest';
import {
  applyAction,
  frontierSkirmishModule,
  type TableState,
} from '@rb-unbound/tabletop';
import { spatialDropZone } from '../spatial-zone-drop';

describe('spatial battlefield layer snapping', () => {
  it('resolves Player 1 Base before the shared Combat Area', () => {
    expect(spatialDropZone(
      frontierSkirmishModule,
      { x: 500, y: 410 },
      1,
      'battlefield',
    )).toBe('base');
  });

  it('resolves the center of the board to the shared Combat Area', () => {
    expect(spatialDropZone(
      frontierSkirmishModule,
      { x: 500, y: 300 },
      1,
      'battlefield',
    )).toBe('field');
  });

  it('uses the owning player Base geometry', () => {
    expect(spatialDropZone(
      frontierSkirmishModule,
      { x: 500, y: 190 },
      2,
      'battlefield',
    )).toBe('base');
  });

  it('does not classify the Rune row as a battlefield layer', () => {
    expect(spatialDropZone(
      frontierSkirmishModule,
      { x: 500, y: 485 },
      1,
      'battlefield',
    )).toBeUndefined();
  });
});


describe('battlefield layer transitions', () => {
  const allowedZones = frontierSkirmishModule.zones.map(zone => zone.id);
  const stackableZones = frontierSkirmishModule.zones.filter(zone => zone.stackable).map(zone => zone.id);
  const zoneGroups = new Map(frontierSkirmishModule.zones.map(zone => [zone.id, zone.group ?? zone.id] as const));

  const state: TableState = {
    version: 4,
    cards: [{
      id: 'unit-1',
      label: 'Unit',
      owner: 1,
      zone: 'field',
      order: 0,
      x: 520,
      y: 405,
      rotation: 0,
      faceUp: true,
    }],
  };

  it('preserves exact coordinates when snapping field into Base', () => {
    const result = applyAction(state, {
      type: 'to-zone',
      id: 'unit-1',
      actor: 1,
      zone: 'base',
    }, allowedZones, stackableZones, zoneGroups);

    expect(result.cards[0]).toMatchObject({ zone: 'base', x: 520, y: 405 });
  });

  it('preserves exact coordinates when snapping Base back to Combat Area', () => {
    const baseState: TableState = {
      ...state,
      cards: [{ ...state.cards[0], zone: 'base', x: 470, y: 330 }],
    };
    const result = applyAction(baseState, {
      type: 'to-zone',
      id: 'unit-1',
      actor: 1,
      zone: 'field',
    }, allowedZones, stackableZones, zoneGroups);

    expect(result.cards[0]).toMatchObject({ zone: 'field', x: 470, y: 330 });
  });
});
