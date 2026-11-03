// Where the tutorial's pieces go (SPEC_v0.7 §A): pure geometry in px of the stage box, no DOM, so `npm test` checks
// it.
//
// Wide screens: the narration is a wide band along the bottom of the stage: the full width less a margin, its top
// edge fixed for a tutorial or intro (room for the page that needs most), its height that of the page shown. The
// controls sit in a row at its top, then the text in a column of a comfortable reading width at the left and the
// page's interactive piece beside it at the right (under the text when there is no room beside it). The scene is
// framed above the tallest band, centred, clear of the step counter (top left), the shot buttons and caption (top
// centre) and the code card (top right): the stage is offered every centred frame that fits between them and takes
// the one where the scene comes out largest (src/ui/frame.ts).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const BAND = {
  margin: 16, // from the stage's sides and bottom
  padX: 22, // inside the band, left and right (its 2 px border and 20 px padding)
  textMax: 800, // the text column's widest: a comfortable line
  textMin: 400, // a narrower column leaves no room beside it: the piece goes under the text
  pieceMin: 330,
  pieceMax: 440,
  pieceFrac: 0.34, // of the band's inner width
  gap: 28, // between the text and the piece
  frameGap: 12, // kept between the scene and the band, the cards and the stage's edges
  minFrame: { w: 200, h: 140 },
};

/** Area of the overlap of two boxes. */
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Does b lie inside a? */
export function within(a: Box, b: Box): boolean {
  return b.x >= a.x - 0.01 && b.y >= a.y - 0.01 && b.x + b.w <= a.x + a.w + 0.01 && b.y + b.h <= a.y + a.h + 0.01;
}

/** The band at its tallest: the full stage width less the margins, at the bottom (a shorter page keeps its top edge). */
export function bandBox(stage: { w: number; h: number }, height: number): Box {
  const m = BAND.margin;
  return { x: m, y: Math.round(stage.h - m - height), w: Math.max(0, stage.w - 2 * m), h: Math.round(height) };
}

/** The band's columns, in px from the band's left: the text, and the piece's slot beside it (null: no room). */
export interface BandCols {
  text: { x: number; w: number };
  piece: { x: number; w: number } | null;
}

export function bandColumns(bandW: number): BandCols {
  const inner = Math.max(0, bandW - 2 * BAND.padX);
  const piece = Math.round(Math.max(BAND.pieceMin, Math.min(BAND.pieceMax, inner * BAND.pieceFrac)));
  const beside = Math.min(BAND.textMax, inner - piece - BAND.gap);
  if (beside >= BAND.textMin) return { text: { x: BAND.padX, w: Math.round(beside) }, piece: { x: Math.round(bandW - BAND.padX - piece), w: piece } };
  return { text: { x: BAND.padX, w: Math.round(Math.min(BAND.textMax, inner)) }, piece: null };
}

/** The width the piece is laid out at: its slot beside the text, or (no slot) under the text at most this wide. */
export function pieceWidth(cols: BandCols, bandW: number): number {
  return cols.piece ? cols.piece.w : Math.min(BAND.pieceMax, bandW);
}

/** The shot buttons and the caption: a strip along the top edge of the stage, centred between the side cards. */
export function topStrip(stage: { w: number }, side: number): { x: number; w: number } {
  const x = Math.min(stage.w / 2 - 60, side);
  return { x: Math.round(x), w: Math.round(Math.max(120, stage.w - 2 * x)) };
}

const pad = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });

/**
 * Every frame for the scene that is centred in the stage, above `bottom` (the band's top), inside the stage's edges
 * and clear of the obstacles (the step counter, the code card, the shot strip), each kept
 * `gap` away: the widest one for every choice of top and bottom edge. Returned as insets, none inside another.
 */
export function sceneFrames(stage: { w: number; h: number }, bottom: number, obstacles: Box[], gap = BAND.frameGap): Insets[] {
  const cx = stage.w / 2;
  const obs = obstacles.filter((o) => o.w > 0 && o.h > 0).map((o) => pad(o, gap));
  const tops = [gap, ...obs.map((o) => o.y + o.h)].filter((y) => y >= gap - 0.01);
  const bottoms = [bottom - gap, ...obs.map((o) => o.y)].filter((y) => y <= bottom - gap + 0.01);
  const rects: Box[] = [];
  for (const t of tops)
    for (const b of bottoms) {
      if (b - t < BAND.minFrame.h) continue;
      let half = cx - gap;
      for (const o of obs) {
        if (o.y >= b || o.y + o.h <= t) continue;
        if (o.x <= cx && o.x + o.w >= cx) half = -1;
        else if (o.x + o.w < cx) half = Math.min(half, cx - (o.x + o.w));
        else half = Math.min(half, o.x - cx);
      }
      if (2 * half < BAND.minFrame.w) continue;
      rects.push({ x: cx - half, y: t, w: 2 * half, h: b - t });
    }
  const kept = rects.filter((r, i) => !rects.some((q, j) => j !== i && within(q, r) && (!within(r, q) || j < i)));
  return kept.map((r) => ({ top: Math.round(r.y), right: Math.round(stage.w - r.x - r.w), bottom: Math.round(stage.h - r.y - r.h), left: Math.round(r.x) }));
}

/** Phones: the narration and the cards are under the stage; the scene keeps clear of the top row and the bottom. */
export function phoneInset(stage: { w: number; h: number }, top: (Box | null)[], bottom: (Box | null)[]): Insets {
  const m = 8;
  const t = Math.max(m, ...top.filter((b): b is Box => !!b).map((b) => b.y + b.h + 6));
  const b = Math.max(m, ...bottom.filter((x): x is Box => !!x).map((x) => stage.h - x.y + 6));
  return { top: t, right: m, bottom: b, left: m };
}

/** The ring around a focus target: a little outside it, so it never covers the target's own text. */
export function ringBox(target: Box, pad = 6): Box {
  return { x: target.x - pad, y: target.y - pad, w: target.w + 2 * pad, h: target.h + 2 * pad };
}

/** b clipped to a; null when nothing of it is left. */
export function clip(b: Box, a: Box): Box | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Lit code lines as ring pieces: consecutive lines are one piece (a body of two lines is one block), lines apart
 * are pieces of their own.
 */
export function linePieces(lines: Box[]): Box[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y);
  const out: Box[] = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && l.y <= last.y + last.h + 2) {
      const x0 = Math.min(last.x, l.x);
      const x1 = Math.max(last.x + last.w, l.x + l.w);
      out[out.length - 1] = { x: x0, y: last.y, w: x1 - x0, h: Math.max(last.y + last.h, l.y + l.h) - last.y };
    } else out.push({ ...l });
  }
  return out;
}
