import { AIM_Y_MAX, AIM_Y_MIN, DT, PADDLE_HIT_RADIUS, STAND_Z, STROKE_SWEEP } from './constants';
import { cloneBall, stepBall, type BallState, type PhysicsEvent } from './physics';
import { copyVec3, type Vec3 } from './vec';

export interface MeetPoint {
  /** Where the ball will cross the plane the receiver holds their racket on, in their local frame. */
  pos: Vec3;
  /** Seconds from now. */
  time: number;
}

const MAX_PREDICT_STEPS = Math.round(3 / DT);
/** Aim for the middle of the blade, not its very edge. */
const MEET_MARGIN = 0.03;
/** Above and below the plane a stroke can still reach: the blade itself, plus its sweep. */
const REACH = PADDLE_HIT_RADIUS + STROKE_SWEEP - MEET_MARGIN;

/**
 * Where an incoming ball will cross the plane the receiver's racket is held on, in their local frame.
 * There is exactly one such point per shot, because the plane never moves, and everything about
 * whether the ball is playable is decided there: it has to have bounced on the receiver's half first
 * (otherwise it is going out, and touching it is a volley), it has to get that far at all (a ball that
 * dies in front of the plane is a winner), and it has to arrive within a stroke's reach of the plane.
 *
 * Returns null in every one of those cases, which is a real answer rather than a failure: it means
 * that ball cannot be returned. Pass `alreadyBounced` when it has already bounced on this half.
 */
export function predictMeetPoint(ball: BallState, alreadyBounced = false): MeetPoint | null {
  const sim = cloneBall(ball);
  const events: PhysicsEvent[] = [];
  let bounced = alreadyBounced;

  for (let i = 1; i <= MAX_PREDICT_STEPS; i++) {
    events.length = 0;
    stepBall(sim, events);
    for (const event of events) {
      // The floor or the surround: the ball is dead before it ever got here.
      if (event.type === 'floor' || event.type === 'side') return null;
      if (event.type !== 'table') continue;
      // A bounce on the far half is the server's own, on the way over, and none of our business.
      if (event.side !== 0) continue;
      // A second bounce on ours is: that is the point, gone, before the racket was ever in the way.
      if (bounced) return null;
      bounced = true;
    }
    if (sim.pos.z < STAND_Z) continue;
    if (!bounced) return null; // still in flight at the plane: this one is going out
    if (sim.pos.y < AIM_Y_MIN - REACH || sim.pos.y > AIM_Y_MAX + REACH) return null;
    return { pos: copyVec3(sim.pos), time: i * DT };
  }
  return null;
}
