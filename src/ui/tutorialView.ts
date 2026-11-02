// The tutorial player: the stage full screen, narration below with Back / Next, a page counter and Skip.
// The same player shows the 8-page tutorial and the short intros before levels 9 and 10.
import { ExprError } from '../core/expr.ts';
import { proofLength, parseV } from '../core/game.ts';
import { codePreview, recommendedNext } from '../core/groups.ts';
import { levelById } from '../core/levels.ts';
import { runScene, type StageScene } from '../core/stage.ts';
import { introFor, program, richParts, sceneStart, TUTORIAL, tutScene, type TutPage } from '../core/tutorial.ts';
import type { App, Screen } from './app.ts';
import { chipBar } from './chips.ts';
import { codeView, follow, type CodeView } from './code.ts';
import { h } from './dom.ts';
import { errorText } from './errors.ts';
import { pretty, starsText } from './format.ts';
import { lang, t } from './i18n.ts';
import type { PlayInfo } from './stageTypes.ts';

export type TutorialMode = { k: 'tutorial' } | { k: 'intro'; level: number; returnTo: string };

/** If the stage sends no beats (the flat drawing), multi-shot pages move on after this long. */
const FALLBACK_MS = 6500;

export class TutorialScreen implements Screen {
  el: HTMLElement;
  private app: App;
  private mode: TutorialMode;
  private pages: TutPage[];
  private page: number;
  private shot = 0;
  private stageBox = h('div', { class: 'tut-stage' });
  private codeBox = h('div', { class: 'tut-code' });
  private narr = h('section', { class: 'narration', 'aria-live': 'polite' });
  private code: CodeView | null = null;
  private tryText = '';
  /** The drawing from the page's input box (null: the page's own shots). */
  private custom: { scene: StageScene; caption: string } | null = null;
  private beatSeen = false;
  private fallback: ReturnType<typeof setTimeout> | null = null;
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
  }

  private title(): string {
    if (this.mode.k === 'tutorial') return t('tutTitle');
    const intro = introFor(this.mode.level)!;
    return `${t('introTag', { n: this.mode.level })} · ${intro.title[lang()]}`;
  }

  private build(): void {
    const back = this.mode.k === 'tutorial' ? { label: t('backTitle'), href: '#/' } : { label: t('levelN', { n: this.mode.level }), href: this.mode.returnTo };
    const bar = this.app.bar({ back, title: this.title(), dark: true });
    this.el.replaceChildren(bar, h('div', { class: 'tut-main' }, this.stageBox, this.codeBox), this.narr);
  }

  shown(): void {
    this.app.stage.mount(this.stageBox);
    this.renderPage();
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
    this.showShot(0);

    const n = this.pages.length;
    const dots = h(
      'div',
      { class: 'dots', role: 'tablist' },
      ...this.pages.map((_, i) =>
        h('button', { type: 'button', class: `pdot${i === this.page ? ' on' : ''}${i < this.page ? ' seen' : ''}`, 'aria-label': t('pageOf', { i: i + 1, n }), onclick: () => this.go(i) }),
      ),
    );
    const prev = h('button', { type: 'button', class: 'btn ghost', 'data-role': 'prev', disabled: this.page === 0, onclick: () => this.go(this.page - 1) }, t('prevPage'));
    const target = this.mode.k === 'tutorial' ? 1 : this.mode.level;
    const next = this.last()
      ? h('button', { type: 'button', class: 'btn primary', 'data-role': 'finish', onclick: () => this.finish() }, `${t('startLevelN', { n: target })} →`)
      : h('button', { type: 'button', class: 'btn primary', 'data-role': 'next', onclick: () => this.go(this.page + 1) }, `${t('nextPage')} →`);
    const skip = this.last() ? null : h('button', { type: 'button', class: 'skip', 'data-role': 'skip', onclick: () => this.skip() }, t('skip'));
    const body: (Node | null)[] = [h('p', { class: 'narr-text' }, ...richParts(p.text[L]).map((part) => (part.kind === 'bold' ? h('strong', {}, part.s) : part.kind === 'code' ? h('code', {}, part.s) : part.s)))];
    body.push(this.extra(p));
    this.narr.replaceChildren(
      h(
        'div',
        { class: 'narr-inner' },
        h('div', { class: 'narr-top' }, h('span', { class: 'narr-ch' }, this.title()), h('span', { class: 'narr-right' }, h('span', { class: 'narr-count', 'data-role': 'count' }, t('pageOf', { i: this.page + 1, n })), skip)),
        ...body.filter((x): x is Node => x !== null),
        h('div', { class: 'narr-nav' }, prev, dots, next),
      ),
    );
  }

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
    for (const b of this.narr.querySelectorAll<HTMLElement>('[data-hl-shot]')) b.classList.toggle('hl', Number(b.dataset.hlShot) === this.shot);
    this.app.stage.show(scene, {
      caption,
      callouts: this.custom ? undefined : sh.callouts,
      controls: pills,
      loop: true,
      sound: true,
      hud: scene.k !== 'idle' && !p.wide,
      zoom: p.wide ? 1.45 : undefined,
      onBeat: (b) => this.beat(b),
    });
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
    return h('div', { class: 'try' }, field, status, chips, withChips ? h('p', { class: 'narr-note int-note' }, t('intDomain')) : null);
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
