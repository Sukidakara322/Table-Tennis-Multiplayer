import { DT, hoverAt, PADDLE_HIT_RADIUS, REACH_FAR_Z, REACH_IN_Z, REACH_NEAR_Z, STROKE_SWEEP } from './constants';
import { cloneBall, stepBall, type BallState, type PhysicsEvent } from './physics';
import { copyVec3, type Vec3 } from './vec';

export interface MeetPoint {
  /** Where the ball will be as it passes through the receiver's reach, in the receiver's local frame. */
  pos: Vec3;
  /** Seconds from now. */
  time: number;
}

const MAX_PREDICT_STEPS = Math.round(3 / DT);
/** Aim for the middle of the blade, not its very edge. */
const MEET_MARGIN = 0.03;

/**
 * Where a receiver could meet an incoming ball (receiver's local frame): a point along its path that
 * is inside their reach and passing through the blade's height band, after it has bounced on their
 * half and before it bounces again or leaves play. Returns null if no such point exists — which is a
 * real answer, meaning that ball cannot be returned from where it is going.
 * Pass `alreadyBounced` when the ball has already bounced on the receiver's half.
 */
export function predictMeetPoint(ball: BallState, alreadyBounced = false): MeetPoint | null {
  const sim = cloneBall(ball);
  const events: PhysicsEvent[] = [];
  let bounces = alreadyBounced ? 1 : 0;
  let best: MeetPoint | null = null;

  for (let i = 1; i <= MAX_PREDICT_STEPS; i++) {
    events.length = 0;
    stepBall(sim, events);
    for (const event of events) {
      if (event.type === 'table' && event.side === 0) bounces++;
      if (event.type === 'floor' || event.type === 'side') bounces = 2;
    }
    if (bounces >= 2 || sim.pos.z > REACH_FAR_Z) break;
    if (sim.pos.z < REACH_IN_Z) continue;
    // Only where the racket could actually meet it: the blade hovers at a fixed height, so the ball
    // has to be passing through that band, and never before it has bounced (that would be a volley).
    if (bounces < 1) continue;
    // Anywhere a stroke could reach: the blade at that spot, plus the height its sweep covers.
    if (Math.abs(sim.pos.y - hoverAt(sim.pos.z)) > PADDLE_HIT_RADIUS + STROKE_SWEEP - MEET_MARGIN) continue;

    const point = { pos: copyVec3(sim.pos), time: i * DT };
    // Prefer meeting it comfortably back rather than snatching at it over the table.
    if (sim.pos.z >= REACH_NEAR_Z) return point;
    best ??= point;
  }
  return best;
}
