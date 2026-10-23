import { describe, expect, it } from 'vitest';
import { frontierSkirmishModule } from '@rb-unbound/tabletop';
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
