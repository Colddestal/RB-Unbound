import { describe, expect, it } from 'vitest';
import {
  builtInCardCatalog,
  deckWarnings,
  genericDuelModule,
  frontierSkirmishModule,
  isCardDefinition,
  isDeckDefinition,
  searchCardCatalog,
  starterDeckForModule,
} from '@rb-unbound/tabletop';

describe('game-neutral cards and decks', () => {
  it('validates built-in cards against their module', () => {
    const genericCards = builtInCardCatalog.filter(card => card.moduleId === genericDuelModule.id);
    expect(genericCards.length).toBeGreaterThan(0);
    expect(genericCards.every(card => isCardDefinition(card, genericDuelModule))).toBe(true);
  });

  it('builds a valid starter deck for each module', () => {
    const generic = starterDeckForModule(genericDuelModule);
    const frontier = starterDeckForModule(frontierSkirmishModule);
    expect(isDeckDefinition(generic, genericDuelModule, builtInCardCatalog)).toBe(true);
    expect(isDeckDefinition(frontier, frontierSkirmishModule, builtInCardCatalog)).toBe(true);
  });

  it('rejects a deck from the wrong module', () => {
    const generic = starterDeckForModule(genericDuelModule);
    expect(isDeckDefinition(generic, frontierSkirmishModule, builtInCardCatalog)).toBe(false);
  });

  it('rejects unknown card ids', () => {
    const deck = { ...starterDeckForModule(genericDuelModule), cards: ['does-not-exist'] };
    expect(isDeckDefinition(deck, genericDuelModule, builtInCardCatalog)).toBe(false);
  });

  it('searches names and metadata', () => {
    expect(searchCardCatalog(builtInCardCatalog, frontierSkirmishModule, 'tidekeeper').map(card => card.id)).toContain('legend-tidekeeper');
    expect(searchCardCatalog(builtInCardCatalog, genericDuelModule, 'spirit').map(card => card.id)).toContain('amber-wisp');
  });

  it('warns for a fourth copy shared across main and side, and enforces dual-affinity legends', () => {
    const starter = starterDeckForModule(frontierSkirmishModule);
    expect(deckWarnings(starter, builtInCardCatalog)).toEqual([]);
    const fourth = { ...starter, sections: { ...starter.sections!, sideDeck: [starter.cards[0]] } };
    expect(deckWarnings(fourth, builtInCardCatalog).join(' ')).toMatch(/exceeds three copies/);
    expect(isCardDefinition({
      ...builtInCardCatalog.find(card => card.id === 'legend-tidekeeper')!,
      metadata: { slot: 'legend', identity: 'Mira', affinities: ['blue', 'green', 'purple'] },
    }, frontierSkirmishModule)).toBe(false);
  });
});
