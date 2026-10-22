import { useMemo, useRef, useState } from 'react';
import {
  isDeckDefinition,
  searchCardCatalog,
  starterDeckForModule,
  type CardDefinition,
  type DeckDefinition,
  type GameModule,
} from '@rb-unbound/tabletop';

export function DeckTools({
  module,
  onLoadDeck,
  catalog,
}: {
  module: GameModule;
  catalog: readonly CardDefinition[];
  onLoadDeck: (deck: DeckDefinition) => void;
}) {
  const [query, setQuery] = useState('');
  const [deck, setDeck] = useState<DeckDefinition>(() => starterDeckForModule(module, catalog));
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const moduleDeck = deck.moduleId === module.id && deck.moduleVersion === module.version
    ? deck
    : starterDeckForModule(module, catalog);
  const results = useMemo(() => searchCardCatalog(catalog, module, query), [catalog, module, query]);

  const download = () => {
    const blob = new Blob([JSON.stringify(moduleDeck, null, 2)], { type: 'application/json' });
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
      setDeck(parsed);
      setMessage(`Imported ${parsed.name} · ${parsed.cards.length} cards`);
    } catch {
      setMessage('That deck is invalid, belongs to another module/version, or references unknown cards.');
    }
  };

  return <section className="panel deck-tools">
    <div className="deck-tools-heading">
      <div>
        <span className="eyebrow">DECK TOOLS</span>
        <h2>{module.name}</h2>
      </div>
      <span className="chip">{moduleDeck.cards.length} cards</span>
    </div>

    <label>Search card pool
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, tag, type…" />
    </label>

    <div className="catalog-results">
      {results.map(card => <div className="catalog-row" key={card.id}>
        <strong>{card.name}</strong>
        <span>{Object.values(card.metadata).flatMap(value => Array.isArray(value) ? value : [String(value)]).join(' · ')}</span>
        <small>{card.id}</small>
      </div>)}
      {!results.length && <p className="muted">No cards match that search.</p>}
    </div>

    <div className="button-row">
      <button onClick={() => {
        const starter = starterDeckForModule(module, catalog);
        setDeck(starter);
        setMessage('Reset to the built-in starter deck.');
      }}>Starter deck</button>
      <button onClick={() => fileRef.current?.click()}>Import deck</button>
      <button onClick={download}>Export deck</button>
      <button className="primary" disabled={!moduleDeck.cards.length} onClick={() => {
        onLoadDeck(moduleDeck);
        setMessage(`Loaded ${moduleDeck.name} to Player 1.`);
      }}>Load to Player 1</button>
    </div>

    <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={event => {
      void importDeck(event.target.files?.[0]);
      event.target.value = '';
    }} />
    {message && <p className="binding-message" role="status">{message}</p>}
  </section>;
}
