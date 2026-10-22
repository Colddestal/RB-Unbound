import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeckPile } from '../deck-pile';

describe('DeckPile', () => {
  it('draws one card when the owned deck is clicked', () => {
    const onDraw = vi.fn();
    render(<DeckPile label="Deck" count={12} pattern="grid" interactive onDraw={onDraw} onShuffle={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /deck/i }));
    expect(onDraw).toHaveBeenCalledWith(1);
  });

  it('opens a right-click menu with draw X and shuffle', () => {
    const onDraw = vi.fn();
    const onShuffle = vi.fn();
    render(<DeckPile label="Deck" count={12} pattern="grid" interactive onDraw={onDraw} onShuffle={onShuffle} />);

    fireEvent.contextMenu(screen.getByRole('button', { name: /deck/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    const amount = screen.getByLabelText('Number of cards to draw');
    fireEvent.change(amount, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draw X' }));
    expect(onDraw).toHaveBeenCalledWith(4);
  });

  it('shuffles from the context menu', () => {
    const onShuffle = vi.fn();
    render(<DeckPile label="Deck" count={12} pattern="grid" interactive onDraw={() => undefined} onShuffle={onShuffle} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /deck/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }));
    expect(onShuffle).toHaveBeenCalledTimes(1);
  });

  it('keeps an opponent deck non-interactive while showing its count', () => {
    const onDraw = vi.fn();
    render(<DeckPile label="Deck" count={9} pattern="grid" interactive={false} onDraw={onDraw} onShuffle={() => undefined} />);
    const deck = screen.getByRole('button', { name: /deck/i });
    expect(deck).toBeDisabled();
    expect(screen.getByText('9 cards')).toBeInTheDocument();
    fireEvent.contextMenu(deck);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onDraw).not.toHaveBeenCalled();
  });
});
