import { useEffect, useState } from 'react';
import {
  CONTROL_LABELS,
  DEFAULT_BINDINGS,
  HISTORY_KEYS,
  displayKey,
  type ControlAction,
  type KeyBindings,
} from './controls';

const ACTIONS = Object.keys(CONTROL_LABELS) as ControlAction[];

export function ControlsOptions({
  bindings,
  onChange,
  onClose,
}: {
  bindings: KeyBindings;
  onChange: (bindings: KeyBindings) => void;
  onClose: () => void;
}) {
  const [listening, setListening] = useState<ControlAction | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!listening) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === HISTORY_KEYS.undo || event.code === HISTORY_KEYS.redo) {
        setMessage(`${displayKey(event.code)} is reserved for ${event.code === HISTORY_KEYS.undo ? 'Undo' : 'Redo'}.`);
        return;
      }

      const duplicate = ACTIONS.find(action => action !== listening && bindings[action] === event.code);
      if (duplicate) {
        setMessage(`${displayKey(event.code)} is already assigned to ${CONTROL_LABELS[duplicate]}.`);
        return;
      }

      onChange({ ...bindings, [listening]: event.code });
      setMessage(`${CONTROL_LABELS[listening]} set to ${displayKey(event.code)}.`);
      setListening(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listening, bindings, onChange]);

  return <div className="options-backdrop" role="presentation" onMouseDown={event => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <section className="options-dialog panel" role="dialog" aria-modal="true" aria-labelledby="controls-title">
      <div className="options-heading">
        <div>
          <span className="eyebrow">OPTIONS</span>
          <h2 id="controls-title">Controls</h2>
        </div>
        <button onClick={onClose} aria-label="Close controls options">×</button>
      </div>

      <p className="muted">Click a binding, then press the key you want. Q is Undo, E is Redo, and Shift remains the large-nudge modifier.</p>

      <div className="binding-list">
        {ACTIONS.map(action => <div className="binding-row" key={action}>
          <span>{CONTROL_LABELS[action]}</span>
          <button
            className={listening === action ? 'listening' : ''}
            onClick={() => { setListening(action); setMessage(`Press a key for ${CONTROL_LABELS[action]}…`); }}
          >
            {listening === action ? 'Press a key…' : displayKey(bindings[action])}
          </button>
        </div>)}
      </div>

      {message && <p className="binding-message" role="status">{message}</p>}

      <div className="options-actions">
        <button onClick={() => {
          onChange({ ...DEFAULT_BINDINGS });
          setListening(null);
          setMessage('Controls reset to defaults.');
        }}>Reset to defaults</button>
        <button className="primary" onClick={onClose}>Done</button>
      </div>
    </section>
  </div>;
}
