// The tutorial mode: a menu of chapters, and a chapter player (the stage full screen, narration below).
import { ExprError } from '../core/expr.ts';
import { proofLength, parseV } from '../core/game.ts';
import { CHAPTER_LEVEL, recommendedNext } from '../core/groups.ts';
import { levelById } from '../core/levels.ts';
import { initialState } from '../core/sim.ts';
import { runScene } from '../core/stage.ts';
import { CHAPTERS, chapterByN, FIRST_CHAPTERS, HOOK, PURPOSE, tutScene, type Chapter, type TutPage } from '../core/tutorial.ts';
import type { App, Screen } from './app.ts';
import { chipBar } from './chips.ts';
import { codeView, follow, type CodeView } from './code.ts';
import { h } from './dom.ts';
import { lang, strings, t } from './i18n.ts';
import { errorText } from './errors.ts';

export class TutorialMenu implements Screen {
  el: HTMLElement;
  private app: App;

  constructor(app: App) {
    this.app = app;
    this.el = h('div', { class: 'screen menu-screen' });
    this.build();
  }

  private build(): void {
    const app = this.app;
    const L = lang();
    const done = new Set(app.saved.chapters);
    const reached = app.saved.reached ?? 0;
    const card = (c: Chapter) => {
      const at = CHAPTER_LEVEL[c.n];
      let tag: string | null = null;
      if (done.has(c.n)) tag = `✓ ${t('chDone')}`;
      else if (FIRST_CHAPTERS.includes(c.n)) tag = t('chSuggested');
      else if (at && reached >= at) tag = t('chNew');
      else if (at) tag = t('chAtLevel', { n: at });
      return h(
        'a',
        { class: `ch-card${done.has(c.n) ? ' done' : ''}${FIRST_CHAPTERS.includes(c.n) ? ' first' : ''}`, href: `#/tutorial/${c.n}`, 'data-chapter': c.n },
        h('span', { class: 'ch-num' }, String(c.n)),
        h('span', { class: 'ch-body' }, h('span', { class: 'ch-title' }, c.title[L]), h('span', { class: 'ch-summary' }, c.summary[L])),
        h('span', { class: 'ch-meta' }, tag ? h('span', { class: `ch-tag${done.has(c.n) ? ' ok' : ''}` }, tag) : null, h('span', { class: 'ch-pages' }, t('pagesN', { n: c.pages.length }))),
      );
    };
    const table = h('table', { class: 'concepts' }, h('tbody', {}, ...strings().helpConceptRows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b)))));
    this.el.replaceChildren(
      app.bar({ back: { label: t('backTitle'), href: '#/' }, title: t('tutMenuTitle') }),
      h(
        'main',
        { class: 'page' },
        h('div', { class: 'page-head' }, h('h1', {}, t('tutMenuTitle')), h('p', { class: 'lead' }, t('tutMenuIntro'))),
        h('div', { class: 'ch-list' }, ...CHAPTERS.map(card)),
        h('div', { class: 'page-actions' }, h('a', { class: 'btn primary', href: '#/tutorial/1' }, t('startCh1')), h('a', { class: 'btn ghost', href: '#/levels' }, t('menuLevels'))),
        h('section', { class: 'concept-box' }, h('h2', {}, t('helpConcepts')), table),
      ),
    );
    void L;
  }

  relang(): void {
    this.build();
  }
}

export class ChapterScreen implements Screen {
  el: HTMLElement;
  private app: App;
  private ch: Chapter;
  private page = 0;
  private stageBox = h('div', { class: 'tut-stage' });
  private codeBox = h('div', { class: 'tut-code' });
  private narr = h('section', { class: 'narration', 'aria-live': 'polite' });
  private code: CodeView | null = null;
  private tryText = '';
  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'ArrowRight') this.go(this.page + 1);
    else if (e.key === 'ArrowLeft') this.go(this.page - 1);
  };

  constructor(app: App, n: number) {
    this.app = app;
    this.ch = chapterByN(Math.min(CHAPTERS.length, Math.max(1, n)));
    this.el = h('div', { class: 'screen tut-screen' });
    this.build();
    document.addEventListener('keydown', this.onKey);
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey);
  }

  private build(): void {
    const L = lang();
    const title = h('span', {}, h('span', { class: 'bar-ch' }, t('chapterN', { n: this.ch.n })), ' ', this.ch.title[L]);
    const bar = this.app.bar({ back: { label: t('backMenu'), href: '#/tutorial' }, title, dark: true });
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
    if (i < 0 || i >= this.ch.pages.length) return;
    this.page = i;
    this.tryText = '';
    this.renderPage();
  }

  private current(): TutPage {
    return this.ch.pages[this.page]!;
  }

  private renderPage(): void {
    const p = this.current();
    const L = lang();
    // code beside the stage
    const lvl = p.code ? levelById(p.code) : null;
    this.code = lvl ? codeView(lvl) : null;
    this.codeBox.replaceChildren(...(lvl && this.code ? [h('div', { class: 'tut-code-head' }, `${t('levelN', { n: lvl.id })} · ${lvl.title[L]}`), this.code.el] : []));
    this.codeBox.hidden = !lvl;
    this.el.classList.toggle('has-code', !!lvl);
    this.showScene();

    const last = this.page === this.ch.pages.length - 1;
    const dots = h(
      'div',
      { class: 'dots', role: 'tablist' },
      ...this.ch.pages.map((_, i) =>
        h('button', { type: 'button', class: `pdot${i === this.page ? ' on' : ''}${i < this.page ? ' seen' : ''}`, 'aria-label': t('pageOf', { i: i + 1, n: this.ch.pages.length }), onclick: () => this.go(i) }),
      ),
    );
    const prev = h('button', { type: 'button', class: 'btn ghost', disabled: this.page === 0, onclick: () => this.go(this.page - 1) }, t('prevPage'));
    // The last page of a chapter leads straight on: to the next chapter, or after the last one to a level.
    const nextCh = CHAPTERS.find((c) => c.n === this.ch.n + 1);
    const next = last
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn primary',
            'data-role': 'next-chapter',
            onclick: () => this.finish(nextCh ? `#/tutorial/${nextCh.n}` : `#/level/${recommendedNext(this.app.saved.best) ?? 1}`),
          },
          nextCh ? t('nextChapterShort') : t('startPlaying'),
        )
      : h('button', { type: 'button', class: 'btn primary', 'data-role': 'next', onclick: () => this.go(this.page + 1) }, `${t('nextPage')} →`);
    const body: (Node | null)[] = [];
    if (p.extra === 'purpose') body.push(h('p', { class: 'narr-hook' }, HOOK[L]), h('p', { class: 'narr-purpose' }, PURPOSE[L]));
    body.push(h('p', { class: 'narr-text' }, p.text[L]));
    const extra = this.extra(p);
    if (extra) body.push(extra);
    this.narr.replaceChildren(
      h('div', { class: 'narr-inner' }, h('div', { class: 'narr-top' }, h('span', { class: 'narr-ch' }, `${t('chapterN', { n: this.ch.n })} · ${this.ch.title[L]}`), h('span', { class: 'narr-count' }, t('pageOf', { i: this.page + 1, n: this.ch.pages.length }))), ...body, h('div', { class: 'narr-nav' }, prev, dots, next), h('div', { class: 'narr-after' })),
    );
  }

  private showScene(override?: ReturnType<typeof tutScene>): void {
    const p = this.current();
    const scene = override ?? tutScene(p.scene);
    this.app.stage.show(scene, {
      callouts: p.callouts,
      loop: true,
      sound: true,
      hud: scene.k !== 'idle',
      onBeat: (b) => {
        if (this.code) follow(this.code, b);
      },
    });
  }

  /** The page's sandbox: type V and watch the stairs of the page's run change. */
  private tryBox(withSymbols: boolean): HTMLElement | null {
    const p = this.current();
    if (p.scene.k !== 'run') return null;
    const level = levelById(p.scene.level);
    const s0 = initialState(level, Object.fromEntries(Object.entries(p.scene.start).map(([k, v]) => [k, BigInt(v)])));
    const status = h('p', { class: 'try-status' }, t('tryVHint'));
    const input = h('input', {
      type: 'text',
      class: 'answer',
      'data-focus': 'tryV',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      placeholder: t('typeHere'),
      'aria-label': 'V',
    });
    input.value = this.tryText;
    const update = () => {
      this.tryText = input.value;
      if (!input.value.trim()) {
        status.textContent = t('tryVHint');
        status.className = 'try-status';
        this.showScene();
        return;
      }
      try {
        const V = parseV(level, input.value);
        status.textContent = t('typeOk', { len: proofLength(level, input.value, '') });
        status.className = 'try-status ok';
        this.showScene(runScene(level, s0, V, 30));
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
    const chips = chipBar({ vars: level.vars, cond: false, tuple: false, target: () => input, example: withSymbols });
    return h('div', { class: 'try' }, h('label', { class: 'try-field' }, h('span', { class: 'field-name' }, t('tryVLabel')), input), status, chips);
  }

  private extra(p: TutPage): HTMLElement | null {
    const S = strings();
    switch (p.extra) {
      case 'tryV':
        return this.tryBox(false);
      case 'chips':
        return this.tryBox(true);
      case 'symbols':
        return h(
          'div',
          { class: 'sym-grid' },
          ...[
            ['+ − *', '3*n − 1'],
            ['/ %', 'n / 2, n % 3'],
            ['( )', '(a + b) * 2'],
            ['abs(e)', 'abs(x)'],
            ['min(e, e)', 'min(a, b)'],
            ['max(e, e)', 'max(a, b) − 1'],
            ['2*n ✓', '2n ✗'],
          ].map(([a, b]) => h('div', { class: 'sym' }, h('code', { class: 'sym-key' }, a!), h('code', { class: 'sym-ex' }, b!))),
        );
      case 'divmod':
        return h('table', { class: 'divmod' }, h('tbody', {}, ...S.divmodRows.map(([a, b]) => h('tr', {}, h('td', {}, h('code', {}, a)), h('td', {}, h('code', {}, b))))));
      case 'length':
        return h('p', { class: 'narr-note' }, t('lengthExample'));
      case 'verdicts':
        return h(
          'div',
          { class: 'verdict-demo' },
          h('span', { class: 'verdict v-ends demo' }, t('verdictEnds')),
          h('span', { class: 'verdict v-never demo' }, t('verdictNever')),
          h('span', { class: 'verdict v-nobody demo' }, t('verdictNobody')),
        );
      case 'stars':
        return h('div', { class: 'stars-demo' }, h('span', {}, '★☆☆'), h('span', {}, '★★☆'), h('span', {}, '★★★'));
      case 'daily':
        return h('p', { class: 'narr-note' }, h('code', {}, t('dailyExample')));
      default:
        return null;
    }
  }

  private finish(target: string): void {
    const app = this.app;
    if (!app.saved.chapters.includes(this.ch.n)) app.saved.chapters.push(this.ch.n);
    app.persist();
    location.hash = target;
  }

}
