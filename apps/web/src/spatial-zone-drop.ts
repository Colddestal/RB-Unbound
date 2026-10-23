import type { GameModule, PlayerId } from '@rb-unbound/tabletop';

export type BoardPoint = { x: number; y: number };

function canonicalZoneCenter(
  zone: GameModule['zones'][number],
  owner?: PlayerId,
): BoardPoint | undefined {
  if (zone.ownerScoped && owner) {
    const seatKey = String(owner) as '1' | '2' | '3' | '4';
    return zone.seatPositions?.[seatKey] ?? zone.defaultPosition;
  }
  return zone.defaultPosition;
}

function containsPoint(
  point: BoardPoint,
  center: BoardPoint,
  size: { width: number; height: number },
): boolean {
  return (
    point.x >= center.x - size.width / 2 &&
    point.x <= center.x + size.width / 2 &&
    point.y >= center.y - size.height / 2 &&
    point.y <= center.y + size.height / 2
  );
}

/**
 * Resolve the most specific spatial layer under a dropped card.
 *
 * Only movable zones in the requested logical group participate, so a
 * battlefield card can snap between Base and Combat Area without accidentally
 * becoming a Rune just because it crossed the Rune row.
 */
export function spatialDropZone(
  module: GameModule,
  point: BoardPoint,
  owner: PlayerId,
  group: string,
): string | undefined {
  const candidates = module.zones
    .filter(zone =>
      zone.stackable &&
      zone.group === group &&
      zone.size &&
      canonicalZoneCenter(zone, owner))
    .filter(zone => containsPoint(point, canonicalZoneCenter(zone, owner)!, zone.size!))
    // Prefer the smallest matching layer when module zones overlap.
    .sort((a, b) => (a.size!.width * a.size!.height) - (b.size!.width * b.size!.height));

  return candidates[0]?.id;
}
