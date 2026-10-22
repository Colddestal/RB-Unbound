import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

const MIN_WIDTH = 190;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 270;
const STORAGE_KEY = 'rb-unbound-left-dock-width';

function clampWidth(value: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)));
}

export function ResizableDockColumn({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_WIDTH;
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) ? clampWidth(saved) : DEFAULT_WIDTH;
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    event.currentTarget.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      setWidth(clampWidth(startWidth + moveEvent.clientX - startX));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const changeBy = (delta: number) => setWidth(current => clampWidth(current + delta));

  return <div className="dock-resize-column" style={{ width }}>
    {children}
    <div
      className="dock-resize-handle"
      role="separator"
      aria-label="Resize left information panel"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · Double-click to reset"
      onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
      onPointerDown={beginResize}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft') {
          changeBy(-16);
          event.preventDefault();
        } else if (event.key === 'ArrowRight') {
          changeBy(16);
          event.preventDefault();
        } else if (event.key === 'Home') {
          setWidth(MIN_WIDTH);
          event.preventDefault();
        } else if (event.key === 'End') {
          setWidth(MAX_WIDTH);
          event.preventDefault();
        }
      }}
    >
      <span aria-hidden="true">⋮</span>
    </div>
  </div>;
}
