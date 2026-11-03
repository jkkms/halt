// The pieces the tutorial (tutorialView.ts) and the level screen's tours (tourView.ts) share: the narration text
// with its **bold** and `code` markup, the amber focus rings (SPEC_v0.6 §C) and the measuring that gives the still
// text box one height for all its texts (SPEC_v0.6 §A, SPEC_guide §A).
import { richParts } from '../core/tutorial.ts';
import { h } from './dom.ts';
import type { Box } from './tutLayout.ts';

/** A narration text as DOM: **bold** → <strong>, `code` → <code>. */
export function richNodes(text: string): (string | HTMLElement)[] {
  return richParts(text).map((part) => (part.kind === 'bold' ? h('strong', {}, part.s) : part.kind === 'code' ? h('code', {}, part.s) : part.s));
}

/** Text sizes to try, largest first, until the longest text fits the box (CSS classes on the box). */
export const FONT_STEPS = ['', 'fs1', 'fs2', 'fs3'];

/**
 * The tallest of these texts in a measuring copy of the box (hidden, same classes) at this width: `text` is the
 * element inside `box` that takes each text in turn.
 */
export function tallestText(box: HTMLElement, text: HTMLElement, width: number, texts: string[]): number {
  box.style.width = `${width}px`;
  let max = 0;
  for (const s of texts) {
    text.replaceChildren(...richNodes(s));
    max = Math.max(max, box.offsetHeight);
  }
  return Math.ceil(max);
}

/** One ring per target in a layer (`.tut-ring`, amber, pulsing); a null box hides its ring. */
export class RingLayer {
  readonly el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  /** Place the rings (boxes in px of the layer); the DOM is only touched where a ring moved. */
  paint(rings: { target: string; box: Box | null }[]): void {
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
      ring.dataset.target = r.target;
      const css = `${g.x.toFixed(0)}px,${g.y.toFixed(0)}px,${g.w.toFixed(0)}px,${g.h.toFixed(0)}px`;
      if (ring.dataset.box !== css) {
        ring.dataset.box = css;
        ring.style.transform = `translate(${g.x.toFixed(0)}px, ${g.y.toFixed(0)}px)`;
        ring.style.width = `${g.w.toFixed(0)}px`;
        ring.style.height = `${g.h.toFixed(0)}px`;
      }
    });
  }
}
