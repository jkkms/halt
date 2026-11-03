// The level screen's guide (SPEC_guide, SPEC_v0.7): short tours over the real screen. Each step puts amber rings
// around real parts of the level screen (scrolled into view first; one ring per part) and its text in a band like
// the tutorial's: a wide band along the bottom of the stage column on a wide screen (the scene is framed above it
// and the stage caption hides), a sheet near the bottom of the viewport on the stacked layout. The band's top edge,
// left and width stay put for the whole tour; its height follows the step's text; the tour's title and controls sit
// in a row at its top. The page stays usable under it. Each tour shows once (the store's `guidesSeen`); "?" replays
// them.
import type { Level } from '../core/levels.ts';
import { dueTours, replayTours, tourFits, tourFor, withSeen, type GuideState, type GuideTarget, type Tour, type TourId } from '../core/tours.ts';
import type { App } from './app.ts';
import { h } from './dom.ts';
import { FONT_STEPS, narrationNodes, RingLayer, tallestText, type RingSpec } from './guide.ts';
import { lang, t } from './i18n.ts';
import type { Insets, Rect } from './stageTypes.ts';
import { clip, deskBox, deskMaxHeight, deskTextWidth, phoneSheet, revealDelta, sceneInset, sheetMaxHeight, stageFree, union } from './tourLayout.ts';
import { ringBox, type Box } from './tutLayout.ts';

/** The stacked level screen (stage on top, the panel under it, the page scrolls): matches the CSS. */
const STACKED = '(max-width: 900px)';

export interface GuideHost {
  /** The level screen's element (the guide's layer lives in it). */
  root: HTMLElement;
  level: Level;
  /** Which step-2 form is open and whether a check of the steps left failed. */
  state(): Pick<GuideState, 'form' | 'failed'>;
}

/** Targets made of separate parts, each with a ring of its own. */
const PIECEWISE: GuideTarget[] = ['topbar', 'chips'];

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const rectOf = (el: Element): Box | null => {
  if ((el as HTMLElement).hidden || el.closest('[hidden]')) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
};

const typing = (el: EventTarget | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);

export class LevelGuide {
  /** The layer over the page: the rings and the box. */
  el = h('div', { class: 'guide', hidden: true });
  private app: App;
  private host: GuideHost;
  private ringsEl = h('div', { class: 'guide-rings', 'aria-hidden': 'true' });
  private rings = new RingLayer(this.ringsEl);
  private head = h('p', { class: 'guide-head' });
  private text = h('div', { class: 'tut-narr-text guide-text', 'aria-live': 'polite' });
  private nav = h('nav', { class: 'guide-nav' });
  private box = h('section', { class: 'guide-box', 'data-role': 'guide', role: 'region' }, h('div', { class: 'guide-top' }, this.head, this.nav), this.text);
  /** A hidden copy of the box, to measure the tour's texts. */
  private mText = h('div', { class: 'tut-narr-text guide-text' });
  private mNav = h('nav', { class: 'guide-nav' });
  private measure = h('div', { class: 'guide-box guide-measure', 'aria-hidden': 'true' }, h('div', { class: 'guide-top' }, h('p', { class: 'guide-head' }, '·'), this.mNav), this.mText);
  private tour: Tour | null = null;
  private step = 0;
  /** Tours asked for by "show this screen's guide again", in order. */
  private queue: TourId[] = [];
  private raf = 0;
  // layout, once per tour and viewport
  private layoutKey = '';
  private stacked = false;
  private boxRect: Box | null = null;
  private inset: Insets | undefined;
  private keepOut: Rect[] | undefined;
  private applied = '';
  private revealToken = 0;
  private onKey = (e: KeyboardEvent) => {
    if (!this.tour || !this.host.root.isConnected || e.altKey || e.ctrlKey || e.metaKey) return;
    if (typing(e.target) || document.querySelector('.modal-overlay')) return;
    if (e.key === 'ArrowRight' && this.step < this.tour.steps.length - 1) {
      e.preventDefault();
      this.go(this.step + 1);
    } else if (e.key === 'ArrowLeft' && this.step > 0) {
      e.preventDefault();
      this.go(this.step - 1);
    }
  };
  private onResize = () => this.kick();

  constructor(app: App, host: GuideHost) {
    this.app = app;
    this.host = host;
    this.el.append(this.ringsEl, this.box, this.measure);
    // the box is measured with the real font once it is in
    void document.fonts?.ready.then(() => {
      this.layoutKey = '';
      this.kick();
    });
  }

  /** The level screen is on screen (again): a due tour may start. */
  shown(): void {
    window.addEventListener('resize', this.onResize);
    this.layoutKey = '';
    this.kick();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
  }

  relang(): void {
    this.layoutKey = '';
    if (this.tour) this.render(false);
    this.kick();
  }

  /** Something changed on the level screen (a verdict, a result): check what is due. */
  kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  /** "Show this screen's guide again": the level screen, then the open form's tour, then the result. */
  replay(): void {
    this.queue = replayTours(this.host.state());
    if (this.tour) this.close(false);
    this.kick();
  }

  /** What the stage keeps clear of while a tour is open (the level screen passes it on every show). */
  stageOpts(): { inset?: Insets; keepOut?: Rect[] } {
    return this.inset ? { inset: this.inset, keepOut: this.keepOut } : {};
  }

  isOpen(): boolean {
    return !!this.tour;
  }

  // ------------------------------------------------------------ the loop

  private gstate(): GuideState {
    return { seen: this.app.saved.guidesSeen ?? [], ...this.host.state() };
  }

  /** Nothing else is open: no dialog (the tutorial suggestion, the judge's note), the screen laid out. */
  private free(): boolean {
    const root = this.host.root;
    if (!root.isConnected || document.querySelector('.modal-overlay')) return false;
    const stage = root.querySelector<HTMLElement>('.stage-wrap');
    return !!stage && stage.clientWidth > 0 && stage.clientHeight > 0;
  }

  private frame = (): void => {
    this.raf = 0;
    if (!this.host.root.isConnected) return; // paused until the screen is shown again
    if (this.tour && !tourFits(this.tour.id, this.host.state())) this.close(this.step === this.tour.steps.length - 1);
    if (!this.tour) {
      while (this.queue.length && !tourFits(this.queue[0]!, this.host.state())) this.queue.shift();
      const next = this.queue[0] ?? dueTours(this.gstate())[0];
      if (next && this.free()) {
        if (this.queue[0] === next) this.queue.shift();
        this.open(next);
      } else if (next) {
        this.raf = requestAnimationFrame(this.frame);
        this.release();
        return;
      }
    }
    if (!this.tour) {
      this.release();
      return;
    }
    this.layout();
    this.paintRings();
    this.raf = requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------ open, step, close

  private open(id: TourId): void {
    this.tour = tourFor(id, this.host.level);
    this.step = 0;
    this.layoutKey = '';
    this.el.hidden = false;
    this.box.dataset.tour = id;
    document.addEventListener('keydown', this.onKey);
    this.render(true);
  }

  private go(i: number): void {
    if (!this.tour || i < 0 || i >= this.tour.steps.length) return;
    this.step = i;
    this.render(true);
  }

  private finish(): void {
    if (this.tour) this.close(true);
    this.kick();
  }

  /** End the tour; `seen`: remember it (shown to the end, or skipped). */
  private close(seen: boolean): void {
    const tour = this.tour;
    if (!tour) return;
    if (seen) {
      this.app.saved.guidesSeen = withSeen(this.app.saved.guidesSeen, tour.id);
      this.app.persist();
    }
    this.tour = null;
    this.el.hidden = true;
    delete this.box.dataset.tour;
    this.rings.paint([]);
    document.removeEventListener('keydown', this.onKey);
    this.revealToken++;
  }

  /** No tour open: give the stage back its whole area and the caption. */
  private release(): void {
    const root = this.host.root;
    root.classList.remove('guide-open', 'guide-desk', 'guide-sheet');
    this.boxRect = null;
    this.layoutKey = '';
    if (this.inset || this.keepOut) {
      this.inset = undefined;
      this.keepOut = undefined;
    }
    if (this.applied) {
      this.applied = '';
      if (root.isConnected) this.app.stage.setInset(undefined, undefined);
    }
  }

  private render(reveal: boolean): void {
    const tour = this.tour;
    if (!tour) return;
    const L = lang();
    const n = tour.steps.length;
    const last = this.step === n - 1;
    this.head.textContent = tour.title[L];
    this.box.setAttribute('aria-label', tour.title[L]);
    this.box.dataset.step = String(this.step + 1);
    this.text.replaceChildren(...narrationNodes(tour.steps[this.step]!.text[L]));
    this.text.classList.remove('fade');
    void this.text.offsetWidth;
    this.text.classList.add('fade');
    this.text.scrollTop = 0;
    const prev = h('button', { type: 'button', class: 'btn small ghost g-prev', 'data-role': 'guide-prev', disabled: this.step === 0, onclick: () => this.go(this.step - 1) }, `← ${t('prevPage')}`);
    const count = h('span', { class: 'g-count', 'data-role': 'guide-count' }, t('pageOf', { i: this.step + 1, n }));
    const next = last
      ? h('button', { type: 'button', class: 'btn small primary g-next', 'data-role': 'guide-done', onclick: () => this.finish() }, t('guideGotIt'))
      : h('button', { type: 'button', class: 'btn small primary g-next', 'data-role': 'guide-next', onclick: () => this.go(this.step + 1) }, `${t('nextPage')} →`);
    const skip = last ? null : h('button', { type: 'button', class: 'skip g-skip', 'data-role': 'guide-skip', onclick: () => this.finish() }, t('skip'));
    this.nav.replaceChildren(...(skip ? [skip] : []), prev, count, next);
    if (reveal) this.revealSoon();
  }

  // ------------------------------------------------------------ layout

  private stageEl(): HTMLElement | null {
    return this.host.root.querySelector<HTMLElement>('.stage-wrap');
  }

  /**
   * Measure the tour's tallest step at this width (title, controls and text); the font steps down until it fits
   * `max`. The controls are measured wider than any step shows them (Skip, Back, the count, Next and Got it).
   */
  private fit(width: number, max: number): number {
    const L = lang();
    const tour = this.tour!;
    const texts = tour.steps.map((s) => s.text[L]);
    this.measure.querySelector('.guide-head')!.textContent = tour.title[L];
    const n = tour.steps.length;
    // wider than any step's controls (Next and Got it both in): the row decision below holds on every step
    this.mNav.replaceChildren(
      h('button', { type: 'button', class: 'skip g-skip', tabindex: '-1' }, t('skip')),
      h('button', { type: 'button', class: 'btn small ghost g-prev', tabindex: '-1' }, `← ${t('prevPage')}`),
      h('span', { class: 'g-count' }, t('pageOf', { i: n, n })),
      h('button', { type: 'button', class: 'btn small primary g-next', tabindex: '-1' }, `${t('nextPage')} →`),
      h('button', { type: 'button', class: 'btn small primary g-next', tabindex: '-1' }, t('guideGotIt')),
    );
    let height = 0;
    let font = '';
    for (const f of FONT_STEPS) {
      font = f;
      this.measure.className = `guide-box guide-measure ${f}`.trim();
      height = tallestText(this.measure, this.mText, width, texts);
      if (height <= max) break;
    }
    // the title and the controls share a row only when the widest controls fit beside the title on every step;
    // else the title has a row of its own on every step (the text never moves between steps)
    const top = this.measure.querySelector<HTMLElement>('.guide-top')!;
    const stack = top.offsetHeight > this.mNav.offsetHeight + 20;
    this.box.className = `guide-box ${font}${stack ? ' stack-top' : ''}`.trim();
    return height;
  }

  /**
   * Place the box once per tour, viewport size and language: its top edge, left and width do not move between steps
   * (its height follows the step's text); the scene keeps above the tallest step's box.
   */
  private layout(): void {
    const stage = this.stageEl();
    if (!stage || !this.tour) return;
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = innerHeight;
    const sr = stage.getBoundingClientRect();
    const stacked = matchMedia(STACKED).matches;
    const key = `${this.tour.id}:${stacked ? 's' : 'd'}:${vw}x${vh}:${Math.round(sr.width)}x${Math.round(sr.height)}:${lang()}`;
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.stacked = stacked;
    const root = this.host.root;
    const b = this.box.style;
    let inset: Insets | undefined;
    let keepOut: Rect[] | undefined;
    b.height = '';
    b.bottom = 'auto';
    if (stacked) {
      const width = vw - 2 * 8;
      this.box.style.setProperty('--text-w', `${width}px`);
      this.measure.style.setProperty('--text-w', `${width}px`);
      const tallest = this.fit(width, sheetMaxHeight(vh));
      const sheet = phoneSheet({ w: vw, h: vh }, tallest);
      b.left = `${sheet.x}px`;
      b.width = `${sheet.w}px`;
      b.top = `${sheet.y}px`;
      this.box.style.setProperty('--slot-h', `${sheet.h}px`);
      this.boxRect = sheet;
      root.style.setProperty('--guide-pad', `${Math.ceil(tallest + 16)}px`);
      root.classList.add('guide-open', 'guide-sheet');
      root.classList.remove('guide-desk');
    } else {
      const st = { w: sr.width, h: sr.height };
      const bandW = Math.max(0, st.w - 32);
      const textW = deskTextWidth(bandW);
      this.box.style.setProperty('--text-w', `${textW}px`);
      this.measure.style.setProperty('--text-w', `${textW}px`);
      const tallest = this.fit(bandW, deskMaxHeight(st.h));
      const spot = deskBox(st, tallest);
      b.left = `${sr.left + spot.x}px`;
      b.top = `${sr.top + spot.y}px`;
      b.width = `${spot.w}px`;
      // the slot is the tallest step's; a shorter step sits at its bottom (author, 11/3: "아래 맞춤")
      this.box.style.setProperty('--slot-h', `${spot.h}px`);
      this.boxRect = { x: sr.left + spot.x, y: sr.top + spot.y, w: spot.w, h: spot.h };
      inset = sceneInset(st, spot);
      keepOut = [{ x: spot.x - 4, y: spot.y - 4, w: spot.w + 8, h: spot.h + 8 }];
      root.style.removeProperty('--guide-pad');
      root.classList.add('guide-open', 'guide-desk');
      root.classList.remove('guide-sheet');
    }
    this.inset = inset;
    this.keepOut = keepOut;
    const applied = JSON.stringify([inset ?? null, keepOut ?? null]);
    if (applied !== this.applied) {
      this.applied = applied;
      this.app.stage.setInset(inset, keepOut);
    }
  }

  // ------------------------------------------------------------ targets and rings

  /** The elements of a target, looked up again every time (the cards are rebuilt on every change). */
  private elements(tg: GuideTarget): Element[] {
    const root = this.host.root;
    const q = (sel: string) => [...root.querySelectorAll(sel)];
    const endsForm = '.proof-card form.proof:not(.zone-form)';
    switch (tg) {
      case 'stage':
        return q('.stage-wrap');
      case 'head':
        return q('.code-card .level-head');
      case 'code':
        return q('.code-card pre.code');
      case 'inputs':
        return q('.code-card .code-meta').slice(0, 1);
      case 'facts':
        return q('.code-card .code-meta').slice(1, 2);
      case 'verdict':
        return q('.verdict-card');
      case 'topbar':
        return q('.bar .judge-badge, .bar .help-btn');
      case 'vInput':
        return q(`${endsForm} [data-focus="V"]`).map((el) => el.closest('label') ?? el);
      case 'chips':
        return q(`${endsForm} > .chips, ${endsForm} > p.help`);
      case 'checkRow':
        return q(`${endsForm} > .actions`);
      case 'graph':
        return q('.graph-card');
      case 'result':
        return q('.result-card');
      case 'startFields':
        return [...q(`${endsForm} > .field-name`).slice(0, 1), ...q(`${endsForm} > .mini-fields`)];
      case 'runBtn':
        return q(`${endsForm} [data-role="run"]`);
    }
  }

  /** Where a target may show, in viewport px: its scroll box less what covers it (the box, the sticky code card). */
  private area(el: Element): Box {
    const vw = document.documentElement.clientWidth || innerWidth;
    const view: Box = { x: 0, y: 0, w: vw, h: innerHeight };
    const root = this.host.root;
    if (el.closest('.bar')) return view;
    const box = this.boxRect;
    if (this.stacked) {
      const bar = root.querySelector('.bar')?.getBoundingClientRect();
      const top = bar ? Math.max(0, bar.bottom) : 0;
      const bottom = box ? box.y - 4 : view.h;
      return { x: 0, y: top, w: vw, h: Math.max(0, bottom - top) };
    }
    const stage = this.stageEl();
    if (stage && stage.contains(el)) {
      const s = rectOf(stage) ?? view;
      return box ? stageFree(s, box) : s;
    }
    const panel = root.querySelector<HTMLElement>('.panel');
    if (panel && panel.contains(el)) {
      const p = rectOf(panel) ?? view;
      let top = p.y;
      const code = root.querySelector<HTMLElement>('.code-card');
      if (code && !code.contains(el) && getComputedStyle(code).position === 'sticky') top = Math.max(top, code.getBoundingClientRect().bottom);
      return { x: p.x, y: top, w: p.w, h: Math.max(0, p.y + p.h - top) };
    }
    return view;
  }

  private paintRings(): void {
    const step = this.tour?.steps[this.step];
    if (!step) return this.rings.paint([]);
    this.rings.paint(
      step.targets.flatMap((tg): RingSpec[] => {
        const els = this.elements(tg);
        if (!els[0]) return [{ target: tg, box: null }];
        // the judge badge and "?", the buttons and the grey help under them: a ring each (SPEC_v0.7 §C)
        const parts = PIECEWISE.includes(tg) ? els.map((el) => [el]) : [els];
        return parts.map((group) => {
          const piece = union(group.map(rectOf));
          if (!piece) return { target: tg, box: null };
          // the stage fills its side of the screen: its ring goes just inside it
          const ring = ringBox(piece, tg === 'stage' ? -3 : tg === 'inputs' || tg === 'facts' ? 4 : PIECEWISE.includes(tg) ? 4 : 6);
          return { target: tg, piece, box: clip(ring, this.area(group[0]!)) };
        });
      }),
    );
  }

  /** Scroll the step's target into view (its panel on a wide screen, the page on the stacked layout). */
  private reveal(): void {
    const step = this.tour?.steps[this.step];
    if (!step) return;
    const tg = step.targets[0]!;
    const els = this.elements(tg);
    const r = union(els.map(rectOf));
    if (!r || !els[0]) return;
    const d = revealDelta(r, this.area(els[0]));
    if (!d) return;
    const behavior: ScrollBehavior = reduced() ? 'auto' : 'smooth';
    if (this.stacked) window.scrollBy({ top: d, behavior });
    else {
      const panel = this.host.root.querySelector<HTMLElement>('.panel');
      if (panel && panel.contains(els[0])) panel.scrollBy({ top: d, behavior });
    }
  }

  /** Once the box is placed, and again a moment later (a card that was just rebuilt, a scroll still running). */
  private revealSoon(): void {
    const token = ++this.revealToken;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (token === this.revealToken) this.reveal();
      }),
    );
    setTimeout(() => {
      if (token === this.revealToken && this.host.root.isConnected) this.reveal();
    }, 500);
  }
}
