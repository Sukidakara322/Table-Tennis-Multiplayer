import { HIT_TUNING, spinKick } from '../../shared/hit';
import type { BallState } from '../../shared/physics';
import { createRng } from '../../shared/rng';
import { approach, clamp, type Vec2 } from '../../shared/vec';
import { clampPaddle, type ControllerContext, type Paddle, type PaddleController } from './paddle';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

interface BotProfile {
  /** Paddle movement speed, m/s. */
  maxSpeed: number;
  /** Seconds before reacting to a new incoming ball. */
  reaction: number;
  /** Standard deviation of positioning error, m. */
  aimError: number;
  /** 0..1: how well it compensates for incoming spin. */
  spinRead: number;
  /** 0..1: how hard it swings. */
  aggression: number;
}

const PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { maxSpeed: 2.2, reaction: 0.3, aimError: 0.07, spinRead: 0.35, aggression: 0.45 },
  normal: { maxSpeed: 3.4, reaction: 0.2, aimError: 0.042, spinRead: 0.7, aggression: 0.75 },
  hard: { maxSpeed: 5, reaction: 0.12, aimError: 0.022, spinRead: 1, aggression: 1 },
};

const READY = { x: 0, y: 0.22 };

export class BotController implements PaddleController {
  private readonly profile: BotProfile;
  private readonly rng: () => number;
  private target: Vec2 = { ...READY };
  private error: Vec2 = { x: 0, y: 0 };
  private plannedSwing: Vec2 = { x: 0, y: 0 };
  private plannedFor = -1;
  private reaction = 0;
  private serveDelay = 0;
  private tossRequested = false;
  private tossed = false;

  constructor(difficulty: BotDifficulty, seed = Date.now()) {
    this.profile = PROFILES[difficulty];
    this.rng = createRng(seed);
    this.resetForPoint();
  }

  resetForPoint(): void {
    this.serveDelay = 0.9 + this.rng() * 0.7;
    this.tossRequested = false;
    this.tossed = false;
    this.plannedFor = -1;
  }

  consumeToss(): boolean {
    const requested = this.tossRequested;
    this.tossRequested = false;
    return requested;
  }

  update(paddle: Paddle, ctx: ControllerContext): void {
    paddle.swing.x = 0;
    paddle.swing.y = 0;
    let speed = this.profile.maxSpeed;

    if (ctx.phase === 'serve' && ctx.isServer) {
      this.target = { x: 0.25, y: 0.12 };
      this.serveDelay -= ctx.dt;
      if (this.serveDelay <= 0 && !this.tossed) {
        this.tossed = true;
        this.tossRequested = true;
        this.plannedSwing = this.planServe();
      }
    } else if (ctx.phase === 'toss' && ctx.isServer) {
      // Wait under the ball, then swing through it on the way down.
      const falling = ctx.ball.vel.y < 0 && ctx.ball.pos.y < paddle.pos.y + 0.2;
      this.target = { x: ctx.ball.pos.x, y: falling ? ctx.ball.pos.y : ctx.ball.pos.y - 0.15 };
      if (falling) paddle.swing = { ...this.plannedSwing };
      speed = Math.max(speed, 3);
    } else if (ctx.intercept && ctx.phase === 'rally') {
      if (ctx.incomingId !== this.plannedFor) {
        this.plannedFor = ctx.incomingId;
        this.reaction = this.profile.reaction;
        this.error = { x: this.gaussian() * this.profile.aimError, y: this.gaussian() * this.profile.aimError };
        this.plannedSwing = this.planReturn(ctx.ball);
      }
      if (this.reaction > 0) {
        this.reaction -= ctx.dt;
      } else {
        this.target = { x: ctx.intercept.pos.x + this.error.x, y: ctx.intercept.pos.y + this.error.y };
      }
      paddle.swing = { ...this.plannedSwing };
    } else {
      this.target = { ...READY };
    }

    const step = speed * ctx.dt;
    paddle.pos.x = approach(paddle.pos.x, this.target.x, step);
    paddle.pos.y = approach(paddle.pos.y, this.target.y, step);
    clampPaddle(paddle.pos);
  }

  private planServe(): Vec2 {
    const a = this.profile.aggression;
    const x = (this.rng() * 2 - 1) * 2.5 * a;
    let y = (this.rng() * 2 - 1) * 3.5 * a;
    if (Math.abs(x) + Math.abs(y) < 1.2) y = 1.5;
    return { x, y };
  }

  private planReturn(ball: BallState): Vec2 {
    const { aggression, spinRead } = this.profile;
    const roll = this.rng();
    let styleY: number;
    if (roll < 0.55) styleY = 1.5 + this.rng() * 3.5 * aggression; // topspin drive
    else if (roll < 0.8) styleY = -(0.8 + this.rng() * 1.6); // push / chop
    else styleY = (this.rng() - 0.5) * 0.8; // block
    // Counter the incoming spin's kick off the racket by brushing against it.
    const counter = (-spinKick(ball).y / HIT_TUNING.liftPerSwing) * spinRead;
    return {
      x: (this.rng() * 2 - 1) * 2.5 * aggression,
      y: clamp(styleY + counter, -6, 7),
    };
  }

  private gaussian(): number {
    const u = Math.max(this.rng(), 1e-9);
    const v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
