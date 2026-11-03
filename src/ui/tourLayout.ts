// Where the level screen's guide box goes (SPEC_guide §A, SPEC_v0.7 §A as changed by the author). Pure geometry,
// no DOM, so `npm test` checks it.
//
// Wide screens: a wide band along the bottom of the stage column (its full width less a margin), the tour's title
// and controls in a row at its top, the text under them in a column of a comfortable reading width. Its top edge,
// left and width stay put for the whole tour; its height follows the step's text; the scene is framed above the
// tallest step's band. Narrow screens (the stacked layout, ≤ 900 px): a sheet near the bottom of the viewport with
// its top edge fixed in the same way; the page scrolls each target into the room above it.
import { BAND } from './tutLayout.ts';
import type { Box, Insets } from './tutLayout.ts';

export const TOUR = {
  margin: 16, // from the stage's sides and bottom (wide)
  padX: 18, // inside the band
  gap: 10, // kept between the box and the scene / a ring
  sheet: 8, // the phone sheet's margin from the viewport's edges
};

/** The text column in the wide band: the band's inner width, at most a comfortable reading width. */
export function deskTextWidth(bandW: number): number {
  return Math.round(Math.max(0, Math.min(BAND.textMax, bandW - 2 * TOUR.padX)));
}

/**
 * The wide band at its tallest (the step that needs most), in px of the stage box: the full width less the margins,
 * at the bottom. A shorter step keeps the top edge, left and width and is less tall.
 */
export function deskBox(stage: { w: number; h: number }, tallest: number): Box {
  const m = TOUR.margin;
  return { x: m, y: Math.round(stage.h - m - tallest), w: Math.max(0, Math.round(stage.w - 2 * m)), h: Math.round(tallest) };
}

/** The tallest the wide band should be (a smaller font is tried first). */
export function deskMaxHeight(stageH: number): number {
  return Math.max(160, Math.round(stageH * 0.5) - TOUR.margin);
}

/** The tallest the phone sheet should be. */
export function sheetMaxHeight(viewH: number): number {
  return Math.max(150, Math.round(viewH * 0.45));
}

/** Phones: the sheet at its tallest, at the bottom of the viewport, full width less the margins (its top stays). */
export function phoneSheet(view: { w: number; h: number }, tallest: number): Box {
  const m = TOUR.sheet;
  return { x: m, y: view.h - m - tallest, w: view.w - 2 * m, h: tallest };
}

/** The scene keeps clear of the box: framed above a box in the lower half of the stage, below one in the upper half. */
export function sceneInset(stage: { w: number; h: number }, box: Box): Insets {
  const lower = box.y + box.h / 2 > stage.h / 2;
  return lower
    ? { top: 0, right: 0, bottom: Math.max(0, Math.round(stage.h - box.y + TOUR.gap)), left: 0 }
    : { top: Math.max(0, Math.round(box.y + box.h + TOUR.gap)), right: 0, bottom: 0, left: 0 };
}

/** The part of the stage the box leaves free (for the rings of targets on the stage). */
export function stageFree(stage: Box, box: Box): Box {
  const lower = box.y + box.h / 2 > stage.y + stage.h / 2;
  if (lower) return { x: stage.x, y: stage.y, w: stage.w, h: Math.max(0, box.y - TOUR.gap / 2 - stage.y) };
  const top = box.y + box.h + TOUR.gap / 2;
  return { x: stage.x, y: top, w: stage.w, h: Math.max(0, stage.y + stage.h - top) };
}

/** b clipped to a; null when nothing of it is left. */
export function clip(b: Box, a: Box): Box | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** The smallest box around all of these; null for none. */
export function union(boxes: (Box | null)[]): Box | null {
  const bs = boxes.filter((b): b is Box => !!b);
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x));
  const y0 = Math.min(...bs.map((b) => b.y));
  const x1 = Math.max(...bs.map((b) => b.x + b.w));
  const y1 = Math.max(...bs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * How far to scroll (down is positive) so the target sits inside the area with `pad` to spare: 0 when it already
 * does; a target taller than the area shows its top.
 */
export function revealDelta(target: Box, inArea: Box, pad = 10): number {
  const top = inArea.y + pad;
  const bottom = inArea.y + inArea.h - pad;
  let d = 0;
  if (target.y < top || target.h > bottom - top) d = target.y - top;
  else if (target.y + target.h > bottom) d = target.y + target.h - bottom;
  return Math.abs(d) < 1 ? 0 : Math.round(d);
}
