import { describe, expect, it } from 'vitest';
import {
  activateSeriesGame,
  createSeriesState,
  recordSeriesGameWinner,
  setSeriesFirstPlayer,
  setSeriesSelections,
} from '@rb-unbound/lobby';

describe('generic match series state', () => {
  it('creates a Bo3 needing two game wins', () => {
    const series = createSeriesState(3);
    expect(series).toMatchObject({
      bestOf: 3,
      winsNeeded: 2,
      currentGame: 1,
      status: 'active',
    });
    expect(series.games).toHaveLength(1);
    expect(series.games[0].status).toBe('setup');
  });

  it('stores opaque per-game setup selections and first player', () => {
    let series = createSeriesState(3);
    series = setSeriesSelections(series, 1, ['battlefield-alpha']);
    series = setSeriesSelections(series, 2, ['battlefield-beta']);
    series = setSeriesFirstPlayer(series, 2);

    expect(series.games[0].selectionsBySeat[1]).toEqual(['battlefield-alpha']);
    expect(series.games[0].selectionsBySeat[2]).toEqual(['battlefield-beta']);
    expect(series.games[0].firstPlayerSeat).toBe(2);
  });

  it('advances a Bo3 and completes after the second win', () => {
    let series = activateSeriesGame(createSeriesState(3));
    series = recordSeriesGameWinner(series, 1);
    expect(series.currentGame).toBe(2);
    expect(series.status).toBe('active');
    expect(series.winsByTeam[1]).toBe(1);
    expect(series.games[1].status).toBe('setup');

    series = activateSeriesGame(series);
    series = recordSeriesGameWinner(series, 1);
    expect(series.status).toBe('complete');
    expect(series.winsByTeam[1]).toBe(2);
    expect(series.games).toHaveLength(2);
  });

  it('completes a Bo1 after one game', () => {
    let series = activateSeriesGame(createSeriesState(1));
    series = recordSeriesGameWinner(series, 2);
    expect(series.status).toBe('complete');
    expect(series.winsByTeam[2]).toBe(1);
    expect(series.games).toHaveLength(1);
  });
});
