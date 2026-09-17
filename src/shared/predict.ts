import { DT, MAX_PADDLE_Z } from './constants';
import { cloneBall, stepBall, type BallState, type PhysicsEvent } from './physics';
import { copyVec3, type Vec3 } from './vec';

export interface Intercept {
  /** Where to meet the ball, in the receiver's local frame. */
  pos: Vec3;
  /** Seconds from now. */
  time: number;
}

const MAX_PREDICT_STEPS = Math.round(3 / DT);
const DEEP_Z = MAX_PADDLE_Z - 0.05;

/**
 * Predicts where the receiver should meet an incoming ball (receiver's local frame):
 * at the top of its bounce on the receiver's half, or deep behind the table if it flies long.
 * Returns null when the ball will never come within reach.
 */
export function predictIntercept(ball: BallState): Intercept | null {
  const sim = cloneBall(ball);
  const events: PhysicsEvent[] = [];
  let bounced = false;

  for (let i = 1; i <= MAX_PREDICT_STEPS; i++) {
    events.length = 0;
    stepBall(sim, events);
    for (const event of events) {
      if (event.type === 'table' && event.side === 0) bounced = true;
      if (event.type === 'floor' || event.type === 'side') return null;
    }
    const time = i * DT;
    if (sim.pos.z >= DEEP_Z) return { pos: copyVec3(sim.pos), time };
    if (bounced && sim.vel.y <= 0) return { pos: copyVec3(sim.pos), time };
  }
  return null;
}
