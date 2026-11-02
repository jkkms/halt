// The tutorial player (SPEC_v0.5 §B): the stage full screen and the walker speaks. The page text is a speech
// bubble whose tail follows the walker's head; Back, the page counter, Next and Skip stay still in a pill at the
// bottom of the stage, and a page's interactive piece floats in a small card above it (under the stage on phones).
// The same player shows the 8-page tutorial and the short intros before levels 7 and 10.
import { ExprError } from '../core/expr.ts';
import { proofLength, parseV } from '../core/game.ts';
import { codePreview, recommendedNext } from '../core/groups.ts';
import { levelById } from '../core/levels.ts';
import { runScene, type StageScene } from '../core/stage.ts';
import { introFor, program, richParts, sceneStart, TUTORIAL, tutScene, type TutPage } from '../core/tutorial.ts';
import type { App, Screen } from './app.ts';
import { bubblePath, overlap, placeBubble, tailFor, type Box, type Pt, type Side, type WalkerSpot } from './bubble.ts';
import { chipBar } from './chips.ts';
import { codeView, follow, type CodeView } from './code.ts';
import { h, s as svg } from './dom.ts';
import { errorText } from './errors.ts';
import { pretty, starsText } from './format.ts';
import { lang, t } from './i18n.ts';
import type { PlayInfo } from './stageTypes.ts';

export type TutorialMode = { k: 'tutorial' } | { k: 'intro'; level: number; returnTo: string };

/** If the stage sends no beats (the flat drawing), multi-shot pages move on after this long. */
const FALLBACK_MS = 6500;
/** The walker vanishes into the door at the end of every walk; the bubble waits where it was this long. */
const HOLD_MS = 1600;
/** After a page change the bubble jumps to its place (no glide) for this long. */
const SNAP_MS = 220;
/** A new spot further than this from where the bubble is: it pops there instead of gliding. */
const JUMP_PX = 120;
/** The walker's head moved further than this in one frame: a new shot, not a step (no smoothing). */
const TELEPORT_PX = 60;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** The speech bubble: a rounded outline with its tail (one SVG path) behind the page text. */
interface Bubble {
  el: HTMLElement;
  body: HTMLElement;
  shape: SVGSVGElement;
  path: SVGPathElement;
  text: HTMLElement;
}

function makeBubble(): Bubble {
  const path = svg('path', { class: 'tut-bubble-line' });
  const shape = svg('svg', { class: 'tut-bubble-shape', 'aria-hidden': 'true' }, path);
  const text = h('p', { class: 'tut-bubble-text', 'aria-live': 'polite' });
  const body = h('div', { class: 'tut-bubble-body' }, shape, text);
  return { el: h('div', { class: 'tut-bubble' }, body), body, shape, path, text };
}

export class TutorialScreen implements Screen {
  el: HTMLElement;
  private app: App;
  private mode: TutorialMode;
  private pages: TutPage[];
  private page: number;
  private shot = 0;
  private stageBox = h('div', { class: 'tut-stage' });
  private codeBox = h('div', { class: 'tut-code' });
  /** The page's interactive piece (verdict buttons, the try-it box, the level card). */
  private extraBox = h('div', { class: 'tut-extra' });
  private controls = h('nav', { class: 'tut-controls' });
  private bubble = makeBubble();
  private code: CodeView | null = null;
  private tryText = '';
  /** The drawing from the page's input box (null: the page's own shots). */
  private custom: { scene: StageScene; caption: string } | null = null;
  private beatSeen = false;
  private fallback: ReturnType<typeof setTimeout> | null = null;
  // following the walker
  private raf = 0;
  private lastFrame = 0;
  private seen: { spot: WalkerSpot; at: number } | null = null;
  private smooth: WalkerSpot | null = null;
  private box: Box | null = null;
  private side: Side | undefined;
  private slot: string | undefined;
  /** The widest loop-check bubble the stage has shown on this page (the bubble's tail keeps off it). */
  private check: { w: number; h: number } | undefined;
  private wasFallback = true;
  private snapUntil = 0;
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
  }

  private title(): string {
    if (this.mode.k === 'tutorial') return t('tutTitle');
    const intro = introFor(this.mode.level)!;
    return `${t('introTag', { n: this.mode.level })} · ${intro.title[lang()]}`;
  }

  private build(): void {
    const back = this.mode.k === 'tutorial' ? { label: t('backTitle'), href: '#/' } : { label: t('levelN', { n: this.mode.level }), href: this.mode.returnTo };
    const bar = this.app.bar({ back, title: this.title(), dark: true });
    this.stageBox.replaceChildren(this.bubble.el, this.controls);
    this.el.replaceChildren(bar, h('div', { class: 'tut-main' }, this.stageBox, this.codeBox, this.extraBox));
  }

  shown(): void {
    this.app.stage.mount(this.stageBox);
    this.renderPage();
    cancelAnimationFrame(this.raf);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
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
    // code beside the stage
    const prog = p.code ? program(p.code) : null;
    this.code = prog ? codeView(prog) : null;
    const facts = prog && prog.facts !== 'true' ? pretty(prog.factsText ?? prog.facts) : null;
    const codeKids: HTMLElement[] = [];
    if (prog && this.code) codeKids.push(this.code.el);
    if (facts) codeKids.push(h('p', { class: 'tut-code-facts' }, `${t('facts')}: `, h('code', {}, facts)));
    this.codeBox.replaceChildren(...codeKids);
    this.codeBox.hidden = !prog;
    this.el.classList.toggle('has-code', !!prog);

    // the page text in the bubble; it pops in at its new place
    this.bubble.text.replaceChildren(...richParts(p.text[L]).map((part) => (part.kind === 'bold' ? h('strong', {}, part.s) : part.kind === 'code' ? h('code', {}, part.s) : part.s)));
    this.seen = null;
    this.smooth = null;
    this.slot = undefined;
    this.check = undefined;
    this.snapUntil = performance.now() + SNAP_MS;
    this.pop();

    const extra = this.extra(p);
    this.extraBox.replaceChildren(...(extra ? [extra] : []));
    this.extraBox.hidden = !extra;
    this.el.classList.toggle('has-extra', !!extra);
    this.showShot(0);

    // the controls stay still at the bottom of the stage
    const n = this.pages.length;
    const prev = h('button', { type: 'button', class: 'tc-prev', 'data-role': 'prev', disabled: this.page === 0, onclick: () => this.go(this.page - 1) }, `← ${t('prevPage')}`);
    const target = this.mode.k === 'tutorial' ? 1 : this.mode.level;
    const next = this.last()
      ? h('button', { type: 'button', class: 'btn primary tc-next', 'data-role': 'finish', onclick: () => this.finish() }, `${t('startLevelN', { n: target })} →`)
      : h('button', { type: 'button', class: 'btn primary tc-next', 'data-role': 'next', onclick: () => this.go(this.page + 1) }, `${t('nextPage')} →`);
    const skip = this.last() ? null : h('button', { type: 'button', class: 'skip', 'data-role': 'skip', onclick: () => this.skip() }, t('skip'));
    this.controls.replaceChildren(prev, h('span', { class: 'tc-count', 'data-role': 'count' }, t('pageOf', { i: this.page + 1, n })), next, ...(skip ? [skip] : []));
  }

  // ------------------------------------------------------------ the speech bubble

  /** Restart the pop-in animation. */
  private pop(): void {
    const b = this.bubble.body;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }

  /** Every frame: ask the stage where the walker is and move the bubble there. */
  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const host = this.stageBox.getBoundingClientRect();
    const b = this.bubble;
    const size = { w: b.el.offsetWidth, h: b.el.offsetHeight };
    if (!host.width || !host.height || !size.w) return;
    // where the walker is, or was a moment ago (it vanishes into the door at the end of every walk)
    const spot = this.app.stage.walkerSpot();
    if (spot) this.seen = { spot, at: now };
    const walker = spot ?? (this.seen && now - this.seen.at < HOLD_MS ? this.seen.spot : null);
    const snap = now < this.snapUntil;
    // the walk bobs a little at every step: follow the head through a short low-pass
    // (a new shot puts the walker somewhere else at once: no gliding over there)
    if (!walker) this.smooth = null;
    else if (!this.smooth || snap || Math.hypot(walker.head.x - this.smooth.head.x, walker.head.y - this.smooth.head.y) > TELEPORT_PX) this.smooth = walker;
    else {
      const k = 1 - Math.exp(-dt * 40);
      this.smooth = { head: lerpPt(this.smooth.head, walker.head, k), feet: lerpPt(this.smooth.feet, walker.feet, k) };
    }
    // keep clear of the code card, the controls and the interactive card; rather not cover the stage's own labels
    const rel = (r: DOMRect): Box => ({ x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height });
    const over = (x: Box) => x.w > 0 && x.h > 0 && x.x < host.width && x.y < host.height && x.x + x.w > 0 && x.y + x.h > 0;
    const avoid = [this.codeBox, this.controls, this.extraBox].filter((el) => !el.hidden).map((el) => rel(el.getBoundingClientRect())).filter(over);
    const soft = this.app.stage
      .overlays()
      .map((o) => ({ ...rel(o.rect), kind: o.kind }))
      .filter(over);
    const check = this.app.stage.checkSize();
    if (check) this.check = { w: Math.max(check.w, this.check?.w ?? 0), h: Math.max(check.h, this.check?.h ?? 0) };
    const place = placeBubble({ stage: { w: host.width, h: host.height }, walker: this.smooth, size, avoid, soft, side: this.side, slot: this.slot, check: this.check });
    // a jump to the other side of the walker, to or from the fixed spot, or to a spot far away pops (gliding there
    // would sweep across the labels in between); following the walker glides
    const far = !!this.box && Math.hypot(place.box.x - this.box.x, place.box.y - this.box.y) > JUMP_PX;
    const jump = !this.box || snap || far || place.side !== this.side || place.fallback !== this.wasFallback;
    if (jump && this.box && !snap) this.pop();
    this.side = place.side;
    this.slot = place.slot;
    this.wasFallback = place.fallback;
    const k = jump ? 1 : 1 - Math.exp(-dt * 10);
    const prev = this.box ?? place.box;
    this.box = { x: lerp(prev.x, place.box.x, k), y: lerp(prev.y, place.box.y, k), w: size.w, h: size.h };
    // gliding never slides it over the code card, the controls or the card (its new place is clear of them)
    if (avoid.some((a) => overlap(this.box!, a) > 0)) this.box = { ...place.box };
    // the tip stays at the head; at the fixed spot it moves with the box
    const tip = place.fallback ? { x: place.tip.x - place.box.x + this.box.x, y: place.tip.y - place.box.y + this.box.y } : place.tip;
    const tail = tailFor(this.box, tip, place.side);
    b.el.style.transform = `translate(${this.box.x.toFixed(1)}px, ${this.box.y.toFixed(1)}px)`;
    b.shape.setAttribute('width', String(size.w));
    b.shape.setAttribute('height', String(size.h));
    b.path.setAttribute('d', bubblePath(size.w, size.h, tail));
    if (tail) b.body.style.transformOrigin = `${tail.tip.x.toFixed(0)}px ${tail.tip.y.toFixed(0)}px`;
    // for the checks (Playwright): where the head is and where the tail ends, in stage pixels
    b.el.dataset.side = place.side;
    b.el.dataset.fallback = String(place.fallback);
    b.el.dataset.head = spot ? `${spot.head.x.toFixed(1)},${spot.head.y.toFixed(1)}` : '';
    b.el.dataset.tip = tail ? `${tip.x.toFixed(1)},${tip.y.toFixed(1)}` : '';
    b.el.classList.add('placed');
  };

  // ------------------------------------------------------------ the stage

  private stopFallback(): void {
    if (this.fallback) clearTimeout(this.fallback);
    this.fallback = null;
  }

  /** Show shot i of the page (or the drawing typed in the page's input box). */
  private showShot(i: number): void {
    const p = this.current();
    const L = lang();
    this.shot = ((i % p.shots.length) + p.shots.length) % p.shots.length;
    const sh = p.shots[this.shot]!;
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
    this.app.stage.show(scene, {
      caption,
      callouts: this.custom ? undefined : sh.callouts,
      controls: pills,
      loop: true,
      sound: true,
      hud: scene.k !== 'idle' && !p.wide,
      zoom: p.wide ? 1.45 : undefined,
      drop: this.drop(),
      onBeat: (b) => this.beat(b),
    });
  }

  /** A tall stage (phones) leaves the top for the bubble; on a wide one the scene clears the floating card. */
  private drop(): number {
    const box = this.stageBox;
    if (box.clientHeight > box.clientWidth) return 0.1;
    return this.extraBox.hidden ? 0 : -0.07;
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
    // Page 7 also carries the integer rules that the level screen no longer repeats.
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
