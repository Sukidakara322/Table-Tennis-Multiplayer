import { AIM_X_LIMIT, AIM_Y_MAX, AIM_Y_MIN, PADDLE_HOVER_Y, STAND_Z } from '../../shared/constants';
import type { BallState } from '../../shared/physics';
import type { MeetPoint } from '../../shared/predict';
import { clamp, vec3, type Vec2, type Vec3 } from '../../shared/vec';
import type { PointerInput } from './input';

export type GamePhase = 'serve' | 'rally' | 'point' | 'over';

/** A racket in its owner's local frame (own end of the table at +z). */
export interface Paddle {
  /**
   * Where the blade is. `x` and `y` are entirely the player's — the mouse holds the racket anywhere on
   * the plane in front of them — and `z` is always STAND_Z, because the plane does not move.
   */
  pos: Vec3;
  prevPos: Vec3;
  /** Where on its plane the racket is being held: sideways, and how high. */
  aim: Vec2;
  /** Stroke speed (m/s): sweeping up brushes topspin, down cuts backspin, sideways puts sidespin on. */
  swing: Vec2;
}

export function createPaddle(): Paddle {
  const ready = vec3(0, PADDLE_HOVER_Y, STAND_Z);
  return {
    pos: { ...ready },
    prevPos: { ...ready },
    aim: { x: ready.x, y: ready.y },
    swing: { x: 0, y: 0 },
  };
}

/** Stands the racket at `pos` this instant, with no stroke carried over from where it was. */
export function placePaddle(paddle: Paddle, pos: Vec3): void {
  paddle.pos = { ...pos };
  paddle.prevPos = { ...pos };
  paddle.aim.x = pos.x;
  paddle.aim.y = pos.y;
  paddle.swing.x = 0;
  paddle.swing.y = 0;
}

export interface ControllerContext {
  phase: GamePhase;
  isServer: boolean;
  /** Ball in the controller's local frame. */
  ball: BallState;
  /** Where the ball will cross this player's plane, or null if it never will (see `predictMeetPoint`). */
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
  /** Moves the racket across its plane and strokes through the ball. Nothing else moves it. */
  update(paddle: Paddle, ctx: ControllerContext): void;
  resetForPoint(): void;
}

/**
 * How far back the stroke is read. A stroke is a movement of the hand, not an instant: read over too
 * short a window, a player who has swung and arrived at the ball is holding still at the moment of
 * contact and gets a dead block for a shot they really played. A window about as long as the stroke
 * itself is what makes the swing you felt the swing the ball gets.
 */
const SWING_WINDOW_MS = 110;
/** Short enough to catch a flick, long enough that one jittery frame is not a stroke. */
const MIN_SWING_SPAN_MS = 25;
const HISTORY_STEP_MS = 6;

/**
 * Turns the cursor into a spot on the racket's plane. Supplied by the renderer (`cursorToPlane`),
 * because the only mapping worth having is the one that puts the blade exactly where you are pointing,
 * and that is a property of the lens and the window, not a number anyone can write down here.
 */
export type CursorToPlane = (cursor: Vec2) => Vec2;

/**
 * The mouse moves the racket, freely and with no easing at all, across the plane it is held on in
 * front of you. Where the racket is when the ball arrives is one half of a stroke; how it is moving
 * is the other — sweeping up brushes topspin over the ball, down cuts backspin under it, sideways
 * puts sidespin on. A racket that is not moving plays no stroke at all, only a bare rebound.
 */
export class HumanController implements PaddleController {
  private history: Array<{ t: number; x: number; y: number }> = [];

  constructor(
    private readonly input: PointerInput,
    private readonly toPlane: CursorToPlane,
  ) {}

  resetForPoint(): void {
    this.history.length = 0;
  }

  update(paddle: Paddle, ctx: ControllerContext): void {
    // Straight from the mouse, this instant: no easing, no lag of our own. Where the cursor points is
    // where the blade goes, and the clamps below are the edge of what an arm can reach.
    const cursor = this.input.cursorAt(ctx.wallTime);
    const pointed = this.toPlane(cursor);
    const at = {
      x: clamp(pointed.x, -AIM_X_LIMIT, AIM_X_LIMIT),
      y: clamp(pointed.y, AIM_Y_MIN, AIM_Y_MAX),
    };
    paddle.aim.x = at.x;
    paddle.aim.y = at.y;
    paddle.pos.x = at.x;
    paddle.pos.y = at.y;

    // A few samples per frame is plenty to read a stroke from, and keeps the search below small.
    const last = this.history[this.history.length - 1];
    if (!last || ctx.wallTime - last.t >= HISTORY_STEP_MS) this.history.push({ t: ctx.wallTime, x: at.x, y: at.y });
    while (this.history.length > 2 && this.history[0]!.t < ctx.wallTime - SWING_WINDOW_MS) this.history.shift();
    this.readSwing(paddle.swing);
  }

  /**
   * The fastest movement anywhere in the window, not the average across it. A stroke is short and the
   * hand stops at the end of it; averaged over a window long enough to hold the whole stroke, a sharp
   * flick reads as a gentle drift, and reading only the last instant loses the stroke the moment the
   * hand settles. Taking the quickest stretch of the window gives the swing the player actually made,
   * and it fades on its own as that stretch falls out of the window.
   */
  private readSwing(out: Vec2): void {
    const h = this.history;
    let best = 0;
    out.x = 0;
    out.y = 0;
    for (let i = 0; i < h.length - 1; i++) {
      for (let j = i + 1; j < h.length; j++) {
        const span = (h[j]!.t - h[i]!.t) / 1000;
        if (span < MIN_SWING_SPAN_MS / 1000) continue;
        const vx = (h[j]!.x - h[i]!.x) / span;
        const vy = (h[j]!.y - h[i]!.y) / span;
        const speed = Math.hypot(vx, vy);
        if (speed > best) {
          best = speed;
          out.x = vx;
          out.y = vy;
        }
      }
    }
  }
}
