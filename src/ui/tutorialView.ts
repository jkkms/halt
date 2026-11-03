// The tutorial player (SPEC_v0.6, with the author's change to §A): the stage fills the screen; the page text sits
// in a still text box (upper left on a wide screen, under the stage on a phone) that has the same place and size on
// every page; amber rings show what the text talks about. Back, the chapter and page counter, Next and Skip stay
// still in a pill at the bottom of the stage; a page's interactive piece sits in a card under the text box (or just
// above the pill when there is no room; under the stage on phones). The same player shows the 14-page tutorial and
// the short intros before levels 5, 7 and 10.
import { ExprError } from '../core/expr.ts';
import { proofLength, parseV } from '../core/game.ts';
import { codePreview, recommendedNext } from '../core/groups.ts';
import { levelById, type TutorialKey } from '../core/levels.ts';
import { runScene, type StageScene } from '../core/stage.ts';
import {
  CHAPTERS,
  focusOf,
  heldBeat,
  INTROS,
  introFor,
  program,
  richParts,
  sceneStart,
  shotProgram,
  STAGE_FOCUS,
  stepBeats,
  TUTORIAL,
  tutScene,
  type Focus,
  type Hold,
  type StepBeat,
  type TutPage,
} from '../core/tutorial.ts';
import type { App, Screen } from './app.ts';
import { chipBar } from './chips.ts';
import { codeView, follow, type CodeView } from './code.ts';
import { h } from './dom.ts';
import { errorText } from './errors.ts';
import { pretty, starsText } from './format.ts';
import { lang, t } from './i18n.ts';
import type { Insets, PlayInfo, StageHold, StageTarget } from './stageTypes.ts';
import { boxWidth, cardWidth, deskLayout, maxBoxHeight, phoneInset, ringBox, textBox, type Box } from './tutLayout.ts';

export type TutorialMode = { k: 'tutorial' } | { k: 'intro'; level: number; returnTo: string };

/** If the stage sends no beats (the flat drawing), multi-shot pages move on after this long. */
const FALLBACK_MS = 6500;
/** Phones and narrow windows: the text box and the cards go under the stage (matches the CSS). */
const NARROW = '(max-width: 760px)';
/** Text sizes to try, largest first, until the longest page fits the box without scrolling. */
const FONT_STEPS = ['', 'fs1', 'fs2', 'fs3'];

/** Every page the box must fit: the tutorial and all intros share one box. */
const ALL_PAGES: TutPage[] = [...TUTORIAL, ...Object.values(INTROS).flatMap((i) => i.pages)];

const rich = (s: string) => richParts(s).map((part) => (part.kind === 'bold' ? h('strong', {}, part.s) : part.kind === 'code' ? h('code', {}, part.s) : part.s));

const toHold = (hold: Hold): StageHold => (hold === 'start' ? { at: 'start' } : hold === 'lastCheck' ? { at: 'lastCheck' } : { at: 'check', i: Number(hold.split(':')[1]) });

/** A beat of the step mode as the stage reports beats (for the code card and the step counter). */
function playInfo(b: StepBeat): PlayInfo {
  switch (b.kind) {
    case 'start':
      return { kind: 'start', k: 0, lines: [], state: b.state, first: true };
    case 'check':
      return { kind: 'guard', k: b.k, lines: b.lines, holds: b.holds, state: b.state, first: true };
    case 'step':
      return { kind: 'step', k: b.k - 1, lines: b.lines, state: b.state, after: b.state, first: true };
    case 'exit':
      return { kind: 'exit', k: b.k, lines: [], steps: b.ended, state: b.state, first: true };
  }
}

const sameInset = (a: Insets | undefined, b: Insets) => !!a && a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
const round = (i: Insets): Insets => ({ top: Math.round(i.top), right: Math.round(i.right), bottom: Math.round(i.bottom), left: Math.round(i.left) });

export class TutorialScreen implements Screen {
  el: HTMLElement;
  private app: App;
  private mode: TutorialMode;
  private pages: TutPage[];
  private page: number;
  private shot = 0;
  private main = h('div', { class: 'tut-main' });
  private stageBox = h('div', { class: 'tut-stage' });
  private codeBox = h('div', { class: 'tut-code', 'data-role': 'code-card' });
  /** The page's interactive piece (verdict buttons, the try-it box, the step button, the legend, the level card). */
  private extraBox = h('div', { class: 'tut-extra', 'data-role': 'extra' });
  private controls = h('nav', { class: 'tut-controls' });
  /** The page text: one still box. */
  private narrText = h('p', { class: 'tut-narr-text', 'aria-live': 'polite' });
  private narr = h('div', { class: 'tut-narr', 'data-role': 'narration' }, this.narrText);
  /** An invisible copy of the box, to measure the longest page text. */
  private measureText = h('p', { class: 'tut-narr-text' });
  private measure = h('div', { class: 'tut-narr tut-narr-measure', 'aria-hidden': 'true' }, this.measureText);
  private rings = h('div', { class: 'tut-rings', 'aria-hidden': 'true' });
  private code: CodeView | null = null;
  private codeProg: TutorialKey | null = null;
  private tryText = '';
  /** The drawing from the page's input box (null: the page's own shots). */
  private custom: { scene: StageScene; caption: string } | null = null;
  private beatSeen = false;
  private fallback: ReturnType<typeof setTimeout> | null = null;
  // held pages and the step mode
  private beats: StepBeat[] | null = null;
  private stepIdx = 0;
  private stepBtn: HTMLButtonElement | null = null;
  private stepStatus: HTMLElement | null = null;
  // layout
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private layoutKey = '';
  private boxH = 0;
  private font = '';
  private inset: Insets | undefined;
  /** What labels on the stage keep out of: the text box and the cards over the stage. */
  private keepOut: Box[] = [];
  private keptKey = '';
  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowRight') this.go(this.page + 1);
    else if (e.key === 'ArrowLeft') this.go(this.page - 1);
  };

  constructor(app: App, mode: TutorialMode, page: number) {
    this.app = app;
    this.mode = mode;
    this.pages = mode.k === 'tutorial' ? TUTORIAL : (introFor(mode.level)?.pages ?? []);
    this.page = Math.min(this.pages.length - 1, Math.max(0, page));
    this.el = h('div', { class: `screen tut-screen${mode.k === 'intro' ? ' intro-screen' : ''}` });
    this.build();
    document.addEventListener('keydown', this.onKey);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey);
    this.stopFallback();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro?.disconnect();
    this.ro = null;
  }

  private title(): string {
    if (this.mode.k === 'tutorial') return t('tutTitle');
    const intro = introFor(this.mode.level)!;
    return `${t('introTag', { n: this.mode.level })} · ${intro.title[lang()]}`;
  }

  private build(): void {
    const back = this.mode.k === 'tutorial' ? { label: t('backTitle'), href: '#/' } : { label: t('levelN', { n: this.mode.level }), href: this.mode.returnTo };
    const bar = this.app.bar({ back, title: this.title(), dark: true });
    this.stageBox.replaceChildren(this.controls);
    this.main.replaceChildren(this.stageBox, this.narr, this.codeBox, this.extraBox, this.rings, this.measure);
    this.el.replaceChildren(bar, this.main);
    this.layoutKey = '';
  }

  shown(): void {
    this.app.stage.mount(this.stageBox);
    this.stageBox.prepend(this.app.stage.el);
    this.renderPage();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
    this.ro?.disconnect();
    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(this.main);
    // the box is measured with the real font once it is in (hidden until then, so it never changes size in view)
    const fonts = document.fonts;
    if (fonts && fonts.status !== 'loaded') {
      this.narr.classList.add('waiting');
      const done = () => {
        this.narr.classList.remove('waiting');
        this.layoutKey = '';
        this.relayout();
      };
      void fonts.ready.then(done);
      setTimeout(done, 1500);
    }
  }

  relang(): void {
    this.build();
    this.shown();
  }

  private go(i: number): void {
    if (i < 0 || i >= this.pages.length) return;
    this.page = i;
    this.tryText = '';
    this.custom = null;
    this.renderPage();
  }

  private current(): TutPage {
    return this.pages[this.page]!;
  }

  private last(): boolean {
    return this.page === this.pages.length - 1;
  }

  private renderPage(): void {
    const p = this.current();
    const L = lang();
    if (this.mode.k === 'tutorial' && this.last()) this.markTutorial('done');
    // the page text; the box stays where it is, only the words change (a gentle fade)
    this.narrText.replaceChildren(...rich(p.text[L]));
    this.narrText.classList.remove('fade');
    void this.narrText.offsetWidth;
    this.narrText.classList.add('fade');
    this.narr.dataset.page = String(this.page + 1);

    // a held page or the step mode: the beats of its run, from the simulator
    const sc = p.shots[0]!.scene;
    this.beats = (p.hold || p.step) && sc.k === 'run' ? stepBeats(program(sc.prog), sceneStart(sc)) : null;
    this.stepIdx = 0;
    this.stepBtn = null;
    this.stepStatus = null;

    this.codeProg = null;
    const extra = this.extra(p);
    this.extraBox.replaceChildren(...(extra ? [extra] : []));
    this.extraBox.hidden = !extra;
    this.el.classList.toggle('has-extra', !!extra);

    // the controls stay still at the bottom of the stage: Back, chapter · page, Next, Skip
    const n = this.pages.length;
    const prev = h('button', { type: 'button', class: 'tc-prev', 'data-role': 'prev', disabled: this.page === 0, onclick: () => this.go(this.page - 1) }, `← ${t('prevPage')}`);
    const target = this.mode.k === 'tutorial' ? 1 : this.mode.level;
    const next = this.last()
      ? h('button', { type: 'button', class: 'btn primary tc-next', 'data-role': 'finish', onclick: () => this.finish() }, `${t('startLevelN', { n: target })} →`)
      : h('button', { type: 'button', class: 'btn primary tc-next', 'data-role': 'next', onclick: () => this.go(this.page + 1) }, `${t('nextPage')} →`);
    const skip = this.last() ? null : h('button', { type: 'button', class: 'skip', 'data-role': 'skip', onclick: () => this.skip() }, t('skip'));
    const chapter = p.chapter ? h('span', { class: 'tc-chapter', 'data-role': 'chapter' }, CHAPTERS[p.chapter][L]) : null;
    const count = h('span', { class: 'tc-count', 'data-role': 'count' }, ...(chapter ? [chapter, h('span', { class: 'tc-dot' }, ' · ')] : []), h('span', { class: 'tc-num' }, t('pageOf', { i: this.page + 1, n })));
    this.controls.replaceChildren(prev, count, next, ...(skip ? [skip] : []));
    this.showShot(0);
  }

  // ------------------------------------------------------------ the stage

  private stopFallback(): void {
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
  }

  /** The code card shows the program on the stage (it changes with the shot on page 9). */
  private showCode(key: TutorialKey): void {
    if (this.codeProg === key) return;
    this.codeProg = key;
    const prog = program(key);
    this.code = codeView(prog);
    const facts = prog.facts !== 'true' ? pretty(prog.factsText ?? prog.facts) : null;
    const kids: HTMLElement[] = [this.code.el];
    if (facts) kids.push(h('p', { class: 'tut-code-facts' }, `${t('facts')}: `, h('code', {}, facts)));
    this.codeBox.replaceChildren(...kids);
  }

  /** Show shot i of the page (or the drawing typed in the page's input box). */
  private showShot(i: number): void {
    const p = this.current();
    const L = lang();
    this.shot = ((i % p.shots.length) + p.shots.length) % p.shots.length;
    const sh = p.shots[this.shot]!;
    this.showCode(shotProgram(sh));
    const scene = this.custom?.scene ?? tutScene(sh.scene);
    const caption = this.custom?.caption ?? sh.label?.[L];
    const many = p.shots.length > 1 && !this.custom;
    const pills = many
      ? p.shots.map((s, k) =>
          h(
            'button',
            { type: 'button', class: `pill shot${k === this.shot ? ' on' : ''}`, 'data-shot': k, 'aria-pressed': k === this.shot ? 'true' : 'false', title: s.label?.[L] ?? null, onclick: () => this.showShot(k) },
            s.tag?.[L] ?? s.label?.[L] ?? String(k + 1),
          ),
        )
      : [];
    this.beatSeen = false;
    this.stopFallback();
    if (many) this.fallback = setTimeout(() => this.fallbackNext(), FALLBACK_MS);
    for (const b of this.extraBox.querySelectorAll<HTMLElement>('[data-hl-shot]')) b.classList.toggle('hl', Number(b.dataset.hlShot) === this.shot);
    const held = !this.custom && p.hold ? toHold(p.hold) : undefined;
    this.app.stage.show(scene, {
      caption,
      controls: pills,
      loop: true,
      sound: true,
      hud: scene.k !== 'idle' && !p.wide,
      zoom: p.wide ? 1.45 : undefined,
      inset: this.inset,
      keepOut: this.keepOut,
      hold: held,
      step: !this.custom && !!p.step,
      frame: 'all',
      allMarks: true,
      onBeat: (b) => this.beat(b),
    });
    this.stageBox.dataset.shot = String(this.shot);
    // what a held page shows (the stage reports the same beats; the flat drawing does not)
    if (this.beats && !this.custom) this.apply(p.hold ? heldBeat(this.beats, p.hold) : this.beats[0]!);
    this.relayout();
  }

  private beat(b: PlayInfo): void {
    this.beatSeen = true;
    if (this.code) follow(this.code, b);
    // A page with several shots plays them in turn: when one walk is over, the next one starts.
    if (b.kind === 'start' && !b.first && this.current().shots.length > 1 && !this.custom) queueMicrotask(() => this.showShot(this.shot + 1));
  }

  private fallbackNext(): void {
    this.fallback = null;
    if (!this.beatSeen) this.showShot(this.shot + 1);
  }

  /** Show a beat of the step list: the lit code line, the status line, and (flat drawing) the step counter. */
  private apply(b: StepBeat): void {
    const info = playInfo(b);
    if (this.code) follow(this.code, info);
    // the 3-D stage reports the same beat when it gets there; the flat drawing never does
    this.app.stage.hudBeat(info);
    if (this.stepStatus) {
      this.stepStatus.replaceChildren(...rich(b.status[lang()]));
      this.stepStatus.dataset.beat = String(this.beats?.indexOf(b) ?? -1);
    }
  }

  // ------------------------------------------------------------ step mode (page 6)

  private stepPress(): void {
    const beats = this.beats;
    if (!beats) return;
    const stage = this.app.stage;
    const atEnd = this.stepIdx >= beats.length - 1;
    if (stage.isFlat()) {
      // no animation: the code card, the step counter and the status line still step
      if (atEnd) this.stepIdx = 0;
      else {
        this.stepIdx++;
        while (beats[this.stepIdx + 1]?.auto) this.apply(beats[this.stepIdx++]!);
      }
      this.apply(beats[this.stepIdx]!);
      this.paintStep();
      return;
    }
    const st = stage.holdState();
    if (st.done || atEnd) {
      stage.replay();
      this.stepIdx = 0;
      this.apply(beats[0]!);
      this.paintStep();
      return;
    }
    if (!st.held || !stage.step()) return;
    this.stepIdx++;
    this.apply(beats[this.stepIdx]!);
    this.paintStep();
  }

  /** The step button: disabled while a beat plays; "From the start" once the walker is out. */
  private paintStep(): void {
    const btn = this.stepBtn;
    const beats = this.beats;
    if (!btn || !beats) return;
    const stage = this.app.stage;
    const flat = stage.isFlat();
    const st = stage.holdState();
    // the walk out of the door follows the check that fails without a press
    if (!flat && st.done && beats[this.stepIdx + 1]?.auto) {
      this.stepIdx++;
      this.apply(beats[this.stepIdx]!);
    }
    const end = this.stepIdx >= beats.length - 1 && (flat || st.done);
    const label = end ? t('stepAgain') : t('stepOne');
    if (btn.textContent !== label) btn.textContent = label;
    btn.dataset.state = end ? 'end' : 'step';
    btn.disabled = !flat && !st.held;
  }

  // ------------------------------------------------------------ layout

  private narrow(): boolean {
    return matchMedia(NARROW).matches;
  }

  /** px of the main box */
  private rel(r: DOMRect, base: DOMRect): Box {
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  }

  /** The tallest page text at this width (with the current font step). */
  private tallest(width: number): number {
    const m = this.measure;
    m.style.width = `${width}px`;
    let max = 0;
    const L = lang();
    for (const p of ALL_PAGES) {
      this.measureText.replaceChildren(...rich(p.text[L]));
      max = Math.max(max, m.offsetHeight);
    }
    return Math.ceil(max);
  }

  /**
   * Place the text box (once per stage size and language: the same rect on every page), the page's card and the
   * scene's insets. Called on every page and shot (the card, the code and the caption change), and on resize.
   */
  private relayout(): void {
    const main = this.main;
    const W = main.clientWidth;
    const narrow = this.narrow();
    const stageEl = this.stageBox;
    const SW = stageEl.clientWidth;
    const SH = stageEl.clientHeight;
    if (!W || !SW || !SH) return;
    const base = stageEl.getBoundingClientRect();
    const pill = this.rel(this.controls.getBoundingClientRect(), base);
    const key = `${narrow ? 'n' : 'w'}:${W}x${narrow ? 0 : SH}:${lang()}`;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      const width = narrow ? W - 2 * 8 : boxWidth(SW);
      const limit = narrow ? Infinity : maxBoxHeight(SH, pill);
      for (const f of FONT_STEPS) {
        this.font = f;
        this.measure.className = `tut-narr tut-narr-measure ${f}`.trim();
        this.boxH = this.tallest(width);
        if (this.boxH <= limit) break;
      }
      this.narr.className = `tut-narr ${this.font}`.trim();
      this.narr.style.height = `${this.boxH}px`;
      if (narrow) {
        this.narr.style.left = this.narr.style.top = this.narr.style.width = '';
      } else {
        const box = textBox({ w: SW, h: SH }, this.boxH);
        this.narr.style.left = `${box.x}px`;
        this.narr.style.top = `${box.y}px`;
        this.narr.style.width = `${box.w}px`;
      }
      this.main.style.setProperty('--col-w', `${boxWidth(SW)}px`);
    }
    const ui = (sel: string): Box | null => {
      const el = stageEl.querySelector<HTMLElement>(sel);
      if (!el || el.hidden || !el.childNodes.length || getComputedStyle(el).display === 'none') return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? this.rel(r, base) : null;
    };
    const shots = ui('.stage-controls');
    const caption = ui('.stage-caption');
    let inset: Insets;
    let keepOut: Box[] = [];
    const ex = this.extraBox;
    if (narrow) {
      ex.style.left = ex.style.top = ex.style.width = '';
      ex.classList.remove('in-column', 'above-pill');
      // the step counter's row, even before its first beat
      const hud = ui('.stage-hud') ?? (this.current().wide ? null : { x: 8, y: 8, w: 120, h: 28 });
      inset = phoneInset({ w: SW, h: SH }, [hud, shots], [pill, caption]);
    } else {
      const box = textBox({ w: SW, h: SH }, this.boxH);
      let card: { h: number; hWide: number } | null = null;
      if (!ex.hidden) {
        ex.style.left = '0px';
        ex.style.top = '0px';
        ex.style.width = `${box.w}px`;
        const hNarrow = ex.offsetHeight;
        ex.style.width = `${cardWidth({ w: SW }, box)}px`;
        card = { h: hNarrow, hWide: ex.offsetHeight };
      }
      const code = this.codeBox.hidden ? null : this.rel(this.codeBox.getBoundingClientRect(), base);
      const L = deskLayout({ stage: { w: SW, h: SH }, box, code, pill, card, shots, caption });
      if (L.card) {
        ex.style.left = `${L.card.x}px`;
        ex.style.top = `${L.card.y}px`;
        ex.style.width = `${L.card.w}px`;
        ex.classList.toggle('in-column', L.cardInColumn);
        ex.classList.toggle('above-pill', !L.cardInColumn);
      }
      inset = L.inset;
      // stage labels keep off the text box and the cards (a long walk scrolls past them)
      keepOut = [box, ...(L.card ? [L.card] : []), ...(code ? [code] : [])].map((b) => ({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }));
    }
    inset = round(inset);
    const kept = JSON.stringify(keepOut.map((b) => [b.x, b.y, b.w, b.h].map(Math.round)));
    if (!sameInset(this.inset, inset) || kept !== this.keptKey) {
      this.inset = inset;
      this.keepOut = keepOut;
      this.keptKey = kept;
      this.app.stage.setInset(inset, keepOut);
    }
  }

  // ------------------------------------------------------------ focus rings

  private targets(): Focus[] {
    return focusOf(this.current(), this.shot);
  }

  /** Where a focus target is, in px of the main box. */
  private targetRect(f: Focus, base: DOMRect): Box | null {
    const dom = (el: Element | null): Box | null => {
      if (!el || (el as HTMLElement).hidden) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? this.rel(r, base) : null;
    };
    switch (f) {
      case 'code':
        return dom(this.codeBox);
      case 'codeLine': {
        const lit = [...this.codeBox.querySelectorAll('.code-line.run')].map((el) => dom(el)).filter((b): b is Box => !!b);
        if (!lit.length) return null;
        const x0 = Math.min(...lit.map((b) => b.x));
        const y0 = Math.min(...lit.map((b) => b.y));
        const x1 = Math.max(...lit.map((b) => b.x + b.w));
        const y1 = Math.max(...lit.map((b) => b.y + b.h));
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      case 'hud': {
        const hud = this.stageBox.querySelector<HTMLElement>('.stage-hud');
        return hud && hud.childNodes.length ? dom(hud) : null;
      }
      case 'extra':
        return dom(this.extraBox);
      default: {
        if (!STAGE_FOCUS.includes(f)) return null;
        const r = this.app.stage.focusRect(f as StageTarget);
        if (!r) return null;
        const s = this.stageBox.getBoundingClientRect();
        return { x: r.x + s.left - base.left, y: r.y + s.top - base.top, w: r.w, h: r.h };
      }
    }
  }

  /** Every frame: the rings follow their targets; the step button follows the stage. */
  private frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    const base = this.main.getBoundingClientRect();
    const targets = this.targets();
    const rings = this.rings;
    while (rings.children.length < targets.length) rings.append(h('div', { class: 'tut-ring' }));
    [...rings.children].forEach((el, i) => {
      const ring = el as HTMLElement;
      const f = targets[i];
      const r = f ? this.targetRect(f, base) : null;
      if (!f || !r) {
        ring.hidden = true;
        return;
      }
      const g = ringBox(r, f === 'codeLine' ? 3 : 6);
      ring.hidden = false;
      ring.dataset.target = f;
      const css = `${g.x.toFixed(0)}px,${g.y.toFixed(0)}px,${g.w.toFixed(0)}px,${g.h.toFixed(0)}px`;
      if (ring.dataset.box !== css) {
        ring.dataset.box = css;
        ring.style.transform = `translate(${g.x.toFixed(0)}px, ${g.y.toFixed(0)}px)`;
        ring.style.width = `${g.w.toFixed(0)}px`;
        ring.style.height = `${g.h.toFixed(0)}px`;
      }
    });
    this.paintStep();
  };

  // ------------------------------------------------------------ extras

  /** Type the steps left and watch the stairs of the page's run change (no judging here). */
  private tryBox(withChips: boolean): HTMLElement | null {
    const p = this.current();
    const sc = p.shots[0]!.scene;
    if (sc.k !== 'run') return null;
    const prog = program(sc.prog);
    const s0 = sceneStart(sc);
    const status = h('p', { class: 'try-status' }, t('tryVHint'));
    const input = h('input', {
      type: 'text',
      class: 'answer',
      'data-focus': 'tryV',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder: withChips ? t('typeHere') : t('tryPlaceholder'),
      'aria-label': t('tryVLabel'),
    });
    input.value = this.tryText;
    const update = () => {
      this.tryText = input.value;
      if (!input.value.trim()) {
        status.textContent = t('tryVHint');
        status.className = 'try-status';
        this.custom = null;
        this.showShot(0);
        return;
      }
      try {
        const V = parseV(prog, input.value);
        status.textContent = t('typeOk', { len: proofLength(prog, input.value, '') });
        status.className = 'try-status ok';
        this.custom = { scene: runScene(prog, s0, V, 30), caption: t('echoV', { v: input.value.trim().replace(/-/g, '−') }) };
        this.showShot(0);
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
        status.textContent = t('tryVBad', { err: errorText(e) });
        status.className = 'try-status bad';
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, 160);
    });
    const field = h('label', { class: 'try-field' }, h('span', { class: 'field-name' }, t('tryVLabel')), input);
    const chips = withChips ? chipBar({ vars: prog.vars, cond: false, tuple: false, target: () => input, example: false }) : null;
    // Page 13 also carries the integer rules that the level screen no longer repeats.
    return h('div', { class: 'try' }, field, status, chips, withChips ? h('p', { class: 'tut-note int-note' }, t('intDomain')) : null);
  }

  private extra(p: TutPage): HTMLElement | null {
    switch (p.extra) {
      case 'tryV':
        return this.tryBox(false);
      case 'chips':
        return this.tryBox(true);
      case 'verdicts': {
        // The level screen's step-1 card, with the verdict of the shot on the stage lit up.
        const btn = (cls: string, label: string, shot?: number) => h('span', { class: `verdict ${cls} demo${shot === this.shot ? ' hl' : ''}`, 'data-hl-shot': shot ?? null }, label);
        return h(
          'div',
          { class: 'verdict-card-demo', 'aria-hidden': 'true' },
          h('p', { class: 'card-title' }, t('verdictQ')),
          h('div', { class: 'verdicts' }, btn('v-ends', t('verdictEnds'), 0), btn('v-never', t('verdictNever'), 1), btn('v-nobody', t('verdictNobody'))),
          h('p', { class: 'help' }, t('verdictHelp')),
        );
      }
      case 'stepper': {
        const btn = h('button', { type: 'button', class: 'btn primary step-btn', 'data-role': 'step', onclick: () => this.stepPress() }, t('stepOne')) as HTMLButtonElement;
        const status = h('p', { class: 'step-status', 'data-role': 'step-status', 'aria-live': 'polite' });
        this.stepBtn = btn;
        this.stepStatus = status;
        if (this.beats) status.replaceChildren(...rich(this.beats[0]!.status[lang()]));
        return h('div', { class: 'stepper' }, btn, status);
      }
      case 'legend': {
        const rows = ([1, 2, 3, 4, 5] as const).map((i) =>
          h('tr', {}, h('td', { class: 'lg-code' }, t(`legendCode${i}`)), h('td', { class: 'lg-arrow', 'aria-hidden': 'true' }, '↔'), h('td', { class: 'lg-pic' }, t(`legendPic${i}`))),
        );
        return h('div', { class: 'legend' }, h('p', { class: 'card-title' }, t('legendTitle')), h('table', { class: 'legend-table' }, h('tbody', {}, ...rows)));
      }
      case 'levelCard': {
        const l = levelById(1);
        const best = this.app.saved.best[1] ?? 0;
        return h(
          'a',
          { class: 'lv-card tut-level-card next', href: '#/level/1', 'data-level': 1 },
          h('span', { class: 'lv-top' }, h('span', { class: 'lv-num' }, '1'), h('span', { class: 'lv-stars', 'aria-label': `${best}/3` }, starsText(best))),
          h('span', { class: 'lv-title' }, l.title[lang()]),
          h('code', { class: 'lv-code' }, codePreview(l)),
        );
      }
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ leaving

  private markTutorial(how: 'done' | 'skipped'): void {
    const s = this.app.saved;
    if (s.tutorial === 'done' || s.tutorial === how) return;
    s.tutorial = how;
    this.app.persist();
  }

  private finish(): void {
    if (this.mode.k === 'tutorial') {
      this.markTutorial('done');
      location.hash = '#/level/1';
    } else location.hash = this.mode.returnTo;
  }

  private skip(): void {
    if (this.mode.k === 'tutorial') {
      this.markTutorial('skipped');
      location.hash = `#/level/${recommendedNext(this.app.saved.best) ?? 1}`;
    } else location.hash = this.mode.returnTo;
  }
}
