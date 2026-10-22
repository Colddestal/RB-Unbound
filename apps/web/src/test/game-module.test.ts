import { describe, expect, it } from 'vitest';
import { genericDuelModule, isGameModule } from '@rb-unbound/tabletop';

describe('game module schema', () => {
  it('accepts the built-in generic module', () => {
    expect(isGameModule(genericDuelModule)).toBe(true);
  });

  it('rejects duplicate zone ids', () => {
    expect(isGameModule({
      ...genericDuelModule,
      zones: [
        ...genericDuelModule.zones,
        { ...genericDuelModule.zones[0], label: 'Duplicate deck' },
      ],
    })).toBe(false);
  });

  it('rejects executable or unsupported zone shapes', () => {
    expect(isGameModule({
      ...genericDuelModule,
      zones: [{
        id: 'script-zone',
        label: 'Script Zone',
        kind: 'script',
        visibility: 'public',
        ownerScoped: false,
      }],
    })).toBe(false);
  });

  it('rejects out-of-bounds default positions', () => {
    expect(isGameModule({
      ...genericDuelModule,
      zones: [{
        id: 'field',
        label: 'Field',
        kind: 'field',
        visibility: 'public',
        ownerScoped: false,
        defaultPosition: { x: 1200, y: 200 },
      }],
    })).toBe(false);
  });

  it('rejects duplicate card field ids', () => {
    expect(isGameModule({
      ...genericDuelModule,
      cardFields: [
        { id: 'type', label: 'Type', type: 'text' },
        { id: 'type', label: 'Other Type', type: 'text' },
      ],
    })).toBe(false);
  });
});
