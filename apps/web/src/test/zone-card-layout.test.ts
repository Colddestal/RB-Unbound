import { describe, expect, it } from 'vitest';
import { frontierSkirmishModule } from '@rb-unbound/tabletop';
import { automaticZoneCardPoint } from '../zone-card-layout';

describe('horizontal Rune row layout', () => {
  const runes = frontierSkirmishModule.zones.find(zone => zone.id === 'resources')!;

  it('keeps a single Rune centered in the zone', () => {
    expect(automaticZoneCardPoint(runes, 1, 0, 1)).toEqual({ x: 500, y: 470 });
  });

  it('spreads multiple Runes horizontally with a shared y coordinate', () => {
    const points = Array.from({ length: 3 }, (_, index) =>
      automaticZoneCardPoint(runes, 1, index, 3)!);

    expect(points.map(point => point.y)).toEqual([470, 470, 470]);
    expect(points[0].x).toBeLessThan(points[1].x);
    expect(points[1].x).toBeLessThan(points[2].x);
    expect(points[1].x).toBe(500);
  });

  it('fits all twelve starter Runes inside the declared Rune zone', () => {
    const points = Array.from({ length: 12 }, (_, index) =>
      automaticZoneCardPoint(runes, 1, index, 12)!);
    const left = 500 - runes.size!.width / 2;
    const right = 500 + runes.size!.width / 2;

    expect(points.every(point => point.y === 470)).toBe(true);
    expect(points[0].x).toBeGreaterThan(left);
    expect(points.at(-1)!.x).toBeLessThan(right);
    expect(new Set(points.map(point => point.x)).size).toBe(12);
  });

  it('mirrors the same horizontal layout around Player 2 Rune center', () => {
    const points = Array.from({ length: 4 }, (_, index) =>
      automaticZoneCardPoint(runes, 2, index, 4)!);

    expect(points.every(point => point.y === 110)).toBe(true);
    expect((points[0].x + points[3].x) / 2).toBe(500);
  });
});
