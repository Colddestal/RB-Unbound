import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { builtInCardCatalog, builtInModulePackages, frontierSkirmishModule } from '@rb-unbound/tabletop';
import { DeckTools } from '../deck-tools';
import { Table } from '../table';
import { DEFAULT_BINDINGS } from '../controls';

const catalog = builtInCardCatalog.filter(card => card.moduleId === frontierSkirmishModule.id);

function openEditor(onLoadDeck = vi.fn()) {
  return render(<DeckTools module={frontierSkirmishModule} catalog={catalog} onLoadDeck={onLoadDeck} />);
}

describe('DeckTools', () => {
  beforeEach(() => window.localStorage.clear());

  it('edits, saves, and loads independent drafts for both players', () => {
    const onLoadDeck = vi.fn();
    const view = openEditor(onLoadDeck);
    const initial = screen.getByText('12 cards');
    expect(initial).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Deck name'), { target: { value: 'My test deck' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add Dust Runner$/ }));
    expect(screen.getByText('13 cards')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load to Player 1' }));
    expect(onLoadDeck).toHaveBeenCalledWith(expect.objectContaining({ name: 'My test deck', cards: expect.arrayContaining(['dust-runner']) }), 1);

    fireEvent.change(screen.getByLabelText('Edit for player'), { target: { value: '2' } });
    expect(screen.getByLabelText('Deck name')).toHaveValue('Full Mat Prototype Starter');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Dust Runner' }));
    expect(screen.getByText('11 cards')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load to Player 2' }));
    expect(onLoadDeck).toHaveBeenLastCalledWith(expect.objectContaining({ cards: expect.any(Array) }), 2);

    view.unmount();
    openEditor();
    expect(screen.getByLabelText('Deck name')).toHaveValue('My test deck');
    expect(screen.getByText('13 cards')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Edit for player'), { target: { value: '2' } });
    expect(screen.getByText('11 cards')).toBeInTheDocument();
  });

  it('keeps an empty draft editable but prevents loading it', () => {
    openEditor();
    const currentDeck = screen.getByLabelText('Current deck');
    for (let index = 0; index < 3; index++) {
      for (const name of ['Dust Runner', 'Iron Sentry', 'Ridge Captain', 'Spark Drone']) {
        fireEvent.click(within(currentDeck).getByRole('button', { name: `Remove ${name}` }));
      }
    }
    expect(screen.getByText('0 cards')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load to Player 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export deck' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Add Dust Runner$/ }));
    expect(screen.getByRole('button', { name: 'Load to Player 1' })).toBeEnabled();
  });

  it('replaces only the selected main deck and preserves both rune piles', () => {
    render(<Table bindings={DEFAULT_BINDINGS} modulePackages={builtInModulePackages} />);
    expect(screen.getAllByRole('button', { name: /RUNE DECK 12 cards/i })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Load to Player 1' }));
    fireEvent.change(screen.getByLabelText('Edit for player'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load to Player 2' }));
    expect(screen.getAllByRole('button', { name: /RUNE DECK 12 cards/i })).toHaveLength(2);
  });
});
