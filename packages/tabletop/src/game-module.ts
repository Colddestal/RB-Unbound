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
  /** Logical interaction group. Zones in the same group can be treated as one broader play area. */
  group?: string;
  /** Presentation layout for untouched cards in this zone. */
  cardLayout?: 'stack' | 'horizontal';
  /** Parent zone for visual/rules nesting, e.g. a facedown sub-zone inside a location. */
  parentZoneId?: string;
  /** Optional hard capacity hint. A slot must have capacity 1. */
  capacity?: number;
  /** Optional additional visual copies for one underlying shared zone/card. */
  displayCopies?: Array<{ x: number; y: number }>;
  /** Declarative pile interactions. Only valid on pile behavior zones. */
  pile?: {
    drawToZoneId?: string;
    shuffle?: boolean;
    /** Optional placeholder cards to seed into this pile for prototype/demo modules. */
    initialCount?: number;
    initialLabel?: string;
    /** Whether clients may see the number of cards in this hidden pile. */
    countPublic?: boolean;
  };
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
    if (zone.group !== undefined && !validId(zone.group)) return false;
    if (zone.cardLayout !== undefined && zone.cardLayout !== 'stack' && zone.cardLayout !== 'horizontal') return false;
    if (zone.parentZoneId !== undefined && !validId(zone.parentZoneId)) return false;
    if (zone.parentZoneId === zone.id) return false;
    if (zone.capacity !== undefined && (!Number.isInteger(zone.capacity) || zone.capacity < 1 || zone.capacity > 500)) return false;
    if (zone.displayCopies !== undefined) {
      if (!Array.isArray(zone.displayCopies) || zone.displayCopies.length < 1 || zone.displayCopies.length > 8) return false;
      if (!zone.displayCopies.every(point =>
        point && typeof point === 'object' &&
        Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= 0 && point.x <= 1000 &&
        point.y >= 0 && point.y <= 600)) return false;
    }
    if (zone.behavior === 'slot' && zone.capacity !== undefined && zone.capacity !== 1) return false;
    if (zone.behavior === 'subzone' && !zone.parentZoneId) return false;
    if (zone.pile !== undefined) {
      if (zoneBehavior(zone) !== 'pile') return false;
      if (zone.pile.drawToZoneId !== undefined && !validId(zone.pile.drawToZoneId)) return false;
      if (zone.pile.shuffle !== undefined && typeof zone.pile.shuffle !== 'boolean') return false;
      if (zone.pile.initialCount !== undefined && (!Number.isInteger(zone.pile.initialCount) || zone.pile.initialCount < 0 || zone.pile.initialCount > 100)) return false;
      if (zone.pile.initialLabel !== undefined && (typeof zone.pile.initialLabel !== 'string' || zone.pile.initialLabel.length < 1 || zone.pile.initialLabel.length > 80)) return false;
      if (zone.pile.countPublic !== undefined && typeof zone.pile.countPublic !== 'boolean') return false;
    }
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
    if (zone.pile?.drawToZoneId && !zoneIds.has(zone.pile.drawToZoneId)) return false;
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

export function pileCapabilities(module: GameModule, zone: ModuleZoneDefinition): {
  drawToZoneId?: string;
  shuffle: boolean;
} {
  if (zoneBehavior(zone) !== 'pile') return { shuffle: false };
  if (zone.pile) return {
    ...(zone.pile.drawToZoneId ? { drawToZoneId: zone.pile.drawToZoneId } : {}),
    shuffle: zone.pile.shuffle === true,
  };

  // Backward compatibility for existing schema-v1 deck zones.
  if (zone.kind === 'deck') {
    const hand = module.zones.find(candidate => candidate.kind === 'hand');
    return { drawToZoneId: hand?.id ?? 'hand', shuffle: true };
  }
  return { shuffle: false };
}

export const genericDuelModule: GameModule = {
  schemaVersion: 1,
  id: 'generic-duel',
  name: 'Generic Duel',
  version: '1.0.0',
  description: 'Original game-neutral example module for validating the RB Unbound module format.',
  supportedFormats: ['1v1', '2v2', 'ffa4'],
  zones: [
    { id: 'deck', label: 'Deck', kind: 'deck', visibility: 'hidden', ownerScoped: true, behavior: 'pile', role: 'main-deck', pile: { drawToZoneId: 'hand', shuffle: true, countPublic: true }, seatPositions: {
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
  name: 'Full Mat Prototype',
  version: '1.0.0',
  description: 'Location-based proof module with a mirrored mat, Legend and Champion slots, Main and Rune piles, player Bases, Runes rows and two shared Battlefields.',
  supportedFormats: ['1v1', '2v2'],
  zones: [
    {
      id: 'deck',
      label: 'Main Deck',
      kind: 'deck',
      visibility: 'hidden',
      ownerScoped: true,
      behavior: 'pile',
      role: 'main-deck',
      pile: { drawToZoneId: 'hand', shuffle: true },
      seatPositions: {
        '1': { x: 75, y: 485 },
        '2': { x: 75, y: 145 },
      },
      size: { width: 70, height: 88 },
    },
    {
      id: 'hand',
      label: 'Hand',
      kind: 'hand',
      visibility: 'owner',
      ownerScoped: true,
      behavior: 'hand',
      role: 'hand',
      seatPositions: {
        '1': { x: 500, y: 560 },
        '2': { x: 500, y: 40 },
      },
      size: { width: 620, height: 72 },
    },
    {
      id: 'field',
      label: 'Combat Area',
      kind: 'field',
      visibility: 'public',
      ownerScoped: false,
      behavior: 'area',
      role: 'combat-area',
      group: 'battlefield',
      stackable: true,
      defaultPosition: { x: 500, y: 300 },
      size: { width: 780, height: 138 },
    },
    {
      id: 'base',
      label: 'Base',
      kind: 'custom',
      visibility: 'public',
      ownerScoped: true,
      behavior: 'location',
      role: 'base',
      group: 'battlefield',
      stackable: true,
      seatPositions: {
        '1': { x: 500, y: 410 },
        '2': { x: 500, y: 190 },
      },
      size: { width: 600, height: 80 },
    },
    {
      id: 'resources',
      label: 'Runes',
      kind: 'custom',
      visibility: 'public',
      ownerScoped: true,
      behavior: 'area',
      role: 'runes',
      group: 'runes',
      cardLayout: 'horizontal',
      stackable: true,
      seatPositions: {
        '1': { x: 500, y: 485 },
        '2': { x: 500, y: 115 },
      },
      size: { width: 540, height: 70 },
    },
    {
      id: 'commander',
      label: 'Legend',
      kind: 'custom',
      visibility: 'public',
      ownerScoped: true,
      behavior: 'slot',
      role: 'legend',
      capacity: 1,
      seatPositions: {
        '1': { x: 925, y: 515 },
        '2': { x: 925, y: 175 },
      },
      size: { width: 62, height: 82 },
    },
    {
      id: 'vanguard',
      label: 'Champion',
      kind: 'custom',
      visibility: 'public',
      ownerScoped: true,
      behavior: 'slot',
      role: 'champion',
      capacity: 1,
      seatPositions: {
        '1': { x: 925, y: 420 },
        '2': { x: 925, y: 80 },
      },
      size: { width: 62, height: 82 },
    },
    {
      id: 'resource-deck',
      label: 'Rune Deck',
      kind: 'custom',
      visibility: 'hidden',
      ownerScoped: true,
      behavior: 'pile',
      role: 'rune-deck',
      pile: { drawToZoneId: 'resources', shuffle: true, initialCount: 12, initialLabel: 'Rune', countPublic: true },
      seatPositions: {
        '1': { x: 75, y: 390 },
        '2': { x: 75, y: 50 },
      },
      size: { width: 70, height: 82 },
    },
    {
      id: 'discard',
      label: 'Trash',
      kind: 'discard',
      visibility: 'public',
      ownerScoped: true,
      behavior: 'pile',
      role: 'discard',
      seatPositions: {
        '1': { x: 75, y: 565 },
        '2': { x: 75, y: 225 },
      },
      size: { width: 70, height: 82 },
    },
    {
      id: 'objective-a',
      label: 'Battlefield A',
      kind: 'custom',
      visibility: 'public',
      ownerScoped: false,
      behavior: 'slot',
      role: 'objective',
      capacity: 1,
      defaultPosition: { x: 285, y: 300 },
      displayCopies: [
        { x: 285, y: 258 },
        { x: 285, y: 342 },
      ],
      size: { width: 78, height: 54 },
    },
    {
      id: 'objective-b',
      label: 'Battlefield B',
      kind: 'custom',
      visibility: 'public',
      ownerScoped: false,
      behavior: 'slot',
      role: 'objective',
      capacity: 1,
      defaultPosition: { x: 715, y: 300 },
      displayCopies: [
        { x: 715, y: 258 },
        { x: 715, y: 342 },
      ],
      size: { width: 78, height: 54 },
    },
    {
      id: 'objective-a-hidden',
      label: 'A Facedown',
      kind: 'custom',
      visibility: 'owner',
      ownerScoped: true,
      behavior: 'subzone',
      role: 'facedown',
      parentZoneId: 'objective-a',
      capacity: 1,
    },
    {
      id: 'objective-b-hidden',
      label: 'B Facedown',
      kind: 'custom',
      visibility: 'owner',
      ownerScoped: true,
      behavior: 'subzone',
      role: 'facedown',
      parentZoneId: 'objective-b',
      capacity: 1,
    },
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

export const defaultGameModule = frontierSkirmishModule;
