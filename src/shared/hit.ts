import { BALL_RADIUS, DT, HALF_LENGTH, HALF_WIDTH, MAX_SPIN } from './constants';
import { stepBall, type BallState, type PhysicsEvent, type StepOptions } from './physics';
import { faceNormal, type PaddleFace } from './racket';
import { clamp, copyVec3, cross3, length3, type Vec2, type Vec3 } from './vec';

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
  /** Serves are struck low (paddle height); slower than ~5 m/s they can't legally clear the net. */
  servePower: { base: 5, perSwing: 0.4, min: 5, max: 8 },
  rallyPower: { base: 2.4, perIncoming: 0.3, perSwing: 0.95, min: 3.2, max: 17 },
  /** rad/s of spin per m/s of paddle motion brushing across the racket face (any direction). */
  brushSpin: 70,
  /** Extra launch speed per m/s of paddle motion driving into the face instead of across it. */
  throughPower: 0.4,
  /**
   * Fraction of its own sideways curve the aim corrects for. Half: the bend stays clearly visible and
   * a strong curve can still carry the ball wide of the aim.
   */
  curveAwareness: 0.5,
  /** Fraction of incoming spin carried into the return (the rubber reverses it). */
  spinReturn: -0.35,
  /** How strongly incoming spin deflects the ball off the racket. */
  spinKick: 0.15,
  /** Vertical launch speed added per m/s of upward swing. */
  liftPerSwing: 0.22,
  /** Serves fly exactly as solved (their net clearance is checked); swing and face shape them through spin. */
  serveLiftScale: 0,
  /** Launch errors per metre of distance from the racket centre. */
  offCenterLift: 2.0,
  offCenterAim: 1.0,
  /** Vertical launch speed added per radian the racket face is opened (negative when closed). */
  faceLift: 1.4,
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
  /** Racket face angle at contact (see `paddleFace`). */
  face: PaddleFace;
  isServe: boolean;
}

/** Launch velocity change caused by the incoming ball's spin gripping the racket. */
export function spinKick(ball: BallState): Vec2 {
  // Contact point sits at +z of the ball centre; its surface velocity is spin × (0, 0, r).
  const k = HIT_TUNING.spinKick * BALL_RADIUS;
  return { x: -k * ball.spin.y, y: k * ball.spin.x };
}

export function computeReturn({ contact, swing, offset, face, isServe }: ReturnInput): BallState {
  const T = HIT_TUNING;
  const sx = clamp(swing.x, -T.maxSwing, T.maxSwing);
  const sy = clamp(swing.y, -T.maxSwing, T.maxSwing);
  const swingSpeed = Math.sqrt(sx * sx + sy * sy);
  const pos = copyVec3(contact.pos);

  // Split the paddle's motion against the racket face. The part brushing across the face drags the
  // ball's surface and spins it about the axis (face normal × brush): with a square face, brushing up is
  // topspin, down is backspin, sideways is sidespin. Turning or opening the face tilts that axis, so the
  // same brush mixes in corkscrew spin (which kicks the ball sideways off the bounce). The part driving
  // into the face adds pace instead of spin.
  const normal = faceNormal(face);
  const into = sx * normal.x + sy * normal.y; // the paddle's motion has no depth component
  const brush: Vec3 = { x: sx - into * normal.x, y: sy - into * normal.y, z: -into * normal.z };
  const axis = cross3(normal, brush);
  const spin: Vec3 = {
    x: clamp(-T.brushSpin * axis.x + contact.spin.x * T.spinReturn, -MAX_SPIN, MAX_SPIN),
    y: clamp(-T.brushSpin * axis.y + contact.spin.y * T.spinReturn, -MAX_SPIN, MAX_SPIN),
    z: clamp(-T.brushSpin * axis.z + contact.spin.z * T.spinReturn, -MAX_SPIN, MAX_SPIN),
  };

  const P = isServe ? T.servePower : T.rallyPower;
  const incoming = isServe ? 0 : length3(contact.vel) * T.rallyPower.perIncoming;
  const power = clamp(P.base + incoming + swingSpeed * P.perSwing + Math.max(0, into) * T.throughPower, P.min, P.max);
  const f = (power - P.min) / (P.max - P.min);
  // Harder shots aim deeper on the opponent's half.
  const targetZ = -HALF_LENGTH * (isServe ? 0.35 + 0.55 * f : 0.4 + 0.5 * f);
  // The ball leaves where the racket face points; the face turns with the sideways swipe (see `paddleFace`).
  const faceAimX = pos.x + Math.tan(face.yaw) * Math.abs(targetZ - pos.z);
  const targetX = clamp(faceAimX + offset.x * T.offCenterAim, -HALF_WIDTH * 0.88, HALF_WIDTH * 0.88);

  const dx = targetX - pos.x;
  const dz = targetZ - pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz) || 1;
  let vx = (dx / dist) * power;
  const vz = (dz / dist) * power;

  const aware = isServe ? T.serveSpinAwareness : T.solverSpinAwareness;
  const solverSpin = { x: spin.x * aware, y: spin.y * aware, z: spin.z * aware };
  const solveVy = (launchVx: number) =>
    isServe ? solveServeVy(pos, launchVx, vz, solverSpin, targetZ) : solveLaunchVy(pos, launchVx, vz, solverSpin, targetZ, -6, 7);
  // An open face (low ball) lifts the return, a closed face (high ball) drives it down.
  const lift = (sy * T.liftPerSwing + face.pitch * T.faceLift) * (isServe ? T.serveLiftScale : 1);
  const extraVy = lift + offset.y * T.offCenterLift;

  // Lean the launch against part of the sideways curve, so it visibly bends and lands near (not on) the aim.
  // Then solve the launch height again for the corrected direction (it changes the ball's path length).
  if (Math.abs(spin.y) > 1 || Math.abs(spin.z) > 1) {
    const roughVy = solveVy(vx) + extraVy;
    for (let i = 0; i < CURVE_CORRECTION_PASSES; i++) {
      const landing = landingPoint(pos, { x: vx, y: roughVy, z: vz }, spin, isServe);
      if (!landing) break;
      vx += ((targetX - landing.x) / landing.time) * T.curveAwareness;
    }
  }
  const vy = solveVy(vx) + extraVy;

  // What the player doesn't control: the incoming spin gripping the racket.
  const kick = spinKick(contact);
  return {
    pos,
    vel: { x: vx + kick.x, y: vy + kick.y, z: vz },
    spin,
  };
}

const CURVE_CORRECTION_PASSES = 2;

/** Where and when a shot lands on the opponent's half (serves: after their own-half bounce), ignoring the net. */
function landingPoint(pos: Vec3, vel: Vec3, spin: Vec3, isServe: boolean): { x: number; time: number } | null {
  const ball: BallState = { pos: copyVec3(pos), vel: copyVec3(vel), spin: copyVec3(spin) };
  const events: PhysicsEvent[] = [];
  let tableContacts = 0;
  for (let i = 1; i <= SOLVER_MAX_STEPS; i++) {
    events.length = 0;
    stepBall(ball, events, SOLVER_OPTIONS);
    for (const event of events) {
      if (event.type === 'floor' || event.type === 'side') return { x: ball.pos.x, time: i * DT };
      if (event.type !== 'table') continue;
      tableContacts++;
      if (!isServe || tableContacts >= 2) return { x: event.pos.x, time: i * DT };
    }
  }
  return null;
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

const SERVE_CANDIDATES = 16;
/** First-bounce candidates as a fraction of the server's half, from near the net to near the end line. */
const SERVE_FIRST_BOUNCE_RANGE: [number, number] = [0.08, 0.99];
const SERVE_VY_RANGE: [number, number] = [-5, 4];

/**
 * A serve must bounce on both halves, which is not monotonic in vy. Try first-bounce points
 * along the server's half, keep those whose follow-through clears the net, and pick the one
 * whose second bounce lands closest to the target.
 */
function solveServeVy(pos: Vec3, vx: number, vz: number, spin: Vec3, targetZ: number): number {
  // Serves are struck low (paddle height), so allow an upward launch that arcs down onto the own half.
  const [lo, hi] = SERVE_VY_RANGE;
  let bestVy = solveLaunchVy(pos, vx, vz, spin, HALF_LENGTH * 0.6, lo, hi);
  let bestError = Infinity;
  for (let i = 0; i < SERVE_CANDIDATES; i++) {
    const [near, far] = SERVE_FIRST_BOUNCE_RANGE;
    const firstBounceZ = HALF_LENGTH * (near + ((far - near) * i) / (SERVE_CANDIDATES - 1));
    const vy = solveLaunchVy(pos, vx, vz, spin, firstBounceZ, lo, hi);
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
