// Where the level screen's guide box goes (SPEC_guide §A). Pure geometry, no DOM, so `npm test` checks it.
//
// Wide screens: the box sits over the stage's lower left and stays there for the whole tour; the scene is framed
// above it. If that spot would cover something the tour points at on the stage, the next spot is tried (lower right,
// then upper left), once per tour. Narrow screens (the stacked layout, ≤ 900 px): a sheet fixed at the bottom of the
// viewport; the page scrolls each target into the room above it.
import type { Box, Insets } from './tutLayout.ts';

export const TOUR = {
  margin: 12, // from the stage's edges (wide)
  top: 52, // the upper spot's top: under the step counter at the stage's top left
  gap: 10, // kept between the box and the scene / a ring
  minW: 300,
  maxW: 460,
  frac: 0.5, // of the stage's width
  sheet: 8, // the phone sheet's margin from the viewport's edges
};

/** The wide box's width: half the stage, 300–460 px, never wider than the stage allows. */
export function deskWidth(stageW: number): number {
  const w = Math.max(TOUR.minW, Math.min(TOUR.maxW, stageW * TOUR.frac));
  return Math.round(Math.max(0, Math.min(stageW - 2 * TOUR.margin, w)));
}

/** The tallest the wide box may be (a smaller font is tried first, then the text scrolls). */
export function deskMaxHeight(stageH: number): number {
  return Math.max(160, Math.round(stageH * 0.5) - TOUR.margin);
}

/** The tallest the phone sheet may be. */
export function sheetMaxHeight(viewH: number): number {
  return Math.max(150, Math.round(viewH * 0.42));
}

/** Spots for the wide box, in px of the stage box, in order of preference: lower left, lower right, upper left. */
export function deskSpots(stage: { w: number; h: number }, size: { w: number; h: number }): Box[] {
  const { margin } = TOUR;
  const low = Math.max(margin, stage.h - margin - size.h);
  return [
    { x: margin, y: low, w: size.w, h: size.h },
    { x: Math.max(margin, stage.w - margin - size.w), y: low, w: size.w, h: size.h },
    { x: margin, y: Math.min(TOUR.top, low), w: size.w, h: size.h },
  ];
}

const area = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** The first spot that covers none of the boxes to avoid (padded by the gap); else the one that covers least. */
export function pickSpot(spots: Box[], avoid: Box[]): Box {
  const pad = (b: Box): Box => ({ x: b.x - TOUR.gap, y: b.y - TOUR.gap, w: b.w + 2 * TOUR.gap, h: b.h + 2 * TOUR.gap });
  const cost = (s: Box) => avoid.reduce((sum, b) => sum + area(s, pad(b)), 0);
  return spots.find((s) => cost(s) === 0) ?? [...spots].sort((a, b) => cost(a) - cost(b))[0]!;
}

/** Phones: the sheet at the bottom of the viewport, full width less the margins. */
export function phoneSheet(view: { w: number; h: number }, height: number): Box {
  const m = TOUR.sheet;
  return { x: m, y: view.h - m - height, w: view.w - 2 * m, h: height };
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
