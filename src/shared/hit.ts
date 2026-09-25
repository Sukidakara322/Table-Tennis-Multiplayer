import { BALL_RADIUS, BALL_SLOWDOWN, DT, HALF_LENGTH, HALF_WIDTH, MAX_SPIN, STAND_Z } from './constants';
import { stepBall, type BallState, type PhysicsEvent, type StepOptions } from './physics';
import { faceNormal, type PaddleFace } from './racket';
import { clamp, copyVec3, cross3, length3, lerp, type Vec2, type Vec3 } from './vec';

/**
 * Launch speeds are written at the pace they would have under real gravity, then scaled to the game's
 * slower ball. Paddle speeds come from the player's hand and are never scaled, so anything converting
 * hand motion into ball motion (pace, lift, spin kick) is quoted this way too.
 */
const slow = (realPace: number) => realPace / BALL_SLOWDOWN;

/**
 * Racket contact model. All functions work in the hitter's local frame:
 * the hitter stands at +z and plays the ball towards -z.
 *
 * The return is "assisted physical": a solver picks the launch angle that would land the ball
 * on a target, then the parts the player controls push it off that ideal line — incoming spin
 * kicks, the lift and spin from the swing, and hitting off the sweet spot.
 */
export const HIT_TUNING = {
  /**
   * Racket speeds above this count no further (m/s). A cap is what keeps a violent flick of the mouse
   * from loading the ball with spin no stroke could produce and bending it clean off the table.
   */
  maxSwing: 5,
  /** A serve only connects when the paddle moves at least this fast. */
  serveMinSwing: 0.6,
  /**
   * Swing speed at which a return is fully "played", i.e. aimed onto the table by the solver. Move the
   * racket slower than this and that help fades out, until a racket that is standing still does no
   * more than a real one would: the ball rebounds off the rubber wherever the angle sends it. Holding
   * the racket in the ball's path must never be worth a free, perfectly placed return.
   * Set against the plane the racket is held on: about a fifth of its height crossed in a tenth of a
   * second, so an ordinary stroke clears it and standing the racket in the way does not.
   */
  rallyMinSwing: 1.1,
  /** Pace a ball keeps when it rebounds off a racket that was not being swung. */
  blockRestitution: 0.8,
  /** How much pace a backwards cut carries, against the same speed driven forwards. */
  cutPace: 0.5,
  /**
   * Speeds are deliberately gentle: a rally ball crosses the table in about three quarters of a second,
   * which leaves time to read the spin, shape a stroke and watch the ball bend.
   */
  // The floor here is what it takes for a serve to still be moving when it gets to the receiver. A
  // serve spends half its pace on its own half before it even crosses, and a cut serve loses more
  // again off that bounce, so the softest legal serve is still struck firmly: the alternative is a
  // backspin serve that dies in the middle of the table, which nobody standing still can answer.
  // The floor is what it takes for a serve to still be moving when it reaches the receiver — it spends
  // half its pace on its own half before it even crosses — and the ceiling is what the table can hold:
  // past this there is no launch that fits two bounces into the length of it, whatever it is aimed at.
  servePower: { base: slow(6.2), perSwing: slow(0.4), min: slow(6.2), max: slow(7.2) },
  /**
   * A serve carries less spin than a full stroke, because it is a flick of the wrist at a ball resting
   * against the bat rather than a swing through a moving one. It also has to be: a serve has to come
   * down twice inside the length of the table, and past about this much spin there is no launch angle
   * that fits both bounces in — the ball either dips into the net or floats off the end, whatever it
   * is aimed at. A serve you cannot physically make is a fault the server never had a say in.
   */
  serveSpinScale: 0.55,
  // The floor is what it takes to carry the ball over the net and onto the far half at all: a push or
  // a block is slow, but it still crosses. Below this a stroke would simply drop on your own side.
  rallyPower: { base: slow(2.2), perIncoming: 0.25, perSwing: slow(0.9), min: slow(4.6), max: slow(9) },
  /** rad/s of spin per m/s of paddle motion brushing across the racket face (any direction). */
  brushSpin: 60,
  /** Extra launch speed per m/s of paddle motion driving into the face instead of across it. */
  throughPower: slow(0.4),
  /**
   * Fraction of its own sideways curve the aim corrects for. Well under all of it: the bend is clearly
   * visible and a heavy curve still carries the ball wide of where it was aimed. A serve is a set piece
   * struck from a standing ball, so the server is credited with knowing where their own spin takes it.
   */
  curveAwareness: 0.6,
  serveCurveAwareness: 0.75,
  /** Fraction of incoming spin carried into the return (the rubber reverses it). */
  spinReturn: -0.35,
  /**
   * How strongly incoming spin deflects the ball off the racket — the thing a player has to read and
   * answer. It is set against what they can answer it *with*: a stroke is worth liftPerSwing per m/s
   * and the face angle another tenth or so, so a heavy ball now costs about a metre per second of
   * deliberate stroke to hold down. At three times this it cost more stroke than anyone has, and
   * reading the spin correctly still lost the point — which is not difficulty, it is a coin toss.
   */
  spinKick: slow(0.065),
  /** Vertical launch speed added per m/s of upward swing: the player's side of that same bargain. */
  liftPerSwing: slow(0.35),
  /** Serves fly exactly as solved (their net clearance is checked); swing and face shape them through spin. */
  serveLiftScale: 0,
  /** Launch errors per metre of distance from the racket centre. */
  offCenterLift: slow(2.0),
  offCenterAim: 1.0,
  /** Vertical launch speed added per radian the racket face is opened (negative when closed). */
  faceLift: slow(1.4),
  /** How much of its own spin the aim solver compensates for; the rest is player skill. */
  solverSpinAwareness: 0.9,
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
  const brushSpin = isServe ? T.brushSpin * T.serveSpinScale : T.brushSpin;
  const spin: Vec3 = {
    x: clamp(-brushSpin * axis.x + contact.spin.x * T.spinReturn, -MAX_SPIN, MAX_SPIN),
    y: clamp(-brushSpin * axis.y + contact.spin.y * T.spinReturn, -MAX_SPIN, MAX_SPIN),
    z: clamp(-brushSpin * axis.z + contact.spin.z * T.spinReturn, -MAX_SPIN, MAX_SPIN),
  };

  const P = isServe ? T.servePower : T.rallyPower;
  const incoming = isServe ? 0 : length3(contact.vel) * T.rallyPower.perIncoming;
  // Driving towards the opponent is what puts pace on the ball. Cutting backwards under it still
  // carries it — that is a push, not a dead bat — but at a fraction of the pace, so backspin is the
  // slow, floating shot and only a forward stroke can be hit hard.
  const drive = sy > 0 ? sy : -sy * T.cutPace;
  const power = clamp(P.base + incoming + drive * P.perSwing + Math.max(0, into) * T.throughPower, P.min, P.max);
  const f = (power - P.min) / (P.max - P.min);
  // Harder shots aim deeper on the opponent's half. Everything is aimed past the middle of it, because
  // the receiver stands at a fixed depth and cannot come forward: a ball that lands short and dies in
  // front of them is unanswerable, so it is not a ball anyone gets to hit. That bites hardest on the
  // serve, which has already spent half its pace on its own half before it crosses, so a serve is
  // aimed deeper still — it has the least left with which to carry the rest of the way.
  const targetZ = -HALF_LENGTH * (isServe ? 0.68 + 0.26 * f : 0.52 + 0.33 * f);
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
    isServe
      ? solveServeVy(pos, launchVx, vz, solverSpin, targetZ)
      : solveLaunchVy(pos, launchVx, vz, solverSpin, targetZ, slow(-6), slow(7), true);
  // Cutting backwards gets under the ball and floats it up, the way a push clears the net. Driving
  // forwards adds nothing upwards: its pace and its topspin are already accounted for, and the dip
  // that brings it down is the spin's doing, not the stroke's. An open face (low blade) lifts too, a
  // closed one (high blade) presses the ball down.
  const cut = sy < 0 ? -sy : 0;
  const lift = (cut * T.liftPerSwing + face.pitch * T.faceLift) * (isServe ? T.serveLiftScale : 1);
  const extraVy = lift + offset.y * T.offCenterLift;

  // Lean the launch against part of the sideways curve, so it visibly bends and lands near (not on) the aim.
  // Then solve the launch height again for the corrected direction (it changes the ball's path length).
  if (Math.abs(spin.y) > 1 || Math.abs(spin.z) > 1) {
    const roughVy = solveVy(vx) + extraVy;
    for (let i = 0; i < CURVE_CORRECTION_PASSES; i++) {
      const landing = landingPoint(pos, { x: vx, y: roughVy, z: vz }, spin, isServe);
      if (!landing) break;
      vx += ((targetX - landing.x) / landing.time) * (isServe ? T.serveCurveAwareness : T.curveAwareness);
    }
  }
  const vy = solveVy(vx) + extraVy;

  // What the player doesn't control: the incoming spin gripping the racket.
  const kick = spinKick(contact);
  // How much of a stroke this was. A serve is always struck (its own minimum swing gates it), but in a
  // rally the solver's aim is earned by swinging: below rallyMinSwing it fades into a bare rebound.
  const played = isServe ? 1 : clamp(swingSpeed / T.rallyMinSwing, 0, 1);
  const rebound = reboundVelocity(contact.vel, normal, T.blockRestitution);
  return {
    pos,
    vel: {
      x: lerp(rebound.x, vx + kick.x, played),
      y: lerp(rebound.y, vy + kick.y, played),
      z: lerp(rebound.z, vz, played),
    },
    spin,
  };
}

/** Plain reflection off the racket face, which is all an unswung racket does to the ball. */
function reboundVelocity(vel: Vec3, normal: Vec3, restitution: number): Vec3 {
  const into = vel.x * normal.x + vel.y * normal.y + vel.z * normal.z;
  const bounce = (1 + restitution) * into;
  return {
    x: vel.x - bounce * normal.x,
    y: vel.y - bounce * normal.y,
    z: vel.z - bounce * normal.z,
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

/**
 * z of the ball's first contact with the table (or where it reaches the floor). With `overNet`, the
 * net is in the way and a shot that hits it counts as falling short — which is what it is. The aim
 * has to be solved this way or it will happily pick a line straight through the net, and a cut, whose
 * float it answers by aiming lower still, would never once get over.
 */
function firstContactZ(pos: Vec3, vx: number, vy: number, vz: number, spin: Vec3, overNet = false): number {
  const ball: BallState = { pos: copyVec3(pos), vel: { x: vx, y: vy, z: vz }, spin: copyVec3(spin) };
  const events: PhysicsEvent[] = [];
  for (let i = 0; i < SOLVER_MAX_STEPS; i++) {
    stepBall(ball, events, overNet ? undefined : SOLVER_OPTIONS);
    for (const event of events) {
      if (event.type === 'net') return SHORT_OF_THE_NET;
      if (event.type === 'table') return event.pos.z;
      if (event.type === 'floor' || event.type === 'side') return ball.pos.z;
    }
    events.length = 0;
  }
  return ball.pos.z;
}

/** Stands for "nowhere near": far enough back that the solver reads a netted shot as short. */
const SHORT_OF_THE_NET = HALF_LENGTH * 4;

const SERVE_CANDIDATES = 16;
/**
 * Where the serve's own-half bounce is allowed to be: from just past the net up to just short of the
 * ball itself. The far end has to be measured from the ball rather than from the end line, because the
 * ball is struck out over the table — candidates behind it would ask the solver to land the serve
 * where it started, and every one of them wasted is a first bounce the serve cannot be aimed at.
 */
const SERVE_FIRST_BOUNCE_NEAR_NET = HALF_LENGTH * 0.08;
const SERVE_FIRST_BOUNCE_BACK_OFF = 0.1;
/**
 * How steeply a serve may be launched. The downward end has to be generous: the ball is struck out
 * over the table, so a serve from up at head-of-the-plane height has barely a metre of its own half in
 * front of it, and the only way to put the first bounce where it belongs — the middle of that half,
 * far enough from the net to come up over it and far enough from the end line to have somewhere to
 * come down — is to drive it down sharply. Cap this too low and those serves have nowhere legal to go.
 */
const SERVE_VY_RANGE: [number, number] = [slow(-9), slow(4)];

/**
 * A serve must bounce on both halves, which is not monotonic in vy. Try first-bounce points along the
 * server's half and keep the ones that come out legal. A serve that carries on to the receiver beats
 * one that lands nearer the target and dies in front of them, whatever the swing asked for: the whole
 * point of aiming a serve is that someone has to play it.
 */
function solveServeVy(pos: Vec3, vx: number, vz: number, spin: Vec3, targetZ: number): number {
  // Serves are struck low (paddle height), so allow an upward launch that arcs down onto the own half.
  const [lo, hi] = SERVE_VY_RANGE;
  let bestVy = solveLaunchVy(pos, vx, vz, spin, HALF_LENGTH * 0.6, lo, hi);
  let bestError = Infinity;
  let bestCarries = false;
  // When a swing is too weak or too heavily loaded to serve legally at all, fall back to the launch
  // that at least carries furthest rather than one that was never simulated: the serve still fails,
  // but it fails the way that swing deserves instead of dumping into the net from a knife edge.
  let bestReach = Infinity;
  const near = SERVE_FIRST_BOUNCE_NEAR_NET;
  const far = Math.max(near, Math.min(HALF_LENGTH, pos.z) - SERVE_FIRST_BOUNCE_BACK_OFF);
  for (let i = 0; i < SERVE_CANDIDATES; i++) {
    const firstBounceZ = near + ((far - near) * i) / (SERVE_CANDIDATES - 1);
    const vy = solveLaunchVy(pos, vx, vz, spin, firstBounceZ, lo, hi);
    const { secondZ, reach, carries } = serveOutcome(pos, vx, vy, vz, spin);
    if (secondZ === null) {
      if (bestError === Infinity && reach < bestReach) {
        bestReach = reach;
        bestVy = vy;
      }
      continue;
    }
    if (bestCarries && !carries) continue;
    const error = Math.abs(secondZ - targetZ);
    if ((carries && !bestCarries) || error < bestError) {
      bestCarries = carries;
      bestError = error;
      bestVy = vy;
    }
  }
  return bestVy;
}

/**
 * How a candidate serve turns out: where it lands on the receiver's half, how far it got, and whether
 * it then carries on to where the receiver is actually standing. The last of those is not a nicety —
 * the receiver holds their racket on a fixed plane and cannot come forward to dig out a serve that
 * drops dead in the middle of the table, so a serve that stops short is a point won off someone who
 * was never given a stroke to play.
 */
function serveOutcome(
  pos: Vec3,
  vx: number,
  vy: number,
  vz: number,
  spin: Vec3,
): { secondZ: number | null; reach: number; carries: boolean } {
  const ball: BallState = { pos: copyVec3(pos), vel: { x: vx, y: vy, z: vz }, spin: copyVec3(spin) };
  const events: PhysicsEvent[] = [];
  let ownBounce = false;
  let secondZ: number | null = null;
  let reach = pos.z;
  for (let i = 0; i < SOLVER_MAX_STEPS; i++) {
    stepBall(ball, events);
    reach = Math.min(reach, ball.pos.z);
    if (secondZ !== null && ball.pos.z <= -STAND_Z) return { secondZ, reach, carries: true };
    for (const event of events) {
      if (event.type === 'net' || event.type === 'floor' || event.type === 'side') {
        return { secondZ, reach, carries: false };
      }
      if (event.type !== 'table') continue;
      if (!ownBounce && event.side === 0) {
        ownBounce = true;
      } else if (secondZ === null) {
        if (event.side !== 1 || !ownBounce) return { secondZ: null, reach, carries: false };
        secondZ = event.pos.z;
      } else {
        // Bounced twice on the receiver's half without ever reaching them: it died short.
        return { secondZ, reach, carries: false };
      }
    }
    events.length = 0;
  }
  return { secondZ, reach, carries: false };
}

/** Bisection on vertical launch speed: more vy carries the ball further towards -z. */
function solveLaunchVy(
  pos: Vec3,
  vx: number,
  vz: number,
  spin: Vec3,
  targetZ: number,
  lo: number,
  hi: number,
  overNet = false,
): number {
  const landsAt = (vy: number) => firstContactZ(pos, vx, vy, vz, spin, overNet);
  if (landsAt(lo) <= targetZ) return lo;
  if (landsAt(hi) >= targetZ) return hi;
  for (let i = 0; i < SOLVER_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (landsAt(mid) > targetZ) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
