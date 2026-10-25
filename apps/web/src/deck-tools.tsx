import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { battlefieldArt } from './battlefield-art';
import { accountRequest, useAccount, type SavedDeck } from './account';
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
  const art = battlefieldArt(card);
  return <div className={`sample-card sample-card-${size} ${section === 'runes' ? 'sample-rune' : ''} ${art ? 'sample-battlefield' : ''}`}
    style={{ ...style, ...(art ? { backgroundImage: `linear-gradient(180deg,transparent 22%,#081e2ade 100%),url(${art})` } : {}) }}>
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

function libraryKey(module: GameModule): string {
  return `rb-unbound-decks:${module.id}@${module.version}`;
}

function isSavedDraft(value: unknown, module: GameModule, catalog: readonly CardDefinition[]): value is DeckDefinition {
  if (!value || typeof value !== 'object') return false;
  const deck = value as Partial<DeckDefinition>;
  return typeof deck.name === 'string' && deck.name.length <= 100 &&
    isDeckDefinition({ ...deck, name: deck.name || 'Untitled' }, module, catalog);
}

function localLibrary(module: GameModule, catalog: readonly CardDefinition[]): SavedDeck[] {
  try {
    const saved = window.localStorage.getItem(libraryKey(module));
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const decks = parsed.filter(item => item && typeof item.id === 'string' && isSavedDraft(item.deck, module, catalog));
        if (decks.length) return decks;
      }
    }
    const drafts = ([1, 2] as const).flatMap(player => {
      const raw = window.localStorage.getItem(`rb-unbound-deck:${module.id}@${module.version}:p${player}`);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return isSavedDraft(parsed, module, catalog)
        ? [{ id: crypto.randomUUID(), deck: { ...parsed, name: `${parsed.name} · Seat ${player} draft` } }] : [];
    });
    if (drafts.length) {
      window.localStorage.setItem(libraryKey(module), JSON.stringify(drafts));
      return drafts;
    }
  } catch {
    // Storage can be disabled; the editor still works for this session.
  }
  return [{ id: crypto.randomUUID(), deck: starterDeckForModule(module, catalog) }];
}

function sectionLimit(section: DeckSection): string {
  return ({ legend: '1', runes: '12', champion: '1', deck: '39', sideDeck: '0–8', battlefields: '3 unique' })[section];
}

export function DeckTools({ module, onLoadDeck, catalog }: {
  module: GameModule;
  catalog: readonly CardDefinition[];
  onLoadDeck: (deck: DeckDefinition, player: 1 | 2) => void;
}) {
  const { account } = useAccount();
  const structured = module.id === 'frontier-skirmish';
  const sections = structured ? DECK_SECTIONS : (['deck'] as const);
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<DeckSection>('deck');
  const [library, setLibrary] = useState<SavedDeck[]>(() => localLibrary(module, catalog));
  const [selectedId, setSelectedId] = useState(() => library[0].id);
  const [deck, setDeck] = useState<DeckDefinition>(() => library[0].deck);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ token: string; id: string; deck: DeckDefinition; isPrivate: boolean } | null>(null);
  const saveQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const flushSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = pendingSave.current;
    pendingSave.current = null;
    if (!pending) return saveQueue.current;
    saveQueue.current = saveQueue.current.catch(() => false).then(async () => {
      try {
        await accountRequest(pending.token, `/decks/${pending.id}`, 'PUT', { deck: pending.deck, isPrivate: pending.isPrivate });
        setMessage('Saved to your account.');
        return true;
      } catch {
        if (!pendingSave.current) pendingSave.current = pending;
        setMessage('Could not save this deck to the host. Export a copy before leaving.');
        return false;
      }
    });
    return saveQueue.current;
  };
  useEffect(() => {
    if (!account) { const items = localLibrary(module, catalog); setLibrary(items); setSelectedId(items[0].id); setDeck(items[0].deck); return; }
    let active = true;
    void accountRequest<{ decks: SavedDeck[] }>(account.token, '/decks').then(result => {
      if (!active) return;
      const items = result.decks.filter(item => item.deck.moduleId === module.id && item.deck.moduleVersion === module.version);
      setLibrary(items); setSelectedId(items[0]?.id ?? '');
      if (items[0]) setDeck(items[0].deck);
    }).catch(() => setMessage('Could not load account decks. Check the host connection.'));
    return () => { active = false; void flushSave(); };
  }, [account?.token, module.id, module.version]);
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
  const selectedDeck = library.find(item => item.id === selectedId);

  const queueSave = (item: SavedDeck) => {
    if (!account) return;
    pendingSave.current = { token: account.token, id: item.id, deck: item.deck, isPrivate: item.isPrivate !== false };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSave(); }, 450);
  };

  const updateDeck = (next: DeckDefinition) => {
    setPreview(null);
    setDeck(next);
    const updated = library.map(item => item.id === selectedId ? { ...item, deck: next } : item);
    setLibrary(updated);
    if (account) {
      const item = updated.find(entry => entry.id === selectedId);
      if (item) queueSave(item);
    } else {
      try { window.localStorage.setItem(libraryKey(module), JSON.stringify(updated)); setMessage('Saved in this browser. Sign in to use it on another device.'); }
      catch { setMessage('Changes are available for this session. Export a copy to keep them.'); }
    }
  };

  const setPrivate = (isPrivate: boolean) => {
    if (!account || !selectedDeck) return;
    const updated = library.map(item => item.id === selectedId ? { ...item, isPrivate } : item);
    setLibrary(updated);
    queueSave({ ...selectedDeck, isPrivate });
    setMessage(isPrivate ? 'Saving as private…' : 'Publishing to Discovery…');
  };

  const createDeck = async () => {
    try {
      if (!await flushSave()) return;
      const item = account
        ? await accountRequest<SavedDeck>(account.token, '/decks', 'POST', { moduleId: module.id })
        : { id: crypto.randomUUID(), deck: { ...starterDeckForModule(module, catalog), name: `Deck ${library.length + 1}` } };
      const next = [...library, item]; setLibrary(next); setSelectedId(item.id); setDeck(item.deck);
      if (!account) window.localStorage.setItem(libraryKey(module), JSON.stringify(next));
      setMessage('New deck created.');
    } catch { setMessage('Could not create a deck. Check the host connection.'); }
  };

  const deleteDeck = async () => {
    if (library.length < 2) { setMessage('Keep at least one deck in the library.'); return; }
    try {
      if (!await flushSave()) return;
      if (account) await accountRequest(account.token, `/decks/${selectedId}`, 'DELETE');
      const next = library.filter(item => item.id !== selectedId);
      setLibrary(next); setSelectedId(next[0].id); setDeck(next[0].deck);
      if (!account) window.localStorage.setItem(libraryKey(module), JSON.stringify(next));
      setMessage('Deck deleted.');
    } catch { setMessage('Could not delete the deck.'); }
  };
  const setSection = (section: DeckSection, ids: string[]) => {
    if (section === 'deck') updateDeck({ ...deck, cards: ids });
    else updateDeck({ ...deck, sections: {
      legend: sectionCards(deck, 'legend'), runes: sectionCards(deck, 'runes'),
      champion: sectionCards(deck, 'champion'), sideDeck: sectionCards(deck, 'sideDeck'), battlefields: sectionCards(deck, 'battlefields'),
      [section]: ids,
    } });
  };
  const addCard = (id: string) => {
    if (current.length >= MAX_CARDS) { setMessage('This section is full.'); return; }
    if (activeSection === 'battlefields' && current.includes(id)) { setMessage('Choose a different Battlefield.'); return; }
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
      if (!await flushSave()) return;
      if (file.size > 250_000) throw new Error('too large');
      const parsed: unknown = JSON.parse(await file.text());
      if (!isDeckDefinition(parsed, module, catalog)) throw new Error('invalid');
      const item = account
        ? await accountRequest<SavedDeck>(account.token, '/decks', 'POST', { moduleId: module.id })
        : { id: crypto.randomUUID(), deck: parsed };
      if (account) await accountRequest(account.token, `/decks/${item.id}`, 'PUT', { deck: parsed, isPrivate: false });
      const next = [...library, { ...item, deck: parsed }];
      setLibrary(next); setSelectedId(item.id); setDeck(parsed);
      if (!account) window.localStorage.setItem(libraryKey(module), JSON.stringify(next));
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
      <label>Decks
        <select value={selectedId} onChange={event => {
          const id = event.target.value;
          void flushSave().then(saved => {
            if (!saved) return;
            const item = library.find(entry => entry.id === id);
            if (item) { setSelectedId(item.id); setDeck(item.deck); setMessage(''); setPreview(null); }
          });
        }}>{library.map(item => <option key={item.id} value={item.id}>{item.deck.name}</option>)}</select>
      </label>
      <button type="button" onClick={() => { void createDeck(); }}>Create New Deck +</button>
      <label>Deck name
        <input maxLength={100} value={deck.name} onChange={event => updateDeck({ ...deck, name: event.target.value })} placeholder="Name your deck" />
      </label>
    </div>

    <label className="deck-privacy"><input type="checkbox" checked={selectedDeck?.isPrivate !== false} disabled={!account || !selectedDeck}
      onChange={event => setPrivate(event.target.checked)} /> Private deck
      <span>{account ? 'Uncheck to show this deck in Discovery. New account decks are public by default.' : 'Sign in to publish decks. Browser-only decks stay on this device.'}</span>
    </label>

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
            <button type="button" disabled={current.length >= MAX_CARDS || (activeSection === 'battlefields' && current.includes(card.id))} onClick={() => addCard(card.id)} aria-label={`Add ${card.name}`}>{activeSection === 'legend' || activeSection === 'champion' ? 'Select' : '+ Add'}</button>
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
              <button type="button" disabled={section === 'legend' || section === 'champion' || section === 'battlefields' || sectionCards(deck, section).length >= MAX_CARDS}
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
      <button onClick={() => { void deleteDeck(); }}>Delete deck</button>
      <button onClick={() => fileRef.current?.click()}>Import deck</button>
      <button onClick={download}>Export deck</button>
      <button className="primary" disabled={!usable} onClick={() => { void flushSave().then(saved => { if (saved) { onLoadDeck(deck, 1); setMessage(`Loaded ${deck.name} to Seat 1 for local testing.`); } }); }}>Test as Seat 1</button>
      <button className="primary" disabled={!usable} onClick={() => { void flushSave().then(saved => { if (saved) { onLoadDeck(deck, 2); setMessage(`Loaded ${deck.name} to Seat 2 for local testing.`); } }); }}>Test as Seat 2</button>
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
