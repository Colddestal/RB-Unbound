import { useEffect, useRef, useState, type CSSProperties } from 'react';

export function DeckPile({
  label,
  count,
  pattern,
  interactive,
  style,
  onDraw,
  onShuffle,
}: {
  label: string;
  count: number;
  pattern: string;
  interactive: boolean;
  style?: CSSProperties;
  onDraw: (count: number) => void;
  onShuffle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawCount, setDrawCount] = useState(2);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const draw = (amount: number) => {
    if (!interactive || count < 1) return;
    onDraw(Math.max(1, Math.min(amount, count)));
    setMenuOpen(false);
  };

  return <div ref={rootRef} className="deck-pile-control" style={style}>
    <button
      type="button"
      className={`pile-card deck-pile-button back-${pattern} ${interactive ? 'interactive' : 'locked'}`}
      disabled={!interactive || count < 1}
      title={interactive ? 'Click to draw · Right-click for deck actions' : `${count} cards remaining`}
      onClick={() => draw(1)}
      onContextMenu={event => {
        if (!interactive) return;
        event.preventDefault();
        setMenuOpen(current => !current);
      }}
    >
      <span className="deck-symbol">◆</span>
      <strong>{label.toUpperCase()}</strong>
      <span>{count} card{count === 1 ? '' : 's'}</span>
    </button>

    {menuOpen && <div className="deck-context-menu" role="menu">
      <strong>{label}</strong>
      <button type="button" disabled={!count} onClick={() => draw(1)}>Draw 1</button>
      <div className="draw-x-row">
        <input
          aria-label="Number of cards to draw"
          type="number"
          min={1}
          max={Math.max(1, Math.min(20, count))}
          value={drawCount}
          onChange={event => setDrawCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
        />
        <button type="button" disabled={!count} onClick={() => draw(drawCount)}>Draw X</button>
      </div>
      <button type="button" disabled={count < 2} onClick={() => {
        onShuffle();
        setMenuOpen(false);
      }}>Shuffle</button>
    </div>}
  </div>;
}
