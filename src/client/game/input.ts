import { clamp, type Vec2 } from '../../shared/vec';

interface CursorSample {
  t: number;
  x: number;
  y: number;
}

export interface PointerInputCallbacks {
  onLockChange(locked: boolean): void;
  onPrimaryDown(): void;
}

const HISTORY_MS = 400;
/** Browsers occasionally report a huge jump right after locking; ignore those. */
const MAX_EVENT_MOVEMENT = 250;

/**
 * A virtual cursor driven by pointer-lock mouse movement, in normalised device coordinates
 * (-1..1, y up). Samples are timestamped so physics steps can read the cursor at their own time.
 */
export class PointerInput {
  sensitivity = 1;
  locked = false;
  /**
   * How far the cursor may travel from the centre of the screen, per axis. The racket can only be
   * within arm's reach, so only part of the screen means anything; without this the cursor wanders out
   * into the part that does not, and then has to be dragged all the way back before the blade so much
   * as twitches. Set from the reachable range once the lens is known (see `planeToCursor`).
   */
  limit: Vec2 = { x: 1, y: 1 };
  /** Starts centred, which is where the racket is held between points (see `resetPaddles`). */
  private samples: CursorSample[] = [{ t: performance.now(), x: 0, y: 0 }];

  constructor(
    private readonly target: HTMLElement,
    private readonly callbacks: PointerInputCallbacks,
  ) {
    document.addEventListener('pointerlockchange', this.handleLockChange);
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('mousedown', this.handleMouseDown);
  }

  async requestLock(): Promise<boolean> {
    try {
      await this.target.requestPointerLock();
      return true;
    } catch {
      // Chrome refuses a re-lock shortly after Esc; the caller asks the player to click again.
      return false;
    }
  }

  exitLock(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  /**
   * Puts the cursor somewhere without the mouse having moved, and forgets where it had been. Used
   * between points: the racket is set back to its ready place, and the mouse has to agree with it, or
   * the next flick of the wrist would read as an enormous stroke back to wherever the cursor still was.
   */
  recentre(x: number, y: number): void {
    this.samples = [{ t: performance.now(), x: this.hold(x, this.limit.x), y: this.hold(y, this.limit.y) }];
  }

  private hold(value: number, limit: number): number {
    const edge = Math.min(Math.abs(limit), 1);
    return clamp(value, -edge, edge);
  }

  /** Cursor position at time `t` (performance.now() milliseconds). */
  cursorAt(t: number): Vec2 {
    const samples = this.samples;
    const last = samples[samples.length - 1]!;
    if (t >= last.t) return { x: last.x, y: last.y };
    for (let i = samples.length - 1; i > 0; i--) {
      const a = samples[i - 1]!;
      if (a.t <= t) {
        const b = samples[i]!;
        const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
    }
    return { x: samples[0]!.x, y: samples[0]!.y };
  }

  dispose(): void {
    this.exitLock();
    document.removeEventListener('pointerlockchange', this.handleLockChange);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mousedown', this.handleMouseDown);
  }

  private handleLockChange = (): void => {
    this.locked = document.pointerLockElement === this.target;
    this.callbacks.onLockChange(this.locked);
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    const mx = clamp(event.movementX, -MAX_EVENT_MOVEMENT, MAX_EVENT_MOVEMENT);
    const my = clamp(event.movementY, -MAX_EVENT_MOVEMENT, MAX_EVENT_MOVEMENT);
    const last = this.samples[this.samples.length - 1]!;
    const x = this.hold(last.x + (mx / (window.innerWidth / 2)) * this.sensitivity, this.limit.x);
    const y = this.hold(last.y - (my / (window.innerHeight / 2)) * this.sensitivity, this.limit.y);
    const t = Math.max(event.timeStamp, last.t);
    this.samples.push({ t, x, y });
    while (this.samples.length > 2 && this.samples[0]!.t < t - HISTORY_MS) this.samples.shift();
  };

  private handleMouseDown = (event: MouseEvent): void => {
    if (this.locked && event.button === 0) this.callbacks.onPrimaryDown();
  };
}
