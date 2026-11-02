// The walker as a three.js figure: an adult in a jacket, trousers and a scarf, carrying a lantern in the
// right hand. Smooth low-poly solids (lathes, capsules, spheres) hang on a small skeleton; poses come
// from gait.ts, and the legs are solved with two-bone IK so that planted feet stay where they were put.
// The figure faces +x, its feet at y = 0, and it is 1 tall.

import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { hipJoint, kneePole, legIK, type Pose, type Side, type Vec } from './gait.ts';

/** Clothes for a dusk walk: a petrol jacket, charcoal trousers, brown shoes, an amber scarf. */
const COL = {
  jacket: 0x2a6672,
  trousers: 0x2c2b3a,
  shoe: 0x4a3326,
  sole: 0x1d1714,
  skin: 0xe9c29d,
  hair: 0x2e2019,
  eye: 0x1a1310,
  scarf: 0xe7a23e,
  metal: 0x34302e,
  lantern: 0xffcf6e,
};

type Ring = [y: number, r: number];

/** A solid of revolution down the −y axis through rings [y, r] (top first), with rounded ends. */
function lathe(rings: Ring[], segs: number, capTop = 1, capBottom = 1): LatheGeometry {
  const pts: Vector2[] = [];
  const [yb, rb] = rings[rings.length - 1]!;
  const [yt, rt] = rings[0]!;
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new Vector2(Math.sin(a) * rb, yb - Math.cos(a) * rb * capBottom));
  }
  for (let i = rings.length - 1; i >= 0; i--) pts.push(new Vector2(rings[i]![1], rings[i]![0]));
  for (let i = n - 1; i >= 0; i--) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new Vector2(Math.sin(a) * rt, yt + Math.cos(a) * rt * capTop));
  }
  return new LatheGeometry(pts, segs);
}

/** A sphere stretched to an ellipsoid. */
const blob = (r: number, sx: number, sy: number, sz: number, w = 14, h = 10) => new SphereGeometry(r, w, h).scale(sx, sy, sz);

// skeleton offsets (stage units)
const WAIST = 0.09; // spine pivot above the hip joints
const SHOULDER: Vec = { x: -0.006, y: 0.2, z: 0.102 }; // from the waist
const UPPER_ARM = 0.185;
const FOREARM = 0.142;

export class Figure {
  readonly root = new Group();
  readonly light: PointLight;
  private kept: (BufferGeometry | Material)[] = [];
  private pelvis = new Group();
  private spine = new Group();
  private neck = new Group();
  private head = new Group();
  private chest: Mesh;
  private arms: { shoulder: Group; elbow: Group; hand: Group }[] = [];
  private legs: { thigh: Group; shin: Group; foot: Group }[] = [];
  private lantern = new Group();
  private grip = new Vector3(0.012, -0.038, 0);
  private m = new Matrix4();
  private bx = new Vector3();
  private by = new Vector3();
  private bz = new Vector3();

  constructor() {
    const std = (color: number, roughness: number, metalness = 0) => this.keep(new MeshStandardMaterial({ color, roughness, metalness }));
    const M = {
      jacket: std(COL.jacket, 0.8),
      trousers: std(COL.trousers, 0.88),
      shoe: std(COL.shoe, 0.55),
      sole: std(COL.sole, 0.9),
      skin: std(COL.skin, 0.62),
      hair: std(COL.hair, 0.78),
      eye: std(COL.eye, 0.4),
      scarf: std(COL.scarf, 0.9),
      metal: std(COL.metal, 0.45, 0.6),
      glass: this.keep(new MeshBasicMaterial({ color: COL.lantern })),
    };

    // pelvis: hips in trousers, the jacket's lower part over them
    this.root.add(this.pelvis);
    this.add(this.pelvis, lathe([[0.1, 0.086], [0.05, 0.098], [0, 0.103], [-0.04, 0.093], [-0.068, 0.07]], 16, 0.3, 0.45).scale(0.64, 1, 1), M.trousers);
    this.add(this.pelvis, lathe([[0.12, 0.086], [0.06, 0.099], [0.0, 0.111], [-0.036, 0.117]], 16, 0.3, 0.1).scale(0.68, 1, 1), M.jacket, 0.004);

    // chest: the jacket from the waist to the shoulders, the scarf, the neck and the head
    this.spine.position.y = WAIST;
    this.pelvis.add(this.spine);
    this.chest = this.add(this.spine, lathe([[0.235, 0.05], [0.218, 0.084], [0.2, 0.104], [0.16, 0.112], [0.1, 0.107], [0.03, 0.101], [-0.025, 0.106], [-0.034, 0.107]], 18, 0.35, 0.12).scale(0.62, 1, 1), M.jacket, 0.004);
    for (const z of [-SHOULDER.z, SHOULDER.z]) this.add(this.spine, blob(0.04, 0.95, 0.8, 0.95), M.jacket, SHOULDER.x, SHOULDER.y + 0.002, z * 0.97);
    this.add(this.spine, new TorusGeometry(0.043, 0.019, 8, 22).rotateX(Math.PI / 2).scale(1.1, 1, 1.18), M.scarf, 0.004, 0.228);
    const tail = this.add(this.spine, new CapsuleGeometry(0.015, 0.07, 4, 8).scale(0.45, 1, 1.1), M.scarf, 0.064, 0.17, 0.03);
    tail.rotation.z = -0.12;

    this.neck.position.set(0.004, 0.232, 0);
    this.spine.add(this.neck);
    this.add(this.neck, new CylinderGeometry(0.027, 0.031, 0.08, 12), M.skin, 0.002, 0.02);
    this.head.position.set(0.008, 0.052, 0);
    this.neck.add(this.head);
    this.buildHead(M);

    // arms: sleeves to the wrists, bare hands; the right one holds the lantern's handle
    for (const side of [0, 1] as const) {
      const shoulder = new Group();
      shoulder.position.set(SHOULDER.x, SHOULDER.y, side ? SHOULDER.z : -SHOULDER.z);
      this.spine.add(shoulder);
      this.add(shoulder, lathe([[0, 0.041], [-0.08, 0.039], [-UPPER_ARM, 0.034]], 12), M.jacket);
      const elbow = new Group();
      elbow.position.y = -UPPER_ARM;
      shoulder.add(elbow);
      this.add(elbow, lathe([[0, 0.034], [-0.07, 0.033], [-FOREARM + 0.008, 0.029]], 12, 1, 0.35), M.jacket);
      const hand = new Group();
      hand.position.y = -FOREARM;
      elbow.add(hand);
      const zi = side ? -1 : 1; // toward the body
      if (side) {
        this.add(hand, blob(0.026, 1.12, 1.05, 0.82), M.skin, 0.008, -0.028);
        this.add(hand, blob(0.011, 1, 1.4, 1), M.skin, 0.026, -0.022, 0.006 * zi);
      } else {
        this.add(hand, blob(0.026, 0.88, 1.55, 0.55), M.skin, 0.004, -0.036);
        this.add(hand, blob(0.0105, 1, 1.7, 1), M.skin, 0.022, -0.026, 0.008 * zi).rotation.z = 0.3;
      }
      this.arms.push({ shoulder, elbow, hand });
    }

    // legs: trousers and shoes, placed by IK every frame
    for (let i = 0; i < 2; i++) {
      const thigh = new Group();
      const shin = new Group();
      const foot = new Group();
      this.root.add(thigh, shin, foot);
      this.add(thigh, lathe([[0, 0.054], [-0.05, 0.058], [-0.15, 0.05], [-0.235, 0.044]], 12).scale(0.98, 1, 1), M.trousers);
      this.add(shin, lathe([[0, 0.045], [-0.07, 0.047], [-0.16, 0.039], [-0.222, 0.039]], 12, 1, 0.25), M.trousers);
      this.add(foot, new CapsuleGeometry(0.029, 0.112, 4, 12).rotateZ(Math.PI / 2).scale(1, 0.8, 1.02), M.shoe, 0.038, -0.022);
      this.add(foot, blob(0.033, 1.05, 0.95, 0.9), M.shoe, -0.008, -0.01);
      this.add(foot, new CapsuleGeometry(0.03, 0.114, 4, 12).rotateZ(Math.PI / 2).scale(1, 0.26, 1.05), M.sole, 0.038, -0.039);
      this.legs.push({ thigh, shin, foot });
    }

    // the lantern hangs from the right hand by its handle
    this.root.add(this.lantern);
    this.add(this.lantern, new TorusGeometry(0.024, 0.0035, 5, 14, Math.PI).rotateY(Math.PI / 2), M.metal, 0, -0.024);
    this.add(this.lantern, new ConeGeometry(0.04, 0.034, 12), M.metal, 0, -0.04);
    this.add(this.lantern, new CylinderGeometry(0.032, 0.032, 0.072, 14), M.glass, 0, -0.093);
    this.add(this.lantern, new CylinderGeometry(0.039, 0.035, 0.016, 14), M.metal, 0, -0.136);
    for (const a of [0.8, 2.37, 3.93, 5.5]) this.add(this.lantern, new CylinderGeometry(0.004, 0.004, 0.072, 4), M.metal, Math.cos(a) * 0.033, -0.093, Math.sin(a) * 0.033);
    this.light = new PointLight(COL.lantern, 2.2, 3.2, 1.6);
    this.light.position.y = -0.095;
    this.lantern.add(this.light);
  }

  /** The centre of the skull in world space, as of the last render (the tutorial's speech bubble points at it). */
  headWorld(out: Vector3): Vector3 {
    return this.head.localToWorld(out.set(-0.006, 0.05, 0));
  }

  /** Skull, face, ears, hair; eyes and brows only (a calm, simple face). */
  private buildHead(M: Record<'skin' | 'hair' | 'eye', Material>): void {
    const h = this.head;
    this.add(h, blob(0.056, 1.02, 1, 0.82, 18, 14), M.skin, -0.006, 0.052);
    this.add(h, blob(0.043, 1, 1.18, 0.84), M.skin, 0.012, 0.024);
    this.add(h, blob(0.0085, 0.85, 1.75, 0.72, 8, 6), M.skin, 0.051, 0.03);
    for (const z of [-0.046, 0.046]) this.add(h, blob(0.0125, 0.7, 1.25, 0.45, 8, 6), M.skin, -0.006, 0.036, z);
    for (const z of [-0.019, 0.019]) {
      this.add(h, new SphereGeometry(0.0068, 8, 6), M.eye, 0.0435, 0.042, z);
      const brow = this.add(h, new CapsuleGeometry(0.0033, 0.013, 2, 6).rotateX(Math.PI / 2), M.hair, 0.0475, 0.0545, z * 1.05);
      brow.rotation.x = z > 0 ? 0.12 : -0.12;
    }
    const cap = this.add(h, new SphereGeometry(0.0612, 22, 12, 0, Math.PI * 2, 0, 1.75).scale(1.04, 1.06, 0.87), M.hair, -0.008, 0.054);
    cap.rotation.z = 0.78;
    this.add(h, blob(0.045, 0.85, 1, 0.92), M.hair, -0.022, 0.04);
  }

  private keep<T extends BufferGeometry | Material>(x: T): T {
    this.kept.push(x);
    return x;
  }

  private add(parent: Object3D, geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0): Mesh {
    const m = new Mesh(this.keep(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  /** Points a limb segment's −y axis from `from` to `to`, its front toward `pole`. */
  private bone(g: Group, from: Vec, to: Vec, pole: Vec): void {
    this.by.set(from.x - to.x, from.y - to.y, from.z - to.z).normalize();
    this.bx.set(pole.x, pole.y, pole.z);
    this.bx.addScaledVector(this.by, -this.bx.dot(this.by)).normalize();
    this.bz.crossVectors(this.bx, this.by);
    this.m.makeBasis(this.bx, this.by, this.bz);
    g.position.set(from.x, from.y, from.z);
    g.quaternion.setFromRotationMatrix(this.m);
  }

  apply(p: Pose): void {
    this.pelvis.position.set(p.hip.x, p.hip.y, p.hip.z);
    this.pelvis.rotation.set(p.roll, p.yaw, -p.pitch, 'YXZ');
    this.spine.rotation.set(0, p.twist, -p.lean, 'YXZ');
    const b = p.breath;
    this.chest.scale.set(1 + 0.016 * b, 1 + 0.004 * b, 1 + 0.008 * b);
    this.neck.rotation.set(0, p.head.yaw * 0.35, -p.head.pitch * 0.4, 'YXZ');
    this.head.rotation.set(0, p.head.yaw * 0.65, -p.head.pitch * 0.6, 'YXZ');
    for (const side of [0, 1] as const) {
      const a = p.arms[side];
      const arm = this.arms[side]!;
      arm.shoulder.position.y = SHOULDER.y + 0.003 * b;
      arm.shoulder.rotation.set(side ? -a.out : a.out, 0, a.swing, 'XZY');
      arm.elbow.rotation.z = a.elbow;
      arm.hand.rotation.z = side ? 0 : 0.12;
    }
    for (const side of [0, 1] as const) this.leg(p, side);

    // the lantern: at the right hand's grip, hanging straight down, swinging a little
    const arm = this.arms[1]!;
    for (const g of [this.pelvis, this.spine, arm.shoulder, arm.elbow, arm.hand]) g.updateMatrix();
    this.m.copy(this.pelvis.matrix).multiply(this.spine.matrix).multiply(arm.shoulder.matrix).multiply(arm.elbow.matrix).multiply(arm.hand.matrix);
    this.lantern.position.copy(this.grip).applyMatrix4(this.m);
    this.lantern.rotation.set(0, 0, p.lantern);
  }

  private leg(p: Pose, side: Side): void {
    const j = hipJoint(p, side);
    const f = p.feet[side];
    const pole = kneePole(side);
    const ik = legIK(j, f, pole);
    const L = this.legs[side]!;
    this.bone(L.thigh, j, ik.knee, pole);
    this.bone(L.shin, ik.knee, ik.ankle, pole);
    L.foot.position.set(ik.ankle.x, ik.ankle.y, ik.ankle.z);
    L.foot.rotation.set(0, side ? -0.07 : 0.07, f.pitch, 'YZX');
  }

  dispose(): void {
    for (const x of this.kept) x.dispose();
    this.kept = [];
  }
}
