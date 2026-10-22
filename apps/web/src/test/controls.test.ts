import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  actionForCode,
  displayKey,
  loadBindings,
  saveBindings,
} from '../controls';

describe('keyboard controls', () => {
  beforeEach(() => window.localStorage.clear());

  it('uses WASD defaults and expected action keys', () => {
    expect(DEFAULT_BINDINGS.moveUp).toBe('KeyW');
    expect(DEFAULT_BINDINGS.moveLeft).toBe('KeyA');
    expect(DEFAULT_BINDINGS.moveDown).toBe('KeyS');
    expect(DEFAULT_BINDINGS.moveRight).toBe('KeyD');
    expect(DEFAULT_BINDINGS.rotate).toBe('KeyR');
    expect(DEFAULT_BINDINGS.flip).toBe('KeyF');
  });

  it('maps physical key codes to actions', () => {
    expect(actionForCode(DEFAULT_BINDINGS, 'KeyW')).toBe('moveUp');
    expect(actionForCode(DEFAULT_BINDINGS, 'KeyR')).toBe('rotate');
    expect(actionForCode(DEFAULT_BINDINGS, 'Escape')).toBe('clear');
    expect(actionForCode(DEFAULT_BINDINGS, 'KeyZ')).toBeUndefined();
  });

  it('persists custom bindings', () => {
    const custom = { ...DEFAULT_BINDINGS, rotate: 'KeyQ' };
    saveBindings(custom);
    expect(loadBindings()).toEqual(custom);
  });

  it('falls back to defaults if stored bindings contain duplicates', () => {
    window.localStorage.setItem('rb-unbound-keybindings-v1', JSON.stringify({
      ...DEFAULT_BINDINGS,
      rotate: 'KeyW',
    }));

    expect(loadBindings()).toEqual(DEFAULT_BINDINGS);
  });

  it('formats common key codes for the UI', () => {
    expect(displayKey('KeyW')).toBe('W');
    expect(displayKey('Delete')).toBe('Del');
    expect(displayKey('Escape')).toBe('Esc');
    expect(displayKey('ArrowUp')).toBe('↑');
  });
});
