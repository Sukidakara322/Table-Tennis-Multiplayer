import { describe, expect, it } from 'vitest';
import { awardPoint, createMatch, currentServer, isMatchPoint, type MatchState } from './match';
import type { PlayerIndex } from './types';

function play(match: MatchState, winners: PlayerIndex[]): MatchState {
  return winners.reduce((m, w) => awardPoint(m, w).match, match);
}

describe('service order', () => {
  it('changes every two points', () => {
    let match = createMatch({ gamesToWin: 2 }, 0);
    const servers: PlayerIndex[] = [];
    for (let i = 0; i < 8; i++) {
      servers.push(currentServer(match));
      match = awardPoint(match, (i % 2) as PlayerIndex).match;
    }
    expect(servers).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
  });

  it('alternates every point from 10–10', () => {
    let match = createMatch({ gamesToWin: 2 }, 0);
    for (let i = 0; i < 20; i++) match = awardPoint(match, (i % 2) as PlayerIndex).match;
    expect(match.score).toEqual([10, 10]);
    const servers: PlayerIndex[] = [];
    for (let i = 0; i < 4; i++) {
      servers.push(currentServer(match));
      match = awardPoint(match, (i % 2) as PlayerIndex).match;
    }
    expect(servers).toEqual([0, 1, 0, 1]);
  });

  it('swaps the first server in the next game', () => {
    const match = play(createMatch({ gamesToWin: 2 }, 0), Array(11).fill(0));
    expect(match.completedGames).toEqual([[11, 0]]);
    expect(currentServer(match)).toBe(1);
  });
});

describe('scoring', () => {
  it('needs a two point lead', () => {
    let match = createMatch({ gamesToWin: 1 }, 0);
    for (let i = 0; i < 20; i++) match = awardPoint(match, (i % 2) as PlayerIndex).match;
    const eleven = awardPoint(match, 0);
    expect(eleven.gameWinner).toBeNull();
    const twelve = awardPoint(eleven.match, 0);
    expect(twelve.gameWinner).toBe(0);
    expect(twelve.matchWinner).toBe(0);
    expect(twelve.match.score).toEqual([12, 10]);
  });

  it('ends a best of 3 after two games', () => {
    let match = createMatch({ gamesToWin: 2 }, 1);
    match = play(match, Array(11).fill(1));
    expect(match.winner).toBeNull();
    expect(isMatchPoint(play(match, Array(10).fill(1)), 1)).toBe(true);
    match = play(match, Array(11).fill(1));
    expect(match.winner).toBe(1);
    expect(match.gamesWon).toEqual([0, 2]);
  });
});
