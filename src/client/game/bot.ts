import {
  AIM_FORWARD_MAX,
  AIM_FORWARD_MIN,
  AIM_X_LIMIT,
  hoverAt,
  PADDLE_READY_FORWARD,
  REACH_FAR_Z,
} from '../../shared/constants';
import { HIT_TUNING, spinKick } from '../../shared/hit';
import type { BallState } from '../../shared/physics';
import { paddleFace } from '../../shared/racket';
import { createRng } from '../../shared/rng';
import { approach, clamp, type Vec2, type Vec3 } from '../../shared/vec';
import { forwardToZ, type ControllerContext, type Paddle, type PaddleController } from './paddle';

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

/** Where the bot waits: middle of the table, at its resting distance from the net. */
const READY: Vec2 = { x: 0, y: PADDLE_READY_FORWARD };
/** How far short of the ball the bot sets up before driving through it to serve. */
const SERVE_WIND_UP = 0.22;
/** Racket speed while driving through a serve. */
const SERVE_SWING_SPEED = 3.5;
/**
 * How far back of the meeting point the bot waits, so it drives forward through the ball. Short: the
 * racket runs along a slope, so a long drive would also carry the blade well below where the ball is.
 */
const STROKE_WIND_UP = 0.15;
/**
 * Start the drive this much earlier than the arithmetic says: a stroke that is late can miss the ball
 * entirely, while one that is early simply meets it a touch sooner.
 */
const STROKE_EARLY_BIAS = 0.05;

/**
 * Plays under exactly the same rules as a player: it steers the racket around its own half, sideways
 * and along the table, nothing follows the ball for it, and it only plays a shot by driving through
 * the ball where it actually is.
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
      // Set up short of the waiting ball along the table, then drive through it.
      const ballForward = REACH_FAR_Z - ball.pos.z;
      const windUpY = ballForward - this.serveDirection * SERVE_WIND_UP;
      this.serveDelay -= ctx.dt;
      // The sweep has to latch: leaving the wind-up spot is what a swing is, so re-checking "am I set
      // up?" mid-stroke would pull the paddle straight back and it would only ever shiver in place.
      if (!this.serveSwinging) {
        const setUp = Math.abs(paddle.aim.y - windUpY) < 0.02 && Math.abs(paddle.aim.x - this.serveX) < 0.02;
        this.serveSwinging = this.serveDelay <= 0 && setUp;
      }
      if (!this.serveSwinging) {
        this.target = { x: this.serveX, y: windUpY };
      } else {
        this.target = { x: this.serveX, y: ballForward + this.serveDirection * SERVE_WIND_UP };
        speed = SERVE_SWING_SPEED;
        paddle.swing = { ...this.plannedSwing };
        // If the drive somehow finished without touching the ball, wind up and try again rather than
        // standing past it with the ball still waiting.
        if (Math.abs(paddle.aim.y - this.target.y) < 0.01) {
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
        // Move across to where the ball will pass straight away, but hold station until it has
        // bounced: standing up the table with the ball still in the air is how you volley it away.
        const meetForward = REACH_FAR_Z - ctx.meetPoint.pos.z + this.error.y;
        // Start the drive exactly early enough to be travelling through the meeting point as the ball
        // reaches it, rather than a fixed moment that arrives late on a slow stroke and early on a fast one.
        const driveSpeed = Math.max(this.profile.maxSpeed, Math.abs(this.plannedSwing.y));
        const driving = ctx.incomingBounced && ctx.meetPoint.time <= STROKE_WIND_UP / driveSpeed + STROKE_EARLY_BIAS;
        // Set up behind the ball while it is still in the air — there is no time to do it afterwards —
        // but never past your own end line until it has bounced, which is the whole of the volley rule.
        const waiting = Math.min(meetForward - STROKE_WIND_UP, READY.y);
        this.target = {
          x: ctx.meetPoint.pos.x + this.error.x,
          y: driving ? meetForward + STROKE_WIND_UP : waiting,
        };
        // It is only stroking the ball while it is actually driving through it, the same as for a
        // player: a racket held still is held still, and earns no help with the shot.
        if (driving) {
          speed = driveSpeed;
          paddle.swing = { ...this.plannedSwing };
        }
      }
    } else {
      this.target = { ...READY };
    }

    const step = speed * ctx.dt;
    // The bot has no screen: it steers the same two numbers a player does, sideways and along the table.
    paddle.aim.x = approach(paddle.aim.x, clamp(this.target.x, -AIM_X_LIMIT, AIM_X_LIMIT), step);
    paddle.aim.y = approach(paddle.aim.y, clamp(this.target.y, AIM_FORWARD_MIN, AIM_FORWARD_MAX), step);
    paddle.pos.x = paddle.aim.x;
    paddle.pos.z = forwardToZ(paddle.aim.y);
    paddle.pos.y = hoverAt(paddle.pos.z);
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
