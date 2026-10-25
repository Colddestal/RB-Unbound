import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { builtInModulePackages, starterDeckForModule } from '@rb-unbound/tabletop';
import { Discovery } from '../discovery';

const bundle = builtInModulePackages.find(item => item.module.id === 'frontier-skirmish')!;
const deck = { ...starterDeckForModule(bundle.module, bundle.cards), name: 'Tide example' };
const deckId = '17e85ab4-44d9-47fa-a56b-fd5528c541bd';

afterEach(() => vi.restoreAllMocks());

describe('Discovery', () => {
  it('shows public deck summaries, searches, and previews cards without signing in', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      const data = url.endsWith(`/${deckId}`)
        ? { id: deckId, author: 'builder', deck }
        : { decks: [{ id: deckId, name: deck.name, author: 'builder', moduleId: deck.moduleId, moduleVersion: deck.moduleVersion, cardCount: deck.cards.length }], total: 1, page: 0 };
      return { ok: true, json: async () => data } as Response;
    });
    render(<Discovery modulePackages={builtInModulePackages} onOpenEditor={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search decks or players' }), { target: { value: 'Tide' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=Tide'), expect.anything()));
    fireEvent.click(await screen.findByRole('button', { name: /Tide example by @builder/ }));
    expect(await screen.findByRole('heading', { name: deck.name })).toBeInTheDocument();
    expect(screen.getByLabelText('Deck details')).toHaveTextContent('Battlefields');
    expect(screen.getByRole('button', { name: 'Copy to my decks' })).toBeDisabled();
  });
});
