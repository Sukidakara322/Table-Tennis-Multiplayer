import { describe, expect, it } from 'vitest';
import { bladeContact } from './contact';
import { PADDLE_HIT_RADIUS, STROKE_SWEEP } from './constants';
import { paddleFace } from './racket';
import type { Vec3 } from './vec';

const square = { yaw: 0, pitch: 0 };
/** One physics step of a ball crossing a still racket at `paddleZ`, passing `above` the blade centre. */
function crossing(above: number, paddleZ = 1.5, step = 0.02) {
  const paddle: Vec3 = { x: 0, y: 0.17, z: paddleZ };
  const ballFrom: Vec3 = { x: 0, y: 0.17 + above, z: paddleZ - step };
  const ballTo: Vec3 = { x: 0, y: 0.17 + above, z: paddleZ + step };
  return bladeContact(ballFrom, ballTo, paddle, paddle, square);
}

describe('blade contact', () => {
  it('registers a ball passing through the middle of the blade', () => {
    const hit = crossing(0);
    expect(hit).not.toBeNull();
    expect(hit!.offset.y).toBeCloseTo(0, 6);
    expect(hit!.t).toBeCloseTo(0.5, 6);
  });

  it('registers a ball crossing near the edge of the blade, and misses wide of it', () => {
    const beside = (across: number) => {
      const paddle: Vec3 = { x: 0, y: 0.17, z: 1.5 };
      return bladeContact({ x: across, y: 0.17, z: 1.48 }, { x: across, y: 0.17, z: 1.52 }, paddle, paddle, square);
    };
    expect(beside(PADDLE_HIT_RADIUS - 0.005)).not.toBeNull();
    expect(beside(PADDLE_HIT_RADIUS + 0.005)).toBeNull();
  });

  it('reaches balls above and below the blade, because the stroke sweeps through them', () => {
    // Height is the one thing a player cannot judge from behind the table, so a stroke covers a band
    // of it rather than striking at exactly one height.
    expect(crossing(PADDLE_HIT_RADIUS + 0.05)).not.toBeNull();
    expect(crossing(-(PADDLE_HIT_RADIUS + 0.05))).not.toBeNull();
    expect(crossing(PADDLE_HIT_RADIUS + STROKE_SWEEP + 0.05)).toBeNull();
  });

  it('ignores a ball that is still well short of the racket', () => {
    const paddle: Vec3 = { x: 0, y: 0.17, z: 1.5 };
    const ballFrom: Vec3 = { x: 0, y: 0.16, z: 1.3 };
    const ballTo: Vec3 = { x: 0, y: 0.16, z: 1.35 };
    expect(bladeContact(ballFrom, ballTo, paddle, paddle, square)).toBeNull();
  });

  it('counts the racket as a solid thing, not a plane, so the stroke need not be timed to the step', () => {
    // A ball a couple of centimetres short of the blade's middle is already inside the racket.
    const paddle: Vec3 = { x: 0, y: 0.17, z: 1.5 };
    expect(bladeContact({ x: 0, y: 0.17, z: 1.45 }, { x: 0, y: 0.17, z: 1.47 }, paddle, paddle, square)).not.toBeNull();
    // Far enough in front and it is not touching it yet.
    expect(bladeContact({ x: 0, y: 0.17, z: 1.37 }, { x: 0, y: 0.17, z: 1.39 }, paddle, paddle, square)).toBeNull();
  });

  it('meets a ball the racket is driving forward into', () => {
    // Ball coming towards the player, racket driving the other way: they close and must meet.
    const ballFrom: Vec3 = { x: 0, y: 0.2, z: 1.40 };
    const ballTo: Vec3 = { x: 0, y: 0.2, z: 1.42 };
    const paddleFrom: Vec3 = { x: 0, y: 0.2, z: 1.45 };
    const paddleTo: Vec3 = { x: 0, y: 0.2, z: 1.41 };
    expect(bladeContact(ballFrom, ballTo, paddleFrom, paddleTo, square)).not.toBeNull();
  });

  it('registers the ball that was slipping past the blade in play', () => {
    // Taken from a rally: the ball passed 1.6 cm below the blade centre and 9 mm short of its plane,
    // then crossed on the following step. Both steps must be accounted for, or the shot is missed.
    const face = paddleFace({ x: 0, y: 0.2, z: 1.6 }, { x: 0, y: 1 });
    const paddle: Vec3 = { x: 0, y: 0.2, z: 1.6 };
    const approach = bladeContact(
      { x: 0, y: 0.184, z: 1.574 },
      { x: 0, y: 0.184, z: 1.591 },
      paddle,
      paddle,
      face,
    );
    expect(approach).not.toBeNull(); // 9 mm short of the middle is already on the racket
    expect(Math.hypot(approach!.offset.x, approach!.offset.y)).toBeLessThan(PADDLE_HIT_RADIUS);
  });

  it('does not fire twice for a ball already behind the blade', () => {
    const paddle: Vec3 = { x: 0, y: 0.17, z: 1.5 };
    expect(bladeContact({ x: 0, y: 0.17, z: 1.55 }, { x: 0, y: 0.17, z: 1.6 }, paddle, paddle, square)).toBeNull();
  });
});
