import { describe, expect, it } from 'vitest';
import { localHandDropRect, pointInRect } from '../drag-drop';

describe('tabletop drag drop helpers', () => {
  it('detects points inside a rectangle', () => {
    const rect = { left: 10, right: 110, top: 20, bottom: 120 };
    expect(pointInRect({ x: 60, y: 60 }, rect)).toBe(true);
    expect(pointInRect({ x: 5, y: 60 }, rect)).toBe(false);
  });

  it('creates a bottom hand return target inside the local board', () => {
    const board = { left: 100, right: 1100, top: 50, bottom: 650 };
    const hand = localHandDropRect(board);

    expect(hand.left).toBe(board.left);
    expect(hand.right).toBe(board.right);
    expect(hand.bottom).toBe(board.bottom);
    expect(hand.top).toBeGreaterThan(board.top);
    expect(pointInRect({ x: 500, y: 620 }, hand)).toBe(true);
    expect(pointInRect({ x: 500, y: 300 }, hand)).toBe(false);
  });
});
