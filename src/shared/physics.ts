import {
  BALL_RADIUS,
  DRAG_K,
  DT,
  FLOOR_FRICTION,
  FLOOR_RESTITUTION,
  FLOOR_Y,
  GRAVITY,
  HALF_LENGTH,
  HALF_WIDTH,
  MAGNUS_K,
  MAX_SUBSTEPS,
  NET_BODY_RESTITUTION,
  NET_CORD_RADIUS,
  NET_CORD_RESTITUTION,
  NET_HALF_SPAN,
  NET_HEIGHT,
  REST_SPEED,
  SPIN_DAMPING,
  TABLE_FRICTION,
  TABLE_RESTITUTION,
  TABLE_THICKNESS,
} from './constants';
import type { PlayerIndex } from './types';
import { copyVec3, type Vec3 } from './vec';

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Angular velocity in rad/s. */
  spin: Vec3;
}

export type PhysicsEvent =
  | { type: 'table'; side: PlayerIndex; pos: Vec3; speed: number }
  | { type: 'net'; cord: boolean; pos: Vec3; speed: number }
  /** The ball struck the side of the table below the playing surface. */
  | { type: 'side'; pos: Vec3; speed: number }
  | { type: 'floor'; pos: Vec3; speed: number };

export interface StepOptions {
  /** The aim solver ignores the net so that its landing search stays monotonic. */
  net: boolean;
}

const DEFAULT_OPTIONS: StepOptions = { net: true };

export function cloneBall(ball: BallState): BallState {
  return { pos: copyVec3(ball.pos), vel: copyVec3(ball.vel), spin: copyVec3(ball.spin) };
}

export function sideOfZ(z: number): PlayerIndex {
  return z >= 0 ? 0 : 1;
}

/** Advances the ball by one fixed step (DT), appending any contacts to `events`. */
export function stepBall(ball: BallState, events?: PhysicsEvent[], options: StepOptions = DEFAULT_OPTIONS): void {
  const { vel, spin } = ball;
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  // Substep so the ball never travels more than ~3/4 of its radius per substep (no tunnelling).
  const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil((speed * DT) / (BALL_RADIUS * 0.75))));
  const h = DT / substeps;

  for (let i = 0; i < substeps; i++) {
    integrate(ball, h);
    if (options.net) collideNet(ball, events);
    collideTable(ball, events);
    collideFloor(ball, events);
  }

  spin.x *= SPIN_DAMPING;
  spin.y *= SPIN_DAMPING;
  spin.z *= SPIN_DAMPING;
}

function integrate(ball: BallState, h: number): void {
  const { pos, vel, spin } = ball;
  const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
  const drag = DRAG_K * speed;

  const ax = -drag * vel.x + MAGNUS_K * (spin.y * vel.z - spin.z * vel.y);
  const ay = -GRAVITY - drag * vel.y + MAGNUS_K * (spin.z * vel.x - spin.x * vel.z);
  const az = -drag * vel.z + MAGNUS_K * (spin.x * vel.y - spin.y * vel.x);

  vel.x += ax * h;
  vel.y += ay * h;
  vel.z += az * h;

  pos.x += vel.x * h;
  pos.y += vel.y * h;
  pos.z += vel.z * h;
}

function collideTable(ball: BallState, events: PhysicsEvent[] | undefined): void {
  const { pos, vel } = ball;
  if (Math.abs(pos.x) > HALF_WIDTH || Math.abs(pos.z) > HALF_LENGTH) return;
  if (pos.y >= BALL_RADIUS || pos.y < -TABLE_THICKNESS - BALL_RADIUS) return;

  if (vel.y < 0 && pos.y >= -BALL_RADIUS) {
    // Coming down onto the playing surface.
    pos.y = BALL_RADIUS;
    const impact = -vel.y;
    if (impact < REST_SPEED) {
      vel.y = 0;
      return;
    }
    bounceOffTable(ball, impact);
    events?.push({ type: 'table', side: sideOfZ(pos.z), pos: copyVec3(pos), speed: impact });
    return;
  }

  // Entered the table footprint below the surface: it hit the side of the table.
  const penX = HALF_WIDTH - Math.abs(pos.x);
  const penZ = HALF_LENGTH - Math.abs(pos.z);
  const impact = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (penX < penZ) {
    pos.x = Math.sign(pos.x) * (HALF_WIDTH + 0.001);
    vel.x = -vel.x * 0.3;
  } else {
    pos.z = Math.sign(pos.z) * (HALF_LENGTH + 0.001);
    vel.z = -vel.z * 0.3;
  }
  events?.push({ type: 'side', pos: copyVec3(pos), speed: impact });
}

/**
 * Impulse-based bounce: restitution on the normal axis, Coulomb friction on the contact
 * point's slip velocity, coupled into spin (hollow ball, I = 2/3·m·r²). This is what makes
 * topspin kick forward and backspin check up.
 */
function bounceOffTable(ball: BallState, impact: number): void {
  const { vel, spin } = ball;
  vel.y = impact * TABLE_RESTITUTION;

  // Velocity of the contact point (bottom of the ball) relative to the table.
  const slipX = vel.x + BALL_RADIUS * spin.z;
  const slipZ = vel.z - BALL_RADIUS * spin.x;
  const slip = Math.sqrt(slipX * slipX + slipZ * slipZ);
  if (slip < 1e-9) return;

  const normalImpulse = (1 + TABLE_RESTITUTION) * impact;
  // 2.5 = 1 (linear) + 1.5 (angular, from I = 2/3·m·r²): impulse needed to reach pure rolling.
  const frictionImpulse = Math.min(TABLE_FRICTION * normalImpulse, slip / 2.5);
  const tx = slipX / slip;
  const tz = slipZ / slip;

  vel.x -= frictionImpulse * tx;
  vel.z -= frictionImpulse * tz;
  spin.x += (1.5 * frictionImpulse * tz) / BALL_RADIUS;
  spin.z -= (1.5 * frictionImpulse * tx) / BALL_RADIUS;
}

function collideFloor(ball: BallState, events: PhysicsEvent[] | undefined): void {
  const { pos, vel, spin } = ball;
  const floorContact = FLOOR_Y + BALL_RADIUS;
  if (pos.y >= floorContact || vel.y >= 0) return;
  pos.y = floorContact;
  const impact = -vel.y;
  if (impact < REST_SPEED) {
    vel.y = 0;
    return;
  }
  vel.y = impact * FLOOR_RESTITUTION;
  vel.x *= FLOOR_FRICTION;
  vel.z *= FLOOR_FRICTION;
  spin.x *= 0.5;
  spin.y *= 0.5;
  spin.z *= 0.5;
  events?.push({ type: 'floor', pos: copyVec3(pos), speed: impact });
}

function collideNet(ball: BallState, events: PhysicsEvent[] | undefined): void {
  const { pos, vel, spin } = ball;
  const reach = BALL_RADIUS + NET_CORD_RADIUS;
  if (Math.abs(pos.z) >= reach) return;
  if (Math.abs(pos.x) > NET_HALF_SPAN || pos.y < 0 || pos.y > NET_HEIGHT + reach) return;

  if (pos.y >= NET_HEIGHT - NET_CORD_RADIUS) {
    // Net cord: a horizontal cylinder along x. Balls clipping it trickle over or drop back.
    const dy = pos.y - NET_HEIGHT;
    const dz = pos.z;
    const dist = Math.sqrt(dy * dy + dz * dz);
    if (dist >= reach) return;
    let ny = 1;
    let nz = 0;
    if (dist > 1e-9) {
      ny = dy / dist;
      nz = dz / dist;
    }
    const normalSpeed = vel.y * ny + vel.z * nz;
    if (normalSpeed < 0) {
      vel.y -= (1 + NET_CORD_RESTITUTION) * normalSpeed * ny;
      vel.z -= (1 + NET_CORD_RESTITUTION) * normalSpeed * nz;
      const tangentSpeed = -vel.y * nz + vel.z * ny;
      vel.y -= 0.25 * tangentSpeed * -nz;
      vel.z -= 0.25 * tangentSpeed * ny;
      vel.x *= 0.85;
      spin.x *= 0.6;
      spin.y *= 0.6;
      spin.z *= 0.6;
      events?.push({ type: 'net', cord: true, pos: copyVec3(pos), speed: -normalSpeed });
    }
    pos.y = NET_HEIGHT + ny * reach;
    pos.z = nz * reach;
    return;
  }

  // Net body: a vertical plane at z = 0. The ball goes dead.
  if (Math.abs(pos.z) >= BALL_RADIUS) return;
  const side = pos.z !== 0 ? Math.sign(pos.z) : -Math.sign(vel.z) || 1;
  if (vel.z * side < 0) {
    const impact = Math.abs(vel.z);
    vel.z = -vel.z * NET_BODY_RESTITUTION;
    vel.x *= 0.45;
    vel.y *= 0.45;
    spin.x *= 0.3;
    spin.y *= 0.3;
    spin.z *= 0.3;
    events?.push({ type: 'net', cord: false, pos: copyVec3(pos), speed: impact });
  }
  pos.z = side * (BALL_RADIUS + 0.0005);
}
