import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ControlsOptions } from '../controls-options';
import { DEFAULT_BINDINGS, type KeyBindings } from '../controls';

function renderOptions(bindings: KeyBindings = DEFAULT_BINDINGS) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<ControlsOptions bindings={bindings} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

describe('ControlsOptions', () => {
  it('shows the current bindings', () => {
    renderOptions();
    expect(screen.getByRole('button', { name: 'W' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'R' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Del' })).toBeInTheDocument();
  });

  it('captures a new key for an action', () => {
    const { onChange } = renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'R' }));
    fireEvent.keyDown(window, { code: 'KeyT', key: 't' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rotate: 'KeyT' }));
  });

  it('keeps Q and E available for Undo and Redo', () => {
    const { onChange } = renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'R' }));
    fireEvent.keyDown(window, { code: 'KeyQ', key: 'q' });
    expect(screen.getByText('Q is reserved for Undo.')).toBeInTheDocument();
    fireEvent.keyDown(window, { code: 'KeyE', key: 'e' });
    expect(screen.getByText('E is reserved for Redo.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects duplicate key assignments', () => {
    const { onChange } = renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'R' }));
    fireEvent.keyDown(window, { code: 'KeyW', key: 'w' });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/already assigned/i)).toBeInTheDocument();
  });

  it('resets all controls to defaults', () => {
    const custom = { ...DEFAULT_BINDINGS, rotate: 'KeyT' };
    const { onChange } = renderOptions(custom);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));

    expect(onChange).toHaveBeenCalledWith(DEFAULT_BINDINGS);
  });

  it('closes from the Done button', () => {
    const { onClose } = renderOptions();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
