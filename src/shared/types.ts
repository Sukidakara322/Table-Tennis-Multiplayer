/** Player 0 stands at the +z end of the table, player 1 at the -z end. */
export type PlayerIndex = 0 | 1;

export const PLAYERS: readonly PlayerIndex[] = [0, 1];

export function otherPlayer(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}
