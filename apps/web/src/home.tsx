type Destination = 'local' | 'decks' | 'multiplayer';

export function Home({ moduleCount, onNavigate }: { moduleCount: number; onNavigate: (destination: Destination) => void }) {
  return <div className="home-page">
    <div className="home-intro"><div><span className="home-kicker">WELCOME TO THE TABLE</span><h1>Choose your next move.</h1><p>Build a deck, set up a match, or jump straight into the local tabletop.</p></div><span className="home-version">TABLETOP ALPHA <span aria-hidden="true">●</span> READY TO PLAY</span></div>

    <section className="home-metrics" aria-label="At a glance">
      <div className="metric-card"><span className="metric-icon">▦</span><span>GAME FORMATS</span><strong>3</strong><small>1v1 · 2v2 · four player FFA</small></div>
      <div className="metric-card"><span className="metric-icon">♙</span><span>PLAYER SEATS</span><strong>2–4</strong><small>Depending on format</small></div>
      <div className="metric-card"><span className="metric-icon">◇</span><span>MODULES AVAILABLE</span><strong>{moduleCount}</strong><small>Ready for the tabletop</small></div>
      <div className="metric-card"><span className="metric-icon">◉</span><span>SPECTATORS</span><strong>0–4</strong><small>Optional room slots</small></div>
    </section>

    <div className="home-grid">
      <section className="home-feature" aria-labelledby="feature-title">
        <div className="feature-copy"><span className="home-kicker">YOUR TABLE IS READY</span><h2 id="feature-title">Play your way.</h2><p>Move cards by hand, keep the board in view, and pass turns when you’re ready. Start locally or gather friends in a private room.</p>
          <div className="feature-actions"><button className="home-primary" onClick={() => onNavigate('local')}>Open local table <span aria-hidden="true">↗</span></button><button className="home-quiet" onClick={() => onNavigate('multiplayer')}>Multiplayer rooms <span aria-hidden="true">→</span></button></div>
        </div>
        <div className="home-board-art" aria-hidden="true"><div className="art-board"><div className="art-zone art-zone-top"/><div className="art-zone art-zone-middle"/><div className="art-zone art-zone-bottom"/><span className="art-card art-card-a">✦</span><span className="art-card art-card-b">◆</span><span className="art-card art-card-c">◇</span><span className="art-orbit art-orbit-one"/><span className="art-orbit art-orbit-two"/></div></div>
      </section>

      <section className="home-side-card" aria-labelledby="steps-title"><div className="home-panel-heading"><span className="home-kicker">START HERE</span><span aria-hidden="true">✦</span></div><h2 id="steps-title">A match in three steps</h2>
        <ol className="home-steps"><li><span>01</span><div><strong>Shape your deck</strong><p>Build from sample cards and check the deck warnings.</p></div></li><li><span>02</span><div><strong>Choose a table</strong><p>Play on one screen or create a room for friends.</p></div></li><li><span>03</span><div><strong>Take your turn</strong><p>Move cards freely, then lock in End Turn.</p></div></li></ol>
        <button className="home-text-link" onClick={() => onNavigate('decks')}>Go to deck editor <span aria-hidden="true">↗</span></button>
      </section>

      <section className="home-section" aria-labelledby="launch-title"><div className="section-heading"><div><span className="home-kicker">EXPLORE THE APP</span><h2 id="launch-title">Where would you like to go?</h2></div><span>Pick up wherever you want</span></div>
        <div className="home-launch-grid"><button className="launch-card" onClick={() => onNavigate('local')}><span className="launch-glyph launch-local">▦</span><strong>Local sandbox</strong><small>Try the tabletop and pass turns on one screen.</small><span className="launch-arrow">↗</span></button>
          <button className="launch-card" onClick={() => onNavigate('decks')}><span className="launch-glyph launch-decks">▤</span><strong>Deck editor</strong><small>Build, import, and export your prototype decks.</small><span className="launch-arrow">↗</span></button>
          <button className="launch-card" onClick={() => onNavigate('multiplayer')}><span className="launch-glyph launch-rooms">◎</span><strong>Multiplayer rooms</strong><small>Create or join a room with a running server.</small><span className="launch-arrow">↗</span></button></div>
      </section>
    </div>
  </div>;
}
