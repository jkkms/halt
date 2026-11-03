// Rush mode (SPEC_rush): one short loop at a time, 15 seconds each, 3 lives. The verdict only, no proof.
//   #/rush            the start panel: today's rush or practice, the rules, the best scores
//   #/rush/today      today's rush (the same card order for everyone on that UTC date)
//   #/rush/practice   practice (a random order)
// After an answer: ✔/✘, the right verdict and the card's one-line reason, while the walker runs the card's first
// sample on the stage. During the question the stage stays behind a curtain, so it never gives the answer away.
import { utcDateKey } from '../core/game.ts';
import {
  answerCard,
  CLEAR_BONUS,
  dailyRushOrder,
  formatScore,
  isLast,
  nextCard,
  rightCount,
  RUSH_LIVES,
  RUSH_SECONDS,
  rushMarks,
  rushOrder,
  rushScene,
  rushShareText,
  rushStart,
  startRush,
  streakMultiplier,
  type RushState,
} from '../core/rush.ts';
import { rushCardById, type RushCard, type RushVerdict } from '../core/rushCards.ts';
import { sceneBase } from '../core/stage.ts';
import { richParts } from '../core/tutorial.ts';
import { logoMark, type App, type Screen } from './app.ts';
import { sfx } from './audio.ts';
import { codeView, follow, type CodeView } from './code.ts';
import { h } from './dom.ts';
import { pretty, state as fmtState } from './format.ts';
import { lang, t } from './i18n.ts';
import { copyText } from './level.ts';
import { recordRush } from './store.ts';

export type RushMode = 'today' | 'practice';

/** The next card comes by itself after this long (a little longer after a miss, to read the reason). */
const AUTO_NEXT_MS = 3000;
const AUTO_NEXT_MISS_MS = 4500;
/** The last seconds of a card: the timer turns red. */
const LOW_SECONDS = 5;

const verdictLabel = (v: RushVerdict) => t(v === 'ends' ? 'verdictEnds' : 'verdictNever');

function rich(text: string): (Node | string)[] {
  return richParts(text).map((p) => (p.kind === 'code' ? h('code', {}, p.s) : p.kind === 'bold' ? h('strong', {}, p.s) : p.s));
}

function randomSeed(): string {
  try {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return `practice:${a[0]}:${a[1]}`;
  } catch {
    return `practice:${Math.random()}:${Date.now()}`;
  }
}

export class RushScreen implements Screen {
  el: HTMLElement;
  private app: App;
  private mode: RushMode | null;
  /** The UTC date the run started on (today's rush keeps it even past midnight). */
  private day = utcDateKey(new Date());
  private st: RushState | null = null;
  /** performance.now() when the current card's time runs out. */
  private deadline = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;
  private newBest = false;
  private stageBox = h('div', { class: 'rush-stage' });
  private curtainText = h('p', {});
  private curtain = h('div', { class: 'rush-curtain' }, logoMark('logo rush-curtain-mark'), this.curtainText);
  private timerFill = h('span', { class: 'rush-timer-fill' });
  private timerText = h('span', { class: 'rush-timer-text', role: 'timer' });
  private timerBar = h('div', { class: 'rush-timer', 'aria-hidden': 'true' }, this.timerFill);
  private code: CodeView | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(app: App, mode: RushMode | null) {
    this.app = app;
    this.mode = mode;
    this.el = h('div', { class: 'screen rush-screen' });
    if (mode) this.st = startRush(mode === 'today' ? dailyRushOrder(this.day) : rushOrder(randomSeed()));
    this.build();
  }

  private card(): RushCard {
    return rushCardById(this.st!.order[this.st!.index]!);
  }

  // ------------------------------------------------------------ screens

  private build(): void {
    if (!this.mode || !this.st) return this.buildStart();
    const title = this.mode === 'today' ? t('rushBarToday', { date: this.day }) : t('rushBarPractice');
    const bar = this.app.bar({ back: { label: t('rushBack'), href: '#/rush' }, title });
    if (this.st.phase === 'over') {
      this.el.replaceChildren(bar, h('main', { class: 'rush-main' }, this.endPanel()));
      return;
    }
    this.el.replaceChildren(
      bar,
      h(
        'main',
        { class: 'rush-main' },
        this.hud(),
        h('div', { class: 'rush-timer-row' }, this.timerBar, this.timerText),
        this.cardView(),
        this.st.phase === 'question' ? this.questionView() : this.feedbackView(),
        h('section', { class: 'rush-stage-wrap' }, this.stageBox, this.curtain),
      ),
    );
    this.paintTimer();
  }

  private buildStart(): void {
    const rec = this.app.saved.rush;
    const today = rec.daily[this.day];
    const bests = [today !== undefined ? t('rushBestToday', { score: formatScore(today) }) : null, rec.practiceBest ? t('rushBestPractice', { score: formatScore(rec.practiceBest) }) : null].filter(
      (x): x is string => x !== null,
    );
    const btn = (label: string, sub: string, href: string, cls: string, role: string) =>
      h('a', { class: `menu-btn ${cls}`, href, 'data-role': role }, h('span', { class: 'menu-label' }, label), h('span', { class: 'menu-sub' }, sub));
    this.el.replaceChildren(
      this.app.bar({ back: { label: t('backTitle'), href: '#/' }, title: t('menuRush') }),
      h(
        'main',
        { class: 'rush-main' },
        h(
          'section',
          { class: 'rush-panel rush-start' },
          h('h1', { class: 'rush-title' }, t('rushTitle')),
          h('p', { class: 'rush-lead' }, t('rushLead')),
          h('ul', { class: 'rush-rules' }, h('li', {}, t('rushRule1')), h('li', {}, t('rushRule2')), h('li', {}, t('rushRule3'))),
          h('nav', { class: 'menu rush-modes', 'aria-label': t('menuRush') }, btn(t('rushToday'), t('rushTodaySub', { date: this.day }), '#/rush/today', 'primary', 'rush-today'), btn(t('rushPractice'), t('rushPracticeSub'), '#/rush/practice', '', 'rush-practice')),
          h('p', { class: 'rush-bests', 'data-role': 'rush-bests' }, bests.length ? bests.join(' · ') : t('rushNoBest')),
        ),
      ),
    );
  }

  private hud(): HTMLElement {
    const st = this.st!;
    const lives = Array.from({ length: RUSH_LIVES }, (_, i) => h('span', { class: `life${i < st.lives ? ' on' : ''}` }));
    const mult = streakMultiplier(Math.max(1, st.streak));
    return h(
      'div',
      { class: 'rush-hud' },
      h('span', { class: 'rush-score' }, h('small', {}, t('rushScore')), ' ', h('b', { 'data-role': 'score' }, formatScore(st.score))),
      h('span', { class: 'rush-lives', role: 'img', 'aria-label': t('rushLivesLabel', { n: st.lives }), 'data-lives': st.lives }, ...lives),
      h('span', { class: `rush-streak${st.streak >= 2 ? ' hot' : ''}`, 'data-role': 'streak' }, t('rushStreak', { n: st.streak }), st.streak >= 2 ? ` · ×${mult}` : ''),
      h('span', { class: 'rush-count', 'data-role': 'count' }, t('rushCardN', { i: st.index + 1, n: st.order.length })),
    );
  }

  private cardView(): HTMLElement {
    const c = this.card();
    const cond = c.start === 'true' ? t('anyIntegers') : h('code', {}, pretty(c.startText ?? c.start));
    return h(
      'article',
      { class: 'rush-card', 'data-card': c.id, 'data-index': this.st!.index },
      h('div', { class: 'rush-code-wrap' }, (this.code = codeView(c)).el),
      h('p', { class: 'rush-inputs' }, h('span', { class: 'meta-key' }, `${t('inputs')}:`), ' ', h('code', {}, c.inputs.join(', ')), ' (', cond, ')'),
    );
  }

  private questionView(): HTMLElement {
    const mk = (v: RushVerdict, key: string) =>
      h(
        'button',
        { type: 'button', class: `verdict rush-verdict v-${v}`, 'data-verdict': v, title: t(v === 'ends' ? 'verdictEndsTip' : 'verdictNeverTip'), onclick: () => this.answer(v) },
        h('span', {}, verdictLabel(v)),
        h('kbd', { 'aria-hidden': 'true' }, key),
      );
    return h(
      'div',
      { class: 'rush-answer' },
      h('p', { class: 'rush-q' }, t('rushQuestion'), h('small', {}, t('rushKeyHint'))),
      h('div', { class: 'rush-verdicts', role: 'group', 'aria-label': t('rushQuestion') }, mk('ends', '←'), mk('never', '→')),
    );
  }

  private feedbackView(): HTMLElement {
    const st = this.st!;
    const a = st.answers.at(-1)!;
    const c = rushCardById(a.card);
    const head = a.right ? t('rushRight') : a.given === null ? t('rushTimeout') : t('rushWrong');
    const last = isLast(st);
    const auto = h('span', { class: 'rush-auto', 'aria-hidden': 'true' });
    const next = h('button', { type: 'button', class: 'btn primary rush-next', 'data-role': 'next', onclick: () => this.next() }, last ? t('rushToEnd') : t('rushNext'), h('kbd', { 'aria-hidden': 'true' }, 'Enter'), auto);
    return h(
      'div',
      { class: `rush-feedback ${a.right ? 'right' : 'wrong'}`, 'data-result': a.right ? 'right' : a.given === null ? 'timeout' : 'wrong', 'aria-live': 'polite' },
      h(
        'p',
        { class: 'rush-result' },
        h('span', { class: 'rush-mark', 'aria-hidden': 'true' }, a.right ? '✔' : '✘'),
        h('strong', {}, head),
        a.right ? h('span', { class: 'rush-pts' }, t('rushPoints', { n: formatScore(a.points) })) : null,
        h('span', { class: 'rush-truth' }, t('rushAnswerIs', { verdict: verdictLabel(c.verdict) })),
      ),
      h('p', { class: 'rush-why', 'data-role': 'why' }, ...rich(c.why[lang()])),
      h('div', { class: 'rush-next-row' }, next),
    );
  }

  private endPanel(): HTMLElement {
    const st = this.st!;
    const rec = this.app.saved.rush;
    const best = this.mode === 'today' ? (rec.daily[this.day] ?? st.score) : rec.practiceBest;
    const kids: (Node | null)[] = [
      h('h1', { class: 'rush-title' }, st.cleared ? t('rushClearTitle') : t('rushOverTitle')),
      h('p', { class: 'rush-final', 'data-role': 'final-score' }, t('rushPointsTotal', { score: formatScore(st.score) })),
      st.cleared ? h('p', { class: 'rush-bonus' }, t('rushClearBonus', { n: CLEAR_BONUS })) : null,
      h('p', { class: 'rush-stats' }, t('rushRightCount', { n: rightCount(st), total: st.order.length }), ' · ', t('rushBestStreak', { n: st.bestStreak })),
      h('p', { class: `rush-best${this.newBest ? ' new' : ''}`, 'data-role': 'best' }, this.newBest ? t('rushNewBest') : t('rushBestIs', { score: formatScore(best) })),
    ];
    if (this.mode === 'today') {
      const text = rushShareText(lang(), this.day, st.score, rushMarks(st));
      const status = h('span', { class: 'copy-status', 'aria-live': 'polite' });
      kids.push(
        h('p', { class: 'rush-share' }, h('code', { 'data-role': 'share' }, text)),
        h(
          'div',
          { class: 'rush-copy' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              onclick: async () => {
                const ok = await copyText(text);
                status.textContent = ok ? t('copied') : `${t('copyFailed')} ${text}`;
              },
            },
            t('copyResult'),
          ),
          status,
        ),
      );
    }
    kids.push(
      h(
        'div',
        { class: 'rush-end-actions' },
        h('button', { type: 'button', class: 'btn primary', 'data-role': 'again', onclick: () => this.again() }, t('rushAgain')),
        h('a', { class: 'btn ghost', href: '#/', 'data-role': 'home' }, t('backTitle')),
      ),
    );
    return h('section', { class: 'rush-panel rush-end', 'data-role': 'rush-end', tabindex: -1 }, ...kids);
  }

  // ------------------------------------------------------------ the run

  shown(): void {
    document.addEventListener('keydown', this.onKey);
    if (!this.st || this.st.phase === 'over') return;
    this.app.stage.mount(this.stageBox);
    if (this.st.phase === 'question') this.ask();
    else this.showRun();
  }

  /** Start the clock of the current card and hide the stage behind the curtain. */
  private ask(): void {
    this.deadline = performance.now() + RUSH_SECONDS * 1000;
    this.curtained(true);
    this.app.stage.show({ ...sceneBase(this.card()), k: 'idle' }, { hud: false, loop: false });
    this.stopTimers();
    this.tickTimer = setInterval(() => this.tick(), 100);
    this.paintTimer();
  }

  /** During the question the stage is hidden: what it would draw is the answer. */
  private curtained(on: boolean): void {
    this.curtain.hidden = !on;
    this.curtainText.textContent = t('rushCurtain');
    this.stageBox.classList.toggle('hidden-run', on);
  }

  private secondsLeft(): number {
    return Math.max(0, (this.deadline - performance.now()) / 1000);
  }

  private tick(): void {
    if (!this.st || this.st.phase !== 'question') return;
    if (this.secondsLeft() <= 0) this.answer(null);
    else this.paintTimer();
  }

  private paintTimer(): void {
    if (!this.st) return;
    const left = this.st.phase === 'question' ? this.secondsLeft() : 0;
    const frac = this.st.phase === 'question' ? left / RUSH_SECONDS : 0;
    this.timerFill.style.transform = `scaleX(${frac.toFixed(4)})`;
    this.timerBar.classList.toggle('low', this.st.phase === 'question' && left <= LOW_SECONDS);
    this.timerText.textContent = this.st.phase === 'question' ? t('rushSecondsLeft', { n: Math.ceil(left) }) : '';
  }

  /** `given` null: the time ran out. `byKey`: answered with the keyboard (the next button then takes the focus). */
  private answer(given: RushVerdict | null, byKey = false): void {
    if (!this.st || this.st.phase !== 'question') return;
    const left = given === null ? 0 : this.secondsLeft();
    this.st = answerCard(this.st, given, left, this.card().verdict);
    this.stopTimers();
    const right = this.st.answers.at(-1)!.right;
    if (right) sfx.solve();
    else sfx.fail();
    this.build();
    this.showRun();
    if (byKey) this.el.querySelector<HTMLButtonElement>('[data-role="next"]')?.focus({ preventScroll: true });
    const ms = right ? AUTO_NEXT_MS : AUTO_NEXT_MISS_MS;
    const bar = this.el.querySelector<HTMLElement>('.rush-auto');
    if (bar) {
      bar.style.transitionDuration = `${ms}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add('go')));
    }
    this.autoTimer = setTimeout(() => this.next(), ms);
  }

  /** The walker runs the first sample of the card just answered. */
  private showRun(): void {
    const st = this.st!;
    const c = rushCardById(st.answers.at(-1)!.card);
    const sc = rushScene(c);
    const s0 = fmtState(c.vars, rushStart(c)).replace(/-/g, '−');
    const how = sc.k === 'stairs' ? t('sceneEnded', { k: sc.stairs.length - 1 }) : sc.k === 'ring' ? t('sceneRing') : t('sceneShaft');
    this.curtained(false);
    // While the walker runs, the code lights up the line that runs (as in the levels).
    const view = this.code;
    this.app.stage.show(sc, { caption: `${t('sceneSample', { s0 })} · ${how}`, badge: sc.k === 'stairs' ? '✓' : '∞', loop: true, onBeat: (b) => view && follow(view, b) });
  }

  private next(): void {
    if (!this.st || this.st.phase !== 'feedback') return;
    this.stopTimers();
    this.st = nextCard(this.st);
    if (this.st.phase === 'over') {
      this.newBest = recordRush(this.app.saved.rush, this.mode === 'today' ? this.day : null, this.st.score);
      this.app.persist();
      this.build();
      // The result takes the focus, not "Again": an Enter still held from the last card must not start over.
      this.el.querySelector<HTMLElement>('[data-role="rush-end"]')?.focus({ preventScroll: true });
      return;
    }
    // Nothing keeps the focus: an Enter held down must not answer the next card.
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.build();
    this.ask();
  }

  private again(): void {
    this.stopTimers();
    this.st = startRush(this.mode === 'today' ? dailyRushOrder(this.day) : rushOrder(randomSeed()));
    this.newBest = false;
    this.build();
    this.app.stage.mount(this.stageBox);
    this.ask();
  }

  private key(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || !this.st || document.querySelector('.modal-overlay')) return;
    if (this.st.phase === 'question') {
      const v: RushVerdict | null = e.key === 'ArrowLeft' || e.key === '1' ? 'ends' : e.key === 'ArrowRight' || e.key === '2' ? 'never' : null;
      if (v) {
        e.preventDefault();
        this.answer(v, true);
      }
    } else if (this.st.phase === 'feedback' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this.next();
    }
  }

  private stopTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.tickTimer = null;
    this.autoTimer = null;
  }

  destroy(): void {
    this.stopTimers();
    document.removeEventListener('keydown', this.onKey);
  }

  relang(): void {
    this.build();
    if (!this.st || this.st.phase === 'over') return;
    this.app.stage.mount(this.stageBox);
    if (this.st.phase === 'question') {
      this.curtained(true);
      this.paintTimer();
    } else this.showRun();
  }
}
