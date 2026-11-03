// How the 3-D stage fits its scene into a frame (SPEC_v0.7 §A), as pure math so `npm test` checks it. The camera
// stands far enough back to see the scene's bounds in the frame; a long run that does not fit is followed instead.
// When the screen offers several frames (the tutorial: the full width under the code card, or a taller column
// between the step counter and the code card), the stage takes the one where the scene comes out largest.
import type { Insets } from './stageTypes.ts';

/** The camera's vertical field of view (degrees). */
export const FOV = 30;

/** The scene's extent in world units (x along the stairs, y up). */
export interface Bounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface FitOpts {
  /** A ring (a cycle): always the whole scene. */
  ring: boolean;
  /** Always the whole scene (no following camera; a bottomless shaft is still followed). */
  all: boolean;
}

const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);

/** The distance that shows all of the bounds at this aspect (before the cap and the follow rule). */
export function needDistance(b: Bounds, aspect: number): number {
  const tanH = tanV * aspect;
  return Math.max((b.y1 - b.y0) / 2 / tanV, (b.x1 - b.x0) / 2 / tanH, 8.5) * 1.12 + 1.6;
}

/** The camera's distance, and whether it follows the walker (a run too long to show whole). */
export function fitDistance(b: Bounds, aspect: number, o: FitOpts): { dist: number; follow: boolean } {
  const need = needDistance(b, aspect);
  const narrow = aspect < 1.1;
  const cap = narrow ? 17 : 21;
  if (need <= cap || o.ring || o.all) return { dist: Math.min(need, 28), follow: false };
  const tanH = tanV * aspect;
  const Wf = narrow ? 6.2 : 10;
  const Hf = Math.min(b.y1 - b.y0, narrow ? 6.5 : 5.5);
  return { dist: Math.max(Hf / 2 / tanV, Wf / 2 / tanH) * 1.05 + 1.4, follow: true };
}

/** How large the scene comes out in a frame this big: px per world unit. */
export function frameScale(w: number, h: number, b: Bounds, o: FitOpts): number {
  if (w < 1 || h < 1) return 0;
  const aspect = w / h;
  const fit = fitDistance(b, aspect, o);
  // a whole scene is fitted at the distance it needs (a capped distance would let it spill out of the frame)
  const dist = fit.follow ? fit.dist : needDistance(b, aspect);
  return h / (2 * dist * tanV);
}

/** The frame (insets of a stage this big) where the scene comes out largest; the first one on a tie. */
export function pickFrame(frames: Insets[], stage: { w: number; h: number }, b: Bounds, o: FitOpts): Insets | undefined {
  let best: Insets | undefined;
  let bestScale = -1;
  for (const f of frames) {
    const s = frameScale(stage.w - f.left - f.right, stage.h - f.top - f.bottom, b, o);
    if (s > bestScale + 1e-6) {
      best = f;
      bestScale = s;
    }
  }
  return best;
}
