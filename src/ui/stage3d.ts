// The 3-D stage, drawn with three.js and loaded lazily (its own chunk).
// A sandstone building at dusk; in front of it, one stair per program state at height V; the walker
// (the running program, carrying a lantern) checks the loop condition before every step.
// Everything it shows comes from a StageScene built by src/core/stage.ts.

import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three';
import { beats, type Bad, type StageScene } from '../core/stage.ts';
import type { State } from '../core/sim.ts';
import type { Callout } from '../core/tutorial.ts';
import type { PlayInfo, RendererHooks, ShowOptions, StageRenderer, StageText } from './stageTypes.ts';

const SW = 1; // run of one stair (x)
const D = 1.9; // width of the stairs (z)
const WALL = -D / 2 - 0.02; // front face of the building

const PAL = {
  stoneA: 0xe3c08a,
  stoneB: 0xd2a96f,
  tread: 0xf3dfb8,
  wall: 0xc99a62,
  wallDark: 0xa57a4b,
  cornice: 0xe8cf9f,
  ground: 0x8c6b4c,
  groundEdge: 0x5d4532,
  basement: 0x241a28,
  basementLine: 0x5c4766,
  bad: 0xd4553f,
  badDark: 0x8e3326,
  ghost: 0xe0604a,
  winLit: 0xffb547,
  winDim: 0x3d3452,
  door: 0xffc46b,
  coat: 0x1f6c76,
  scarf: 0xf2a541,
  skin: 0xf2d6b8,
  legs: 0x2a2633,
  lantern: 0xffcf6e,
  rail: 0xe6a94a,
  zone: 0x8f9cff,
  skyline: 0x1b2552,
  tower: 0xd8b07a,
};

type SegKind = 'start' | 'guard' | 'step' | 'exit' | 'more' | 'cut' | 'fallIn' | 'pause';

interface Seg {
  kind: SegKind;
  from: number;
  to: number;
  dur: number;
  lines: number[];
  holds?: boolean;
  bad?: Bad;
  fall?: boolean;
  steps?: number;
}

interface WNode {
  p: Vector3;
  state: State;
  v: bigint[] | null;
  walking: boolean;
  bad?: Bad;
  check: string;
  lines: number[];
}

interface Label {
  el: HTMLElement;
  at: () => Vector3;
  /** Node index, for thinning out labels on long runs. */
  near?: number;
  /** Shown only while this returns true. */
  when?: () => boolean;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function createStage3D(parent: HTMLElement, layer: HTMLElement, text: StageText, hooks: RendererHooks): StageRenderer {
  return new Stage3D(parent, layer, text, hooks);
}

class Stage3D implements StageRenderer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.1, 400);
  private world = new Group();
  private owned: (BufferGeometry | Material)[] = [];
  private box = new BoxGeometry(1, 1, 1);
  private mats: Record<string, MeshStandardMaterial | MeshBasicMaterial> = {};
  private walker = new Group();
  private body = new Group();
  private legs: Group[] = [];
  private lanternLight: PointLight;
  private sun: DirectionalLight;
  private doorLight: PointLight | null = null;
  private doorGlow: MeshBasicMaterial | null = null;
  private hole: Mesh | null = null;

  private labels: Label[] = [];
  private nodes: WNode[] = [];
  private segs: Seg[] = [];
  private seg = 0;
  private t = 0;
  private first = true;
  private ring = false;
  private ringSteps = 0;
  private opts: ShowOptions = {};
  private model: StageScene | null = null;
  private bounds = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private camTarget = new Vector3();
  private camDist = 12;
  private snap = true;
  private walkerIndex = 0;
  private active = true;
  private last = 0;
  private ro: ResizeObserver;
  private text: StageText;
  private parent: HTMLElement;
  private layer: HTMLElement;
  private hooks: RendererHooks;
  /** The bubble over the walker while it checks the loop condition. */
  private bubble: HTMLElement | null = null;

  constructor(parent: HTMLElement, layer: HTMLElement, text: StageText, hooks: RendererHooks) {
    this.parent = parent;
    this.layer = layer;
    this.hooks = hooks;
    this.text = text;
    const r = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer = r;
    r.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.setClearColor(0x000000, 0);
    r.domElement.className = 'stage-gl';
    r.domElement.setAttribute('aria-hidden', 'true');
    parent.append(r.domElement);

    this.scene.add(new HemisphereLight(0x8d9be0, 0x6a4a35, 1.35));
    const sun = new DirectionalLight(0xffbe82, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0008;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.scene.add(this.world);

    const std = (color: number, extra: Partial<MeshStandardMaterial> = {}) => Object.assign(new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 }), extra);
    this.mats = {
      stoneA: std(PAL.stoneA),
      stoneB: std(PAL.stoneB),
      tread: std(PAL.tread, { roughness: 0.8 }),
      wall: std(PAL.wall),
      wallDark: std(PAL.wallDark),
      cornice: std(PAL.cornice),
      ground: std(PAL.ground),
      groundEdge: std(PAL.groundEdge),
      basement: std(PAL.basement, { roughness: 1, emissive: new Color(0x1c1226), emissiveIntensity: 1 }),
      basementLine: new MeshBasicMaterial({ color: PAL.basementLine }),
      bad: std(PAL.bad, { emissive: new Color(PAL.badDark), emissiveIntensity: 0.35 }),
      ghost: std(PAL.ghost, { transparent: true, opacity: 0.38, depthWrite: false }),
      winLit: std(0x40280f, { emissive: new Color(PAL.winLit), emissiveIntensity: 0.95 }),
      winDim: std(PAL.winDim, { roughness: 0.6 }),
      coat: std(PAL.coat, { roughness: 0.7 }),
      scarf: std(PAL.scarf, { roughness: 0.7 }),
      skin: std(PAL.skin, { roughness: 0.6 }),
      legs: std(PAL.legs),
      lantern: new MeshBasicMaterial({ color: PAL.lantern }),
      rail: std(PAL.rail, { metalness: 0.6, roughness: 0.35 }),
      zone: new MeshBasicMaterial({ color: PAL.zone, transparent: true, opacity: 0.13, depthWrite: false }),
      skyline: new MeshBasicMaterial({ color: PAL.skyline }),
      redMark: new MeshBasicMaterial({ color: PAL.bad }),
      hole: new MeshBasicMaterial({ color: 0x120c14, transparent: true, opacity: 0.9 }),
      tower: std(PAL.tower),
    };

    // The walker: coat, scarf, head, two legs, and a lantern that lights the stairs around it.
    const coat = new Mesh(new CapsuleGeometry(0.15, 0.28, 4, 12), this.mats.coat);
    coat.position.y = 0.45;
    const scarf = new Mesh(new TorusGeometry(0.12, 0.04, 8, 16), this.mats.scarf);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.66;
    const head = new Mesh(new SphereGeometry(0.12, 18, 14), this.mats.skin);
    head.position.y = 0.8;
    const hat = new Mesh(new CylinderGeometry(0.085, 0.13, 0.08, 16), this.mats.scarf);
    hat.position.y = 0.92;
    for (const m of [coat, scarf, head, hat]) {
      m.castShadow = true;
      this.body.add(m);
    }
    for (const z of [-0.07, 0.07]) {
      const hip = new Group();
      hip.position.set(0, 0.3, z);
      const leg = new Mesh(new CapsuleGeometry(0.05, 0.2, 4, 8), this.mats.legs);
      leg.position.y = -0.15;
      leg.castShadow = true;
      hip.add(leg);
      this.legs.push(hip);
      this.body.add(hip);
    }
    const lantern = new Group();
    lantern.position.set(0.2, 0.42, 0.1);
    const glass = new Mesh(new SphereGeometry(0.055, 12, 10), this.mats.lantern);
    const cap = new Mesh(new CylinderGeometry(0.03, 0.05, 0.04, 10), this.mats.legs);
    cap.position.y = 0.065;
    lantern.add(glass, cap);
    this.lanternLight = new PointLight(PAL.lantern, 2.2, 3.2, 1.6);
    lantern.add(this.lanternLight);
    this.body.add(lantern);
    this.walker.add(this.body);
    this.scene.add(this.walker);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(parent);
    this.resize();
    document.addEventListener('visibilitychange', this.onVisibility);
    r.setAnimationLoop((now) => this.tick(now));
  }

  private onVisibility = () => {
    this.last = performance.now();
  };

  // ------------------------------------------------------------ public

  setText(text: StageText): void {
    this.text = text;
    if (this.model) this.show(this.model, this.opts);
  }

  setActive(on: boolean): void {
    this.active = on;
    this.last = performance.now();
  }

  resize(): void {
    const w = this.parent.clientWidth || 1;
    const h = this.parent.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.applyShift();
    this.snap = true;
  }

  /** Off-centre projection: the subject sits to the right, leaving room for text on the left. */
  private applyShift(): void {
    const w = this.parent.clientWidth || 1;
    const h = this.parent.clientHeight || 1;
    const shift = w > 760 ? (this.opts.shift ?? 0) : 0;
    if (shift) this.camera.setViewOffset(w, h, -shift * w, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  replay(): void {
    this.restart(true);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearWorld();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  show(scene: StageScene, opts: ShowOptions): void {
    this.model = scene;
    this.opts = opts;
    this.clearWorld();
    this.ring = false;
    switch (scene.k) {
      case 'idle':
        this.buildIdle(scene);
        break;
      case 'stairs':
        this.buildStairs(scene);
        break;
      case 'shaft':
        this.buildShaft(scene);
        break;
      case 'ring':
        this.buildRing(scene);
        break;
    }
    for (const c of opts.callouts ?? []) this.callout(c);
    this.applyShift();
    this.snap = true;
    this.restart(true);
  }

  // ------------------------------------------------------------ building blocks

  private own<T extends BufferGeometry | Material>(x: T): T {
    this.owned.push(x);
    return x;
  }

  private clearWorld(): void {
    for (const c of [...this.world.children]) {
      this.world.remove(c);
      if (c instanceof InstancedMesh) c.dispose();
    }
    for (const x of this.owned) x.dispose();
    this.owned = [];
    for (const l of this.labels) l.el.remove();
    this.labels = [];
    this.doorLight = null;
    this.doorGlow = null;
    this.hole = null;
    this.nodes = [];
    this.segs = [];
  }

  /** An axis-aligned block from (x0, y0, z0) to (x1, y1, z1). */
  private block(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Material, shadow = true): Mesh {
    const m = new Mesh(this.box, mat);
    m.scale.set(Math.max(0.001, x1 - x0), Math.max(0.001, y1 - y0), Math.max(0.001, z1 - z0));
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.world.add(m);
    return m;
  }

  private label(html: string, cls: string, at: () => Vector3, near?: number, when?: () => boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = `l3 ${cls}`;
    el.innerHTML = html;
    this.layer.append(el);
    this.labels.push({ el, at, near, when });
    return el;
  }

  private esc(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  }

  /** The building, the ground and the basement, sized to the stairs in front of them. */
  private environment(x0: number, x1: number, top: number, depth: number, opts: { door?: number; pitFrom?: number; building?: boolean; front?: number } = {}): void {
    const B = Math.max(1.6, depth);
    const gz0 = WALL - 3.2;
    const gz1 = opts.front ?? D / 2 + 0.45;
    const pit = opts.pitFrom;
    // ground slab (stops where a bottomless pit opens)
    const gx1 = pit !== undefined ? pit : x1 + 5;
    this.block(x0 - 5, gx1, -0.16, 0, gz0, gz1, this.mats.ground!, false);
    this.block(x0 - 5, gx1, -0.2, -0.16, gz1 - 0.05, gz1, this.mats.groundEdge!, false);
    if (pit !== undefined) this.block(pit, x1 + 5, -0.16, 0, gz0, WALL - 1.0, this.mats.ground!, false);
    // basement: floor, back wall, side walls; the front is open (a cut-away)
    this.block(x0 - 5, x1 + 5, -B - 0.2, -B, gz0, gz1, this.mats.basement!, false);
    this.block(x0 - 5, x1 + 5, -B, -0.16, WALL - 0.4, WALL - 0.2, this.mats.basement!, false);
    for (let y = -1; y > -B; y -= 1) this.block(x0 - 5, x1 + 5, y - 0.015, y + 0.015, WALL - 0.19, WALL - 0.17, this.mats.basementLine!, false);
    if (opts.building === false) {
      this.skyline(x0, x1);
      return;
    }
    // the building
    const H = Math.max(2.8, top + 1.6);
    const bx0 = x0 - 1.6;
    const bx1 = x1 + 1.6;
    this.block(bx0, bx1, 0, H, WALL - 2.6, WALL, this.mats.wall!);
    this.block(bx0 - 0.12, bx1 + 0.12, H, H + 0.22, WALL - 2.72, WALL + 0.12, this.mats.cornice!);
    this.block(bx0 - 0.06, bx1 + 0.06, 0, 0.32, WALL - 2.66, WALL + 0.06, this.mats.wallDark!);
    for (let x = bx0 + 1.4; x < bx1 - 1; x += 3.7) {
      const hgt = 0.35 + hash(x, 3) * 0.5;
      this.block(x, x + 0.5, H + 0.22, H + 0.22 + hgt, WALL - 1.9, WALL - 1.3, this.mats.wallDark!);
    }
    // windows: a lit or dark pane every 0.9 along, avoiding the door
    const spots: [number, number, boolean][] = [];
    for (let row = 0; ; row++) {
      const y = 0.95 + row * 0.95;
      if (y > H - 0.45) break;
      for (let x = bx0 + 0.55; x < bx1 - 0.35; x += 0.9) {
        if (opts.door !== undefined && Math.abs(x - opts.door) < 0.9 && y < 1.6) continue;
        spots.push([x, y, hash(x * 3.1, row) < 0.42]);
      }
    }
    const pane = this.own(new PlaneGeometry(0.32, 0.46));
    for (const lit of [true, false]) {
      const list = spots.filter((s) => s[2] === lit);
      if (!list.length) continue;
      const inst = new InstancedMesh(pane, lit ? this.mats.winLit! : this.mats.winDim!, list.length);
      const m = new Matrix4();
      list.forEach(([x, y], i) => inst.setMatrixAt(i, m.makeTranslation(x, y, WALL + 0.006)));
      this.world.add(inst);
    }
    this.skyline(x0, x1);
    if (opts.door !== undefined) this.door(opts.door);
  }

  /** Dark blocks far behind: the rest of the town at dusk. */
  private skyline(x0: number, x1: number): void {
    for (let i = 0; i < 9; i++) {
      const w = 2 + hash(i, 9) * 3;
      const hh = 2 + hash(i, 4) * 6;
      const x = x0 - 12 + i * ((x1 - x0 + 24) / 8);
      this.block(x - w / 2, x + w / 2, -0.2, hh, WALL - 18 - hash(i, 2) * 6, WALL - 15, this.mats.skyline!, false);
    }
  }

  private door(x: number): void {
    this.block(x - 0.5, x - 0.36, 0, 1.45, WALL - 0.05, WALL + 0.12, this.mats.wallDark!);
    this.block(x + 0.36, x + 0.5, 0, 1.45, WALL - 0.05, WALL + 0.12, this.mats.wallDark!);
    this.block(x - 0.56, x + 0.56, 1.45, 1.62, WALL - 0.05, WALL + 0.14, this.mats.cornice!);
    const glow = this.own(new MeshBasicMaterial({ color: PAL.door }));
    this.doorGlow = glow;
    const pane = new Mesh(this.box, glow);
    pane.scale.set(0.72, 1.45, 0.02);
    pane.position.set(x, 0.725, WALL + 0.01);
    this.world.add(pane);
    const light = new PointLight(PAL.door, 1.6, 4, 1.5);
    light.position.set(x, 0.8, WALL + 0.6);
    this.doorLight = light;
    this.world.add(light);
    this.label(this.esc(this.text.exit), 'l3-door', () => new Vector3(x, 1.85, WALL + 0.2));
  }

  /** A vertical ruler of V values to the left of the stairs. */
  private ruler(x: number, unit: number, lo: number, hi: number, tuple: boolean): void {
    const pole = this.block(x - 0.03, x + 0.03, lo * unit - 0.05, hi * unit + 0.05, 0.5, 0.56, this.mats.legs!, false);
    pole.castShadow = false;
    if (tuple) {
      for (let f = Math.max(0, Math.floor(lo)); f <= Math.ceil(hi); f++) {
        this.block(x - 1.2, x + 0.6 + this.bounds.x1, f * unit - 0.02, f * unit + 0.02, WALL + 0.01, WALL + 0.06, this.mats.cornice!, false);
        if (f < hi) this.label(this.esc(this.text.floor(f)), 'l3-tick floor', () => new Vector3(x - 0.25, (f + 0.5) * unit, 0.55));
      }
      this.label('0', 'l3-tick zero', () => new Vector3(x - 0.25, 0, 0.55));
      return;
    }
    const span = Math.max(1, hi - lo);
    const raw = span / 6;
    const p = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
    const stepv = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
    for (let v = Math.ceil(lo / stepv) * stepv; v <= hi + 1e-9; v += stepv) {
      this.block(x - 0.14, x + 0.03, v * unit - 0.012, v * unit + 0.012, 0.47, 0.58, v === 0 ? this.mats.rail! : this.mats.legs!, false);
      const txt = v === 0 ? `0 · ${this.text.ground}` : String(v).replace('-', '−');
      this.label(this.esc(txt), `l3-tick${v === 0 ? ' zero' : ''}`, () => new Vector3(x - 0.2, v * unit, 0.55));
    }
  }

  // ------------------------------------------------------------ scenes

  private buildIdle(scene: Extract<StageScene, { k: 'idle' }>): void {
    void scene;
    const top = 2;
    this.environment(-1, 3, top, 1.6, { door: 3.5 });
    this.block(-0.5, 2.5, 0, top, -D / 2, D / 2, this.mats.stoneA!);
    this.block(-0.55, 2.55, top, top + 0.06, -D / 2 - 0.04, D / 2 + 0.05, this.mats.tread!);
    const p = new Vector3(1, top + 0.06, 0);
    this.nodes = [{ p, state: {}, v: null, walking: true, check: '', lines: [] }];
    this.label(this.esc(this.text.vUnknown), 'l3-v unknown', () => new Vector3(1, top + 1.25, 0.4));
    this.bounds = { x0: -2, x1: 4.5, y0: -0.8, y1: top + 1.6 };
    this.segs = [{ kind: 'start', from: 0, to: 0, dur: 4000, lines: [] }];
  }

  private buildStairs(scene: Extract<StageScene, { k: 'stairs' }>): void {
    const st = scene.stairs;
    const hs = st.map((s) => (s.walking || s.v ? s.h : 0));
    const ghostH = scene.ghost ? scene.ghost.h : 0;
    const all = [...hs, ghostH, 0];
    const hi = Math.max(...all);
    const lo = Math.min(...all);
    const unit = scene.tuple ? clamp(4.6 / Math.max(1, Math.ceil(hi)), 0.9, 2.3) : clamp(4.4 / Math.max(1, hi - Math.min(0, lo)), 0.07, 0.62);
    const n = st.length;
    const exitAt = scene.end === 'exit' ? n - 1 : undefined;
    const lastX = (n - 1) * SW + SW / 2;
    const depth = -Math.min(0, lo) * unit + 1.2;
    this.bounds = { x0: -1.6, x1: lastX + (scene.ghost ? 3 : 1), y0: Math.min(-0.5, lo * unit - 0.4), y1: Math.max(1.6, hi * unit + 1.3) };
    this.environment(-0.5, lastX + (scene.ghost ? 2.5 : 0.5), Math.max(0, hi * unit), depth, { door: exitAt !== undefined ? exitAt * SW + SW / 2 : undefined });
    const B = Math.max(1.6, depth);
    st.forEach((s, k) => {
      const x0 = k * SW;
      const x1 = x0 + SW;
      const cx = x0 + SW / 2;
      // Where the loop stops there is no stair, just the ground and the door. In a counterexample the
      // next state is still drawn at its V: the judge compares V before and after the step.
      if (!s.walking && scene.end !== 'cut') {
        this.nodes.push({ p: new Vector3(cx, 0, 0.1), state: s.s, v: s.v, walking: false, check: s.check, lines: [] });
        return;
      }
      const y = s.h * unit;
      const below = y < 0;
      const mat = s.bad === 'below' ? this.mats.bad! : k % 2 ? this.mats.stoneB! : this.mats.stoneA!;
      if (below) this.block(x0, x1, -B, y, -D / 2, D / 2, mat);
      else this.block(x0, x1, 0, Math.max(0.04, y), -D / 2, D / 2, mat);
      const top = below ? y : Math.max(0.04, y);
      this.block(x0 - 0.02, x1 + 0.04, top, top + 0.05, -D / 2 - 0.03, D / 2 + 0.05, s.bad === 'below' ? this.mats.bad! : this.mats.tread!);
      const p = new Vector3(cx, top + 0.05, 0.1);
      this.nodes.push({ p, state: s.s, v: s.v, walking: s.walking, bad: s.bad, check: s.check, lines: s.lines });
      const lbl = s.v ? this.hooks.format.rank(s.v).replace(/-/g, '−') : String(Math.round(s.h));
      const sub = this.hooks.format.state(scene.vars, s.s);
      this.label(`<b>${this.esc(lbl)}</b><small>${this.esc(sub)}</small>`, `l3-v${s.bad === 'below' ? ' bad' : ''}${scene.real ? ' real' : ''}`, () => new Vector3(cx, top + 0.08, D / 2 + 0.05), k);
      if (s.bad === 'flat' || s.bad === 'up') this.stepMark(k, s.bad, top);
      if (s.bad === 'below') this.label(this.esc(this.text.below), 'l3-mark', () => new Vector3(cx, top - 0.35, D / 2), undefined, () => this.markShown(k));
    });
    if (scene.end === 'more' && n > 0) {
      const last = this.nodes[n - 1]!.p;
      this.label(this.esc(this.text.more), 'l3-more', () => new Vector3(last.x + 0.9, last.y + 0.2, 0.4));
    }
    if (scene.railing) this.railing(scene.railing);
    if (scene.ghost) {
      const g = scene.ghost;
      const x0 = lastX + 1.6;
      const y = g.h * unit;
      const gz = D / 2 + 0.75;
      this.block(x0, x0 + SW, Math.min(0, y), Math.max(0, y) + 0.02, gz - 0.5, gz + 0.5, this.mats.ghost!, false);
      this.block(x0 - 0.02, x0 + SW + 0.02, y - 0.03, y + 0.03, gz - 0.52, gz + 0.52, this.mats.bad!, false);
      const lbl = g.v ? this.hooks.format.rank(g.v).replace(/-/g, '−') : '';
      const why = scene.railing ? this.text.outsideRail : this.text.unreachable;
      this.label(
        `<b>${this.esc(lbl)}</b><small>${this.esc(this.hooks.format.state(scene.vars, g.s))}</small><em>${this.esc(why)}</em>`,
        `l3-v ghost${scene.railing ? ' fenced' : ''}`,
        () => new Vector3(x0 + SW / 2, Math.max(0, y) + 0.12, gz),
      );
    }
    this.ruler(-0.75, unit, Math.min(0, lo), Math.max(hi, 1), scene.tuple);

    // the walk, beat by beat
    const segs: Seg[] = [{ kind: 'start', from: 0, to: 0, dur: 550, lines: [] }];
    if (st[0]?.walking && st[0].h * unit < 0) segs.push({ kind: 'fallIn', from: 0, to: 0, dur: 800, lines: [] });
    for (const b of beats(scene)) {
      if (b.kind === 'guard') segs.push({ kind: 'guard', from: b.k, to: b.k, dur: 520, lines: [scene.whileLine], holds: b.holds });
      else if (b.kind === 'step') {
        const dur = b.fall ? 1000 : b.bad === 'flat' ? 1050 : b.bad === 'up' ? 800 : 560;
        segs.push({ kind: 'step', from: b.k, to: b.k + 1, dur, lines: b.lines, bad: b.bad, fall: b.fall });
      } else if (b.kind === 'exit' && scene.end === 'cut') segs.push({ kind: 'cut', from: b.k, to: b.k, dur: 1500, lines: [] });
      else if (b.kind === 'exit') segs.push({ kind: 'exit', from: b.k, to: b.k, dur: 1150, lines: [], steps: b.steps });
      else segs.push({ kind: b.kind, from: b.k, to: b.k, dur: b.kind === 'cut' ? 1500 : 1000, lines: [] });
    }
    segs.push({ kind: 'pause', from: n - 1, to: n - 1, dur: 1600, lines: [] });
    this.segs = segs;
  }

  /** Red warning labels: only the one where the walker is (the red marks on the stairs stay). */
  private markShown(k: number): boolean {
    return this.nodes.length <= 2 || k === this.walkerIndex;
  }

  /** A red sign where a step does not go down. */
  private stepMark(k: number, bad: 'flat' | 'up', top: number): void {
    const x = (k + 1) * SW;
    if (bad === 'up') {
      const cone = new Mesh(this.own(new ConeGeometry(0.13, 0.3, 14)), this.mats.redMark!);
      cone.position.set(x, top + 0.75, D / 2 - 0.15);
      this.world.add(cone);
      this.block(x - 0.035, x + 0.035, top + 0.25, top + 0.62, D / 2 - 0.18, D / 2 - 0.12, this.mats.redMark!, false);
    } else {
      for (const dy of [0.42, 0.56]) this.block(x - 0.25, x + 0.25, top + dy, top + dy + 0.06, D / 2 - 0.18, D / 2 - 0.12, this.mats.redMark!, false);
    }
    this.label(this.esc(bad === 'up' ? this.text.up : this.text.flat), 'l3-mark', () => new Vector3(x, top + 1.1, D / 2 - 0.1), undefined, () => this.markShown(k));
  }

  /** A brass railing along the walking stairs. */
  private railing(cond: string): void {
    const pts = this.nodes.filter((n) => n.walking).map((n) => n.p.clone().add(new Vector3(0, 0.62, -D / 2 + 0.12)));
    if (!pts.length) return;
    const post = this.own(new CylinderGeometry(0.025, 0.025, 1, 8));
    const bar = this.own(new CylinderGeometry(0.035, 0.035, 1, 8));
    pts.forEach((p) => {
      const m = new Mesh(post, this.mats.rail!);
      m.scale.y = 0.62;
      m.position.set(p.x, p.y - 0.31, p.z);
      m.castShadow = true;
      this.world.add(m);
    });
    const ext = [pts[0]!.clone().add(new Vector3(-0.5, 0, 0)), ...pts, pts[pts.length - 1]!.clone().add(new Vector3(0.5, 0, 0))];
    for (let i = 0; i + 1 < ext.length; i++) {
      const a = ext[i]!;
      const b = ext[i + 1]!;
      const m = new Mesh(bar, this.mats.rail!);
      const len = a.distanceTo(b);
      m.scale.y = len;
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
      m.castShadow = true;
      this.world.add(m);
    }
    const p0 = pts[0]!;
    this.label(`${this.esc(this.text.railing)} <code>${this.esc(cond.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠'))}</code>`, 'l3-rail', () => new Vector3(p0.x - 0.2, p0.y + 0.35, p0.z));
  }

  private buildShaft(full: Extract<StageScene, { k: 'shaft' }>): void {
    const scene = { ...full, states: full.states.slice(0, 30) };
    const n = scene.states.length;
    const drop = 0.42;
    const lastX = (n - 1) * SW + SW / 2;
    const deepest = (n - 1) * drop;
    this.environment(-0.5, Math.min(lastX, 30), 1.4, Math.min(deepest + 2, 40), { pitFrom: 0.02 });
    // the start: a landing at ground level in front of the building
    this.block(-1.6, SW, -0.16, 0.04, -D / 2, D / 2, this.mats.stoneA!);
    scene.states.forEach((s, k) => {
      const x0 = k * SW;
      const y = -k * drop;
      if (k > 0) {
        this.block(x0, x0 + SW, y - 0.35, y, -D / 2, D / 2, k % 2 ? this.mats.stoneB! : this.mats.stoneA!);
        this.block(x0 - 0.02, x0 + SW + 0.04, y, y + 0.05, -D / 2 - 0.03, D / 2 + 0.05, this.mats.tread!);
      }
      const p = new Vector3(x0 + SW / 2, (k > 0 ? y + 0.05 : 0.04) + 0, 0.1);
      this.nodes.push({ p, state: s, v: null, walking: true, check: scene.checks[k] ?? '', lines: scene.lines[k] ?? [] });
      this.label(`<small>${this.esc(this.hooks.format.state(scene.vars, s))}</small>`, 'l3-v state', () => new Vector3(p.x, p.y + 0.05, D / 2 + 0.05), k);
    });
    if (scene.zone) {
      const zx1 = lastX + 0.6;
      const zone = this.block(-0.1, zx1, -deepest - 0.6, 1.3, -D / 2 - 0.1, D / 2 + 0.25, this.mats.zone!, false);
      zone.receiveShadow = false;
      this.label(`${this.esc(this.text.zone)} <code>Z: ${this.esc(scene.zone.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠'))}</code>`, 'l3-zone', () => {
        const w = this.walker.position;
        return new Vector3(w.x + 1.2, w.y + 1.5, 0.4);
      });
    }
    this.label('∞', 'l3-inf', () => {
      const last = this.nodes[this.nodes.length - 1]!.p;
      return new Vector3(last.x + 0.9, last.y - 0.3, 0.4);
    });
    this.bounds = { x0: -1.8, x1: lastX + 1, y0: -deepest - 1, y1: 1.8 };
    const segs: Seg[] = [{ kind: 'start', from: 0, to: 0, dur: 500, lines: [] }];
    for (let k = 0; k < n; k++) {
      segs.push({ kind: 'guard', from: k, to: k, dur: k < 4 ? 480 : 260, lines: [scene.whileLine], holds: true });
      if (k + 1 < n) segs.push({ kind: 'step', from: k, to: k + 1, dur: k < 4 ? 560 : 360, lines: scene.lines[k] ?? [] });
    }
    segs.push({ kind: 'more', from: n - 1, to: n - 1, dur: 1200, lines: [] });
    segs.push({ kind: 'pause', from: n - 1, to: n - 1, dur: 800, lines: [] });
    this.segs = segs;
  }

  private buildRing(scene: Extract<StageScene, { k: 'ring' }>): void {
    this.ring = true;
    const len = scene.cycle.length;
    const tiles = Math.max(len, 4);
    const R = Math.max(1.5, (tiles * 0.95) / (2 * Math.PI));
    const top = 1.6;
    const cx = 0;
    this.environment(-R - 1.5, R + 1.5, top + 0.6, 1.6, { building: false, front: R + 1.4 });
    const tower = new Mesh(this.own(new CylinderGeometry(R + 0.5, R + 0.65, top, 40)), this.mats.tower!);
    tower.position.set(cx, top / 2, 0.4);
    tower.castShadow = true;
    tower.receiveShadow = true;
    this.world.add(tower);
    const rim = new Mesh(this.own(new TorusGeometry(R + 0.5, 0.06, 8, 48)), this.mats.rail!);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(cx, top + 0.02, 0.4);
    this.world.add(rim);
    const disc = new Mesh(this.own(new CircleGeometry(R - 0.45, 40)), this.mats.cornice!);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(cx, top + 0.01, 0.4);
    this.world.add(disc);
    for (let i = 0; i < tiles; i++) {
      const a = (i / tiles) * Math.PI * 2 + Math.PI / 2;
      const x = cx + Math.cos(a) * R;
      const z = 0.4 + Math.sin(a) * R;
      const tile = new Mesh(this.box, i % 2 ? this.mats.stoneB! : this.mats.tread!);
      tile.scale.set(0.8, 0.08, 0.8);
      tile.position.set(x, top + 0.04, z);
      tile.rotation.y = -a;
      tile.receiveShadow = true;
      this.world.add(tile);
      const s = scene.cycle[i % len]!;
      const p = new Vector3(x, top + 0.08, z);
      this.nodes.push({ p, state: s, v: null, walking: true, check: scene.checks[i % len] ?? '', lines: scene.lines[i % len] ?? [] });
      this.label(`<small>${this.esc(this.hooks.format.state(scene.vars, s))}</small>`, 'l3-v state', () => new Vector3(p.x, p.y + 0.05, p.z + 0.3));
    }
    this.label('∞', 'l3-inf big', () => new Vector3(cx, top + 0.9, 0.4));
    this.bounds = { x0: -R - 1.4, x1: R + 1.4, y0: -0.4, y1: top + 1.5 };
    const segs: Seg[] = [{ kind: 'start', from: 0, to: 0, dur: 400, lines: [] }];
    for (let i = 0; i < tiles; i++) {
      segs.push({ kind: 'guard', from: i, to: i, dur: 420, lines: [scene.whileLine], holds: true });
      segs.push({ kind: 'step', from: i, to: (i + 1) % tiles, dur: 620, lines: scene.lines[i % len] ?? [] });
    }
    this.segs = segs;
  }

  private callout(c: Callout): void {
    const t = this.esc(this.text.callouts[c]);
    const firstStair = () => this.nodes.find((n) => n.walking)?.p ?? new Vector3();
    switch (c) {
      case 'ground':
        this.label(t, 'l3-call', () => new Vector3(this.bounds.x0 - 0.2, 0.05, D / 2 + 0.3));
        break;
      case 'basement':
        this.label(t, 'l3-call dark', () => new Vector3(this.bounds.x0 + 0.4, -1.0, D / 2 + 0.3));
        break;
      case 'walker':
        this.label(t, 'l3-call', () => this.walker.position.clone().add(new Vector3(0, 1.35, 0)));
        break;
      case 'door': {
        const exit = this.nodes.find((n) => !n.walking);
        if (exit) this.label(t, 'l3-call', () => new Vector3(exit.p.x, 2.35, WALL));
        break;
      }
      case 'stair':
        this.label(t, 'l3-call', () => firstStair().clone().add(new Vector3(0.6, 0.9, 0.6)));
        break;
    }
  }

  // ------------------------------------------------------------ playback

  private restart(first: boolean): void {
    this.first = first;
    this.seg = 0;
    this.t = 0;
    this.ringSteps = 0;
    this.walker.visible = this.nodes.length > 0;
    this.walker.scale.setScalar(1);
    this.body.rotation.set(0, 0, 0);
    this.walker.rotation.set(0, 0, 0);
    if (this.hole) this.hole.visible = false;
    if (this.nodes[0]) this.walker.position.copy(this.nodes[0].p);
    this.enter();
  }

  private speed(): number {
    return this.hooks.reducedMotion() ? 2.2 : 1;
  }

  /** Entering a segment: tell the screen (code lines, HUD) and play a sound. */
  private enter(): void {
    const s = this.segs[this.seg];
    if (!s) return;
    const node = this.nodes[s.kind === 'step' ? s.from : s.from];
    const sound = this.first && this.opts.sound;
    const info = (kind: PlayInfo['kind'], extra: Partial<PlayInfo> = {}): PlayInfo => ({
      kind,
      k: this.ring ? this.ringSteps : s.from,
      lines: s.lines,
      state: node?.state,
      v: node?.v ?? null,
      first: this.first,
      ...extra,
    });
    switch (s.kind) {
      case 'start':
        this.opts.onBeat?.(info('start'));
        break;
      case 'guard':
        this.opts.onBeat?.(info('guard', { holds: s.holds }));
        break;
      case 'step': {
        this.opts.onBeat?.(info('step', { bad: s.bad }));
        if (sound) {
          const to = this.nodes[s.to];
          if (s.fall) this.hooks.sound('fall', 0);
          else if (s.bad) this.hooks.sound('fail', 0);
          else this.hooks.sound('step', to ? to.p.y * 3 : 0);
        }
        break;
      }
      case 'exit':
        this.opts.onBeat?.(info('exit', { steps: s.steps }));
        if (sound) this.hooks.sound('land', 0);
        break;
      case 'more':
      case 'cut':
        this.opts.onBeat?.(info(s.kind));
        break;
      case 'fallIn':
        if (sound) this.hooks.sound('fall', 0);
        break;
      case 'pause':
        break;
    }
  }

  private advance(dt: number): void {
    if (!this.segs.length) return;
    this.t += dt * this.speed();
    let guard = 0;
    while (this.t >= (this.segs[this.seg]?.dur ?? Infinity) && guard++ < 50) {
      const done = this.segs[this.seg]!;
      this.t -= done.dur;
      if (done.kind === 'step' && this.ring) this.ringSteps++;
      this.seg++;
      if (this.seg >= this.segs.length) {
        if (this.ring) {
          this.seg = 0;
          this.first = false;
        } else if (this.opts.loop === false) {
          this.seg = this.segs.length - 1;
          this.t = done.dur;
          return;
        } else {
          this.restart(false);
          return;
        }
      }
      this.enter();
    }
  }

  private pose(): void {
    const s = this.segs[this.seg];
    if (!s || !this.nodes.length) return;
    const u = clamp(this.t / s.dur, 0, 1);
    const a = this.nodes[s.from]!;
    const b = this.nodes[s.to] ?? a;
    const w = this.walker;
    const reduced = this.hooks.reducedMotion();
    let swing = 0;
    this.body.rotation.set(0, 0, 0);
    w.visible = true;
    w.scale.setScalar(1);
    const face = (dx: number, dz: number) => {
      if (Math.abs(dx) + Math.abs(dz) > 1e-6) w.rotation.y = Math.atan2(-dz, dx);
    };
    if (!this.ring) w.rotation.y = 0;
    switch (s.kind) {
      case 'step': {
        if (this.ring) face(b.p.x - a.p.x, b.p.z - a.p.z);
        if (s.fall) {
          const split = 0.38;
          if (u < split) {
            const e = ease(u / split);
            w.position.set(lerp(a.p.x, b.p.x, e), Math.max(a.p.y, 0.02) + Math.sin(e * Math.PI) * 0.15, lerp(a.p.z, b.p.z, e));
            swing = Math.sin(u * 30);
          } else {
            const e = ((u - split) / (1 - split)) ** 2;
            w.position.set(b.p.x, lerp(Math.max(a.p.y, 0.02), b.p.y, e), b.p.z);
            this.body.rotation.z = -e * 0.5 * (1 - e);
            this.showHole(b.p.x);
          }
        } else if (s.bad === 'flat') {
          const split = 0.5;
          if (u < split) {
            const e = ease(u / split);
            w.position.set(lerp(a.p.x, b.p.x, e), lerp(a.p.y, b.p.y, e) + Math.sin(e * Math.PI) * 0.14, lerp(a.p.z, b.p.z, e));
            swing = Math.sin(u * 28);
          } else {
            const k = (u - split) / (1 - split);
            w.position.copy(b.p);
            this.body.rotation.z = reduced ? -0.2 : -Math.sin(k * Math.PI * 3) * 0.42 * (1 - k);
          }
        } else {
          const e = ease(u);
          const rise = Math.max(0, b.p.y - a.p.y);
          w.position.set(lerp(a.p.x, b.p.x, e), lerp(a.p.y, b.p.y, e) + Math.sin(e * Math.PI) * (0.16 + rise * 0.6), lerp(a.p.z, b.p.z, e));
          swing = Math.sin(u * Math.PI * 2);
        }
        break;
      }
      case 'fallIn': {
        const e = u * u;
        w.position.set(a.p.x, lerp(0.05, a.p.y, e), a.p.z);
        this.showHole(a.p.x);
        break;
      }
      case 'exit': {
        // turn to the door, walk in, and disappear into the light
        const doorZ = WALL + 0.2;
        if (u < 0.2) {
          w.position.copy(a.p);
          w.rotation.y = (u / 0.2) * (Math.PI / 2);
        } else {
          const e = ease((u - 0.2) / 0.8);
          w.rotation.y = Math.PI / 2;
          w.position.set(a.p.x, a.p.y, lerp(a.p.z, doorZ, e));
          swing = Math.sin(u * 26);
          if (e > 0.7) w.scale.setScalar(Math.max(0.001, 1 - (e - 0.7) / 0.3));
        }
        if (this.doorGlow) this.doorGlow.color.setHex(PAL.door).multiplyScalar(1 + u * 0.6);
        break;
      }
      case 'pause': {
        const last = this.segs[this.seg - 1];
        if (last?.kind === 'exit') w.visible = false;
        else w.position.copy(a.p);
        break;
      }
      default:
        w.position.copy(a.p);
        if (s.kind === 'guard' && !reduced) this.body.position.y = Math.sin(u * Math.PI) * 0.04;
    }
    if (s.kind !== 'guard') this.body.position.y = 0;
    const amp = reduced ? 0.15 : 0.55;
    this.legs[0]!.rotation.z = swing * amp;
    this.legs[1]!.rotation.z = -swing * amp;
    const idx = s.kind === 'step' && u > 0.5 ? s.to : s.from;
    this.walkerIndex = idx;
  }

  private showHole(x: number): void {
    if (!this.hole) {
      this.hole = new Mesh(this.own(new CircleGeometry(0.42, 24)), this.mats.hole!);
      this.hole.rotation.x = -Math.PI / 2;
      this.world.add(this.hole);
    }
    this.hole.visible = true;
    this.hole.position.set(x, 0.012, 0.1);
  }

  // ------------------------------------------------------------ camera

  private fit(): { dist: number; follow: boolean } {
    const tanV = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    const tanH = tanV * this.camera.aspect;
    const { x0, x1, y0, y1 } = this.bounds;
    const W = x1 - x0;
    const H = y1 - y0;
    const need = Math.max(H / 2 / tanV, W / 2 / tanH, 8.5) * 1.12 + 1.6;
    const narrow = this.camera.aspect < 1.1;
    const cap = narrow ? 17 : 21;
    if (need <= cap || this.ring) return { dist: Math.min(need, 28), follow: false };
    const Wf = narrow ? 6.2 : 10;
    const Hf = Math.min(H, narrow ? 6.5 : 5.5);
    return { dist: Math.max(Hf / 2 / tanV, Wf / 2 / tanH) * 1.05 + 1.4, follow: true };
  }

  private updateCamera(dt: number): void {
    const { dist, follow } = this.fit();
    const { x0, x1, y0, y1 } = this.bounds;
    const want = follow
      ? new Vector3(clamp(this.walker.position.x + 1.4, x0 + 3, x1 - 3), this.walker.position.y + 0.3, 0)
      : new Vector3((x0 + x1) / 2, (y0 + y1) / 2, this.ring ? 0.4 : 0);
    const k = this.snap ? 1 : 1 - Math.exp(-dt * (this.hooks.reducedMotion() ? 8 : 2.6));
    this.camTarget.lerp(want, k);
    this.camDist = lerp(this.camDist, dist * (this.opts.zoom ?? 1), k);
    this.snap = false;
    const dir = new Vector3(this.ring ? 0.0 : 0.3, this.ring ? 0.62 : 0.4, 1).normalize();
    this.camera.position.copy(this.camTarget).addScaledVector(dir, this.camDist);
    this.camera.lookAt(this.camTarget);
    this.sun.position.copy(this.camTarget).add(new Vector3(-7, 11, 8));
    this.sun.target.position.copy(this.camTarget);
  }

  private updateLabels(): void {
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    const many = this.nodes.length > (w < 520 ? 6 : 14);
    const radius = w < 520 ? 2 : 6;
    for (const l of this.labels) {
      if (l.when && !l.when()) {
        l.el.style.display = 'none';
        continue;
      }
      if (many && l.near !== undefined && l.near !== 0 && Math.abs(l.near - this.walkerIndex) > radius) {
        l.el.style.display = 'none';
        continue;
      }
      const p = l.at().project(this.camera);
      if (p.z > 1 || p.x < -1.3 || p.x > 1.3 || p.y < -1.3 || p.y > 1.3) {
        l.el.style.display = 'none';
        continue;
      }
      l.el.style.display = '';
      l.el.style.setProperty('--x', `${(((p.x + 1) / 2) * w).toFixed(1)}px`);
      l.el.style.setProperty('--y', `${(((1 - p.y) / 2) * h).toFixed(1)}px`);
    }
  }

  private updateBubble(): void {
    const s = this.segs[this.seg];
    if (!this.bubble) {
      this.bubble = document.createElement('div');
      this.bubble.className = 'l3 l3-check';
      this.layer.append(this.bubble);
    }
    const b = this.bubble;
    if (!s || s.kind !== 'guard' || !this.walker.visible) {
      b.style.display = 'none';
      return;
    }
    const node = this.nodes[s.from];
    const decided = this.t / s.dur > 0.35;
    // The check that ends the run says where the walker goes: "4 < 4 false → loop ends, to the exit".
    const verdict = s.holds ? `✓ ${this.text.yes}` : `✗ ${this.text.exitCheck}`;
    const html = `<code>${this.esc(node?.check ?? '')}</code>${decided ? `<span>${this.esc(verdict)}</span>` : '<span>?</span>'}`;
    if (b.dataset.html !== html) {
      b.innerHTML = html;
      b.dataset.html = html;
    }
    b.classList.toggle('yes', decided && !!s.holds);
    b.classList.toggle('no', decided && !s.holds);
    const p = this.walker.position.clone().add(new Vector3(0, 1.25, 0)).project(this.camera);
    b.style.display = '';
    b.style.setProperty('--x', `${(((p.x + 1) / 2) * this.parent.clientWidth).toFixed(1)}px`);
    b.style.setProperty('--y', `${(((1 - p.y) / 2) * this.parent.clientHeight).toFixed(1)}px`);
  }

  private tick(now: number): void {
    const dt = this.last ? Math.min(60, now - this.last) : 16;
    this.last = now;
    if (!this.active || document.hidden) return;
    this.advance(dt);
    this.pose();
    this.updateCamera(dt / 1000);
    if (this.doorLight) this.doorLight.intensity = 1.4 + Math.sin(now / 500) * 0.15;
    this.lanternLight.intensity = 2 + Math.sin(now / 170) * 0.25;
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.updateBubble();
  }
}
