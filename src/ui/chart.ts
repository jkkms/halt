// Step chart: x = step, y = the player's V on the sample runs (or the variables of one run).
import { clear, h, s } from './dom.ts';

export interface ChartPoint {
  x: number;
  y: number;
  /** this point is below ground while walking */
  below?: boolean;
  /** the step from this point to the next does not go down */
  notDown?: boolean;
  /** the loop has stopped here */
  exit?: boolean;
}

export interface Series {
  label: string;
  points: ChartPoint[];
  more?: boolean; // the run continues past the drawn points
}

export interface ChartOptions {
  ground: boolean;
  bands?: (f: number) => string; // tuple V: label floors
  stepLabel: string;
  yLabel: string;
  groundLabel: string;
}

const W = 400;
const H = 190;
const L = 44;
const R = 14;
const T = 14;
const B = 26;
export const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];

function niceStep(range: number, maxTicks: number): number {
  const raw = range / Math.max(1, maxTicks);
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return Math.max(1, m * p);
  return Math.max(1, 10 * p);
}

export function renderChart(svg: SVGSVGElement, legend: HTMLElement, series: Series[], opt: ChartOptions): void {
  clear(svg);
  clear(legend);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const all = series.flatMap((x) => x.points);
  const maxX = Math.max(1, ...all.map((p) => p.x));
  let yMin = Math.min(opt.ground ? 0 : Infinity, ...all.map((p) => p.y));
  let yMax = Math.max(opt.ground ? 1 : -Infinity, ...all.map((p) => p.y));
  if (!Number.isFinite(yMin)) yMin = 0;
  if (!Number.isFinite(yMax)) yMax = 1;
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.06;
  yMin -= pad;
  yMax += pad;
  const xOf = (x: number) => L + (x / maxX) * (W - L - R);
  const yOf = (y: number) => T + ((yMax - y) / (yMax - yMin)) * (H - T - B);

  if (opt.ground && yMin < 0 && H - B - yOf(0) > 0) svg.append(s('rect', { x: L, y: yOf(0), width: W - L - R, height: H - B - yOf(0), class: 'chart-basement' }));
  if (opt.bands) {
    for (let f = Math.floor(yMin); f < Math.ceil(yMax); f++) {
      const y1 = yOf(f + 1);
      const y2 = yOf(f);
      const bandH = Math.min(H - B, y2) - Math.max(T, y1);
      if (f % 2 === 0 && bandH > 0) svg.append(s('rect', { x: L, y: Math.max(T, y1), width: W - L - R, height: bandH, class: 'band' }));
      if (y2 - y1 >= 11 && y2 <= H - B + 1 && y1 >= T - 1) svg.append(s('text', { x: L - 6, y: (y1 + y2) / 2 + 4, class: 'lbl axis-lbl', 'text-anchor': 'end' }, opt.bands(f)));
    }
  } else {
    const step = niceStep(yMax - yMin, 5);
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
      svg.append(s('line', { x1: L, y1: yOf(v), x2: W - R, y2: yOf(v), class: 'tick' }));
      if (opt.ground && Math.abs(yOf(v) - yOf(0)) < 12) continue; // the ground label sits there
      svg.append(s('text', { x: L - 6, y: yOf(v) + 4, class: 'lbl axis-lbl', 'text-anchor': 'end' }, String(Math.round(v))));
    }
  }
  if (opt.ground) {
    svg.append(s('line', { x1: L, y1: yOf(0), x2: W - R, y2: yOf(0), class: 'ground-line' }));
    svg.append(s('text', { x: L - 6, y: yOf(0) + 4, class: 'lbl ground-lbl', 'text-anchor': 'end' }, opt.groundLabel));
  }
  // x axis
  svg.append(s('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'axis' }));
  const xs = niceStep(maxX, 6);
  for (let x = 0; x <= maxX; x += xs) svg.append(s('text', { x: xOf(x), y: H - B + 14, class: 'lbl axis-lbl', 'text-anchor': 'middle' }, String(x)));
  svg.append(s('text', { x: W - R, y: H - 4, class: 'lbl axis-lbl', 'text-anchor': 'end' }, opt.stepLabel));
  svg.append(s('text', { x: 6, y: T - 2, class: 'lbl axis-lbl' }, opt.yLabel));

  series.forEach((ser, i) => {
    const color = COLORS[i % COLORS.length]!;
    const pts = ser.points;
    if (!pts.length) return;
    let d = `M${xOf(pts[0]!.x)} ${yOf(pts[0]!.y)}`;
    for (let k = 1; k < pts.length; k++) d += ` H${xOf(pts[k]!.x)} V${yOf(pts[k]!.y)}`;
    svg.append(s('path', { d, class: 'series', stroke: color }));
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]!;
      if (p.notDown && k + 1 < pts.length) {
        const q = pts[k + 1]!;
        svg.append(s('path', { d: `M${xOf(p.x)} ${yOf(p.y)} H${xOf(q.x)} V${yOf(q.y)}`, class: 'series bad' }));
      }
      if (p.below) svg.append(s('circle', { cx: xOf(p.x), cy: yOf(p.y), r: pts.length > 40 ? 2.2 : 4, class: 'dot bad' }));
      else if (p.exit) svg.append(s('rect', { x: xOf(p.x) - 3.5, y: yOf(p.y) - 3.5, width: 7, height: 7, class: 'dot exit', stroke: color }));
      else if (pts.length <= 40) svg.append(s('circle', { cx: xOf(p.x), cy: yOf(p.y), r: 2.4, class: 'dot', fill: color }));
    }
    if (ser.more) {
      const p = pts[pts.length - 1]!;
      svg.append(s('text', { x: Math.min(W - R - 2, xOf(p.x) + 4), y: yOf(p.y) - 4, class: 'lbl', fill: color }, '…'));
    }
    legend.append(h('span', { class: 'legend-item' }, h('span', { class: 'swatch', style: `background:${color}` }), ser.label));
  });
}
