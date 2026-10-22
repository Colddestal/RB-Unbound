import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardContextMenu } from '../card-context-menu';

const card = {
  id: 'card-1',
  label: 'Test Card',
  owner: 1 as const,
  zone: 'field',
  faceUp: true,
  rotation: 0,
};

const zones = [
  { id: 'hand', label: 'Hand' },
  { id: 'field', label: 'Combat Area' },
  { id: 'base', label: 'Base' },
  { id: 'discard', label: 'Trash' },
  { id: 'deck', label: 'Main Deck' },
];

describe('CardContextMenu', () => {
  it('offers common actions and module destinations for a controlled card', () => {
    const onMove = vi.fn();
    const onRotate = vi.fn();
    render(<CardContextMenu
      state={{ cardId: card.id, x: 100, y: 100 }}
      card={card}
      canAct
      zones={zones}
      handZoneId="hand"
      discardZoneId="discard"
      deckZoneId="deck"
      onInspect={() => undefined}
      onRotate={onRotate}
      onFlip={() => undefined}
      onMove={onMove}
      onUnstack={() => undefined}
      onClose={() => undefined}
    />);

    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to Hand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to Trash / Discard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Base' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Base' }));
    expect(onMove).toHaveBeenCalledWith('base');
  });

  it('keeps opponent cards inspect-only', () => {
    render(<CardContextMenu
      state={{ cardId: card.id, x: 100, y: 100 }}
      card={card}
      canAct={false}
      zones={zones}
      handZoneId="hand"
      discardZoneId="discard"
      deckZoneId="deck"
      onInspect={() => undefined}
      onRotate={() => undefined}
      onFlip={() => undefined}
      onMove={() => undefined}
      onUnstack={() => undefined}
      onClose={() => undefined}
    />);

    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tap' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return to Hand' })).not.toBeInTheDocument();
  });
});
