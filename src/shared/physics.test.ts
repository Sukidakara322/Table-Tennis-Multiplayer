import { describe, expect, it } from 'vitest';
import {
  ARM_ARC_DEPTH,
  BALL_RADIUS,
  DT,
  HALF_LENGTH,
  NET_HEIGHT,
  PADDLE_READY_HEIGHT,
  REACH_FAR_Z,
  REACH_NEAR_Z,
  SERVE_BALL_HEIGHT,
  SERVE_BALL_Z,
} from './constants';
import { toLocalBall } from './frames';
import { computeReturn } from './hit';
import { stepBall, type BallState, type PhysicsEvent } from './physics';
import { predictMeetPoint } from './predict';
import { paddleFace, reachNearZ } from './racket';
import { closestApproach } from './vec';

function ball(pos: [number, number, number], vel: [number, number, number], spin: [number, number, number] = [0, 0, 0]): BallState {
  return {
    pos: { x: pos[0], y: pos[1], z: pos[2] },
    vel: { x: vel[0], y: vel[1], z: vel[2] },
    spin: { x: spin[0], y: spin[1], z: spin[2] },
  };
}

/** Runs until `stop` returns true or `seconds` elapse; returns all events. */
function simulate(b: BallState, seconds: number, stop?: (events: PhysicsEvent[]) => boolean): PhysicsEvent[] {
  const all: PhysicsEvent[] = [];
  const events: PhysicsEvent[] = [];
  for (let i = 0; i < seconds / DT; i++) {
    events.length = 0;
    stepBall(b, events);
    all.push(...events);
    if (stop?.(all)) break;
  }
  return all;
}

const tableBounces = (events: PhysicsEvent[]) => events.filter((e) => e.type === 'table');

describe('ball physics', () => {
  it('bounces off the table with ~0.9 restitution', () => {
    const b = ball([0, 0.3, 0.5], [0, 0, 0]);
    simulate(b, 0.5, (e) => tableBounces(e).length > 0);
    let peak = 0;
    for (let i = 0; i < 0.5 / DT; i++) {
      stepBall(b);
      peak = Math.max(peak, b.pos.y);
    }
    const expected = (0.3 - BALL_RADIUS) * 0.81 + BALL_RADIUS;
    expect(peak).toBeGreaterThan(expected * 0.85);
    expect(peak).toBeLessThan(expected * 1.01);
  });

  it('topspin keeps more pace off the bounce than backspin', () => {
    const top = ball([0, 0.2, 0.3], [0, -2, -6], [-300, 0, 0]);
    const back = ball([0, 0.2, 0.3], [0, -2, -6], [300, 0, 0]);
    simulate(top, 1, (e) => tableBounces(e).length > 0);
    simulate(back, 1, (e) => tableBounces(e).length > 0);
    expect(-top.vel.z).toBeGreaterThan(-back.vel.z + 1);
  });

  it('topspin dips and backspin floats', () => {
    const top = ball([0, 0.3, 1.5], [0, 1, -8], [-300, 0, 0]);
    const back = ball([0, 0.3, 1.5], [0, 1, -8], [300, 0, 0]);
    for (let i = 0; i < 40; i++) {
      stepBall(top);
      stepBall(back);
    }
    expect(back.pos.y).toBeGreaterThan(top.pos.y + 0.05);
  });

  it('stops a low ball in the net', () => {
    const b = ball([0, 0.08, 0.5], [0, 0, -6]);
    const events = simulate(b, 1);
    expect(events.some((e) => e.type === 'net')).toBe(true);
    expect(b.pos.z).toBeGreaterThan(0);
  });

  it('lets a high ball fly over the net', () => {
    const b = ball([0, NET_HEIGHT + 0.1, 0.5], [0, 0.5, -6]);
    const events = simulate(b, 0.3);
    expect(events.some((e) => e.type === 'net')).toBe(false);
    expect(b.pos.z).toBeLessThan(0);
  });

  it('is identical in both players’ frames', () => {
    const world = ball([0.3, 0.25, -1.2], [-1, 1.5, 7], [120, 40, -30]);
    const local = toLocalBall(1, world);
    simulate(world, 1);
    simulate(local, 1);
    const back = toLocalBall(1, local);
    expect(back.pos.x).toBeCloseTo(world.pos.x, 9);
    expect(back.pos.y).toBeCloseTo(world.pos.y, 9);
    expect(back.pos.z).toBeCloseTo(world.pos.z, 9);
  });
});

describe('contact sweep', () => {
  it('finds the moment the gap is smallest, even when it is mid-step', () => {
    // Ball and paddle pass each other: 10 cm apart one way at the start, 10 cm the other way at the end.
    expect(closestApproach({ x: -0.1, y: 0 }, { x: 0.1, y: 0 })).toBeCloseTo(0.5, 9);
    // Closing in: closest at the end of the step.
    expect(closestApproach({ x: 0.3, y: 0 }, { x: 0.05, y: 0 })).toBeCloseTo(1, 9);
    // Moving apart: closest at the start.
    expect(closestApproach({ x: 0.05, y: 0 }, { x: 0.3, y: 0 })).toBeCloseTo(0, 9);
    // Crossing diagonally still lands between the samples.
    const t = closestApproach({ x: -0.2, y: 0.12 }, { x: 0.2, y: -0.12 });
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(0.6);
  });

  it('would have been missed by sampling only the ends of the step', () => {
    // A 17 m/s ball and a 9 m/s swing: 7 cm apart at both ends, but they touch in between.
    const start = { x: -0.07, y: 0.02 };
    const end = { x: 0.07, y: -0.02 };
    const gapAt = (t: number) => Math.hypot(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
    expect(Math.min(gapAt(0), gapAt(1))).toBeGreaterThan(0.07);
    expect(gapAt(closestApproach(start, end))).toBeLessThan(0.03);
  });
});

describe('racket posture', () => {
  it('bends the reach back along the arm arc away from the body', () => {
    expect(reachNearZ(0, PADDLE_READY_HEIGHT, 0)).toBeCloseTo(REACH_NEAR_Z, 6);
    expect(reachNearZ(1.2, PADDLE_READY_HEIGHT, 0)).toBeCloseTo(REACH_NEAR_Z + ARM_ARC_DEPTH, 6);
    expect(reachNearZ(1.2, PADDLE_READY_HEIGHT, 1.2)).toBeCloseTo(REACH_NEAR_Z, 6);
    expect(reachNearZ(0, 0.55, 0)).toBeGreaterThan(REACH_NEAR_Z);
  });

  it('turns the face towards the centre and opens it on low balls', () => {
    const still = { x: 0, y: 0 };
    expect(paddleFace({ x: 0.8, y: 0.3, z: 1.5 }, still).yaw).toBeLessThan(0);
    expect(paddleFace({ x: -0.8, y: 0.3, z: 1.5 }, still).yaw).toBeGreaterThan(0);
    expect(paddleFace({ x: 0, y: 0.02, z: 1.5 }, still).pitch).toBeGreaterThan(0);
    expect(paddleFace({ x: 0, y: 0.55, z: 1.5 }, still).pitch).toBeLessThan(0);
  });

  function landingX(contactPos: [number, number, number], vel: [number, number, number], swing: { x: number; y: number }, isServe: boolean) {
    const contact = ball(contactPos, vel);
    const out = computeReturn({ contact, swing, offset: { x: 0, y: 0 }, face: paddleFace(contact.pos, swing), isServe });
    const wanted = isServe ? 2 : 1;
    const events = simulate(out, 3, (e) => tableBounces(e).length >= wanted || e.some((x) => x.type === 'floor' || x.type === 'net'));
    const landing = tableBounces(events)[wanted - 1];
    return landing?.side === 1 ? landing.pos.x : null;
  }

  it('lets a swipe change corners: from the left corner to the right and back', () => {
    // Rally shot from the left corner (x -0.7): no swipe stays left, a swipe right goes to the right half.
    const straight = landingX([-0.7, 0.3, 1.6], [0, 0.4, 6], { x: 0, y: 1 }, false);
    const cross = landingX([-0.7, 0.3, 1.6], [0, 0.4, 6], { x: 3, y: 1 }, false);
    expect(straight).not.toBeNull();
    expect(straight!).toBeLessThan(0);
    expect(cross).not.toBeNull();
    expect(cross!).toBeGreaterThan(0.25);

    // Mirror image from the right corner.
    const crossBack = landingX([0.7, 0.3, 1.6], [0, 0.4, 6], { x: -3, y: 1 }, false);
    expect(crossBack).not.toBeNull();
    expect(crossBack!).toBeLessThan(-0.25);
  });

  it('derives spin from brushing across the face, including corkscrew from angled faces', () => {
    const contact = ball([0, 0.25, 1.6], [0, 0.4, 6]);
    const spinOf = (swing: { x: number; y: number }, face: { yaw: number; pitch: number }) =>
      computeReturn({ contact, swing, offset: { x: 0, y: 0 }, face, isServe: false }).spin;
    const square = { yaw: 0, pitch: 0 };
    expect(spinOf({ x: 0, y: 3 }, square).x).toBeLessThan(-150); // brush up: topspin
    expect(spinOf({ x: 0, y: -3 }, square).x).toBeGreaterThan(150); // chop: backspin
    expect(spinOf({ x: 3, y: 0 }, square).y).toBeGreaterThan(150); // sideways: sidespin
    expect(Math.abs(spinOf({ x: 0, y: 3 }, square).z)).toBeLessThan(1); // square face: no corkscrew
    expect(Math.abs(spinOf({ x: 0, y: 3 }, { yaw: 0.5, pitch: 0 }).z)).toBeGreaterThan(50); // turned face: corkscrew
    expect(Math.abs(spinOf({ x: 3, y: 0 }, { yaw: 0, pitch: 0.3 }).z)).toBeGreaterThan(40); // open face: corkscrew
    // Swiping in the direction the face is turned drives through the ball: less sidespin than a square brush.
    expect(Math.abs(spinOf({ x: 3, y: 0 }, { yaw: 0.6, pitch: 0 }).y)).toBeLessThan(Math.abs(spinOf({ x: 3, y: 0 }, square).y));
  });

  it('bends a sidespin shot visibly in flight and still lands on the table', () => {
    const contact = ball([0, 0.3, 1.6], [0, 0.4, 6]);
    const swing = { x: 3, y: 1 };
    const out = computeReturn({ contact, swing, offset: { x: 0, y: 0 }, face: paddleFace(contact.pos, swing), isServe: false });
    const start = { ...out.pos };
    const path: Array<{ x: number; z: number }> = [];
    const events = simulate(out, 2, (e) => {
      path.push({ x: out.pos.x, z: out.pos.z });
      return tableBounces(e).length > 0 || e.some((x) => x.type === 'floor');
    });
    const landing = tableBounces(events)[0];
    expect(landing?.side).toBe(1);
    // Largest sideways distance between the flight and the straight line from contact to landing.
    const end = landing!.pos;
    const bend = Math.max(...path.map((p) => Math.abs(p.x - (start.x + ((end.x - start.x) * (p.z - start.z)) / (end.z - start.z)))));
    expect(bend).toBeGreaterThan(0.08);
  });

  it('kicks a corkscrew-spinning ball sideways off the bounce', () => {
    const plain = ball([0, 0.2, 0.5], [0, -2, -5]);
    const corkscrew = ball([0, 0.2, 0.5], [0, -2, -5], [0, 0, 250]);
    simulate(plain, 1, (e) => tableBounces(e).length > 0);
    simulate(corkscrew, 1, (e) => tableBounces(e).length > 0);
    expect(Math.abs(corkscrew.vel.x - plain.vel.x)).toBeGreaterThan(1);
  });

  it('lets a serve from the left corner go to the right corner', () => {
    const serve = landingX([-0.6, SERVE_BALL_HEIGHT, SERVE_BALL_Z], [0, 0, 0], { x: 3, y: 1.5 }, true);
    expect(serve).not.toBeNull();
    expect(serve!).toBeGreaterThan(0.2);
  });

  it('sends a return from the forehand side back towards the middle', () => {
    const contact = ball([0.8, 0.3, 1.6], [0, 0.4, 6]);
    const swing = { x: 0, y: 1 };
    const out = computeReturn({ contact, swing, offset: { x: 0, y: 0 }, face: paddleFace(contact.pos, swing), isServe: false });
    const events = simulate(out, 2, (e) => tableBounces(e).length > 0 || e.some((x) => x.type === 'floor'));
    const landing = tableBounces(events)[0];
    expect(landing?.side).toBe(1);
    expect(landing!.pos.x).toBeLessThan(0.8);
  });
});

describe('racket returns', () => {
  const incoming = ball([0.1, 0.3, 1.6], [0, 0.4, 6]);

  it('a flat swing lands on the opponent half', () => {
    const swing = { x: 0, y: 1 };
    const out = computeReturn({ contact: incoming, swing, offset: { x: 0, y: 0 }, face: paddleFace(incoming.pos, swing), isServe: false });
    const events = simulate(out, 2, (e) => tableBounces(e).length > 0 || e.some((x) => x.type === 'floor'));
    const first = tableBounces(events)[0];
    expect(first?.side).toBe(1);
    expect(first?.pos.z).toBeGreaterThan(-HALF_LENGTH);
  });

  it('serves bounce on both halves across a range of swings', () => {
    const results: string[] = [];
    let good = 0;
    const swings = [
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: -2 },
      { x: 2, y: 3 },
      { x: 0, y: 5 },
      { x: -3, y: -3 },
    ];
    // The ball waits at serve height and is struck by a paddle sweeping up or down through it.
    const contacts: Array<[number, number]> = [
      [SERVE_BALL_HEIGHT, 0],
      [SERVE_BALL_HEIGHT - 0.08, 0],
    ];
    for (const [height, fallSpeed] of contacts) {
      for (const swing of swings) {
        const contact = ball([0, height, SERVE_BALL_Z], [0, fallSpeed, 0]);
        const out = computeReturn({ contact, swing, offset: { x: 0, y: 0 }, face: paddleFace(contact.pos, swing), isServe: true });
        const events = simulate(out, 3, (e) => tableBounces(e).length >= 2 || e.some((x) => x.type === 'floor' || x.type === 'net'));
        const sides = tableBounces(events).map((e) => `${e.side}@${e.pos.z.toFixed(2)}`);
        const net = events.some((e) => e.type === 'net');
        results.push(`y=${height.toFixed(2)} swing ${swing.x},${swing.y} → ${sides.join(' ')}${net ? ' NET' : ''}`);
        const bounces = tableBounces(events);
        if (bounces[0]?.side === 0 && bounces[1]?.side === 1) good++;
      }
    }
    console.log(results.join('\n'));
    expect(good).toBeGreaterThanOrEqual(10);
  });

  it('predicts where the receiver meets the ball', () => {
    const swing = { x: 0, y: 2 };
    const out = computeReturn({ contact: incoming, swing, offset: { x: 0, y: 0 }, face: paddleFace(incoming.pos, swing), isServe: false });
    const meet = predictMeetPoint(toLocalBall(1, out));
    expect(meet).not.toBeNull();
    expect(meet!.pos.z).toBeGreaterThanOrEqual(REACH_NEAR_Z);
    expect(meet!.pos.z).toBeLessThanOrEqual(REACH_FAR_Z);

    // Re-predicting just after the bounce on the receiver's half must give the same meeting point.
    const local = toLocalBall(1, out);
    const events: PhysicsEvent[] = [];
    while (!events.some((e) => e.type === 'table' && e.side === 0)) stepBall(local, events);
    const again = predictMeetPoint(local, true);
    expect(again).not.toBeNull();
    expect(again!.pos.z).toBeCloseTo(meet!.pos.z, 1);
  });

  it('logs spin interplay for tuning', () => {
    const lines: string[] = [];
    const cases: Array<[string, BallState, { x: number; y: number }]> = [
      ['block vs topspin', ball([0, 0.25, 1.6], [0, 0.5, 8], [300, 0, 0]), { x: 0, y: 0 }],
      ['block vs backspin', ball([0, 0.2, 1.6], [0, 0.5, 5], [-300, 0, 0]), { x: 0, y: 0 }],
      ['brush up vs backspin', ball([0, 0.2, 1.6], [0, 0.5, 5], [-300, 0, 0]), { x: 0, y: 4 }],
      ['chop vs topspin', ball([0, 0.25, 1.6], [0, 0.5, 8], [300, 0, 0]), { x: 0, y: -3 }],
      ['big drive', ball([0, 0.3, 1.6], [0, 0.5, 6], [0, 0, 0]), { x: 0, y: 7 }],
      ['sidespin sweep', ball([0, 0.3, 1.6], [0, 0.5, 6], [0, 0, 0]), { x: 5, y: 1 }],
    ];
    for (const [name, contact, swing] of cases) {
      const out = computeReturn({ contact, swing, offset: { x: 0, y: 0 }, face: paddleFace(contact.pos, swing), isServe: false });
      const events = simulate(out, 2, (e) => tableBounces(e).length > 0 || e.some((x) => x.type === 'floor'));
      const first = events.find((e) => e.type !== 'net');
      const net = events.some((e) => e.type === 'net');
      lines.push(
        `${name}: v=(${out.vel.x.toFixed(1)},${out.vel.y.toFixed(1)},${out.vel.z.toFixed(1)}) → ${first?.type}@z=${first?.pos.z.toFixed(2)} x=${first?.pos.x.toFixed(2)}${net ? ' (net)' : ''}`,
      );
    }
    console.log(lines.join('\n'));
  });
});
