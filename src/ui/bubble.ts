// The tutorial's speech bubble (SPEC_v0.5 §B): where it goes beside the walker (never over the code card or the
// controls; off the stage's own labels, body and tail, when there is room), which edge its tail leaves from, and its
// outline (rounded box + tail) as one SVG path. Pure geometry in stage-box pixels, no DOM, so `npm test` checks it.
// The tutorial view calls it every frame with the walker's head from the stage.

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which side of the walker the bubble is on. */
export type Side = 'left' | 'right';
export type Edge = 'top' | 'right' | 'bottom' | 'left';

/** Where the walker is on screen: the centre of its head and the point between its feet. */
export interface WalkerSpot {
  head: Pt;
  feet: Pt;
}

/**
 * What a box over the stage is, for how much covering it costs: `text` are the stage's words (the callouts, the
 * exit sign, the caption, the railing), `number` the step badges and the ruler, `ui` the step counter and the shot
 * buttons.
 */
export type SoftKind = 'text' | 'number' | 'ui';

/** Something on the stage the bubble would rather leave visible. */
export interface SoftBox extends Box {
  kind?: SoftKind;
}

export interface PlaceInput {
  stage: { w: number; h: number };
  /** null: the stage cannot say (not ready, the flat drawing, the walker off screen). */
  walker: WalkerSpot | null;
  /** The bubble's own size. */
  size: { w: number; h: number };
  /** Never cover these: the code card, the controls, the interactive card. */
  avoid: Box[];
  /** Rather not cover these when there is room: the stage's labels, the step counter, the caption, the shot buttons. */
  soft?: SoftBox[];
  /** The side it is on now; it changes only when the other side is clearly better. */
  side?: Side;
  /** The spot it is in now (from the last placement); it moves to another only when that one is clearly better. */
  slot?: string;
  /** The size of the stage's loop-check bubble over the head, when known (its widest so far); else a short one. */
  check?: { w: number; h: number };
}

export interface Placement {
  box: Box;
  side: Side;
  /** The tail's tip in stage pixels: beside the head, or down-right of the fixed spot. */
  tip: Pt;
  /** The walker's position is unknown: the fixed spot at the upper left. */
  fallback: boolean;
  /** Which of the spots around the walker it is (pass it back as `slot` next frame). */
  slot: string;
}

export interface Tail {
  edge: Edge;
  /** Where the tail leaves the edge, from its left end (top, bottom) or its top end (left, right). */
  at: number;
  /** The tip, relative to the bubble's top-left corner. */
  tip: Pt;
}

export const BUBBLE = {
  margin: 10, // from the stage's edges
  gap: 8, // kept clear around the boxes to avoid
  tail: 34, // from the tip to the bubble's edge
  inset: 30, // the tail leaves this far from the corner nearest the walker
  slant: 8, // the tail's base sits this much further along the edge than the tip
  half: 9, // half the width of the tail's base
  radius: 16,
};

/** Covering one pixel of a soft box costs this much ("pixels of moving", see score). */
export const SOFT_WEIGHT: Record<SoftKind, number> = { text: 0.35, number: 0.3, ui: 0.2 };

/** How much further from the head a spot may be, to leave a label visible (a longer tail), and the cost per pixel. */
const REACH = [36, 72, 120, 180];
const REACH_COST = 1.2;
/** Each 8 px of tail across a soft box costs like covering this many of its pixels. */
const TAIL_HIT = 160;

/** Half the width kept clear over the walker's head for the stage's loop-check bubble. */
const CHECK_HALF = 58;

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Area of the overlap of two boxes. */
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const grow = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/** Keep a box of this size inside the stage (top-left wins when the stage is too small). */
function inside(x: number, y: number, size: { w: number; h: number }, stage: { w: number; h: number }): Box {
  const m = BUBBLE.margin;
  return { x: clamp(x, m, Math.max(m, stage.w - m - size.w)), y: clamp(y, m, Math.max(m, stage.h - m - size.h)), w: size.w, h: size.h };
}

interface Cand {
  box: Box;
  ideal: Box;
  side: Side;
  tip: Pt;
  rank: number;
  /** Extra cost of a spot further away than the first choice. */
  cost: number;
  slot: string;
}

/** Something near the walker the bubble should leave visible, and how much covering it costs per pixel. */
interface Keep {
  box: Box;
  weight: number;
}

/** Penalties in "pixels of moving": anything to avoid outweighs the rest; the walker comes next, then the labels. */
function score(c: Cand, inp: PlaceInput, keep: Keep[], crossed: SoftBox[]): number {
  let s = c.rank * 15 + c.cost;
  if (inp.side && c.side !== inp.side) s += 120;
  if (inp.slot && c.slot !== inp.slot) s += 60;
  s += Math.hypot(c.box.x - c.ideal.x, c.box.y - c.ideal.y) * 3;
  for (const a of inp.avoid) s += overlap(grow(c.box, BUBBLE.gap), a) * 100;
  for (const k of keep) s += overlap(c.box, k.box) * k.weight;
  const soft = inp.soft ?? [];
  for (const o of soft) s += overlap(c.box, o) * SOFT_WEIGHT[o.kind ?? 'ui'];
  // the tail hides what it crosses too, and a word cut by it is hard to read: walk along it in 8 px steps
  const t = crossed.length ? tailFor(c.box, c.tip, c.side) : null;
  if (t) {
    const base = tailBase(c.box, t);
    const n = Math.ceil(Math.hypot(c.tip.x - base.x, c.tip.y - base.y) / 8);
    for (let i = 1; i <= n; i++) {
      const x = base.x + ((c.tip.x - base.x) * i) / n;
      const y = base.y + ((c.tip.y - base.y) * i) / n;
      for (const o of crossed) if (x > o.x - 3 && x < o.x + o.w + 3 && y > o.y - 3 && y < o.y + o.h + 3) s += TAIL_HIT * SOFT_WEIGHT[o.kind ?? 'ui'];
    }
  }
  return s;
}

/** Where the tail leaves the bubble, in stage pixels. */
function tailBase(box: Box, t: Tail): Pt {
  switch (t.edge) {
    case 'top':
      return { x: box.x + t.at, y: box.y };
    case 'bottom':
      return { x: box.x + t.at, y: box.y + box.h };
    case 'left':
      return { x: box.x, y: box.y + t.at };
    case 'right':
      return { x: box.x + box.w, y: box.y + t.at };
  }
}

/** Where the bubble goes this frame. */
export function placeBubble(inp: PlaceInput): Placement {
  const { stage, size, walker } = inp;
  const { tail, inset, slant } = BUBBLE;
  if (!walker) return fixedSpot(inp);
  const { head, feet } = walker;
  // The tip sits beside the face, a little away from the head's centre.
  const tall = Math.max(24, feet.y - head.y);
  const out = clamp(tall * 0.1, 6, 12);
  // The stage's own bubble with the loop check sits over the head (src/ui/stage3d.ts, 1.25 walker heights up).
  const cw = Math.max(2 * CHECK_HALF, inp.check?.w ?? 0);
  const ch = Math.max(40, inp.check?.h ?? 0);
  const check = { x: head.x - cw / 2, y: head.y - tall * 0.34 + 4 - ch, w: cw, h: ch };
  const body = (side: number, top: number): Box => ({ x: Math.min(head.x, feet.x) - tall * side, y: head.y - tall * top, w: Math.abs(head.x - feet.x) + 2 * tall * side, h: feet.y - head.y + tall * top });
  const keep: Keep[] = [
    // the walker himself, head to feet; a little room around him (his arms, the lantern) matters less
    { box: body(0.16, 0.12), weight: 4 },
    { box: body(0.3, 0.16), weight: 0.6 },
    { box: check, weight: 1 },
  ];
  const cands: Cand[] = [];
  const pref: Side = inp.side ?? 'right';
  const other: Side = pref === 'right' ? 'left' : 'right';
  const add = (side: Side, kind: 'beside' | 'low' | 'high', rank: number) => {
    const s = side === 'right' ? 1 : -1;
    const tip = { x: head.x + s * out, y: head.y + (kind === 'high' ? -tall * 0.08 : tall * 0.04) };
    let x: number;
    let y: number;
    if (kind === 'high') {
      // above the check bubble, the tail coming down to the head
      x = side === 'right' ? tip.x + slant - inset : tip.x - slant + inset - size.w;
      y = check.y - BUBBLE.gap - size.h;
    } else {
      // beside the head, clear of the check bubble over it
      const dx = Math.max(out + tail, CHECK_HALF + 4);
      x = side === 'right' ? head.x + dx : head.x - dx - size.w;
      // beside: mostly above the head's height; low: mostly below it
      y = kind === 'beside' ? tip.y - slant - size.h + inset : tip.y - inset;
    }
    const at = (dx: number, dy: number, cost: number, v: string) => {
      const ideal = { x: x + dx, y: y + dy, w: size.w, h: size.h };
      cands.push({ box: inside(ideal.x, ideal.y, size, stage), ideal, side, tip, rank, cost, slot: `${side}:${kind}:${v}` });
    };
    at(0, 0, 0, '');
    // further away (a longer tail), when that leaves a label visible: sideways, or up (down for `low`)
    for (const d of REACH) {
      at(s * d, 0, d * REACH_COST, `x${d}`);
      at(0, kind === 'low' ? d : -d, d * REACH_COST, `y${d}`);
    }
    // above: also centred over the head, the tail coming straight down
    if (kind === 'high') {
      const cx = head.x - size.w / 2 - x;
      at(cx, 0, 10, 'c');
      for (const d of REACH) at(cx, -d, 10 + d * REACH_COST, `c${d}`);
    }
  };
  add(pref, 'beside', 0);
  add(other, 'beside', 1);
  add(pref, 'high', 2);
  add(other, 'high', 3);
  add(pref, 'low', 4);
  add(other, 'low', 5);
  // Something to avoid in the way (the walker behind the card, say): also try just above, below or beside it.
  let fresh = cands;
  for (let round = 0; round < 2; round++) {
    fresh = fresh.flatMap((c) => pushed(c, inp));
    cands.push(...fresh);
  }
  // the tail would rather not cut through the loop check either (it comes and goes, so it costs less than a label)
  const crossed: SoftBox[] = [...(inp.soft ?? []), { ...check, kind: 'ui' }];
  let best = cands[0]!;
  let bestScore = Infinity;
  for (const c of cands) {
    const sc = score(c, inp, keep, crossed);
    if (sc < bestScore) [best, bestScore] = [c, sc];
  }
  return { box: best.box, side: best.side, tip: best.tip, fallback: false, slot: best.slot };
}

/** The candidate moved out of each box to avoid that it covers: above, below, left or right of it. */
function pushed(c: Cand, inp: PlaceInput): Cand[] {
  const { gap } = BUBBLE;
  const { w, h } = c.box;
  const out: Cand[] = [];
  inp.avoid.forEach((a, i) => {
    if (!overlap(grow(c.box, gap), a)) return;
    (
      [
        [c.box.x, a.y - gap - h],
        [c.box.x, a.y + a.h + gap],
        [a.x - gap - w, c.box.y],
        [a.x + a.w + gap, c.box.y],
      ] as const
    ).forEach(([x, y], k) => out.push({ ...c, box: inside(x, y, c.box, inp.stage), rank: c.rank + 1, slot: `${c.slot}/${i}${'tblr'[k]}` }));
  });
  return out;
}

/** No walker on screen: the upper left of the stage, the tail pointing down-right (below anything in the way). */
function fixedSpot(inp: PlaceInput): Placement {
  const { size, stage } = inp;
  const m = BUBBLE.margin;
  const ys = [m, ...[...inp.avoid, ...(inp.soft ?? [])].map((o) => o.y + o.h + BUBBLE.gap)];
  const cands: Cand[] = ys.map((y, rank) => {
    const box = inside(m, y, size, stage);
    return { box, ideal: box, side: 'left', tip: { x: box.x + box.w - BUBBLE.inset + BUBBLE.slant + 14, y: box.y + box.h + 22 }, rank, cost: 0, slot: 'fixed' };
  });
  let best = cands[0]!;
  let bestScore = Infinity;
  for (const c of cands) {
    const sc = score({ ...c, rank: 0 }, { ...inp, slot: undefined }, [], inp.soft ?? []) + c.box.y * 0.5;
    if (sc < bestScore) [best, bestScore] = [c, sc];
  }
  return { box: best.box, side: 'left', tip: best.tip, fallback: true, slot: 'fixed' };
}

/** The tail from a bubble at `box` to `tip` (stage pixels); null when the tip is inside the box. */
export function tailFor(box: Box, tip: Pt, side: Side): Tail | null {
  const { half, radius, slant } = BUBBLE;
  const below = tip.y - (box.y + box.h);
  const above = box.y - tip.y;
  const left = box.x - tip.x;
  const right = tip.x - (box.x + box.w);
  const out = Math.max(below, above, left, right);
  if (out < 4) return null;
  const edge: Edge = out === below ? 'bottom' : out === above ? 'top' : out === left ? 'left' : 'right';
  const lo = radius + half;
  const flat = edge === 'top' || edge === 'bottom';
  const len = flat ? box.w : box.h;
  // the base sits a little away from the walker, so the tail leans toward it
  const along = flat ? tip.x - box.x + (side === 'right' ? slant : -slant) : tip.y - box.y - slant;
  return { edge, at: clamp(along, lo, Math.max(lo, len - lo)), tip: { x: tip.x - box.x, y: tip.y - box.y } };
}

const f = (n: number) => String(Math.round(n * 10) / 10);

/** The outline of a w × h bubble with rounded corners and the tail, clockwise from the top-left corner. */
export function bubblePath(w: number, h: number, tail: Tail | null, r = BUBBLE.radius): string {
  const hb = BUBBLE.half;
  const tip = tail ? `L${f(tail.tip.x)} ${f(tail.tip.y)}` : '';
  const on = (e: Edge) => tail?.edge === e;
  const a = tail?.at ?? 0;
  const arc = (x: number, y: number) => `A${r} ${r} 0 0 1 ${f(x)} ${f(y)}`;
  return [
    `M${r} 0`,
    on('top') ? `L${f(a - hb)} 0 ${tip} L${f(a + hb)} 0` : '',
    `L${f(w - r)} 0`,
    arc(w, r),
    on('right') ? `L${f(w)} ${f(a - hb)} ${tip} L${f(w)} ${f(a + hb)}` : '',
    `L${f(w)} ${f(h - r)}`,
    arc(w - r, h),
    on('bottom') ? `L${f(a + hb)} ${f(h)} ${tip} L${f(a - hb)} ${f(h)}` : '',
    `L${r} ${f(h)}`,
    arc(0, h - r),
    on('left') ? `L0 ${f(a + hb)} ${tip} L0 ${f(a - hb)}` : '',
    `L0 ${r}`,
    arc(r, 0),
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}
