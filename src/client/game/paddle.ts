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
import type { PlayerIndex } from '../../shared/types';
import { clamp, vec3, type Vec2, type Vec3 } from '../../shared/vec';
import type { PointerInput } from './input';
import type { GameRenderer } from './renderer';

export type GamePhase = 'serve' | 'rally' | 'point' | 'over';

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
  resetForPoint(): void;
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

const SWING_WINDOW_MS = 50;

/**
 * The mouse aims the paddle with no easing at all: the cursor is projected straight onto the aim plane,
 * so the paddle moves exactly as far and as fast on screen as the mouse does. It then sits on that line
 * of sight at whatever depth the game gives it, staying where you put it on screen while it travels
 * with the ball.
 */
export class HumanController implements PaddleController {
  private history: Array<{ t: number; x: number; y: number }> = [];

  constructor(
    private readonly input: PointerInput,
    private readonly renderer: GameRenderer,
    private readonly player: PlayerIndex,
  ) {}

  resetForPoint(): void {
    this.history.length = 0;
  }

  update(paddle: Paddle, ctx: ControllerContext): void {
    // Straight to where the cursor points, this instant: no easing, no lag of our own.
    const aim = this.renderer.cursorToAimPlane(this.input.cursorAt(ctx.wallTime), this.player);
    paddle.aim.x = clamp(aim.x, -AIM_X_LIMIT, AIM_X_LIMIT);
    paddle.aim.y = clamp(aim.y, AIM_Y_MIN, AIM_Y_MAX);

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
