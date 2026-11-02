// The walker's body, moment by moment: where the feet, the hips, the arms and the head are during each
// beat of a walk (standing, checking the loop condition, a step down, a step off a high ledge, a hop up,
// a stumble on a flat step, a fall through the floor, the walk to the door).
// Plain numbers only (no three.js), so `npm test` can check every pose against the stairs: a planted
// foot stays where it was put, and no shoe sinks into a stair.
//
// Frame: x forward (along the walk), y up, z to the walker's right. The walker is 1 tall; lengths are
// stage units. A beat's pose is given relative to the walker's origin, and the origin's offset from
// where the beat started (`Placed.x` along the walk, `Placed.y` up).

export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** An ankle joint; pitch > 0 lifts the toes. */
export interface FootPose extends Vec {
  pitch: number;
}

/** swing > 0: the arm forward; out: away from the body; elbow: bend (> 0 brings the hand forward). */
export interface ArmPose {
  swing: number;
  out: number;
  elbow: number;
}

export interface Pose {
  /** Centre between the hip joints. */
  hip: Vec;
  /** Pelvis: pitch > 0 tips forward, roll > 0 tips to the right, yaw > 0 brings the right hip forward. */
  pitch: number;
  roll: number;
  yaw: number;
  /** Chest relative to the pelvis: lean > 0 forward, twist like yaw. */
  lean: number;
  twist: number;
  /** Relative to the chest: pitch > 0 looks down, yaw > 0 looks left. */
  head: { pitch: number; yaw: number };
  /** Left, right. */
  feet: [FootPose, FootPose];
  /** Left, right (the right hand holds the lantern). */
  arms: [ArmPose, ArmPose];
  /** −1…1: the chest rising and falling. */
  breath: number;
  /** The lantern's swing on its handle, > 0 forward. */
  lantern: number;
}

export interface Placed {
  pose: Pose;
  x: number;
  y: number;
}

export type Side = 0 | 1;

/** Adult proportions for a walker 1 tall (head about 1/7.5 of the height). */
export const BODY = {
  ankle: 0.045, // ankle joint above the sole
  thigh: 0.235,
  shin: 0.24,
  hipW: 0.052, // hip joints either side of the pelvis centre
  footZ: 0.06, // feet either side of the centre line
  hipY: 0.5165, // pelvis height standing (knees almost straight)
  stance: 0.05, // standing: one foot this far ahead of the origin, the other this far behind
  ball: 0.088, // ankle to the ball of the foot (a heel lifts about it)
  toe: 0.125, // ankle to the tip of the shoe
  heel: 0.045, // ankle to the back of the heel
} as const;

export const LEG = BODY.thigh + BODY.shin;
const REACH = LEG - 0.0003;
const SOFT = 0.002;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Minimum-jerk ease (smooth start and stop). */
const mj = (t: number) => {
  const x = clamp01(t);
  return x * x * x * (10 + x * (6 * x - 15));
};
const span = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));
/** Start-stop travel: 0 → 1 with zero speed at both ends and the fastest in the middle. */
const travel = (u: number) => u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
/** A landing: quick give (peak at g = 0.3), slow recovery (0 at g = 1). */
const give = (g: number) => (g <= 0 || g >= 1 ? 0 : g < 0.3 ? Math.sin((Math.PI / 2) * (g / 0.3)) : 0.5 + 0.5 * Math.cos((Math.PI * (g - 0.3)) / 0.7));
const other = (s: Side): Side => (s ? 0 : 1);
const zOf = (side: Side) => (side ? BODY.footZ : -BODY.footZ);

/** A foot flat on the ground at x, with its sole at height y. */
function flat(x: number, y: number, side: Side): FootPose {
  return { x, y: y + BODY.ankle, z: zOf(side), pitch: 0 };
}

/** A planted foot with its heel lifted by angle a: it rolls over the ball, which stays before `edge`. */
function heelUp(x: number, y: number, side: Side, a: number, edge = Infinity): FootPose {
  if (a <= 1e-5) return flat(x, y, side);
  const bx = Math.min(x + BODY.ball, edge - 0.004);
  const rx = x - bx;
  const ry = BODY.ankle;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: bx + rx * c + ry * s, y: y - rx * s + ry * c, z: zOf(side), pitch: -a };
}

interface SwingOpts {
  /** The stair edge between the two treads (x), when the foot changes height. */
  edge?: number;
  lift: number;
  /** Toe pitch just before touching down (> 0 heel first, < 0 ball first). */
  land: number;
}

/** A foot in the air from `from` to a spot (x, sole height y). It clears the stair edge on the way. */
function swing(t: number, from: FootPose, toX: number, toY: number, side: Side, o: SwingOpts): FootPose {
  const y0 = from.y;
  const y1 = toY + BODY.ankle;
  const e = o.edge;
  const up = e !== undefined && from.x < e && y1 > y0 + 0.004;
  // up: the toe first rises, then goes forward over the riser
  const x = lerp(from.x, toX, up ? mj(span(t, 0.18, 1)) : mj(t));
  let k = mj(t);
  if (e !== undefined && from.x < e) {
    if (y1 < y0 - 0.004 && toX > e + BODY.heel + 0.04) {
      // down: go over the edge first (heel and all), then down
      k = sstep(e + BODY.heel + 0.01, toX, x);
    } else if (up) {
      const xe = e - BODY.toe - 0.03;
      k = Math.max(sstep(0, 0.42, t), xe > from.x + 0.05 ? sstep(from.x, xe, x) : 0);
    }
  }
  const pitch = from.pitch * (1 - sstep(0, up ? 0.22 : 0.4, t)) + o.land * Math.sin(Math.PI * span(t, 0.5, 1));
  return { x, y: lerp(y0, y1, k) + o.lift * Math.sin(Math.PI * t), z: zOf(side), pitch };
}

/** Standing feet: the `back` foot behind the origin, the other ahead of it. */
function stance(back: Side, x = 0, y = 0): [FootPose, FootPose] {
  const f: FootPose[] = [];
  f[back] = flat(x - BODY.stance, y, back);
  f[other(back)] = flat(x + BODY.stance, y, other(back));
  return f as [FootPose, FootPose];
}

/** Where the hip joint of one side is, from the pelvis position and turn (Euler order YXZ). */
export function hipJoint(p: Pose, side: Side): Vec {
  const h = side ? BODY.hipW : -BODY.hipW;
  const cr = Math.cos(p.roll);
  return { x: p.hip.x + h * cr * Math.sin(p.yaw), y: p.hip.y - h * Math.sin(p.roll), z: p.hip.z + h * cr * Math.cos(p.yaw) };
}

/**
 * Two-bone IK for a leg: the knee bends toward `pole`. When the ankle is out of reach the leg points at it
 * (`short` > 0 is how far it falls short).
 */
export function legIK(hip: Vec, ankle: Vec, pole: Vec): { knee: Vec; ankle: Vec; short: number } {
  const A = BODY.thigh;
  const B = BODY.shin;
  const dx = ankle.x - hip.x;
  const dy = ankle.y - hip.y;
  const dz = ankle.z - hip.z;
  const dist = Math.hypot(dx, dy, dz) || 1e-6;
  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;
  const r = clamp(dist, 0.14, A + B - 1e-4);
  const ca = (A * A + r * r - B * B) / (2 * A * r);
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const pd = pole.x * nx + pole.y * ny + pole.z * nz;
  let px = pole.x - pd * nx;
  let py = pole.y - pd * ny;
  let pz = pole.z - pd * nz;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-6) [px, py, pz] = [1, 0, 0];
  else [px, py, pz] = [px / pl, py / pl, pz / pl];
  return {
    knee: { x: hip.x + A * (ca * nx + sa * px), y: hip.y + A * (ca * ny + sa * py), z: hip.z + A * (ca * nz + sa * pz) },
    ankle: { x: hip.x + r * nx, y: hip.y + r * ny, z: hip.z + r * nz },
    short: dist - r,
  };
}

/** The knee direction of a leg: forward, a little outward. */
export const kneePole = (side: Side): Vec => ({ x: 1, y: 0.05, z: side ? 0.1 : -0.1 });

/**
 * Sets the pelvis height: `y` as designed, lowered where a supporting foot could not be reached.
 * w[side] = how much that foot carries weight (0 in the air, 1 planted). The limit is soft (no kinks).
 */
function settle(p: Pose, y: number, w: [number, number]): void {
  p.hip.y = y;
  for (const side of [0, 1] as const) {
    const j = hipJoint(p, side);
    const f = p.feet[side];
    const dx = j.x - f.x;
    const dz = j.z - f.z;
    const c = f.y - (j.y - p.hip.y) + Math.sqrt(Math.max(0, REACH * REACH - dx * dx - dz * dz));
    const d = p.hip.y - (c - SOFT / 2);
    if (d > 0) p.hip.y -= w[side] * (d < SOFT ? (d * d) / (2 * SOFT) : d - SOFT / 2);
  }
}

export interface Ctx {
  /** The foot that is behind (and moves first). */
  parity: Side;
  /** ms, for breathing and idle movement. */
  now: number;
  reduced: boolean;
}

const amp = (c: Ctx) => (c.reduced ? 0.35 : 1);

function base(c: Ctx): Pose {
  return {
    hip: { x: 0, y: BODY.hipY, z: 0 },
    pitch: 0.03,
    roll: 0,
    yaw: 0,
    lean: 0.03,
    twist: 0,
    head: { pitch: 0.08, yaw: 0 },
    feet: stance(c.parity),
    arms: [
      { swing: 0.04, out: 0.08, elbow: 0.2 },
      { swing: 0.3, out: 0.14, elbow: 1.18 },
    ],
    breath: c.reduced ? 0 : Math.sin((2 * Math.PI * c.now) / 3800),
    lantern: 0,
  };
}

/** Arms swing against the legs (left arm forward with the right foot); hips and shoulders turn with the stride. */
function counter(p: Pose, a: number): void {
  const d = clamp(p.feet[1].x - p.feet[0].x, -0.6, 0.6);
  p.arms[0].swing += 0.95 * d * a;
  p.arms[0].elbow += Math.max(0, d) * 0.45 * a;
  p.arms[1].swing -= 0.25 * d * a;
  p.yaw += 0.2 * d * a;
  p.twist -= 0.28 * d * a;
}

function place(p: Pose, x: number, y: number): Placed {
  p.hip.x -= x;
  p.hip.y -= y;
  for (const f of p.feet) {
    f.x -= x;
    f.y -= y;
  }
  return { pose: p, x, y };
}

const plant = (u: number, a: number, b: number) => Math.max(1 - sstep(a, a + 0.035, u), sstep(b - 0.035, b, u));

// ------------------------------------------------------------ standing

/**
 * Standing at a stair. `look` (0…1) lets the eyes wander and the weight shift (idle); `down` tilts the head
 * (> 0 down, < 0 up).
 */
export function stand(c: Ctx & { look?: number; down?: number }): Pose {
  const p = base(c);
  const look = c.reduced ? 0 : (c.look ?? 0);
  if (look) {
    p.head.yaw += look * 0.32 * Math.sin(c.now / 1300) * Math.sin(c.now / 2900);
    p.head.pitch += look * 0.06 * Math.sin(c.now / 1700);
    const shift = Math.sin(c.now / 2300);
    p.hip.z += look * 0.012 * shift;
    p.roll -= look * 0.03 * shift;
  }
  p.head.pitch += c.down ?? 0;
  counter(p, amp(c));
  settle(p, p.hip.y, [1, 1]);
  return p;
}

/**
 * Checking the loop condition: look down at the next stair, then a small nod (it holds) or a look toward
 * the door (it does not). `turning` steps in place (the ring turns the walker meanwhile).
 */
export function guard(u: number, c: Ctx & { holds: boolean; turning?: boolean }): Pose {
  const p = base(c);
  const r = c.reduced ? 0.5 : 1;
  const look = sstep(0, 0.3, u) * (1 - sstep(0.55, 0.95, u));
  p.head.pitch += 0.32 * look * r;
  p.lean += 0.06 * look * r;
  if (c.holds) {
    if (!c.reduced) p.head.pitch += 0.1 * Math.sin(Math.PI * span(u, 0.42, 0.62));
  } else {
    const t = sstep(0.4, 0.8, u);
    p.head.yaw += 0.55 * t * r;
    p.twist += 0.12 * t * r;
  }
  const w: [number, number] = [1, 1];
  if (c.turning) {
    for (const [side, a] of [
      [c.parity, 0.2],
      [other(c.parity), 0.5],
    ] as const) {
      const t = span(u, a, a + 0.28);
      p.feet[side].y += 0.03 * Math.sin(Math.PI * t);
      w[side] = 1 - Math.sin(Math.PI * t);
    }
  }
  counter(p, amp(c));
  settle(p, p.hip.y, w);
  return p;
}

// ------------------------------------------------------------ steps

export interface StepOpts extends Ctx {
  /** Height of the next stair relative to this one. */
  dy: number;
  /** Horizontal distance to the next stair. */
  len: number;
  /** Length of the beat in ms (falls take real time). */
  dur?: number;
}

/** The usual length of a step beat (ms). */
export const STEP_MS = 560;
/** Gravity in walker heights per s² (the stage runs about 2.5 times faster than life). */
const G = 41;
/** How long a free fall of height h takes (ms). */
export const fallMs = (h: number) => 1000 * Math.sqrt((2 * Math.max(0, h)) / G);
/** The length of a step beat down by `-dy` (ms): at least `base`, longer when a deep drop needs time to fall. */
export function stepMs(dy: number, base = STEP_MS): number {
  return -dy < 0.1 ? base : Math.max(base, Math.round(0.67 * base + fallMs(-dy + 0.02)));
}

/** A footfall: the foot swings during [a, b] of the beat and lands at x with its sole at height y. */
interface Move {
  a: number;
  b: number;
  x: number;
  y: number;
}

/**
 * One foot through a list of footfalls, from (x0, y0). Before each lift the heel rises (not from rest);
 * `w` gets how much the foot carries weight.
 */
function track(u: number, side: Side, x0: number, y0: number, moves: Move[], w: [number, number], edge?: number): FootPose {
  let x = x0;
  let y = y0;
  const pivot = (px: number) => (edge !== undefined && px < edge ? edge : Infinity);
  for (const m of moves) {
    const raise = m.a < 0.12 ? 0 : 0.4;
    if (u < m.a) return heelUp(x, y, side, raise * sstep(m.a - 0.12, m.a, u), pivot(x));
    if (u < m.b) {
      w[side] = plant(u, m.a, m.b);
      return swing(span(u, m.a, m.b), heelUp(x, y, side, raise, pivot(x)), m.x, m.y, side, { edge, lift: 0.04, land: 0.12 });
    }
    x = m.x;
    y = m.y;
  }
  return flat(x, y, side);
}

/** Walking on: pelvis, lean, arms and lantern for a walk over `len` that rises by `dy` around `rise`. */
function onward(p: Pose, u: number, o: StepOpts, w: [number, number], steps: number, rise: [number, number] = [0.3, 0.6]): Placed {
  p.hip.x = o.len * travel(u);
  const k = amp(o);
  p.lean += 0.04 * Math.sin(Math.PI * u);
  p.head.pitch += 0.05 * Math.sin(Math.PI * u);
  counter(p, k);
  p.lantern = k * (-0.14 * Math.sin(2 * Math.PI * u) + 0.05 * Math.sin(Math.PI * steps * u));
  settle(p, BODY.hipY + o.dy * sstep(rise[0], rise[1], u), w);
  return place(p, p.hip.x, o.dy * sstep(rise[0], rise[1], u));
}

/**
 * A walk on level ground over `len`: an odd number of footfalls (so the lead foot alternates from beat to
 * beat), steps of about 0.4.
 */
function stroll(u: number, o: StepOpts): Placed {
  const { len } = o;
  const s = BODY.stance;
  const N = 1 + 2 * Math.max(1, Math.round((len - 2 * s) / 0.8));
  const d = (len - 2 * s) / (N - 1);
  const target = (i: number) => (i >= N ? len + s : i === N - 1 ? len - s : s + d * i);
  const p = base(o);
  const w: [number, number] = [1, 1];
  for (const foot of [o.parity, other(o.parity)]) {
    const moves: Move[] = [];
    for (let i = foot === o.parity ? 1 : 2; i <= N; i += 2) moves.push({ a: i === 1 ? 0 : (i - 1) / N + 0.015, b: i === N ? 0.97 : i / N - 0.015, x: target(i), y: 0 });
    p.feet[foot] = track(u, foot, foot === o.parity ? -s : s, 0, moves, w);
  }
  return onward(p, u, o, w, N);
}

/** A low step up (a riser up to 0.12): four footfalls, the second one onto the higher tread. */
function stepUp(u: number, o: StepOpts): Placed {
  const { dy, len } = o;
  const s = BODY.stance;
  const edge = len / 2;
  const p = base(o);
  const w: [number, number] = [1, 1];
  const f1 = o.parity;
  const f2 = other(f1);
  p.feet[f1] = track(u, f1, -s, 0, [
    { a: 0, b: 0.24, x: edge - BODY.toe - 0.03, y: 0 },
    { a: 0.53, b: 0.76, x: len + s, y: dy },
  ], w, edge);
  p.feet[f2] = track(u, f2, s, 0, [
    { a: 0.27, b: 0.5, x: edge + BODY.heel + 0.06, y: dy },
    { a: 0.79, b: 0.97, x: len - s, y: dy },
  ], w, edge);
  return onward(p, u, o, w, 4, [0.5, 0.8]);
}

/**
 * One step to the next stair: three footfalls (the back foot to the front of the tread, the other foot
 * down onto the next tread, the first one beside it). Deep drops become a step off the edge with a short
 * fall and a soft landing.
 */
export function walk(u: number, o: StepOpts): Placed {
  const { dy, len } = o;
  if (Math.abs(dy) < 0.004) return stroll(u, o);
  if (dy > 0) return stepUp(u, o);
  const f1 = o.parity;
  const f2 = other(f1);
  const s = BODY.stance;
  const D = Math.max(0, -dy);
  const J = sstep(0.1, 0.32, D); // 0: walking down, 1: stepping off a ledge
  const edge = len / 2;
  const x1 = edge - 0.07; // the toes over the edge
  // stepping off: walk to the edge and step out (offJ), fall freely (fallU), land and recover
  const fallU = Math.min(0.55, fallMs(D + 0.02) / (o.dur ?? STEP_MS));
  const offJ = 0.627 * (1 - fallU);
  const landJ = offJ + fallU;
  const T1 = [0, lerp(0.3, 0.64 * offJ, J)] as const;
  const T2 = [lerp(0.33, 0.67 * offJ, J), lerp(0.62, landJ, J)] as const;
  const T3 = [lerp(0.66, offJ, J), lerp(0.97, Math.min(0.95, landJ + 0.1), J)] as const;
  const tLand = T2[1];
  const tOff = Math.min(T3[0], tLand - 0.06); // the body starts to drop
  const raise1 = 0.42 * (1 - 0.5 * J);
  const raise2 = 0.4;
  const land = dy < -0.03 ? -0.14 : 0.12;

  // the pelvis height as designed: walking down (the knees take the step), or a short fall and a landing
  const yWalk = BODY.hipY + dy * sstep(0.3, 0.66, u);
  const yOff = BODY.hipY - 0.05;
  const yTouch = dy + BODY.hipY - 0.03;
  const g = u > tLand ? span(u, tLand, 1) : 0;
  let yDrop: number;
  if (u < tOff) yDrop = BODY.hipY - 0.05 * sstep(0.28, tOff, u);
  else if (u < tLand) {
    const f = span(u, tOff, tLand);
    yDrop = yOff + (yTouch - yOff) * f * f;
  } else yDrop = dy + BODY.hipY - 0.03 * (1 - g) - Math.min(0.16, 0.04 + 0.1 * D) * give(g);
  const yDesign = lerp(yWalk, yDrop, J);

  let a: FootPose;
  if (u <= T1[1]) a = swing(span(u, T1[0], T1[1]), flat(-s, 0, f1), x1, 0, f1, { edge, lift: 0.04, land: 0.12 });
  else if (u < T3[0]) a = heelUp(x1, 0, f1, raise1 * sstep(T3[0] - 0.14, T3[0], u), edge);
  else if (u < T3[1]) {
    const t3 = span(u, T3[0], T3[1]);
    a = swing(lerp(t3, 1 - (1 - t3) ** 1.6, J), heelUp(x1, 0, f1, raise1, edge), len + s, dy, f1, { edge, lift: 0.04 + 0.03 * J, land });
    // past the edge, the trailing foot comes down with the body instead of folding up under it
    const past = sstep(edge + BODY.heel, edge + BODY.heel + 0.1, a.x);
    a.y = lerp(a.y, Math.max(dy + BODY.ankle, Math.min(a.y, yDesign - 0.32)), past);
  } else a = flat(len + s, dy, f1);
  let b: FootPose;
  if (u < T2[0]) b = heelUp(s, 0, f2, raise2 * sstep(T2[0] - 0.13, T2[0], u), edge);
  else if (u < T2[1]) {
    // stepping off, the foot is out over the edge before the body drops
    const t2 = span(u, T2[0], T2[1]);
    const t2drop = u < tOff ? 0.6 * span(u, T2[0], tOff) : 0.6 + 0.4 * span(u, tOff, T2[1]);
    b = swing(lerp(t2, t2drop, J), heelUp(s, 0, f2, raise2, edge), len - s, dy, f2, { edge, lift: 0.045 + 0.02 * J, land });
    // past the edge, the leading foot reaches down under the falling body
    const past = sstep(edge + BODY.heel, edge + BODY.heel + 0.1, b.x);
    b.y = lerp(b.y, Math.max(dy + BODY.ankle, Math.min(b.y, yDesign - 0.47)), past);
  } else b = flat(len - s, dy, f2);

  const p = base(o);
  p.feet[f1] = a;
  p.feet[f2] = b;
  // stepping off a ledge, the hips reach the edge by the time the trailing foot lets go
  const warp = u < tOff ? (0.47 * u) / tOff : 0.47 + (0.53 * (u - tOff)) / (1 - tOff);
  p.hip.x = len * travel(lerp(u, warp, J));

  const k = amp(o);
  const air = J * sstep(tOff - 0.04, tLand, u) * (1 - sstep(tLand, Math.min(1, tLand + 0.22), u));
  p.lean += 0.05 * Math.sin(Math.PI * u) + J * (0.08 * sstep(0.25, tOff, u) * (1 - sstep(tOff, tLand + 0.02, u)) + 0.2 * give(g));
  p.pitch += 0.03 * Math.sin(Math.PI * u) + 0.06 * J * give(g);
  p.head.pitch += (0.12 + 0.1 * J) * Math.sin(Math.PI * u);
  counter(p, k);
  p.arms[0].out += 0.5 * air * k;
  p.arms[0].swing += 0.3 * air * k;
  p.arms[1].out += 0.2 * air * k;
  p.lantern = k * (-0.16 * Math.sin(2 * Math.PI * u) + 0.25 * J * give(g));

  const w: [number, number] = [0, 0];
  w[f1] = u <= T1[1] ? plant(u, T1[0], T1[1]) : plant(u, T3[0], T3[1]);
  w[f2] = plant(u, T2[0], T2[1]);
  settle(p, yDesign, w);
  return place(p, p.hip.x, dy * sstep(0.3, Math.min(0.95, tLand + 0.05), u));
}

/** A step up to a higher stair: walk to the riser, crouch, hop up (rising first, then forward), land with bent knees. */
export function climb(u: number, o: StepOpts): Placed {
  const { dy: U, len } = o;
  const f1 = o.parity;
  const f2 = other(f1);
  const s = BODY.stance;
  const edge = len / 2;
  const xa = edge - BODY.toe - 0.05;
  const xb = xa - 0.09;
  const extra = clamp((U - 0.6) * 0.08, 0, 0.1);
  const T1 = [0, 0.26] as const;
  const T2 = [0.29, 0.44] as const;
  const tTO = 0.53;
  const tL = 0.78 + extra;
  const cr = 0.08 + 0.04 * Math.min(1, U);

  // the pelvis: walk up to the riser, crouch, fly (up first, then over), land
  const xTO = (xa + xb) / 2 - 0.02;
  const xL = len - 0.04;
  const Y0 = BODY.hipY;
  const YL = U + BODY.hipY - 0.04;
  const Ypeak = Math.max(YL + 0.08, U + BODY.ankle + 0.33);
  const f = span(u, tTO, tL);
  let px: number;
  let y: number;
  if (u < tTO) {
    px = xTO * travel(span(u, 0, 0.46));
    y = Y0 - cr * (sstep(0.42, 0.49, u) - sstep(0.49, tTO, u));
  } else if (u < tL) {
    px = lerp(xTO, xL, sstep(0.35, 1, f));
    y = f < 0.6 ? Y0 + (Ypeak - Y0) * Math.sin((Math.PI / 2) * (f / 0.6)) : Ypeak - (Ypeak - YL) * sstep(0.6, 1, f);
  } else {
    const g = span(u, tL, 1);
    px = lerp(xL, len, sstep(0, 1, g));
    y = U + BODY.hipY - 0.04 * (1 - g) - (0.07 + 0.04 * Math.min(1, U)) * give(g);
  }

  /** A foot in the air: under the body with the knees drawn up, never into the stairs. */
  const air = (side: Side, from: FootPose, toX: number): FootPose => {
    const dx0 = from.x - xTO;
    const dx1 = toX - xL;
    const fx = px + lerp(dx0, dx1, sstep(0.2, 0.9, f));
    let fy = y - (0.44 - 0.17 * Math.sin(Math.PI * f));
    const over = fx + BODY.toe > edge - 0.01;
    fy = Math.max(fy, (over ? U : 0) + BODY.ankle + 0.012);
    const into = sstep(0, 0.12, f);
    const out = sstep(0.82, 1, f);
    const land = { x: toX, y: U + BODY.ankle };
    return {
      x: lerp(lerp(from.x, fx, into), land.x, out),
      y: lerp(lerp(from.y, fy, into), Math.max(land.y, fy), out),
      z: zOf(side),
      pitch: lerp(from.pitch * (1 - sstep(0, 0.3, f)), 0, out) + 0.12 * Math.sin(Math.PI * f),
    };
  };

  let a: FootPose;
  if (u <= T1[1]) a = swing(span(u, T1[0], T1[1]), flat(-s, 0, f1), xa, 0, f1, { lift: 0.04, land: 0.12 });
  else if (u < tTO) a = heelUp(xa, 0, f1, 0.35 * sstep(tTO - 0.06, tTO, u), edge);
  else if (u < tL) a = air(f1, heelUp(xa, 0, f1, 0.35, edge), len + s);
  else a = flat(len + s, U, f1);
  let b: FootPose;
  if (u < T2[0]) b = heelUp(s, 0, f2, 0.35 * sstep(T2[0] - 0.1, T2[0], u));
  else if (u <= T2[1]) b = swing(span(u, T2[0], T2[1]), heelUp(s, 0, f2, 0.35), xb, 0, f2, { lift: 0.04, land: 0.1 });
  else if (u < tTO) b = heelUp(xb, 0, f2, 0.35 * sstep(tTO - 0.06, tTO, u), edge);
  else if (u < tL) b = air(f2, heelUp(xb, 0, f2, 0.35, edge), len - s);
  else b = flat(len - s, U, f2);

  const p = base(o);
  p.feet[f1] = a;
  p.feet[f2] = b;
  p.hip.x = px;

  const k = amp(o);
  const crouch = sstep(0.4, 0.49, u) * (1 - sstep(0.49, tTO + 0.04, u));
  const fly = sstep(0.49, tTO + 0.05, u) * (1 - sstep(tL - 0.05, tL + 0.12, u));
  const gv = u > tL ? give(span(u, tL, 1)) : 0;
  p.lean += 0.28 * crouch + 0.1 * fly + 0.18 * gv;
  p.pitch += 0.1 * crouch + 0.05 * gv;
  p.head.pitch += 0.15 * crouch - 0.12 * fly;
  counter(p, k);
  p.arms[0].swing += k * (-0.6 * crouch + 0.9 * fly);
  p.arms[1].swing += k * (-0.25 * crouch + 0.35 * fly);
  p.arms[0].out += 0.2 * fly * k;
  p.lantern = k * (0.25 * crouch - 0.3 * fly + 0.2 * gv);

  const ground = u < tTO ? 1 - sstep(tTO - 0.01, tTO, u) : sstep(tL - 0.03, tL, u);
  const w: [number, number] = [0, 0];
  w[f1] = u <= T1[1] ? plant(u, T1[0], T1[1]) : ground;
  w[f2] = u < tTO ? Math.min(plant(u, T2[0], T2[1]), ground) : ground;
  settle(p, y, w);
  return place(p, p.hip.x, U * sstep(tTO, tL, u));
}

/**
 * A flat step: the walk goes on to the next stair, but the step down the walker expects is not there.
 * The body pitches forward, the arms fly out, the front foot catches it; a look down, a shake of the head.
 */
export function stumble(u: number, o: StepOpts): Placed {
  const split = 0.5;
  if (u < split) return walk(u / split, { ...o, dy: 0 });
  const k = span(u, split, 1);
  const f1 = o.parity;
  const f2 = other(f1);
  const s = BODY.stance;
  const p = base(o);
  p.feet = stance(f2);
  const env = sstep(0, 0.08, k) * (1 - sstep(0.6, 0.9, k));
  let th: number;
  const w: [number, number] = [1, 1];
  if (o.reduced) th = 0.12 * sstep(0, 0.15, k) * (1 - sstep(0.7, 1, k));
  else {
    th = 0.3 * Math.sin(3 * Math.PI * k) * (1 - k);
    p.feet[f1] =
      k < 0.55
        ? swing(span(k, 0.03, 0.2), flat(s, 0, f1), s + 0.2, 0, f1, { lift: 0.05, land: 0.15 })
        : swing(span(k, 0.55, 0.8), flat(s + 0.2, 0, f1), s, 0, f1, { lift: 0.035, land: 0.05 });
    w[f1] = Math.min(plant(k, 0.03, 0.2), plant(k, 0.55, 0.8));
  }
  p.hip.x = Math.sin(th) * 0.45;
  p.pitch += th * 0.4;
  p.lean += th * 0.75;
  p.head.pitch += (o.reduced ? 0.25 : 0.4) * sstep(0.3, 0.45, k) * (1 - sstep(0.62, 0.75, k));
  if (!o.reduced) {
    const t = span(k, 0.72, 1);
    p.head.yaw += 0.28 * Math.sin(4 * Math.PI * t) * Math.sin(Math.PI * t);
  }
  counter(p, amp(o));
  const flail = o.reduced ? 0 : env;
  const wave = Math.sin(6 * Math.PI * k);
  p.arms[0].out += 0.85 * flail + (o.reduced ? 0.25 * env : 0);
  p.arms[0].swing += flail * (0.5 + 0.7 * wave);
  p.arms[1].out += 0.35 * flail;
  p.arms[1].swing -= flail * 0.3 * wave;
  p.lantern = 0.35 * Math.sin(3 * Math.PI * k) * (1 - k) * (o.reduced ? 0.3 : 1);
  settle(p, BODY.hipY, w);
  return { pose: p, x: o.len, y: 0 };
}

/** Arms up and legs loose while falling (`fl` 0…1), with a little flailing unless motion is reduced. */
function falling(p: Pose, fl: number, t: number, c: Ctx): void {
  const wig = c.reduced ? 0 : Math.sin(t * 0.021);
  p.arms[0].swing += fl * (2.3 + 0.25 * wig);
  p.arms[0].out += fl * 0.35;
  p.arms[0].elbow += fl * 0.3;
  p.arms[1].swing += fl * (1.0 - 0.2 * wig);
  p.arms[1].out += fl * 0.3;
  p.lean -= fl * 0.12;
  p.head.pitch -= fl * 0.25;
}

/** Legs hanging under a falling body; touching down at sole height `floor` (`land` 0…1). */
function dangle(p: Pose, fl: number, t: number, c: Ctx): void {
  const cyc = c.reduced ? 0 : Math.sin(t * 0.016);
  for (const side of [0, 1] as const) {
    const f = p.feet[side];
    const sg = side ? 1 : -1;
    const tx = p.hip.x + 0.06 * sg * cyc;
    const ty = p.hip.y - 0.42 + 0.04 * sg * cyc;
    f.x = lerp(f.x, tx, fl);
    f.y = lerp(f.y, ty, fl);
    f.pitch = lerp(f.pitch, -0.35, fl);
  }
}

/**
 * The step that falls through the floor: walk to the edge, step out onto nothing, fall (arms up) down to the
 * stair below ground and land with bent knees.
 */
export function fall(u: number, o: StepOpts): Placed {
  const { dy, len } = o;
  const f1 = o.parity;
  const f2 = other(f1);
  const s = BODY.stance;
  const edge = len / 2;
  const x1 = edge - 0.07;
  const T1 = [0, 0.17] as const;
  const T2 = [0.19, 0.34] as const;
  const tFall = 0.3;
  const tL = 0.86;
  const p = base(o);
  let a: FootPose;
  if (u <= T1[1]) a = swing(span(u, T1[0], T1[1]), flat(-s, 0, f1), x1, 0, f1, { edge, lift: 0.04, land: 0.1 });
  else a = heelUp(x1, 0, f1, 0.3 * sstep(tFall - 0.08, tFall, u), edge);
  let b: FootPose;
  if (u < T2[0]) b = heelUp(s, 0, f2, 0.35 * sstep(T2[0] - 0.1, T2[0], u));
  else b = swing(span(u, T2[0], T2[1]), heelUp(s, 0, f2, 0.35), 0.8 * len, -0.05, f2, { lift: 0.06, land: -0.2 });
  p.feet[f1] = a;
  p.feet[f2] = b;
  p.hip.x = len * sstep(0, 0.5, u);
  let y: number;
  const g = u > tL ? span(u, tL, 1) : 0;
  if (u < tL) {
    const f = span(u, tFall, tL);
    y = BODY.hipY + (dy - 0.03) * f * f;
  } else y = dy + BODY.hipY - 0.03 * (1 - g) - 0.17 * give(g);
  p.hip.y = y;
  const fl = sstep(tFall - 0.02, tFall + 0.1, u) * (1 - sstep(tL - 0.06, tL + 0.06, u));
  dangle(p, sstep(tFall, tFall + 0.12, u), o.now, o);
  // touching down on the stair below
  const down = sstep(tL - 0.1, tL, u);
  if (down > 0) {
    const end = stance(f2, len, dy);
    for (const side of [0, 1] as const) {
      const f = p.feet[side];
      const e = end[side];
      f.x = lerp(f.x, e.x, down);
      f.y = Math.max(lerp(f.y, e.y, down), e.y);
      f.pitch = lerp(f.pitch, 0, down);
    }
  }
  falling(p, fl, o.now, o);
  counter(p, amp(o) * (1 - fl));
  p.lean += 0.22 * give(g);
  p.pitch += 0.06 * give(g);
  p.head.pitch += 0.12 * Math.sin(Math.PI * span(u, 0, tFall));
  const w: [number, number] = [0, 0];
  w[f1] = Math.max(1 - sstep(tFall - 0.02, tFall + 0.04, u), down);
  w[f2] = Math.max(1 - sstep(T2[0], T2[0] + 0.035, u), down);
  settle(p, y, w);
  return place(p, p.hip.x, clamp(y - BODY.hipY, dy, 0));
}

/** Standing on the ground over a hole, then falling through it down to `dy` (< 0) and landing. */
export function fallIn(u: number, o: Ctx & { dy: number }): Placed {
  const tL = 0.8;
  const p = base(o);
  const g = u > tL ? span(u, tL, 1) : 0;
  let y: number;
  if (u < tL) {
    const f = span(u, 0, tL);
    y = BODY.hipY + (o.dy - 0.03) * f * f;
  } else y = o.dy + BODY.hipY - 0.03 * (1 - g) - 0.16 * give(g);
  p.hip.y = y;
  const drop = Math.min(0, y - BODY.hipY);
  for (const f of p.feet) f.y += drop;
  const fl = sstep(0, 0.12, u) * (1 - sstep(tL - 0.06, tL + 0.06, u));
  dangle(p, sstep(0.05, 0.2, u) * (1 - sstep(tL - 0.1, tL, u)), o.now, o);
  const floor = o.dy + BODY.ankle;
  for (const f of p.feet) f.y = Math.max(f.y, floor);
  falling(p, fl, o.now, o);
  counter(p, amp(o) * (1 - fl));
  p.lean += 0.22 * give(g);
  const down = sstep(tL - 0.06, tL, u);
  settle(p, y, [down, down]);
  return place(p, 0, clamp(y - BODY.hipY, o.dy, 0));
}

/** The loop is over: turn to the door (stepping on the spot) and walk `len` toward it. `turn` is 0…1. */
export function exit(u: number, o: Ctx & { len: number }): Placed & { turn: number } {
  const T = 0.2;
  if (u >= T) return { ...walk(span(u, T, 1), { ...o, dy: 0 }), turn: 1 };
  const k = span(u, 0, T);
  const p = base(o);
  const r = o.reduced ? 0.5 : 1;
  const w: [number, number] = [1, 1];
  for (const [side, a] of [
    [o.parity, 0],
    [other(o.parity), 0.45],
  ] as const) {
    const t = span(k, a, a + 0.5);
    p.feet[side].y += 0.03 * Math.sin(Math.PI * t);
    w[side] = 1 - Math.sin(Math.PI * t);
  }
  const back = 1 - sstep(0, 0.7, k);
  p.head.yaw += 0.55 * r * back;
  p.twist += 0.12 * r * back;
  counter(p, amp(o));
  settle(p, p.hip.y, w);
  return { pose: p, x: 0, y: 0, turn: sstep(0, 1, k) };
}
