import {
  BALL_SLOWDOWN,
  DT,
  HALF_LENGTH,
  HALF_WIDTH,
  HIT_COOLDOWN,
  PADDLE_DEPTH_RETURN_SPEED,
  PADDLE_HIT_RADIUS,
  REACH_FAR_Z,
  REACH_IN_SPEED,
  REACH_IN_Z,
  BODY_FOLLOW_TIME,
  SERVE_BALL_HEIGHT,
  SERVE_BALL_Z,
  SERVE_MIN_FLICK,
} from '../../shared/constants';
import { toLocalBall, toLocalVec, toWorldBall, toWorldVec } from '../../shared/frames';
import { computeReturn } from '../../shared/hit';
import { awardPoint, createMatch, currentServer, isMatchPoint, type GamesToWin, type MatchState } from '../../shared/match';
import { stepBall, type BallState, type PhysicsEvent } from '../../shared/physics';
import { predictMeetPoint, type MeetPoint } from '../../shared/predict';
import { paddleFace, reachNearZ } from '../../shared/racket';
import { applyRallyEvent, createRally, type RallyEvent, type RallyOutcome, type RallyState } from '../../shared/referee';
import { otherPlayer, PLAYERS, type PlayerIndex } from '../../shared/types';
import { approach, clamp, closestApproach, copyVec3, lerp, length3, vec3, type Vec2, type Vec3 } from '../../shared/vec';
import { loadSettings, saveSettings } from '../settings';
import { GameUi, REASON_TEXT } from '../ui/gameUi';
import { BotController, type BotDifficulty } from './bot';
import { PointerInput } from './input';
import { clampPaddle, createPaddle, HumanController, type GamePhase, type Paddle, type PaddleController } from './paddle';
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
  /** Each player's body centre x (local frame); the arm arc bends relative to it. */
  private bodyX: [number, number] = [0, 0];
  /** Latched once an incoming ball is inside a player's reach, so the paddle keeps its depth. */
  private travellingWithBall: [boolean, boolean] = [false, false];
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

    this.human = new HumanController(this.input, this.renderer, HUMAN);
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
    this.holdBallForServe();
    this.prevBallPos = copyVec3(this.ball.pos);
    this.renderer.clearTrail();
    this.ui.setScore(this.match, server);
    this.ui.setHint(server === HUMAN ? 'Move sideways to place your serve, then flick up or down through the ball' : null);

    for (const player of PLAYERS) {
      if (isMatchPoint(this.match, player)) {
        this.ui.showBanner('Match point', this.names[player], player, 1.2);
        break;
      }
    }
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
      // The game sets depth; controllers (mouse or bot) steer left/right and height.
      paddle.pos.z = this.paddleDepth(player, ball);
      this.controllers[player].update(paddle, {
        phase: this.phase,
        isServer: this.rally.server === player,
        ball,
        meetPoint: this.meetPoints[player],
        incomingId: this.incomingIds[player],
        wallTime,
        dt: DT,
      });
      clampPaddle(paddle.pos);
      // The body shuffles after the aim, so a quick reach to the side bends along the arm arc.
      this.bodyX[player] += (paddle.aim.x - this.bodyX[player]) * (DT / BODY_FOLLOW_TIME);
    }
  }

  /**
   * Same rule for every player: while a ball is coming at you and inside your reach, your paddle is at
   * exactly the ball's depth, so overlapping on screen means touching. Otherwise it glides back to the
   * start of the reach, which bends back along the arm arc when reaching wide, high or low.
   * The server's paddle sits at the toss depth.
   *
   * The reach stops at your end line until the ball bounces on your half; after that you lean in after
   * it, out to REACH_IN_Z. That is what makes a ball dying short of the end line playable, and because
   * the lean only starts after the bounce it can never turn into a volley.
   */
  private paddleDepth(player: PlayerIndex, ball: BallState): number {
    const paddle = this.paddles[player];
    const glide = (target: number) => approach(paddle.pos.z, target, PADDLE_DEPTH_RETURN_SPEED * DT);
    const isServer = this.rally.server === player;
    if (this.phase === 'serve' && isServer) return glide(SERVE_BALL_Z);

    const incoming = this.phase === 'rally' && this.rally.lastHitter !== null && this.rally.lastHitter !== player;
    if (!incoming) {
      this.travellingWithBall[player] = false;
      return glide(reachNearZ(paddle.aim.x, paddle.aim.y, this.bodyX[player]));
    }
    // Once the ball is inside the reach it stays with the paddle until this ball is done. Without this
    // latch, moving the mouse (which bends the reach along the arm arc) would drop the ball mid-stroke.
    if (!this.travellingWithBall[player]) {
      const near = reachNearZ(paddle.aim.x, paddle.aim.y, this.bodyX[player]);
      if (ball.pos.z >= near) {
        this.travellingWithBall[player] = true;
      } else if (this.rally.stage !== 'awaitingReturn') {
        return glide(near);
      } else {
        // Lean in at arm's speed instead of snapping onto the ball: a short ball has to be read early
        // enough to get there, and while leaning the paddle is not yet at the ball's depth.
        const target = Math.max(ball.pos.z, REACH_IN_Z);
        const leaned = approach(paddle.pos.z, target, REACH_IN_SPEED * DT);
        if (leaned > target) return leaned;
        this.travellingWithBall[player] = true;
      }
    }
    return clamp(ball.pos.z, REACH_IN_Z, REACH_FAR_Z);
  }

  // ─── Ball ────────────────────────────────────────────────────────────────

  /**
   * The ball waits in front of the server at a fixed height, following them sideways: moving left and
   * right chooses where the serve starts from, and moving the paddle up or down through it serves.
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
    this.meetPoints[receiver] = predictMeetPoint(toLocalBall(receiver, this.ball), alreadyBounced, this.bodyX[receiver]);
  }

  // ─── Contacts ────────────────────────────────────────────────────────────

  /**
   * Contact between the ball and a player's paddle, in that player's frame. The paddle travels at the
   * ball's depth (see `paddleDepth`), so this is an overlap test: the ball's centre within the drawn
   * blade plus the ball's radius. Both move in a straight line during the step, so their closest
   * approach is solved exactly — neither a fast ball nor a fast swing can slip between samples.
   */
  private findContact(player: PlayerIndex): { contact: BallState; offset: Vec2; overTable: boolean } | null {
    if (this.simTime - this.lastStrokeTime[player] < HIT_COOLDOWN) return null;
    const paddle = this.paddles[player];
    const ball = toLocalBall(player, this.ball);
    const prev = toLocalVec(player, this.prevBallPos);

    // Gap between ball and paddle at the start and end of the step; it changes linearly in between.
    const startX = prev.x - paddle.prevPos.x;
    const startY = prev.y - paddle.prevPos.y;
    const endX = ball.pos.x - paddle.pos.x;
    const endY = ball.pos.y - paddle.pos.y;
    const t = closestApproach({ x: startX, y: startY }, { x: endX, y: endY });
    const ox = startX + (endX - startX) * t;
    const oy = startY + (endY - startY) * t;
    if (ox * ox + oy * oy > PADDLE_HIT_RADIUS * PADDLE_HIT_RADIUS) return null;

    const bz = lerp(prev.z, ball.pos.z, t);
    if (Math.abs(bz - lerp(paddle.prevPos.z, paddle.pos.z, t)) > PADDLE_HIT_RADIUS) return null;

    const bx = lerp(prev.x, ball.pos.x, t);
    const by = lerp(prev.y, ball.pos.y, t);
    return {
      contact: { pos: { x: bx, y: by, z: bz }, vel: ball.vel, spin: ball.spin },
      offset: { x: ox, y: oy },
      overTable: Math.abs(bx) <= HALF_WIDTH && Math.abs(bz) <= HALF_LENGTH,
    };
  }

  private checkServeContact(): void {
    const server = this.rally.server;
    const paddle = this.paddles[server];
    const hit = this.findContact(server);
    const swingSpeed = Math.hypot(paddle.swing.x, paddle.swing.y);
    // Served by moving the paddle up or down through the waiting ball: up brushes topspin onto it,
    // down brushes backspin. A sideways drift alone is not a serve.
    if (!hit || Math.abs(paddle.swing.y) < SERVE_MIN_FLICK) return;

    const face = paddleFace(paddle.pos, paddle.swing);
    const out = computeReturn({ contact: hit.contact, swing: paddle.swing, offset: hit.offset, face, isServe: true });
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
      followX: this.paddles[HUMAN].aim.x,
    };
  }
}
