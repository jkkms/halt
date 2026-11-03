// Helpers shared by the rush tests and the card generator (scripts/gen-rush-cards.ts): the canonical form of a
// program, the programs no card may copy, a second division semantics, and the grid of small starts.

import { lex, type Expr } from '../src/core/expr.ts';
import { LEVELS, TUTORIAL_PROGRAMS, compileLevel, type Level } from '../src/core/levels.ts';
import type { Stmt } from '../src/core/program.ts';
import { startAllowed, initialState, simulate, SIM_CAP, type State } from '../src/core/sim.ts';

const KEYWORDS = ['while', 'if', 'else', 'abs', 'min', 'max', 'true', 'false'];

/** The program with its variables renamed v0, v1, … in order of first appearance. */
export function canonical(code: string): string {
  const names = new Map<string, string>();
  return lex(code)
    .filter((tok) => tok.t !== 'end')
    .map((tok) => {
      if (tok.t !== 'id' || KEYWORDS.includes(tok.s)) return tok.s;
      if (!names.has(tok.s)) names.set(tok.s, `v${names.size}`);
      return names.get(tok.s)!;
    })
    .join(' ');
}

/** Only the loop (from `while` on), renamed: two programs with the same loop teach the same thing. */
export function canonicalLoop(code: string): string {
  return canonical(code.slice(code.indexOf('while')));
}

/** `grow` is the tutorial program of the v0.6 branch (SPEC_v0.6 §E); no card may be it either. */
export const GROW_CODE = `while (x != 0) {
  x := x + 3
}`;

/** Every program a card may not be: the 18 levels and the tutorial programs. */
export function forbiddenPrograms(): [string, string][] {
  return [
    ...LEVELS.map((l): [string, string] => [`level ${l.id}`, l.code]),
    ...Object.entries(TUTORIAL_PROGRAMS).map(([k, l]): [string, string] => [`tutorial ${k}`, l.code]),
    ['tutorial grow', GROW_CODE],
  ];
}

// ------------------------------------------------------------ a second division semantics

/** Division that truncates toward zero (C, Java, JavaScript), unlike the game's Euclidean one. */
function truncInt(e: Expr, env: Record<string, bigint>): bigint {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'var':
      return env[e.name]!;
    case 'neg':
      return -truncInt(e.e, env);
    case 'bin': {
      const a = truncInt(e.l, env);
      const b = truncInt(e.r, env);
      switch (e.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0n ? 0n : a / b;
        case '%':
          return b === 0n ? a : a % b;
      }
      throw new Error('unreachable');
    }
    case 'call': {
      const [a, b] = e.args.map((x) => truncInt(x, env));
      if (e.fn === 'abs') return a! < 0n ? -a! : a!;
      if (e.fn === 'min') return a! <= b! ? a! : b!;
      return a! >= b! ? a! : b!;
    }
    default:
      throw new Error(`not an integer expression: ${e.k}`);
  }
}

function truncBool(e: Expr, env: Record<string, bigint>): boolean {
  switch (e.k) {
    case 'bool':
      return e.v;
    case 'cmp': {
      const a = truncInt(e.l, env);
      const b = truncInt(e.r, env);
      return e.op === '==' ? a === b : e.op === '!=' ? a !== b : e.op === '<' ? a < b : e.op === '<=' ? a <= b : e.op === '>' ? a > b : a >= b;
    }
    case 'and':
      return truncBool(e.l, env) && truncBool(e.r, env);
    case 'or':
      return truncBool(e.l, env) || truncBool(e.r, env);
    case 'not':
      return !truncBool(e.e, env);
    default:
      throw new Error(`not a condition: ${e.k}`);
  }
}

function truncExec(stmts: Stmt[], env: Record<string, bigint>): void {
  for (const s of stmts) {
    if (s.k === 'assign') env[s.v] = truncInt(s.e, env);
    else truncExec(truncBool(s.c, env) ? s.then : s.els, env);
  }
}

/** Does the run from s0 end within `cap` steps when `/` and `%` truncate toward zero? */
export function endsTruncated(level: Level, s0: State, cap = SIM_CAP): boolean {
  let s: Record<string, bigint> = { ...s0 };
  for (let k = 0; k <= cap; k++) {
    if (!truncBool(level.prog.guard, s)) return true;
    const env = { ...s };
    truncExec(level.prog.body, env);
    s = Object.fromEntries(level.vars.map((v) => [v, env[v]!]));
  }
  return false;
}

// ------------------------------------------------------------ the grid of small starts

/** Every allowed start with each input in [lo, hi]. */
export function gridStarts(level: Level, lo = -6, hi = 12): State[] {
  const out: State[] = [];
  const vals: bigint[] = [];
  for (let v = lo; v <= hi; v++) vals.push(BigInt(v));
  const go = (i: number, acc: Record<string, bigint>) => {
    if (i === level.inputs.length) {
      if (startAllowed(level, acc)) out.push(initialState(level, acc));
      return;
    }
    for (const v of vals) go(i + 1, { ...acc, [level.inputs[i]!]: v });
  };
  go(0, {});
  return out;
}

/** Ends cards: every allowed small start ends, with both division semantics. */
export function gridAllEnd(level: Level): { ok: true } | { ok: false; s: State } {
  for (const s of gridStarts(level)) {
    if (simulate(level, s, SIM_CAP).outcome !== 'exit' || !endsTruncated(level, s)) return { ok: false, s };
  }
  return { ok: true };
}

export { compileLevel };
