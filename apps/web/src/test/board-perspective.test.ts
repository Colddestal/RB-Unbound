import { describe, expect, it } from 'vitest';
import { toCanonicalPoint, toViewerPoint, toViewerSeat } from '../board-perspective';

describe('1v1 board perspective', () => {
  it('keeps seat 1 in canonical orientation', () => {
    expect(toViewerPoint({ x: 120, y: 500 }, 1, '1v1')).toEqual({ x: 120, y: 500 });
    expect(toViewerSeat(1, 1, '1v1')).toBe(1);
  });

  it('rotates the board 180 degrees for seat 2 without rotating card faces', () => {
    expect(toViewerPoint({ x: 120, y: 500 }, 2, '1v1')).toEqual({ x: 880, y: 100 });
    expect(toViewerSeat(2, 2, '1v1')).toBe(1);
    expect(toViewerSeat(1, 2, '1v1')).toBe(2);
  });

  it('maps pointer coordinates back to canonical state', () => {
    const screen = toViewerPoint({ x: 240, y: 430 }, 2, '1v1');
    expect(toCanonicalPoint(screen, 2, '1v1')).toEqual({ x: 240, y: 430 });
  });

  it('does not mirror non-1v1 formats', () => {
    expect(toViewerPoint({ x: 120, y: 500 }, 2, '2v2')).toEqual({ x: 120, y: 500 });
  });
});
