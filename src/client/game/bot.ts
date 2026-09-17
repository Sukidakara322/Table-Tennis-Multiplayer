import { PADDLE_READY_HEIGHT } from '../../shared/constants';
import { HIT_TUNING, spinKick } from '../../shared/hit';
import type { BallState } from '../../shared/physics';
import { paddleFace } from '../../shared/racket';
import { createRng } from '../../shared/rng';
import { approach, clamp, type Vec2, type Vec3 } from '../../shared/vec';
import type { ControllerContext, Paddle, PaddleController } from './paddle';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

interface BotProfile {
  /** Paddle movement speed (left/right and up/down), m/s. */
  maxSpeed: number;
  /** Seconds before reacting to a new incoming ball. */
  reaction: number;
  /** Standard deviation of positioning error, m (hit radius is ~10 cm). */
  aimError: number;
  /** 0..1: how well it compensates for incoming spin. */
  spinRead: number;
  /** 0..1: how hard it swings. */
  aggression: number;
}

const PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { maxSpeed: 2.2, reaction: 0.3, aimError: 0.05, spinRead: 0.35, aggression: 0.45 },
  normal: { maxSpeed: 3.4, reaction: 0.2, aimError: 0.03, spinRead: 0.7, aggression: 0.75 },
  hard: { maxSpeed: 5, reaction: 0.12, aimError: 0.016, spinRead: 1, aggression: 1 },
};

/** Where the bot waits (x, height), in its local frame. */
const READY: Vec2 = { x: 0, y: PADDLE_READY_HEIGHT };
/** The bot strikes its serve once the falling toss has dropped to about this height. */
const SERVE_STRIKE_HEIGHT = 0.35;
/** Paddle speed while swinging through a serve. */
const SERVE_SWING_SPEED = 4;

/**
 * Plays under the same rules as a human: it steers only left/right and height, its paddle travels in
 * depth with the ball the same way, and contact only happens when paddle and ball actually overlap.
 */
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
    const { ball } = ctx;

    if (ctx.phase === 'serve' && ctx.isServer) {
      this.target = { x: 0.25, y: SERVE_STRIKE_HEIGHT - 0.1 };
      this.serveDelay -= ctx.dt;
      if (this.serveDelay <= 0 && !this.tossed) {
        this.tossed = true;
        this.tossRequested = true;
        this.plannedSwing = this.planServe();
      }
    } else if (ctx.phase === 'toss' && ctx.isServer) {
      // Wait below the toss, then swing into the ball as it falls.
      const falling = ball.vel.y < 0 && ball.pos.y < SERVE_STRIKE_HEIGHT + 0.2;
      this.target = falling ? { x: ball.pos.x, y: ball.pos.y } : { x: ball.pos.x, y: SERVE_STRIKE_HEIGHT - 0.1 };
      if (falling) {
        speed = SERVE_SWING_SPEED;
        paddle.swing = { ...this.plannedSwing };
      }
    } else if (ctx.phase === 'rally' && ctx.meetPoint) {
      if (ctx.incomingId !== this.plannedFor) {
        this.plannedFor = ctx.incomingId;
        this.reaction = this.profile.reaction;
        this.error = { x: this.gaussian() * this.profile.aimError, y: this.gaussian() * this.profile.aimError };
        this.plannedSwing = this.planReturn(ball, ctx.meetPoint.pos);
      }
      if (this.reaction > 0) {
        this.reaction -= ctx.dt;
      } else {
        this.target = { x: ctx.meetPoint.pos.x + this.error.x, y: ctx.meetPoint.pos.y + this.error.y };
      }
      paddle.swing = { ...this.plannedSwing };
    } else {
      this.target = { ...READY };
    }

    const step = speed * ctx.dt;
    paddle.pos.x = approach(paddle.pos.x, this.target.x, step);
    paddle.pos.y = approach(paddle.pos.y, this.target.y, step);
    // The bot has no screen: it places the paddle directly, so its aim is simply where the paddle is.
    paddle.aim.x = paddle.pos.x;
    paddle.aim.y = paddle.pos.y;
  }

  /** Sidespin plus a vertical brush, like a human swinging through the toss. */
  private planServe(): Vec2 {
    const a = this.profile.aggression;
    const x = (this.rng() * 2 - 1) * 2.5 * a;
    let y = (this.rng() * 2 - 1) * 3.5 * a;
    if (Math.abs(x) + Math.abs(y) < 1.2) y = 1.5;
    return { x, y };
  }

  private planReturn(ball: BallState, meetAt: Vec3): Vec2 {
    const { aggression, spinRead } = this.profile;
    const roll = this.rng();
    let styleY: number;
    if (roll < 0.55) styleY = 1.5 + this.rng() * 3.5 * aggression; // topspin drive
    else if (roll < 0.8) styleY = -(0.8 + this.rng() * 1.6); // push / chop
    else styleY = (this.rng() - 0.5) * 0.8; // block
    // Counter the incoming spin's kick and its own face angle at the meeting height by brushing against them.
    const faceLift = paddleFace(meetAt, { x: 0, y: 0 }).pitch * HIT_TUNING.faceLift;
    const counter = ((-spinKick(ball).y - faceLift) / HIT_TUNING.liftPerSwing) * spinRead;
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
