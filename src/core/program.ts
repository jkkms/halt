// The small pseudo-language the levels are written in:
//   init assignments; while (guard) { body }
// with `x := e`, `if (c) { ... } else if (c) { ... } else { ... }`.
// The same text is shown to the player and parsed here, so display and semantics cannot drift apart.

import { ExprError, Parser, subst, evalBool, evalInt, varsOf, type Env, type Expr } from './expr.ts';

export type Stmt =
  | { k: 'assign'; v: string; e: Expr; line: number }
  | { k: 'if'; c: Expr; then: Stmt[]; els: Stmt[]; line: number };

export interface Program {
  init: Stmt[];
  guard: Expr;
  body: Stmt[];
  whileLine: number;
}

class ProgramParser extends Parser {
  stmt(): Stmt {
    const tok = this.peek();
    if (tok.t === 'id' && tok.s === 'if') return this.ifStmt();
    if (tok.t !== 'id') this.fail(tok);
    this.next();
    this.expectOp(':=');
    const e = this.expr();
    if (this.isOp(';')) this.next();
    return { k: 'assign', v: tok.s, e, line: tok.line };
  }
  ifStmt(): Stmt {
    const tok = this.next(); // 'if'
    this.expectOp('(');
    const c = this.expr();
    this.expectOp(')');
    const then = this.block();
    let els: Stmt[] = [];
    if (this.isId('else')) {
      this.next();
      els = this.isId('if') ? [this.ifStmt()] : this.block();
    }
    return { k: 'if', c, then, els, line: tok.line };
  }
  block(): Stmt[] {
    this.expectOp('{');
    const out: Stmt[] = [];
    while (!this.isOp('}')) out.push(this.stmt());
    this.expectOp('}');
    return out;
  }
  program(): Program {
    const init: Stmt[] = [];
    while (!this.isId('while')) {
      const s = this.stmt();
      if (s.k !== 'assign') throw new ExprError('initOnlyAssign', 0);
      init.push(s);
    }
    const w = this.next();
    this.expectOp('(');
    const guard = this.expr();
    this.expectOp(')');
    const body = this.block();
    if (this.peek().t !== 'end') this.fail(this.peek());
    return { init, guard, body, whileLine: w.line };
  }
}

export function parseProgram(src: string): Program {
  return new ProgramParser(src).program();
}

/** Variables assigned anywhere in a statement list. */
export function assignedVars(stmts: Stmt[], out = new Set<string>()): Set<string> {
  for (const s of stmts) {
    if (s.k === 'assign') out.add(s.v);
    else {
      assignedVars(s.then, out);
      assignedVars(s.els, out);
    }
  }
  return out;
}

/** Variables read anywhere (expressions, conditions). */
export function readVars(stmts: Stmt[], out = new Set<string>()): Set<string> {
  for (const s of stmts) {
    if (s.k === 'assign') varsOf(s.e, out);
    else {
      varsOf(s.c, out);
      readVars(s.then, out);
      readVars(s.els, out);
    }
  }
  return out;
}

/**
 * Check that every local (a variable that only lives inside the body) is written before it is read
 * on every path. Returns the offending variable or null.
 */
export function localReadBeforeWrite(body: Stmt[], locals: string[]): string | null {
  const go = (stmts: Stmt[], defined: Set<string>): string | null => {
    for (const s of stmts) {
      const reads = s.k === 'assign' ? varsOf(s.e) : varsOf(s.c);
      for (const v of reads) if (locals.includes(v) && !defined.has(v)) return v;
      if (s.k === 'assign') defined.add(s.v);
      else {
        const a = new Set(defined);
        const b = new Set(defined);
        const r = go(s.then, a) ?? go(s.els, b);
        if (r) return r;
        for (const v of a) if (b.has(v)) defined.add(v);
      }
    }
    return null;
  };
  return go(body, new Set());
}

// ---------------------------------------------------------------- symbolic execution

/** One path through the body: taken when all `conds` hold; then each variable v becomes sub(v). */
export interface Branch {
  conds: Expr[];
  sub: Map<string, Expr>;
  lines: number[];
}

export function branches(stmts: Stmt[]): Branch[] {
  let paths: Branch[] = [{ conds: [], sub: new Map(), lines: [] }];
  for (const s of stmts) {
    if (s.k === 'assign') {
      for (const p of paths) {
        p.sub.set(s.v, subst(s.e, p.sub));
        p.lines.push(s.line);
      }
    } else {
      const next: Branch[] = [];
      for (const p of paths) {
        const c = subst(s.c, p.sub);
        const run = (body: Stmt[], cond: Expr) =>
          branches(body).map((b) => {
            const sub = new Map(p.sub);
            for (const [v, e] of b.sub) sub.set(v, subst(e, p.sub));
            return {
              conds: [...p.conds, cond, ...b.conds.map((x) => subst(x, p.sub))],
              sub,
              lines: [...p.lines, s.line, ...b.lines],
            };
          });
        next.push(...run(s.then, c), ...run(s.els, { k: 'not', e: c, pos: c.pos }));
      }
      paths = next;
    }
  }
  return paths;
}

// ---------------------------------------------------------------- concrete execution

/** Execute statements on `env` in place; records the lines that ran. */
export function exec(stmts: Stmt[], env: Env, lines: number[]): void {
  for (const s of stmts) {
    if (s.k === 'assign') {
      env[s.v] = evalInt(s.e, env);
      lines.push(s.line);
    } else {
      lines.push(s.line);
      exec(evalBool(s.c, env) ? s.then : s.els, env, lines);
    }
  }
}
