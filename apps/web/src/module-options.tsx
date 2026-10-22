import { useRef, useState } from 'react';
import {
  modulePackageKey,
  type ModulePackage,
} from '@rb-unbound/tabletop';
import {
  installModulePackage,
  isBuiltInModulePackage,
} from './module-library';

export function ModuleOptions({
  packages,
  onChange,
  onClose,
}: {
  packages: ModulePackage[];
  onChange: (packages: ModulePackage[]) => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  const importPackage = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 200_000) throw new Error('too large');
      const parsed: unknown = JSON.parse(await file.text());
      const result = installModulePackage(packages, parsed);
      if (result.error || !result.installed) {
        setMessage(result.error ?? 'Module package could not be installed.');
        return;
      }
      onChange(result.packages);
      setMessage(`Installed ${result.installed.module.name} v${result.installed.module.version}.`);
    } catch {
      setMessage('Could not read this module package. Maximum package size is 200 KB.');
    }
  };

  const exportPackage = (bundle: ModulePackage) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${bundle.module.id}-${bundle.module.version}.rbmodule.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <div className="options-backdrop" role="presentation" onMouseDown={event => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <section className="options-dialog panel module-options" role="dialog" aria-modal="true" aria-labelledby="modules-title">
      <div className="options-heading">
        <div><span className="eyebrow">MODULE LIBRARY</span><h2 id="modules-title">Installed modules</h2></div>
        <button onClick={onClose} aria-label="Close module library">×</button>
      </div>

      <p className="muted">Module packages are declarative JSON only. Unsupported schemas or malformed packages are rejected before installation.</p>

      <div className="module-package-list">
        {packages.map(bundle => {
          const builtIn = isBuiltInModulePackage(bundle);
          return <div className="module-package-row" key={modulePackageKey(bundle.module)}>
            <div>
              <strong>{bundle.module.name}</strong>
              <span>{bundle.module.id} · v{bundle.module.version} · {bundle.cards.length} cards</span>
            </div>
            <span className="chip">{builtIn ? 'Built-in' : 'Installed'}</span>
            <button onClick={() => exportPackage(bundle)}>Export</button>
            {!builtIn && <button onClick={() => {
              onChange(packages.filter(item => modulePackageKey(item.module) !== modulePackageKey(bundle.module)));
              setMessage(`Removed ${bundle.module.name}.`);
            }}>Remove</button>}
          </div>;
        })}
      </div>

      <div className="options-actions">
        <button onClick={() => fileRef.current?.click()}>Import module package</button>
        <button className="primary" onClick={onClose}>Done</button>
      </div>
      <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={event => {
        void importPackage(event.target.files?.[0]);
        event.target.value = '';
      }} />
      {message && <p className="binding-message" role="status">{message}</p>}
    </section>
  </div>;
}
