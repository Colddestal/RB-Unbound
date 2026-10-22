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
    expect(frontierDeck).toBe('Supply');
    expect(genericField).toBe('Field');
    expect(frontierField).toBe('Frontier');
  });

  it('uses different card-back descriptors between modules', () => {
    expect(genericDuelModule.cardBacks[0].pattern).toBe('grid');
    expect(frontierSkirmishModule.cardBacks[0].pattern).toBe('stripes');
  });

  it('uses module-defined per-seat zone placement', () => {
    const genericDeck = genericDuelModule.zones.find(zone => zone.kind === 'deck');
    const frontierDeck = frontierSkirmishModule.zones.find(zone => zone.kind === 'deck');

    expect(genericDeck?.seatPositions?.['1']).toEqual({ x: 70, y: 470 });
    expect(frontierDeck?.seatPositions?.['1']).toEqual({ x: 825, y: 455 });
    expect(genericDeck?.seatPositions?.['1']).not.toEqual(frontierDeck?.seatPositions?.['1']);
  });

  it('supports module-defined custom board markers', () => {
    const commandPost = frontierSkirmishModule.zones.find(zone => zone.id === 'command-post');
    expect(commandPost).toMatchObject({
      kind: 'custom',
      label: 'Command Post',
      defaultPosition: { x: 500, y: 300 },
    });
  });
});
