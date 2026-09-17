import {
  DT,
  HALF_LENGTH,
  HALF_WIDTH,
  MAX_PADDLE_Z,
  MIN_PADDLE_Z,
  PADDLE_DEPTH_SPEED,
  PADDLE_HIT_RADIUS,
  READY_Z,
  SERVE_Z,
  TOSS_HEIGHT_ABOVE_PADDLE,
  TOSS_SPEED,
  TOSS_Z_IN_FRONT_OF_PADDLE,
} from '../../shared/constants';
import { toLocalBall, toLocalVec, toWorldBall, toWorldVec } from '../../shared/frames';
import { computeReturn, HIT_TUNING } from '../../shared/hit';
import { awardPoint, createMatch, currentServer, isMatchPoint, type GamesToWin, type MatchState } from '../../shared/match';
import { stepBall, type BallState, type PhysicsEvent } from '../../shared/physics';
import { predictIntercept, type Intercept } from '../../shared/predict';
import { applyRallyEvent, createRally, type RallyEvent, type RallyOutcome, type RallyState } from '../../shared/referee';
import { otherPlayer, PLAYERS, type PlayerIndex } from '../../shared/types';
import { approach, clamp, copyVec3, lerp, length3, vec3, type Vec3 } from '../../shared/vec';
import { loadSettings, saveSettings } from '../settings';
import { GameUi, REASON_TEXT } from '../ui/gameUi';
import { BotController, type BotDifficulty } from './bot';
import { PointerInput } from './input';
import { createPaddle, HumanController, type GamePhase, type Paddle, type PaddleController } from './paddle';
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
const RALLY_TIMEOUT = 5;
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
  private intercepts: [Intercept | null, Intercept | null] = [null, null];
  private incomingIds: [number, number] = [0, 0];
  private phaseTimer = 0;
  private simTime = 0;
  private lastActivity = 0;

  private paused = true;
  private disposed = false;
  private rafId = 0;
  private lastFrame = performance.now();
  private accumulator = 0;
  private aimMarker: boolean;

  constructor(parent: HTMLElement, private readonly options: PracticeOptions) {
    const settings = loadSettings();
    this.aimMarker = settings.aimMarker;
    this.names = [options.nickname, `Bot · ${options.difficulty}`];

    this.root = document.createElement('div');
    this.root.className = 'game';
    parent.append(this.root);

    this.renderer = new GameRenderer(this.root);
    this.renderer.setViewPlayer(HUMAN);

    this.input = new PointerInput(this.root, {
      onLockChange: (locked) => this.handleLockChange(locked),
      onPrimaryDown: () => {
        if (this.phase === 'serve' && this.rally.server === HUMAN) this.human.requestToss();
      },
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
      onAimMarker: (enabled) => {
        this.aimMarker = enabled;
        saveSettings({ aimMarker: enabled });
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
    this.intercepts = [null, null];
    this.lastActivity = this.simTime;
    this.controllers.forEach((c) => c.resetForPoint());
    this.holdBallForServe();
    this.prevBallPos = copyVec3(this.ball.pos);
    this.renderer.clearTrail();
    this.ui.setScore(this.match, server);
    this.ui.setHint(server === HUMAN ? 'Click to toss the ball, then swing through it' : null);

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
        if (this.controllers[this.rally.server].consumeToss()) this.toss();
        break;
      case 'toss':
        this.advanceBall();
        if (this.ball.pos.y < -0.3) {
          this.phase = 'serve'; // dropped toss: try again
          this.controllers[this.rally.server].resetForPoint();
        } else {
          this.checkServeContact();
        }
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
      paddle.pos.z = approach(paddle.pos.z, this.depthTarget(player), PADDLE_DEPTH_SPEED * DT);
      this.controllers[player].update(paddle, {
        phase: this.phase,
        isServer: this.rally.server === player,
        ball: toLocalBall(player, this.ball),
        intercept: this.intercepts[player],
        incomingId: this.incomingIds[player],
        wallTime,
        dt: DT,
      });
    }
  }

  /** Auto-footwork: players only steer x/y; the game moves them in and out along the table. */
  private depthTarget(player: PlayerIndex): number {
    if (this.phase === 'serve' || this.phase === 'toss') return this.rally.server === player ? SERVE_Z : READY_Z;
    const intercept = this.intercepts[player];
    if (intercept && this.phase === 'rally') return clamp(intercept.pos.z, MIN_PADDLE_Z, MAX_PADDLE_Z);
    return READY_Z;
  }

  // ─── Ball ────────────────────────────────────────────────────────────────

  private holdBallForServe(): void {
    const server = this.rally.server;
    const paddle = this.paddles[server];
    const local: BallState = {
      pos: {
        x: clamp(paddle.pos.x, -HALF_WIDTH, HALF_WIDTH),
        y: Math.max(paddle.pos.y, 0) + TOSS_HEIGHT_ABOVE_PADDLE,
        z: paddle.pos.z - TOSS_Z_IN_FRONT_OF_PADDLE,
      },
      vel: vec3(),
      spin: vec3(),
    };
    this.ball = toWorldBall(server, local);
  }

  private toss(): void {
    this.holdBallForServe();
    this.ball.vel.y = TOSS_SPEED;
    this.phase = 'toss';
    this.sfx.toss();
    this.ui.setHint(null);
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
          this.refreshIntercepts();
        }
        break;
      }
      case 'net':
        this.renderer.netEffect(event.pos);
        this.sfx.net();
        if (live) {
          this.referee({ type: 'net' });
          this.refreshIntercepts();
        }
        break;
      case 'side':
      case 'floor':
        if (event.speed > 0.8) this.sfx.floor();
        if (live) this.referee({ type: 'out' });
        break;
    }
  }

  private refreshIntercepts(): void {
    this.intercepts = [null, null];
    if (this.phase !== 'rally' || this.rally.lastHitter === null) return;
    const receiver = otherPlayer(this.rally.lastHitter);
    this.intercepts[receiver] = predictIntercept(toLocalBall(receiver, this.ball));
  }

  // ─── Contacts ────────────────────────────────────────────────────────────

  private checkServeContact(): void {
    const server = this.rally.server;
    const paddle = this.paddles[server];
    const ball = toLocalBall(server, this.ball);
    const ox = ball.pos.x - paddle.pos.x;
    const oy = ball.pos.y - paddle.pos.y;
    const swingSpeed = Math.hypot(paddle.swing.x, paddle.swing.y);
    const reach = PADDLE_HIT_RADIUS * 0.8;
    if (ball.vel.y >= 0 || ox * ox + oy * oy > reach * reach || swingSpeed < HIT_TUNING.serveMinSwing) return;

    const out = computeReturn({
      contact: ball,
      swing: paddle.swing,
      // Serve contact is detected at the edge of reach; scale so it isn't always off-centre.
      offset: { x: ox * 0.3, y: oy * 0.3 },
      isServe: true,
    });
    this.ball = toWorldBall(server, out);
    this.phase = 'rally';
    this.referee({ type: 'serve', player: server });
    this.onStroke(server, swingSpeed);
  }

  private checkRallyContacts(): void {
    for (const player of PLAYERS) {
      if (this.phase !== 'rally') return;
      const paddle = this.paddles[player];
      const ball = toLocalBall(player, this.ball);
      if (ball.vel.z <= 0) continue;
      const prev = toLocalVec(player, this.prevBallPos);
      const prevRel = prev.z - paddle.prevPos.z;
      const rel = ball.pos.z - paddle.pos.z;
      if (prevRel >= 0 || rel < 0) continue;

      // Where both were when the ball crossed the paddle plane.
      const t = prevRel / (prevRel - rel);
      const bx = lerp(prev.x, ball.pos.x, t);
      const by = lerp(prev.y, ball.pos.y, t);
      const bz = lerp(prev.z, ball.pos.z, t);
      const ox = bx - lerp(paddle.prevPos.x, paddle.pos.x, t);
      const oy = by - lerp(paddle.prevPos.y, paddle.pos.y, t);
      if (ox * ox + oy * oy > PADDLE_HIT_RADIUS * PADDLE_HIT_RADIUS) continue;

      const overTable = Math.abs(bx) <= HALF_WIDTH && Math.abs(bz) <= HALF_LENGTH;
      const contact: BallState = { pos: { x: bx, y: by, z: bz }, vel: ball.vel, spin: ball.spin };
      const out = computeReturn({ contact, swing: paddle.swing, offset: { x: ox, y: oy }, isServe: false });
      this.ball = toWorldBall(player, out);
      this.referee({ type: 'hit', player, overTable });
      this.onStroke(player, Math.hypot(paddle.swing.x, paddle.swing.y) + length3(ball.vel) * 0.3);
    }
  }

  private onStroke(player: PlayerIndex, intensity: number): void {
    const strength = clamp(intensity / 8, 0.1, 1);
    this.renderer.hitEffect(this.ball.pos, player, strength);
    this.sfx.hit(strength);
    this.lastActivity = this.simTime;
    const receiver = otherPlayer(player);
    this.incomingIds[receiver] += 1;
    this.refreshIntercepts();
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
    this.intercepts = [null, null];
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
    const paddleFrame = (player: PlayerIndex) => {
      const paddle = this.paddles[player];
      const local = {
        x: lerp(paddle.prevPos.x, paddle.pos.x, alpha),
        y: lerp(paddle.prevPos.y, paddle.pos.y, alpha),
        z: lerp(paddle.prevPos.z, paddle.pos.z, alpha),
      };
      return { pos: toWorldVec(player, local), swing: paddle.swing };
    };

    const intercept = this.intercepts[HUMAN];
    const showMarker = this.aimMarker && intercept !== null && this.phase === 'rally';
    return {
      ball: { pos, vel: this.ball.vel, spin: this.ball.spin },
      paddles: [paddleFrame(0), paddleFrame(1)],
      aimMarker: showMarker ? toWorldVec(HUMAN, { ...intercept.pos, z: this.paddles[HUMAN].pos.z - 0.01 }) : null,
    };
  }
}
