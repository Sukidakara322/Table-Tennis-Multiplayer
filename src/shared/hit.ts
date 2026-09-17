import { BALL_RADIUS, HALF_LENGTH, HALF_WIDTH, MAX_SPIN } from './constants';
import { stepBall, type BallState, type PhysicsEvent, type StepOptions } from './physics';
import { clamp, copyVec3, length3, type Vec2, type Vec3 } from './vec';

/**
 * Racket contact model. All functions work in the hitter's local frame:
 * the hitter stands at +z and plays the ball towards -z.
 *
 * The return is "assisted physical": a solver picks the launch angle that would land the ball
 * on a target, then the parts the player controls push it off that ideal line — incoming spin
 * kicks, the lift and spin from the swing, and hitting off the sweet spot.
 */
export const HIT_TUNING = {
  /** Paddle speeds above this are clamped (m/s). */
  maxSwing: 10,
  /** A serve only connects when the paddle moves at least this fast. */
  serveMinSwing: 0.6,
  servePower: { base: 2.6, perSwing: 0.55, min: 2.8, max: 8 },
  rallyPower: { base: 2.4, perIncoming: 0.3, perSwing: 0.95, min: 3.2, max: 17 },
  /** rad/s of spin per m/s of brushing motion. */
  spinPerSwing: 70,
  /** Fraction of incoming spin carried into the return (the rubber reverses it). */
  spinReturn: -0.35,
  /** How strongly incoming spin deflects the ball off the racket. */
  spinKick: 0.15,
  /** Vertical launch speed added per m/s of upward swing. */
  liftPerSwing: 0.22,
  serveLiftScale: 0.3,
  /** Launch errors per metre of distance from the racket centre. */
  offCenterLift: 2.0,
  offCenterAim: 3.0,
  /** How much of its own spin the aim solver compensates for; the rest is player skill. */
  solverSpinAwareness: 0.7,
  /** Serves are set pieces: the solver fully accounts for their spin. */
  serveSpinAwareness: 1,
} as const;

const SOLVER_OPTIONS: StepOptions = { net: false };
const SOLVER_MAX_STEPS = 720;
const SOLVER_ITERATIONS = 18;

export interface ReturnInput {
  /** Ball state at the moment of contact. */
  contact: BallState;
  /** Paddle velocity in the x/y plane (m/s). */
  swing: Vec2;
  /** Ball centre minus paddle centre at contact (m). */
  offset: Vec2;
  isServe: boolean;
}

/** Launch velocity change caused by the incoming ball's spin gripping the racket. */
export function spinKick(ball: BallState): Vec2 {
  // Contact point sits at +z of the ball centre; its surface velocity is spin × (0, 0, r).
  const k = HIT_TUNING.spinKick * BALL_RADIUS;
  return { x: -k * ball.spin.y, y: k * ball.spin.x };
}

export function computeReturn({ contact, swing, offset, isServe }: ReturnInput): BallState {
  const T = HIT_TUNING;
  const sx = clamp(swing.x, -T.maxSwing, T.maxSwing);
  const sy = clamp(swing.y, -T.maxSwing, T.maxSwing);
  const swingSpeed = Math.sqrt(sx * sx + sy * sy);
  const pos = copyVec3(contact.pos);

  // Brushing up gives topspin, chopping down backspin, sweeping sideways sidespin.
  const spin: Vec3 = {
    x: clamp(-sy * T.spinPerSwing + contact.spin.x * T.spinReturn, -MAX_SPIN, MAX_SPIN),
    y: clamp(sx * T.spinPerSwing + contact.spin.y * T.spinReturn, -MAX_SPIN, MAX_SPIN),
    z: contact.spin.z * T.spinReturn,
  };

  const P = isServe ? T.servePower : T.rallyPower;
  const incoming = isServe ? 0 : length3(contact.vel) * T.rallyPower.perIncoming;
  const power = clamp(P.base + incoming + swingSpeed * P.perSwing, P.min, P.max);
  const f = (power - P.min) / (P.max - P.min);
  // Harder shots aim deeper on the opponent's half.
  const targetZ = -HALF_LENGTH * (isServe ? 0.35 + 0.55 * f : 0.4 + 0.5 * f);
  const targetX = clamp(pos.x * 0.3 + sx * 0.08 + offset.x * T.offCenterAim, -HALF_WIDTH * 0.88, HALF_WIDTH * 0.88);

  const dx = targetX - pos.x;
  const dz = targetZ - pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz) || 1;
  const vx = (dx / dist) * power;
  const vz = (dz / dist) * power;

  const aware = isServe ? T.serveSpinAwareness : T.solverSpinAwareness;
  const solverSpin = { x: spin.x * aware, y: spin.y * aware, z: spin.z * aware };
  const vy = isServe
    ? solveServeVy(pos, vx, vz, solverSpin, targetZ)
    : solveLaunchVy(pos, vx, vz, solverSpin, targetZ, -6, 7);

  const kick = spinKick(contact);
  const lift = sy * T.liftPerSwing * (isServe ? T.serveLiftScale : 1);
  return {
    pos,
    vel: { x: vx + kick.x, y: vy + lift + offset.y * T.offCenterLift + kick.y, z: vz },
    spin,
  };
}

/** z of the ball's first contact with the table (or where it reaches the floor). */
function firstContactZ(pos: Vec3, vx: number, vy: number, vz: number, spin: Vec3): number {
  const ball: BallState = { pos: copyVec3(pos), vel: { x: vx, y: vy, z: vz }, spin: copyVec3(spin) };
  const events: PhysicsEvent[] = [];
  for (let i = 0; i < SOLVER_MAX_STEPS; i++) {
    stepBall(ball, events, SOLVER_OPTIONS);
    for (const event of events) {
      if (event.type === 'table') return event.pos.z;
      if (event.type === 'floor' || event.type === 'side') return ball.pos.z;
    }
    events.length = 0;
  }
  return ball.pos.z;
}

const SERVE_CANDIDATES = 10;

/**
 * A serve must bounce on both halves, which is not monotonic in vy. Try first-bounce points
 * along the server's half, keep those whose follow-through clears the net, and pick the one
 * whose second bounce lands closest to the target.
 */
function solveServeVy(pos: Vec3, vx: number, vz: number, spin: Vec3, targetZ: number): number {
  let bestVy = solveLaunchVy(pos, vx, vz, spin, HALF_LENGTH * 0.6, -5, 1.5);
  let bestError = Infinity;
  for (let i = 0; i < SERVE_CANDIDATES; i++) {
    const firstBounceZ = HALF_LENGTH * (0.25 + (0.65 * i) / (SERVE_CANDIDATES - 1));
    const vy = solveLaunchVy(pos, vx, vz, spin, firstBounceZ, -5, 1.5);
    const secondZ = serveSecondBounceZ(pos, vx, vy, vz, spin);
    if (secondZ === null) continue;
    const error = Math.abs(secondZ - targetZ);
    if (error < bestError) {
      bestError = error;
      bestVy = vy;
    }
  }
  return bestVy;
}

/** z of a serve's bounce on the receiver's half, or null if it fails before getting there. */
function serveSecondBounceZ(pos: Vec3, vx: number, vy: number, vz: number, spin: Vec3): number | null {
  const ball: BallState = { pos: copyVec3(pos), vel: { x: vx, y: vy, z: vz }, spin: copyVec3(spin) };
  const events: PhysicsEvent[] = [];
  let ownBounce = false;
  for (let i = 0; i < SOLVER_MAX_STEPS; i++) {
    stepBall(ball, events);
    for (const event of events) {
      if (event.type === 'net' || event.type === 'floor' || event.type === 'side') return null;
      if (event.type !== 'table') continue;
      if (!ownBounce && event.side === 0) ownBounce = true;
      else return event.side === 1 && ownBounce ? event.pos.z : null;
    }
    events.length = 0;
  }
  return null;
}

/** Bisection on vertical launch speed: more vy carries the ball further towards -z. */
function solveLaunchVy(pos: Vec3, vx: number, vz: number, spin: Vec3, targetZ: number, lo: number, hi: number): number {
  if (firstContactZ(pos, vx, lo, vz, spin) <= targetZ) return lo;
  if (firstContactZ(pos, vx, hi, vz, spin) >= targetZ) return hi;
  for (let i = 0; i < SOLVER_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (firstContactZ(pos, vx, mid, vz, spin) > targetZ) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
