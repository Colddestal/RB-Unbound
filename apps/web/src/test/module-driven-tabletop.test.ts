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
    expect(frontierDeck).toBe('Deck');
    expect(genericField).toBe('Field');
    expect(frontierField).toBe('Battlefield');
  });

  it('uses different card-back descriptors between modules', () => {
    expect(genericDuelModule.cardBacks[0].pattern).toBe('grid');
    expect(frontierSkirmishModule.cardBacks[0].pattern).toBe('stripes');
  });

  it('uses module-defined per-seat zone placement', () => {
    const genericDeck = genericDuelModule.zones.find(zone => zone.kind === 'deck');
    const frontierDeck = frontierSkirmishModule.zones.find(zone => zone.kind === 'deck');

    expect(genericDeck?.seatPositions?.['1']).toEqual({ x: 70, y: 470 });
    expect(frontierDeck?.seatPositions?.['1']).toEqual({ x: 885, y: 355 });
    expect(genericDeck?.seatPositions?.['1']).not.toEqual(frontierDeck?.seatPositions?.['1']);
  });

  it('supports sized owner-scoped mat areas', () => {
    const base = frontierSkirmishModule.zones.find(zone => zone.id === 'base');
    expect(base).toMatchObject({
      kind: 'custom',
      label: 'Base',
      ownerScoped: true,
      size: { width: 560, height: 105 },
      seatPositions: {
        '1': { x: 430, y: 455 },
        '2': { x: 570, y: 145 },
      },
    });
  });

  it('gives the battlefield the dominant shared center area', () => {
    const battlefield = frontierSkirmishModule.zones.find(zone => zone.id === 'field');
    expect(battlefield).toMatchObject({
      label: 'Battlefield',
      ownerScoped: false,
      defaultPosition: { x: 500, y: 300 },
      size: { width: 720, height: 190 },
    });
  });
});
