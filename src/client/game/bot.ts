import { AIM_X_LIMIT, AIM_Y_MIN, SERVE_MIN_FLICK } from '../../shared/constants';
import { HIT_TUNING, spinKick } from '../../shared/hit';
import type { BallState } from '../../shared/physics';
import { paddleFace } from '../../shared/racket';
import { createRng } from '../../shared/rng';
import { approach, clamp, type Vec2, type Vec3 } from '../../shared/vec';
import type { ControllerContext, Paddle, PaddleController } from './paddle';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

interface BotProfile {
  /** How fast it moves the racket across its plane (m/s). */
  maxSpeed: number;
  /** Seconds before it reads a new incoming ball and sets off. */
  reaction: number;
  /** How far off the middle of the blade it tends to catch the ball (m). */
  aimError: number;
  /** 0..1: how well it compensates for incoming spin. */
  spinRead: number;
  /** 0..1: how hard it swings. */
  aggression: number;
};

const PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { maxSpeed: 1.6, reaction: 0.3, aimError: 0.05, spinRead: 0.35, aggression: 0.45 },
  normal: { maxSpeed: 2.6, reaction: 0.2, aimError: 0.03, spinRead: 0.7, aggression: 0.75 },
  hard: { maxSpeed: 4, reaction: 0.12, aimError: 0.016, spinRead: 1, aggression: 1 },
};

/**
 * Plays under exactly the same terms as the player: it holds its racket on the same plane in front of
 * it, moves it there at a limited speed, and strokes through the ball. Its difficulty is how quickly it
 * reads a ball, how cleanly it catches it and how good the stroke is — never extra reach.
 */
export class BotController implements PaddleController {
  private readonly profile: BotProfile;
  private readonly rng: () => number;
  private plannedSwing: Vec2 = { x: 0, y: 0 };
  private error: Vec2 = { x: 0, y: 0 };
  private plannedFor = -1;
  private reaction = 0;
  private serveDelay = 0;
  private serveReady = false;

  constructor(difficulty: BotDifficulty, seed = Date.now()) {
    this.profile = PROFILES[difficulty];
    this.rng = createRng(seed);
    this.resetForPoint();
  }

  resetForPoint(): void {
    this.serveDelay = 0.9 + this.rng() * 0.7;
    this.serveReady = false;
    this.plannedFor = -1;
  }

  update(paddle: Paddle, ctx: ControllerContext): void {
    paddle.swing.x = 0;
    paddle.swing.y = 0;

    if (ctx.phase === 'serve' && ctx.isServer) {
      if (!this.serveReady) {
        this.plannedSwing = this.planServe();
        this.serveReady = true;
      }
      // Takes a moment to settle, then sweeps through the ball: up the table for topspin, back for a cut.
      this.serveDelay -= ctx.dt;
      if (this.serveDelay <= 0) paddle.swing = { ...this.plannedSwing };
      return;
    }

    if (ctx.phase !== 'rally') return;
    if (!ctx.meetPoint) {
      this.getOutOfTheWay(paddle, ctx);
      return;
    }
    if (ctx.incomingId !== this.plannedFor) {
      this.plannedFor = ctx.incomingId;
      this.reaction = this.profile.reaction;
      this.plannedSwing = this.planReturn(ctx.ball, ctx.meetPoint.pos);
      // Where it will misjudge this one: it has to put the racket in the ball's way like anyone else.
      this.error = this.contactError();
    }
    if (this.reaction > 0) {
      this.reaction -= ctx.dt;
      return;
    }
    // Move the racket to where the ball will pass, and stroke through it.
    const step = this.profile.maxSpeed * ctx.dt;
    paddle.pos.x = approach(paddle.pos.x, ctx.meetPoint.pos.x + this.error.x, step);
    paddle.pos.y = approach(paddle.pos.y, ctx.meetPoint.pos.y + this.error.y, step);
    paddle.aim.x = paddle.pos.x;
    paddle.aim.y = paddle.pos.y;
    paddle.swing = { ...this.plannedSwing };
  }

  /**
   * No meeting point means this ball is not returnable: it is flying out, or it is not coming back
   * over at all. The racket is held in front of you and does not move itself, so leaving it there
   * catches the ball on its way past and gives the point away. Pull it aside and let the ball go —
   * the same judgement a player has to make, and the reason a ball going long is worth playing for.
   */
  private getOutOfTheWay(paddle: Paddle, ctx: ControllerContext): void {
    const ball = ctx.ball;
    if (ball.vel.z <= 0) return; // not coming at us
    const away = ball.pos.x > 0 ? -AIM_X_LIMIT : AIM_X_LIMIT;
    const step = this.profile.maxSpeed * ctx.dt;
    paddle.pos.x = approach(paddle.pos.x, away, step);
    paddle.pos.y = approach(paddle.pos.y, AIM_Y_MIN, step);
    paddle.aim.x = paddle.pos.x;
    paddle.aim.y = paddle.pos.y;
  }

  /** How cleanly it catches the ball — the one thing it can still get wrong now it is always there. */
  contactError(): Vec2 {
    return { x: this.gaussian() * this.profile.aimError, y: this.gaussian() * this.profile.aimError };
  }

  /** Sidespin plus a sweep up or down the table, the way a player serves. */
  private planServe(): Vec2 {
    const a = this.profile.aggression;
    const chop = this.rng() < 0.35;
    // Always past SERVE_MIN_FLICK, or the sweep would never reach the ball and the point would stall.
    const vertical = (SERVE_MIN_FLICK + 0.4 + this.rng() * 2 * a) * (chop ? -1 : 1);
    return { x: (this.rng() * 2 - 1) * 2 * a, y: vertical };
  }

  private planReturn(ball: BallState, meetAt: Vec3): Vec2 {
    const { aggression, spinRead } = this.profile;
    const roll = this.rng();
    let styleY: number;
    // No dead bats. Below HIT_TUNING.rallyMinSwing a stroke stops being aimed at all and the ball just
    // rebounds off the rubber, which from here drops on its own side — a point given away for nothing,
    // and not something a competent player does on purpose. Every plan is at least a real stroke.
    const softest = HIT_TUNING.rallyMinSwing + 0.2;
    if (roll < 0.55) styleY = softest + this.rng() * 2.2 * aggression; // topspin drive
    else if (roll < 0.8) styleY = -(softest + this.rng() * 1.2); // push / chop
    else styleY = softest; // a plain block, but still driven through the ball
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
