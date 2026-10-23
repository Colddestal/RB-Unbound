import type { ModuleZoneDefinition, PlayerId } from '@rb-unbound/tabletop';

export type ZoneCardPoint = { x: number; y: number };

function zoneCenter(zone: ModuleZoneDefinition, owner?: PlayerId): ZoneCardPoint | undefined {
  if (zone.ownerScoped && owner) {
    const seatKey = String(owner) as '1' | '2' | '3' | '4';
    return zone.seatPositions?.[seatKey] ?? zone.defaultPosition;
  }
  return zone.defaultPosition;
}

/**
 * Returns the canonical board point for a card that has not been manually moved yet.
 * Manual card coordinates should take precedence once x/y are non-zero.
 */
export function automaticZoneCardPoint(
  zone: ModuleZoneDefinition,
  owner: PlayerId | undefined,
  index: number,
  count: number,
): ZoneCardPoint | undefined {
  const center = zoneCenter(zone, owner);
  if (!center) return undefined;
  if (zone.cardLayout !== 'horizontal' || !zone.size || count <= 1) return center;

  // Leave enough room at both ends for the card body itself.
  const horizontalPadding = 40;
  const usableWidth = Math.max(0, zone.size.width - horizontalPadding * 2);
  const maxSpread = 72;
  const spread = Math.min(maxSpread, usableWidth / Math.max(1, count - 1));
  const span = spread * (count - 1);

  return {
    x: center.x - span / 2 + spread * index,
    y: center.y,
  };
}
