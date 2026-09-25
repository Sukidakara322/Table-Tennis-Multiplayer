import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  BALL_RADIUS,
  FLOOR_Y,
  HALF_LENGTH,
  HALF_WIDTH,
  NET_HALF_SPAN,
  NET_HEIGHT,
  PADDLE_VISUAL_RADIUS,
  AIM_X_LIMIT,
  AIM_Y_MAX,
  AIM_Y_MIN,
  STAND_Z,
  VIEW_EYE_Y,
  VIEW_EYE_Z,
  TABLE_HEIGHT,
  TABLE_LENGTH,
  TABLE_THICKNESS,
  TABLE_WIDTH,
} from '../../shared/constants';
import { toWorldVec } from '../../shared/frames';
import type { PaddleFace } from '../../shared/racket';
import type { PlayerIndex } from '../../shared/types';
import { clamp, type Vec2, type Vec3 } from '../../shared/vec';

/** Player accent colours (paddle rims, scoreboard, effects). */
export const PLAYER_COLORS: readonly [THREE.Color, THREE.Color] = [new THREE.Color(0x00e5ff), new THREE.Color(0xff2bd6)];

/*
 * Readability rules: the table, the paddles and the ball each own a distinct hue and brightness.
 * Table = matte mid-dark blue, paddles = solid rubber faces with a player-coloured rim,
 * ball = the brightest, warmest object and the only thing that really glows.
 */
const BACKGROUND = 0x05020d;
const TABLE_BLUE = 0x17418f;
const LINE_WHITE = new THREE.Color(0.92, 0.94, 1);
const BALL_ORANGE = new THREE.Color(2.4, 0.9, 0.2);
const RUBBER_RED = 0xc8202f;
/** Dark, but never the background: the far racket's black side is seen against empty space. */
const RUBBER_BLACK = 0x262b38;
const HANDLE_WOOD = 0xa8753f;
/** Near-true ball size, so what you see overlapping the paddle is what the game counts as a hit. */
const BALL_VISUAL_SCALE = 1.15;
/**
 * How the racket is carried, in radians: laid over by this much at the very edge of the reach, plus
 * this much more per m/s of a sideways drag, up to the limit. Upright in the middle of the table.
 */
const GRIP_LEAN_OUT_WIDE = 0.6;
const BLADE_LEAN_PER_SPEED = 0.07;
const GRIP_LEAN_LIMIT = 0.95;
/** Blade centre to the end of the grip, which is what has to clear the table when reaching in. */
const GRIP_LENGTH = PADDLE_VISUAL_RADIUS + 0.08;
/**
 * Camera sits at the shared eye position (VIEW_EYE_*), just behind the player's end and above it.
 * Standing close is what makes the table read as long: how much narrower the far end looks than the
 * near one depends only on where the eye is, never on the lens, so a distant camera flattens the table
 * into a short slab however much you zoom. The lens then zooms back out (see `fitLens`).
 */
/**
 * Where the view axis points. Its height has to move with VIEW_EYE_Y, or lowering the eye also swings
 * the whole table up the screen: what sets the composition is where the axis crosses the table, and
 * that is the eye and this point together. Keep the axis passing about 0.26 m under the net.
 */
const CAMERA_LOOK_AT = { x: 0, y: -0.63, z: -0.9 };
/**
 * Everything that must stay on screen, in the viewer's local frame, with the screen margin to keep
 * around it: the four table corners, every corner of the plane the racket is held on, and headroom
 * for a looping or lobbed ball.
 */
const FRAMED_POINTS: Array<[Vec3, number]> = [
  ...[-HALF_WIDTH, HALF_WIDTH].flatMap((x) =>
    [-HALF_LENGTH, HALF_LENGTH].map((z) => [{ x, y: 0, z }, 0.03] as [Vec3, number]),
  ),
  ...[-(AIM_X_LIMIT + PADDLE_VISUAL_RADIUS), AIM_X_LIMIT + PADDLE_VISUAL_RADIUS].flatMap((x) =>
    [AIM_Y_MIN - PADDLE_VISUAL_RADIUS, AIM_Y_MAX + PADDLE_VISUAL_RADIUS].map(
      (y) => [{ x, y, z: STAND_Z }, 0.012] as [Vec3, number],
    ),
  ),
  [{ x: 0, y: 0.9, z: 0 }, 0.02],
  [{ x: 0, y: 0.75, z: HALF_LENGTH }, 0.02],
];
/** Bloom strength at glow level 1 (the ESC-menu slider scales it). */
const BASE_BLOOM = 0.4;

/**
 * The view leans towards the side the ball is on, by this much at the very edge of the table. It is
 * the only camera movement there is: the eye never changes depth, because the player never does.
 *
 * Kept small on purpose, and — far more importantly — held completely still from the bounce onwards
 * (see `trackLean` on the session). The racket stands at a fixed place in the world, so every
 * centimetre the camera moves slides the blade across the screen without the hand having moved. That
 * is fine while the ball is away and intolerable while you are playing a stroke.
 */
const CAMERA_LEAN_X = 0.13;
/**
 * The look-at point swings further than the eye, so the view mostly turns rather than slides. This is
 * the difference between looking across at the play and side-stepping to it. Sliding the eye moves
 * near things across the screen much faster than far ones, and the racket is the nearest thing there
 * is, so a shifting eye drags it about; turning moves the whole view together, which reads as looking.
 */
const CAMERA_AIM_SHARE = 2.2;
/** Quick enough to have arrived before the ball does, since it stops moving when the ball bounces. */
const CAMERA_FOLLOW_TIME = 0.11;

export interface PaddleFrame {
  /** World position. */
  pos: Vec3;
  /** Swing velocity in the owner's local frame. */
  swing: Vec2;
  /** Racket face angle in the owner's local frame. */
  face: PaddleFace;
  /** Owner's body centre x in their local frame (the handle points back towards it). */
  bodyX: number;
}

export interface RenderFrame {
  ball: { pos: Vec3; vel: Vec3; spin: Vec3 } | null;
  paddles: [PaddleFrame, PaddleFrame];
  /** How far across the table the view should lean, -1..1. */
  viewLean: number;
  /** The stroke is the viewer's to play: the eye must not move a millimetre until it is over. */
  viewHeld: boolean;
}

function hdr(color: THREE.Color, intensity: number): THREE.Color {
  return color.clone().multiplyScalar(intensity);
}

export class GameRenderer {
  readonly camera: THREE.PerspectiveCamera;
  /** Same view without pan or shake; the mouse → paddle mapping is measured against this one. */
  private readonly controlCamera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly ball: THREE.Mesh;
  private readonly shadow: BallShadow;
  private readonly trail: Trail;
  private readonly sparks: Sparks;
  private readonly ripples: Ripples;
  private readonly paddles: [PaddleVisual, PaddleVisual];
  private readonly netCord: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  /** Where the eye is now and what it is looking at; both ease towards where the player is standing. */
  private readonly eye = new THREE.Vector3();
  private readonly focus = new THREE.Vector3();
  /** World direction of the viewer's local +x. */
  private readonly viewRight = new THREE.Vector3(1, 0, 0);
  private viewPlayer: PlayerIndex = 0;
  private netFlash = 0;
  private shake = 0;
  private trailColor = new THREE.Color(1, 1, 1);

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.fog = new THREE.FogExp2(BACKGROUND, 0.06);

    // Both lenses are sized to the window in `resize`, which runs before the first frame.
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);
    this.controlCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // High threshold: only HDR colours (the ball, the net flash) bloom.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BASE_BLOOM, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildLights();
    this.buildArena();
    this.buildTable();
    this.netCord = this.buildNet();

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * BALL_VISUAL_SCALE, 24, 16),
      new THREE.MeshBasicMaterial({ color: BALL_ORANGE }),
    );
    this.scene.add(this.ball);

    this.shadow = new BallShadow();
    this.scene.add(this.shadow.mesh);
    this.trail = new Trail(28);
    this.scene.add(this.trail.points);
    this.sparks = new Sparks(160);
    this.scene.add(this.sparks.points);
    this.ripples = new Ripples(10);
    this.scene.add(this.ripples.group);

    this.paddles = [new PaddleVisual(PLAYER_COLORS[0]), new PaddleVisual(PLAYER_COLORS[1])];
    this.scene.add(this.paddles[0].group, this.paddles[1].group);

    this.setViewPlayer(0);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /** Places the camera behind `player`'s end of the table, where it starts each point. */
  setViewPlayer(player: PlayerIndex): void {
    const home = toWorldVec(player, { x: 0, y: VIEW_EYE_Y, z: VIEW_EYE_Z });
    const look = toWorldVec(player, CAMERA_LOOK_AT);
    this.eye.set(home.x, home.y, home.z);
    this.focus.set(look.x, look.y, look.z);
    this.viewRight.set(player === 0 ? 1 : -1, 0, 0);
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
    // The control camera never travels: the lens is measured against this one.
    this.controlCamera.position.copy(this.eye);
    this.controlCamera.lookAt(this.focus);
    this.controlCamera.updateMatrixWorld();
    this.viewPlayer = player;
    this.paddles[player].setLocalView(true);
    this.paddles[player === 0 ? 1 : 0].setLocalView(false);
  }

  /**
   * Where on the racket's plane the cursor is pointing, in the viewer's local frame. This is the whole
   * mouse-to-racket mapping, and it is done by unprojecting rather than by a hand-set scale so that it
   * is exactly one-to-one on screen: move the mouse a hundred pixels and the blade moves a hundred
   * pixels, on any window, at any field of view. Anything less and the racket lags behind what you are
   * pointing at by a fixed fraction — which is survivable when a ball comes straight at you and hopeless
   * when it is going to the corner, because then the mistake is proportional to how far you must reach.
   *
   * It is measured against the control camera, which never pans, so leaning the view cannot shift where
   * the mouse puts the racket. The plane is upright and square to the view, so this is well conditioned
   * everywhere on screen — unlike casting onto the table, which is nearly edge-on near the net.
   */
  cursorToPlane(cursor: Vec2): Vec2 {
    const ray = new THREE.Vector3(clamp(cursor.x, -1, 1), clamp(cursor.y, -1, 1), 0.5).unproject(this.controlCamera);
    const eye = this.controlCamera.position;
    ray.sub(eye);
    const planeZ = this.viewPlayer === 0 ? STAND_Z : -STAND_Z;
    const t = Math.abs(ray.z) < 1e-6 ? 0 : (planeZ - eye.z) / ray.z;
    const hit = { x: eye.x + ray.x * t, y: eye.y + ray.y * t, z: planeZ };
    return { x: this.viewPlayer === 0 ? hit.x : -hit.x, y: hit.y };
  }

  /** The cursor that points at `aim` on that plane — the exact inverse of `cursorToPlane`. */
  planeToCursor(aim: Vec2): Vec2 {
    const world = toWorldVec(this.viewPlayer, { x: aim.x, y: aim.y, z: STAND_Z });
    const ndc = new THREE.Vector3(world.x, world.y, world.z).project(this.controlCamera);
    return { x: ndc.x, y: ndc.y };
  }

  /** 0 = no glow, 1 = default, 2 = strong. */
  setGlow(level: number): void {
    this.bloom.strength = BASE_BLOOM * clamp(level, 0, 2);
    this.bloom.enabled = level > 0.01;
  }

  render(frame: RenderFrame, dt: number): void {
    this.updateBall(frame.ball);
    frame.paddles.forEach((paddle, i) => this.paddles[i]!.update(paddle, i as PlayerIndex, dt));

    this.sparks.update(dt);
    this.ripples.update(dt);

    this.netFlash = Math.max(0, this.netFlash - dt * 3);
    this.netCord.material.color.copy(hdr(LINE_WHITE, 1 + this.netFlash * 1.5));

    this.trackLean(frame.viewLean, frame.viewHeld, dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake * 0.02;
    this.camera.position.copy(this.eye).add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0));
    this.camera.lookAt(this.focus);
    this.composer.render(dt);
  }

  /**
   * Eases the eye sideways towards where the play is. Depth and height never change: the player
   * stands in one place all match, so there is nothing else for the camera to follow. Whether it is
   * safe to be moving at all is decided by the session, which stops feeding it a new lean once the
   * stroke is the player's to make; this only has to get there quickly and smoothly.
   */
  private trackLean(lean: number, held: boolean, dt: number): void {
    // Dead stop, not a slower ease. Easing towards a frozen target still creeps for a few tenths of a
    // second, and those are the tenths in which the stroke is played.
    if (held) return;
    const wantX = clamp(lean, -1, 1) * CAMERA_LEAN_X;
    const home = toWorldVec(this.viewPlayer, { x: wantX, y: VIEW_EYE_Y, z: VIEW_EYE_Z });
    const look = toWorldVec(this.viewPlayer, {
      x: wantX * CAMERA_AIM_SHARE,
      y: CAMERA_LOOK_AT.y,
      z: CAMERA_LOOK_AT.z,
    });
    const k = 1 - Math.exp(-dt / CAMERA_FOLLOW_TIME);
    this.eye.lerp(new THREE.Vector3(home.x, home.y, home.z), k);
    this.focus.lerp(new THREE.Vector3(look.x, look.y, look.z), k);
  }

  hitEffect(pos: Vec3, player: PlayerIndex, strength: number): void {
    const s = clamp(strength, 0, 1);
    this.sparks.emit(pos, PLAYER_COLORS[player], Math.round(6 + 14 * s), 0.7 + 1.8 * s);
    this.shake = Math.max(this.shake, s * s * 0.8);
  }

  bounceEffect(pos: Vec3, color: THREE.Color, strength: number): void {
    this.ripples.spawn(pos, color, 0.5 + clamp(strength / 5, 0, 1) * 0.6);
  }

  netEffect(pos: Vec3): void {
    this.netFlash = 1;
    this.sparks.emit(pos, LINE_WHITE, 8, 0.7);
  }

  clearTrail(): void {
    this.trail.clear();
  }

  /**
   * Picks the vertical field of view for this window rather than fixing it: the point of FRAMED_POINTS
   * that needs the widest lens decides it, including the camera's edge-pan offsets. So the table, the
   * paddle wherever the player puts it and a lobbed ball are always on screen, on any window shape.
   */
  private fitLens(aspect: number): number {
    const eye = new THREE.Vector3(0, VIEW_EYE_Y, VIEW_EYE_Z);
    const forward = new THREE.Vector3(CAMERA_LOOK_AT.x, CAMERA_LOOK_AT.y, CAMERA_LOOK_AT.z).sub(eye).normalize();
    const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(forward);
    const offset = new THREE.Vector3();
    let tan = 0;
    for (const panX of [-CAMERA_LEAN_X, 0, CAMERA_LEAN_X]) {
      for (const [point, margin] of FRAMED_POINTS) {
        offset.set(point.x - panX, point.y - eye.y, point.z - eye.z);
        const depth = offset.dot(forward);
        if (depth <= 0.05) continue;
        const usable = depth * (1 - 2 * margin);
        tan = Math.max(tan, Math.abs(offset.dot(up)) / usable, Math.abs(offset.dot(right)) / (usable * aspect));
      }
    }
    return THREE.MathUtils.radToDeg(Math.atan(tan)) * 2;
  }

  resize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.fov = this.fitLens(this.camera.aspect);
    this.camera.updateProjectionMatrix();
    this.controlCamera.aspect = this.camera.aspect;
    this.controlCamera.fov = this.camera.fov;
    this.controlCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom.resolution.set(width, height);
    const pointScale = (height * this.renderer.getPixelRatio()) / 2 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.trail.setPointScale(pointScale);
    this.sparks.setPointScale(pointScale);
  };

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private updateBall(ball: RenderFrame['ball']): void {
    if (!ball) {
      this.ball.visible = false;
      this.shadow.mesh.visible = false;
      this.trail.clear();
      return;
    }
    const { pos, vel, spin } = ball;
    this.ball.visible = true;
    this.ball.position.set(pos.x, pos.y, pos.z);
    this.shadow.update(pos);

    // Trail colour reads the spin: pink for topspin (dips), cyan for backspin (floats), violet for sidespin.
    const speed = Math.max(Math.hypot(vel.x, vel.y, vel.z), 0.5);
    const liftY = (spin.z * vel.x - spin.x * vel.z) / speed;
    const sideX = (spin.y * vel.z - spin.z * vel.y) / speed;
    const target = new THREE.Color(1, 0.78, 0.5);
    if (liftY < -40) target.lerp(new THREE.Color(0xff3d8b), clamp((-liftY - 40) / 200, 0, 1));
    else if (liftY > 40) target.lerp(new THREE.Color(0x3de8ff), clamp((liftY - 40) / 200, 0, 1));
    if (Math.abs(sideX) > 60) target.lerp(new THREE.Color(0xa56bff), clamp((Math.abs(sideX) - 60) / 250, 0, 0.7));
    this.trailColor.lerp(target, 0.25);
    this.trail.setColor(this.trailColor);
    this.trail.push(pos);
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xc4ccff, 0x1a0b2e, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.8, 5, 1.5);
    this.scene.add(key);
    // Coloured rim lights keep the arena mood on the table edges without making anything glow.
    const cyan = new THREE.PointLight(PLAYER_COLORS[0], 6, 0, 2);
    cyan.position.set(-1.8, 0.7, HALF_LENGTH + 0.8);
    const magenta = new THREE.PointLight(PLAYER_COLORS[1], 6, 0, 2);
    magenta.position.set(1.8, 0.7, -HALF_LENGTH - 0.8);
    this.scene.add(cyan, magenta);
  }

  /**
   * The floor, the grid and nothing on the horizon. There used to be a synthwave sun at each end, and
   * it cannot work from this camera: the view looks down at the table, so the floor's horizon runs
   * within a degree of the top of the frame, and whatever is put out there is squeezed into that
   * degree. Far away it was a twenty-pixel bright sliver clipped by the screen edge, which read as a
   * rendering fault; brought close enough to be seen properly it became a wall behind the far player.
   * There is no distance that makes it a sun, so there is no sun. (Restore it with the eye back up
   * around 1.25 m, where the horizon sits well inside the frame.)
   */
  private buildArena(): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ color: 0x07030f }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y - 0.002;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(80, 160, 0x7a3cff, 0x3b1a78);
    grid.position.y = FLOOR_Y;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.65;
    this.scene.add(grid);

  }

  private buildTable(): void {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE_WIDTH, TABLE_THICKNESS, TABLE_LENGTH),
      new THREE.MeshStandardMaterial({ color: TABLE_BLUE, roughness: 0.75, metalness: 0 }),
    );
    top.position.y = -TABLE_THICKNESS / 2;
    this.scene.add(top);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: LINE_WHITE });
    const addLine = (width: number, length: number, x: number, z: number) => {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(width, length), lineMaterial);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.0015, z);
      this.scene.add(line);
    };
    const edge = 0.02;
    addLine(edge, TABLE_LENGTH, -HALF_WIDTH + edge / 2, 0);
    addLine(edge, TABLE_LENGTH, HALF_WIDTH - edge / 2, 0);
    addLine(TABLE_WIDTH, edge, 0, -HALF_LENGTH + edge / 2);
    addLine(TABLE_WIDTH, edge, 0, HALF_LENGTH - edge / 2);
    addLine(0.003, TABLE_LENGTH, 0, 0);

    // Faint violet trim along the underside keeps a touch of neon away from the ball's path.
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(TABLE_WIDTH, 0.001, TABLE_LENGTH)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(0x8a4dff) }),
    );
    outline.position.y = -TABLE_THICKNESS;
    this.scene.add(outline);

    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1e2b, roughness: 0.45, metalness: 0.6 });
    const legHeight = TABLE_HEIGHT - TABLE_THICKNESS;
    for (const x of [-HALF_WIDTH + 0.12, HALF_WIDTH - 0.12]) {
      for (const z of [-HALF_LENGTH + 0.25, HALF_LENGTH - 0.25]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, legHeight, 0.05), legMaterial);
        leg.position.set(x, -TABLE_THICKNESS - legHeight / 2, z);
        this.scene.add(leg);
      }
    }
  }

  private buildNet(): THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = 'rgba(225, 230, 255, 0.9)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 6) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(canvas.width, y + 0.5);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(NET_HALF_SPAN * 2, NET_HEIGHT),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.position.y = NET_HEIGHT / 2;
    this.scene.add(mesh);

    // White tape along the top of the net.
    const cord = new THREE.Mesh(new THREE.BoxGeometry(NET_HALF_SPAN * 2, 0.014, 0.006), new THREE.MeshBasicMaterial());
    cord.position.y = NET_HEIGHT - 0.005;
    this.scene.add(cord);

    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.5, metalness: 0.5 });
    for (const x of [-NET_HALF_SPAN, NET_HALF_SPAN]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, NET_HEIGHT + 0.02, 0.02), postMaterial);
      post.position.set(x, (NET_HEIGHT + 0.02) / 2, 0);
      this.scene.add(post);
    }
    return cord;
  }
}

/** Soft dark blob under the ball: the main cue for its height and where it will land. */
class BallShadow {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.75)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, fog: false }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
  }

  update(pos: Vec3): void {
    const overTable = Math.abs(pos.x) <= HALF_WIDTH && Math.abs(pos.z) <= HALF_LENGTH && pos.y > 0;
    const surface = overTable ? 0 : FLOOR_Y;
    const height = pos.y - surface;
    if (height < 0) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(pos.x, surface + 0.002, pos.z);
    // Higher ball → larger, softer, fainter shadow.
    this.mesh.scale.setScalar(BALL_RADIUS * 3 * (1 + height * 2.2));
    this.mesh.material.opacity = clamp((overTable ? 0.8 : 0.5) - height * 0.7, 0.18, 0.8);
  }
}

class PaddleVisual {
  readonly group = new THREE.Group();
  private readonly tilt = new THREE.Group();
  /**
   * Carries the grip. Pivoted at the blade's centre so the blade stays exactly where the contact test
   * expects it while the racket visibly leans: the blade is a disc, so the angle between it and the
   * grip is the only thing an eye can read as leaning.
   */
  private readonly grip = new THREE.Group();
  private readonly rim: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  private readonly handle: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;

  constructor(private readonly color: THREE.Color) {
    const faceGeometry = new THREE.CircleGeometry(PADDLE_VISUAL_RADIUS, 48);
    // Two-colour, like a real racket, with the red rubber turned towards its owner. You are looking at
    // the back of your own blade for the whole match, often held off the side of the table against a
    // near-black background, and the black side there is a rim with nothing inside it.
    const black = new THREE.Mesh(faceGeometry, new THREE.MeshStandardMaterial({ color: RUBBER_BLACK, roughness: 0.8 }));
    black.rotation.y = Math.PI;
    black.position.z = -0.003;
    const red = new THREE.Mesh(faceGeometry, new THREE.MeshStandardMaterial({ color: RUBBER_RED, roughness: 0.75 }));
    red.position.z = 0.003;

    this.rim = new THREE.Mesh(
      new THREE.TorusGeometry(PADDLE_VISUAL_RADIUS, 0.005, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 1.3, roughness: 0.4 }),
    );
    this.handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.1, 0.02),
      new THREE.MeshStandardMaterial({ color: HANDLE_WOOD, roughness: 0.7 }),
    );
    // The grip hangs straight down from the middle of the blade, its top overlapping behind the blade
    // so the join stays covered as it swings.
    this.handle.position.y = -PADDLE_VISUAL_RADIUS - 0.03;
    this.grip.add(this.handle);
    this.tilt.add(red, black, this.rim, this.grip);
    this.group.add(this.tilt);
  }

  /** Both rackets are solid rubber; only the rim's glow marks which one is yours. */
  setLocalView(isLocal: boolean): void {
    this.rim.material.emissiveIntensity = isLocal ? 1.1 : 1.3;
    this.rim.material.emissive.copy(this.color);
  }

  update(frame: PaddleFrame, player: PlayerIndex, dt: number): void {
    this.group.position.set(frame.pos.x, frame.pos.y, frame.pos.z);
    this.group.rotation.y = player === 0 ? 0 : Math.PI;
    const k = 1 - Math.exp(-dt * 14);
    // Same face angle the physics uses: turned towards the table centre, open when low, closed when high.
    // On top of that the face visibly closes on upward swings.
    const yaw = -frame.face.yaw;
    const pitch = clamp(frame.face.pitch - frame.swing.y * 0.04, -0.8, 0.8);
    this.tilt.rotation.y += (yaw - this.tilt.rotation.y) * k;
    this.tilt.rotation.x += (pitch - this.tilt.rotation.x) * k;
    // The racket leans over as you carry it out to the side — upright in the middle of the table,
    // laid further over the wider you reach — and leans into a drag on top of that. The grip swings
    // back towards the body, which is where the hand holding it is, so the blade is what tips
    // outwards; swinging the grip out to the side instead reads as the racket bending the wrong way.
    const localX = player === 0 ? frame.pos.x : -frame.pos.x;
    const drag = player === 0 ? frame.swing.x : -frame.swing.x;
    const outToTheSide = -clamp(localX / AIM_X_LIMIT, -1, 1) * GRIP_LEAN_OUT_WIDE;
    const lean = clamp(outToTheSide + drag * BLADE_LEAN_PER_SPEED, -GRIP_LEAN_LIMIT, GRIP_LEAN_LIMIT);
    this.grip.rotation.z += (lean - this.grip.rotation.z) * k;
    // Reaching in low over the table would drive the grip through the surface, so it swings back
    // towards the player by exactly as much as it needs to, and hangs straight the rest of the time.
    const overTable = Math.abs(frame.pos.x) <= HALF_WIDTH && Math.abs(frame.pos.z) <= HALF_LENGTH;
    const clearance = overTable ? -Math.acos(clamp((frame.pos.y - 0.01) / GRIP_LENGTH, 0, 1)) : 0;
    this.grip.rotation.x += (clearance - this.grip.rotation.x) * k;
  }
}

const POINT_VERTEX = /* glsl */ `
  attribute float alpha;
  attribute vec3 color;
  uniform float uSize;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = alpha;
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uScale / -mv.z * (0.35 + 0.65 * alpha);
    gl_Position = projectionMatrix * mv;
  }`;

const POINT_FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(vColor * a, a);
  }`;

function createPointsMaterial(size: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSize: { value: size }, uScale: { value: 500 } },
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

class Trail {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly colors: Float32Array;
  private readonly currentColor = new THREE.Color(1, 1, 1);
  private count = 0;

  constructor(private readonly size: number) {
    this.positions = new Float32Array(size * 3);
    this.alphas = new Float32Array(size);
    this.colors = new Float32Array(size * 3).fill(1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geometry, createPointsMaterial(0.022));
    this.points.frustumCulled = false;
  }

  push(pos: Vec3): void {
    this.positions.copyWithin(3, 0, (this.size - 1) * 3);
    this.colors.copyWithin(3, 0, (this.size - 1) * 3);
    this.positions[0] = pos.x;
    this.positions[1] = pos.y;
    this.positions[2] = pos.z;
    this.colors[0] = this.currentColor.r;
    this.colors[1] = this.currentColor.g;
    this.colors[2] = this.currentColor.b;
    this.count = Math.min(this.count + 1, this.size);
    for (let i = 0; i < this.size; i++) this.alphas[i] = i < this.count ? (1 - i / this.size) * 0.45 : 0;
    this.markDirty();
  }

  setColor(color: THREE.Color): void {
    this.currentColor.copy(color).multiplyScalar(0.8);
  }

  clear(): void {
    if (this.count === 0) return;
    this.count = 0;
    this.alphas.fill(0);
    this.markDirty();
  }

  setPointScale(scale: number): void {
    this.points.material.uniforms.uScale!.value = scale;
  }

  private markDirty(): void {
    const geometry = this.points.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('alpha').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
  }
}

class Sparks {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly colors: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private next = 0;

  constructor(private readonly size: number) {
    this.positions = new Float32Array(size * 3);
    this.alphas = new Float32Array(size);
    this.colors = new Float32Array(size * 3);
    this.velocities = new Float32Array(size * 3);
    this.life = new Float32Array(size);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geometry, createPointsMaterial(0.014));
    this.points.frustumCulled = false;
  }

  emit(pos: Vec3, color: THREE.Color, count: number, speed: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.size;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const v = speed * (0.4 + Math.random() * 0.6);
      this.positions.set([pos.x, pos.y, pos.z], i * 3);
      this.velocities.set(
        [Math.sin(phi) * Math.cos(theta) * v, Math.abs(Math.cos(phi)) * v * 0.8 + 0.3, Math.sin(phi) * Math.sin(theta) * v],
        i * 3,
      );
      this.colors.set([color.r * 1.2, color.g * 1.2, color.b * 1.2], i * 3);
      this.life[i] = 0.25 + Math.random() * 0.2;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.size; i++) {
      if (this.life[i]! <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const p = i * 3;
      this.velocities[p + 1]! -= 4 * dt;
      this.positions[p]! += this.velocities[p]! * dt;
      this.positions[p + 1]! += this.velocities[p + 1]! * dt;
      this.positions[p + 2]! += this.velocities[p + 2]! * dt;
      this.alphas[i] = clamp(this.life[i]! * 2.5, 0, 0.8);
    }
    const geometry = this.points.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('alpha').needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
  }

  setPointScale(scale: number): void {
    this.points.material.uniforms.uScale!.value = scale;
  }
}

class Ripples {
  readonly group = new THREE.Group();
  private readonly rings: Array<{ mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; age: number; strength: number }> = [];
  private next = 0;
  private static readonly DURATION = 0.4;

  constructor(count: number) {
    const geometry = new THREE.RingGeometry(0.03, 0.036, 48);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, age: Ripples.DURATION, strength: 1 });
    }
  }

  spawn(pos: Vec3, color: THREE.Color, strength: number): void {
    const ring = this.rings[this.next]!;
    this.next = (this.next + 1) % this.rings.length;
    ring.age = 0;
    ring.strength = strength;
    ring.mesh.visible = true;
    ring.mesh.position.set(pos.x, Math.max(pos.y - BALL_RADIUS, FLOOR_Y) + 0.003, pos.z);
    ring.mesh.material.color.copy(hdr(color, 0.8));
  }

  update(dt: number): void {
    for (const ring of this.rings) {
      if (ring.age >= Ripples.DURATION) {
        ring.mesh.visible = false;
        continue;
      }
      ring.age += dt;
      const t = ring.age / Ripples.DURATION;
      ring.mesh.scale.setScalar(1 + t * 2.5 * ring.strength);
      ring.mesh.material.opacity = (1 - t) * (1 - t) * 0.7;
    }
  }
}
