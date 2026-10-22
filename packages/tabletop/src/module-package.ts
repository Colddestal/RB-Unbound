import { builtInCardCatalog, isCardDefinition, type CardDefinition } from './deck.js';
import { builtInGameModules, isGameModule, type GameModule } from './game-module.js';

export type ModulePackage = {
  packageSchemaVersion: 1;
  module: GameModule;
  cards: CardDefinition[];
};

export function modulePackageKey(module: Pick<GameModule, 'id' | 'version'>): string {
  return `${module.id}@${module.version}`;
}

export function isModulePackage(value: unknown): value is ModulePackage {
  if (!value || typeof value !== 'object') return false;
  const bundle = value as Partial<ModulePackage>;
  if (bundle.packageSchemaVersion !== 1 || !isGameModule(bundle.module)) return false;
  if (!Array.isArray(bundle.cards) || bundle.cards.length > 2000) return false;

  const ids = new Set<string>();
  for (const card of bundle.cards) {
    if (!isCardDefinition(card, bundle.module) || ids.has(card.id)) return false;
    ids.add(card.id);
  }
  return true;
}

export const builtInModulePackages: ModulePackage[] = builtInGameModules.map(module => ({
  packageSchemaVersion: 1,
  module,
  cards: builtInCardCatalog.filter(card => card.moduleId === module.id && card.moduleVersion === module.version),
}));

export function findModulePackage(
  packages: readonly ModulePackage[],
  moduleId: string,
  moduleVersion?: string,
): ModulePackage | undefined {
  return packages.find(bundle =>
    bundle.module.id === moduleId &&
    (moduleVersion === undefined || bundle.module.version === moduleVersion));
}
