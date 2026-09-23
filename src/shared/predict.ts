import { DT, REACH_FAR_Z, REACH_IN_Z } from './constants';
import { cloneBall, stepBall, type BallState, type PhysicsEvent } from './physics';
import { reachNearZ } from './racket';
import { copyVec3, type Vec3 } from './vec';

export interface MeetPoint {
  /** Where the ball will be as it passes through the receiver's reach, in the receiver's local frame. */
  pos: Vec3;
  /** Seconds from now. */
  time: number;
}

const MAX_PREDICT_STEPS = Math.round(3 / DT);
/** Aim to meet the ball this far into the reach, leaving a margin on both sides. */
const MEET_INTO_REACH = 0.15;

/**
 * Where a receiver can meet an incoming ball (receiver's local frame): a point inside their reach
 * (which bends back along the arm arc away from `bodyX`), before the ball bounces a second time on
 * their half or leaves play. Returns null if it never gets there.
 * Pass `alreadyBounced` when the ball has already bounced on the receiver's half.
 */
export function predictMeetPoint(ball: BallState, alreadyBounced = false, bodyX = 0): MeetPoint | null {
  const atTheEndLine = scan(ball, alreadyBounced, (x, y) => reachNearZ(x, y, bodyX), false);
  if (atTheEndLine) return atTheEndLine;
  // The ball dies before the end line: it can still be leaned in on over the table, but only once it
  // has bounced (the same rule the paddle follows), and as late as possible so the lean stays short.
  return scan(ball, alreadyBounced, () => REACH_IN_Z, true);
}

/**
 * Walks the ball forward looking for a point inside a reach whose near edge is `nearOf`. Stops at the
 * ball's second bounce on this half. `leaning` means the point must be after the bounce, and takes the
 * latest one found rather than the first.
 */
function scan(
  ball: BallState,
  alreadyBounced: boolean,
  nearOf: (x: number, y: number) => number,
  leaning: boolean,
): MeetPoint | null {
  const sim = cloneBall(ball);
  const events: PhysicsEvent[] = [];
  let bounces = alreadyBounced ? 1 : 0;
  let lastInReach: MeetPoint | null = null;

  for (let i = 1; i <= MAX_PREDICT_STEPS; i++) {
    events.length = 0;
    stepBall(sim, events);
    for (const event of events) {
      if (event.type === 'table' && event.side === 0) bounces++;
      if (event.type === 'floor' || event.type === 'side') bounces = 2;
    }
    if (bounces >= 2 || sim.pos.z > REACH_FAR_Z) break;
    if (leaning && bounces < 1) continue;
    const near = nearOf(sim.pos.x, sim.pos.y);
    if (sim.pos.z < near) continue;

    const point = { pos: copyVec3(sim.pos), time: i * DT };
    if (!leaning && sim.pos.z >= near + MEET_INTO_REACH) return point;
    lastInReach = point;
  }
  return lastInReach;
}
