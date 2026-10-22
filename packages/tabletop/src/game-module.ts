export type GameModuleFormat = '1v1' | '2v2' | 'ffa4';

export type ModuleZoneKind = 'deck' | 'hand' | 'field' | 'discard' | 'custom';
export type ModuleZoneVisibility = 'owner' | 'team' | 'public' | 'hidden';
export type ModuleZoneBehavior = 'pile' | 'hand' | 'slot' | 'area' | 'location' | 'subzone';

export type ModuleZoneDefinition = {
  id: string;
  label: string;
  kind: ModuleZoneKind;
  visibility: ModuleZoneVisibility;
  ownerScoped: boolean;
  /**
   * Generic tabletop behavior. Optional for schema-v1 compatibility; legacy zones
   * are inferred from kind. Game-specific modules should prefer explicit behavior.
   */
  behavior?: ModuleZoneBehavior;
  /** Module-defined semantic role such as "main-deck", "leader" or "objective". */
  role?: string;
  /** Parent zone for visual/rules nesting, e.g. a facedown sub-zone inside a location. */
  parentZoneId?: string;
  /** Optional hard capacity hint. A slot must have capacity 1. */
  capacity?: number;
  stackable?: boolean;
  defaultPosition?: {
    x: number;
    y: number;
  };
  seatPositions?: Partial<Record<'1' | '2' | '3' | '4', {
    x: number;
    y: number;
  }>>;
  size?: {
    width: number;
    height: number;
  };
};

export type CardBackDefinition = {
  id: string;
  label: string;
  pattern: 'solid' | 'stripes' | 'diamonds' | 'grid';
};

export type CardFieldDefinition = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'tags';
};

export type GameModule = {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  supportedFormats: GameModuleFormat[];
  zones: ModuleZoneDefinition[];
  cardBacks: CardBackDefinition[];
  cardFields?: CardFieldDefinition[];
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function isGameModule(value: unknown): value is GameModule {
  if (!value || typeof value !== 'object') return false;
  const module = value as Partial<GameModule>;
  if (module.schemaVersion !== 1 || !validId(module.id)) return false;
  if (typeof module.name !== 'string' || module.name.length < 1 || module.name.length > 100) return false;
  if (typeof module.version !== 'string' || module.version.length < 1 || module.version.length > 40) return false;
  if (!Array.isArray(module.supportedFormats) || module.supportedFormats.length < 1) return false;
  if (module.supportedFormats.some(format => !['1v1', '2v2', 'ffa4'].includes(format))) return false;
  if (!Array.isArray(module.zones) || module.zones.length < 1 || module.zones.length > 32) return false;
  if (!Array.isArray(module.cardBacks) || module.cardBacks.length < 1 || module.cardBacks.length > 16) return false;

  const zoneIds = new Set<string>();
  for (const zone of module.zones) {
    if (!validId(zone?.id) || zoneIds.has(zone.id)) return false;
    zoneIds.add(zone.id);
    if (typeof zone.label !== 'string' || zone.label.length < 1 || zone.label.length > 80) return false;
    if (!['deck', 'hand', 'field', 'discard', 'custom'].includes(zone.kind)) return false;
    if (!['owner', 'team', 'public', 'hidden'].includes(zone.visibility)) return false;
    if (typeof zone.ownerScoped !== 'boolean') return false;
    if (zone.behavior !== undefined && !['pile', 'hand', 'slot', 'area', 'location', 'subzone'].includes(zone.behavior)) return false;
    if (zone.role !== undefined && !validId(zone.role)) return false;
    if (zone.parentZoneId !== undefined && !validId(zone.parentZoneId)) return false;
    if (zone.parentZoneId === zone.id) return false;
    if (zone.capacity !== undefined && (!Number.isInteger(zone.capacity) || zone.capacity < 1 || zone.capacity > 500)) return false;
    if (zone.behavior === 'slot' && zone.capacity !== undefined && zone.capacity !== 1) return false;
    if (zone.behavior === 'subzone' && !zone.parentZoneId) return false;
    if (zone.stackable !== undefined && typeof zone.stackable !== 'boolean') return false;
    if (zone.defaultPosition) {
      if (!Number.isFinite(zone.defaultPosition.x) || !Number.isFinite(zone.defaultPosition.y)) return false;
      if (zone.defaultPosition.x < 0 || zone.defaultPosition.x > 1000 || zone.defaultPosition.y < 0 || zone.defaultPosition.y > 600) return false;
    }
    if (zone.seatPositions) {
      for (const position of Object.values(zone.seatPositions)) {
        if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
        if (position.x < 0 || position.x > 1000 || position.y < 0 || position.y > 600) return false;
      }
    }
    if (zone.size) {
      if (!Number.isFinite(zone.size.width) || !Number.isFinite(zone.size.height)) return false;
      if (zone.size.width < 40 || zone.size.width > 1000 || zone.size.height < 40 || zone.size.height > 600) return false;
    }
  }

  for (const zone of module.zones) {
    if (zone.parentZoneId && !zoneIds.has(zone.parentZoneId)) return false;
    if (!zone.parentZoneId) continue;
    const visited = new Set<string>([zone.id]);
    let parentId: string | undefined = zone.parentZoneId;
    while (parentId) {
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      parentId = module.zones.find(candidate => candidate.id === parentId)?.parentZoneId;
    }
  }

  const backIds = new Set<string>();
  for (const back of module.cardBacks) {
    if (!validId(back?.id) || backIds.has(back.id)) return false;
    backIds.add(back.id);
    if (typeof back.label !== 'string' || back.label.length < 1 || back.label.length > 80) return false;
    if (!['solid', 'stripes', 'diamonds', 'grid'].includes(back.pattern)) return false;
  }

  if (module.cardFields) {
    if (!Array.isArray(module.cardFields) || module.cardFields.length > 32) return false;
    const fieldIds = new Set<string>();
    for (const field of module.cardFields) {
      if (!validId(field?.id) || fieldIds.has(field.id)) return false;
      fieldIds.add(field.id);
      if (typeof field.label !== 'string' || field.label.length < 1 || field.label.length > 80) return false;
      if (!['text', 'number', 'tags'].includes(field.type)) return false;
    }
  }

  return true;
}

export function zoneBehavior(zone: ModuleZoneDefinition): ModuleZoneBehavior {
  if (zone.behavior) return zone.behavior;
  if (zone.kind === 'deck' || zone.kind === 'discard') return 'pile';
  if (zone.kind === 'hand') return 'hand';
  if (zone.kind === 'field') return 'area';
  return 'area';
}

export function zoneCapacity(zone: ModuleZoneDefinition): number | undefined {
  if (zone.behavior === 'slot') return 1;
  return zone.capacity;
}

export function moduleZonesByBehavior(module: GameModule, behavior: ModuleZoneBehavior): ModuleZoneDefinition[] {
  return module.zones.filter(zone => zoneBehavior(zone) === behavior);
}

export function moduleZoneByRole(module: GameModule, role: string): ModuleZoneDefinition | undefined {
  return module.zones.find(zone => zone.role === role);
}

export const genericDuelModule: GameModule = {
  schemaVersion: 1,
  id: 'generic-duel',
  name: 'Generic Duel',
  version: '1.0.0',
  description: 'Original game-neutral example module for validating the RB Unbound module format.',
  supportedFormats: ['1v1', '2v2', 'ffa4'],
  zones: [
    { id: 'deck', label: 'Deck', kind: 'deck', visibility: 'hidden', ownerScoped: true, behavior: 'pile', role: 'main-deck', seatPositions: {
      '1': { x: 70, y: 470 },
      '2': { x: 850, y: 40 },
    } },
    { id: 'hand', label: 'Hand', kind: 'hand', visibility: 'owner', ownerScoped: true, behavior: 'hand', role: 'hand' },
    { id: 'field', label: 'Field', kind: 'field', visibility: 'public', ownerScoped: false, behavior: 'area', role: 'field', stackable: true, defaultPosition: { x: 500, y: 300 }, size: { width: 720, height: 220 } },
    { id: 'discard', label: 'Discard', kind: 'discard', visibility: 'public', ownerScoped: true, behavior: 'pile', role: 'discard', seatPositions: {
      '1': { x: 850, y: 470 },
      '2': { x: 90, y: 45 },
    } },
  ],
  cardBacks: [
    { id: 'project-poor-grid', label: 'Project Poor Grid', pattern: 'grid' },
  ],
  cardFields: [
    { id: 'type', label: 'Type', type: 'text' },
    { id: 'rules', label: 'Rules text', type: 'text' },
    { id: 'tags', label: 'Tags', type: 'tags' },
  ],
};


export const frontierSkirmishModule: GameModule = {
  schemaVersion: 1,
  id: 'frontier-skirmish',
  name: 'Frontier Skirmish',
  version: '1.0.0',
  description: 'Second original module used to prove that RB Unbound presentation can swap without core tabletop changes.',
  supportedFormats: ['1v1', '2v2'],
  zones: [
    { id: 'deck', label: 'Deck', kind: 'deck', visibility: 'hidden', ownerScoped: true, behavior: 'pile', role: 'main-deck', seatPositions: {
      '1': { x: 885, y: 355 },
      '2': { x: 115, y: 245 },
    }, size: { width: 95, height: 120 } },
    { id: 'hand', label: 'Hand', kind: 'hand', visibility: 'owner', ownerScoped: true },
    { id: 'field', label: 'Battlefield', kind: 'field', visibility: 'public', ownerScoped: false, behavior: 'location', role: 'battlefield', stackable: true,
      defaultPosition: { x: 500, y: 300 }, size: { width: 720, height: 190 } },
    { id: 'base', label: 'Base', kind: 'custom', visibility: 'public', ownerScoped: true, behavior: 'location', role: 'base', seatPositions: {
      '1': { x: 430, y: 455 },
      '2': { x: 570, y: 145 },
    }, size: { width: 560, height: 105 } },
    { id: 'resources', label: 'Resources', kind: 'custom', visibility: 'public', ownerScoped: true, behavior: 'area', role: 'resources', seatPositions: {
      '1': { x: 430, y: 555 },
      '2': { x: 570, y: 45 },
    }, size: { width: 560, height: 70 } },
    { id: 'commander', label: 'Commander', kind: 'custom', visibility: 'public', ownerScoped: true, behavior: 'slot', role: 'commander', capacity: 1, seatPositions: {
      '1': { x: 750, y: 455 },
      '2': { x: 250, y: 145 },
    }, size: { width: 95, height: 105 } },
    { id: 'vanguard', label: 'Vanguard', kind: 'custom', visibility: 'public', ownerScoped: true, behavior: 'slot', role: 'vanguard', capacity: 1, seatPositions: {
      '1': { x: 875, y: 455 },
      '2': { x: 125, y: 145 },
    }, size: { width: 95, height: 105 } },
    { id: 'resource-deck', label: 'Resource Deck', kind: 'custom', visibility: 'hidden', ownerScoped: true, behavior: 'pile', role: 'resource-deck', seatPositions: {
      '1': { x: 120, y: 555 },
      '2': { x: 880, y: 45 },
    }, size: { width: 95, height: 90 } },
    { id: 'discard', label: 'Discard', kind: 'discard', visibility: 'public', ownerScoped: true, seatPositions: {
      '1': { x: 885, y: 555 },
      '2': { x: 115, y: 45 },
    }, size: { width: 95, height: 90 } },
  ],
  cardBacks: [
    { id: 'frontier-stripes', label: 'Frontier Stripes', pattern: 'stripes' },
  ],
  cardFields: [
    { id: 'class', label: 'Class', type: 'text' },
    { id: 'power', label: 'Power', type: 'number' },
    { id: 'tags', label: 'Tags', type: 'tags' },
  ],
};

export const builtInGameModules: GameModule[] = [
  genericDuelModule,
  frontierSkirmishModule,
];
