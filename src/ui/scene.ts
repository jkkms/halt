// The flat side view of v0.1 (SVG). v0.2 uses it only when WebGL is not available.
import { clear, h, s } from './dom.ts';
import { rank, stateShort } from './format.ts';
import type { State } from '../core/sim.ts';
import { heightMap } from '../core/stage.ts';

export interface StairPoint {
  s: State;
  v: bigint[];
  /** false for the state where the loop has stopped (V does not matter there). */
  walking: boolean;
  /** 'below': V < 0 here while walking. 'flat'/'up': the step from here to the next point does not go down. */
  bad?: 'below' | 'flat' | 'up';
}

export interface SceneText {
  ground: string;
  basement: string;
  stepCounter: (k: number) => string;
  floor: (n: number) => string;
  exit: string;
  forever: string;
  replay: string;
}

export type SceneModel =
  | { k: 'idle'; caption: string }
  | { k: 'stairs'; points: StairPoint[]; caption: string; badge?: string; door: boolean; loop?: boolean; truncated?: boolean; vName?: string }
  | { k: 'ring'; prefix: State[]; cycle: State[]; caption: string; badge?: string }
  | { k: 'shaft'; states: State[]; caption: string; badge?: string };

const W = 400;
const H = 250;
const TOP = 58;
const BOTTOM = 226;
const LEFT = 46;
const RIGHT = 26;
const MAX_DRAW = 60;

export { heightMap };

function niceStep(range: number, maxTicks: number): number {
  const raw = range / Math.max(1, maxTicks);
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
  return Math.max(1, 10 * p);
}

function walker(x: number, y: number, bad: boolean): SVGGElement {
  return s(
    'g',
    { class: `walker${bad ? ' bad' : ''}`, transform: `translate(${x} ${y})` },
    s('circle', { cx: 0, cy: -17, r: 4.5 }),
    s('path', { d: 'M0 -12 L0 -5 M0 -5 L-4 0 M0 -5 L4 0 M-4 -10 L4 -10', fill: 'none' }),
  );
}

export class Scene {
  root: HTMLElement;
  svg: SVGSVGElement;
  captionEl: HTMLElement;
  controls: HTMLElement;
  text: SceneText;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private model: SceneModel | null = null;

  constructor(root: HTMLElement, text: SceneText) {
    this.root = root;
    this.text = text;
    this.svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'scene-svg', role: 'img' });
    this.captionEl = h('p', { class: 'scene-caption', 'aria-live': 'polite' });
    this.controls = h('div', { class: 'scene-controls' });
    root.append(this.svg, this.captionEl, this.controls);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  show(model: SceneModel, controls: Node[] = []): void {
    this.stop();
    this.model = model;
    clear(this.svg);
    clear(this.controls);
    this.captionEl.textContent = model.caption;
    this.svg.setAttribute('aria-label', model.caption);
    if (model.k === 'idle') this.idle();
    else if (model.k === 'stairs') this.stairs(model);
    else if (model.k === 'ring') this.ring(model);
    else this.shaft(model);
    this.controls.append(...controls);
  }

  replay(): void {
    if (this.model) this.show(this.model, [...this.controls.childNodes]);
  }

  private reduced(): boolean {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private ground(groundY: number, label = true): void {
    this.svg.append(
      s('rect', { x: 0, y: 0, width: W, height: groundY, class: 'sky' }),
      s('rect', { x: 0, y: groundY, width: W, height: H - groundY, class: 'earth' }),
      s('line', { x1: 0, y1: groundY, x2: W, y2: groundY, class: 'ground-line' }),
    );
    if (label) {
      this.svg.append(s('text', { x: W - 6, y: groundY + 13, class: 'lbl ground-lbl', 'text-anchor': 'end' }, `▲ ${this.text.ground}`));
      if (groundY + 28 < H) this.svg.append(s('text', { x: W - 6, y: groundY + 27, class: 'lbl basement-lbl', 'text-anchor': 'end' }, `▼ ${this.text.basement}`));
    }
  }

  private counter(text: string, sub = '', dark = false): { set: (a: string, b?: string) => void } {
    const t1 = s('text', { x: 10, y: 18, class: `counter${dark ? ' light' : ''}` }, text);
    const t2 = s('text', { x: 10, y: 31, class: `lbl state-lbl${dark ? ' light' : ''}` }, sub);
    this.svg.append(s('rect', { x: 4, y: 4, width: W - 44, height: 34, rx: 6, class: dark ? 'counter-bg dark' : 'counter-bg' }), t1, t2);
    return {
      set: (a, b = '') => {
        t1.textContent = a;
        t2.textContent = b;
      },
    };
  }

  private idle(): void {
    const groundY = 196;
    this.ground(groundY);
    const steps = 5;
    const w = 42;
    const x0 = 110;
    const top = 70;
    const dy = (groundY - top) / steps;
    this.svg.append(s('rect', { x: x0 - 10, y: top - 26, width: steps * w + 20, height: groundY - top + 26, class: 'facade' }));
    let d = `M${x0} ${top}`;
    for (let i = 0; i < steps; i++) d += ` h${w} v${dy}`;
    this.svg.append(s('path', { d, class: 'stairs unknown' }));
    this.svg.append(s('text', { x: x0 - 16, y: top + 4, class: 'q', 'text-anchor': 'end' }, 'V = ?'));
    this.svg.append(walker(x0 + w / 2, top, false));
  }

  private stairs(m: Extract<SceneModel, { k: 'stairs' }>): void {
    const pts = m.points.slice(0, MAX_DRAW);
    const truncated = m.truncated || m.points.length > MAX_DRAW;
    const hmap = heightMap(pts.map((p) => p.v));
    const tuple = pts.some((p) => p.v.length > 1);
    const hs = pts.map((p) => hmap(p.v));
    const floors = tuple ? pts.map((p) => Number(p.v[0])) : [];
    let hMin = Math.min(0, ...hs, ...(tuple ? floors : []));
    let hMax = Math.max(1, ...hs, ...(tuple ? floors.map((f) => f + 1) : []));
    if (!Number.isFinite(hMin) || !Number.isFinite(hMax)) {
      hMin = 0;
      hMax = 1;
    }
    const basementRoom = hMin < 0 ? 0 : 28;
    const avail = BOTTOM - basementRoom - TOP;
    const unit = Math.min(avail / (hMax - hMin || 1), tuple ? avail : 34);
    // When there is spare height (few, small values), center the stairs vertically.
    const spare = avail - (hMax - hMin) * unit;
    const groundY = BOTTOM - basementRoom + hMin * unit - spare / 2;
    const yOf = (hh: number) => groundY - hh * unit;
    this.ground(groundY);

    const slots = pts.length + (m.door ? 1 : 0);
    const stepW = Math.min(46, (W - LEFT - RIGHT) / Math.max(1, slots));
    const xOf = (k: number) => LEFT + k * stepW;

    // building and floor lines
    const topY = Math.max(44, Math.min(...hs.map(yOf)) - 22);
    if (groundY - topY > 4) this.svg.append(s('rect', { x: LEFT - 8, y: topY, width: pts.length * stepW + 16, height: groundY - topY, class: 'facade' }));
    if (tuple) {
      const f0 = Math.floor(hMin);
      const f1 = Math.ceil(hMax);
      for (let f = f0; f < f1; f++) {
        const y1 = yOf(f + 1);
        const y2 = yOf(f);
        if (f % 2 === 0) this.svg.append(s('rect', { x: LEFT - 8, y: y1, width: W - LEFT - 4, height: y2 - y1, class: 'band' }));
        if (y2 - y1 >= 11) this.svg.append(s('text', { x: LEFT - 10, y: (y1 + y2) / 2 + 4, class: 'lbl axis-lbl', 'text-anchor': 'end' }, this.text.floor(f)));
      }
    } else {
      const step = niceStep(hMax - hMin, Math.floor((BOTTOM - TOP) / 22));
      for (let v = Math.ceil(hMin / step) * step; v <= hMax + 1e-9; v += step) {
        const y = yOf(v);
        this.svg.append(s('line', { x1: LEFT - 6, y1: y, x2: W - 4, y2: y, class: v === 0 ? 'tick zero' : 'tick' }));
        this.svg.append(s('text', { x: LEFT - 10, y: y + 4, class: 'lbl axis-lbl', 'text-anchor': 'end' }, String(v)));
      }
    }

    // stairs
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]!;
      const x = xOf(k);
      const y = yOf(hs[k]!);
      const treadClass = !p.walking ? 'tread done' : p.bad === 'below' ? 'tread bad' : 'tread';
      this.svg.append(s('line', { x1: x, y1: y, x2: x + stepW, y2: y, class: treadClass }));
      if (k + 1 < pts.length) {
        const y2 = yOf(hs[k + 1]!);
        const bad = p.bad === 'flat' || p.bad === 'up';
        this.svg.append(s('line', { x1: x + stepW, y1: y, x2: x + stepW, y2, class: bad ? 'riser bad' : 'riser' }));
        if (bad && p.bad === 'flat') this.svg.append(s('text', { x: x + stepW, y: y - 8, class: 'lbl bad-lbl', 'text-anchor': 'middle' }, '→'));
        if (bad && p.bad === 'up') this.svg.append(s('text', { x: x + stepW + 7, y: (y + y2) / 2 + 4, class: 'lbl bad-lbl' }, '↑'));
      }
      const label = p.walking ? rank(p.v) : '·';
      if (label.length * 6.3 <= stepW - 2) {
        this.svg.append(s('text', { x: x + stepW / 2, y: y + 13, class: `lbl v-lbl${p.walking ? '' : ' done'}`, 'text-anchor': 'middle' }, label));
      }
    }
    if (truncated) this.svg.append(s('text', { x: xOf(pts.length) + 4, y: yOf(hs[hs.length - 1]!) + 4, class: 'lbl' }, '…'));
    if (m.door) {
      const dx = xOf(pts.length) + stepW * 0.3;
      this.svg.append(
        s('rect', { x: dx, y: groundY - 26, width: 16, height: 26, rx: 2, class: 'door' }),
        s('text', { x: dx + 8, y: groundY - 30, class: 'lbl', 'text-anchor': 'middle' }, this.text.exit),
      );
    }
    if (m.badge) this.svg.append(s('text', { x: W - 8, y: 18, class: 'badge-lbl', 'text-anchor': 'end' }, m.badge));

    const counter = this.counter('', '');
    const fig = walker(xOf(0) + stepW / 2, yOf(hs[0] ?? 0), false);
    this.svg.append(fig);
    const place = (k: number) => {
      const p = pts[k]!;
      const bad = !!p.bad;
      fig.setAttribute('transform', `translate(${xOf(k) + stepW / 2} ${yOf(hs[k]!)})`);
      fig.setAttribute('class', `walker${bad ? ' bad' : ''}`);
      counter.set(`${this.text.stepCounter(k)} · ${m.vName ?? 'V'} = ${p.walking ? rank(p.v) : '—'}`, stateShort(Object.keys(p.s), p.s));
    };
    place(0);
    if (pts.length === 0) return;
    const per = m.loop ? 1100 : Math.max(90, Math.min(600, 6000 / pts.length));
    if (this.reduced()) {
      place(pts.length - 1);
      return;
    }
    let k = 0;
    const tick = () => {
      k++;
      if (k < pts.length) {
        place(k);
        this.timer = setTimeout(tick, per);
      } else if (m.door) {
        fig.setAttribute('transform', `translate(${xOf(pts.length) + stepW * 0.3 + 8} ${groundY})`);
        fig.setAttribute('class', 'walker out');
        if (m.loop) this.timer = setTimeout(restart, 1600);
      } else if (m.loop) {
        this.timer = setTimeout(restart, 900);
      }
    };
    const restart = () => {
      k = 0;
      place(0);
      this.timer = setTimeout(tick, per);
    };
    this.timer = setTimeout(tick, per);
  }

  private ring(m: Extract<SceneModel, { k: 'ring' }>): void {
    const groundY = 236;
    this.ground(groundY, false);
    const cycle = m.cycle.slice(0, 10);
    const prefix = m.prefix.slice(-3);
    const cx = prefix.length ? 262 : 200;
    const cy = 128;
    const r = cycle.length === 1 ? 46 : 74;
    const vars = Object.keys(cycle[0] ?? {});
    const nodes: [number, number][] = [];
    this.svg.append(s('circle', { cx, cy, r, class: 'ring' }));
    for (let i = 0; i < cycle.length; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / cycle.length;
      nodes.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    // arrow heads along the ring
    const arrows = Math.max(3, cycle.length);
    for (let i = 0; i < arrows; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / arrows;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      const deg = (a * 180) / Math.PI + 90;
      this.svg.append(s('path', { d: 'M-5 -4 L4 0 L-5 4', class: 'ring-arrow', transform: `translate(${x} ${y}) rotate(${deg})` }));
    }
    const label = (x: number, y: number, st: State, cls = '') => {
      const txt = stateShort(vars, st);
      const w = Math.min(170, 12 + txt.length * 6.2);
      this.svg.append(
        s('rect', { x: x - w / 2, y: y - 10, width: w, height: 20, rx: 6, class: `node ${cls}` }),
        s('text', { x, y: y + 4, class: 'lbl node-lbl', 'text-anchor': 'middle' }, txt),
      );
    };
    const path: [number, number][] = [];
    prefix.forEach((st, i) => {
      const x = 30 + i * 48;
      const y = 60 + i * 26;
      path.push([x, y]);
      label(x + 20, y - 18, st, 'prefix');
    });
    if (prefix.length) {
      const [px, py] = path[path.length - 1]!;
      this.svg.append(s('line', { x1: px, y1: py, x2: nodes[0]![0] - 8, y2: nodes[0]![1], class: 'lead' }));
    }
    cycle.forEach((st, i) => label(nodes[i]![0], nodes[i]![1], st));
    this.svg.append(s('text', { x: cx, y: cy + 5, class: 'forever', 'text-anchor': 'middle' }, '∞'));
    if (m.badge) this.svg.append(s('text', { x: W - 8, y: 18, class: 'badge-lbl', 'text-anchor': 'end' }, m.badge));
    const counter = this.counter('');
    const fig = walker(0, 0, false);
    this.svg.append(fig);
    const seq: [number, number][] = [...path, ...nodes];
    const loopFrom = path.length;
    let k = 0;
    let idx = 0;
    const place = () => {
      const [x, y] = seq[idx]!;
      fig.setAttribute('transform', `translate(${x} ${y - 10})`);
      counter.set(this.text.stepCounter(k), idx >= loopFrom ? stateShort(vars, cycle[idx - loopFrom]!) : stateShort(vars, prefix[idx]!));
    };
    place();
    if (this.reduced()) return;
    const tick = () => {
      k++;
      idx = idx + 1 < seq.length ? idx + 1 : loopFrom;
      place();
      this.timer = setTimeout(tick, k < 30 ? 520 : 260);
    };
    this.timer = setTimeout(tick, 520);
  }

  private shaft(m: Extract<SceneModel, { k: 'shaft' }>): void {
    const vars = Object.keys(m.states[0] ?? {});
    this.svg.append(
      s(
        'defs',
        {},
        s(
          'linearGradient',
          { id: 'shaft-fade', x1: 0, y1: 0, x2: 0, y2: 1 },
          s('stop', { offset: '0%', 'stop-color': 'var(--shaft-top)' }),
          s('stop', { offset: '100%', 'stop-color': 'var(--shaft-bottom)' }),
        ),
      ),
      s('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#shaft-fade)' }),
    );
    const g = s('g', { class: 'shaft-stairs' });
    this.svg.append(g);
    const stepW = 34;
    const stepH = 22;
    const draw = (offset: number) => {
      clear(g);
      let d = '';
      for (let i = -2; i < 16; i++) {
        const x = 40 + i * stepW - offset * stepW;
        const y = 40 + i * stepH - offset * stepH;
        d += `M${x} ${y} h${stepW} v${stepH} `;
      }
      g.append(s('path', { d, class: 'stairs endless' }));
    };
    draw(0);
    if (m.badge) this.svg.append(s('text', { x: W - 8, y: 18, class: 'badge-lbl light', 'text-anchor': 'end' }, m.badge));
    const counter = this.counter('', '', true);
    const fig = walker(40 + 4 * stepW + stepW / 2, 40 + 4 * stepH, false);
    fig.setAttribute('class', 'walker light');
    this.svg.append(fig);
    const last = m.states.length - 1;
    let k = 0;
    const show = () => {
      const st = m.states[Math.min(k, last)]!;
      const label = k >= last ? `${this.text.stepCounter(last)}+ … ${this.text.forever}` : this.text.stepCounter(k);
      counter.set(label, stateShort(vars, st));
    };
    show();
    if (this.reduced()) {
      k = last;
      show();
      return;
    }
    let phase = 0;
    const tick = () => {
      phase = (phase + 0.25) % 1;
      draw(phase);
      if (phase === 0) {
        const jump = k < 20 ? 1 : k < 100 ? 3 : k < 1000 ? 37 : 211;
        k = Math.min(last, k + jump);
        show();
      }
      this.timer = setTimeout(tick, 70);
    };
    this.timer = setTimeout(tick, 70);
  }
}
