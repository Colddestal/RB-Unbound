export type ControlAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'rotate'
  | 'flip'
  | 'playField'
  | 'moveHand'
  | 'discard'
  | 'clear';

export type KeyBindings = Record<ControlAction, string>;

export const DEFAULT_BINDINGS: KeyBindings = {
  moveUp: 'KeyW',
  moveDown: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  rotate: 'KeyR',
  flip: 'KeyF',
  playField: 'KeyP',
  moveHand: 'KeyH',
  discard: 'Delete',
  clear: 'Escape',
};

export const HISTORY_KEYS = { undo: 'KeyQ', redo: 'KeyE' } as const;

export function historyDirectionForKey(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): 'undo' | 'redo' | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  if (event.code === HISTORY_KEYS.undo) return 'undo';
  if (event.code === HISTORY_KEYS.redo) return 'redo';
  return undefined;
}

export const CONTROL_LABELS: Record<ControlAction, string> = {
  moveUp: 'Move up',
  moveDown: 'Move down',
  moveLeft: 'Move left',
  moveRight: 'Move right',
  rotate: 'Rotate card',
  flip: 'Flip card',
  playField: 'Move to field',
  moveHand: 'Move to hand',
  discard: 'Discard card',
  clear: 'Clear selection',
};

const STORAGE_KEY = 'rb-unbound-keybindings-v1';

export function loadBindings(): KeyBindings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BINDINGS };
    const parsed = JSON.parse(raw) as Partial<KeyBindings>;
    const merged = { ...DEFAULT_BINDINGS, ...parsed };
    // Older saved controls could assign Q or E to a different action.
    for (const action of Object.keys(merged) as ControlAction[]) {
      if (merged[action] === HISTORY_KEYS.undo || merged[action] === HISTORY_KEYS.redo)
        merged[action] = DEFAULT_BINDINGS[action];
    }
    const values = Object.values(merged);
    if (new Set(values).size !== values.length) return { ...DEFAULT_BINDINGS };
    return merged;
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings: KeyBindings): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export function displayKey(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    Escape: 'Esc',
    Delete: 'Del',
    Space: 'Space',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Tab: 'Tab',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
  };
  return names[code] ?? code;
}

export function actionForCode(bindings: KeyBindings, code: string): ControlAction | undefined {
  return (Object.keys(bindings) as ControlAction[]).find(action => bindings[action] === code);
}
