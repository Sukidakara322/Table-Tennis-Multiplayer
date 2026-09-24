import { PADDLE_HIT_RADIUS, STROKE_SWEEP } from './constants';
import { faceNormal, type PaddleFace } from './racket';
import { clamp, type Vec2, type Vec3 } from './vec';

/**
 * Where a ball meets a racket over one step, in the racket owner's local frame. The racket stands
 * where the player put it, so this is a real crossing test rather than an overlap: the ball has to
 * pass through the plane of the blade, and be inside the blade's face when it does. Both the ball and
 * the racket move in a straight line during the step, so the crossing is solved exactly — a fast ball
 * cannot slip between samples, and a racket driving through the ball meets it properly.
 */
export interface BladeContact {
  /** Fraction of the step at which the ball went through the blade's plane. */
  t: number;
  /** Where it went through, measured across the face: x across the blade, y up it. */
  offset: Vec2;
}

export function bladeContact(
  ballFrom: Vec3,
  ballTo: Vec3,
  paddleFrom: Vec3,
  paddleTo: Vec3,
  face: PaddleFace,
): BladeContact | null {
  const start = { x: ballFrom.x - paddleFrom.x, y: ballFrom.y - paddleFrom.y, z: ballFrom.z - paddleFrom.z };
  const end = { x: ballTo.x - paddleTo.x, y: ballTo.y - paddleTo.y, z: ballTo.z - paddleTo.z };

  // The face's own axes: its normal (depth through the blade), and its sideways axis.
  const normal = faceNormal(face);
  const right = { x: -normal.z, z: normal.x };
  const rightLength = Math.hypot(right.x, right.z) || 1;
  const depthOf = (d: Vec3) => d.x * normal.x + d.y * normal.y + d.z * normal.z;
  const acrossOf = (d: Vec3) => (d.x * right.x + d.z * right.z) / rightLength;

  const fromDepth = depthOf(start);
  const toDepth = depthOf(end);
  // It has to be coming at the front of the face. A ball that was already behind the blade has been
  // played (or has gone by), and must not be struck a second time from the wrong side.
  if (fromDepth < 0 || toDepth >= fromDepth) return null;

  // What a stroke covers: the blade's face across, the blade's own thickness through, and the height
  // the racket sweeps as it rises through the ball. Without the thickness the racket would be
  // infinitely thin and need timing to a few thousandths of a second; without the sweep it would be
  // beaten by the spread of heights a ball can arrive at, which no view of the table reveals.
  const scale = PADDLE_HIT_RADIUS / CONTACT_DEPTH;
  const rise = PADDLE_HIT_RADIUS / (PADDLE_HIT_RADIUS + STROKE_SWEEP);
  const a = { x: acrossOf(start), y: start.y * rise, z: fromDepth * scale };
  const b = { x: acrossOf(end), y: end.y * rise, z: toDepth * scale };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const travel = dx * dx + dy * dy + dz * dz;
  const t = travel < 1e-12 ? 0 : clamp(-(a.x * dx + a.y * dy + a.z * dz) / travel, 0, 1);
  const closest = { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
  if (closest.x * closest.x + closest.y * closest.y + closest.z * closest.z > PADDLE_HIT_RADIUS * PADDLE_HIT_RADIUS) {
    return null;
  }
  // Report where it struck the blade in real units, so an edge-of-the-sweep hit is an edge hit.
  return { t, offset: { x: closest.x, y: closest.y / rise } };
}

/** How thick the racket is for the purposes of a hit: blade, rubber and the ball's own radius. */
const CONTACT_DEPTH = 0.06;
