import {
  AIM_FORWARD_MAX,
  AIM_FORWARD_MIN,
  AIM_X_LIMIT,
  hoverAt,
  PADDLE_READY_FORWARD,
  PADDLE_X_LIMIT,
  REACH_FAR_Z,
  REACH_IN_Z,
} from '../../shared/constants';
import type { BallState } from '../../shared/physics';
import type { MeetPoint } from '../../shared/predict';
import { clamp, vec3, type Vec2, type Vec3 } from '../../shared/vec';
import type { PointerInput } from './input';

export type GamePhase = 'serve' | 'rally' | 'point' | 'over';

/** A paddle in its owner's local frame (own end of the table at +z). */
export interface Paddle {
  pos: Vec3;
  prevPos: Vec3;
  /** Where the player has put the racket on the table: `x` sideways, `y` how far forward of the back
   * of the reach (so larger `y` is closer to the net). */
  aim: Vec2;
  /** Racket velocity across the table (m/s): forward = topspin, backward = backspin, sideways = sidespin. */
  swing: Vec2;
}

export function createPaddle(): Paddle {
  const readyZ = forwardToZ(PADDLE_READY_FORWARD);
  const ready = vec3(0, hoverAt(readyZ), readyZ);
  return {
    pos: { ...ready },
    prevPos: { ...ready },
    aim: { x: 0, y: PADDLE_READY_FORWARD },
    swing: { x: 0, y: 0 },
  };
}

/** Keeps the racket inside hard world bounds, on the surface it runs along plus its stroke's lift. */
export function clampPaddle(paddle: Paddle): void {
  const { pos } = paddle;
  pos.x = clamp(pos.x, -PADDLE_X_LIMIT, PADDLE_X_LIMIT);
  pos.z = clamp(pos.z, REACH_IN_Z, REACH_FAR_Z);
  pos.y = hoverAt(pos.z);
}

/** Where the racket stands, from the forward part of the aim. */
export function forwardToZ(forward: number): number {
  return REACH_FAR_Z - clamp(forward, AIM_FORWARD_MIN, AIM_FORWARD_MAX);
}

export interface ControllerContext {
  phase: GamePhase;
  isServer: boolean;
  /** Ball in the controller's local frame. */
  ball: BallState;
  /** Where the ball will pass through this player's reach (used by the bot only). */
  meetPoint: MeetPoint | null;
  /** The incoming ball has bounced on this player's half, so it can be played without volleying. */
  incomingBounced: boolean;
  /** Increments every time a new ball is struck towards this player. */
  incomingId: number;
  /** performance.now() time this physics step represents. */
  wallTime: number;
  dt: number;
}

export interface PaddleController {
  /** Places the racket on the table (sideways and along it) and sets its swing. */
  update(paddle: Paddle, ctx: ControllerContext): void;
  resetForPoint(): void;
}

const SWING_WINDOW_MS = 50;

/**
 * The mouse moves the racket around the table with no easing at all: sideways across your half, and up
 * the table towards the net or back away from it. Nothing follows the ball, so meeting it is the
 * player's job, and the forward or backward part of that same motion is the stroke that plays it.
 */
export class HumanController implements PaddleController {
  private history: Array<{ t: number; x: number; y: number }> = [];

  constructor(private readonly input: PointerInput) {}

  resetForPoint(): void {
    this.history.length = 0;
  }

  update(paddle: Paddle, ctx: ControllerContext): void {
    // Straight from the mouse, this instant: no easing, no lag of our own. The mapping is a plain
    // linear one rather than a ray cast onto the table, because near the net that ray runs almost
    // parallel to the surface — a pixel of mouse would throw the racket metres, and the same jump
    // would read as a swing of tens of metres per second.
    const cursor = this.input.cursorAt(ctx.wallTime);
    paddle.aim.x = clamp(cursor.x, -1, 1) * AIM_X_LIMIT;
    paddle.aim.y = clamp(((clamp(cursor.y, -1, 1) + 1) / 2) * AIM_FORWARD_MAX, AIM_FORWARD_MIN, AIM_FORWARD_MAX);
    // The swing is the racket's own travel across the table: sideways for sidespin, forward to drive
    // through the ball, backwards to cut under it.
    this.history.push({ t: ctx.wallTime, x: paddle.aim.x, y: paddle.aim.y });
    while (this.history.length > 2 && this.history[0]!.t < ctx.wallTime - SWING_WINDOW_MS) this.history.shift();
    const first = this.history[0]!;
    const span = (ctx.wallTime - first.t) / 1000;
    paddle.swing.x = span > 0 ? (paddle.aim.x - first.x) / span : 0;
    paddle.swing.y = span > 0 ? (paddle.aim.y - first.y) / span : 0;

    paddle.pos.x = paddle.aim.x;
    paddle.pos.z = forwardToZ(paddle.aim.y);
    paddle.pos.y = hoverAt(paddle.pos.z);
  }
}
