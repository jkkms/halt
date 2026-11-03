// The tutorial player (SPEC_v0.6, SPEC_v0.7 §A): the stage fills the screen and the scene stays in its middle; the
// narration is a wide band along the bottom of the stage whose bottom edge, left and width stay put on every page and
// whose height is that of the page: the page text at its left and the page's interactive piece beside it at its right
// (under the text when there is no room), then the controls (the chapter and page counter, Skip, Back, Next) in a row
// at its bottom. The shot buttons and the
// caption sit along the top edge of the stage, between the step counter (top left) and the code card (top right).
// Phones: the stage, then the code card, then the narration with its controls, then the piece. Amber rings, one per
// piece, show what the text talks about. The same player shows the 14-page tutorial and the intros before levels 5,
// 7 and 10.
import { ExprError } from '../core/expr.ts';
import { proofLength, parseV } from '../core/game.ts';
import { codePreview, recommendedNext } from '../core/groups.ts';
import { levelById, type TutorialKey } from '../core/levels.ts';
import { runScene, type StageScene } from '../core/stage.ts';
import {
  CHAPTERS,
  focusOf,
  heldBeat,
  introFor,
  program,
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
import { FONT_STEPS, narrationNodes, richNodes as rich, RingLayer, type RingSpec } from './guide.ts';
import { lang, t } from './i18n.ts';
import type { Insets, PlayInfo, StageHold, StageTarget } from './stageTypes.ts';
import { BAND, bandBox, bandColumns, clip, linePieces, phoneInset, pieceWidth, ringBox, sceneFrames, topStrip, type BandCols, type Box } from './tutLayout.ts';

export type TutorialMode = { k: 'tutorial' } | { k: 'intro'; level: number; returnTo: string };

/** If the stage sends no beats (the flat drawing), multi-shot pages move on after this long. */
const FALLBACK_MS = 6500;
/** Phones and narrow windows: the text box and the cards go under the stage (matches the CSS). */
const NARROW = '(max-width: 760px)';

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

const round = (i: Insets): Insets => ({ top: Math.round(i.top), right: Math.round(i.right), bottom: Math.round(i.bottom), left: Math.round(i.left) });
/** The step counter's room at the top left of the stage, whatever it shows (it changes with every beat). */
const HUD_ROOM = { w: 280, h: 30 };

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
  /**
   * The narration (SPEC_v0.7 §A as changed by the author): one band whose bottom edge, left and width stay put on
   * every page, as tall as this page's text (and piece) need. The text (with the piece beside it on a wide screen),
   * then the controls in a row at the bottom.
   */
  private narrText = h('div', { class: 'tut-narr-text', 'aria-live': 'polite' });
  private narrBody = h('div', { class: 'tut-narr-body' }, this.narrText);
  private narr = h('div', { class: 'tut-narr', 'data-role': 'narration' }, this.narrBody, this.controls);
  /** Invisible copies, to measure every page's text at the text column's width and every page's piece. */
  private measureText = h('div', { class: 'tut-narr-text' });
  private measurePiece = h('div', { class: 'tut-extra' });
  private measure = h('div', { class: 'tut-narr tut-narr-measure', 'aria-hidden': 'true' }, this.measureText, this.measurePiece);
  private rings = h('div', { class: 'tut-rings', 'aria-hidden': 'true' });
  private ringLayer = new RingLayer(this.rings);
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
  private cols: BandCols | null = null;
  /** Wide screens: the band's fixed top edge and its tallest height (that of the page that needs most). */
  private bandTop = 0;
  private bandMax = 0;
  private font = '';
  private inset: Insets | Insets[] | undefined;
  private insetKey = '';
  /** The band and what else is over the stage (px of the stage box): rings and labels keep off them. */
  private band: Box | null = null;
  private keepOut: Box[] = [];
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
    this.stageBox.replaceChildren();
    // phones show them in this order: the stage, the code card, the narration, the piece
    this.main.replaceChildren(this.stageBox, this.codeBox, this.narr, this.extraBox, this.rings, this.measure);
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
    this.narrText.replaceChildren(...narrationNodes(p.text[L]));
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
    const extra = this.extra(p, true);
    this.extraBox.replaceChildren(...(extra ? [extra] : []));
    this.extraBox.hidden = !extra;
    this.el.classList.toggle('has-extra', !!extra);
    // the code focus is stronger (SPEC_v0.7 §C): the card's ring is thicker, the focused line clearly amber
    const focus = [...(p.focus ?? []), ...p.shots.flatMap((sh) => sh.focus ?? [])];
    this.codeBox.classList.toggle('focus-code', focus.includes('code'));
    this.codeBox.classList.toggle('focus-line', focus.includes('codeLine'));

    // the controls: chapter · page, Skip, Back, Next (a row at the band's bottom, which stays put, so Next never moves)
    const n = this.pages.length;
    const prev = h('button', { type: 'button', class: 'btn small ghost tc-prev', 'data-role': 'prev', disabled: this.page === 0, onclick: () => this.go(this.page - 1) }, `← ${t('prevPage')}`);
    const target = this.mode.k === 'tutorial' ? 1 : this.mode.level;
    const next = this.last()
      ? h('button', { type: 'button', class: 'btn primary tc-next', 'data-role': 'finish', onclick: () => this.finish() }, `${t('startLevelN', { n: target })} →`)
      : h('button', { type: 'button', class: 'btn primary tc-next', 'data-role': 'next', onclick: () => this.go(this.page + 1) }, `${t('nextPage')} →`);
    const skip = this.last() ? null : h('button', { type: 'button', class: 'skip', 'data-role': 'skip', onclick: () => this.skip() }, t('skip'));
    const chapter = p.chapter ? h('span', { class: 'tc-chapter', 'data-role': 'chapter' }, CHAPTERS[p.chapter][L]) : null;
    const count = h('span', { class: 'tc-count', 'data-role': 'count' }, ...(chapter ? [chapter, h('span', { class: 'tc-dot' }, ' · ')] : []), h('span', { class: 'tc-num' }, t('pageOf', { i: this.page + 1, n })));
    this.controls.replaceChildren(count, ...(skip ? [skip] : []), prev, next);
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
      // the rings follow the stage in the very frame it draws (no frame behind a label that just moved)
      onFrame: () => this.paintRings(),
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

  /**
   * The body a page needs in the band at these columns: its text, and its piece beside it (the taller of the two)
   * or under it when there is no room beside (the current font step; measured in the hidden copy).
   */
  private bodyHeights(cols: BandCols, bandW: number): number[] {
    const L = lang();
    this.measurePiece.style.width = `${pieceWidth(cols, bandW)}px`;
    return this.pages.map((p) => {
      // a page with no piece has the band's whole width for its text
      this.measureText.style.width = `${p.extra ? cols.text.w : cols.full}px`;
      this.measureText.replaceChildren(...narrationNodes(p.text[L]));
      const text = this.measureText.offsetHeight;
      const piece = p.extra ? this.extra(p, false) : null;
      this.measurePiece.replaceChildren(...(piece ? [piece] : []));
      const ph = piece ? this.measurePiece.offsetHeight : 0;
      this.measurePiece.replaceChildren();
      if (!ph) return text;
      return cols.piece ? Math.max(text, ph) : text + BAND.gap / 2 + ph;
    });
  }

  /**
   * Place the band (once per stage size and language: its top edge, left and width are the same on every page; its
   * height follows the page), the shot strip and the scene's frames, which keep above the tallest band so the scene
   * never moves between pages. Called on every page and shot (the code and the caption change), and on resize.
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
    const key = `${narrow ? 'n' : 'w'}:${W}x${narrow ? 0 : SH}:${lang()}`;
    const ex = this.extraBox;
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.el.classList.toggle('tut-desk', !narrow);
      if (narrow) {
        // phones: the narration under the code card takes its content's height; the piece comes after it
        this.cols = null;
        this.font = '';
        if (ex.parentElement !== main) this.narr.after(ex);
        for (const p of ['left', 'top', 'width', '--text-w', '--text-full', '--piece-w', '--band-h']) this.narr.style.removeProperty(p);
        this.narr.className = 'tut-narr';
      } else {
        if (ex.parentElement !== this.narrBody) this.narrBody.append(ex);
        const band = bandBox({ w: SW, h: SH }, 0);
        const cols = bandColumns(band.w);
        this.cols = cols;
        this.narr.style.left = `${band.x}px`;
        this.narr.style.width = `${band.w}px`;
        this.narr.style.setProperty('--text-w', `${cols.text.w}px`);
        this.narr.style.setProperty('--text-full', `${cols.full}px`);
        this.narr.style.setProperty('--piece-w', `${pieceWidth(cols, band.w)}px`);
        this.narr.classList.toggle('stacked', !cols.piece);
        // what the band needs besides its body: the controls row and the padding
        const chrome = () => this.narr.offsetHeight - this.narrBody.offsetHeight;
        // the largest font whose tallest band leaves the scene at least half the stage
        for (const f of FONT_STEPS) {
          this.font = f;
          this.narr.className = `tut-narr ${f}${cols.piece ? '' : ' stacked'}`.trim();
          this.measure.className = `tut-narr tut-narr-measure ${f}`.trim();
          this.bandMax = Math.ceil(chrome() + Math.max(...this.bodyHeights(cols, band.w)));
          if (this.bandMax <= SH * 0.5) break;
        }
        this.bandTop = Math.round(SH - BAND.margin - this.bandMax);
        this.narr.style.top = `${this.bandTop}px`;
        // the band's slot is the tallest page's; a shorter page sits at the slot's bottom (author, 11/3: "아래 맞춤")
        this.narr.style.setProperty('--band-h', `${this.bandMax}px`);
      }
    }
    const ui = (sel: string): Box | null => {
      const el = stageEl.querySelector<HTMLElement>(sel);
      if (!el || el.hidden || !el.childNodes.length || getComputedStyle(el).display === 'none') return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? this.rel(r, base) : null;
    };
    const hasHud = !this.current().wide;
    let inset: Insets | Insets[];
    let keepOut: Box[] = [];
    if (narrow) {
      this.band = null;
      // the step counter's row, even before its first beat
      const hud = ui('.stage-hud') ?? (hasHud ? { x: 8, y: 8, w: 120, h: 28 } : null);
      inset = round(phoneInset({ w: SW, h: SH }, [hud, ui('.stage-controls')], [ui('.stage-caption')]));
    } else {
      // the tallest band: the scene keeps above it on every page
      const band: Box = { x: BAND.margin, y: this.bandTop, w: SW - 2 * BAND.margin, h: this.bandMax };
      this.band = band;
      const code = this.codeBox.hidden ? null : this.rel(this.codeBox.getBoundingClientRect(), base);
      // the shot buttons and the caption: along the top edge, between the step counter and the code card
      const side = Math.max(code ? SW - code.x : 0, hasHud ? BAND.frameGap + HUD_ROOM.w : 0) + BAND.frameGap;
      const strip = topStrip({ w: SW }, side);
      stageEl.style.setProperty('--strip-x', `${strip.x}px`);
      const shots = ui('.stage-controls');
      stageEl.style.setProperty('--cap-top', `${shots ? Math.round(shots.y + shots.h + 6) : BAND.frameGap}px`);
      const caption = ui('.stage-caption');
      const hud: Box | null = hasHud ? { x: BAND.frameGap, y: BAND.frameGap, w: HUD_ROOM.w, h: HUD_ROOM.h } : null;
      const top = [hud, code, shots, caption].filter((b): b is Box => !!b);
      const frames = sceneFrames({ w: SW, h: SH }, band.y, top);
      // no centred frame fits (a very small stage): under everything at the top, above the tallest band
      inset = frames.length
        ? frames
        : round({ top: Math.max(BAND.frameGap, ...top.map((b) => b.y + b.h + BAND.frameGap)), right: BAND.frameGap, bottom: SH - band.y + BAND.frameGap, left: BAND.frameGap });
      // stage labels keep off the band, the cards and the strip (a long walk scrolls past them)
      keepOut = [band, ...top].map((b) => ({ x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }));
    }
    const k = JSON.stringify([inset, keepOut.map((b) => [b.x, b.y, b.w, b.h].map(Math.round))]);
    if (k !== this.insetKey) {
      this.insetKey = k;
      this.inset = inset;
      this.keepOut = keepOut;
      this.app.stage.setInset(inset, keepOut);
    }
  }

  // ------------------------------------------------------------ focus rings

  private targets(): Focus[] {
    return focusOf(this.current(), this.shot);
  }

  /** The pieces of a focus target, in px of the main box: one ring goes around each. */
  private targetPieces(f: Focus, base: DOMRect): Box[] {
    const dom = (el: Element | null): Box | null => {
      if (!el || (el as HTMLElement).hidden) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? this.rel(r, base) : null;
    };
    const some = (b: Box | null): Box[] => (b ? [b] : []);
    switch (f) {
      case 'code':
        return some(dom(this.codeBox));
      case 'codeLine':
        return linePieces([...this.codeBox.querySelectorAll('.code-line.run')].map((el) => dom(el)).filter((b): b is Box => !!b));
      case 'hud': {
        const hud = this.stageBox.querySelector<HTMLElement>('.stage-hud');
        return hud && hud.childNodes.length ? some(dom(hud)) : [];
      }
      case 'extra':
        return some(dom(this.extraBox));
      default: {
        if (!STAGE_FOCUS.includes(f)) return [];
        const s = this.stageBox.getBoundingClientRect();
        // on a wide screen the scene is above the band: nothing of it shows under the band
        const seen: Box = { x: 0, y: 0, w: s.width, h: this.band ? this.band.y : s.height };
        return this.app.stage
          .focusRects(f as StageTarget)
          .map((r) => clip(r, seen))
          .filter((r): r is Box => !!r && r.w >= 2 && r.h >= 2)
          .map((r) => ({ x: r.x + s.left - base.left, y: r.y + s.top - base.top, w: r.w, h: r.h }));
      }
    }
  }

  /** Every frame: the rings follow their targets; the step button follows the stage. */
  private frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    this.paintRings();
    this.paintStep();
  };

  /** One ring per piece of every target the shot names. */
  private paintRings(): void {
    if (!this.main.isConnected) return;
    const base = this.main.getBoundingClientRect();
    const rings: RingSpec[] = this.targets().flatMap((f): RingSpec[] => {
      const pieces = this.targetPieces(f, base);
      const pad = f === 'codeLine' ? 4 : f === 'code' ? 7 : 6;
      return pieces.length ? pieces.map((piece) => ({ target: f, piece, box: ringBox(piece, pad) })) : [{ target: f, piece: null, box: null }];
    });
    this.ringLayer.paint(rings);
  }

  // ------------------------------------------------------------ extras

  /**
   * Type the steps left and watch the stairs of the page's run change (no judging here). The row looks like the
   * level screen's: "남은 계단 수 = [ 예: n ]", the status right under it, the chips under that (page 13), and the
   * integer note small and quiet. `live`: the page on screen (false: a copy to measure).
   */
  private tryBox(p: TutPage, withChips: boolean, live: boolean): HTMLElement | null {
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
      placeholder: t('tryPlaceholder'),
      'aria-label': t('tryVLabel'),
    });
    if (live) {
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
    }
    const field = h('label', { class: 'field inline try-field' }, h('span', { class: 'field-name' }, t('tryVLabel')), input);
    const chips = withChips ? chipBar({ vars: prog.vars, cond: false, tuple: false, target: () => input, example: false }) : null;
    // Page 13 also carries the integer rules that the level screen no longer repeats.
    return h('div', { class: 'try' }, field, status, chips, withChips ? h('p', { class: 'tut-note int-note' }, t('intDomain')) : null);
  }

  /** The piece of a page. `live`: the page on screen (false: a copy to measure, with no effect on the screen). */
  private extra(p: TutPage, live: boolean): HTMLElement | null {
    switch (p.extra) {
      case 'tryV':
        return this.tryBox(p, false, live);
      case 'chips':
        return this.tryBox(p, true, live);
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
        const btn = h('button', { type: 'button', class: 'btn primary step-btn', 'data-role': live ? 'step' : null, onclick: () => this.stepPress() }, t('stepOne')) as HTMLButtonElement;
        const status = h('p', { class: 'step-status', 'data-role': live ? 'step-status' : null, 'aria-live': 'polite' });
        // the longest status line, so the card is as tall as it gets
        const sc = p.shots[0]!.scene;
        const beats = sc.k === 'run' ? stepBeats(program(sc.prog), sceneStart(sc)) : [];
        const longest = [...beats].sort((a, b) => b.status[lang()].length - a.status[lang()].length)[0];
        if (live) {
          this.stepBtn = btn;
          this.stepStatus = status;
          if (this.beats) status.replaceChildren(...rich(this.beats[0]!.status[lang()]));
        } else if (longest) status.replaceChildren(...rich(longest.status[lang()]));
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
