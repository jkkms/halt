// Rush mode (SPEC_rush, SPEC_rush2): short loops one at a time, 5 seconds each, 3 lives, endless.
//   #/rush            the start screen: what rush is and how a run goes, the nickname, the buttons, the hall of fame
//   #/rush/play       a ranked run (needs a nickname; the score server recomputes and ranks it)
//   #/rush/practice   a practice run (never talks to the server)
// After an answer: ✔/✘, the right verdict and the card's one-line reason, while the walker runs the card's first
// sample on the stage. During the question the stage stays behind a curtain, so it never gives the answer away.
// Keys: ← / → (or 1 / 2) answer, ↓ goes to the next card. Enter and Space do not.
import { varsOf } from '../core/expr.ts';
import { checkNick, nickKey, type NickProblem } from '../core/nick.ts';
import {
  addSeen,
  answerCard,
  cryptoRand,
  currentCard,
  formatScore,
  isLast,
  nextCard,
  pickCard,
  rightCount,
  RUSH_LIVES,
  RUSH_MS,
  rushScene,
  rushShareText,
  rushStart,
  startRush,
  streakMultiplier,
  submittedAnswers,
  type RushState,
} from '../core/rush.ts';
import { rushCardById, type RushCard, type RushVerdict } from '../core/rushCards.ts';
import { sceneBase } from '../core/stage.ts';
import { richParts, TUTORIAL } from '../core/tutorial.ts';
import { logoMark, type App, type Screen } from './app.ts';
import { sfx } from './audio.ts';
import { codeView, follow, type CodeView } from './code.ts';
import { h } from './dom.ts';
import { narrationNodes } from './guide.ts';
import { pretty, state as fmtState } from './format.ts';
import { lang, t, type Key } from './i18n.ts';
import { copyText } from './level.ts';
import { scores, newToken, type FameRow, type FinishResult } from './scores.ts';
import { recordRush } from './store.ts';

export type RushMode = 'play' | 'practice';

/** The last seconds of a card: the timer turns red. */
const LOW_MS = 2000;
/** Rows of the hall of fame shown at first, and after "show more". */
const FAME_FIRST = 20;
const FAME_ALL = 50;

const verdictLabel = (v: RushVerdict) => t(v === 'ends' ? 'verdictEnds' : 'verdictNever');

function rich(text: string): (Node | string)[] {
  // SPEC_v0.7 §B: a `\n` starts a new line (the markup works on every line)
  const lines = text.split('\n');
  const inline = (line: string) => richParts(line).map((p) => (p.kind === 'code' ? h('code', {}, p.s) : p.kind === 'bold' ? h('strong', {}, p.s) : p.s));
  return lines.length > 1 ? lines.map((line) => h('span', { class: 'nl' }, ...inline(line))) : inline(text);
}

/** The tutorial page of the verdict ("Step 1 · Verdict"), found by its content so it survives tutorial edits. */
function verdictPage(): string {
  const i = TUTORIAL.findIndex((p) => p.extra === 'verdicts');
  return i >= 0 ? `#/tutorial/${i + 1}` : '#/tutorial';
}

/**
 * The input condition as one big line: "Input  x ≥ 0", "Input  x: any integer", or for several inputs
 * "Input  d ≥ 1 · s, t: any integers". Amber when the input is restricted, neutral when anything goes.
 */
export function inputBanner(c: RushCard): HTMLElement {
  const any = c.start === 'true';
  const named = varsOf(c.startExpr);
  const free = c.inputs.filter((v) => !named.has(v));
  const math = (s: string) => h('span', { class: 'rush-input-math' }, s.replace(/-(\d)/g, '−$1'));
  // "x: any integer": the variables in code type, the words in the text type
  const anyPart = (vs: string[]) => [math(`${vs.join(', ')}:`), ' ', h('span', { class: 'rush-input-words' }, t(vs.length > 1 ? 'rushAnyInts' : 'rushAnyInt'))];
  const cond = pretty(c.startText ?? c.start).replace(/\s*&&\s*/g, ', ');
  const value: (Node | string)[] = any ? anyPart(c.inputs) : free.length ? [math(cond), h('span', { class: 'rush-input-sep' }, '\u2002·\u2002'), ...anyPart(free)] : [math(cond)];
  return h(
    'p',
    { class: `rush-input ${any ? 'any' : 'restricted'}`, 'data-role': 'input-banner' },
    h('span', { class: 'rush-input-key' }, t('rushInput')),
    h('span', { class: 'rush-input-val' }, ...value),
  );
}

/** The card: the code big and centred, the input banner under it. */
export function rushCardView(c: RushCard, index: number): { el: HTMLElement; code: CodeView } {
  const code = codeView(c);
  const el = h('article', { class: 'rush-card', 'data-card': c.id, 'data-index': index }, h('div', { class: 'rush-code-wrap' }, code.el), inputBanner(c));
  return { el, code };
}

/** A ranked run on the server: its id from /run/start, or why there is none. */
interface RankedRun {
  runId: string | null;
  starting: Promise<void> | null;
  refused: string | null;
}

type Submit = { k: 'idle' } | { k: 'sending' } | { k: 'done'; r: FinishResult } | { k: 'offline' } | { k: 'refused'; reason: string };

export class RushScreen implements Screen {
  el: HTMLElement;
  private app: App;
  private mode: RushMode | null;
  private st: RushState | null = null;
  /** performance.now() when the current card was shown and when its time runs out. */
  private askedAt = 0;
  private deadline = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private newBest = false;
  private ranked: RankedRun | null = null;
  private submit: Submit = { k: 'idle' };
  /** The start screen: the nickname form is open, and the message under it. */
  private nickOpen = false;
  private nickMsg: string | null = null;
  private nickBusy = false;
  private fame: { k: 'loading' } | { k: 'ok'; rows: FameRow[] } | { k: 'offline' } = { k: 'loading' };
  private fameAll = false;
  private aboutOpen = false;
  private me: { best: number; rank: number | null } | null = null;
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
    if (mode === 'play' && !app.saved.rush.nick) {
      // a ranked run needs a nickname: ask for it on the start screen first
      this.mode = null;
      this.nickOpen = true;
      this.nickMsg = t('rushNickNeeded');
      history.replaceState(null, '', '#/rush');
    }
    if (this.mode) this.begin();
    this.build();
  }

  private get rec() {
    return this.app.saved.rush;
  }

  private token(): string {
    if (!this.rec.token) {
      this.rec.token = newToken();
      this.app.persist();
    }
    return this.rec.token;
  }

  private card(): RushCard {
    return rushCardById(currentCard(this.st!));
  }

  private pick(position: number, run: number[]): number {
    return pickCard({ position, run, seen: this.rec.seen, rand: cryptoRand });
  }

  /** A new run: the first card, and for a ranked run its /run/start. */
  private begin(): void {
    this.st = startRush(this.pick(1, []));
    this.newBest = false;
    this.submit = { k: 'idle' };
    this.ranked = null;
    if (this.mode === 'play') {
      this.ranked = { runId: null, starting: null, refused: null };
      void this.ensureStarted();
    }
  }

  /** Ask the server for a run id (again, if the last try could not reach it). */
  private ensureStarted(): Promise<void> {
    const r = this.ranked;
    if (!r || r.runId || r.refused) return Promise.resolve();
    if (r.starting) return r.starting;
    r.starting = scores.start(this.token(), this.rec.nick ?? '').then((res) => {
      r.starting = null;
      if (res.ok) r.runId = res.data.runId;
      else if (res.status !== 0) r.refused = res.error;
    });
    return r.starting;
  }

  // ------------------------------------------------------------ screens

  private build(): void {
    if (!this.mode || !this.st) return this.buildStart();
    const title = this.mode === 'play' ? t('rushBarPlay') : t('rushBarPractice');
    const bar = this.app.bar({ back: { label: t('rushBack'), href: '#/rush' }, title });
    if (this.st.phase === 'over') {
      this.el.replaceChildren(bar, h('main', { class: 'rush-main' }, this.endPanel()));
      return;
    }
    const view = rushCardView(this.card(), this.st.cards.length - 1);
    this.code = view.code;
    this.el.replaceChildren(
      bar,
      h(
        'main',
        { class: 'rush-main rush-run' },
        this.hud(),
        h('div', { class: 'rush-timer-row' }, this.timerBar, this.timerText),
        view.el,
        this.st.phase === 'question' ? this.questionView() : this.feedbackView(),
        h('section', { class: 'rush-stage-wrap' }, this.stageBox, this.curtain),
      ),
    );
    this.paintTimer();
  }

  // ---------------- the start screen

  private buildStart(): void {
    const about = (head: Key, ...body: (Node | string)[]) => h('section', { class: 'rush-about-item' }, h('h2', {}, t(head)), ...body);
    const steps = (['rushStep1', 'rushStep2', 'rushStep3', 'rushStep4', 'rushStep5'] as const).map((k) => h('li', {}, t(k)));
    const play = h(
      'a',
      { class: 'menu-btn primary', href: '#/rush/play', 'data-role': 'rush-play', onclick: (e: Event) => this.playClicked(e) },
      h('span', { class: 'menu-label' }, t('rushPlay')),
      h('span', { class: 'menu-sub' }, t('rushPlaySub')),
    );
    const practice = h('a', { class: 'menu-btn', href: '#/rush/practice', 'data-role': 'rush-practice' }, h('span', { class: 'menu-label' }, t('rushPractice')), h('span', { class: 'menu-sub' }, t('rushPracticeSub')));
    this.el.replaceChildren(
      this.app.bar({ back: { label: t('backTitle'), href: '#/' }, title: t('menuRush') }),
      h(
        'main',
        { class: 'rush-main rush-start-main' },
        h('h1', { class: 'rush-title' }, t('rushTitle')),
        this.aboutBox(
          h(
            'div',
            { class: 'rush-about', 'data-role': 'rush-about' },
            // each text in short paragraphs and lines (SPEC_v0.7 §B)
            about('rushAboutWhatH', ...narrationNodes(t('rushAboutWhat'))),
            about('rushAboutRunH', h('ol', { class: 'rush-steps' }, ...steps)),
            about('rushAboutRuleH', ...narrationNodes(t('rushAboutRule'))),
            about('rushAboutTiersH', ...narrationNodes(t('rushAboutTiers'))),
            about('rushAboutScoreH', ...narrationNodes(t('rushAboutScore'))),
            about('rushAboutFameH', ...narrationNodes(t('rushAboutFame'))),
          ),
        ),
        h('p', { class: 'rush-tut-link' }, h('a', { href: verdictPage(), 'data-role': 'rush-tutorial' }, t('rushTutorialLink'), ' →')),
        h('section', { class: 'rush-panel rush-actions' }, this.nickView(), h('nav', { class: 'menu rush-modes', 'aria-label': t('menuRush') }, play, practice), this.bestsView()),
        this.fame.k === 'offline' ? null : this.fameView(null),
      ),
    );
  }

  /**
   * The explanation is open until this device has answered a rush card; after that it folds into one line (still
   * before the buttons), so a returning player reaches "Start rush" without scrolling past it on a phone.
   */
  private aboutBox(grid: HTMLElement): HTMLElement {
    if (!this.rec.seen.length) return grid;
    const box = h('details', { class: 'rush-about-box', 'data-role': 'rush-about-box' }, h('summary', {}, t('rushAboutShow')), grid) as HTMLDetailsElement;
    box.open = this.aboutOpen;
    box.addEventListener('toggle', () => (this.aboutOpen = box.open));
    return box;
  }

  private playClicked(e: Event): void {
    if (this.rec.nick) return;
    e.preventDefault();
    this.nickOpen = true;
    this.nickMsg = t('rushNickNeeded');
    this.build();
    this.el.querySelector<HTMLInputElement>('[data-role="nick-input"]')?.focus();
  }

  private nickView(): HTMLElement {
    const nick = this.rec.nick;
    if (nick && !this.nickOpen) {
      return h(
        'p',
        { class: 'rush-nick', 'data-role': 'nick' },
        h('span', { class: 'rush-nick-key' }, t('rushNickIs')),
        h('strong', { 'data-role': 'nick-name' }, nick),
        h(
          'button',
          {
            type: 'button',
            class: 'btn small rush-nick-change',
            'data-role': 'nick-change',
            onclick: () => {
              this.nickOpen = true;
              this.nickMsg = null;
              this.build();
              this.el.querySelector<HTMLInputElement>('[data-role="nick-input"]')?.focus();
            },
          },
          t('rushNickChange'),
        ),
      );
    }
    const input = h('input', {
      type: 'text',
      class: 'rush-nick-input',
      'data-role': 'nick-input',
      maxlength: 24,
      autocomplete: 'nickname',
      spellcheck: 'false',
      'aria-describedby': 'rush-nick-msg',
    }) as HTMLInputElement;
    input.value = nick ?? '';
    const warn = this.nickMsg !== null;
    const msg = h('p', { class: `rush-nick-msg${warn ? ' warn' : ''}`, id: 'rush-nick-msg', 'data-role': 'nick-msg', 'aria-live': 'polite' }, this.nickMsg ?? t('rushNickHint'));
    const save = h('button', { type: 'submit', class: 'btn primary small', 'data-role': 'nick-save' }, t('rushNickSave')) as HTMLButtonElement;
    save.disabled = this.nickBusy;
    const form = h(
      'form',
      {
        class: 'rush-nick-form',
        'data-role': 'nick-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          void this.saveNick(input.value);
        },
      },
      h('label', { class: 'rush-nick-label' }, h('span', {}, t('rushNickLabel')), input),
      save,
      nick
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn ghost small',
              onclick: () => {
                this.nickOpen = false;
                this.nickMsg = null;
                this.build();
              },
            },
            t('rushNickCancel'),
          )
        : null,
    );
    return h('div', { class: 'rush-nick-box' }, form, msg);
  }

  private async saveNick(raw: string): Promise<void> {
    const n = checkNick(raw);
    if (!n.ok) {
      this.nickMsg = t(`rushNickBad_${n.problem}` as `rushNickBad_${NickProblem}`);
      return this.rebuildStartKeepingInput();
    }
    this.nickBusy = true;
    this.rebuildStartKeepingInput();
    const res = await scores.claimNick(this.token(), n.nick);
    this.nickBusy = false;
    if (!res.ok && res.status === 409) this.nickMsg = t('rushNickTaken');
    else if (!res.ok && res.status === 400 && /^nick-(length|chars|blocked)$/.test(res.error)) this.nickMsg = t(`rushNickBad_${res.error.slice(5)}` as `rushNickBad_${NickProblem}`);
    else {
      // claimed, or the server cannot be reached now (the claim is checked again when a ranked run starts)
      this.rec.nick = n.nick;
      this.app.persist();
      this.nickOpen = false;
      this.nickMsg = null;
      this.me = null;
      void this.loadMe();
      if (this.mode === null && document.body.contains(this.el)) this.build();
      return;
    }
    this.rebuildStartKeepingInput();
  }

  private bestsView(): HTMLElement {
    const rec = this.rec;
    const parts: string[] = [];
    const best = Math.max(rec.best, this.me?.best ?? 0);
    if (best > 0) parts.push(t('rushMyBest', { score: formatScore(best) }) + (this.me?.rank ? ` · ${t('rushMyRank', { rank: this.me.rank })}` : ''));
    if (rec.practiceBest > 0) parts.push(t('rushPracticeBest', { score: formatScore(rec.practiceBest) }));
    // the board cannot be reached: the personal best only, and one quiet line saying why
    const offline = this.fame.k === 'offline' ? h('small', { class: 'rush-bests-off', 'data-role': 'fame-offline' }, t('rushOffline')) : null;
    return h('p', { class: 'rush-bests', 'data-role': 'rush-bests' }, parts.length ? parts.join(' · ') : t('rushNoBest'), offline);
  }

  /** The hall of fame: top 20 (50 after "show more"), your row lit, your rank under it when you are further down. */
  private fameView(top: FameRow[] | null): HTMLElement {
    const f = top ? { k: 'ok' as const, rows: top } : this.fame;
    const head = h('h2', { class: 'rush-fame-title' }, t('rushFame'));
    if (f.k === 'loading') return h('section', { class: 'rush-panel rush-fame', 'data-role': 'fame', 'data-state': 'loading' }, head, h('p', { class: 'rush-fame-note' }, t('rushFameLoading')));
    if (f.k === 'offline') return h('section', { class: 'rush-panel rush-fame', 'data-role': 'fame', 'data-state': 'offline' }, head, h('p', { class: 'rush-fame-note' }, t('rushOffline')));
    const mine = this.rec.nick ? nickKey(this.rec.nick) : null;
    const rows = f.rows.slice(0, this.fameAll ? FAME_ALL : FAME_FIRST);
    const table = rows.length
      ? h(
          'table',
          { class: 'rush-fame-table' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('rushColRank')), h('th', { scope: 'col' }, t('rushColNick')), h('th', { scope: 'col' }, t('rushColScore')), h('th', { scope: 'col' }, t('rushColCards')))),
          h(
            'tbody',
            {},
            ...rows.map((r) =>
              h(
                'tr',
                { class: mine && nickKey(r.nick) === mine ? 'me' : '', 'data-nick': r.nick, 'data-score': r.score },
                h('td', { class: 'num' }, String(r.rank)),
                h('td', { class: 'nick' }, r.nick),
                h('td', { class: 'num' }, formatScore(r.score)),
                h('td', { class: 'num' }, String(r.cards)),
              ),
            ),
          ),
        )
      : h('p', { class: 'rush-fame-note' }, t('rushFameEmpty'));
    const shownMine = mine !== null && rows.some((r) => nickKey(r.nick) === mine);
    const standing = this.submit.k === 'done' ? { best: this.submit.r.best, rank: this.submit.r.bestRank } : this.me;
    const you = !shownMine && standing?.rank ? h('p', { class: 'rush-fame-you', 'data-role': 'fame-you' }, t('rushFameYou', { rank: standing.rank, score: formatScore(standing.best) })) : null;
    const more =
      f.rows.length > FAME_FIRST
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn small rush-fame-more',
              'data-role': 'fame-more',
              onclick: () => {
                this.fameAll = !this.fameAll;
                this.build();
              },
            },
            this.fameAll ? t('rushFameLess') : t('rushFameMore'),
          )
        : null;
    return h('section', { class: 'rush-panel rush-fame', 'data-role': 'fame', 'data-state': 'ok' }, head, table, you, more);
  }

  private async loadFame(): Promise<void> {
    const res = await scores.top(FAME_ALL);
    this.fame = res.ok && Array.isArray(res.data) ? { k: 'ok', rows: res.data } : { k: 'offline' };
    if (this.mode === null) this.rebuildStartKeepingInput();
  }

  private async loadMe(): Promise<void> {
    if (!this.rec.token) return;
    const res = await scores.me(this.rec.token, this.rec.nick);
    if (res.ok) this.me = { best: res.data.best, rank: res.data.rank };
    if (this.mode === null) this.rebuildStartKeepingInput();
  }

  /** Rebuild the start screen without losing what is typed in the nickname box. */
  private rebuildStartKeepingInput(): void {
    if (!document.body.contains(this.el)) return this.build();
    const input = this.el.querySelector<HTMLInputElement>('[data-role="nick-input"]');
    const typed = input?.value;
    const focused = !!input && document.activeElement === input;
    this.build();
    const again = this.el.querySelector<HTMLInputElement>('[data-role="nick-input"]');
    if (again && typed !== undefined) again.value = typed;
    if (again && focused) again.focus();
  }

  // ---------------- a run

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
      h('span', { class: 'rush-count', 'data-role': 'count' }, t('rushCardN', { n: st.cards.length })),
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
    const next = h(
      'button',
      { type: 'button', class: 'btn primary rush-next', 'data-role': 'next', onclick: () => this.next() },
      isLast(st) ? t('rushToEnd') : t('rushNext'),
      h('kbd', { 'aria-hidden': 'true' }, '↓'),
    );
    return h(
      'div',
      {
        class: `rush-feedback ${a.right ? 'right' : 'wrong'}`,
        'data-result': a.right ? 'right' : a.given === null ? 'timeout' : 'wrong',
        'aria-live': 'polite',
      },
      h(
        'p',
        { class: 'rush-result' },
        h('span', { class: 'rush-mark', 'aria-hidden': 'true' }, a.right ? '✔' : '✘'),
        h('strong', {}, head),
        a.right ? h('span', { class: 'rush-pts' }, t('rushPoints', { n: formatScore(a.points) })) : null,
        h('span', { class: 'rush-truth' }, t('rushAnswerIs', { verdict: verdictLabel(c.verdict) })),
      ),
      h('p', { class: 'rush-why', 'data-role': 'why' }, ...rich(c.why[lang()])),
      h('div', { class: 'rush-next-row' }, h('span', { class: 'rush-next-hint' }, t('rushNextHint')), next),
    );
  }

  private endPanel(): HTMLElement {
    const st = this.st!;
    const ranked = this.mode === 'play';
    const best = ranked ? this.rec.best : this.rec.practiceBest;
    const kids: (Node | null)[] = [
      h('h1', { class: 'rush-title' }, ranked ? t('rushOverTitle') : t('rushPracticeOver')),
      h('p', { class: 'rush-final', 'data-role': 'final-score' }, t('rushPointsTotal', { score: formatScore(st.score) })),
      h('p', { class: 'rush-stats' }, t('rushRightCount', { n: rightCount(st) }), ' · ', t('rushBestStreak', { n: st.bestStreak })),
      ranked && this.submit.k === 'done' ? null : h('p', { class: `rush-best${this.newBest ? ' new' : ''}`, 'data-role': 'best' }, this.newBest ? t('rushNewBest') : t('rushBestIs', { score: formatScore(best) })),
    ];
    if (ranked) {
      kids.push(this.submitView());
      const text = rushShareText(lang(), st.score, rightCount(st), st.bestStreak);
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
    const panel = h('section', { class: 'rush-panel rush-end', 'data-role': 'rush-end', tabindex: -1 }, ...kids);
    if (!ranked) return panel;
    const top = this.submit.k === 'done' ? this.submit.r.top : null;
    return h('div', { class: 'rush-end-wrap' }, panel, top ? this.fameView(top) : null);
  }

  private submitView(): HTMLElement {
    const s = this.submit;
    if (s.k === 'done') {
      const line = s.r.newBest
        ? t('rushNewBestRank', { rank: s.r.bestRank })
        : `${t('rushRankIs', { rank: s.r.rank })} · ${t('rushMyBest', { score: formatScore(s.r.best) })} · ${t('rushMyRank', { rank: s.r.bestRank })}`;
      return h('p', { class: 'rush-rank', 'data-role': 'rank', 'data-rank': s.r.rank, 'data-best': s.r.best }, line);
    }
    if (s.k === 'offline')
      return h(
        'p',
        { class: 'rush-rank offline', 'data-role': 'rank-offline' },
        `${t('rushOffline')} · `,
        h('button', { type: 'button', class: 'btn small', 'data-role': 'retry', onclick: () => void this.send() }, t('rushRetry')),
      );
    if (s.k === 'refused') return h('p', { class: 'rush-rank refused', 'data-role': 'rank-refused' }, t('rushNotRanked', { reason: s.reason }));
    return h('p', { class: 'rush-rank', 'data-role': 'rank-sending' }, t('rushSubmitting'));
  }

  /** Send the finished ranked run; it stays in memory until it gets through (the retry button calls this again). */
  private async send(): Promise<void> {
    const st = this.st;
    const r = this.ranked;
    if (!st || st.phase !== 'over' || !r || this.submit.k === 'sending' || this.submit.k === 'done') return;
    this.submit = { k: 'sending' };
    this.rebuildEnd();
    await this.ensureStarted();
    if (r.refused) this.submit = { k: 'refused', reason: r.refused };
    else if (!r.runId) this.submit = { k: 'offline' };
    else {
      const res = await scores.finish(r.runId, this.token(), submittedAnswers(st));
      if (res.ok) {
        this.submit = { k: 'done', r: res.data };
        this.fame = { k: 'ok', rows: res.data.top };
        if (res.data.best > this.rec.best) {
          this.rec.best = res.data.best;
          this.app.persist();
        }
      } else if (res.status === 0) this.submit = { k: 'offline' };
      else if (res.status === 409 && res.error === 'finished') {
        // an earlier try got through but its answer was lost: show the standing from /me
        const me = await scores.me(this.token(), this.rec.nick);
        this.submit = me.ok
          ? { k: 'done', r: { score: st.score, cards: rightCount(st), bestStreak: st.bestStreak, rank: me.data.rank ?? 0, best: me.data.best, bestRank: me.data.rank ?? 0, newBest: false, top: this.fame.k === 'ok' ? this.fame.rows : [] } }
          : { k: 'offline' };
      } else this.submit = { k: 'refused', reason: res.error };
    }
    this.rebuildEnd();
  }

  private rebuildEnd(): void {
    if (this.st?.phase === 'over' && document.body.contains(this.el)) this.build();
  }

  // ------------------------------------------------------------ the run

  shown(): void {
    document.addEventListener('keydown', this.onKey);
    if (!this.mode) {
      void this.loadFame();
      void this.loadMe();
      return;
    }
    if (!this.st || this.st.phase === 'over') return;
    this.app.stage.mount(this.stageBox);
    if (this.st.phase === 'question') this.ask();
    else this.showRun();
  }

  /** Start the clock of the current card and hide the stage behind the curtain. */
  private ask(): void {
    this.askedAt = performance.now();
    this.deadline = this.askedAt + RUSH_MS;
    this.curtained(true);
    this.app.stage.show({ ...sceneBase(this.card()), k: 'idle' }, { hud: false, loop: false });
    this.stopTimers();
    this.tickTimer = setInterval(() => this.tick(), 50);
    this.paintTimer();
  }

  /** During the question the stage is hidden: what it would draw is the answer. */
  private curtained(on: boolean): void {
    this.curtain.hidden = !on;
    this.curtainText.textContent = t('rushCurtain');
    this.stageBox.classList.toggle('hidden-run', on);
  }

  private msLeft(): number {
    return Math.max(0, this.deadline - performance.now());
  }

  private tick(): void {
    if (!this.st || this.st.phase !== 'question') return;
    if (this.msLeft() <= 0) this.answer(null);
    else this.paintTimer();
  }

  private paintTimer(): void {
    if (!this.st) return;
    const q = this.st.phase === 'question';
    // a card whose clock has not started yet (askedAt 0) shows a full bar
    const left = !q ? 0 : this.askedAt === 0 ? RUSH_MS : this.msLeft();
    this.timerFill.style.transform = `scaleX(${(left / RUSH_MS).toFixed(4)})`;
    this.timerBar.classList.toggle('low', q && left <= LOW_MS);
    this.timerText.textContent = q ? t('rushSecondsLeft', { n: (Math.ceil(left / 100) / 10).toFixed(1) }) : '';
  }

  /** `given` null: the time ran out. */
  private answer(given: RushVerdict | null): void {
    if (!this.st || this.st.phase !== 'question') return;
    const ms = given === null ? RUSH_MS : performance.now() - this.askedAt;
    this.st = answerCard(this.st, given, ms, this.card().verdict);
    this.rec.seen = addSeen(this.rec.seen, currentCard(this.st));
    this.app.persist();
    this.stopTimers();
    const right = this.st.answers.at(-1)!.right;
    if (right) sfx.solve();
    else sfx.fail();
    // Nothing keeps the focus: Enter or Space on a focused button must not move on (only ↓ does).
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.build();
    this.showRun();
    // No timer here (author, 11/3): the reason stays until the player moves on with ↓ or the button.
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
    this.askedAt = 0;
    const st = this.st;
    this.st = nextCard(st, () => this.pick(st.cards.length + 1, st.cards));
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (this.st.phase === 'over') {
      this.newBest = recordRush(this.rec, this.mode === 'play' ? 'rush' : 'practice', this.st.score);
      this.app.persist();
      this.build();
      this.el.querySelector<HTMLElement>('[data-role="rush-end"]')?.focus({ preventScroll: true });
      if (this.mode === 'play') void this.send();
      return;
    }
    if (this.ranked && !this.ranked.runId) void this.ensureStarted();
    this.build();
    this.ask();
  }

  private again(): void {
    this.stopTimers();
    this.askedAt = 0;
    this.begin();
    this.build();
    this.app.stage.mount(this.stageBox);
    this.ask();
  }

  private key(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || !this.st || !this.mode || document.querySelector('.modal-overlay')) return;
    if (this.st.phase === 'question') {
      const v: RushVerdict | null = e.key === 'ArrowLeft' || e.key === '1' ? 'ends' : e.key === 'ArrowRight' || e.key === '2' ? 'never' : null;
      if (v) {
        e.preventDefault();
        this.answer(v);
      }
    } else if (this.st.phase === 'feedback' && e.key === 'ArrowDown') {
      e.preventDefault();
      this.next();
    }
  }

  private stopTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  destroy(): void {
    this.stopTimers();
    document.removeEventListener('keydown', this.onKey);
  }

  relang(): void {
    if (!this.mode) return this.rebuildStartKeepingInput();
    this.build();
    if (!this.st || this.st.phase === 'over') return;
    this.app.stage.mount(this.stageBox);
    if (this.st.phase === 'question') {
      this.curtained(true);
      this.paintTimer();
    } else this.showRun();
  }
}
