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
/** How far above or below the waiting ball the bot sets up before sweeping through it to serve. */
const SERVE_WIND_UP = 0.22;
/** Paddle speed while sweeping through a serve. */
const SERVE_SWING_SPEED = 3.5;

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
  private serveReady = false;
  private serveSwinging = false;
  private serveDirection = 1;
  private serveX = 0;

  constructor(difficulty: BotDifficulty, seed = Date.now()) {
    this.profile = PROFILES[difficulty];
    this.rng = createRng(seed);
    this.resetForPoint();
  }

  resetForPoint(): void {
    this.serveDelay = 0.9 + this.rng() * 0.7;
    this.serveReady = false;
    this.serveSwinging = false;
    this.serveX = (this.rng() * 2 - 1) * 0.4;
    this.plannedFor = -1;
  }

  update(paddle: Paddle, ctx: ControllerContext): void {
    paddle.swing.x = 0;
    paddle.swing.y = 0;
    let speed = this.profile.maxSpeed;
    const { ball } = ctx;

    if (ctx.phase === 'serve' && ctx.isServer) {
      // Set up above or below the waiting ball, then sweep through it: down for backspin, up for topspin.
      if (!this.serveReady) {
        this.plannedSwing = this.planServe();
        this.serveDirection = Math.sign(this.plannedSwing.y) || 1;
        this.serveReady = true;
      }
      const windUpY = ball.pos.y - this.serveDirection * SERVE_WIND_UP;
      this.serveDelay -= ctx.dt;
      // The sweep has to latch: leaving the wind-up spot is what a swing is, so re-checking "am I set
      // up?" mid-stroke would pull the paddle straight back and it would only ever shiver in place.
      if (!this.serveSwinging) {
        const setUp = Math.abs(paddle.pos.y - windUpY) < 0.02 && Math.abs(paddle.pos.x - this.serveX) < 0.02;
        this.serveSwinging = this.serveDelay <= 0 && setUp;
      }
      if (!this.serveSwinging) {
        this.target = { x: this.serveX, y: windUpY };
      } else {
        this.target = { x: this.serveX, y: ball.pos.y + this.serveDirection * SERVE_WIND_UP };
        speed = SERVE_SWING_SPEED;
        paddle.swing = { ...this.plannedSwing };
        // If the sweep somehow finished without touching the ball, wind up and try again rather than
        // hanging above it with the ball still waiting.
        if (Math.abs(paddle.pos.y - this.target.y) < 0.01) {
          this.serveSwinging = false;
          this.serveReady = false;
          this.serveDelay = 0.4;
        }
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
    const chop = this.rng() < 0.35;
    const vertical = (1.6 + this.rng() * 2 * a) * (chop ? -1 : 1);
    return { x: (this.rng() * 2 - 1) * 2 * a, y: vertical };
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
