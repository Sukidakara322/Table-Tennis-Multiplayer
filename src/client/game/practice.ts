import {
  BALL_SLOWDOWN,
  DT,
  HALF_LENGTH,
  HALF_WIDTH,
  HIT_COOLDOWN,
  BODY_FOLLOW_TIME,
  AIM_X_LIMIT,
  AIM_Y_MAX,
  AIM_Y_MIN,
  PADDLE_HOVER_Y,
  PADDLE_X_LIMIT,
  STAND_Z,
  SERVE_BALL_HEIGHT,
  SERVE_BALL_Z,
  SERVE_MIN_FLICK,
  SERVE_READY_Y,
  SERVE_REACH,
} from '../../shared/constants';
import { toLocalBall, toLocalVec, toWorldBall, toWorldVec } from '../../shared/frames';
import { bladeContact } from '../../shared/contact';
import { computeReturn } from '../../shared/hit';
import { awardPoint, createMatch, currentServer, isMatchPoint, type GamesToWin, type MatchState } from '../../shared/match';
import { stepBall, type BallState, type PhysicsEvent } from '../../shared/physics';
import { predictMeetPoint, type MeetPoint } from '../../shared/predict';
import { paddleFace } from '../../shared/racket';
import { applyRallyEvent, createRally, type RallyEvent, type RallyOutcome, type RallyState } from '../../shared/referee';
import { otherPlayer, PLAYERS, type PlayerIndex } from '../../shared/types';
import { clamp, copyVec3, lerp, length3, vec3, type Vec2, type Vec3 } from '../../shared/vec';
import { loadSettings, saveSettings } from '../settings';
import { GameUi, REASON_TEXT } from '../ui/gameUi';
import { BotController, type BotDifficulty } from './bot';
import { PointerInput } from './input';
import {
  createPaddle,
  HumanController,
  placePaddle,
  type GamePhase,
  type Paddle,
  type PaddleController,
} from './paddle';
import { GameRenderer, PLAYER_COLORS, type RenderFrame } from './renderer';
import { Sfx } from './sfx';

export interface PracticeOptions {
  nickname: string;
  gamesToWin: GamesToWin;
  difficulty: BotDifficulty;
  onExit(): void;
}

const HUMAN: PlayerIndex = 0;
const BOT: PlayerIndex = 1;
const POINT_PAUSE = 1.4;
const GAME_PAUSE = 2.4;
/** Nothing has happened for this long: the point is dead. Scaled with the ball's slower flights. */
const RALLY_TIMEOUT = 5 * BALL_SLOWDOWN;
const MAX_STEPS_PER_FRAME = 30;

/** A full match against the bot, running entirely in the browser. */
export class PracticeSession {
  private readonly root: HTMLElement;
  private readonly renderer: GameRenderer;
  private readonly ui: GameUi;
  private readonly input: PointerInput;
  private readonly sfx = new Sfx();
  private readonly human: HumanController;
  private readonly controllers: [PaddleController, PaddleController];
  private readonly names: [string, string];
  private readonly paddles: [Paddle, Paddle] = [createPaddle(), createPaddle()];
  private readonly events: PhysicsEvent[] = [];

  private match: MatchState;
  private rally: RallyState;
  private ball: BallState = { pos: vec3(), vel: vec3(), spin: vec3() };
  private prevBallPos: Vec3 = vec3();
  private phase: GamePhase = 'serve';
  private meetPoints: [MeetPoint | null, MeetPoint | null] = [null, null];
  private incomingIds: [number, number] = [0, 0];
  private lastStrokeTime: [number, number] = [-Infinity, -Infinity];
  /** Each player's body centre x (local frame); the grip points back towards it. */
  private bodyX: [number, number] = [0, 0];
  /** Where the view is leaning, -1..1 across the table, and whether it is frozen. See `trackLean`. */
  private viewLean = 0;
  private viewHeld = false;
  /** Sim time the meeting points were worked out at, so their countdown stays honest. */
  private meetPredictedAt = 0;
  private phaseTimer = 0;
  private simTime = 0;
  private lastActivity = 0;

  private paused = true;
  private disposed = false;
  private rafId = 0;
  private lastFrame = performance.now();
  private accumulator = 0;

  constructor(parent: HTMLElement, private readonly options: PracticeOptions) {
    const settings = loadSettings();
    this.names = [options.nickname, `Bot · ${options.difficulty}`];

    this.root = document.createElement('div');
    this.root.className = 'game';
    parent.append(this.root);

    this.renderer = new GameRenderer(this.root);
    this.renderer.setViewPlayer(HUMAN);
    this.renderer.setGlow(settings.glow);

    this.input = new PointerInput(this.root, {
      onLockChange: (locked) => this.handleLockChange(locked),
      onPrimaryDown: () => {},
    });
    this.input.sensitivity = settings.sensitivity;
    this.limitCursorToReach();

    this.human = new HumanController(this.input, (cursor) => this.renderer.cursorToPlane(cursor));
    this.controllers = [this.human, new BotController(options.difficulty)];

    this.ui = new GameUi(this.root, this.names, settings, {
      onStart: () => this.resume(),
      onResume: () => this.resume(),
      onRestart: () => {
        this.resetMatch();
        this.resume();
      },
      onLeave: () => this.options.onExit(),
      onSensitivity: (value) => {
        this.input.sensitivity = value;
        saveSettings({ sensitivity: value });
      },
      onGlow: (value) => {
        this.renderer.setGlow(value);
        saveSettings({ glow: value });
      },
    });

    this.match = createMatch({ gamesToWin: options.gamesToWin }, Math.random() < 0.5 ? 0 : 1);
    this.rally = createRally(currentServer(this.match));
    this.resetMatch();
    this.rafId = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.input.dispose();
    this.ui.dispose();
    this.renderer.dispose();
    this.sfx.dispose();
    this.root.remove();
  }

  // ─── Flow ────────────────────────────────────────────────────────────────

  private async resume(): Promise<void> {
    this.sfx.unlock();
    this.sfx.click();
    if (!(await this.input.requestLock())) {
      this.ui.showPause('Click Resume again to grab the mouse.');
    }
  }

  private handleLockChange(locked: boolean): void {
    if (this.disposed) return;
    if (locked) {
      this.paused = false;
      this.lastFrame = performance.now();
      this.accumulator = 0;
      this.ui.hideOverlays();
      return;
    }
    this.paused = true;
    if (this.phase !== 'over') this.ui.showPause();
  }

  private resetMatch(): void {
    this.match = createMatch({ gamesToWin: this.options.gamesToWin }, Math.random() < 0.5 ? 0 : 1);
    this.startRally();
  }

  private startRally(): void {
    const server = currentServer(this.match);
    this.rally = createRally(server);
    this.phase = 'serve';
    this.meetPoints = [null, null];
    this.lastActivity = this.simTime;
    this.controllers.forEach((c) => c.resetForPoint());
    this.resetPaddles();
    this.holdBallForServe();
    this.prevBallPos = copyVec3(this.ball.pos);
    this.renderer.clearTrail();
    this.ui.setScore(this.match, server);
    this.ui.setHint(server === HUMAN ? 'To serve, bring the racket down to the ball and flick: up for topspin, down for backspin' : null);

    for (const player of PLAYERS) {
      if (isMatchPoint(this.match, player)) {
        this.ui.showBanner('Match point', this.names[player], player, 1.2);
        break;
      }
    }
  }

  /**
   * Sets both rackets back to the middle of their plane for a new point, rather than leaving them
   * wherever the rally ended. This runs when the next point starts, a beat after the last one was
   * decided, so the players see the point out first. The mouse is moved with the racket, or the next
   * flick would read as a stroke back to wherever the cursor had been left.
   */
  /**
   * Stops the cursor at the edge of what the racket can reach. The mapping is one-to-one on screen, so
   * the reachable plane covers only part of it; letting the cursor run past that would leave the mouse
   * and the blade disagreeing, and every stroke back from the edge would start with dead travel.
   */
  private limitCursorToReach(): void {
    const across = this.renderer.planeToCursor({ x: AIM_X_LIMIT, y: PADDLE_HOVER_Y });
    const low = this.renderer.planeToCursor({ x: 0, y: AIM_Y_MIN });
    const high = this.renderer.planeToCursor({ x: 0, y: AIM_Y_MAX });
    this.input.limit = { x: Math.abs(across.x), y: Math.max(Math.abs(low.y), Math.abs(high.y)) };
  }

  private resetPaddles(): void {
    const server = currentServer(this.match);
    // The server starts a little higher, so the ball waiting below the blade can be seen at all.
    const readyFor = (player: PlayerIndex) => ({ x: 0, y: player === server ? SERVE_READY_Y : PADDLE_HOVER_Y });
    for (const player of PLAYERS) {
      const ready = readyFor(player);
      placePaddle(this.paddles[player], { x: ready.x, y: ready.y, z: STAND_Z });
    }
    this.bodyX = [0, 0];
    // The mouse is put back where the racket now is, or the jump from wherever the cursor was left
    // would read as a stroke — and, on a serve, strike the waiting ball on the spot.
    const cursor = this.renderer.planeToCursor(readyFor(HUMAN));
    this.input.recentre(cursor.x, cursor.y);
  }

  // ─── Loop ────────────────────────────────────────────────────────────────

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const dtMs = Math.min(now - this.lastFrame, 100);
    this.lastFrame = now;

    if (!this.paused) {
      this.accumulator += dtMs / 1000;
      const steps = Math.floor(this.accumulator / DT);
      const run = Math.min(steps, MAX_STEPS_PER_FRAME);
      for (let i = 0; i < run; i++) this.step(now - (run - 1 - i) * DT * 1000);
      this.accumulator -= steps * DT;
    }

    const alpha = this.paused ? 1 : clamp(this.accumulator / DT, 0, 1);
    this.renderer.render(this.buildRenderFrame(alpha), dtMs / 1000);
  };

  private step(wallTime: number): void {
    this.simTime += DT;
    this.prevBallPos = copyVec3(this.ball.pos);
    for (const paddle of this.paddles) paddle.prevPos = copyVec3(paddle.pos);

    this.updatePaddles(wallTime);

    switch (this.phase) {
      case 'serve':
        this.holdBallForServe();
        this.checkServeContact();
        break;
      case 'rally':
        this.advanceBall();
        this.checkRallyContacts();
        if (this.simTime - this.lastActivity > RALLY_TIMEOUT || Math.abs(this.ball.pos.x) > 8 || Math.abs(this.ball.pos.z) > 10) {
          this.referee({ type: 'out' });
        }
        break;
      case 'point':
        this.advanceBall();
        this.phaseTimer -= DT;
        if (this.phaseTimer <= 0) this.finishPoint();
        break;
      case 'over':
        break;
    }
  }

  private updatePaddles(wallTime: number): void {
    for (const player of PLAYERS) {
      const paddle = this.paddles[player];
      const ball = toLocalBall(player, this.ball);
      // Where the racket goes is entirely the controller's — the mouse, for a person. The game only
      // holds it to its plane; it never nudges it towards a ball, not even one it cannot reach.
      this.controllers[player].update(paddle, {
        phase: this.phase,
        isServer: this.rally.server === player,
        ball,
        meetPoint: this.countdownTo(player),
        incomingBounced: this.rally.stage === 'awaitingReturn' && this.rally.lastHitter !== player,
        incomingId: this.incomingIds[player],
        wallTime,
        dt: DT,
      });
      // The plane is fixed, so depth is not something anyone sets — it simply is.
      paddle.pos.z = STAND_Z;
      paddle.pos.x = clamp(paddle.pos.x, -PADDLE_X_LIMIT, PADDLE_X_LIMIT);
      paddle.pos.y = clamp(paddle.pos.y, AIM_Y_MIN, AIM_Y_MAX);
      // The body shuffles after the racket, so the stance lags a quick move across the table.
      this.bodyX[player] += (paddle.pos.x - this.bodyX[player]) * (DT / BODY_FOLLOW_TIME);
    }
    this.trackLean();
  }

  /**
   * Where the view leans: towards the ball, but only while the ball is on the far half. The instant it
   * crosses the net onto yours the view freezes, and it stays frozen until the ball is back over.
   *
   * That freeze is the whole point of this. The racket stands at a fixed place in the world, so any
   * movement of the camera slides the blade across the screen while your hand has not moved — and
   * everything from the moment the ball crosses to the moment it leaves again is you aiming, striking
   * and following through. The crossing is the right line to draw, not the bounce: by the bounce you
   * have been tracking the ball down for half a second already.
   *
   * The far half is the whole of the rest of the rally, which is plenty of time for the view to travel
   * — and stopping the target is not enough on its own, since the eye would go on easing towards it.
   * The eye itself is pinned; see `trackLean` on the renderer.
   */
  private trackLean(): void {
    const ballLocal = toLocalVec(HUMAN, this.ball.pos);
    this.viewHeld = this.phase === 'rally' && ballLocal.z > 0;
    if (this.viewHeld) return;
    this.viewLean = clamp(ballLocal.x / HALF_WIDTH, -1, 1);
  }

  // ─── Ball ────────────────────────────────────────────────────────────────

  /**
   * The ball waits low in front of the server, following them sideways: moving left and right chooses
   * where the serve starts from, and flicking the racket through it serves. Its height is fixed rather
   * than riding with the blade, because a serve struck from up near the top of the racket's plane has
   * nowhere legal to bounce (see SERVE_BALL_HEIGHT) — so you come down to it instead.
   */
  private holdBallForServe(): void {
    const server = this.rally.server;
    const paddle = this.paddles[server];
    const local: BallState = {
      pos: { x: clamp(paddle.pos.x, -HALF_WIDTH, HALF_WIDTH), y: SERVE_BALL_HEIGHT, z: SERVE_BALL_Z },
      vel: vec3(),
      spin: vec3(),
    };
    this.ball = toWorldBall(server, local);
  }

  private advanceBall(): void {
    this.events.length = 0;
    stepBall(this.ball, this.events);
    for (const event of this.events) this.handlePhysicsEvent(event);
  }

  private handlePhysicsEvent(event: PhysicsEvent): void {
    const live = this.phase === 'rally';
    switch (event.type) {
      case 'table': {
        this.renderer.bounceEffect(event.pos, PLAYER_COLORS[event.side], event.speed);
        this.sfx.bounce(event.speed / 5);
        if (live) {
          this.referee({ type: 'bounce', side: event.side });
          this.refreshMeetPoints();
        }
        break;
      }
      case 'net':
        this.renderer.netEffect(event.pos);
        this.sfx.net();
        if (live) {
          this.referee({ type: 'net' });
          this.refreshMeetPoints();
        }
        break;
      case 'side':
      case 'floor':
        if (event.speed > 0.8) this.sfx.floor();
        if (live) this.referee({ type: 'out' });
        break;
    }
  }

  /** Only the bot reads this; the human sees nothing of it. */
  private refreshMeetPoints(): void {
    this.meetPoints = [null, null];
    if (this.phase !== 'rally' || this.rally.lastHitter === null) return;
    const receiver = otherPlayer(this.rally.lastHitter);
    const alreadyBounced = this.rally.stage === 'awaitingReturn';
    this.meetPoints[receiver] = predictMeetPoint(toLocalBall(receiver, this.ball), alreadyBounced);
    this.meetPredictedAt = this.simTime;
  }

  /**
   * The meeting point as it stands now. It is only worked out when the ball is struck or bounces, so
   * its "seconds from now" has to be counted down since then — otherwise a bot waiting for the ball
   * would never see the moment to play its stroke arrive.
   */
  private countdownTo(player: PlayerIndex): MeetPoint | null {
    const meet = this.meetPoints[player];
    if (!meet) return null;
    return { pos: meet.pos, time: meet.time - (this.simTime - this.meetPredictedAt) };
  }

  // ─── Contacts ────────────────────────────────────────────────────────────

  /**
   * Contact between the ball and a player's racket, in that player's frame. The racket stands where the
   * player put it, so this is a real crossing test: over the step, the ball must pass through the plane
   * of the blade and be inside the blade's face when it does. Ball and racket both move in a straight
   * line during the step, so the crossing is solved exactly rather than sampled.
   */
  private findContact(player: PlayerIndex): { contact: BallState; offset: Vec2; overTable: boolean } | null {
    if (this.simTime - this.lastStrokeTime[player] < HIT_COOLDOWN) return null;
    const paddle = this.paddles[player];
    const ball = toLocalBall(player, this.ball);
    const prev = toLocalVec(player, this.prevBallPos);

    const hit = bladeContact(prev, ball.pos, paddle.prevPos, paddle.pos, paddleFace(paddle.pos, paddle.swing));
    if (!hit) return null;

    const bx = lerp(prev.x, ball.pos.x, hit.t);
    const by = lerp(prev.y, ball.pos.y, hit.t);
    const bz = lerp(prev.z, ball.pos.z, hit.t);
    return {
      contact: { pos: { x: bx, y: by, z: bz }, vel: ball.vel, spin: ball.spin },
      offset: hit.offset,
      overTable: Math.abs(bx) <= HALF_WIDTH && Math.abs(bz) <= HALF_LENGTH,
    };
  }

  private checkServeContact(): void {
    const server = this.rally.server;
    const paddle = this.paddles[server];
    const swingSpeed = Math.hypot(paddle.swing.x, paddle.swing.y);
    // The ball is in your own hand here, held against the racket, so the flick is what strikes it
    // rather than the racket having to catch it up: flick up to brush topspin onto it, down to cut
    // under it for backspin. Requiring the racket to run the ball down would make a backspin serve
    // impossible, since flicking downwards only carries the racket away from a waiting ball. What it
    // does require is being there: bring the racket to the ball, then flick.
    const ball = toLocalBall(server, this.ball);
    const reach = Math.hypot(paddle.pos.x - ball.pos.x, paddle.pos.y - ball.pos.y, paddle.pos.z - ball.pos.z);
    if (reach > SERVE_REACH || Math.abs(paddle.swing.y) < SERVE_MIN_FLICK) return;

    const face = paddleFace(paddle.pos, paddle.swing);
    const contact: BallState = { pos: copyVec3(ball.pos), vel: ball.vel, spin: ball.spin };
    const out = computeReturn({ contact, swing: paddle.swing, offset: { x: 0, y: 0 }, face, isServe: true });
    this.ball = toWorldBall(server, out);
    this.phase = 'rally';
    this.referee({ type: 'serve', player: server });
    this.onStroke(server, swingSpeed);
  }

  private checkRallyContacts(): void {
    for (const player of PLAYERS) {
      if (this.phase !== 'rally') return;
      const hit = this.findContact(player);
      if (!hit) continue;
      const paddle = this.paddles[player];
      const face = paddleFace(paddle.pos, paddle.swing);
      const out = computeReturn({ contact: hit.contact, swing: paddle.swing, offset: hit.offset, face, isServe: false });
      this.ball = toWorldBall(player, out);
      this.referee({ type: 'hit', player, overTable: hit.overTable });
      this.onStroke(player, Math.hypot(paddle.swing.x, paddle.swing.y) + length3(hit.contact.vel) * 0.3);
    }
  }

  private onStroke(player: PlayerIndex, intensity: number): void {
    this.lastStrokeTime[player] = this.simTime;
    const strength = clamp(intensity / 8, 0.1, 1);
    this.renderer.hitEffect(this.ball.pos, player, strength);
    this.sfx.hit(strength);
    this.lastActivity = this.simTime;
    const receiver = otherPlayer(player);
    this.incomingIds[receiver] += 1;
    this.refreshMeetPoints();
  }

  // ─── Rules ───────────────────────────────────────────────────────────────

  private referee(event: RallyEvent): void {
    if (this.phase !== 'rally') return;
    const { rally, outcome } = applyRallyEvent(this.rally, event);
    this.rally = rally;
    if (outcome) this.resolve(outcome);
  }

  private resolve(outcome: RallyOutcome): void {
    this.phase = 'point';
    this.meetPoints = [null, null];
    this.phaseTimer = POINT_PAUSE;

    if (outcome.kind === 'let') {
      this.ui.showBanner('Let', 'Serve touched the net — replay', null);
      return;
    }

    const result = awardPoint(this.match, outcome.winner);
    this.match = result.match;
    this.ui.setScore(this.match, null);
    this.sfx.point(outcome.winner === HUMAN);

    if (result.matchWinner !== null) {
      this.phaseTimer = GAME_PAUSE;
      const [a, b] = this.match.completedGames.at(-1)!;
      this.ui.showBanner('Match', `${this.names[result.matchWinner]} · ${a}–${b}`, result.matchWinner, GAME_PAUSE);
    } else if (result.gameWinner !== null) {
      this.phaseTimer = GAME_PAUSE;
      const [a, b] = this.match.completedGames.at(-1)!;
      this.ui.showBanner('Game', `${this.names[result.gameWinner]} · ${a}–${b}`, result.gameWinner, GAME_PAUSE);
    } else {
      const who = outcome.winner === HUMAN ? 'Your point' : `${this.names[BOT]} scores`;
      this.ui.showBanner(who, REASON_TEXT[outcome.reason], outcome.winner);
    }
  }

  private finishPoint(): void {
    if (this.match.winner !== null) {
      this.phase = 'over';
      this.paused = true;
      this.ui.setHint(null);
      this.ui.showMatchOver(this.match, this.names);
      this.input.exitLock();
      return;
    }
    this.startRally();
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  private buildRenderFrame(alpha: number): RenderFrame {
    const pos = {
      x: lerp(this.prevBallPos.x, this.ball.pos.x, alpha),
      y: lerp(this.prevBallPos.y, this.ball.pos.y, alpha),
      z: lerp(this.prevBallPos.z, this.ball.pos.z, alpha),
    };
    // Paddles are drawn where they are right now, not interpolated: they follow the mouse, not physics,
    // so interpolating would only draw them a step behind the hand.
    const paddleFrame = (player: PlayerIndex) => {
      const paddle = this.paddles[player];
      const local = paddle.pos;
      return {
        pos: toWorldVec(player, local),
        swing: paddle.swing,
        face: paddleFace(local, paddle.swing),
        bodyX: this.bodyX[player],
      };
    };

    return {
      ball: { pos, vel: this.ball.vel, spin: this.ball.spin },
      paddles: [paddleFrame(0), paddleFrame(1)],
      viewLean: this.viewLean,
      viewHeld: this.viewHeld,
    };
  }
}
