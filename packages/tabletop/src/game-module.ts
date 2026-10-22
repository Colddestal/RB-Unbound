export type GameModuleFormat = '1v1' | '2v2' | 'ffa4';

export type ModuleZoneKind = 'deck' | 'hand' | 'field' | 'discard' | 'custom';
export type ModuleZoneVisibility = 'owner' | 'team' | 'public' | 'hidden';

export type ModuleZoneDefinition = {
  id: string;
  label: string;
  kind: ModuleZoneKind;
  visibility: ModuleZoneVisibility;
  ownerScoped: boolean;
  stackable?: boolean;
  defaultPosition?: {
    x: number;
    y: number;
  };
  seatPositions?: Partial<Record<'1' | '2' | '3' | '4', {
    x: number;
    y: number;
  }>>;
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

export const genericDuelModule: GameModule = {
  schemaVersion: 1,
  id: 'generic-duel',
  name: 'Generic Duel',
  version: '1.0.0',
  description: 'Original game-neutral example module for validating the RB Unbound module format.',
  supportedFormats: ['1v1', '2v2', 'ffa4'],
  zones: [
    { id: 'deck', label: 'Deck', kind: 'deck', visibility: 'hidden', ownerScoped: true, seatPositions: {
      '1': { x: 70, y: 470 },
      '2': { x: 850, y: 40 },
    } },
    { id: 'hand', label: 'Hand', kind: 'hand', visibility: 'owner', ownerScoped: true },
    { id: 'field', label: 'Field', kind: 'field', visibility: 'public', ownerScoped: false, stackable: true },
    { id: 'discard', label: 'Discard', kind: 'discard', visibility: 'public', ownerScoped: true, seatPositions: {
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
    { id: 'deck', label: 'Supply', kind: 'deck', visibility: 'hidden', ownerScoped: true, seatPositions: {
      '1': { x: 825, y: 455 },
      '2': { x: 80, y: 55 },
    } },
    { id: 'hand', label: 'Orders', kind: 'hand', visibility: 'owner', ownerScoped: true },
    { id: 'field', label: 'Frontier', kind: 'field', visibility: 'public', ownerScoped: false, stackable: true },
    { id: 'command-post', label: 'Command Post', kind: 'custom', visibility: 'public', ownerScoped: false, defaultPosition: { x: 500, y: 300 } },
    { id: 'discard', label: 'Scrapyard', kind: 'discard', visibility: 'public', ownerScoped: true, seatPositions: {
      '1': { x: 690, y: 455 },
      '2': { x: 215, y: 55 },
    } },
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
