// The stage's label layout pass (SPEC_v0.6 §B), as pure geometry so `npm test` checks it. The 3-D stage projects
// its labels every frame, measures them, and asks this where each one goes.
//
// Labels are placed in a fixed priority (the loop-check bubble first, then step marks, stair badges, the door sign,
// the railing / zone / ∞ / "the walk goes on" signs, the ruler). A label that overlaps one placed before it, a box
// it must keep out of, or the walker (stair badges excepted) moves up or down by the smallest offset, at most its
// own height, that clears them all; if none does, it hides. A label that has moved or hidden needs a few pixels to
// spare before it moves back, so nothing flickers while the walker passes.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LabelIn {
  /** Where it is drawn with no offset. */
  rect: Rect;
  /** Lower goes first. */
  priority: number;
  /** Stair badges may sit on the walker (the walker stands on its stair). */
  overWalker?: boolean;
  /** Among the same priority, lower goes first (badges: distance from the walker's stair). */
  order?: number;
  /** Last frame: its offset and whether it was hidden. */
  dy: number;
  hidden: boolean;
}

export interface LabelOut {
  dy: number;
  hidden: boolean;
  /** Where it is drawn (null when hidden). */
  rect: Rect | null;
}

/** The spare room a label needs to move back to a place it left (px). */
export const SPARE = 3;

const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

/** Do two rectangles overlap by more than half a pixel both ways? */
export function hits(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
}

/**
 * Place the labels. `fixed` are placed before all (the boxes over the stage and the loop-check bubble), `walker` is
 * the walker on screen. Returns one result per label, in the order given.
 */
export function layoutLabels(labels: LabelIn[], fixed: Rect[], walker: Rect | null): LabelOut[] {
  const out: LabelOut[] = labels.map(() => ({ dy: 0, hidden: true, rect: null }));
  const order = labels.map((l, i) => [l, i] as const).sort(([a], [b]) => a.priority - b.priority || (a.order ?? 0) - (b.order ?? 0));
  const placed: Rect[] = [...fixed];
  for (const [l, i] of order) {
    const r0 = l.rect;
    const blockers = l.overWalker || !walker ? placed : [...placed, walker];
    const clear = (dy: number) => {
      const r = grow({ ...r0, y: r0.y + dy }, !l.hidden && dy === l.dy ? 0 : SPARE);
      return !blockers.some((b) => hits(r, b));
    };
    const cands = new Set<number>([0, l.dy]);
    for (const b of blockers) {
      if (!hits(grow(r0, SPARE), b)) continue;
      cands.add(Math.round(b.y - SPARE - 1 - (r0.y + r0.h)));
      cands.add(Math.round(b.y + b.h + SPARE + 1 - r0.y));
    }
    const ok = [...cands].filter((dy) => Math.abs(dy) <= r0.h + 0.5 && clear(dy)).sort((a, b) => Math.abs(a) - Math.abs(b));
    // home when it is clear (with the spare room); else keep where it is when that still works and is not much
    // further than the best; else the smallest move
    const best = ok[0];
    const dy = best === 0 || l.hidden || !ok.includes(l.dy) || Math.abs(l.dy) > Math.abs(best ?? 0) + 6 ? best : l.dy;
    if (dy === undefined) continue;
    const rect = { ...r0, y: r0.y + dy };
    out[i] = { dy, hidden: false, rect };
    placed.push(rect);
  }
  return out;
}
