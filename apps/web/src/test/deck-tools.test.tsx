import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('keeps named decks, filters colors, and includes three Battlefield choices', async () => {
    const onLoadDeck = vi.fn();
    const view = openEditor(onLoadDeck);
    expect(screen.getByText('Ready to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test as Seat 1' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Deck name'), { target: { value: 'Mira test deck' } });
    section('Side deck');
    expect(screen.getByRole('button', { name: 'Add Tide Scout' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Add Cinder Runner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add River Canopy' }));
    section('Battlefields');
    expect(screen.getByRole('button', { name: 'Add Glass Current' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add Ember Pass' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test as Seat 1' }));
    await waitFor(() => expect(onLoadDeck).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Mira test deck', cards: expect.any(Array), sections: expect.objectContaining({ battlefields: expect.any(Array) }),
    }), 1));
    fireEvent.click(screen.getByRole('button', { name: 'Create New Deck +' }));
    await waitFor(() => expect(screen.getByLabelText('Deck name')).toHaveValue('Deck 2'));
    section('Runes');
    const deckList = screen.getByLabelText('Current deck');
    fireEvent.click(within(deckList).getByRole('button', { name: 'Remove Blue Rune' }));
    expect(screen.getByText(/Runes needs 1 more card/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test as Seat 2' })).toBeDisabled();
    view.unmount();
    openEditor();
    expect(screen.getByLabelText('Deck name')).toHaveValue('Mira test deck');
    fireEvent.change(screen.getByLabelText('Decks'), { target: { value: (screen.getByRole('combobox', { name: 'Decks' }) as HTMLSelectElement).options[1].value } });
    await waitFor(() => expect(screen.getByText(/Runes needs 1 more card/)).toBeInTheDocument());
  });

  it('warns for missing sections, excess cards, and mismatched identities', () => {
    openEditor();
    section('Legend');
    fireEvent.click(screen.getByRole('button', { name: 'Add Orin, Emberguide' }));
    expect(screen.getByText(/Champion must have the same character name/)).toBeInTheDocument();
    expect(screen.getByText(/Deck has cards outside the Legend/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test as Seat 1' })).toBeDisabled();
    section('Runes');
    fireEvent.click(screen.getByRole('button', { name: 'Add Red Rune' }));
    expect(screen.getByText(/Runes has 1 too many cards/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to starter' }));
    expect(screen.getByRole('button', { name: 'Test as Seat 1' })).toBeEnabled();
  });

  it('shows colored list thumbnails and a readable card beside the pointer on hover or focus', () => {
    openEditor();
    const row = screen.getByLabelText('Preview Tide Scout');
    expect(within(row).getByLabelText('blue')).toBeInTheDocument();
    fireEvent.mouseEnter(row, { clientX: 1000, clientY: 400 });
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Tide Scout');
    expect(tooltip).toHaveTextContent('When played, ready one of your cards. Resolve this manually.');
    expect(tooltip).toHaveStyle({ left: '732px', top: '226px' });
    fireEvent.mouseLeave(row);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(row);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tide Scout');
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('uses a separate app view and loads the chosen rune, legend, and champion piles', async () => {
    render(<App />);
    expect(screen.queryByLabelText('Deck editor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deck editor' }));
    expect(screen.queryByLabelText('RB Unbound tabletop board')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test as Seat 1' }));
    await waitFor(() => expect(screen.getByLabelText('RB Unbound tabletop board')).toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /RUNE DECK 12 cards/i })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /SIDE DECK/i })).not.toBeInTheDocument();
    expect(screen.getAllByText('Mira, Tidekeeper').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mira, Riverward').length).toBeGreaterThan(0);
  });
});
