import { describe, expect, it } from 'vitest';
import {
  builtInGameModules,
  createInitialTableForModule,
  frontierSkirmishModule,
  genericDuelModule,
} from '@rb-unbound/tabletop';

describe('multiplayer module contracts', () => {
  it('pins each module to an id and version', () => {
    for (const module of builtInGameModules) {
      expect(module.id).toBeTruthy();
      expect(module.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('exposes format compatibility', () => {
    expect(genericDuelModule.supportedFormats).toContain('ffa4');
    expect(frontierSkirmishModule.supportedFormats).not.toContain('ffa4');
    expect(frontierSkirmishModule.supportedFormats).toContain('2v2');
  });

  it('creates module-specific starter match cards', () => {
    const generic = createInitialTableForModule([1, 2], genericDuelModule);
    const frontier = createInitialTableForModule([1, 2], frontierSkirmishModule);

    expect(generic.cards.every(card => card.definitionId?.startsWith('dust-') !== true)).toBe(true);
    expect(frontier.cards.some(card => card.definitionId === 'dust-runner')).toBe(true);
    expect(generic.cards.some(card => card.definitionId === 'wandering-scout')).toBe(true);
  });
});
