import {
  HALF_LENGTH,
  PADDLE_X_LIMIT,
  PADDLE_Y_MAX,
  PADDLE_Y_MIN_BEHIND_TABLE,
  PADDLE_Y_MIN_OVER_TABLE,
  READY_Z,
} from '../../shared/constants';
import type { BallState } from '../../shared/physics';
import type { Intercept } from '../../shared/predict';
import type { PlayerIndex } from '../../shared/types';
import { clamp, vec3, type Vec2, type Vec3 } from '../../shared/vec';
import type { GameRenderer } from './renderer';
import type { PointerInput } from './input';

export type GamePhase = 'serve' | 'toss' | 'rally' | 'point' | 'over';

/** A paddle in its owner's local frame (own end of the table at +z). */
export interface Paddle {
  pos: Vec3;
  prevPos: Vec3;
  /** Swing velocity in the x/y plane, m/s. */
  swing: Vec2;
}

export function createPaddle(): Paddle {
  return { pos: vec3(0, 0.2, READY_Z), prevPos: vec3(0, 0.2, READY_Z), swing: { x: 0, y: 0 } };
}

export function clampPaddle(pos: Vec3): void {
  pos.x = clamp(pos.x, -PADDLE_X_LIMIT, PADDLE_X_LIMIT);
  const minY = pos.z < HALF_LENGTH + 0.05 ? PADDLE_Y_MIN_OVER_TABLE : PADDLE_Y_MIN_BEHIND_TABLE;
  pos.y = clamp(pos.y, minY, PADDLE_Y_MAX);
}

export interface ControllerContext {
  phase: GamePhase;
  isServer: boolean;
  /** Ball in the controller's local frame. */
  ball: BallState;
  intercept: Intercept | null;
  /** Increments every time a new ball is struck towards this player. */
  incomingId: number;
  /** performance.now() time this physics step represents. */
  wallTime: number;
  dt: number;
}

export interface PaddleController {
  /** Moves the paddle in x/y and sets its swing. Depth (z) is handled by the game. */
  update(paddle: Paddle, ctx: ControllerContext): void;
  /** True once when the controller wants to toss the ball for its serve. */
  consumeToss(): boolean;
  resetForPoint(): void;
}

const SWING_WINDOW_MS = 50;

/** The paddle stays pinned under the (virtual) mouse cursor. */
export class HumanController implements PaddleController {
  private tossRequested = false;

  constructor(
    private readonly input: PointerInput,
    private readonly renderer: GameRenderer,
    private readonly player: PlayerIndex,
  ) {}

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
    const now = this.input.cursorAt(ctx.wallTime);
    const before = this.input.cursorAt(ctx.wallTime - SWING_WINDOW_MS);
    // Both samples are projected onto the current plane so auto-depth motion doesn't read as a swing.
    const a = this.renderer.cursorToLocalPlane(now, paddle.pos.z, this.player);
    const b = this.renderer.cursorToLocalPlane(before, paddle.pos.z, this.player);
    paddle.pos.x = a.x;
    paddle.pos.y = a.y;
    clampPaddle(paddle.pos);
    const window = SWING_WINDOW_MS / 1000;
    paddle.swing.x = (a.x - b.x) / window;
    paddle.swing.y = (a.y - b.y) / window;
  }
}
