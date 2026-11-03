// The level screen's guide (SPEC_guide): short tours over the real screen. Each step puts an amber ring around a
// real part of the level screen (scrolled into view first) and its text in the tutorial's still text box, which
// stays in one place for the whole tour: over the stage's lower left on a wide screen (the scene is framed above it
// and the stage caption hides), a sheet fixed at the bottom of the viewport on the stacked layout. The page stays
// usable under it. Each tour shows once (the store's `guidesSeen`); "?" replays them.
import type { Level } from '../core/levels.ts';
import { dueTours, replayTours, tourFits, tourFor, withSeen, type GuideState, type GuideTarget, type Tour, type TourId } from '../core/tours.ts';
import type { App } from './app.ts';
import { h } from './dom.ts';
import { FONT_STEPS, richNodes, RingLayer, tallestText } from './guide.ts';
import { lang, t } from './i18n.ts';
import type { Insets, Rect } from './stageTypes.ts';
import { clip, deskMaxHeight, deskSpots, deskWidth, phoneSheet, pickSpot, revealDelta, sceneInset, sheetMaxHeight, stageFree, union } from './tourLayout.ts';
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
  private text = h('p', { class: 'tut-narr-text guide-text', 'aria-live': 'polite' });
  private nav = h('nav', { class: 'guide-nav' });
  private box = h('section', { class: 'guide-box', 'data-role': 'guide', role: 'region' }, this.head, this.text, this.nav);
  /** A hidden copy of the box, to measure the tour's longest text. */
  private mText = h('p', { class: 'tut-narr-text guide-text' });
  private measure = h(
    'div',
    { class: 'guide-box guide-measure', 'aria-hidden': 'true' },
    h('p', { class: 'guide-head' }, '·'),
    this.mText,
    h('nav', { class: 'guide-nav' }, h('button', { type: 'button', class: 'btn small ghost g-prev', tabindex: '-1' }, '←'), h('span', { class: 'g-count' }, '0 / 0'), h('button', { type: 'button', class: 'btn small primary g-next', tabindex: '-1' }, '→')),
  );
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
    this.text.replaceChildren(...richNodes(tour.steps[this.step]!.text[L]));
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
    this.nav.replaceChildren(prev, count, next, ...(skip ? [skip] : []));
    if (reveal) this.revealSoon();
  }

  // ------------------------------------------------------------ layout

  private stageEl(): HTMLElement | null {
    return this.host.root.querySelector<HTMLElement>('.stage-wrap');
  }

  /** Measure the tour's longest text at this width; the font steps down until it fits `max`. */
  private fit(width: number, max: number): number {
    const L = lang();
    const texts = this.tour!.steps.map((s) => s.text[L]);
    this.measure.querySelector('.guide-head')!.textContent = this.tour!.title[L];
    let height = 0;
    let font = '';
    for (const f of FONT_STEPS) {
      font = f;
      this.measure.className = `guide-box guide-measure ${f}`.trim();
      height = tallestText(this.measure, this.mText, width, texts);
      if (height <= max) break;
    }
    this.box.className = `guide-box ${font}`.trim();
    return Math.min(height, max);
  }

  /** Place the box once per tour, viewport size and language; it does not move between steps. */
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
    if (stacked) {
      const height = this.fit(vw - 16, sheetMaxHeight(vh));
      const sheet = phoneSheet({ w: vw, h: vh }, height);
      b.left = `${sheet.x}px`;
      b.width = `${sheet.w}px`;
      b.height = `${sheet.h}px`;
      b.top = 'auto';
      b.bottom = `${vh - sheet.y - sheet.h}px`;
      this.boxRect = sheet;
      root.style.setProperty('--guide-pad', `${Math.ceil(height + 16)}px`);
      root.classList.add('guide-open', 'guide-sheet');
      root.classList.remove('guide-desk');
    } else {
      const st = { w: sr.width, h: sr.height };
      const width = deskWidth(st.w);
      const height = this.fit(width, deskMaxHeight(st.h));
      // keep off the stage's own buttons (the sample runs) when the tour points at the stage; the scene itself is
      // framed around the box
      const targets = this.tour.steps.flatMap((s) => s.targets);
      const avoid = (targets.includes('stage') ? [...stage.querySelectorAll('.stage-controls')] : [])
        .map(rectOf)
        .filter((r): r is Box => !!r)
        .map((r) => ({ x: r.x - sr.left, y: r.y - sr.top, w: r.w, h: r.h }));
      const spot = pickSpot(deskSpots(st, { w: width, h: height }), avoid);
      b.left = `${sr.left + spot.x}px`;
      b.top = `${sr.top + spot.y}px`;
      b.bottom = 'auto';
      b.width = `${spot.w}px`;
      b.height = `${spot.h}px`;
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
      step.targets.map((tg) => {
        const els = this.elements(tg);
        const r = union(els.map(rectOf));
        if (!r || !els[0]) return { target: tg, box: null };
        // the stage fills its side of the screen: its ring goes just inside it
        const ring = ringBox(r, tg === 'stage' ? -3 : tg === 'inputs' || tg === 'facts' ? 4 : 6);
        return { target: tg, box: clip(ring, this.area(els[0])) };
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
