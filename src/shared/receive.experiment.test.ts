import { it } from 'vitest';
import { DT, HALF_LENGTH, MAX_PADDLE_Z, MIN_PADDLE_Z, PADDLE_DEPTH_SPEED, READY_Z } from './constants';
import { toLocalBall } from './frames';
import { computeReturn } from './hit';
import { cloneBall, stepBall, type BallState, type PhysicsEvent } from './physics';
import { predictIntercept } from './predict';
import { approach, clamp, type Vec3 } from './vec';

// TEMP experiment: how often can a human-like player make contact with incoming balls?
const CAMERA = { x: 0, y: 1.6, z: HALF_LENGTH + 2.3 };

interface Variant {
  name: string;
  radius: number;
  lagWindowMs: number;
  maxDepth: number;
}

/** Where the camera ray through `ball` meets the paddle plane z = pz. */
function projectToPlane(ball: Vec3, pz: number): { x: number; y: number } {
  const k = (pz - CAMERA.z) / (ball.z - CAMERA.z);
  return { x: CAMERA.x + (ball.x - CAMERA.x) * k, y: CAMERA.y + (ball.y - CAMERA.y) * k };
}

function incomingBalls(): BallState[] {
  const balls: BallState[] = [];
  for (const y of [0.1, 0.25, 0.45]) {
    for (const sy of [-2, 0, 2, 4]) {
      for (const sx of [-2, 0, 2]) {
        const contact: BallState = { pos: { x: 0.1, y, z: 1.8 }, vel: { x: 0, y: 0.5, z: 6 }, spin: { x: 0, y: 0, z: 0 } };
        const botLocal = computeReturn({ contact, swing: { x: sx, y: sy }, offset: { x: 0, y: 0 }, isServe: false });
        const human = toLocalBall(1, botLocal); // bot is player 1; human (player 0) frame = world
        // keep only legal balls (first contact is a bounce on the human's half)
        const probe = cloneBall(human);
        const events: PhysicsEvent[] = [];
        let legal = false;
        for (let i = 0; i < 480; i++) {
          events.length = 0;
          stepBall(probe, events);
          const first = events[0];
          if (first) {
            legal = first.type === 'table' && first.side === 0;
            break;
          }
        }
        if (legal) balls.push(human);
      }
    }
  }
  return balls;
}

type Player = (ctx: { t: number; ballHistory: Vec3[]; pz: number; intercept: Vec3 | null; interceptAge: number; prev: { x: number; y: number } }) => {
  x: number;
  y: number;
};

function chaser(delayMs: number): Player {
  return ({ ballHistory, pz }) => {
    const idx = Math.max(0, ballHistory.length - 1 - Math.round(delayMs / 1000 / DT));
    return projectToPlane(ballHistory[idx]!, pz);
  };
}

function markerFollower(delayMs: number, handSpeed: number): Player {
  return ({ intercept, interceptAge, prev }) => {
    if (!intercept || interceptAge < delayMs / 1000) return prev;
    return {
      x: approach(prev.x, intercept.x, handSpeed * DT),
      y: approach(prev.y, intercept.y, handSpeed * DT),
    };
  };
}

function trial(ball0: BallState, player: Player, variant: Variant): boolean {
  const ball = cloneBall(ball0);
  const history: Vec3[] = [{ ...ball.pos }];
  const paddleHistory: Array<{ x: number; y: number }> = [];
  let pz = READY_Z;
  let paddle = { x: 0, y: 0.3 };
  let intercept = predictIntercept(ball)?.pos ?? null;
  let interceptAge = 0;
  const events: PhysicsEvent[] = [];
  for (let i = 0; i < 480; i++) {
    const prevBall = { ...ball.pos };
    const prevPz = pz;
    events.length = 0;
    stepBall(ball, events);
    if (events.some((e) => e.type === 'table' || e.type === 'net')) {
      intercept = predictIntercept(ball)?.pos ?? null;
    }
    if (events.some((e) => e.type === 'floor' || e.type === 'side')) return false;
    interceptAge += DT;
    history.push({ ...ball.pos });
    const target = intercept ? clamp(intercept.z, MIN_PADDLE_Z, variant.maxDepth) : READY_Z;
    pz = approach(pz, target, PADDLE_DEPTH_SPEED * DT);
    paddle = player({ t: i * DT, ballHistory: history, pz, intercept, interceptAge, prev: paddle });
    paddleHistory.push(paddle);

    const prevRel = prevBall.z - prevPz;
    const rel = ball.pos.z - pz;
    if (ball.vel.z > 0 && prevRel < 0 && rel >= 0) {
      const k = prevRel / (prevRel - rel);
      const bx = prevBall.x + (ball.pos.x - prevBall.x) * k;
      const by = prevBall.y + (ball.pos.y - prevBall.y) * k;
      const window = Math.max(1, Math.round(variant.lagWindowMs / 1000 / DT));
      let best = Infinity;
      for (let j = Math.max(0, paddleHistory.length - window); j < paddleHistory.length; j++) {
        const p = paddleHistory[j]!;
        best = Math.min(best, Math.hypot(bx - p.x, by - p.y));
      }
      return best <= variant.radius;
    }
  }
  return false;
}

it('receive experiment', () => {
  const balls = incomingBalls();
  const variants: Variant[] = [
    { name: 'current (r=0.13, no lag comp, deep)', radius: 0.13, lagWindowMs: 0, maxDepth: MAX_PADDLE_Z },
    { name: 'radius 0.2', radius: 0.2, lagWindowMs: 0, maxDepth: MAX_PADDLE_Z },
    { name: 'lag comp 150ms', radius: 0.13, lagWindowMs: 150, maxDepth: MAX_PADDLE_Z },
    { name: 'shallow depth (end+0.25)', radius: 0.13, lagWindowMs: 0, maxDepth: HALF_LENGTH + 0.25 },
    { name: 'r 0.17 + lag 150 + shallow', radius: 0.17, lagWindowMs: 150, maxDepth: HALF_LENGTH + 0.25 },
  ];
  const players: Array<[string, Player]> = [
    ['chase ball on screen, 0ms', chaser(0)],
    ['chase ball on screen, 120ms', chaser(120)],
    ['chase ball on screen, 200ms', chaser(200)],
    ['follow marker, 250ms react, 2.5 m/s hand', markerFollower(250, 2.5)],
  ];
  const lines = [`legal incoming balls: ${balls.length}`];
  for (const variant of variants) {
    lines.push(`\n${variant.name}`);
    for (const [name, player] of players) {
      const hits = balls.filter((b) => trial(b, player, variant)).length;
      lines.push(`  ${name.padEnd(42)} ${Math.round((100 * hits) / balls.length)}%`);
    }
  }
  console.log(lines.join('\n'));
});
