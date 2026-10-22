import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardInspector } from '../card-inspector';
import { frontierSkirmishModule, genericDuelModule } from '@rb-unbound/tabletop';

describe('CardInspector', () => {
  it('shows its empty guidance when no card is visible', () => {
    render(<CardInspector pinned={false} onClear={() => undefined} />);
    expect(screen.getByText('No card selected')).toBeInTheDocument();
    expect(screen.getByText(/Hover over a visible card/i)).toBeInTheDocument();
  });

  it('renders visible card details', () => {
    render(<CardInspector
      pinned={false}
      onClear={() => undefined}
      card={{
        id: 'test-1',
        label: 'Test Scout',
        owner: 1,
        zone: 'field',
        faceUp: true,
        rotation: 90,
      }}
    />);

    expect(screen.getAllByText('Test Scout').length).toBeGreaterThan(0);
    expect(screen.queryByText('Player 1')).not.toBeInTheDocument();
    expect(screen.queryByText('field')).not.toBeInTheDocument();
    expect(screen.queryByText('Face up')).not.toBeInTheDocument();
    expect(screen.queryByText('90°')).not.toBeInTheDocument();
  });

  it('does not reveal the name of a hidden card', () => {
    render(<CardInspector
      pinned={false}
      onClear={() => undefined}
      card={{
        id: 'hidden-1',
        label: null,
        owner: 2,
        zone: 'field',
        faceUp: false,
        rotation: 180,
      }}
    />);

    expect(screen.getAllByText('Hidden card').length).toBeGreaterThan(0);
  });

  it('renders Generic Duel metadata using module-defined fields', () => {
    render(<CardInspector
      pinned={false}
      onClear={() => undefined}
      module={genericDuelModule}
      card={{
        id: 'generic-visible',
        definitionId: 'amber-wisp',
        label: 'Amber Wisp',
        owner: 1,
        zone: 'field',
        faceUp: true,
        rotation: 0,
      }}
    />);
    expect(screen.getByText('Spirit')).toBeInTheDocument();
    expect(screen.getByText('Original placeholder spirit.')).toBeInTheDocument();
    expect(screen.getByText('starter, spirit')).toBeInTheDocument();
  });

  it('renders Frontier metadata with a different field schema', () => {
    render(<CardInspector
      pinned={false}
      onClear={() => undefined}
      module={frontierSkirmishModule}
      card={{
        id: 'frontier-visible',
        definitionId: 'ridge-captain',
        label: 'Ridge Captain',
        owner: 1,
        zone: 'command-post',
        faceUp: true,
        rotation: 0,
      }}
    />);
    expect(screen.getByText('Leader')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('Command Post')).not.toBeInTheDocument();
  });

  it('does not resolve module metadata for a hidden card', () => {
    render(<CardInspector
      pinned={false}
      onClear={() => undefined}
      module={frontierSkirmishModule}
      card={{
        id: 'hidden',
        definitionId: null,
        label: null,
        owner: 2,
        zone: 'field',
        faceUp: false,
        rotation: 0,
      }}
    />);
    expect(screen.queryByText('Leader')).not.toBeInTheDocument();
    expect(screen.getAllByText('Hidden card').length).toBeGreaterThan(0);
  });

  it('clears a pinned card through the close control', () => {
    const onClear = vi.fn();
    render(<CardInspector
      pinned
      onClear={onClear}
      card={{
        id: 'test-2',
        label: 'Pinned Card',
        owner: 1,
        zone: 'hand',
        faceUp: true,
        rotation: 0,
      }}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear pinned card' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
