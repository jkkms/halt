// Clumsy code that a person would not write (author's request, 11/3): two constants that could be folded
// (`k + 2 - 5`, `x * 2 * 3`, `- (-3)`), operations that do nothing (`x * 1`, `x + 0`, `x := x`), double negation,
// redundant parentheses, `!` in front of a comparison, conditions that are constant by sight, and the like.
// Pure: the card generator (scripts/gen-rush-cards.ts) drops a card it flags, and test/rushCards.test.ts checks
// every card of the bank, hand-written ones included. Unit tests: test/rushLint.test.ts.

import { evalBool, lex, parseRaw, show, varsOf, type Expr } from '../src/core/expr.ts';
import { parseProgram, type Stmt } from '../src/core/program.ts';

export interface LintProblem {
  rule: string;
  /** The piece of code at fault, as printed by show(). */
  at: string;
}

const isConst = (e: Expr): boolean => e.k !== 'bool' && varsOf(e).size === 0;
const numIs = (e: Expr, v: number): boolean => e.k === 'num' && e.v === BigInt(v);
const same = (a: Expr, b: Expr): boolean => show(a) === show(b);

/** The terms of an addition chain: `a + b - c` → [a, b, c] (signs dropped). */
function addTerms(e: Expr): Expr[] {
  if (e.k === 'bin' && (e.op === '+' || e.op === '-')) return [...addTerms(e.l), e.r];
  return [e];
}
/** The factors of a product chain `a * b * c` (only `*`: `/` and `%` round, so they do not fold). */
function mulFactors(e: Expr): Expr[] {
  if (e.k === 'bin' && e.op === '*') return [...mulFactors(e.l), ...mulFactors(e.r)];
  return [e];
}

function kids(e: Expr): Expr[] {
  switch (e.k) {
    case 'neg':
    case 'not':
      return [e.e];
    case 'bin':
    case 'cmp':
    case 'and':
    case 'or':
      return [e.l, e.r];
    case 'call':
      return e.args;
    case 'tuple':
      return e.items;
    default:
      return [];
  }
}

/** Problems inside one expression (integer or condition), outermost first. */
function lintExpr(e: Expr, out: LintProblem[], top = true): void {
  const at = show(e);
  const flag = (rule: string) => out.push({ rule, at });
  switch (e.k) {
    case 'num':
      break;
    case 'neg':
      if (e.e.k === 'neg') flag('double negation');
      if (isConst(e.e)) flag('constants that fold');
      break;
    case 'not':
      if (e.e.k === 'not') flag('double negation');
      else if (e.e.k === 'cmp') flag('! in front of a comparison');
      else if (e.e.k === 'bool') flag('constant condition');
      break;
    case 'bin': {
      const { l, r, op } = e;
      if (isConst(l) && isConst(r)) flag('constants that fold');
      else if (op === '+' || op === '-') {
        if (addTerms(e).filter(isConst).length >= 2) flag('constants that fold');
        if (numIs(r, 0) || (op === '+' && numIs(l, 0))) flag('adds or takes away 0');
        if (op === '-' && numIs(l, 0)) flag('0 - x is -x');
        if (r.k === 'num' && r.v < 0n) flag('adds or takes away a negative constant');
        if (op === '-' && same(l, r)) flag('x - x is 0');
        if (op === '+' && isConst(l) && !isConst(r)) flag('constant before + (write x + 3)');
      } else if (op === '*') {
        if (mulFactors(e).filter(isConst).length >= 2) flag('constants that fold');
        if (numIs(l, 1) || numIs(r, 1)) flag('multiplies by 1');
        if (numIs(l, 0) || numIs(r, 0)) flag('multiplies by 0');
        if (numIs(l, -1) || numIs(r, -1)) flag('multiplies by -1 (write -x)');
      } else {
        // '/' and '%'
        if (numIs(r, 1)) flag(op === '/' ? 'divides by 1' : 'x % 1 is 0');
        if (numIs(r, -1)) flag('divides by -1');
        if (numIs(r, 0)) flag('divides by 0');
        if (numIs(l, 0)) flag('0 / x and 0 % x are 0');
        if (same(l, r)) flag(op === '/' ? 'x / x' : 'x % x is 0');
        // x * 6 / 2 is x * 3
        if (op === '/' && l.k === 'bin' && l.op === '*' && r.k === 'num' && r.v > 0n) {
          const c = mulFactors(l).find((f) => f.k === 'num');
          if (c && c.k === 'num' && c.v % r.v === 0n) flag('constants that fold');
        }
      }
      break;
    }
    case 'call':
      if (e.args.every(isConst)) flag('constants that fold');
      if (e.fn !== 'abs' && same(e.args[0]!, e.args[1]!)) flag(`${e.fn}(x, x) is x`);
      if (e.fn === 'abs' && e.args[0]!.k === 'call' && e.args[0]!.fn === 'abs') flag('abs(abs(x))');
      if (e.fn === 'abs' && e.args[0]!.k === 'neg') flag('abs(-x) is abs(x)');
      break;
    case 'cmp': {
      const { l, r } = e;
      if (isConst(l) && isConst(r)) flag('constant condition');
      else if (same(l, r)) flag('compares a thing with itself');
      else {
        // x + 1 > 5 is x > 4; 2 * x == 10 is x == 5
        for (const [side, other] of [
          [l, r],
          [r, l],
        ] as const) {
          if (!isConst(other)) continue;
          if (side.k === 'bin' && (side.op === '+' || side.op === '-') && addTerms(side).some(isConst)) flag('constants that fold across the comparison');
          if (side.k === 'bin' && side.op === '*' && mulFactors(side).some(isConst) && mulFactors(side).filter((f) => !isConst(f)).length === 1)
            flag('constants that fold across the comparison');
          if (side.k === 'neg') flag('-x compared with a constant (flip the comparison)');
        }
      }
      break;
    }
    case 'and':
    case 'or':
      if (same(e.l, e.r)) flag(`the same condition twice`);
      break;
    case 'bool':
      if (!top) flag('true or false inside a condition');
      break;
    default:
      break;
  }
  for (const k of kids(e)) lintExpr(k, out, false);
}

// ------------------------------------------------------------ conditions constant by sight

/** Values worth trying for a condition: small ones and the neighbours of every constant in it (and of its root). */
function probeValues(e: Expr, small: number): bigint[] {
  const vals = new Set<bigint>();
  for (let v = -small; v <= small; v++) vals.add(BigInt(v));
  const walk = (x: Expr) => {
    if (x.k === 'num') {
      const c = x.v < 0n ? -x.v : x.v;
      const s = BigInt(Math.floor(Math.sqrt(Number(c))));
      for (const b of [c, s]) for (const d of [-2n, -1n, 0n, 1n, 2n]) for (const sg of [1n, -1n]) vals.add(sg * (b + d));
    }
    kids(x).forEach(walk);
  };
  walk(e);
  return [...vals];
}

/** The truth table of a condition on the probe points, every variable taking every value. */
function truthTable(e: Expr, vars: string[], vals: bigint[]): boolean[] {
  const out: boolean[] = [];
  const go = (i: number, env: Record<string, bigint>) => {
    if (i === vars.length) {
      out.push(evalBool(e, env));
      return;
    }
    for (const v of vals) go(i + 1, { ...env, [vars[i]!]: v });
  };
  go(0, {});
  return out;
}

/** The comparisons and other atoms of a condition (the parts joined by && and ||). */
function atoms(e: Expr): Expr[] {
  if (e.k === 'and' || e.k === 'or') return [...atoms(e.l), ...atoms(e.r)];
  if (e.k === 'not') return atoms(e.e);
  return [e];
}

/** A condition (or a part of it) that is always true or always false, or a part of && / || that never matters. */
function lintCondValues(e: Expr, where: string, out: LintProblem[]): void {
  const vars = [...varsOf(e)];
  if (!vars.length) {
    if (!(e.k === 'bool' && e.v && where === 'start')) out.push({ rule: 'constant condition', at: show(e) });
    return;
  }
  const vals = probeValues(e, vars.length === 1 ? 30 : vars.length === 2 ? 12 : 5);
  for (const a of atoms(e)) {
    const av = [...varsOf(a)];
    if (!av.length) continue; // flagged by lintExpr
    const t = truthTable(a, av, vals);
    if (t.every((x) => x) || t.every((x) => !x)) out.push({ rule: 'condition that is always true or always false', at: show(a) });
  }
  const whole = truthTable(e, vars, vals);
  if (whole.every((x) => x) || whole.every((x) => !x)) out.push({ rule: 'condition that is always true or always false', at: show(e) });
  // a part of && / || that does not change the condition
  const drop = (x: Expr): Expr[] => {
    if (x.k !== 'and' && x.k !== 'or') return [];
    return [x.l, x.r, ...drop(x.l).map((l) => ({ ...x, l })), ...drop(x.r).map((r) => ({ ...x, r }))];
  };
  if (e.k === 'and' || e.k === 'or')
    for (const rest of drop(e)) {
      const t = truthTable(rest, vars, vals);
      if (t.every((x, i) => x === whole[i])) {
        out.push({ rule: 'a part of the condition that never matters', at: show(e) });
        break;
      }
    }
}

// ------------------------------------------------------------ statements

function lintStmts(ss: Stmt[], out: LintProblem[]): void {
  for (let i = 0; i < ss.length; i++) {
    const st = ss[i]!;
    if (st.k === 'assign') {
      if (st.e.k === 'var' && st.e.name === st.v) out.push({ rule: 'x := x does nothing', at: `${st.v} := ${st.v}` });
      lintExpr(st.e, out);
      const next = ss[i + 1];
      if (next && next.k === 'assign' && next.v === st.v && !varsOf(next.e).has(st.v)) out.push({ rule: 'a value overwritten before it is read', at: `${st.v} := ${show(st.e)}` });
    } else {
      lintExpr(st.c, out);
      lintCondValues(st.c, 'if', out);
      if (printStmts(st.then) === printStmts(st.els)) out.push({ rule: 'both branches do the same', at: `if (${show(st.c)})` });
      lintStmts(st.then, out);
      lintStmts(st.els, out);
    }
  }
}

function printStmts(ss: Stmt[]): string {
  return ss.map((st) => (st.k === 'assign' ? `${st.v} := ${show(st.e)}` : `if (${show(st.c)}) { ${printStmts(st.then)} } else { ${printStmts(st.els)} }`)).join('; ');
}

/** Parentheses that the code needs: those of `while (…)`, `if (…)`, function calls and the ones show() prints. */
function neededParens(ss: Stmt[]): number {
  const count = (s: string) => (s.match(/\(/g) ?? []).length;
  let n = 0;
  for (const st of ss) {
    if (st.k === 'assign') n += count(show(st.e));
    else n += 1 + count(show(st.c)) + neededParens(st.then) + neededParens(st.els);
  }
  return n;
}

/** Token-level problems the parser hides: it reads `- (-3)` and `--3` as 3. */
function lintTokens(src: string, out: LintProblem[]): void {
  const toks = lex(src).filter((t) => t.t !== 'end');
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i]!;
    const b = toks[i + 1]!;
    const c = toks[i + 2];
    if (a.s === '-' && b.s === '-') out.push({ rule: 'double negation', at: '- -' });
    if (a.s === '-' && b.s === '(' && c?.s === '-') out.push({ rule: 'double negation', at: '- (-' });
    if (a.s === '+' && (i === 0 || ['(', ',', ':=', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '+', '-', '*', '/', '%'].includes(toks[i - 1]!.s)))
      out.push({ rule: 'a + sign in front of a number', at: '+' });
  }
}

/** Everything clumsy about a card: its code and its input condition. An empty list = reads like a person wrote it. */
export function lintCard(code: string, start = 'true'): LintProblem[] {
  const out: LintProblem[] = [];
  const prog = parseProgram(code);
  lintExpr(prog.guard, out);
  lintCondValues(prog.guard, 'guard', out);
  lintStmts([...prog.init, ...prog.body], out);
  lintTokens(code, out);
  const parens = (code.match(/\(/g) ?? []).length;
  const need = 1 + neededParens([...prog.init, ...prog.body]) + (show(prog.guard).match(/\(/g) ?? []).length;
  if (parens > need) out.push({ rule: 'redundant parentheses', at: code.replace(/\s+/g, ' ') });
  if (start.trim() !== 'true') {
    const s = parseRaw(start);
    lintExpr(s, out);
    lintCondValues(s, 'start', out);
    lintTokens(start, out);
    if ((start.match(/\(/g) ?? []).length > (show(s).match(/\(/g) ?? []).length) out.push({ rule: 'redundant parentheses', at: start });
  }
  return out;
}

/** The problems as one readable line (for test messages and the generator's log). */
export function lintText(ps: LintProblem[]): string {
  return ps.map((p) => `${p.rule}: ${p.at}`).join('; ');
}
