// Where the tutorial's pieces go on a wide screen (SPEC_v0.6 §A as changed by the author: a still text box, no
// speech bubble). Pure geometry in px of the stage box, no DOM, so `npm test` checks it.
//
// The text box has one fixed slot at the upper left, under the step counter, the same on every page of the tutorial
// and of the intros (its height is that of the longest page text, measured once per layout). The page's card goes
// under it when there is room, else just above the controls. The scene is framed in what is left: right of the
// box, under the code card (top right) and above the controls and the shot buttons.

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

export const SLOT = {
  margin: 12, // from the stage's edges
  top: 52, // the box's top: under the step counter (top left of the stage, about 28 px tall)
  gap: 12, // between the box, the card and the controls
  scene: 28, // kept free between the box and the scene (the ruler's words stick out to the left)
  minW: 380,
  maxW: 440,
  cardW: 500, // the card when it sits above the controls
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

/** The text box's width on a stage this wide. */
export function boxWidth(stageW: number): number {
  return Math.round(Math.max(SLOT.minW, Math.min(SLOT.maxW, stageW * 0.3)));
}

/** The tallest the text box may be: room left above the controls for the shot buttons. */
export function maxBoxHeight(stageH: number, pill: Box): number {
  return Math.max(120, pill.y - SLOT.gap - 40 - SLOT.top);
}

/** The text box: the same rect for every page at a given stage size (it depends on nothing else). */
export function textBox(stage: { w: number; h: number }, height: number): Box {
  return { x: SLOT.margin, y: SLOT.top, w: boxWidth(stage.w), h: height };
}

export interface DeskInput {
  stage: { w: number; h: number };
  /** The text box (from textBox). */
  box: Box;
  /** The code card (top right); null when none. */
  code: Box | null;
  /** The controls pill (bottom centre). */
  pill: Box;
  /** The page's card: its height at the box's width and at its width above the controls (cardWidth); null: none. */
  card: { h: number; hWide: number } | null;
  /** The shot buttons (bottom left, beside the controls) and the caption (bottom right), when shown. */
  shots: Box | null;
  caption: Box | null;
}

/** The card's width when it sits above the controls (right of the text box on a narrow stage). */
export function cardWidth(stage: { w: number }, box: Box): number {
  return Math.min(SLOT.cardW, stage.w - SLOT.margin - (box.x + box.w + SLOT.gap));
}

export interface DeskLayout {
  /** Where the page's card goes. */
  card: Box | null;
  /** True: under the text box; false: above the controls. */
  cardInColumn: boolean;
  /** The scene is framed inside the stage minus these. */
  inset: Insets;
}

export function deskLayout(inp: DeskInput): DeskLayout {
  const { stage, box, code, pill, shots, caption } = inp;
  const { margin, gap } = SLOT;
  // the bottom band: the controls, the shot buttons and the caption beside them
  const band = [pill, shots, caption].filter((b): b is Box => !!b);
  const bandTop = Math.min(...band.map((b) => b.y));
  // the column under the text box ends at whatever of the band is below it (the shot buttons; the controls on a
  // narrow stage), else at the stage's bottom margin
  const colBottom = Math.min(stage.h - margin + gap, ...band.filter((b) => b.x < box.x + box.w + gap && b.x + b.w > box.x - gap).map((b) => b.y));
  let card: Box | null = null;
  let inColumn = true;
  if (inp.card) {
    const y = box.y + box.h + gap;
    if (y + inp.card.h <= colBottom - gap) card = { x: box.x, y, w: box.w, h: inp.card.h };
    else {
      // above the controls: centred, but right of the text box when the stage is narrow
      inColumn = false;
      const left = box.x + box.w + gap;
      const w = cardWidth(stage, box);
      const x = Math.max(left, Math.min((stage.w - w) / 2, stage.w - margin - w));
      card = { x, y: pill.y - gap - inp.card.hWide, w, h: inp.card.hWide };
    }
  }
  const bottomEdge = card && !inColumn ? card.y : bandTop;
  const inset: Insets = {
    top: code ? code.y + code.h + gap : margin,
    right: margin,
    bottom: Math.max(margin, stage.h - bottomEdge + gap),
    left: box.x + box.w + SLOT.scene,
  };
  return { card, cardInColumn: inColumn, inset };
}

/** Phones: the text box and the cards are under the stage; the scene keeps clear of the top row and the bottom. */
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
