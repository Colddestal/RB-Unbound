import {
  builtInModulePackages,
  isModulePackage,
  modulePackageKey,
  type ModulePackage,
} from '@rb-unbound/tabletop';

const STORAGE_KEY = 'rb-unbound-module-packages-v1';
const builtInKeys = new Set(builtInModulePackages.map(bundle => modulePackageKey(bundle.module)));

export function loadInstalledModulePackages(): ModulePackage[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const custom = Array.isArray(parsed)
      ? parsed.filter(isModulePackage).filter(bundle => !builtInKeys.has(modulePackageKey(bundle.module)))
      : [];
    const byKey = new Map<string, ModulePackage>();
    for (const bundle of [...builtInModulePackages, ...custom]) byKey.set(modulePackageKey(bundle.module), bundle);
    return [...byKey.values()];
  } catch {
    return [...builtInModulePackages];
  }
}

export function saveInstalledModulePackages(packages: readonly ModulePackage[]): void {
  const custom = packages.filter(bundle => !builtInKeys.has(modulePackageKey(bundle.module)));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
}

export function isBuiltInModulePackage(bundle: ModulePackage): boolean {
  return builtInKeys.has(modulePackageKey(bundle.module));
}

export function installModulePackage(
  current: readonly ModulePackage[],
  value: unknown,
): { packages: ModulePackage[]; installed?: ModulePackage; error?: string } {
  if (!isModulePackage(value)) return { packages: [...current], error: 'Invalid or unsupported module package.' };
  const key = modulePackageKey(value.module);
  if (builtInKeys.has(key)) return { packages: [...current], error: 'Built-in module versions cannot be replaced.' };

  const packages = current.filter(bundle => modulePackageKey(bundle.module) !== key);
  packages.push(value);
  return { packages, installed: value };
}
