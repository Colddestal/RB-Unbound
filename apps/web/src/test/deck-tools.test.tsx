import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { builtInCardCatalog, frontierSkirmishModule } from '@rb-unbound/tabletop';
import { DeckTools } from '../deck-tools';
import { App } from '../app';

const catalog = builtInCardCatalog.filter(card => card.moduleId === frontierSkirmishModule.id);
function openEditor(onLoadDeck = vi.fn()) {
  return render(<DeckTools module={frontierSkirmishModule} catalog={catalog} onLoadDeck={onLoadDeck} />);
}
function section(name: string) {
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Deck sections' })).getByRole('button', { name: new RegExp(`^${name} `) }));
}

describe('DeckTools', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps separate player drafts, filters colors, and loads complete sections', () => {
    const onLoadDeck = vi.fn();
    const view = openEditor(onLoadDeck);
    expect(screen.getByText('Ready to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load to Player 1' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Deck name'), { target: { value: 'Mira test deck' } });
    section('Side deck');
    expect(screen.getByRole('button', { name: 'Add Tide Scout' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Add Cinder Runner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add River Canopy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load to Player 1' }));
    expect(onLoadDeck).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Mira test deck', cards: expect.any(Array), sections: expect.objectContaining({ sideDeck: ['river-canopy'] }),
    }), 1);
    fireEvent.change(screen.getByLabelText('Edit for player'), { target: { value: '2' } });
    expect(screen.getByLabelText('Deck name')).toHaveValue('Full Mat Prototype Starter');
    section('Runes');
    const deckList = screen.getByLabelText('Current deck');
    fireEvent.click(within(deckList).getByRole('button', { name: 'Remove Blue Rune' }));
    expect(screen.getByText(/Runes needs 1 more card/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load to Player 2' })).toBeDisabled();
    view.unmount();
    openEditor();
    expect(screen.getByLabelText('Deck name')).toHaveValue('Mira test deck');
    fireEvent.change(screen.getByLabelText('Edit for player'), { target: { value: '2' } });
    expect(screen.getByText(/Runes needs 1 more card/)).toBeInTheDocument();
  });

  it('warns for missing sections, excess cards, and mismatched identities', () => {
    openEditor();
    section('Legend');
    fireEvent.click(screen.getByRole('button', { name: 'Add Orin, Emberguide' }));
    expect(screen.getByText(/Champion must have the same character name/)).toBeInTheDocument();
    expect(screen.getByText(/Deck has cards outside the Legend/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load to Player 1' })).toBeDisabled();
    section('Runes');
    fireEvent.click(screen.getByRole('button', { name: 'Add Red Rune' }));
    expect(screen.getByText(/Runes has 1 too many cards/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to starter' }));
    expect(screen.getByRole('button', { name: 'Load to Player 1' })).toBeEnabled();
  });

  it('uses a separate app view and loads the chosen rune, legend, champion, and side piles', () => {
    render(<App />);
    expect(screen.queryByLabelText('Deck editor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deck editor' }));
    expect(screen.queryByLabelText('RB Unbound tabletop board')).not.toBeInTheDocument();
    section('Side deck');
    fireEvent.click(screen.getByRole('button', { name: 'Add River Canopy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load to Player 1' }));
    expect(screen.getByLabelText('RB Unbound tabletop board')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /RUNE DECK 12 cards/i })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /SIDE DECK 1 card/i })).toBeInTheDocument();
    expect(screen.getAllByText('Mira, Tidekeeper').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mira, Riverward').length).toBeGreaterThan(0);
  });
});
