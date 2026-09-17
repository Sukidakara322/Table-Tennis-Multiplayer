import type { BallState } from './physics';
import type { PlayerIndex } from './types';
import type { Vec3 } from './vec';

/**
 * Each player's "local frame" has their own end of the table at +z and screen-right at +x.
 * Player 0's local frame is the world frame; player 1's is the world rotated 180° about y.
 * A rotation (not a mirror) keeps the physics identical, spin included.
 */
export function toLocalVec(player: PlayerIndex, v: Vec3): Vec3 {
  return player === 0 ? { x: v.x, y: v.y, z: v.z } : { x: -v.x, y: v.y, z: -v.z };
}

/** The 180° rotation is its own inverse. */
export const toWorldVec = toLocalVec;

export function toLocalBall(player: PlayerIndex, ball: BallState): BallState {
  return {
    pos: toLocalVec(player, ball.pos),
    vel: toLocalVec(player, ball.vel),
    spin: toLocalVec(player, ball.spin),
  };
}

export const toWorldBall = toLocalBall;
