// The level screen: the stage (sample runs, counterexamples, never-ending walks) as the main area;
// beside it the code, the verdict, the proof with always-visible input help, the result, and a graph.
import { evalRank, ExprError, show, type Expr } from '../core/expr.ts';
import {
  attemptMark,
  isFailure,
  isSolved,
  nobodyKnows,
  parseInputs,
  parseR,
  parseV,
  parseZ,
  proofLength,
  proveEnds,
  proveZone,
  railingAllowed,
  runNever,
  shareText,
  starsFor,
  tuplesAllowed,
  type Detail,
  type FieldError,
  type Outcome,
  type Verdict,
} from '../core/game.ts';
import { LEVELS, levelById, type Level } from '../core/levels.ts';
import { initialState, sampleInputs, SIM_CAP, type Run, type State } from '../core/sim.ts';
import { cexScene, heightMap, ringScene, runScene, sampleScene, sceneBase, shaftScene, stairsOfRun, walk, zeroSteps, guardCheck, stairsWithV, type StageScene } from '../core/stage.ts';
import { helpMenu, screenState } from '../core/tours.ts';
import { introFor } from '../core/tutorial.ts';
import type { App, Screen } from './app.ts';
import { sfx } from './audio.ts';
import { renderChart, type Series } from './chart.ts';
import { chipBar, syntaxExample } from './chips.ts';
import { codeView, follow, type CodeView } from './code.ts';
import { clear, h, s } from './dom.ts';
import { errorText } from './errors.ts';
import { num, pretty, rank, state as fmtState, starsText } from './format.ts';
import { lang, t, type Key } from './i18n.ts';
import { openModal } from './overlay.ts';
import { LevelGuide } from './tourView.ts';

interface Session {
  verdict: Verdict | null;
  marks: string[];
  solved: boolean;
  stars: number;
  solvedLength: number | null;
  outcome: Outcome | null;
  errors: FieldError[];
  vText: string;
  rText: string;
  zText: string;
  startTexts: Record<string, string>;
  zoneRun: { s0: State; run: Run } | null;
  busy: boolean;
  tries: number;
  sample: number;
  /** Step 1 reopened with "change" after a verdict was chosen. */
  verdictOpen: boolean;
  /** The text of each input at the last judged attempt (focusing such an input selects it all). */
  judged: Record<string, string>;
}

const CHECK_ORDER = ['railStart', 'railStep', 'bounded', 'decreasing', 'zoneStart', 'zoneGuard', 'zoneStep'];
const DRAW_STEPS = 200;

function fresh(level: Level): Session {
  return {
    verdict: null,
    marks: [],
    solved: false,
    stars: 0,
    solvedLength: null,
    outcome: null,
    errors: [],
    vText: '',
    rText: '',
    zText: '',
    startTexts: Object.fromEntries(level.inputs.map((v) => [v, ''])),
    zoneRun: null,
    busy: false,
    tries: 0,
    sample: 0,
    verdictOpen: false,
    judged: {},
  };
}

export class LevelScreen implements Screen {
  el: HTMLElement;
  levelId: number;
  daily: string | null;
  private app: App;
  private level: Level;
  private ses: Session;
  private stageBox = h('section', { class: 'stage-wrap' });
  private panel = h('div', { class: 'panel-inner' });
  private els = {
    intro: h('div', { class: 'intro-note' }),
    code: h('article', { class: 'card code-card' }),
    verdict: h('article', { class: 'card verdict-card' }),
    proof: h('article', { class: 'card proof-card' }),
    result: h('article', { class: 'card result-card', 'aria-live': 'polite' }),
    graph: h('details', { class: 'card graph-card' }),
  };
  private chartSvg = s('svg', { class: 'chart-svg', role: 'img' });
  private chartLegend = h('div', { class: 'legend' });
  private chartNote = h('p', { class: 'chart-empty' });
  private codeView: CodeView | null = null;
  private lastField: 'V' | 'R' | 'Z' = 'V';
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private badge: HTMLButtonElement & { paint: () => void };
  private soundNext = false;
  /** After a judged attempt, the input that had the focus gets it back with its whole content selected. */
  private selectOnRender = false;
  /** The guided tours of this screen (SPEC_guide). */
  private guide: LevelGuide;

  constructor(app: App, id: number, daily: string | null) {
    this.app = app;
    this.levelId = id;
    this.daily = daily;
    this.level = levelById(id);
    this.ses = fresh(this.level);
    this.badge = app.judgeBadge(() => this.explainJudge());
    if (daily) {
      const rec = app.saved.daily[daily];
      if (rec && rec.level === id) {
        this.ses.marks = [...rec.marks];
        this.ses.solved = rec.solved;
        this.ses.solvedLength = rec.length;
        if (rec.solved) this.ses.stars = starsFor(this.level, rec.marks.length + 1, rec.length);
      }
    }
    app.saved.current = id;
    app.persist();
    this.el = h('div', { class: 'screen level-screen' });
    this.guide = new LevelGuide(app, { root: this.el, level: this.level, state: () => screenState(this.ses.verdict, this.ses.outcome) });
    this.build();
  }

  // ------------------------------------------------------------ layout

  private build(): void {
    const l = this.level;
    const help = h('button', { type: 'button', class: 'icon-btn help-btn', 'data-role': 'help', title: t('helpTitle'), 'aria-label': t('helpTitle'), onclick: () => this.openHelp() }, '?');
    const title = h('span', {}, h('span', { class: 'bar-ch' }, this.daily ? t('dailyTag', { date: this.daily }) : t('levelN', { n: l.id })), ' ', l.title[lang()]);
    const bar = this.app.bar({ back: { label: t('backLevels'), href: '#/levels' }, title, extra: [this.badge, help] });
    this.els.graph.replaceChildren(h('summary', {}, t('graph')), h('p', { class: 'chart-hint' }, t('graphHint')), this.chartSvg, this.chartLegend, this.chartNote);
    this.els.graph.addEventListener('toggle', () => this.renderChart());
    // The code card stays on top (sticky); the intro note goes under the result so that the code, the input,
    // the chips and the check button fit on one laptop screen.
    this.panel.replaceChildren(this.els.code, this.els.verdict, this.els.proof, this.els.result, this.els.intro, this.els.graph);
    this.el.replaceChildren(bar, h('div', { class: 'level-main' }, this.stageBox, h('aside', { class: 'panel' }, this.panel)), this.guide.el);
    this.renderAll();
  }

  shown(): void {
    this.app.stage.mount(this.stageBox);
    this.renderStage();
    this.suggestTutorial();
    // the guide waits until nothing else is open (the suggestion above; the intros come before this screen)
    this.guide.shown();
  }

  /** The first visit to level 1 suggests the tutorial, unless it was read or skipped. */
  private suggestTutorial(): void {
    const saved = this.app.saved;
    if (this.level.id !== 1 || this.daily || saved.tutorial || saved.introsShown.includes(1)) return;
    saved.introsShown.push(1);
    this.app.persist();
    openModal(t('suggestTitle'), [h('p', {}, t('suggestBody'))], [
      { label: t('suggestYes'), primary: true, onClick: () => (location.hash = '#/tutorial') },
      { label: t('suggestNo') },
    ]);
  }

  /** "?": the same menu on every level: the tutorial, the three intros and this screen's guide (SPEC_guide §A). */
  private openHelp(): void {
    const here = location.hash || `#/level/${this.level.id}`;
    openModal(t('helpTitle'), [], [
      ...helpMenu().map((item) =>
        item.k === 'tutorial'
          ? { label: t('helpTutorial'), primary: true, onClick: () => (location.hash = '#/tutorial') }
          : item.k === 'intro'
            ? { label: t('helpIntro', { title: introFor(item.level)!.title[lang()], n: item.level }), onClick: () => this.app.openIntro(item.level, here) }
            : { label: t('guideReplay'), onClick: () => this.guide.replay() },
      ),
      { label: t('close') },
    ]);
  }

  destroy(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.guide.destroy();
  }

  relang(): void {
    this.badge = this.app.judgeBadge(() => this.explainJudge());
    this.build();
    this.shown();
    this.guide.relang();
  }

  z3Changed(): void {
    this.badge.paint();
    this.renderProofStatus();
  }

  private renderAll(): void {
    this.renderIntro();
    this.renderCode();
    this.renderVerdict();
    this.renderProof();
    this.renderResult();
    this.renderChart();
  }

  private renderIntro(): void {
    const el = this.els.intro;
    const l = this.level;
    const intro = introFor(l.id);
    if (intro) {
      el.hidden = false;
      el.replaceChildren(
        h('span', { class: 'intro-badge' }, '!'),
        h('span', {}, t('newIdea', { title: intro.title[lang()] })),
        h('button', { type: 'button', class: 'btn small', 'data-role': 'intro', onclick: () => this.app.openIntro(l.id, location.hash || `#/level/${l.id}`) }, t('readIntro')),
      );
    } else if (l.id === 1 && !this.daily && this.app.saved.tutorial !== 'done') {
      el.hidden = false;
      el.replaceChildren(h('span', { class: 'intro-badge' }, '?'), h('span', {}, t('startHere')), h('a', { class: 'btn small', href: '#/tutorial' }, t('openTutorial')));
    } else el.hidden = true;
  }

  // ------------------------------------------------------------ code card

  private failingLines(): Set<number> {
    const o = this.ses.outcome;
    if (!o || (o.type !== 'ends' && o.type !== 'zone')) return new Set();
    return new Set(this.firstFailure(o.details)?.lines ?? []);
  }

  private renderCode(): void {
    const l = this.level;
    const el = this.els.code;
    const best = this.app.saved.best[l.id] ?? 0;
    this.codeView = codeView(l, this.failingLines());
    const inputs = l.start === 'true' ? `${l.inputs.join(', ')} (${t('anyIntegers')})` : `${l.inputs.join(', ')} (${pretty(l.startText ?? l.start)})`;
    const facts = l.facts === 'true' ? t('none') : pretty(l.factsText ?? l.facts);
    const attempts = this.ses.marks.length + (this.ses.solved ? 1 : 0);
    const kids: (HTMLElement | null)[] = [
      h(
        'div',
        { class: 'level-head' },
        h('span', { class: 'level-num' }, `${t('levelN', { n: l.id })} / ${LEVELS.length}`),
        h('h2', { class: 'level-title' }, l.title[lang()]),
        h('span', { class: 'level-stars', title: t('bestStars', { stars: starsText(best) }) }, starsText(best)),
        h('span', { class: 'attempt-line', 'data-role': 'attempts' }, t('attempts', { n: attempts })),
      ),
      l.note ? h('p', { class: 'level-note' }, l.note[lang()]) : null,
      this.codeView.el,
      h('p', { class: 'code-meta' }, h('span', { class: 'meta-key' }, `${t('inputs')}:`), ' ', h('code', {}, inputs)),
      h('p', { class: 'code-meta' }, h('span', { class: 'meta-key' }, `${t('facts')}:`), ' ', l.facts === 'true' ? facts : h('code', {}, facts)),
    ];
    el.replaceChildren(...kids.filter((x): x is HTMLElement => x !== null));
  }

  // ------------------------------------------------------------ verdict

  private renderVerdict(): void {
    const el = this.els.verdict;
    const v = this.ses.verdict;
    const label = (x: Verdict) => t(x === 'ends' ? 'verdictEnds' : x === 'never' ? 'verdictNever' : 'verdictNobody');
    el.classList.toggle('collapsed', v !== null && !this.ses.verdictOpen);
    if (v !== null && !this.ses.verdictOpen) {
      // One line once chosen: "1단계 판정: 끝난다 · 바꾸기".
      el.replaceChildren(
        h(
          'p',
          { class: 'verdict-line' },
          h('span', { class: 'verdict-line-key' }, `${t('verdictChosen')}:`),
          ' ',
          h('strong', { 'data-role': 'verdict-chosen' }, label(v)),
          ' · ',
          h('button', { type: 'button', class: 'linkish', 'data-role': 'change-verdict', disabled: this.ses.busy, onclick: () => this.reopenVerdict() }, t('changeVerdict')),
        ),
      );
      return;
    }
    const mk = (x: Verdict) =>
      h(
        'button',
        {
          type: 'button',
          class: `verdict v-${x}${v === x ? ' on' : ''}`,
          'aria-pressed': v === x ? 'true' : 'false',
          'data-verdict': x,
          title: t(x === 'ends' ? 'verdictEndsTip' : x === 'never' ? 'verdictNeverTip' : 'verdictNobodyTip'),
          onclick: () => this.chooseVerdict(x),
        },
        label(x),
      );
    el.replaceChildren(
      h('h3', { class: 'card-title step-title' }, t('verdictQ')),
      h('div', { class: 'verdicts', role: 'group', 'aria-label': t('verdictQ') }, mk('ends'), mk('never'), mk('nobody')),
    );
  }

  private reopenVerdict(): void {
    this.ses.verdictOpen = true;
    this.renderVerdict();
    this.els.verdict.querySelector<HTMLButtonElement>('.verdict.on')?.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ proof

  private fieldError(field: string): HTMLElement {
    const err = this.ses.errors.find((e) => e.field === field);
    return h('span', { class: 'field-error', role: err ? 'alert' : null }, err ? errorText(err.error) : '');
  }

  private input(key: string, value: string, placeholder: string, onInput: (v: string) => void, extra: Record<string, string> = {}): HTMLInputElement {
    const inp = h('input', {
      type: 'text',
      class: `answer${this.ses.errors.some((e) => e.field === key || `in:${e.field}` === key) ? ' invalid' : ''}`,
      'data-focus': key,
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      placeholder,
      ...extra,
    });
    inp.value = value;
    inp.addEventListener('input', () => onInput(inp.value));
    if (key === 'V' || key === 'R' || key === 'Z') inp.addEventListener('focus', () => (this.lastField = key));
    // After a judged attempt, focusing the answer selects it all, so typing replaces it (not "nn-i").
    let justSelected = false;
    inp.addEventListener('focus', () => {
      if (this.ses.outcome && key in this.ses.judged && inp.value !== '' && inp.value === this.ses.judged[key]) {
        inp.select();
        justSelected = true;
      }
    });
    inp.addEventListener('mouseup', (e) => {
      if (justSelected) e.preventDefault();
      justSelected = false;
    });
    return inp;
  }

  private target(): HTMLInputElement | null {
    return this.els.proof.querySelector<HTMLInputElement>(`[data-focus="${this.lastField}"]`) ?? this.els.proof.querySelector<HTMLInputElement>('input[data-focus="V"], input[data-focus="Z"]');
  }

  private renderProof(): void {
    const el = this.els.proof;
    const focus = document.activeElement instanceof HTMLInputElement && el.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focus?.dataset.focus;
    const sel = focus ? [focus.selectionStart, focus.selectionEnd] : null;
    clear(el);
    const l = this.level;
    const v = this.ses.verdict;
    const sub = v === 'ends' ? t('proofSubEnds') : v === 'never' ? t('proofSubNever') : v === 'nobody' ? t('proofSubNobody') : null;
    el.classList.toggle('locked', v === null);
    el.setAttribute('aria-disabled', v === null ? 'true' : 'false');
    el.append(
      h(
        'div',
        { class: 'step-head' },
        h('h3', { class: 'card-title step-title' }, t('proofTitle')),
        sub ? h('span', { class: 'step-sub' }, sub) : h('span', { class: 'step-sub locked-note' }, t('proofLocked')),
      ),
    );
    if (v === 'nobody') el.append(h('p', { class: 'help' }, t('proofNobodyBody')));
    if (v === 'ends') {
      const meta = h('span', { class: 'field-meta' });
      const updateMeta = () => {
        const len = proofLength(l, this.ses.vText, this.ses.rText);
        meta.textContent = l.par !== undefined ? t('lengthPar', { len, par: l.par }) : t('lengthOnly', { len });
        meta.classList.toggle('over', l.par !== undefined && len > l.par);
      };
      updateMeta();
      const vIn = this.input('V', this.ses.vText, tuplesAllowed(l) ? t('vPlaceholderTuple') : t('vPlaceholder'), (x) => {
        this.ses.vText = x;
        updateMeta();
        this.schedulePreview();
      });
      const form = h(
        'form',
        { class: 'proof', novalidate: true, onsubmit: (e: Event) => (e.preventDefault(), void this.submitEnds()) },
        h('label', { class: 'field inline' }, h('span', { class: 'field-name' }, t('stepsLeft'), ' ='), vIn, this.fieldError('V')),
      );
      if (railingAllowed(l)) {
        const rIn = this.input('R', this.ses.rText, t('rPlaceholder'), (x) => {
          this.ses.rText = x;
          updateMeta();
        });
        form.append(h('label', { class: 'field inline' }, h('span', { class: 'field-name' }, t('railing'), ' ', h('var', {}, 'R'), ' =', h('small', {}, ` (${t('optional')})`)), rIn, this.fieldError('R')));
      }
      form.append(
        chipBar({ vars: l.vars, cond: railingAllowed(l), tuple: tuplesAllowed(l), target: () => this.target(), example: false }),
        h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary', 'data-role': 'check' }, t('check')), this.judgeSlot(), meta, h('span', { class: 'proof-status' })),
        h(
          'p',
          { class: 'help' },
          t('syntaxHelp'),
          tuplesAllowed(l) ? ` ${t('syntaxTuple')}` : '',
          railingAllowed(l) ? ` ${t('railHelp')}` : '',
          l.locals.length ? ` ${t('localsNote', { names: l.locals.join(', ') })}` : '',
          h('br'),
          `${t('inputExample')}: `,
          h('code', {}, syntaxExample(l.vars, false)),
        ),
      );
      el.append(form);
    } else if (v === 'never') {
      const startText = l.start === 'true' ? t('anyIntegers') : pretty(l.startText ?? l.start);
      const fields = l.inputs.map((name) =>
        h(
          'label',
          { class: 'mini-field' },
          h('code', {}, name),
          ' = ',
          this.input(`in:${name}`, this.ses.startTexts[name] ?? '', '0', (x) => (this.ses.startTexts[name] = x), {
            class: `answer small${this.ses.errors.some((e) => e.field === name) ? ' invalid' : ''}`,
            inputmode: 'numeric',
            'aria-label': name,
          }),
          this.fieldError(name),
        ),
      );
      el.append(
        h(
          'form',
          { class: 'proof', novalidate: true, onsubmit: (e: Event) => (e.preventDefault(), this.submitNever()) },
          h('div', { class: 'field-name' }, t('startValues')),
          h('div', { class: 'mini-fields' }, ...fields),
          h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary', 'data-role': 'run' }, t('run'))),
          h('p', { class: 'help' }, l.start === 'true' ? t('runHelpAny') : t('runHelp', { start: startText })),
        ),
      );
      if (this.ses.zoneRun) {
        el.append(
          h(
            'form',
            { class: 'proof zone-form', novalidate: true, onsubmit: (e: Event) => (e.preventDefault(), void this.submitZone()) },
            h('label', { class: 'field inline' }, h('span', { class: 'field-name' }, t('zone'), ' ', h('var', {}, 'Z'), ' ='), this.input('Z', this.ses.zText, t('zonePlaceholder'), (x) => (this.ses.zText = x)), this.fieldError('Z')),
            chipBar({ vars: l.vars, cond: true, tuple: false, target: () => this.target(), example: false }),
            h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary', 'data-role': 'check' }, t('check')), this.judgeSlot(), h('span', { class: 'proof-status' })),
            h('p', { class: 'help' }, t('zoneHelp')),
          ),
        );
      }
    }
    this.renderProofStatus();
    const selectAll = this.selectOnRender;
    this.selectOnRender = false;
    if (focusKey) {
      const again = el.querySelector<HTMLInputElement>(`[data-focus="${CSS.escape(focusKey)}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        const [a, b] = sel ?? [null, null];
        if (selectAll) again.select();
        else if (typeof a === 'number' && typeof b === 'number') again.setSelectionRange(a, b);
      }
    }
  }

  /** In place of the check button until the judge is ready: its progress, or why it failed and a retry. */
  private judgeSlot(): HTMLElement {
    return h('span', { class: 'judge-slot', 'data-role': 'judge-slot', 'aria-live': 'polite' });
  }

  private renderProofStatus(): void {
    const z3 = this.app.z3;
    const ready = !!this.app.judge;
    for (const st of this.els.proof.querySelectorAll<HTMLElement>('.proof-status')) {
      st.textContent = this.ses.busy ? (ready ? t('checking') : t('waitingJudge')) : '';
      st.classList.toggle('busy', this.ses.busy);
    }
    for (const b of this.els.proof.querySelectorAll<HTMLButtonElement>('[data-role="check"]')) {
      b.hidden = !ready;
      b.disabled = this.ses.busy;
      b.textContent = this.ses.busy ? t('checking') : t('check');
    }
    for (const slot of this.els.proof.querySelectorAll<HTMLElement>('[data-role="judge-slot"]')) {
      slot.hidden = ready;
      if (ready) {
        slot.replaceChildren();
        continue;
      }
      if (z3.state === 'error') {
        slot.dataset.state = 'error';
        slot.replaceChildren(h('span', { class: 'judge-why' }, judgeReason(z3.reason)), ' ', retryButton());
      } else {
        slot.dataset.state = 'loading';
        const pct = z3.state === 'loading' && z3.total ? Math.min(99, Math.round(((z3.loaded ?? 0) / z3.total) * 100)) : null;
        slot.replaceChildren(h('span', { class: 'judge-wait' }, pct === null ? t('judgePreparing') : t('judgePreparingPct', { pct })));
      }
    }
  }

  // ------------------------------------------------------------ results

  private firstFailure(details: Detail[]): Detail | undefined {
    return [...details].sort((a, b) => CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id)).find((d) => d.status === 'fail');
  }

  private checkName(d: Detail, tuple: boolean): string {
    const names: Record<string, Key> = {
      bounded: tuple ? 'ckBoundedTuple' : 'ckBounded',
      decreasing: tuple ? 'ckDecreasingTuple' : 'ckDecreasing',
      railStart: 'ckRailStart',
      railStep: 'ckRailStep',
      zoneStart: 'ckZoneStart',
      zoneGuard: 'ckZoneGuard',
      zoneStep: 'ckZoneStep',
    };
    const k = names[d.id];
    return k ? t(k) : d.id;
  }

  private cexText(d: Detail, tuple: boolean): string {
    const vars = this.level.vars;
    const st = (x?: State) => (x ? fmtState(vars, x) : '');
    const v = d.v ? rank(d.v) : '';
    const v2 = d.v2 ? rank(d.v2) : '';
    switch (d.id) {
      case 'bounded': {
        if (tuple) return t('cexBelowTuple', { s: st(d.s), v });
        const k = d.v ? -d.v[0]! : 0n;
        return t('cexBelow', { k: num(k), s: st(d.s), v });
      }
      case 'decreasing':
        if (tuple) return t(d.move === 'flat' ? 'cexFlatTuple' : 'cexUpTuple', { s: st(d.s), s2: st(d.s2), v, v2 });
        return t(d.move === 'flat' ? 'cexFlat' : 'cexUp', { s: st(d.s), s2: st(d.s2), v, v2 });
      case 'railStart':
        return t('cexRailStart', { s: st(d.s) });
      case 'railStep':
        return t('cexRailStep', { s: st(d.s), s2: st(d.s2) });
      case 'zoneStart':
        return t('cexZoneStart', { s: st(d.s) });
      case 'zoneGuard':
        return t('cexZoneGuard', { s: st(d.s), guard: pretty(show(this.level.prog.guard)) });
      case 'zoneStep':
        return t('cexZoneStep', { s: st(d.s), s2: st(d.s2) });
      default:
        return '';
    }
  }

  private checkList(details: Detail[], tuple: boolean): HTMLElement {
    const ul = h('ul', { class: 'checks' });
    for (const d of [...details].sort((a, b) => CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id))) {
      const icon = d.status === 'pass' ? '✓' : d.status === 'fail' ? '✗' : '?';
      ul.append(
        h(
          'li',
          { class: `check ${d.status}` },
          h('span', { class: 'check-icon', 'aria-hidden': 'true' }, icon),
          h('div', {}, h('div', { class: 'check-name' }, this.checkName(d, tuple)), d.status === 'fail' ? h('div', { class: 'cex' }, this.cexText(d, tuple)) : null),
        ),
      );
    }
    return ul;
  }

  private renderResult(): void {
    const el = this.els.result;
    clear(el);
    const o = this.ses.outcome;
    const l = this.level;
    const parts: (Node | null)[] = [];
    const headline = (cls: string, text: string) => h('p', { class: `headline ${cls}` }, text);
    if (o) {
      switch (o.type) {
        case 'ends': {
          const tuple = o.V.k === 'tuple';
          parts.push(headline(o.result, t(o.result === 'proved' ? 'proved' : o.result === 'refuted' ? 'refuted' : 'undecided')));
          parts.push(h('p', { class: 'answer-echo' }, h('code', {}, `${t('echoV', { v: show(o.V) })}${o.R ? ` · ${t('echoR', { r: show(o.R) })}` : ''}`)));
          parts.push(this.checkList(o.details, tuple));
          if (o.result === 'undecided') parts.push(h('p', { class: 'note' }, t('undecidedBody')));
          const fail = this.firstFailure(o.details);
          if (fail?.lines?.length) parts.push(h('p', { class: 'note' }, t('linesRun')));
          if (o.result === 'refuted' && l.railHint && !o.R && fail?.s && (fail.id === 'bounded' || fail.id === 'decreasing'))
            parts.push(h('p', { class: 'note hint' }, l.railHint[lang()].replace('{s}', fmtState(l.vars, fail.s))));
          if (o.result === 'refuted' && l.kind === 'never') {
            const s0 = this.keepGoingSample();
            if (s0) parts.push(h('p', { class: 'note' }, t('keepsGoing', { s0: fmtState(l.vars, s0) })));
          }
          break;
        }
        case 'notAllowed':
          parts.push(headline('refuted', t('notAllowed', { start: pretty(l.startText ?? l.start) })));
          break;
        case 'ended':
          parts.push(headline('refuted', t(o.totalSteps > SIM_CAP ? 'endedLong' : 'ended', { k: o.totalSteps.toLocaleString() })));
          if (o.totalSteps === 0) parts.push(h('p', { class: 'note' }, t('zeroStep')));
          parts.push(h('p', { class: 'note' }, t('endedNot')));
          break;
        case 'cycle':
          parts.push(headline('proved', t('cycle', { k: (o.run.states.length - 1).toLocaleString(), s: fmtState(l.vars, o.run.states[o.run.states.length - 1]!) })));
          break;
        case 'needZone':
          parts.push(headline('pending', t('needZone', { cap: SIM_CAP.toLocaleString() })));
          break;
        case 'zone':
          parts.push(headline(o.result, o.result === 'proved' ? t('zoneProved', { s0: fmtState(l.vars, o.s0) }) : t(o.result === 'refuted' ? 'refuted' : 'undecided')));
          parts.push(this.checkList(o.details, false));
          if (o.result === 'undecided') parts.push(h('p', { class: 'note' }, t('undecidedBody')));
          break;
        case 'nobody':
          if (!o.correct) parts.push(headline('refuted', t('nobodyWrong')));
          break;
        case 'parseError':
          break;
      }
    }
    if (l.kind === 'open' && this.ses.tries >= 3 && !this.ses.solved) parts.push(h('p', { class: 'note collatz' }, t('collatzNote')));
    if (this.ses.solved) parts.push(this.solvedPanel());
    el.hidden = parts.length === 0;
    el.append(...parts.filter((x): x is Node => x !== null));
  }

  private solvedPanel(): HTMLElement {
    const l = this.level;
    const attempts = this.ses.marks.length + 1;
    const extra = l.kind === 'ends' ? t('starsExtraEnds', { par: l.par ?? 0 }) : t('starsExtraFirst');
    const btns: Node[] = [];
    if (l.id < LEVELS.length) btns.push(h('a', { class: 'btn primary', 'data-role': 'next', href: `#/level/${l.id + 1}` }, `${t('next')} →`));
    btns.push(h('button', { type: 'button', class: 'btn ghost', onclick: () => this.retry() }, t('retry')));
    if (this.daily) {
      const text = shareText(this.daily, l.id, [...this.ses.marks, '✅'], l.kind === 'ends' ? this.ses.solvedLength : null);
      const status = h('span', { class: 'copy-status' });
      btns.push(
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: async () => {
              const ok = await copyText(text);
              status.textContent = ok ? t('copied') : `${t('copyFailed')} ${text}`;
            },
          },
          t('copyResult'),
        ),
        status,
      );
    }
    return h(
      'div',
      { class: 'solved' },
      h('p', { class: 'solved-title' }, h('span', {}, t('solved')), ' ', h('span', { class: 'big-stars', 'aria-label': `${this.ses.stars}/3` }, starsText(this.ses.stars))),
      h('p', { class: 'note' }, t('attempts', { n: attempts }), l.kind === 'ends' && this.ses.solvedLength !== null ? ` · ${t('lengthPar', { len: this.ses.solvedLength, par: l.par ?? 0 })}` : ''),
      h('p', { class: 'note stars-rule' }, t('starsRule', { extra })),
      h('div', { class: 'actions wrap' }, ...btns),
    );
  }

  private retry(): void {
    const keep = this.ses;
    this.ses = fresh(this.level);
    if (this.daily) {
      this.ses.marks = keep.marks;
      this.ses.solved = keep.solved;
      this.ses.stars = keep.stars;
      this.ses.solvedLength = keep.solvedLength;
    }
    this.renderAll();
    this.renderStage();
    this.guide.kick();
  }

  // ------------------------------------------------------------ the stage

  private keepGoingSample(): State | null {
    for (const inp of sampleInputs(this.level)) {
      const s0 = initialState(this.level, inp);
      if (!walk(this.level, s0, 400).exited) return s0;
    }
    return null;
  }

  private safeV(): Expr | null {
    if (this.ses.verdict !== 'ends') return null;
    try {
      return parseV(this.level, this.ses.vText);
    } catch {
      return null;
    }
  }

  private schedulePreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.renderStage();
      this.renderChart();
    }, 200);
  }

  private replayBtn(): HTMLElement {
    return h('button', { type: 'button', class: 'pill ghost', 'data-role': 'replay', onclick: () => this.app.stage.replay() }, `↻ ${t('replay')}`);
  }

  private samplePills(): Node[] {
    const l = this.level;
    const inputs = sampleInputs(l);
    return [
      h('span', { class: 'pill-label' }, t('samplesLabel')),
      ...l.samples.map((smp, i) =>
        h(
          'button',
          {
            type: 'button',
            class: `pill${i === this.ses.sample ? ' on' : ''}${zeroSteps(l, inputs[i]!) ? ' zero' : ''}`,
            'data-sample': i,
            'aria-pressed': i === this.ses.sample ? 'true' : 'false',
            onclick: () => {
              this.ses.sample = i;
              this.renderStage();
            },
          },
          l.inputs.map((v) => `${v}=${String(smp[v]).replace('-', '−')}`).join(' '),
        ),
      ),
      this.replayBtn(),
    ];
  }

  private renderStage(): void {
    const stage = this.app.stage;
    const l = this.level;
    const live = this.safeV();
    const judged = this.ses.outcome;
    // A judged answer stays on the stage until the player types a different V.
    const o = judged?.type === 'ends' && live && show(live) !== show(judged.V) ? null : judged;
    const V = o?.type === 'ends' ? o.V : live;
    const sound = this.soundNext;
    this.soundNext = false;
    const onBeat = (b: Parameters<typeof follow>[1]) => {
      if (this.codeView) follow(this.codeView, b);
    };
    // while a tour is open on a wide screen, the scene keeps clear of its box
    const showIt = (scene: StageScene, caption: string, extra: { badge?: string; controls?: Node[] } = {}) =>
      stage.show(scene, { caption, onBeat, sound, loop: true, ...extra, ...this.guide.stageOpts() });

    if (o?.type === 'ends' && o.result === 'refuted' && l.kind === 'never') {
      const s0 = this.keepGoingSample();
      if (s0) return showIt(runScene(l, s0, null), t('keepsGoing', { s0: fmtState(l.vars, s0) }), { badge: '∞', controls: [this.replayBtn()] });
    }
    if (o?.type === 'ends' && o.result === 'refuted') {
      const d = this.firstFailure(o.details);
      if (d?.s) {
        const two = d.id === 'decreasing' || d.id === 'railStep';
        return showIt(cexScene(l, o.V, d.s, two ? d.s2 : undefined), `${t('sceneCex')}: ${this.cexText(d, o.V.k === 'tuple')}`, { badge: '✗', controls: [this.replayBtn()] });
      }
    }
    if (o?.type === 'cycle') return showIt(ringScene(l, o.run.states, o.run.cycleStart ?? 0), t('sceneRing'), { badge: '∞', controls: [this.replayBtn()] });
    if (o?.type === 'needZone' || o?.type === 'zone') {
      const proved = o.type === 'zone' && o.result === 'proved';
      const zone = proved && o.type === 'zone' ? show(o.Z) : undefined;
      return showIt(shaftScene(l, o.run.states, zone), proved && o.type === 'zone' ? t('zoneProved', { s0: fmtState(l.vars, o.s0) }) : t('sceneShaft'), {
        badge: o.type === 'zone' && o.result === 'refuted' ? '✗' : '∞',
        controls: [this.replayBtn()],
      });
    }
    if (o?.type === 'ended') {
      const states = o.run.states.slice(0, 61);
      const total = o.totalSteps;
      const scene: StageScene = { ...sceneBase(l), k: 'stairs', stairs: stairsOfRun(l, states, total), end: total <= 60 ? 'exit' : 'more', tuple: false, real: true, total };
      const caption = total === 0 ? `${t('zeroStep')} ${t('zeroStepDetail', { s: minus(fmtState(l.vars, o.s0)), check: guardCheck(l, o.s0) })}` : t('sceneEnded', { k: total.toLocaleString() });
      return showIt(scene, caption, { controls: [this.replayBtn()] });
    }
    // sample runs
    const inputs = sampleInputs(l);
    const idx = Math.min(this.ses.sample, inputs.length - 1);
    const inp = inputs[idx]!;
    const s0 = initialState(l, inp);
    const pills = this.ses.verdict === 'never' ? [] : this.samplePills();
    if (zeroSteps(l, inp)) {
      // The loop runs zero times: nothing to draw but the ground and the door, with or without V.
      return showIt(sampleScene(l, idx, V), `${t('zeroStep')} ${t('zeroStepDetail', { s: minus(fmtState(l.vars, s0)), check: guardCheck(l, s0) })}`, { controls: pills });
    }
    if (V) {
      const proved = o?.type === 'ends' && o.result === 'proved';
      return showIt(sampleScene(l, idx, V), `${t('sceneSample', { s0: fmtState(l.inputs, inp) })}${proved ? ` · ${t('sceneProved')}` : ''}`, { badge: proved ? '✓' : undefined, controls: pills });
    }
    const caption = this.ses.verdict === 'ends' ? t('sceneTypeV') : this.ses.verdict === 'never' ? t('sceneNeverIdle') : t('sceneNoVerdict');
    return showIt({ ...sceneBase(l), k: 'idle' }, caption, { controls: pills });
  }

  // ------------------------------------------------------------ graph (secondary)

  private renderChart(): void {
    if (!this.els.graph.open) return;
    const l = this.level;
    const o = this.ses.outcome;
    const V = o?.type === 'ends' ? o.V : this.safeV();
    const svg = this.chartSvg;
    const note = this.chartNote;
    const runStates = o?.type === 'ended' || o?.type === 'cycle' || o?.type === 'needZone' || o?.type === 'zone' ? o.run.states : null;
    if (V) {
      const runs = sampleInputs(l).map((inp) => ({ inp, ...walk(l, initialState(l, inp), DRAW_STEPS) }));
      const allV = runs.flatMap((r) => r.states.map((st) => evalRank(V, st)));
      const hmap = heightMap(allV);
      const tuple = V.k === 'tuple';
      const series: Series[] = runs.map((r) => {
        const pts = stairsWithV(l, V, r.states);
        return {
          label: l.inputs.map((v) => `${v}=${num(r.inp[v]!)}`).join(' '),
          points: pts.map((p, k) => ({ x: k, y: hmap(p.v!), below: p.bad === 'below', notDown: p.bad === 'flat' || p.bad === 'up', exit: !p.walking })),
          more: !r.exited,
        };
      });
      renderChart(svg, this.chartLegend, series, {
        ground: true,
        bands: tuple ? (f) => t('floorN', { n: f }) : undefined,
        stepLabel: t('stepAxis'),
        yLabel: tuple ? t('floorAxis', { a: show(V.k === 'tuple' ? V.items[0]! : V), b: V.k === 'tuple' ? V.items.slice(1).map((x) => show(x)).join(', ') : '' }) : `${t('stepsLeftAxis')} = ${show(V)}`,
        groundLabel: t('ground'),
      });
      svg.style.display = '';
      note.hidden = true;
    } else if (runStates) {
      const states = runStates.slice(0, 61);
      const series: Series[] = l.vars.map((v) => ({ label: v, points: states.map((st, k) => ({ x: k, y: Number(st[v]!) })), more: runStates.length > 61 || o?.type !== 'ended' }));
      renderChart(svg, this.chartLegend, series, { ground: false, stepLabel: t('stepAxis'), yLabel: '', groundLabel: '' });
      svg.style.display = '';
      note.hidden = true;
    } else {
      clear(svg);
      clear(this.chartLegend);
      svg.style.display = 'none';
      note.hidden = false;
      note.textContent = this.ses.verdict === 'never' ? t('chartNever') : t('chartEmpty');
    }
  }

  // ------------------------------------------------------------ actions

  chooseVerdict(v: Verdict): void {
    if (this.ses.busy) return;
    if (v !== this.ses.verdict) {
      this.ses.outcome = null;
      this.ses.zoneRun = null;
    }
    this.ses.verdict = v;
    this.ses.verdictOpen = false;
    this.ses.errors = [];
    this.lastField = v === 'never' ? 'Z' : 'V';
    if (v === 'nobody') {
      this.record(nobodyKnows(this.level));
      return;
    }
    this.renderCode();
    this.renderVerdict();
    this.renderProof();
    this.renderResult();
    this.renderStage();
    this.renderChart();
    const first = this.els.proof.querySelector<HTMLInputElement>('input');
    if (first && window.innerWidth >= 900) first.focus({ preventScroll: true });
    this.guide.kick();
  }

  private async submitEnds(): Promise<void> {
    if (this.ses.busy) return;
    const l = this.level;
    const errors: FieldError[] = [];
    try {
      parseV(l, this.ses.vText);
    } catch (e) {
      if (e instanceof ExprError) errors.push({ field: 'V', error: e });
    }
    try {
      parseR(l, this.ses.rText);
    } catch (e) {
      if (e instanceof ExprError) errors.push({ field: 'R', error: e });
    }
    this.ses.errors = errors;
    if (errors.length) {
      this.renderProof();
      return;
    }
    this.ses.busy = true;
    this.renderProofStatus();
    const judge = await this.app.judgeReady();
    if (!judge) {
      this.ses.busy = false;
      this.renderProofStatus();
      this.explainJudge();
      return;
    }
    this.renderProofStatus();
    const o = await proveEnds(judge, l, this.ses.vText, this.ses.rText);
    this.ses.busy = false;
    this.record(o);
  }

  private submitNever(): void {
    if (this.ses.busy) return;
    const parsed = parseInputs(this.level, this.ses.startTexts);
    this.ses.errors = parsed.errors;
    this.ses.zoneRun = null;
    if (!parsed.inputs) {
      this.renderProof();
      return;
    }
    this.record(runNever(this.level, this.ses.startTexts));
  }

  private async submitZone(): Promise<void> {
    if (this.ses.busy || !this.ses.zoneRun) return;
    const l = this.level;
    try {
      parseZ(l, this.ses.zText);
      this.ses.errors = [];
    } catch (e) {
      if (e instanceof ExprError) {
        this.ses.errors = [{ field: 'Z', error: e }];
        this.renderProof();
        return;
      }
      throw e;
    }
    this.ses.busy = true;
    this.renderProofStatus();
    const judge = await this.app.judgeReady();
    if (!judge) {
      this.ses.busy = false;
      this.renderProofStatus();
      this.explainJudge();
      return;
    }
    const { s0, run } = this.ses.zoneRun;
    const o = await proveZone(judge, l, s0, this.ses.zText, run);
    this.ses.busy = false;
    this.record(o);
  }

  private record(o: Outcome): void {
    const l = this.level;
    const app = this.app;
    this.ses.outcome = o;
    if (o.type !== 'parseError' && o.type !== 'nobody') {
      this.ses.judged = { V: this.ses.vText, R: this.ses.rText, Z: this.ses.zText, ...Object.fromEntries(Object.entries(this.ses.startTexts).map(([k, v]) => [`in:${k}`, v])) };
      this.selectOnRender = true;
    }
    this.ses.errors = o.type === 'parseError' ? o.errors : [];
    if (o.type === 'needZone') this.ses.zoneRun = { s0: o.s0, run: o.run };
    if (o.type === 'ended' || o.type === 'cycle' || o.type === 'notAllowed') this.ses.zoneRun = null;
    const failed = isFailure(o);
    const solved = isSolved(l, o);
    if (failed) this.ses.marks.push(attemptMark(o));
    if ((failed || solved) && o.type !== 'nobody') this.ses.tries++;
    if (solved) {
      const length = o.type === 'ends' ? o.length : null;
      const stars = starsFor(l, this.ses.marks.length + 1, length);
      if (!this.ses.solved || stars > this.ses.stars) {
        this.ses.stars = Math.max(this.ses.stars, stars);
        this.ses.solvedLength = length;
      }
      this.ses.solved = true;
      app.saved.best[l.id] = Math.max(app.saved.best[l.id] ?? 0, this.ses.stars);
      sfx.solve();
    } else if (failed) sfx.fail();
    if (this.daily && (failed || solved)) {
      const prev = app.saved.daily[this.daily];
      if (!prev?.solved) app.saved.daily[this.daily] = { level: l.id, marks: [...this.ses.marks], solved: this.ses.solved, length: this.ses.solvedLength };
    }
    app.persist();
    this.soundNext = o.type !== 'parseError' && o.type !== 'nobody';
    this.renderAll();
    this.renderStage();
    if (solved || failed) this.els.result.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    if (solved && l.kind === 'open') this.ending();
    this.guide.kick();
  }

  private explainJudge(): void {
    const st = this.app.z3;
    if (st.state === 'error') {
      openModal(t('judgeErrTitle'), [h('p', {}, judgeReason(st.reason))], [{ label: t('retry2'), primary: true, onClick: () => location.reload() }, { label: t('close') }]);
      return;
    }
    const msg = st.state === 'ready' ? `${t('judgeReady')} (z3-solver 5.3.1)` : t('judgeLoadingNote');
    openModal('Z3', [h('p', {}, msg)], [{ label: t('close'), primary: true }]);
  }

  private ending(): void {
    openModal(t('endTitle'), [h('p', {}, t('endBody1')), h('p', {}, t('endBody2')), h('p', {}, t('endBody3'))], [{ label: t('close'), primary: true }]);
  }
}

const minus = (s: string) => s.replace(/-/g, '−');

/** Why the judge could not start, in plain words. */
export function judgeReason(reason: 'isolation' | 'download' | 'init'): string {
  return t(reason === 'isolation' ? 'judgeErrIsolation' : reason === 'download' ? 'judgeErrDownload' : 'judgeErrInit');
}

/** [다시 시도]: a plain reload (the service worker and the download start again). */
export function retryButton(): HTMLButtonElement {
  return h('button', { type: 'button', class: 'btn small', 'data-role': 'retry', onclick: () => location.reload() }, t('retry2'));
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
