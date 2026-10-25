import { useEffect, useState } from 'react';
import { builtInModulePackages, DECK_SECTIONS, sectionCards, sectionLabel, type DeckDefinition, type ModulePackage } from '@rb-unbound/tabletop';
import { accountRequest, useAccount } from './account';

type PublicDeckSummary = { id: string; name: string; author: string; moduleId: string; moduleVersion: string; cardCount: number };
type Listing = { decks: PublicDeckSummary[]; total: number; page: number };
type PublicDeck = { id: string; author: string; deck: DeckDefinition };

export function Discovery({ modulePackages, onOpenEditor }: { modulePackages: ModulePackage[]; onOpenEditor: () => void }) {
  const { account } = useAccount();
  const [query, setQuery] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<PublicDeck | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, moduleId, page: String(page) });
      void fetch(`/api/discover/decks?${params}`, { signal: controller.signal })
        .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<Listing>; })
        .then(result => { setListing(result); setMessage(''); })
        .catch(() => { if (!controller.signal.aborted) setMessage('Could not load public decks. Start the desktop host and try again.'); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, moduleId, page, refresh]);

  const openDeck = async (id: string) => {
    setMessage(''); setSelected(null);
    try {
      const response = await fetch(`/api/discover/decks/${id}`);
      if (!response.ok) throw new Error();
      setSelected(await response.json() as PublicDeck);
    } catch { setMessage('This deck is no longer public. Refresh the list.'); }
  };

  const copyDeck = async () => {
    if (!selected || !account || busy) return;
    setBusy(true);
    try {
      await accountRequest(account.token, `/decks/${selected.id}/copy`, 'POST');
      onOpenEditor();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not copy this deck.'); }
    finally { setBusy(false); }
  };

  const moduleName = (deck: DeckDefinition) => modulePackages.find(item => item.module.id === deck.moduleId)?.module.name ?? deck.moduleId;
  const catalog = selected ? builtInModulePackages.find(item => item.module.id === selected.deck.moduleId && item.module.version === selected.deck.moduleVersion)?.cards ?? [] : [];
  const cardNames = new Map(catalog.map(card => [card.id, card.name]));

  return <section className="panel discovery" aria-label="Deck discovery">
    <div className="discovery-heading"><div><span className="eyebrow">COMMUNITY DECKS</span><h1>Discover decks</h1>
      <p>Browse decks shared by players on this desktop host. Copy one into your account to make your own edits.</p></div>
      <button type="button" onClick={() => { setSelected(null); setRefresh(value => value + 1); }}>Refresh</button>
    </div>
    <div className="discovery-filters">
      <label>Search decks or players<input value={query} maxLength={80} onChange={event => { setQuery(event.target.value); setPage(0); setSelected(null); }} placeholder="Deck name or username" /></label>
      <label>Game module<select value={moduleId} onChange={event => { setModuleId(event.target.value); setPage(0); setSelected(null); }}>
        <option value="">All modules</option>{modulePackages.map(item => <option key={item.module.id} value={item.module.id}>{item.module.name}</option>)}
      </select></label>
    </div>
    {message && <p className="binding-message" role="status">{message}</p>}
    <div className="discovery-layout">
      <div className="discovery-list" aria-label="Public decks">
        {listing?.decks.map(item => <button key={item.id} type="button" className={`discovery-item ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => { void openDeck(item.id); }}>
          <strong>{item.name}</strong><span>by @{item.author}</span><small>{item.moduleId} · {item.cardCount} main cards</small>
        </button>)}
        {listing && !listing.decks.length && <p className="muted">No public decks found. Try a different search or share one from the editor.</p>}
        {listing && listing.total > 24 && <div className="discovery-pages"><button disabled={page === 0} onClick={() => { setPage(value => value - 1); setSelected(null); }}>Previous</button>
          <span>Page {page + 1} of {Math.ceil(listing.total / 24)}</span>
          <button disabled={(page + 1) * 24 >= listing.total} onClick={() => { setPage(value => value + 1); setSelected(null); }}>Next</button></div>}
      </div>
      <div className="discovery-detail" aria-label="Deck details">
        {selected ? <><span className="eyebrow">SHARED BY @{selected.author}</span><h2>{selected.deck.name}</h2>
          <p>{moduleName(selected.deck)} · {selected.deck.cards.length} main cards</p>
          {DECK_SECTIONS.map(section => {
            const counts = new Map<string, number>();
            for (const id of sectionCards(selected.deck, section)) counts.set(id, (counts.get(id) ?? 0) + 1);
            return counts.size > 0 && <div className="discovery-section" key={section}><h3>{sectionLabel(section)} <small>{sectionCards(selected.deck, section).length}</small></h3>
              {[...counts].map(([id, count]) => <div key={id}><span>{cardNames.get(id) ?? id}</span><strong>×{count}</strong></div>)}
            </div>;
          })}
          <button className="primary" type="button" disabled={!account || busy} onClick={() => { void copyDeck(); }}>Copy to my decks</button>
          {!account && <p className="muted">Sign in above to copy this deck into your account.</p>}
        </> : <p className="muted">Select a deck to see its cards.</p>}
      </div>
    </div>
  </section>;
}
