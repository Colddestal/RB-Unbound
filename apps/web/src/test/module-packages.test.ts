import { beforeEach, describe, expect, it } from 'vitest';
import {
  builtInModulePackages,
  createInitialTableForModule,
  createTableSaveFile,
  frontierSkirmishModule,
  isModulePackage,
  isTableSaveFile,
  modulePackageKey,
  type ModulePackage,
} from '@rb-unbound/tabletop';
import {
  installModulePackage,
  loadInstalledModulePackages,
  saveInstalledModulePackages,
} from '../module-library';

function customPackage(): ModulePackage {
  const base = builtInModulePackages.find(bundle => bundle.module.id === frontierSkirmishModule.id)!;
  const module = { ...base.module, id: 'custom-frontier', name: 'Custom Frontier', version: '2.0.0' };
  return {
    packageSchemaVersion: 1,
    module,
    cards: base.cards.map(card => ({
      ...card,
      moduleId: module.id,
      moduleVersion: module.version,
    })),
  };
}

describe('module package loading and compatibility', () => {
  beforeEach(() => window.localStorage.clear());

  it('accepts a valid declarative package and persists it locally', () => {
    const custom = customPackage();
    expect(isModulePackage(custom)).toBe(true);
    const result = installModulePackage(builtInModulePackages, custom);
    expect(result.installed?.module.id).toBe('custom-frontier');
    saveInstalledModulePackages(result.packages);
    expect(loadInstalledModulePackages().some(bundle => modulePackageKey(bundle.module) === 'custom-frontier@2.0.0')).toBe(true);
  });

  it('rejects unknown package schema versions', () => {
    const invalid = { ...customPackage(), packageSchemaVersion: 2 };
    expect(isModulePackage(invalid)).toBe(false);
  });

  it('rejects attempts to replace a built-in module version', () => {
    const builtIn = builtInModulePackages[0];
    const spoof = {
      ...builtIn,
      module: { ...builtIn.module, name: 'Spoofed built-in' },
    };
    const result = installModulePackage(builtInModulePackages, spoof);
    expect(result.error).toMatch(/cannot be replaced/i);
  });

  it('creates custom-module match state from that package catalog', () => {
    const custom = customPackage();
    const table = createInitialTableForModule([1, 2], custom.module, custom.cards);
    expect(table.cards.length).toBeGreaterThan(0);
    expect(table.cards.every(card => card.definitionId && custom.cards.some(def => def.id === card.definitionId))).toBe(true);
  });

  it('pins module id and version in table save files', () => {
    const custom = customPackage();
    const table = createInitialTableForModule([1], custom.module, custom.cards);
    const save = createTableSaveFile(table, custom.module);
    expect(isTableSaveFile(save)).toBe(true);
    expect(save.moduleId).toBe('custom-frontier');
    expect(save.moduleVersion).toBe('2.0.0');
  });
});
