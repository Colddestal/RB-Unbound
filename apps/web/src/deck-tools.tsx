import { useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  DECK_SECTIONS, cardSection, deckWarnings, isDeckDefinition, searchCardCatalog,
  sectionCards, sectionLabel, starterDeckForModule,
  type CardDefinition, type DeckDefinition, type DeckSection, type GameModule,
} from '@rb-unbound/tabletop';

const MAX_CARDS = 500;
const PREVIEW_WIDTH = 250;
const PREVIEW_HEIGHT = 348;
const CARD_COLORS: Record<string, string> = {
  blue: '#4696ed', red: '#e45757', green: '#4ab971',
  orange: '#ed9846', yellow: '#f0d957', purple: '#a972d8',
};

function SampleCardFace({ card, size }: { card: CardDefinition; size: 'catalog' | 'list' | 'preview' }) {
  const colors = Array.isArray(card.metadata.affinities) ? card.metadata.affinities : [];
  const style = {
    '--card-accent-a': CARD_COLORS[colors[0]] ?? '#597b91',
    '--card-accent-b': CARD_COLORS[colors[1]] ?? CARD_COLORS[colors[0]] ?? '#597b91',
  } as CSSProperties;
  const section = cardSection(card);
  return <div className={`sample-card sample-card-${size} ${section === 'runes' ? 'sample-rune' : ''}`} style={style}>
    <span className="sample-card-mark" aria-hidden="true">{section === 'runes' ? '◇' : section === 'legend' ? '✦' : '◆'}</span>
    <strong>{card.name}</strong>
    {size !== 'list' && <small>{sectionLabel(section)}</small>}
    <span className="affinity-dots">{colors.map(color =>
      <i key={color} className={`affinity affinity-${color}`} title={color} aria-label={color} />)}</span>
    {size === 'preview' && <div className="sample-card-rules">
      {typeof card.metadata.class === 'string' && <span>{card.metadata.class}{typeof card.metadata.power === 'number' ? ` · Power ${card.metadata.power}` : ''}</span>}
      <p>{typeof card.metadata.rules === 'string' ? card.metadata.rules : 'Original sample card. Resolve any effects manually.'}</p>
    </div>}
  </div>;
}

type CardPreview = { card: CardDefinition; x: number; y: number };

function previewPosition(clientX: number, clientY: number): { x: number; y: number } {
  const margin = 12;
  const x = clientX + PREVIEW_WIDTH + 20 <= window.innerWidth
    ? clientX + 18 : clientX - PREVIEW_WIDTH - 18;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - PREVIEW_WIDTH - margin)),
    y: Math.max(margin, Math.min(clientY - PREVIEW_HEIGHT / 2, window.innerHeight - PREVIEW_HEIGHT - margin)),
  };
}

function savedDeckKey(module: GameModule, player: 1 | 2): string {
  return `rb-unbound-deck:${module.id}@${module.version}:p${player}`;
}

function isSavedDraft(value: unknown, module: GameModule, catalog: readonly CardDefinition[]): value is DeckDefinition {
  if (!value || typeof value !== 'object') return false;
  const deck = value as Partial<DeckDefinition>;
  return typeof deck.name === 'string' && deck.name.length <= 100 &&
    isDeckDefinition({ ...deck, name: deck.name || 'Untitled' }, module, catalog);
}

function initialDeck(module: GameModule, catalog: readonly CardDefinition[], player: 1 | 2): DeckDefinition {
  try {
    const saved = window.localStorage.getItem(savedDeckKey(module, player));
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isSavedDraft(parsed, module, catalog)) return parsed;
    }
  } catch {
    // Storage can be disabled; the editor still works for this session.
  }
  return starterDeckForModule(module, catalog);
}

function sectionLimit(section: DeckSection): string {
  return ({ legend: '1', runes: '12', champion: '1', deck: '39', sideDeck: '0–8' })[section];
}

export function DeckTools({ module, onLoadDeck, catalog }: {
  module: GameModule;
  catalog: readonly CardDefinition[];
  onLoadDeck: (deck: DeckDefinition, player: 1 | 2) => void;
}) {
  const structured = module.id === 'frontier-skirmish';
  const sections = structured ? DECK_SECTIONS : (['deck'] as const);
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<DeckSection>('deck');
  const [player, setPlayer] = useState<1 | 2>(1);
  const [deck, setDeck] = useState<DeckDefinition>(() => initialDeck(module, catalog, 1));
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cardById = useMemo(() => new Map(catalog.map(card => [card.id, card])), [catalog]);
  const legend = cardById.get(sectionCards(deck, 'legend')[0]);
  const allowedColors = new Set(Array.isArray(legend?.metadata.affinities) ? legend.metadata.affinities : []);
  const results = useMemo(() => searchCardCatalog(catalog, module, query)
    .filter(card => !structured || cardSection(card) === (activeSection === 'sideDeck' ? 'deck' : activeSection))
    .filter(card => activeSection === 'legend' || allowedColors.size !== 2 || !structured ||
      (Array.isArray(card.metadata.affinities) && card.metadata.affinities.every(color => allowedColors.has(color))))
    .filter(card => activeSection !== 'champion' || !legend || card.metadata.identity === legend.metadata.identity),
  [catalog, module, query, structured, activeSection, legend]);
  const warnings = structured ? deckWarnings(deck, catalog) : [];
  if (!deck.name.trim()) warnings.unshift('Give this deck a name.');
  if (!structured && !deck.cards.length) warnings.push('Deck needs at least one card.');
  const usable = warnings.length === 0 && isDeckDefinition(deck, module, catalog);
  const current = sectionCards(deck, activeSection);

  const updateDeck = (next: DeckDefinition) => {
    setPreview(null);
    setDeck(next);
    try {
      window.localStorage.setItem(savedDeckKey(module, player), JSON.stringify(next));
      setMessage('Saved in this browser.');
    } catch {
      setMessage('Changes are available for this session. Export a copy to keep them.');
    }
  };
  const setSection = (section: DeckSection, ids: string[]) => {
    if (section === 'deck') updateDeck({ ...deck, cards: ids });
    else updateDeck({ ...deck, sections: {
      legend: sectionCards(deck, 'legend'), runes: sectionCards(deck, 'runes'),
      champion: sectionCards(deck, 'champion'), sideDeck: sectionCards(deck, 'sideDeck'),
      [section]: ids,
    } });
  };
  const addCard = (id: string) => {
    if (current.length >= MAX_CARDS) { setMessage('This section is full.'); return; }
    setSection(activeSection, activeSection === 'legend' || activeSection === 'champion' ? [id] : [...current, id]);
  };
  const download = () => {
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
      setMessage(`Imported ${parsed.name}. Review the warnings before loading.`);
    } catch {
      setMessage('That deck is invalid, belongs to another module/version, or references unknown cards.');
    }
  };

  return <section className="panel deck-tools" aria-label="Deck editor">
    <div className="deck-tools-heading">
      <div><span className="eyebrow">DECK EDITOR · {module.name}</span><h2>Build your deck</h2>
        <p className="muted">Original sample cards. {structured ? 'Prototype limits, not official Riftbound deck validation.' : 'Build a freeform deck for this module.'}</p>
      </div>
      <span className={`deck-status ${usable ? 'ready' : 'incomplete'}`}>{usable ? 'Ready to load' : 'Needs changes'}</span>
    </div>
    <div className="deck-editor-settings">
      <label>Edit for player
        <select value={player} onChange={event => {
          const next = Number(event.target.value) as 1 | 2;
          setPlayer(next); setDeck(initialDeck(module, catalog, next)); setMessage(''); setPreview(null);
        }}><option value={1}>Player 1</option><option value={2}>Player 2</option></select>
      </label>
      <label>Deck name
        <input maxLength={100} value={deck.name} onChange={event => updateDeck({ ...deck, name: event.target.value })} placeholder="Name your deck" />
      </label>
    </div>

    <nav className="deck-section-tabs" aria-label="Deck sections">
      {sections.map(section => <button key={section} type="button" className={activeSection === section ? 'active' : ''}
        aria-current={activeSection === section ? 'page' : undefined} onClick={() => { setActiveSection(section); setQuery(''); setPreview(null); }}>
        <strong>{sectionLabel(section)}</strong><span>{sectionCards(deck, section).length}{structured ? ` / ${sectionLimit(section)}` : ''}</span>
      </button>)}
    </nav>

    <div className="deck-editor-grid">
      <div className="deck-catalog-pane">
        <div className="deck-pane-title"><h3>{sectionLabel(activeSection)} card pool</h3><span>{results.length} available</span></div>
        <label>Search {sectionLabel(activeSection).toLowerCase()} cards
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search names, colors, types…" />
        </label>
        {structured && legend && activeSection !== 'legend' && <p className="muted">{legend.name} allows {Array.from(allowedColors).join(' + ')}.</p>}
        <div className="catalog-results" aria-label="Available cards">
          {results.map(card => <div className="catalog-row" key={card.id}>
            <SampleCardFace card={card} size="catalog" />
            <div className="sample-card-meta"><strong>{card.name}</strong><span>{Array.isArray(card.metadata.affinities) ? card.metadata.affinities.join(' · ') : 'Original sample'}</span>
              <small>{String(card.metadata.rules ?? card.metadata.class ?? '')}</small></div>
            <button type="button" disabled={current.length >= MAX_CARDS} onClick={() => addCard(card.id)} aria-label={`Add ${card.name}`}>{activeSection === 'legend' || activeSection === 'champion' ? 'Select' : '+ Add'}</button>
          </div>)}
          {!results.length && <p className="muted">No cards match. Choose another Legend or clear the search.</p>}
        </div>
      </div>

      <aside className="deck-list-pane" aria-label="Current deck">
        <div className="deck-pane-title"><h3>Deck list</h3><span>{deck.cards.length + sectionCards(deck, 'champion').length} main cards</span></div>
        {sections.map(section => {
          const sectionCounts = new Map<string, number>();
          for (const id of sectionCards(deck, section)) sectionCounts.set(id, (sectionCounts.get(id) ?? 0) + 1);
          return <div className="deck-list-section" key={section}>
            <button type="button" className="deck-list-heading" onClick={() => { setActiveSection(section); setPreview(null); }}>
              <strong>{sectionLabel(section)}</strong><span>{sectionCards(deck, section).length}{structured ? ` / ${sectionLimit(section)}` : ''}</span>
            </button>
            {[...sectionCounts].map(([id, count]) => <div className="deck-editor-row" key={id} tabIndex={0}
              aria-label={`Preview ${cardById.get(id)?.name ?? id}`}
              aria-describedby={preview?.card.id === id ? 'deck-card-preview' : undefined}
              onMouseEnter={(event: ReactMouseEvent<HTMLDivElement>) => {
                const card = cardById.get(id);
                if (card) setPreview({ card, ...previewPosition(event.clientX, event.clientY) });
              }}
              onMouseMove={(event: ReactMouseEvent<HTMLDivElement>) => {
                const card = cardById.get(id);
                if (card) setPreview({ card, ...previewPosition(event.clientX, event.clientY) });
              }}
              onMouseLeave={() => setPreview(null)}
              onFocus={event => {
                const card = cardById.get(id);
                if (card) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setPreview({ card, ...previewPosition(rect.right, rect.top + rect.height / 2) });
                }
              }}
              onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }}
              onKeyDown={event => { if (event.key === 'Escape') setPreview(null); }}>
              <div className="deck-list-card-name">
                {cardById.get(id) && <SampleCardFace card={cardById.get(id)!} size="list" />}
                <span>{cardById.get(id)?.name ?? id}</span>
              </div>
              <div className="deck-editor-quantity">
                <button type="button" onClick={() => { setActiveSection(section); const ids = sectionCards(deck, section); const index = ids.lastIndexOf(id); setSection(section, ids.filter((_, position) => position !== index)); }} aria-label={`Remove ${cardById.get(id)?.name ?? id}`}>−</button>
                <strong aria-label={`${count} copies`}>{count}</strong>
                <button type="button" disabled={section === 'legend' || section === 'champion' || sectionCards(deck, section).length >= MAX_CARDS}
                  onClick={() => { setActiveSection(section); setSection(section, [...sectionCards(deck, section), id]); }} aria-label={`Add another ${cardById.get(id)?.name ?? id}`}>+</button>
              </div>
            </div>)}
            {!sectionCounts.size && <p className="muted">No cards yet.</p>}
          </div>;
        })}
        <div className={`deck-validation ${usable ? 'ready' : ''}`} aria-live="polite">
          <strong>{usable ? 'Deck is ready to load' : 'Deck cannot be loaded yet'}</strong>
          {!!warnings.length && <ul>{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
        </div>
      </aside>
    </div>

    <div className="button-row deck-actions">
      <button onClick={() => { updateDeck(starterDeckForModule(module, catalog)); setMessage('Reset to the original sample starter.'); }}>Reset to starter</button>
      <button onClick={() => fileRef.current?.click()}>Import deck</button>
      <button onClick={download}>Export deck</button>
      <button className="primary" disabled={!usable} onClick={() => { onLoadDeck(deck, player); setMessage(`Loaded ${deck.name} to Player ${player}.`); }}>Load to Player {player}</button>
    </div>
    <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={event => {
      void importDeck(event.target.files?.[0]); event.target.value = '';
    }} />
    {message && <p className="binding-message" role="status">{message}</p>}
    {preview && createPortal(<div id="deck-card-preview" className="deck-card-preview" role="tooltip"
      style={{ left: preview.x, top: preview.y }}>
      <SampleCardFace card={preview.card} size="preview" />
    </div>, document.body)}
  </section>;
}
