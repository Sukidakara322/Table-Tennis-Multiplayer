import { otherPlayer, type PlayerIndex } from './types';

export type GamesToWin = 1 | 2 | 3;

export const POINTS_TO_WIN_GAME = 11;

export interface MatchConfig {
  /** 1 = single game, 2 = best of 3, 3 = best of 5. */
  gamesToWin: GamesToWin;
}

export type Score = [number, number];

export interface MatchState {
  config: MatchConfig;
  firstServer: PlayerIndex;
  /** Points in the game being played (or the final game once the match is over). */
  score: Score;
  gamesWon: Score;
  completedGames: Score[];
  winner: PlayerIndex | null;
}

export interface PointResult {
  match: MatchState;
  gameWinner: PlayerIndex | null;
  matchWinner: PlayerIndex | null;
}

export function createMatch(config: MatchConfig, firstServer: PlayerIndex): MatchState {
  return { config, firstServer, score: [0, 0], gamesWon: [0, 0], completedGames: [], winner: null };
}

export function gameWinner(score: Score): PlayerIndex | null {
  const [a, b] = score;
  if (a >= POINTS_TO_WIN_GAME && a - b >= 2) return 0;
  if (b >= POINTS_TO_WIN_GAME && b - a >= 2) return 1;
  return null;
}

/**
 * Service changes every 2 points, and every point once the game reaches 10–10.
 * Players alternate who serves first in each game.
 */
export function currentServer(match: MatchState): PlayerIndex {
  const gameIndex = match.completedGames.length;
  const gameFirstServer = gameIndex % 2 === 0 ? match.firstServer : otherPlayer(match.firstServer);
  const played = match.score[0] + match.score[1];
  const deuceAt = (POINTS_TO_WIN_GAME - 1) * 2;
  const turns = played < deuceAt ? Math.floor(played / 2) : deuceAt / 2 + (played - deuceAt);
  return turns % 2 === 0 ? gameFirstServer : otherPlayer(gameFirstServer);
}

export function awardPoint(match: MatchState, winner: PlayerIndex): PointResult {
  if (match.winner !== null) return { match, gameWinner: null, matchWinner: match.winner };

  const score: Score = [match.score[0], match.score[1]];
  score[winner] += 1;
  const wonGame = gameWinner(score);
  if (wonGame === null) return { match: { ...match, score }, gameWinner: null, matchWinner: null };

  const gamesWon: Score = [match.gamesWon[0], match.gamesWon[1]];
  gamesWon[wonGame] += 1;
  const matchWinner = gamesWon[wonGame] >= match.config.gamesToWin ? wonGame : null;
  return {
    match: {
      ...match,
      score: matchWinner === null ? [0, 0] : score,
      gamesWon,
      completedGames: [...match.completedGames, score],
      winner: matchWinner,
    },
    gameWinner: wonGame,
    matchWinner,
  };
}

/** True when the next point could end the match in `player`'s favour. */
export function isMatchPoint(match: MatchState, player: PlayerIndex): boolean {
  if (match.winner !== null) return false;
  const score: Score = [match.score[0], match.score[1]];
  score[player] += 1;
  return gameWinner(score) === player && match.gamesWon[player] + 1 >= match.config.gamesToWin;
}
