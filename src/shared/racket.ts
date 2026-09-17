import { ARM_ARC_DEPTH, ARM_REACH_X, ARM_REACH_Y, PADDLE_READY_HEIGHT, REACH_NEAR_Z } from './constants';
import { clamp, type Vec2, type Vec3 } from './vec';

/**
 * Racket posture rules shared by physics, rendering and the bot, in the owner's local frame
 * (own end at +z, playing towards -z).
 */

/**
 * Closest depth the paddle can reach at a given x/height: the start of the reach, bent back along an
 * arm arc when the paddle is wide of the body or far from a comfortable height.
 */
export function reachNearZ(x: number, y: number, bodyX: number): number {
  const dx = (x - bodyX) / ARM_REACH_X;
  const dy = (y - PADDLE_READY_HEIGHT) / ARM_REACH_Y;
  return REACH_NEAR_Z + ARM_ARC_DEPTH * Math.min(1, dx * dx + dy * dy);
}

export interface PaddleFace {
  /** Radians; positive turns the face towards +x (aims right). */
  yaw: number;
  /** Radians; positive opens the face (tilts it up), negative closes it. */
  pitch: number;
}

/**
 * Aim: the face turns so the ball goes where the sideways swipe points. With no swipe it plays mostly
 * straight ahead, pulled only slightly towards the middle. Expressed as a sideways shift over a typical
 * shot length: a 3 m/s swipe moves the landing point ~0.9 m, enough to go corner to corner.
 */
const AIM_SHIFT_PER_SWIPE = 0.3;
const CENTRE_PULL = 0.5;
const AIM_REFERENCE_LENGTH = 2.7;
/** Face opens on low balls and closes on high ones, around this height. */
const NEUTRAL_HEIGHT = 0.25;
const PITCH_PER_METRE = 1.0;

/** Unit normal of the racket face: the direction it plays towards (mostly -z), in the owner's local frame. */
export function faceNormal(face: PaddleFace): Vec3 {
  const cosPitch = Math.cos(face.pitch);
  return { x: Math.sin(face.yaw) * cosPitch, y: Math.sin(face.pitch), z: -Math.cos(face.yaw) * cosPitch };
}

/** How the racket face is angled, from where it is and how it is moving. */
export function paddleFace(pos: Vec3, swing: Vec2): PaddleFace {
  return {
    yaw: clamp(Math.atan((-pos.x * CENTRE_PULL + swing.x * AIM_SHIFT_PER_SWIPE) / AIM_REFERENCE_LENGTH), -0.75, 0.75),
    pitch: clamp((NEUTRAL_HEIGHT - pos.y) * PITCH_PER_METRE, -0.35, 0.3),
  };
}
