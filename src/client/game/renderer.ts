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
  TABLE_HEIGHT,
  TABLE_LENGTH,
  TABLE_THICKNESS,
  TABLE_WIDTH,
} from '../../shared/constants';
import { toLocalVec, toWorldVec } from '../../shared/frames';
import type { PlayerIndex } from '../../shared/types';
import { clamp, type Vec2, type Vec3 } from '../../shared/vec';

export const PLAYER_COLORS: readonly [THREE.Color, THREE.Color] = [new THREE.Color(0x00f0ff), new THREE.Color(0xff2bd6)];

const BACKGROUND = 0x05020d;
const TABLE_LINE = new THREE.Color(0x9ff6ff);

export interface PaddleFrame {
  /** World position. */
  pos: Vec3;
  /** Swing velocity in the owner's local frame. */
  swing: Vec2;
}

export interface RenderFrame {
  ball: { pos: Vec3; vel: Vec3; spin: Vec3 } | null;
  paddles: [PaddleFrame, PaddleFrame];
  /** Where the viewing player will meet the ball (world), for the aim marker. */
  aimMarker: Vec3 | null;
}

function hdr(color: THREE.Color, intensity: number): THREE.Color {
  return color.clone().multiplyScalar(intensity);
}

export class GameRenderer {
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly scene = new THREE.Scene();
  private readonly ball: THREE.Mesh;
  private readonly ballRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly trail: Trail;
  private readonly sparks: Sparks;
  private readonly ripples: Ripples;
  private readonly paddles: [PaddleVisual, PaddleVisual];
  private readonly marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly netCord: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly cameraHome = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
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
    this.scene.fog = new THREE.FogExp2(BACKGROUND, 0.07);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 200);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.05, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildArena();
    this.buildTable();
    this.netCord = this.buildNet();

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS * 1.15, 24, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.0, 2.6) }),
    );
    this.scene.add(this.ball);

    this.ballRing = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.026, 32),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.ballRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballRing);

    this.trail = new Trail(40);
    this.scene.add(this.trail.points);
    this.sparks = new Sparks(220);
    this.scene.add(this.sparks.points);
    this.ripples = new Ripples(10);
    this.scene.add(this.ripples.group);

    this.paddles = [new PaddleVisual(PLAYER_COLORS[0]), new PaddleVisual(PLAYER_COLORS[1])];
    this.scene.add(this.paddles[0].group, this.paddles[1].group);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.036, 40),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.scene.add(this.marker);

    this.setViewPlayer(0);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /** Places the camera behind `player`'s end of the table. */
  setViewPlayer(player: PlayerIndex): void {
    // High enough that the opponent's half isn't squashed, far enough back to see low balls at full reach.
    const home = toWorldVec(player, { x: 0, y: 1.6, z: HALF_LENGTH + 2.3 });
    const look = toWorldVec(player, { x: 0, y: 0.05, z: -1.1 });
    this.cameraHome.set(home.x, home.y, home.z);
    this.lookTarget.set(look.x, look.y, look.z);
    this.camera.position.copy(this.cameraHome);
    this.camera.lookAt(this.lookTarget);
    this.camera.updateMatrixWorld();
    this.paddles[player].setLocalView(true);
    this.paddles[player === 0 ? 1 : 0].setLocalView(false);
    this.marker.material.color.copy(hdr(PLAYER_COLORS[player], 1.4));
    this.marker.rotation.y = player === 0 ? 0 : Math.PI;
  }

  /**
   * Projects the cursor (NDC) onto the paddle plane at local depth `localZ` of `player`
   * and returns the point in that player's local frame.
   */
  cursorToLocalPlane(cursor: Vec2, localZ: number, player: PlayerIndex): Vec3 {
    const worldZ = player === 0 ? localZ : -localZ;
    const origin = this.cameraHome;
    const dir = new THREE.Vector3(cursor.x, cursor.y, 0.5).unproject(this.camera).sub(origin).normalize();
    const t = Math.abs(dir.z) > 1e-6 ? (worldZ - origin.z) / dir.z : 0;
    const point = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: worldZ };
    return toLocalVec(player, point);
  }

  render(frame: RenderFrame, dt: number): void {
    this.updateBall(frame.ball);
    frame.paddles.forEach((paddle, i) => this.paddles[i]!.update(paddle, i as PlayerIndex, dt));

    if (frame.aimMarker) {
      this.marker.visible = true;
      this.marker.position.set(frame.aimMarker.x, frame.aimMarker.y, frame.aimMarker.z);
    } else {
      this.marker.visible = false;
    }

    this.sparks.update(dt);
    this.ripples.update(dt);

    this.netFlash = Math.max(0, this.netFlash - dt * 3);
    this.netCord.material.color.copy(hdr(new THREE.Color(0xff9bf0), 1.8 + this.netFlash * 4));

    this.shake = Math.max(0, this.shake - dt * 2.5);
    const s = this.shake * this.shake * 0.03;
    this.camera.position.set(
      this.cameraHome.x + (Math.random() - 0.5) * s,
      this.cameraHome.y + (Math.random() - 0.5) * s,
      this.cameraHome.z,
    );
    this.composer.render(dt);
    // Keep raycasts (cursor → paddle) independent of the shake.
    this.camera.position.copy(this.cameraHome);
    this.camera.updateMatrixWorld();
  }

  hitEffect(pos: Vec3, player: PlayerIndex, strength: number): void {
    const s = clamp(strength, 0, 1);
    this.sparks.emit(pos, PLAYER_COLORS[player], Math.round(14 + 30 * s), 0.8 + 2.4 * s);
    this.shake = Math.max(this.shake, s * s);
  }

  bounceEffect(pos: Vec3, color: THREE.Color, strength: number): void {
    this.ripples.spawn(pos, color, 0.6 + clamp(strength / 5, 0, 1));
    this.sparks.emit(pos, color, 6, 0.6);
  }

  netEffect(pos: Vec3): void {
    this.netFlash = 1;
    this.sparks.emit(pos, new THREE.Color(0xff9bf0), 12, 0.9);
  }

  clearTrail(): void {
    this.trail.clear();
  }

  resize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
      this.ballRing.visible = false;
      this.trail.clear();
      return;
    }
    const { pos, vel, spin } = ball;
    this.ball.visible = true;
    this.ball.position.set(pos.x, pos.y, pos.z);

    // Trail colour reads the spin: pink for topspin (dips), cyan for backspin (floats), violet for sidespin.
    const speed = Math.max(Math.hypot(vel.x, vel.y, vel.z), 0.5);
    const liftY = (spin.z * vel.x - spin.x * vel.z) / speed;
    const sideX = (spin.y * vel.z - spin.z * vel.y) / speed;
    const target = new THREE.Color(1, 1, 1);
    if (liftY < -40) target.lerp(new THREE.Color(0xff3d8b), clamp((-liftY - 40) / 200, 0, 1));
    else if (liftY > 40) target.lerp(new THREE.Color(0x3de8ff), clamp((liftY - 40) / 200, 0, 1));
    if (Math.abs(sideX) > 60) target.lerp(new THREE.Color(0xa56bff), clamp((Math.abs(sideX) - 60) / 250, 0, 0.7));
    this.trailColor.lerp(target, 0.25);
    this.trail.setColor(this.trailColor);
    this.trail.push(pos);

    const overTable = Math.abs(pos.x) <= HALF_WIDTH && Math.abs(pos.z) <= HALF_LENGTH && pos.y > 0;
    this.ballRing.visible = overTable;
    if (overTable) {
      const height = pos.y;
      this.ballRing.position.set(pos.x, 0.002, pos.z);
      this.ballRing.scale.setScalar(1 + height * 3);
      this.ballRing.material.color.copy(hdr(new THREE.Color(0xffffff), 1.2));
      this.ballRing.material.opacity = clamp(0.9 - height * 1.1, 0.15, 0.9);
    }
  }

  private buildArena(): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ color: 0x07030f }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y - 0.002;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(80, 160, 0x7a3cff, 0x3b1a78);
    grid.position.y = FLOOR_Y;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.55;
    this.scene.add(grid);

    // A striped synthwave sun at each end, so both players see one on the horizon.
    for (const sign of [-1, 1]) {
      const sun = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 16),
        new THREE.ShaderMaterial({
          uniforms: {
            uTop: { value: new THREE.Color(1.6, 0.55, 0.2) },
            uBottom: { value: new THREE.Color(1.4, 0.05, 0.75) },
          },
          vertexShader: /* glsl */ `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 uTop;
            uniform vec3 uBottom;
            varying vec2 vUv;
            void main() {
              vec2 c = vUv - 0.5;
              if (length(c) > 0.5) discard;
              float y = vUv.y;
              float band = fract(y * 16.0);
              float gap = clamp((0.55 - y) * 1.1, 0.0, 0.7);
              if (y < 0.55 && band < gap) discard;
              gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(0.1, 0.9, y)), 1.0);
            }`,
          fog: false,
        }),
      );
      // Centre just above eye level; the floor hides the lower half, so it sits on the horizon.
      sun.position.set(0, 1.2, sign * 70);
      sun.rotation.y = sign > 0 ? Math.PI : 0;
      this.scene.add(sun);
    }
  }

  private buildTable(): void {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE_WIDTH, TABLE_THICKNESS, TABLE_LENGTH),
      new THREE.MeshBasicMaterial({ color: 0x0a1030 }),
    );
    top.position.y = -TABLE_THICKNESS / 2;
    this.scene.add(top);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: hdr(TABLE_LINE, 2.2) });
    const addLine = (width: number, length: number, x: number, z: number, material = lineMaterial) => {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(width, length), material);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.0015, z);
      this.scene.add(line);
    };
    const edge = 0.02;
    addLine(edge, TABLE_LENGTH, -HALF_WIDTH + edge / 2, 0);
    addLine(edge, TABLE_LENGTH, HALF_WIDTH - edge / 2, 0);
    addLine(TABLE_WIDTH, edge, 0, -HALF_LENGTH + edge / 2);
    addLine(TABLE_WIDTH, edge, 0, HALF_LENGTH - edge / 2);
    addLine(0.004, TABLE_LENGTH, 0, 0, new THREE.MeshBasicMaterial({ color: hdr(TABLE_LINE, 0.7) }));

    // Under-glow outline along the table's lower edge.
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(TABLE_WIDTH, 0.001, TABLE_LENGTH)),
      new THREE.LineBasicMaterial({ color: hdr(new THREE.Color(0x8a4dff), 2.5) }),
    );
    outline.position.y = -TABLE_THICKNESS;
    this.scene.add(outline);

    const legMaterial = new THREE.MeshBasicMaterial({ color: 0x120a24 });
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
    ctx.strokeStyle = '#ff5ce1';
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
      new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color(1.4, 1.4, 1.4),
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.position.y = NET_HEIGHT / 2;
    this.scene.add(mesh);

    const cord = new THREE.Mesh(new THREE.BoxGeometry(NET_HALF_SPAN * 2, 0.007, 0.007), new THREE.MeshBasicMaterial());
    cord.position.y = NET_HEIGHT;
    this.scene.add(cord);

    const postMaterial = new THREE.MeshBasicMaterial({ color: hdr(PLAYER_COLORS[1], 1.3) });
    for (const x of [-NET_HALF_SPAN, NET_HALF_SPAN]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, NET_HEIGHT + 0.02, 0.02), postMaterial);
      post.position.set(x, (NET_HEIGHT + 0.02) / 2, 0);
      this.scene.add(post);
    }
    return cord;
  }
}

class PaddleVisual {
  readonly group = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly blade: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly rim: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly handle: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;

  constructor(private readonly color: THREE.Color) {
    this.blade = new THREE.Mesh(
      new THREE.CircleGeometry(PADDLE_VISUAL_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: hdr(color, 0.35), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.rim = new THREE.Mesh(new THREE.TorusGeometry(PADDLE_VISUAL_RADIUS, 0.0045, 8, 64), new THREE.MeshBasicMaterial());
    this.handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.026, 0.1, 0.016),
      new THREE.MeshBasicMaterial({ color: hdr(color, 0.9), transparent: true }),
    );
    this.handle.position.y = -PADDLE_VISUAL_RADIUS - 0.05;
    this.tilt.add(this.blade, this.rim, this.handle);
    this.group.add(this.tilt);
    this.setLocalView(false);
  }

  /**
   * The viewer's own paddle is close to the camera: keep it see-through and its glow soft
   * so it never hides the ball or floods the near end of the table.
   */
  setLocalView(isLocal: boolean): void {
    this.blade.material.opacity = isLocal ? 0.12 : 0.6;
    this.handle.material.opacity = isLocal ? 0.3 : 1;
    this.rim.material.color.copy(hdr(this.color, isLocal ? 1.1 : 2.6));
  }

  update(frame: PaddleFrame, player: PlayerIndex, dt: number): void {
    this.group.position.set(frame.pos.x, frame.pos.y, frame.pos.z);
    this.group.rotation.y = player === 0 ? 0 : Math.PI;
    const localX = player === 0 ? frame.pos.x : -frame.pos.x;
    const k = 1 - Math.exp(-dt * 18);
    // Handle points back towards the body; the face closes on upward swings and opens on chops.
    this.tilt.rotation.z += (-clamp(localX * 0.9, -0.9, 0.9) - this.tilt.rotation.z) * k;
    this.tilt.rotation.x += (clamp(-frame.swing.y * 0.06, -0.7, 0.7) - this.tilt.rotation.x) * k;
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
    this.points = new THREE.Points(geometry, createPointsMaterial(0.032));
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
    for (let i = 0; i < this.size; i++) this.alphas[i] = i < this.count ? (1 - i / this.size) * 0.9 : 0;
    this.markDirty();
  }

  setColor(color: THREE.Color): void {
    this.currentColor.copy(color).multiplyScalar(1.8);
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
    this.points = new THREE.Points(geometry, createPointsMaterial(0.018));
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
      this.colors.set([color.r * 2.5, color.g * 2.5, color.b * 2.5], i * 3);
      this.life[i] = 0.35 + Math.random() * 0.25;
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
      this.alphas[i] = clamp(this.life[i]! * 2.5, 0, 1);
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
  private static readonly DURATION = 0.45;

  constructor(count: number) {
    const geometry = new THREE.RingGeometry(0.03, 0.038, 48);
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
    ring.mesh.material.color.copy(hdr(color, 2.2));
  }

  update(dt: number): void {
    for (const ring of this.rings) {
      if (ring.age >= Ripples.DURATION) {
        ring.mesh.visible = false;
        continue;
      }
      ring.age += dt;
      const t = ring.age / Ripples.DURATION;
      ring.mesh.scale.setScalar(1 + t * 3.5 * ring.strength);
      ring.mesh.material.opacity = (1 - t) * (1 - t);
    }
  }
}
