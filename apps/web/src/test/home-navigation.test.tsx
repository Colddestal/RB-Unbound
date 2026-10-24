import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../app';

describe('dashboard navigation', () => {
  it('opens on Home and launches the table and deck editor', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Choose your next move.' })).toBeInTheDocument();
    expect(screen.queryByLabelText('RB Unbound tabletop board')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Open local table/ }));
    expect(screen.getByLabelText('RB Unbound tabletop board')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'Choose your next move.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go to deck editor/ }));
    expect(screen.getByRole('heading', { name: 'Deck editor', level: 1 })).toBeInTheDocument();
  });
});
