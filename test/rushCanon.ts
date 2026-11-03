// Helpers shared by the rush tests and the card generator (scripts/gen-rush-cards.ts): the canonical form of a
// program, the programs no card may copy, a second division semantics, and the grid of small starts.

import { lex, varsOf, type Expr } from '../src/core/expr.ts';
import { LEVELS, TUTORIAL_PROGRAMS, compileLevel, type Level } from '../src/core/levels.ts';
import { parseProgram, type Stmt } from '../src/core/program.ts';
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

// ------------------------------------------------------------ the shape of a loop

/**
 * The shape of a program's loop (from `while` on): its tree with the variables renamed and every integer constant
 * replaced by `C`, so that loops differing only in names and constants get the same shape. Trivially equivalent
 * ways of writing a condition get the same shape too: `0 < n` is `n > 0`, `n >= 1` is `n > C` (a constant moved
 * by one), `!(x > 3)` is `x <= 3`, `a < b` is `b > a`, and `i <= n` counts as `i < n` (one off); `+`, `*`, `==`, `!=`, `&&`, `||`, `min` and `max` ignore the
 * order of their operands; `if (c) A else B` is `if (!c) B else A`. The renaming that gives the smallest text wins,
 * so the order in which the variables first appear does not matter either.
 */
export function loopShape(code: string): string {
  const prog = parseProgram(code.slice(code.indexOf('while')));
  const names = new Set<string>(varsOf(prog.guard));
  const collect = (ss: Stmt[]) => {
    for (const st of ss) {
      if (st.k === 'assign') {
        names.add(st.v);
        varsOf(st.e, names);
      } else {
        varsOf(st.c, names);
        collect(st.then);
        collect(st.els);
      }
    }
  };
  collect(prog.body);
  const vs = [...names];
  let best: string | null = null;
  for (const perm of permutations(vs.map((_, i) => i))) {
    const ren = new Map(vs.map((v, i) => [v, `v${perm[i]}`]));
    const s = `while (${shapeCond(prog.guard, ren, false)}) { ${shapeStmts(prog.body, ren)} }`;
    if (best === null || s < best) best = s;
  }
  return best!;
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

const isConst = (e: Expr): boolean => varsOf(e).size === 0;

function shapeInt(e: Expr, ren: Map<string, string>): string {
  if (isConst(e)) return 'C';
  switch (e.k) {
    case 'var':
      return ren.get(e.name)!;
    case 'neg':
      return `-(${shapeInt(e.e, ren)})`;
    case 'bin': {
      const l = shapeInt(e.l, ren);
      const r = shapeInt(e.r, ren);
      if (e.op === '+' || e.op === '*') return `(${[l, r].sort().join(` ${e.op} `)})`;
      return `(${l} ${e.op} ${r})`;
    }
    case 'call': {
      const args = e.args.map((a) => shapeInt(a, ren));
      return `${e.fn}(${(e.fn === 'abs' ? args : args.sort()).join(', ')})`;
    }
    default:
      throw new Error(`not an integer expression: ${e.k}`);
  }
}

const NEG_OP: Record<string, string> = { '==': '!=', '!=': '==', '<': '>=', '<=': '>', '>': '<=', '>=': '<' };
const FLIP_OP: Record<string, string> = { '==': '==', '!=': '!=', '<': '>', '<=': '>=', '>': '<', '>=': '<=' };

/** A condition's shape; `neg` = the shape of its negation. */
function shapeCond(e: Expr, ren: Map<string, string>, neg: boolean): string {
  switch (e.k) {
    case 'bool':
      return String(e.v !== neg);
    case 'not':
      return shapeCond(e.e, ren, !neg);
    case 'and':
    case 'or': {
      // De Morgan under a negation
      const k = (e.k === 'and') !== neg ? '&&' : '||';
      return `(${[shapeCond(e.l, ren, neg), shapeCond(e.r, ren, neg)].sort().join(` ${k} `)})`;
    }
    case 'cmp': {
      let op = neg ? NEG_OP[e.op]! : e.op;
      let l = shapeInt(e.l, ren);
      let r = shapeInt(e.r, ren);
      if (l === 'C' && r !== 'C') {
        [l, r] = [r, l];
        op = FLIP_OP[op]!;
      }
      // x >= C is x > C - 1, another constant; between two variables, a <= b (a < b + 1) is taken as the same loop
      // as a < b too, an off-by-one away
      if (op === '>=') op = '>';
      if (op === '<=') op = '<';
      if (r !== 'C') {
        if (op === '<') {
          [l, r] = [r, l];
          op = '>';
        }
        if (op === '==' || op === '!=') [l, r] = [l, r].sort() as [string, string];
      }
      return `${l} ${op} ${r}`;
    }
    default:
      throw new Error(`not a condition: ${e.k}`);
  }
}

/** Statements; neighbouring assignments that do not touch each other's variable may come in either order. */
function shapeStmts(ss: Stmt[], ren: Map<string, string>): string {
  const out: string[] = [];
  let run: Extract<Stmt, { k: 'assign' }>[] = [];
  const flush = () => {
    // the smallest order that keeps every dependent pair in place
    const left = run.map((st) => ({ st, text: `${ren.get(st.v)} := ${shapeInt(st.e, ren)};`, reads: varsOf(st.e) }));
    const touches = (a: (typeof left)[number], b: (typeof left)[number]) => a.st.v === b.st.v || a.reads.has(b.st.v) || b.reads.has(a.st.v);
    while (left.length) {
      const free = left.filter((x, i) => left.slice(0, i).every((y) => !touches(x, y)));
      const pick = free.reduce((a, b) => (b.text < a.text ? b : a));
      out.push(pick.text);
      left.splice(left.indexOf(pick), 1);
    }
    run = [];
  };
  for (const st of ss) {
    if (st.k === 'assign') {
      run.push(st);
      continue;
    }
    flush();
    const t = shapeStmts(st.then, ren);
    const f = shapeStmts(st.els, ren);
    const a = `if (${shapeCond(st.c, ren, false)}) { ${t} } else { ${f} }`;
    const b = `if (${shapeCond(st.c, ren, true)}) { ${f} } else { ${t} }`;
    out.push(a < b ? a : b);
  }
  flush();
  return out.join(' ');
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
