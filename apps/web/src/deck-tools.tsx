import { useMemo, useRef, useState } from 'react';
import {
  isDeckDefinition,
  searchCardCatalog,
  starterDeckForModule,
  type CardDefinition,
  type DeckDefinition,
  type GameModule,
} from '@rb-unbound/tabletop';

const MAX_DECK_CARDS = 500;

function savedDeckKey(module: GameModule, player: 1 | 2): string {
  return `rb-unbound-deck:${module.id}@${module.version}:p${player}`;
}

function isSavedDraft(value: unknown, module: GameModule, catalog: readonly CardDefinition[]): value is DeckDefinition {
  if (!value || typeof value !== 'object') return false;
  const deck = value as Partial<DeckDefinition>;
  const allowed = new Set(catalog.filter(card => card.moduleId === module.id && card.moduleVersion === module.version).map(card => card.id));
  return deck.schemaVersion === 1 && deck.moduleId === module.id &&
    deck.moduleVersion === module.version && typeof deck.name === 'string' &&
    deck.name.length <= 100 && Array.isArray(deck.cards) && deck.cards.length <= MAX_DECK_CARDS &&
    deck.cards.every(id => typeof id === 'string' && allowed.has(id));
}

function initialDeck(module: GameModule, catalog: readonly CardDefinition[], player: 1 | 2): DeckDefinition {
  const starter = starterDeckForModule(module, catalog);
  try {
    const saved = window.localStorage.getItem(savedDeckKey(module, player));
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isSavedDraft(parsed, module, catalog)) return parsed;
    }
  } catch {
    // Storage can be disabled; the editor remains usable for this session.
  }
  return starter;
}

export function DeckTools({
  module,
  onLoadDeck,
  catalog,
}: {
  module: GameModule;
  catalog: readonly CardDefinition[];
  onLoadDeck: (deck: DeckDefinition, player: 1 | 2) => void;
}) {
  const [query, setQuery] = useState('');
  const [player, setPlayer] = useState<1 | 2>(1);
  const [deck, setDeck] = useState<DeckDefinition>(() => initialDeck(module, catalog, 1));
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchCardCatalog(catalog, module, query), [catalog, module, query]);
  const cardById = useMemo(() => new Map(catalog.map(card => [card.id, card])), [catalog]);
  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const id of deck.cards) next.set(id, (next.get(id) ?? 0) + 1);
    return next;
  }, [deck.cards]);
  const valid = isDeckDefinition(deck, module, catalog);

  const updateDeck = (next: DeckDefinition) => {
    setDeck(next);
    try {
      window.localStorage.setItem(savedDeckKey(module, player), JSON.stringify(next));
      setMessage('Saved in this browser.');
    } catch {
      setMessage('Changes are available for this session. Export a copy to keep them.');
    }
  };

  const addCard = (id: string) => {
    if (deck.cards.length >= MAX_DECK_CARDS) {
      setMessage(`Decks can contain at most ${MAX_DECK_CARDS} cards.`);
      return;
    }
    updateDeck({ ...deck, cards: [...deck.cards, id] });
  };

  const removeCard = (id: string) => {
    const index = deck.cards.lastIndexOf(id);
    if (index < 0) return;
    updateDeck({ ...deck, cards: deck.cards.filter((_, position) => position !== index) });
  };

  const download = () => {
    if (!valid) return;
    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${module.id}-deck.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importDeck = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 250_000) throw new Error('too large');
      const parsed: unknown = JSON.parse(await file.text());
      if (!isDeckDefinition(parsed, module, catalog)) throw new Error('invalid');
      updateDeck(parsed);
      setMessage(`Imported ${parsed.name} · ${parsed.cards.length} cards. Saved in this browser.`);
    } catch {
      setMessage('That deck is invalid, belongs to another module/version, or references unknown cards.');
    }
  };

  return <section className="panel deck-tools">
    <div className="deck-tools-heading">
      <div>
        <span className="eyebrow">DECK EDITOR</span>
        <h2>{module.name}</h2>
      </div>
      <span className="chip">{deck.cards.length} cards</span>
    </div>

    <div className="deck-editor-settings">
      <label>Edit for player
        <select value={player} onChange={event => {
          const nextPlayer = Number(event.target.value) as 1 | 2;
          setPlayer(nextPlayer);
          setDeck(initialDeck(module, catalog, nextPlayer));
          setMessage('');
        }}>
          <option value={1}>Player 1</option>
          <option value={2}>Player 2</option>
        </select>
      </label>
      <label>Deck name
        <input maxLength={100} value={deck.name} onChange={event => updateDeck({ ...deck, name: event.target.value })} placeholder="Name your deck" />
      </label>
    </div>

    <div className="deck-editor-grid">
      <div>
        <label>Search card pool
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, tag, type…" />
        </label>
        <div className="catalog-results" aria-label="Available cards">
          {results.map(card => <div className="catalog-row" key={card.id}>
            <div><strong>{card.name}</strong><small>{card.id}</small></div>
            <span>{Object.values(card.metadata).flatMap(value => Array.isArray(value) ? value : [String(value)]).join(' · ')}</span>
            <button type="button" disabled={deck.cards.length >= MAX_DECK_CARDS} onClick={() => addCard(card.id)} aria-label={`Add ${card.name}`}>Add</button>
          </div>)}
          {!results.length && <p className="muted">No cards match that search.</p>}
        </div>
      </div>

      <div>
        <h3>Current deck</h3>
        <div className="catalog-results" aria-label="Current deck">
          {[...counts].map(([id, count]) => <div className="deck-editor-row" key={id}>
            <span>{cardById.get(id)?.name ?? id}</span>
            <div className="deck-editor-quantity">
              <button type="button" onClick={() => removeCard(id)} aria-label={`Remove ${cardById.get(id)?.name ?? id}`}>−</button>
              <strong aria-label={`${count} copies`}>{count}</strong>
              <button type="button" disabled={deck.cards.length >= MAX_DECK_CARDS} onClick={() => addCard(id)} aria-label={`Add another ${cardById.get(id)?.name ?? id}`}>+</button>
            </div>
          </div>)}
          {!counts.size && <p className="muted">Add a card from the pool to start building.</p>}
        </div>
      </div>
    </div>

    <div className="button-row">
      <button onClick={() => {
        updateDeck(starterDeckForModule(module, catalog));
        setMessage('Reset to the built-in starter deck.');
      }}>Reset to starter</button>
      <button onClick={() => fileRef.current?.click()}>Import deck</button>
      <button disabled={!valid} onClick={download}>Export deck</button>
      <button className="primary" disabled={!valid} onClick={() => {
        onLoadDeck(deck, player);
        setMessage(`Loaded ${deck.name} to Player ${player}.`);
      }}>Load to Player {player}</button>
    </div>

    <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={event => {
      void importDeck(event.target.files?.[0]);
      event.target.value = '';
    }} />
    {!valid && <p className="muted">Add at least one card and a deck name before loading or exporting.</p>}
    {message && <p className="binding-message" role="status">{message}</p>}
  </section>;
}
