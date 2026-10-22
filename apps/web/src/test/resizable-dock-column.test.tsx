import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ResizableDockColumn } from '../resizable-dock-column';

describe('ResizableDockColumn', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts at the default width and exposes an accessible resize separator', () => {
    render(<ResizableDockColumn><div>Dock content</div></ResizableDockColumn>);
    const separator = screen.getByRole('separator', { name: 'Resize left information panel' });
    expect(separator).toHaveAttribute('aria-valuenow', '270');
    expect(separator.parentElement).toHaveStyle({ width: '270px' });
  });

  it('resizes with the keyboard and clamps to the supported range', () => {
    render(<ResizableDockColumn><div>Dock content</div></ResizableDockColumn>);
    const separator = screen.getByRole('separator', { name: 'Resize left information panel' });

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '286');

    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '190');

    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '420');
  });

  it('restores a saved dock width', () => {
    window.localStorage.setItem('rb-unbound-left-dock-width', '340');
    render(<ResizableDockColumn><div>Dock content</div></ResizableDockColumn>);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '340');
  });

  it('resets to the default width on double click', () => {
    window.localStorage.setItem('rb-unbound-left-dock-width', '360');
    render(<ResizableDockColumn><div>Dock content</div></ResizableDockColumn>);
    const separator = screen.getByRole('separator');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '270');
  });
});
