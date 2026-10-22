import type { PlayerId } from '@rb-unbound/tabletop';

export type BoardPoint = { x: number; y: number };

export function isMirroredPerspective(viewer: PlayerId | undefined, format: string): boolean {
  return format === '1v1' && viewer === 2;
}

export function toViewerPoint(point: BoardPoint, viewer: PlayerId | undefined, format: string): BoardPoint {
  return isMirroredPerspective(viewer, format)
    ? { x: 1000 - point.x, y: 600 - point.y }
    : point;
}

export function toCanonicalPoint(point: BoardPoint, viewer: PlayerId | undefined, format: string): BoardPoint {
  // A 180-degree rotation is its own inverse.
  return toViewerPoint(point, viewer, format);
}

export function toViewerSeat(seat: PlayerId, viewer: PlayerId | undefined, format: string): PlayerId {
  if (!isMirroredPerspective(viewer, format)) return seat;
  if (seat === 1) return 2;
  if (seat === 2) return 1;
  return seat;
}
