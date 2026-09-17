import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, DT, HALF_LENGTH, NET_HEIGHT, SERVE_Z, TOSS_HEIGHT_ABOVE_PADDLE } from './constants';
import { toLocalBall } from './frames';
import { computeReturn } from './hit';
import { stepBall, type BallState, type PhysicsEvent } from './physics';
import { predictIntercept } from './predict';

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

describe('racket returns', () => {
  const incoming = ball([0.1, 0.3, 1.6], [0, 0.4, 6]);

  it('a flat swing lands on the opponent half', () => {
    const out = computeReturn({ contact: incoming, swing: { x: 0, y: 1 }, offset: { x: 0, y: 0 }, isServe: false });
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
    for (const swing of swings) {
      const contact = ball([0, 0.12 + TOSS_HEIGHT_ABOVE_PADDLE, SERVE_Z - 0.05], [0, -1, 0]);
      const out = computeReturn({ contact, swing, offset: { x: 0, y: 0 }, isServe: true });
      const events = simulate(out, 3, (e) => tableBounces(e).length >= 2 || e.some((x) => x.type === 'floor' || x.type === 'net'));
      const sides = tableBounces(events).map((e) => `${e.side}@${e.pos.z.toFixed(2)}`);
      const net = events.some((e) => e.type === 'net');
      results.push(`swing ${swing.x},${swing.y} → ${sides.join(' ')}${net ? ' NET' : ''}`);
      const bounces = tableBounces(events);
      if (bounces[0]?.side === 0 && bounces[1]?.side === 1) good++;
    }
    console.log(results.join('\n'));
    expect(good).toBeGreaterThanOrEqual(5);
  });

  it('predicts where the receiver meets the ball', () => {
    const out = computeReturn({ contact: incoming, swing: { x: 0, y: 2 }, offset: { x: 0, y: 0 }, isServe: false });
    const intercept = predictIntercept(toLocalBall(1, out));
    expect(intercept).not.toBeNull();
    expect(intercept!.pos.z).toBeGreaterThan(0);
    expect(intercept!.pos.y).toBeGreaterThan(0.05);
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
      const out = computeReturn({ contact, swing, offset: { x: 0, y: 0 }, isServe: false });
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
