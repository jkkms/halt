// The pieces the tutorial (tutorialView.ts) and the level screen's tours (tourView.ts) share: the narration text
// with its **bold** and `code` markup and its paragraphs and lines (SPEC_v0.7 §B), the amber focus rings (SPEC_v0.6
// §C, one per piece in v0.7) and the measuring that gives the still narration one height for all its texts.
import { richBlocks, richParts, type RichPart } from '../core/tutorial.ts';
import { h } from './dom.ts';
import type { Box } from './tutLayout.ts';

const partNode = (part: RichPart): string | HTMLElement => (part.kind === 'bold' ? h('strong', {}, part.s) : part.kind === 'code' ? h('code', {}, part.s) : part.s);

/** One line of narration as inline DOM: **bold** → <strong>, `code` → <code> (status lines, short notes). */
export function richNodes(text: string): (string | HTMLElement)[] {
  return richParts(text).map(partNode);
}

/**
 * A narration as blocks (SPEC_v0.7 §B): a <p class="np"> per paragraph (`\n\n`), in it a <span class="nl"> per line
 * (`\n`); a line that starts a numbered or listed item (①, ★, "- ") is `nl li`, with a hanging indent.
 */
export function narrationNodes(text: string): HTMLElement[] {
  return richBlocks(text).map((para) => h('p', { class: 'np' }, ...para.map((line) => h('span', { class: line.list ? 'nl li' : 'nl' }, ...line.parts.map(partNode)))));
}

/**
 * Text sizes to try, largest first, until the longest text fits (CSS classes on the box; none is under 16 px on a
 * wide screen or 15 px on a phone).
 */
export const FONT_STEPS = ['', 'fs1'];

/**
 * The tallest of these texts in a measuring copy of the box (hidden, same classes) at this width: `text` is the
 * element inside `box` that takes each text in turn.
 */
export function tallestText(box: HTMLElement, text: HTMLElement, width: number, texts: string[]): number {
  box.style.width = `${width}px`;
  let max = 0;
  for (const s of texts) {
    text.replaceChildren(...narrationNodes(s));
    max = Math.max(max, box.offsetHeight);
  }
  return Math.ceil(max);
}

/** A ring: what it points at, the piece it goes around (px of the layer) and the ring itself; null: not on screen. */
export interface RingSpec {
  target: string;
  piece?: Box | null;
  box: Box | null;
}

const px = (n: number) => n.toFixed(0);

/** One ring per piece in a layer (`.tut-ring`, amber, pulsing); a null box hides its ring. */
export class RingLayer {
  readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** Place the rings (boxes in px of the layer); the DOM is only touched where a ring moved. */
  paint(rings: RingSpec[]): void {
    const layer = this.el;
    while (layer.children.length < rings.length) layer.append(h('div', { class: 'tut-ring' }));
    [...layer.children].forEach((el, i) => {
      const ring = el as HTMLElement;
      const r = rings[i];
      if (!r || !r.box) {
        ring.hidden = true;
        return;
      }
      const g = r.box;
      ring.hidden = false;
      if (ring.dataset.target !== r.target) ring.dataset.target = r.target;
      // for the browser checks: the piece this ring goes around
      const p = r.piece ? `${px(r.piece.x)},${px(r.piece.y)},${px(r.piece.w)},${px(r.piece.h)}` : '';
      if (ring.dataset.piece !== p) ring.dataset.piece = p;
      const css = `${px(g.x)}px,${px(g.y)}px,${px(g.w)}px,${px(g.h)}px`;
      if (ring.dataset.box !== css) {
        ring.dataset.box = css;
        ring.style.transform = `translate(${px(g.x)}px, ${px(g.y)}px)`;
        ring.style.width = `${px(g.w)}px`;
        ring.style.height = `${px(g.h)}px`;
      }
    });
  }
}
