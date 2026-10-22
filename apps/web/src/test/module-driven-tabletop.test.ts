import { describe, expect, it } from 'vitest';
import { builtInGameModules, frontierSkirmishModule, genericDuelModule, isGameModule } from '@rb-unbound/tabletop';

describe('built-in module rendering data', () => {
  it('ships two valid original modules', () => {
    expect(builtInGameModules).toHaveLength(2);
    expect(builtInGameModules.every(isGameModule)).toBe(true);
  });

  it('uses different zone labels between modules', () => {
    const genericDeck = genericDuelModule.zones.find(zone => zone.kind === 'deck')?.label;
    const frontierDeck = frontierSkirmishModule.zones.find(zone => zone.kind === 'deck')?.label;
    const genericField = genericDuelModule.zones.find(zone => zone.kind === 'field')?.label;
    const frontierField = frontierSkirmishModule.zones.find(zone => zone.kind === 'field')?.label;

    expect(genericDeck).toBe('Deck');
    expect(frontierDeck).toBe('Main Deck');
    expect(genericField).toBe('Field');
    expect(frontierField).toBe('Combat Area');
  });

  it('uses different card-back descriptors between modules', () => {
    expect(genericDuelModule.cardBacks[0].pattern).toBe('grid');
    expect(frontierSkirmishModule.cardBacks[0].pattern).toBe('stripes');
  });

  it('uses module-defined per-seat zone placement', () => {
    const genericDeck = genericDuelModule.zones.find(zone => zone.kind === 'deck');
    const frontierDeck = frontierSkirmishModule.zones.find(zone => zone.kind === 'deck');

    expect(genericDeck?.seatPositions?.['1']).toEqual({ x: 70, y: 470 });
    expect(frontierDeck?.seatPositions?.['1']).toEqual({ x: 75, y: 485 });
    expect(frontierDeck?.size).toEqual({ width: 70, height: 88 });
    expect(genericDeck?.seatPositions?.['1']).not.toEqual(frontierDeck?.seatPositions?.['1']);
  });

  it('keeps player piles grouped on the left rail and leader slots on the right rail', () => {
    const mainDeck = frontierSkirmishModule.zones.find(zone => zone.id === 'deck');
    const resourceDeck = frontierSkirmishModule.zones.find(zone => zone.id === 'resource-deck');
    const trash = frontierSkirmishModule.zones.find(zone => zone.id === 'discard');
    const champion = frontierSkirmishModule.zones.find(zone => zone.id === 'vanguard');
    const leader = frontierSkirmishModule.zones.find(zone => zone.id === 'commander');

    for (const seat of ['1', '2'] as const) {
      expect(mainDeck?.seatPositions?.[seat]?.x).toBe(75);
      expect(resourceDeck?.seatPositions?.[seat]?.x).toBe(75);
      expect(trash?.seatPositions?.[seat]?.x).toBe(75);
      expect(champion?.seatPositions?.[seat]?.x).toBe(925);
      expect(leader?.seatPositions?.[seat]?.x).toBe(925);
    }

    expect(resourceDeck?.seatPositions?.['1']?.y).toBeLessThan(mainDeck?.seatPositions?.['1']?.y ?? 0);
    expect(mainDeck?.seatPositions?.['1']?.y).toBeLessThan(trash?.seatPositions?.['1']?.y ?? 0);
    expect(champion?.seatPositions?.['1']?.y).toBeLessThan(leader?.seatPositions?.['1']?.y ?? 0);
  });

  it('supports sized owner-scoped mat areas', () => {
    const base = frontierSkirmishModule.zones.find(zone => zone.id === 'base');
    expect(base).toMatchObject({
      kind: 'custom',
      label: 'Base',
      behavior: 'location',
      ownerScoped: true,
      size: { width: 600, height: 80 },
      seatPositions: {
        '1': { x: 500, y: 410 },
        '2': { x: 500, y: 190 },
      },
    });
  });

  it('gives combat the dominant shared center area with two objective slots', () => {
    const battlefield = frontierSkirmishModule.zones.find(zone => zone.id === 'field');
    const objectiveA = frontierSkirmishModule.zones.find(zone => zone.id === 'objective-a');
    const objectiveB = frontierSkirmishModule.zones.find(zone => zone.id === 'objective-b');

    expect(battlefield).toMatchObject({
      label: 'Combat Area',
      role: 'combat-area',
      ownerScoped: false,
      defaultPosition: { x: 500, y: 300 },
      size: { width: 780, height: 138 },
    });
    expect(objectiveA).toMatchObject({
      behavior: 'slot',
      role: 'objective',
      capacity: 1,
      defaultPosition: { x: 285, y: 300 },
      displayCopies: [
        { x: 285, y: 258 },
        { x: 285, y: 342 },
      ],
      size: { width: 78, height: 54 },
    });
    expect(objectiveB).toMatchObject({
      behavior: 'slot',
      role: 'objective',
      capacity: 1,
      defaultPosition: { x: 715, y: 300 },
      displayCopies: [
        { x: 715, y: 258 },
        { x: 715, y: 342 },
      ],
      size: { width: 78, height: 54 },
    });
  });

  it('reserves mirrored hand and resource bands away from the center', () => {
    const hand = frontierSkirmishModule.zones.find(zone => zone.id === 'hand');
    const resources = frontierSkirmishModule.zones.find(zone => zone.id === 'resources');

    expect(hand?.seatPositions?.['1']).toEqual({ x: 500, y: 560 });
    expect(hand?.seatPositions?.['2']).toEqual({ x: 500, y: 40 });
    expect(resources?.seatPositions?.['1']).toEqual({ x: 500, y: 485 });
    expect(resources?.seatPositions?.['2']).toEqual({ x: 500, y: 115 });
    expect(resources?.size).toEqual({ width: 540, height: 70 });
  });
});
