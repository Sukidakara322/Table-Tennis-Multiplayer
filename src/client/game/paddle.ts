import {
  AIM_PLANE_Z,
  AIM_X_LIMIT,
  AIM_Y_MAX,
  AIM_Y_MIN,
  PADDLE_READY_HEIGHT,
  PADDLE_X_LIMIT,
  PADDLE_Y_MAX,
  PADDLE_Y_MIN,
  REACH_NEAR_Z,
  VIEW_EYE_Y,
  VIEW_EYE_Z,
} from '../../shared/constants';
import type { BallState } from '../../shared/physics';
import type { MeetPoint } from '../../shared/predict';
import { clamp, lerp, vec3, type Vec2, type Vec3 } from '../../shared/vec';
import type { PointerInput } from './input';

export type GamePhase = 'serve' | 'toss' | 'rally' | 'point' | 'over';

/** A paddle in its owner's local frame (own end of the table at +z). */
export interface Paddle {
  pos: Vec3;
  prevPos: Vec3;
  /**
   * Where the player is aiming: x/height on the aim plane. Posture rules (arm arc, body) use this,
   * so the paddle travelling along the line of sight never feeds back into them.
   */
  aim: Vec2;
  /** Paddle velocity in the x/y plane (m/s): up = topspin, down = backspin, sideways = sidespin. */
  swing: Vec2;
}

export function createPaddle(): Paddle {
  return {
    pos: vec3(0, PADDLE_READY_HEIGHT, REACH_NEAR_Z),
    prevPos: vec3(0, PADDLE_READY_HEIGHT, REACH_NEAR_Z),
    aim: { x: 0, y: PADDLE_READY_HEIGHT },
    swing: { x: 0, y: 0 },
  };
}

/** Keeps the paddle inside hard world bounds (depth is set by the game). */
export function clampPaddle(pos: Vec3): void {
  pos.x = clamp(pos.x, -PADDLE_X_LIMIT, PADDLE_X_LIMIT);
  pos.y = clamp(pos.y, PADDLE_Y_MIN, PADDLE_Y_MAX);
}

export interface ControllerContext {
  phase: GamePhase;
  isServer: boolean;
  /** Ball in the controller's local frame. */
  ball: BallState;
  /** Where the ball will pass through this player's reach (used by the bot only). */
  meetPoint: MeetPoint | null;
  /** Increments every time a new ball is struck towards this player. */
  incomingId: number;
  /** performance.now() time this physics step represents. */
  wallTime: number;
  dt: number;
}

export interface PaddleController {
  /** Moves the paddle in x and height and sets its swing. Depth is set by the game beforehand. */
  update(paddle: Paddle, ctx: ControllerContext): void;
  /** True once when the controller wants to toss the ball for its serve. */
  consumeToss(): boolean;
  resetForPoint(): void;
}

/** Maps the virtual cursor across the whole mouse range onto x/height on the aim plane. */
export function cursorToAim(cursor: Vec2): Vec2 {
  return {
    x: cursor.x * AIM_X_LIMIT,
    y: lerp(AIM_Y_MIN, AIM_Y_MAX, (cursor.y + 1) / 2),
  };
}

/** How much a sideways/vertical distance on the aim plane shrinks (or grows) at `depth` along the line of sight. */
export function lineOfSightScale(depth: number): number {
  return (depth - VIEW_EYE_Z) / (AIM_PLANE_Z - VIEW_EYE_Z);
}

/** The point at `depth` on the line of sight from the viewer's eye through `aim` (on the aim plane). */
export function onLineOfSight(aim: Vec2, depth: number): Vec2 {
  const k = lineOfSightScale(depth);
  return { x: aim.x * k, y: VIEW_EYE_Y + (aim.y - VIEW_EYE_Y) * k };
}

/** Time constant of the paddle easing towards the cursor: softens jitter, adds only a few ms of lag. */
const FOLLOW_TIME = 0.03;
const SWING_WINDOW_MS = 50;

/**
 * The mouse aims; the paddle eases after it and sits on that line of sight at whatever depth the game
 * gives it, so it stays exactly where you put it on screen while it travels with the ball.
 */
export class HumanController implements PaddleController {
  private tossRequested = false;
  private history: Array<{ t: number; x: number; y: number }> = [];

  constructor(private readonly input: PointerInput) {}

  requestToss(): void {
    this.tossRequested = true;
  }

  consumeToss(): boolean {
    const requested = this.tossRequested;
    this.tossRequested = false;
    return requested;
  }

  resetForPoint(): void {
    this.tossRequested = false;
  }

  update(paddle: Paddle, ctx: ControllerContext): void {
    const target = cursorToAim(this.input.cursorAt(ctx.wallTime));
    const k = 1 - Math.exp(-ctx.dt / FOLLOW_TIME);
    paddle.aim.x += (target.x - paddle.aim.x) * k;
    paddle.aim.y += (target.y - paddle.aim.y) * k;

    const onScreen = onLineOfSight(paddle.aim, paddle.pos.z);
    paddle.pos.x = onScreen.x;
    paddle.pos.y = onScreen.y;

    // Swing comes only from the player's own motion (the aim), scaled to the paddle's depth; travelling
    // along the line of sight with the ball must not read as a stroke.
    this.history.push({ t: ctx.wallTime, x: paddle.aim.x, y: paddle.aim.y });
    while (this.history.length > 2 && this.history[0]!.t < ctx.wallTime - SWING_WINDOW_MS) this.history.shift();
    const first = this.history[0]!;
    const span = (ctx.wallTime - first.t) / 1000;
    const scale = lineOfSightScale(paddle.pos.z);
    paddle.swing.x = span > 0 ? ((paddle.aim.x - first.x) / span) * scale : 0;
    paddle.swing.y = span > 0 ? ((paddle.aim.y - first.y) / span) * scale : 0;
  }
}
