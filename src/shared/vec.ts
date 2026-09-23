export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function copyVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Two points moving in straight lines over one step: given the gap between them at the start and at the
 * end, the fraction of the step (0..1) where that gap is smallest. Used for contact, so a fast ball and a
 * fast paddle can't pass through each other between samples.
 */
export function closestApproach(start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const drift = dx * dx + dy * dy;
  if (drift < 1e-12) return 1;
  return clamp(-(start.x * dx + start.y * dy) / drift, 0, 1);
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function length3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Moves `current` towards `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
