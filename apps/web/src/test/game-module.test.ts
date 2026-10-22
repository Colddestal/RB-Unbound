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

  it('accepts explicit generic location/slot/subzone semantics', () => {
    expect(isGameModule({
      ...genericDuelModule,
      zones: [
        ...genericDuelModule.zones,
        {
          id: 'leader',
          label: 'Leader',
          kind: 'custom',
          visibility: 'public',
          ownerScoped: true,
          behavior: 'slot',
          role: 'leader',
          capacity: 1,
        },
        {
          id: 'objective',
          label: 'Objective',
          kind: 'custom',
          visibility: 'public',
          ownerScoped: false,
          behavior: 'location',
          role: 'objective',
        },
        {
          id: 'objective-hidden',
          label: 'Facedown',
          kind: 'custom',
          visibility: 'owner',
          ownerScoped: false,
          behavior: 'subzone',
          role: 'facedown',
          parentZoneId: 'objective',
          capacity: 1,
        },
      ],
    })).toBe(true);
  });

  it('rejects invalid nested zone parents and slot capacities', () => {
    expect(isGameModule({
      ...genericDuelModule,
      zones: [{
        id: 'bad-slot',
        label: 'Bad Slot',
        kind: 'custom',
        visibility: 'public',
        ownerScoped: true,
        behavior: 'slot',
        capacity: 2,
      }],
    })).toBe(false);

    expect(isGameModule({
      ...genericDuelModule,
      zones: [{
        id: 'orphan',
        label: 'Orphan',
        kind: 'custom',
        visibility: 'owner',
        ownerScoped: true,
        behavior: 'subzone',
        parentZoneId: 'missing-parent',
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
