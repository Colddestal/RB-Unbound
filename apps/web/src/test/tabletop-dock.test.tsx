import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { genericDuelModule } from '@rb-unbound/tabletop';
import { TabletopDock } from '../tabletop-dock';

const card = {
  id: 'card-1',
  definitionId: 'amber-wisp',
  label: 'Amber Wisp',
  owner: 1 as const,
  zone: 'field',
  faceUp: true,
  rotation: 0,
};

describe('TabletopDock', () => {
  it('starts on Card Info', () => {
    render(<TabletopDock
      card={card}
      pinned={false}
      onClear={() => undefined}
      module={genericDuelModule}
      history={[]}
    />);
    expect(screen.getByRole('tab', { name: 'Card Info' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Amber Wisp').length).toBeGreaterThan(0);
  });

  it('shows multiplayer chat and submits messages', () => {
    const send = vi.fn();
    const setValue = vi.fn();
    render(<TabletopDock
      pinned={false}
      onClear={() => undefined}
      history={[]}
      chat={{
        messages: [{ id: 'm1', displayName: 'Player 2', body: 'good luck' }],
        value: 'hello',
        setValue,
        send,
      }}
    />);

    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByText('good luck')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: 'Send' }).closest('form')!);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('explains that chat is unavailable in local sandbox', () => {
    render(<TabletopDock pinned={false} onClear={() => undefined} history={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(screen.getByText(/available while playing in a multiplayer room/i)).toBeInTheDocument();
  });

  it('renders activity history newest first', () => {
    render(<TabletopDock
      pinned={false}
      onClear={() => undefined}
      history={[
        { id: 'h1', text: 'Player 1 drew a card.', createdAt: '2026-10-22T10:00:00Z' },
        { id: 'h2', text: 'Player 2 shuffled their deck.', createdAt: '2026-10-22T10:01:00Z' },
      ]}
    />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    const entries = screen.getAllByText(/Player [12]/);
    expect(entries[0]).toHaveTextContent('Player 2 shuffled their deck.');
    expect(entries[1]).toHaveTextContent('Player 1 drew a card.');
  });
});
