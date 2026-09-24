import { PADDLE_HOVER_Y } from './constants';
import { clamp, type Vec2, type Vec3 } from './vec';

/**
 * Racket posture rules shared by physics, rendering and the bot, in the owner's local frame
 * (own end at +z, playing towards -z).
 */

export interface PaddleFace {
  /** Radians; positive turns the face towards +x (aims right). */
  yaw: number;
  /** Radians; positive opens the face (tilts it up), negative closes it. */
  pitch: number;
}

/**
 * Aim: the face turns so the ball goes where the sideways swipe points. With no swipe it plays mostly
 * straight ahead, pulled only slightly towards the middle — pulled hard and a ball struck out wide
 * would cross to the far corner on its own, with the player having asked for nothing. Expressed as a
 * sideways shift over a typical shot length: a 3 m/s swipe moves the landing point ~0.9 m, enough to
 * go corner to corner. (How the racket is *carried* out wide is a separate, visual matter: see
 * GRIP_LEAN_OUT_WIDE in the renderer.)
 */
const AIM_SHIFT_PER_SWIPE = 0.45;
const CENTRE_PULL = 0.5;
const AIM_REFERENCE_LENGTH = 2.7;
/**
 * How high the racket is held sets the face angle, as it does in a real stroke: held low the face is
 * open, to lift a low ball over the net; held high it is closed, to drive a high one down. Since the
 * height is straight off the mouse, where you hold the racket on its plane is the angle you play with,
 * and the middle of that plane — where the racket starts every point — is square.
 */
const NEUTRAL_HEIGHT = PADDLE_HOVER_Y;
const PITCH_PER_METRE = 0.8;

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
