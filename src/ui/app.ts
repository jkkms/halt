// The game screen: code card, verdicts, proof inputs, results, building and chart, tutorial.
import { evalRank, ExprError, lexLess, show, type Expr } from '../core/expr.ts';
import {
  attemptMark,
  dailyLevelId,
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
  utcDateKey,
  type Detail,
  type FieldError,
  type Outcome,
  type Verdict,
} from '../core/game.ts';
import type { Judge } from '../core/judge.ts';
import { LEVELS, levelById, type Level } from '../core/levels.ts';
import { guardHolds, initialState, sampleInputs, SIM_CAP, step, type Run, type State } from '../core/sim.ts';
import { loadJudge, type Z3Status } from '../z3/browser.ts';
import { renderChart, type Series } from './chart.ts';
import { clear, h, s } from './dom.ts';
import { num, pretty, rank, state as fmtState, stateShort, starsText } from './format.ts';
import { defaultLang, lang, setLang, strings, t, type Key, type Lang } from './i18n.ts';
import { Coach, openModal } from './overlay.ts';
import { heightMap, Scene, type SceneModel, type StairPoint } from './scene.ts';
import { load, save, type Saved } from './store.ts';

interface Session {
  verdict: Verdict | null;
  marks: string[]; // one mark per failed attempt
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
  daily: string | null;
  tries: number; // definite attempts with "ends"/"never" (for the Collatz note)
  sample: number;
}

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
    daily: null,
    tries: 0,
    sample: 0,
  };
}

/** Walk up to n steps (no cycle detection; for drawing). */
function walk(level: Level, s0: State, n: number): { states: State[]; exited: boolean } {
  const states = [s0];
  let cur = s0;
  for (let k = 0; k < n; k++) {
    if (!guardHolds(level, cur)) return { states, exited: true };
    cur = step(level, cur).next;
    states.push(cur);
  }
  return { states, exited: !guardHolds(level, cur) };
}

function errorText(e: ExprError): string {
  const key = `err_${e.code}`;
  const base = key in strings() ? t(key as Key, e.args) : e.code;
  return e.code === 'empty' || e.code === 'emptyValue' || e.code === 'notInteger' || e.code === 'tooBig' ? base : base + t('errAt', { n: e.pos + 1 });
}

const CHECK_ORDER = ['railStart', 'railStep', 'bounded', 'decreasing', 'zoneStart', 'zoneGuard', 'zoneStep'];

type TutEvent = { type: 'verdict'; v: Verdict } | { type: 'outcome'; o: Outcome; v: string } | { type: 'level'; id: number };

interface TutStep {
  id: string;
  level: number;
  anchor: () => HTMLElement | null;
  text: Key;
  button?: 'next' | 'done';
  on?: (e: TutEvent) => string | null;
}

export class App {
  saved: Saved;
  level: Level;
  ses: Session;
  judge: Judge | null = null;
  z3: Z3Status = { state: 'waiting' };
  private waiters: ((j: Judge | null) => void)[] = [];
  private root: HTMLElement;
  private els!: {
    tagline: HTMLElement;
    badge: HTMLButtonElement;
    dailyBtn: HTMLButtonElement;
    helpBtn: HTMLButtonElement;
    langBtn: HTMLButtonElement;
    strip: HTMLElement;
    code: HTMLElement;
    verdict: HTMLElement;
    proof: HTMLElement;
    result: HTMLElement;
    sceneCard: HTMLElement;
    sceneTitle: HTMLElement;
    chartTitle: HTMLElement;
    chartSvg: SVGSVGElement;
    chartLegend: HTMLElement;
    chartEmpty: HTMLElement;
    footer: HTMLElement;
  };
  private scene!: Scene;
  private coach: Coach;
  private tut: { active: boolean; step: string } = { active: false, step: '' };
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.saved = load();
    setLang(this.saved.lang ?? defaultLang());
    const startId = this.saved.current && this.saved.current >= 1 && this.saved.current <= LEVELS.length ? this.saved.current : 1;
    this.level = levelById(startId);
    this.ses = fresh(this.level);
    this.coach = new Coach();
    this.buildShell();
    this.renderAll();
    setTimeout(() => this.startJudge(), 60);
    if (!this.saved.tutorialDone) this.startTutorial();
    else this.maybeIntro();
  }

  // ------------------------------------------------------------ judge

  private startJudge(): void {
    loadJudge((st) => {
      this.z3 = st;
      this.renderBadge();
      this.renderProofStatus();
    })
      .then((j) => {
        this.judge = j;
        for (const w of this.waiters.splice(0)) w(j);
      })
      .catch(() => {
        for (const w of this.waiters.splice(0)) w(null);
        this.renderBadge();
        this.renderProofStatus();
      });
  }

  /** The judge, once loaded; null if it cannot load in this browser (one retry per check). */
  private judgeReady(): Promise<Judge | null> {
    if (this.judge) return Promise.resolve(this.judge);
    const p = new Promise<Judge | null>((resolve) => this.waiters.push(resolve));
    if (this.z3.state === 'error') this.startJudge();
    return p;
  }

  // ------------------------------------------------------------ shell

  private buildShell(): void {
    const logo = s(
      'svg',
      { viewBox: '0 0 32 32', class: 'logo', 'aria-hidden': 'true' },
      s('path', { d: 'M3 6 h7 v6 h7 v6 h7 v6 h6', class: 'logo-stairs' }),
      s('line', { x1: 1, y1: 27, x2: 31, y2: 27, class: 'logo-ground' }),
      s('circle', { cx: 6.5, cy: 2.8, r: 2.2, class: 'logo-head' }),
    );
    const tagline = h('p', { class: 'tagline' });
    const badge = h('button', { type: 'button', class: 'judge-badge', onclick: () => this.explainJudge() });
    const dailyBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => this.goDaily() });
    const helpBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => this.openHelp() });
    const langBtn = h('button', { type: 'button', class: 'btn ghost', onclick: () => this.toggleLang() });
    const strip = h('nav', { class: 'level-strip' });
    const code = h('article', { class: 'card code-card' });
    const verdict = h('article', { class: 'card verdict-card' });
    const proof = h('article', { class: 'card proof-card' });
    const result = h('article', { class: 'card result-card', 'aria-live': 'polite' });
    const sceneTitle = h('h2', { class: 'card-title' });
    const sceneBox = h('div', { class: 'scene' });
    const sceneCard = h('article', { class: 'card scene-card' }, sceneTitle, sceneBox);
    const chartTitle = h('h2', { class: 'card-title' });
    const chartSvg = s('svg', { class: 'chart-svg', role: 'img' });
    const chartLegend = h('div', { class: 'legend' });
    const chartEmpty = h('p', { class: 'chart-empty' });
    const chartCard = h('article', { class: 'card chart-card' }, chartTitle, chartSvg, chartLegend, chartEmpty);
    const footer = h('footer', { class: 'footer' });
    this.root.append(
      h(
        'header',
        { class: 'topbar' },
        h('div', { class: 'brand' }, logo, h('div', {}, h('h1', {}, 'It Ends'), tagline)),
        h('div', { class: 'top-actions' }, badge, dailyBtn, helpBtn, langBtn),
      ),
      strip,
      h('main', { class: 'board' }, h('section', { class: 'col left' }, code, verdict, proof, result), h('section', { class: 'col right' }, sceneCard, chartCard)),
      footer,
    );
    this.els = { tagline, badge, dailyBtn, helpBtn, langBtn, strip, code, verdict, proof, result, sceneCard, sceneTitle, chartTitle, chartSvg, chartLegend, chartEmpty, footer };
    this.scene = new Scene(sceneBox, this.sceneText());
  }

  private sceneText() {
    return {
      ground: t('ground'),
      basement: t('basement'),
      stepCounter: (k: number) => t('stepCounter', { k }),
      floor: (n: number) => t('floorN', { n }),
      exit: t('exit'),
      forever: t('forever'),
      replay: t('replay'),
    };
  }

  private toggleLang(): void {
    const next: Lang = lang() === 'en' ? 'ko' : 'en';
    setLang(next);
    this.saved.lang = next;
    save(this.saved);
    this.scene.text = this.sceneText();
    this.renderAll();
    this.refreshTutorial();
  }

  // ------------------------------------------------------------ navigation

  go(id: number, daily: string | null = null): void {
    this.level = levelById(id);
    this.ses = fresh(this.level);
    this.ses.daily = daily;
    if (daily) {
      const rec = this.saved.daily[daily];
      if (rec && rec.level === id) {
        this.ses.marks = [...rec.marks];
        this.ses.solved = rec.solved;
        this.ses.solvedLength = rec.length;
        if (rec.solved) this.ses.stars = starsFor(this.level, rec.marks.length + 1, rec.length);
      }
    }
    this.saved.current = id;
    save(this.saved);
    this.renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.tutorialEvent({ type: 'level', id });
    this.maybeIntro();
  }

  private goDaily(): void {
    const key = utcDateKey(new Date());
    this.go(dailyLevelId(key, LEVELS.length), key);
  }

  // ------------------------------------------------------------ rendering

  private renderAll(): void {
    document.title = 'It Ends';
    this.els.tagline.textContent = t('tagline');
    this.els.dailyBtn.textContent = t('daily');
    this.els.helpBtn.textContent = t('howTo');
    this.els.langBtn.textContent = t('langToggle');
    this.els.langBtn.title = t('langToggleTitle');
    this.els.sceneTitle.textContent = t('sceneTitle');
    this.els.strip.setAttribute('aria-label', t('levels'));
    clear(this.els.footer);
    this.els.footer.append(
      'It Ends · KAIST CS424 · ',
      h('a', { href: 'https://github.com/Z3Prover/z3', target: '_blank', rel: 'noopener' }, 'Z3'),
      ' · MIT',
    );
    this.renderBadge();
    this.renderStrip();
    this.renderCode();
    this.renderVerdict();
    this.renderProof();
    this.renderResult();
    this.renderVisuals();
  }

  private renderBadge(): void {
    const b = this.els.badge;
    const st = this.z3;
    b.dataset.state = st.state;
    if (st.state === 'ready') b.textContent = `✓ ${t('judgeReady')}`;
    else if (st.state === 'error') b.textContent = `! ${t('judgeError')}`;
    else if (st.state === 'loading' && st.total) b.textContent = t('judgeLoadingPct', { pct: Math.min(99, Math.round(((st.loaded ?? 0) / st.total) * 100)) });
    else if (st.state === 'loading') b.textContent = t('judgeLoading');
    else b.textContent = t('judgeWaiting');
  }

  private explainJudge(): void {
    const st = this.z3;
    const msg = st.state === 'error' ? (st.reason === 'isolation' ? t('judgeErrIsolation') : st.reason === 'download' ? t('judgeErrDownload') : t('judgeErrInit')) : st.state === 'ready' ? t('judgeReady') + ' (z3-solver 5.3.1)' : t('judgeLoadingNote');
    openModal('Z3', [h('p', {}, msg)], [{ label: t('close'), primary: true }]);
  }

  private renderStrip(): void {
    const strip = this.els.strip;
    clear(strip);
    const today = dailyLevelId(utcDateKey(new Date()), LEVELS.length);
    for (const l of LEVELS) {
      const best = this.saved.best[l.id] ?? 0;
      strip.append(
        h(
          'button',
          {
            type: 'button',
            class: `chip${l.id === this.level.id ? ' current' : ''}${best ? ' done' : ''}`,
            'aria-current': l.id === this.level.id ? 'true' : null,
            title: `${t('levelN', { n: l.id })} · ${l.title[lang()]}${l.id === today ? ` · ${t('daily')}` : ''}`,
            onclick: () => this.go(l.id),
          },
          h('span', { class: 'chip-n' }, String(l.id)),
          h('span', { class: 'chip-stars', 'aria-label': `${best}/3` }, best ? '★'.repeat(best) : '·'),
          l.id === today ? h('span', { class: 'chip-daily', 'aria-hidden': 'true' }) : null,
        ),
      );
    }
    // Keep the current level in view inside the strip without scrolling the page.
    const cur = strip.querySelector<HTMLElement>('.current');
    if (cur) strip.scrollLeft = cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2;
  }

  private highlightLines(): Set<number> {
    const o = this.ses.outcome;
    if (!o || (o.type !== 'ends' && o.type !== 'zone')) return new Set();
    const d = this.firstFailure(o.details);
    return new Set(d?.lines ?? []);
  }

  private renderCode(): void {
    const l = this.level;
    const el = this.els.code;
    clear(el);
    const best = this.saved.best[l.id] ?? 0;
    el.append(
      h(
        'div',
        { class: 'level-head' },
        h('span', { class: 'level-num' }, `${t('levelN', { n: l.id })} / ${LEVELS.length}`),
        h('h2', { class: 'level-title' }, l.title[lang()]),
        h('span', { class: 'level-stars', title: t('bestStars', { stars: starsText(best) }) }, starsText(best)),
      ),
    );
    if (this.ses.daily) el.append(h('p', { class: 'daily-tag' }, t('dailyTag', { date: this.ses.daily })));
    if (l.note) el.append(h('p', { class: 'level-note' }, l.note[lang()]));
    const lit = this.highlightLines();
    const pre = h('pre', { class: 'code', 'aria-label': 'code' });
    l.code.split('\n').forEach((line, i) => {
      const row = h('span', { class: `code-line${lit.has(i) ? ' lit' : ''}` });
      for (const tok of line.split(/(\bwhile\b|\bif\b|\belse\b|:=|\b\d+\b)/)) {
        if (!tok) continue;
        if (/^(while|if|else)$/.test(tok)) row.append(h('span', { class: 'kw' }, tok));
        else if (/^\d+$/.test(tok)) row.append(h('span', { class: 'nm' }, tok));
        else if (tok === ':=') row.append(h('span', { class: 'op' }, tok));
        else row.append(tok);
      }
      pre.append(row, '\n');
    });
    el.append(pre);
    const startText = l.start === 'true' ? t('anyIntegers') : pretty(l.startText ?? l.start);
    const factsText = l.facts === 'true' ? t('none') : pretty(l.factsText ?? l.facts);
    el.append(
      h(
        'dl',
        { class: 'facts' },
        h('dt', {}, t('inputs')),
        h('dd', {}, h('code', {}, l.inputs.join(', ')), l.start === 'true' ? ` (${startText})` : null),
        l.start !== 'true' ? [h('dt', {}, t('start')), h('dd', {}, h('code', {}, startText))] : null,
        h('dt', {}, t('facts')),
        h('dd', {}, l.facts === 'true' ? factsText : h('code', {}, factsText)),
      ),
    );
    const fine: string[] = [];
    if (l.locals.length) fine.push(t('localsNote', { names: l.locals.join(', ') }));
    if (/[/%]/.test(l.code)) fine.push(t('intDomain'));
    if (fine.length) el.append(h('p', { class: 'fineprint' }, fine.join(' ')));
  }

  private renderVerdict(): void {
    const el = this.els.verdict;
    clear(el);
    const mk = (v: Verdict, label: string) =>
      h(
        'button',
        {
          type: 'button',
          class: `verdict v-${v}${this.ses.verdict === v ? ' on' : ''}`,
          'aria-pressed': this.ses.verdict === v ? 'true' : 'false',
          'data-verdict': v,
          onclick: () => this.chooseVerdict(v),
        },
        label,
      );
    const best = this.saved.best[this.level.id] ?? 0;
    const practice = this.practice();
    el.append(
      h('h3', { class: 'card-title' }, t('verdictQ')),
      h('div', { class: 'verdicts', role: 'group', 'aria-label': t('verdictQ') }, mk('ends', t('verdictEnds')), mk('never', t('verdictNever')), mk('nobody', t('verdictNobody'))),
      h('p', { class: 'help' }, t('verdictHelp')),
      h(
        'p',
        { class: 'attempt-line' },
        practice ? t('attemptsPractice') : t('attempts', { n: this.ses.marks.length + (this.ses.solved ? 1 : 0) }),
        best ? ` · ${t('bestStars', { stars: starsText(best) })}` : '',
      ),
    );
  }

  private fieldError(field: string): HTMLElement {
    const err = this.ses.errors.find((e) => e.field === field);
    return h('span', { class: 'field-error', role: err ? 'alert' : null }, err ? errorText(err.error) : '');
  }

  private input(key: string, value: string, placeholder: string, onInput: (v: string) => void, extra: Record<string, string> = {}): HTMLInputElement {
    const inp = h('input', {
      type: 'text',
      class: `answer${this.ses.errors.some((e) => e.field === key) ? ' invalid' : ''}`,
      'data-focus': key,
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder,
      ...extra,
    });
    inp.value = value;
    inp.addEventListener('input', () => onInput(inp.value));
    return inp;
  }

  private renderProof(): void {
    const el = this.els.proof;
    const focus = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const focusKey = focus?.dataset.focus;
    const sel = focus ? [focus.selectionStart, focus.selectionEnd] : null;
    clear(el);
    const l = this.level;
    const v = this.ses.verdict;
    el.hidden = v === null || v === 'nobody';
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
        {
          class: 'proof',
          novalidate: true,
          onsubmit: (e: Event) => {
            e.preventDefault();
            void this.submitEnds();
          },
        },
        h('label', { class: 'field' }, h('span', { class: 'field-name' }, t('stepsLeft'), ' ', h('var', {}, 'V'), ' ='), vIn, this.fieldError('V')),
      );
      if (railingAllowed(l)) {
        const rIn = this.input('R', this.ses.rText, t('rPlaceholder'), (x) => {
          this.ses.rText = x;
          updateMeta();
        });
        form.append(
          h(
            'label',
            { class: 'field' },
            h('span', { class: 'field-name' }, t('railing'), ' ', h('var', {}, 'R'), ' =', h('small', {}, ` (${t('optional')})`)),
            rIn,
            this.fieldError('R'),
          ),
        );
      }
      form.append(
        h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary', 'data-role': 'check' }, t('check')), meta, h('span', { class: 'proof-status' })),
        h('p', { class: 'help' }, t('syntaxHelp'), tuplesAllowed(l) ? ` ${t('syntaxTuple')}` : '', railingAllowed(l) ? ` ${t('railHelp')}` : ''),
      );
      el.append(form);
    } else if (v === 'never') {
      const startText = l.start === 'true' ? t('anyIntegers') : pretty(l.startText ?? l.start);
      const fields = l.inputs.map((name) =>
        h(
          'label',
          { class: 'mini-field' },
          h('code', {}, name), ' = ',
          this.input(`in:${name}`, this.ses.startTexts[name] ?? '', '0', (x) => {
            this.ses.startTexts[name] = x;
          }, { class: `answer small${this.ses.errors.some((e) => e.field === name) ? ' invalid' : ''}` }),
          this.fieldError(name),
        ),
      );
      el.append(
        h(
          'form',
          {
            class: 'proof',
            novalidate: true,
            onsubmit: (e: Event) => {
              e.preventDefault();
              this.submitNever();
            },
          },
          h('div', { class: 'field-name' }, t('startValues')),
          h('div', { class: 'mini-fields' }, ...fields),
          h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary' }, t('run'))),
          h('p', { class: 'help' }, l.start === 'true' ? t('runHelpAny') : t('runHelp', { start: startText })),
        ),
      );
      if (this.ses.zoneRun) {
        el.append(
          h(
            'form',
            {
              class: 'proof zone-form',
              novalidate: true,
              onsubmit: (e: Event) => {
                e.preventDefault();
                void this.submitZone();
              },
            },
            h(
              'label',
              { class: 'field' },
              h('span', { class: 'field-name' }, t('zone'), ' ', h('var', {}, 'Z'), ' ='),
              this.input('Z', this.ses.zText, t('zonePlaceholder'), (x) => {
                this.ses.zText = x;
              }),
              this.fieldError('Z'),
            ),
            h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary', 'data-role': 'check' }, t('check')), h('span', { class: 'proof-status' })),
            h('p', { class: 'help' }, t('zoneHelp'), ' ', t('railHelp').split('. ').slice(1).join('. ')),
          ),
        );
      }
    }
    this.renderProofStatus();
    if (focusKey) {
      const again = el.querySelector<HTMLInputElement>(`[data-focus="${CSS.escape(focusKey)}"]`);
      if (again) {
        again.focus({ preventScroll: true });
        const [a, b] = sel ?? [null, null];
        if (typeof a === 'number' && typeof b === 'number') again.setSelectionRange(a, b);
      }
    }
  }

  private renderProofStatus(): void {
    for (const st of this.els.proof.querySelectorAll<HTMLElement>('.proof-status')) {
      let text = '';
      if (this.ses.busy) text = this.judge ? t('checking') : t('waitingJudge');
      else if (this.z3.state === 'error') text = t('judgeError');
      else if (!this.judge) text = t('judgeLoadingNote');
      st.textContent = text;
      st.classList.toggle('busy', this.ses.busy);
    }
    for (const b of this.els.proof.querySelectorAll<HTMLButtonElement>('[data-role="check"]')) {
      b.disabled = this.ses.busy;
      b.textContent = this.ses.busy ? t('checking') : t('check');
    }
  }

  private firstFailure(details: Detail[]): Detail | undefined {
    return [...details].sort((a, b) => CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id)).find((d) => d.status === 'fail');
  }

  private checkName(d: Detail, tuple: boolean): string {
    switch (d.id) {
      case 'bounded':
        return t(tuple ? 'ckBoundedTuple' : 'ckBounded');
      case 'decreasing':
        return t(tuple ? 'ckDecreasingTuple' : 'ckDecreasing');
      case 'railStart':
        return t('ckRailStart');
      case 'railStep':
        return t('ckRailStep');
      case 'zoneStart':
        return t('ckZoneStart');
      case 'zoneGuard':
        return t('ckZoneGuard');
      case 'zoneStep':
        return t('ckZoneStep');
      default:
        return d.id;
    }
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
          const answer = `V = ${show(o.V)}${o.R ? `, R = ${show(o.R)}` : ''}`;
          parts.push(headline(o.result, t(o.result === 'proved' ? 'proved' : o.result === 'refuted' ? 'refuted' : 'undecided')));
          parts.push(h('p', { class: 'answer-echo' }, h('code', {}, answer)));
          parts.push(this.checkList(o.details, tuple));
          if (o.result === 'undecided') parts.push(h('p', { class: 'note' }, t('undecidedBody')));
          const fail = this.firstFailure(o.details);
          if (fail?.lines?.length) parts.push(h('p', { class: 'note' }, t('linesRun')));
          if (o.result === 'refuted' && l.id === 9 && !o.R && fail?.s) parts.push(h('p', { class: 'note hint' }, t('railHint', { s: fmtState(l.vars, fail.s) })));
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
    if (l.id < LEVELS.length) btns.push(h('button', { type: 'button', class: 'btn primary', 'data-role': 'next', onclick: () => this.go(l.id + 1) }, `${t('next')} →`));
    btns.push(h('button', { type: 'button', class: 'btn ghost', onclick: () => this.go(l.id, this.ses.daily) }, t('retry')));
    if (this.ses.daily) {
      const text = shareText(this.ses.daily, l.id, [...this.ses.marks, '✅'], l.kind === 'ends' ? this.ses.solvedLength : null);
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
      h('p', { class: 'note' }, this.practice() ? t('attemptsPractice') : t('attempts', { n: attempts }), l.kind === 'ends' && this.ses.solvedLength !== null ? ` · ${t('lengthPar', { len: this.ses.solvedLength, par: l.par ?? 0 })}` : ''),
      h('p', { class: 'note stars-rule' }, t('starsRule', { extra })),
      h('div', { class: 'actions wrap' }, ...btns),
    );
  }

  // ------------------------------------------------------------ building + chart

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

  /** While typing, the building and the chart follow the new V (no judge needed). */
  private schedulePreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderVisuals(), 180);
  }

  private stairPoints(V: Expr, states: State[], exited: boolean): StairPoint[] {
    const l = this.level;
    return states.map((st, k) => {
      const walking = k < states.length - 1 || !exited ? guardHolds(l, st) : false;
      const v = evalRank(V, st);
      let bad: StairPoint['bad'];
      if (walking && v.some((x) => x < 0n)) bad = 'below';
      else if (walking && k + 1 < states.length) {
        const v2 = evalRank(V, states[k + 1]!);
        if (!lexLess(v2, v)) bad = v2.every((x, i) => x === v[i]) ? 'flat' : 'up';
      }
      return { s: st, v, walking, bad };
    });
  }

  private sampleControls(): Node[] {
    const l = this.level;
    const pills = l.samples.map((smp, i) =>
      h(
        'button',
        {
          type: 'button',
          class: `pill${i === this.ses.sample ? ' on' : ''}`,
          onclick: () => {
            this.ses.sample = i;
            this.renderVisuals();
          },
        },
        l.inputs.map((v) => `${v}=${smp[v]}`).join(' '),
      ),
    );
    return [...pills, h('button', { type: 'button', class: 'pill ghost', onclick: () => this.scene.replay() }, `↻ ${t('replay')}`)];
  }

  private renderVisuals(): void {
    const l = this.level;
    const live = this.safeV();
    const judged = this.ses.outcome;
    // A judged answer stays on screen until the player types a different V.
    const o = judged?.type === 'ends' && live && show(live) !== show(judged.V) ? null : judged;
    const V = o?.type === 'ends' ? o.V : live;
    let model: SceneModel = { k: 'idle', caption: t('sceneIdle') };
    let controls: Node[] = [];
    const replay = [h('button', { type: 'button', class: 'pill ghost', onclick: () => this.scene.replay() }, `↻ ${t('replay')}`)];

    if (o?.type === 'ends' && o.result === 'refuted' && l.kind === 'never') {
      const s0 = this.keepGoingSample();
      if (s0) {
        const w = walk(l, s0, SIM_CAP);
        model = { k: 'shaft', states: w.states, caption: t('keepsGoing', { s0: fmtState(l.vars, s0) }), badge: '∞' };
        controls = replay;
      }
    } else if (o?.type === 'ends' && o.result === 'refuted') {
      const d = this.firstFailure(o.details);
      if (d?.s) {
        const pts: StairPoint[] = [];
        if (d.id === 'bounded' || d.id === 'railStart') pts.push({ s: d.s, v: evalRank(o.V, d.s), walking: guardHolds(l, d.s), bad: d.id === 'bounded' ? 'below' : undefined });
        else if (d.s2) {
          const v = evalRank(o.V, d.s);
          const v2 = evalRank(o.V, d.s2);
          pts.push({ s: d.s, v, walking: true, bad: d.id === 'decreasing' ? d.move : undefined }, { s: d.s2, v: v2, walking: guardHolds(l, d.s2) });
        }
        model = { k: 'stairs', points: pts, caption: `${t('sceneCex')}: ${this.cexText(d, o.V.k === 'tuple')}`, badge: '✗', door: false, loop: pts.length > 1 };
        controls = replay;
      }
    } else if (o?.type === 'cycle') {
      const st = o.run.states;
      const c = o.run.cycleStart ?? 0;
      model = { k: 'ring', prefix: st.slice(0, c), cycle: st.slice(c, st.length - 1), caption: t('sceneRing'), badge: '∞' };
    } else if (o?.type === 'needZone' || o?.type === 'zone') {
      const run = o.type === 'zone' ? o.run : o.run;
      model = { k: 'shaft', states: run.states, caption: o.type === 'zone' && o.result === 'proved' ? t('zoneProved', { s0: fmtState(l.vars, o.s0) }) : t('sceneShaft'), badge: o.type === 'zone' && o.result === 'refuted' ? '✗' : '∞' };
      controls = replay;
    } else if (o?.type === 'ended') {
      const states = o.run.states.slice(0, 60);
      const total = o.totalSteps;
      const pts: StairPoint[] = states.map((st, i) => ({ s: st, v: [BigInt(total - i)], walking: i < total }));
      model = { k: 'stairs', points: pts, caption: t('sceneEnded', { k: total.toLocaleString() }), door: total < 60, truncated: total >= 60, vName: t('leftInRun') };
      controls = replay;
    } else if (V) {
      const inputs = sampleInputs(l);
      const idx = Math.min(this.ses.sample, inputs.length - 1);
      const s0 = initialState(l, inputs[idx]!);
      const w = walk(l, s0, 60);
      const proved = o?.type === 'ends' && o.result === 'proved';
      model = {
        k: 'stairs',
        points: this.stairPoints(V, w.states, w.exited),
        caption: `${t('sceneSample', { s0: fmtState(l.inputs, inputs[idx]!) })}${proved ? ` · ${t('sceneProved')}` : ''}`,
        door: w.exited,
        badge: proved ? '✓' : undefined,
      };
      controls = this.sampleControls();
    }
    this.scene.show(model, controls);
    this.renderChart(V, o);
  }

  private renderChart(V: Expr | null, o: Outcome | null): void {
    const l = this.level;
    const svg = this.els.chartSvg;
    const empty = this.els.chartEmpty;
    const runStates = o?.type === 'ended' || o?.type === 'cycle' || o?.type === 'needZone' ? o.run.states : o?.type === 'zone' ? o.run.states : null;
    if (V) {
      this.els.chartTitle.textContent = t('chartTitle');
      const runs = sampleInputs(l).map((inp) => ({ inp, ...walk(l, initialState(l, inp), DRAW_STEPS) }));
      const allV = runs.flatMap((r) => r.states.map((st) => evalRank(V, st)));
      const hmap = heightMap(allV);
      const tuple = V.k === 'tuple';
      const series: Series[] = runs.map((r) => {
        const pts = this.stairPoints(V, r.states, r.exited);
        return {
          label: l.inputs.map((v) => `${v}=${num(r.inp[v]!)}`).join(' '),
          points: pts.map((p, k) => ({ x: k, y: hmap(p.v), below: p.bad === 'below', notDown: p.bad === 'flat' || p.bad === 'up', exit: !p.walking })),
          more: !r.exited,
        };
      });
      renderChart(svg, this.els.chartLegend, series, {
        ground: true,
        bands: tuple ? (f) => t('floorN', { n: f }) : undefined,
        stepLabel: t('stepAxis'),
        yLabel: tuple ? t('floorAxis', { a: show(V.k === 'tuple' ? V.items[0]! : V), b: V.k === 'tuple' ? V.items.slice(1).map((x) => show(x)).join(', ') : '' }) : `${t('stepsLeftAxis')} V = ${show(V)}`,
        groundLabel: t('ground'),
      });
      svg.style.display = '';
      empty.hidden = true;
    } else if (runStates) {
      this.els.chartTitle.textContent = t('chartTraceTitle');
      const states = runStates.slice(0, 61);
      const series: Series[] = l.vars.map((v) => ({ label: v, points: states.map((st, k) => ({ x: k, y: Number(st[v]!) })), more: runStates.length > 61 || o?.type !== 'ended' }));
      renderChart(svg, this.els.chartLegend, series, { ground: false, stepLabel: t('stepAxis'), yLabel: '', groundLabel: '' });
      svg.style.display = '';
      empty.hidden = true;
    } else {
      this.els.chartTitle.textContent = t('chartTitle');
      clear(svg);
      clear(this.els.chartLegend);
      svg.style.display = 'none';
      empty.hidden = false;
      empty.textContent = this.ses.verdict === 'never' ? t('chartNever') : t('chartEmpty');
    }
  }

  // ------------------------------------------------------------ actions

  private practice(): boolean {
    return this.tut.active && this.level.id <= 2;
  }

  chooseVerdict(v: Verdict): void {
    if (this.ses.busy) return;
    // A result belongs to the verdict it was given for.
    if (v !== this.ses.verdict) {
      this.ses.outcome = null;
      this.ses.zoneRun = null;
    }
    this.ses.verdict = v;
    this.ses.errors = [];
    if (v === 'nobody') {
      this.record(nobodyKnows(this.level));
    } else {
      this.renderCode();
      this.renderVerdict();
      this.renderProof();
      this.renderResult();
      this.renderVisuals();
      const first = this.els.proof.querySelector<HTMLInputElement>('input');
      if (first && window.innerWidth >= 760) first.focus({ preventScroll: true });
    }
    this.tutorialEvent({ type: 'verdict', v });
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
    const judge = await this.judgeReady();
    if (!judge) {
      this.ses.busy = false;
      this.renderProofStatus();
      this.explainJudge();
      return;
    }
    this.renderProofStatus();
    const o = await proveEnds(judge, l, this.ses.vText, this.ses.rText);
    this.ses.busy = false;
    if (this.level !== l) return;
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
    const judge = await this.judgeReady();
    if (!judge) {
      this.ses.busy = false;
      this.renderProofStatus();
      this.explainJudge();
      return;
    }
    this.renderProofStatus();
    const { s0, run } = this.ses.zoneRun;
    const o = await proveZone(judge, l, s0, this.ses.zText, run);
    this.ses.busy = false;
    if (this.level !== l) return;
    this.record(o);
  }

  private record(o: Outcome): void {
    const l = this.level;
    this.ses.outcome = o;
    this.ses.errors = o.type === 'parseError' ? o.errors : [];
    if (o.type === 'needZone') this.ses.zoneRun = { s0: o.s0, run: o.run };
    if (o.type === 'ended' || o.type === 'cycle' || o.type === 'notAllowed') this.ses.zoneRun = null;
    const failed = isFailure(o);
    const solved = isSolved(l, o);
    if (failed && !this.practice()) this.ses.marks.push(attemptMark(o));
    if ((failed || solved) && o.type !== 'nobody') this.ses.tries++;
    if (solved) {
      const length = o.type === 'ends' ? o.length : null;
      const attempts = this.practice() ? 1 : this.ses.marks.length + 1;
      const stars = starsFor(l, attempts, length);
      if (!this.ses.solved || stars > this.ses.stars) {
        this.ses.stars = Math.max(this.ses.stars, stars);
        this.ses.solvedLength = length;
      }
      this.ses.solved = true;
      this.saved.best[l.id] = Math.max(this.saved.best[l.id] ?? 0, this.ses.stars);
    }
    if (this.ses.daily && (failed || solved)) {
      const prev = this.saved.daily[this.ses.daily];
      if (!prev?.solved) this.saved.daily[this.ses.daily] = { level: l.id, marks: [...this.ses.marks], solved: this.ses.solved, length: this.ses.solvedLength };
    }
    save(this.saved);
    this.renderStrip();
    this.renderCode();
    this.renderVerdict();
    this.renderProof();
    this.renderResult();
    this.renderVisuals();
    if (solved) this.els.result.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    this.tutorialEvent({ type: 'outcome', o, v: this.ses.vText.trim() });
    if (solved && l.kind === 'open') this.ending();
  }

  // ------------------------------------------------------------ dialogs

  private ending(): void {
    openModal(t('endTitle'), [h('p', {}, t('endBody1')), h('p', {}, t('endBody2')), h('p', {}, t('endBody3'))], [{ label: t('close'), primary: true }]);
  }

  private intro(id: number): void {
    const [title, body]: [Key, Key] = id === 5 ? ['introNeverTitle', 'introNever'] : id === 9 ? ['introRailTitle', 'introRail'] : ['introTupleTitle', 'introTuple'];
    const example =
      id === 10
        ? h('div', { class: 'intro-art' }, introFloors())
        : id === 9
          ? h('div', { class: 'intro-art' }, introRailing())
          : h('div', { class: 'intro-art' }, introRing());
    openModal(t(title), [example, h('p', {}, t(body))], [{ label: t('gotIt'), primary: true }]);
  }

  private maybeIntro(): void {
    const id = this.level.id;
    if (![5, 9, 10].includes(id) || this.saved.introsSeen.includes(id) || this.tut.active) return;
    this.saved.introsSeen.push(id);
    save(this.saved);
    setTimeout(() => this.intro(id), 250);
  }

  private openHelp(): void {
    const S = strings();
    const table = (rows: [string, string][]) => h('table', { class: 'concepts' }, h('tbody', {}, ...rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b)))));
    const topic = (id: number, key: Key) => h('button', { type: 'button', class: 'pill ghost', onclick: () => this.intro(id) }, t(key));
    openModal(
      t('helpTitle'),
      [
        h('p', {}, t('helpIntro')),
        h('h3', {}, t('helpVerdicts')),
        table([
          [t('verdictEnds'), t('helpEndsRow')],
          [t('verdictNever'), t('helpNeverRow')],
          [t('verdictNobody'), t('helpNobodyRow')],
        ]),
        h('h3', {}, t('helpConcepts')),
        table(S.helpConceptRows),
        h('h3', {}, t('helpSyntax')),
        h('p', {}, t('helpSyntaxBody')),
        h('h3', {}, t('helpStars')),
        h('p', {}, t('helpStarsBody')),
        h('h3', {}, t('helpDaily')),
        h('p', {}, t('helpDailyBody')),
        h('h3', {}, t('helpTopics')),
        h('div', { class: 'actions wrap' }, topic(5, 'introNeverTitle'), topic(9, 'introRailTitle'), topic(10, 'introTupleTitle')),
      ],
      [
        { label: t('helpReplay'), onClick: () => this.replayTutorial() },
        { label: t('helpClose'), primary: true },
      ],
      { wide: true },
    );
  }

  // ------------------------------------------------------------ tutorial (levels 1-3, on the real board)

  private tutSteps(): TutStep[] {
    const q = <T extends Element>(sel: string) => () => this.root.querySelector<T>(sel) as HTMLElement | null;
    const endsOutcome = (e: TutEvent) => (e.type === 'outcome' && e.o.type === 'ends' ? e.o : null);
    const proved = (e: TutEvent) => endsOutcome(e)?.result === 'proved';
    const afterZero = (e: TutEvent) => {
      const o = endsOutcome(e);
      if (!o) return null;
      if (o.result === 'proved') return 'pass';
      return o.details.some((d) => d.id === 'decreasing' && d.move === 'flat') ? 'flat' : 'tryN';
    };
    // The first two steps also follow a player who acts before pressing "Next".
    const early = (e: TutEvent) => (e.type === 'verdict' && e.v === 'ends' ? 'zero' : afterZero(e));
    return [
      { id: 'building', level: 1, anchor: () => this.els.sceneCard, text: 'tutBuilding', button: 'next', on: early },
      { id: 'verdict', level: 1, anchor: q('.verdicts'), text: 'tutVerdict', on: early },
      { id: 'zero', level: 1, anchor: q('[data-focus="V"]'), text: 'tutZero', on: afterZero },
      { id: 'flat', level: 1, anchor: () => this.els.result, text: 'tutFlat', on: (e) => (proved(e) ? 'pass' : endsOutcome(e) ? 'tryN' : null) },
      { id: 'tryN', level: 1, anchor: () => this.els.result, text: 'tutTryN', on: (e) => (proved(e) ? 'pass' : null) },
      { id: 'pass', level: 1, anchor: () => this.els.result.querySelector('.checks') as HTMLElement | null, text: 'tutPass', button: 'next' },
      { id: 'toL2', level: 1, anchor: q('[data-role="next"]'), text: 'tutToNext', on: (e) => (e.type === 'level' && e.id === 2 ? 'l2' : null) },
      {
        id: 'l2',
        level: 2,
        anchor: () => this.els.code,
        text: 'tutL2',
        on: (e) => {
          const o = endsOutcome(e);
          if (!o || e.type !== 'outcome') return null;
          if (o.result === 'proved') return 'stars';
          return e.v.replace(/\s/g, '') === 'n' ? 'l2n' : 'l2any';
        },
      },
      {
        id: 'l2n',
        level: 2,
        anchor: () => this.els.result,
        text: 'tutL2n',
        on: (e) => {
          const o = endsOutcome(e);
          if (!o || e.type !== 'outcome') return null;
          if (o.result === 'proved') return 'stars';
          return e.v.replace(/\s/g, '') === 'i' ? 'l2i' : 'l2any';
        },
      },
      { id: 'l2i', level: 2, anchor: () => this.els.result, text: 'tutL2i', on: (e) => (proved(e) ? 'stars' : null) },
      { id: 'l2any', level: 2, anchor: () => this.els.result, text: 'tutL2Any', on: (e) => (proved(e) ? 'stars' : null) },
      { id: 'stars', level: 2, anchor: () => this.els.result.querySelector('.solved') as HTMLElement | null, text: 'tutStars', button: 'next' },
      { id: 'toL3', level: 2, anchor: q('[data-role="next"]'), text: 'tutToNext', on: (e) => (e.type === 'level' && e.id === 3 ? 'l3' : null) },
      { id: 'l3', level: 3, anchor: () => this.els.verdict, text: 'tutL3', button: 'done' },
    ];
  }

  private startTutorial(): void {
    this.tut = { active: true, step: 'building' };
    if (this.level.id !== 1) this.go(1);
    this.renderVerdict();
    this.refreshTutorial();
  }

  private replayTutorial(): void {
    this.saved.tutorialDone = false;
    save(this.saved);
    this.tut = { active: true, step: 'building' };
    this.go(1);
    this.refreshTutorial();
  }

  private endTutorial(): void {
    this.tut = { active: false, step: '' };
    this.saved.tutorialDone = true;
    save(this.saved);
    this.coach.hide();
    this.renderVerdict();
    this.maybeIntro();
  }

  private advance(id: string): void {
    this.tut.step = id;
    this.refreshTutorial();
  }

  private tutorialEvent(e: TutEvent): void {
    if (!this.tut.active) return;
    const steps = this.tutSteps();
    const st = steps.find((x) => x.id === this.tut.step);
    if (e.type === 'level' && st && e.id > st.level) {
      // The player moved on to a later tutorial level: continue there.
      const first = steps.find((x) => x.level === e.id);
      if (first) return this.advance(first.id);
    }
    const next = st?.on?.(e);
    if (next) this.advance(next);
    else this.refreshTutorial();
  }

  private refreshTutorial(): void {
    if (!this.tut.active) return;
    const steps = this.tutSteps();
    const st = steps.find((x) => x.id === this.tut.step);
    if (!st || st.level !== this.level.id) {
      this.coach.hide();
      return;
    }
    const actions: Node[] = [];
    if (st.button === 'next') {
      const i = steps.indexOf(st);
      actions.push(h('button', { type: 'button', class: 'btn primary small', onclick: () => this.advance(steps[i + 1]!.id) }, t('tutNext')));
    }
    if (st.button === 'done') actions.push(h('button', { type: 'button', class: 'btn primary small', onclick: () => this.endTutorial() }, t('tutDone')));
    if (st.button !== 'done') actions.push(h('button', { type: 'button', class: 'btn ghost small', onclick: () => this.endTutorial() }, t('tutSkip')));
    requestAnimationFrame(() => this.coach.show(st.anchor(), t(st.text), actions));
  }
}

async function copyText(text: string): Promise<boolean> {
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

// Small illustrations for the intros.
function introRing(): SVGSVGElement {
  return s(
    'svg',
    { viewBox: '0 0 220 90', class: 'intro-svg', 'aria-hidden': 'true' },
    s('circle', { cx: 70, cy: 45, r: 30, class: 'ring' }),
    s('text', { x: 70, y: 51, class: 'forever', 'text-anchor': 'middle' }, '∞'),
    s('path', { d: 'M140 15 h18 v14 h18 v14 h18 v14 h18', class: 'stairs endless' }),
    s('text', { x: 196, y: 84, class: 'lbl', 'text-anchor': 'middle' }, '…'),
  );
}

function introRailing(): SVGSVGElement {
  return s(
    'svg',
    { viewBox: '0 0 220 90', class: 'intro-svg', 'aria-hidden': 'true' },
    s('path', { d: 'M20 18 h36 v18 h36 v18 h36 v18 h36', class: 'stairs' }),
    s('path', { d: 'M20 6 L200 60', class: 'railing' }),
    s('line', { x1: 0, y1: 72, x2: 220, y2: 72, class: 'ground-line' }),
  );
}

function introFloors(): SVGSVGElement {
  const g = s('svg', { viewBox: '0 0 220 90', class: 'intro-svg', 'aria-hidden': 'true' });
  g.append(s('rect', { x: 10, y: 8, width: 200, height: 30, class: 'band' }), s('line', { x1: 10, y1: 68, x2: 210, y2: 68, class: 'ground-line' }));
  g.append(s('path', { d: 'M20 12 h22 v8 h22 v8 h22 v8 M86 36 L96 40 h22 v8 h22 v8 h22 v8', class: 'stairs' }));
  g.append(s('text', { x: 205, y: 28, class: 'lbl', 'text-anchor': 'end' }, 'a'), s('text', { x: 205, y: 60, class: 'lbl', 'text-anchor': 'end' }, 'a − 1'));
  return g;
}
