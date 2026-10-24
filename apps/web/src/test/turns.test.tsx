import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { endTurn, initialTurn } from '@rb-unbound/lobby';
import { builtInModulePackages } from '@rb-unbound/tabletop';
import { Table } from '../table';
import { DEFAULT_BINDINGS } from '../controls';

describe('manual turns', () => {
  it('alternates 1v1 and cycles four seats without skipping a player', () => {
    expect(initialTurn('1v1')).toEqual({ seat: 1, number: 1 });
    expect(endTurn(initialTurn('1v1'), '1v1')).toEqual({ seat: 2, number: 2 });
    expect(endTurn({ seat: 2, number: 2 }, '1v1')).toEqual({ seat: 1, number: 3 });
    let turn = initialTurn('2v2', 2);
    expect(turn.seat).toBe(2);
    for (const seat of [3, 4, 1, 2] as const) {
      turn = endTurn(turn, '2v2');
      expect(turn.seat).toBe(seat);
    }
  });

  it('requires confirmation before switching the local board perspective', () => {
    render(<Table bindings={DEFAULT_BINDINGS} modulePackages={builtInModulePackages} />);
    const board = screen.getByLabelText('RB Unbound tabletop board');
    const turnControls = within(board).getByRole('group', { name: 'Turn controls' });
    const shortcuts = screen.getByRole('region', { name: 'Keyboard shortcuts' });
    expect(within(turnControls).getByRole('button', { name: 'End Turn' })).toBeInTheDocument();
    expect(board.compareDocumentPosition(shortcuts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export table' })).not.toBeInTheDocument();
    expect(screen.getByText(/Player 1's turn/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End Turn' }));
    expect(screen.getByText(/Player 1's turn/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/Player 1's turn/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End Turn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm end turn' }));
    expect(screen.getByText(/Player 2's turn/)).toBeInTheDocument();
    expect(screen.getByText(/Turn 2/)).toBeInTheDocument();
  });
});
