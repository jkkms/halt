// Formatting states and values for people.
import type { State } from '../core/sim.ts';

export function num(v: bigint): string {
  const s = v.toString();
  return s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-6)} (${s.replace('-', '').length} digits)` : s;
}

export function state(vars: string[], s: State): string {
  return vars.map((v) => `${v} = ${num(s[v]!)}`).join(', ');
}

export function stateShort(vars: string[], s: State): string {
  return vars.map((v) => `${v}=${num(s[v]!)}`).join(' ');
}

export function rank(v: bigint[]): string {
  return v.length === 1 ? num(v[0]!) : `(${v.map(num).join(', ')})`;
}

export function pretty(src: string): string {
  return src.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠');
}

export function starsText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
}
