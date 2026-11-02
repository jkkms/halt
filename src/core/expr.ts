// Expression language shared by the level code and the player's answers.
// All values are mathematical integers (bigint). `/` and `%` follow SMT-LIB / Z3:
// Euclidean division, so the remainder is always >= 0.

export type BinOp = '+' | '-' | '*' | '/' | '%';
export type CmpOp = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type FnName = 'abs' | 'min' | 'max';

export type Expr =
  | { k: 'num'; v: bigint; pos: number }
  | { k: 'bool'; v: boolean; pos: number }
  | { k: 'var'; name: string; pos: number }
  | { k: 'neg'; e: Expr; pos: number }
  | { k: 'bin'; op: BinOp; l: Expr; r: Expr; pos: number }
  | { k: 'call'; fn: FnName; args: Expr[]; pos: number }
  | { k: 'cmp'; op: CmpOp; l: Expr; r: Expr; pos: number }
  | { k: 'and' | 'or'; l: Expr; r: Expr; pos: number }
  | { k: 'not'; e: Expr; pos: number }
  | { k: 'tuple'; items: Expr[]; pos: number };

/** A parse or type error. `code` is translated by the UI (see ui/i18n.ts). */
export class ExprError extends Error {
  code: string;
  pos: number;
  args: Record<string, string>;
  constructor(code: string, pos: number, args: Record<string, string> = {}) {
    super(`${code} at ${pos} ${JSON.stringify(args)}`);
    this.code = code;
    this.pos = pos;
    this.args = args;
  }
}

// ---------------------------------------------------------------- lexer

export interface Token {
  t: 'num' | 'id' | 'op' | 'end';
  s: string;
  pos: number;
  line: number;
}

const OPS = [':=', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '(', ')', ',', '!', '=', ';', '{', '}', '&', '|'];
// Friendly aliases people paste from papers or type on a phone.
const ALIASES: Record<string, string> = { '≤': '<=', '≥': '>=', '≠': '!=', '−': '-', '–': '-', '×': '*', '∧': '&&', '∨': '||', '¬': '!' };

export function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j]!)) j++;
      if (j < src.length && /[A-Za-z_]/.test(src[j]!)) {
        let e = j;
        while (e < src.length && /[A-Za-z0-9_]/.test(src[e]!)) e++;
        throw new ExprError('implicitMul', i, { num: src.slice(i, j), name: src.slice(j, e) });
      }
      out.push({ t: 'num', s: src.slice(i, j), pos: i, line });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ t: 'id', s: src.slice(i, j), pos: i, line });
      i = j;
      continue;
    }
    const alias = ALIASES[ch];
    if (alias) {
      out.push({ t: 'op', s: alias, pos: i, line });
      i++;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: 'op', s: op, pos: i, line });
      i += op.length;
      continue;
    }
    throw new ExprError('badChar', i, { ch });
  }
  out.push({ t: 'end', s: '', pos: src.length, line });
  return out;
}

// ---------------------------------------------------------------- parser

const CMP_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const WORD_OPS: Record<string, string> = { and: '&&', or: '||', not: '!' };
const ARITY: Record<FnName, number> = { abs: 1, min: 2, max: 2 };

export function describeToken(tok: Token): string {
  return tok.t === 'end' ? '' : tok.s;
}

export class Parser {
  toks: Token[];
  i = 0;
  constructor(src: string) {
    this.toks = lex(src);
  }
  peek(offset = 0): Token {
    return this.toks[Math.min(this.i + offset, this.toks.length - 1)]!;
  }
  next(): Token {
    const tok = this.peek();
    if (this.i < this.toks.length - 1) this.i++;
    return tok;
  }
  isOp(s: string): boolean {
    const tok = this.peek();
    return tok.t === 'op' && tok.s === s;
  }
  isId(s: string): boolean {
    const tok = this.peek();
    return tok.t === 'id' && tok.s === s;
  }
  /** Common mistakes get their own message wherever they show up. */
  private explain(tok: Token): void {
    if (tok.t === 'op' && (tok.s === '&' || tok.s === '|')) throw new ExprError('singleAmp', tok.pos, { op: tok.s + tok.s });
    if (tok.t === 'op' && tok.s === '=') throw new ExprError('assignEq', tok.pos);
    if (tok.t === 'id' && tok.s in WORD_OPS) throw new ExprError('wordOp', tok.pos, { word: tok.s, op: WORD_OPS[tok.s]! });
  }
  fail(tok: Token): never {
    this.explain(tok);
    if (tok.t === 'end') throw new ExprError('unexpectedEnd', tok.pos);
    throw new ExprError('unexpected', tok.pos, { tok: tok.s });
  }
  expectOp(s: string): Token {
    const tok = this.peek();
    if (tok.t === 'op' && tok.s === s) return this.next();
    this.explain(tok);
    if (tok.t === 'end') throw new ExprError('expectedEnd', tok.pos, { want: s });
    throw new ExprError('expected', tok.pos, { want: s, got: tok.s });
  }

  expr(): Expr {
    return this.or();
  }
  or(): Expr {
    let l = this.and();
    while (this.isOp('||')) {
      const t = this.next();
      l = { k: 'or', l, r: this.and(), pos: t.pos };
    }
    return l;
  }
  and(): Expr {
    let l = this.not();
    while (this.isOp('&&')) {
      const t = this.next();
      l = { k: 'and', l, r: this.not(), pos: t.pos };
    }
    return l;
  }
  not(): Expr {
    if (this.isOp('!')) {
      const t = this.next();
      return { k: 'not', e: this.not(), pos: t.pos };
    }
    return this.cmp();
  }
  cmp(): Expr {
    const l = this.add();
    const tok = this.peek();
    if (tok.t === 'op' && tok.s === '=') throw new ExprError('assignEq', tok.pos);
    if (tok.t === 'op' && CMP_OPS.has(tok.s)) {
      this.next();
      const r = this.add();
      const after = this.peek();
      if (after.t === 'op' && CMP_OPS.has(after.s)) throw new ExprError('chainedCmp', after.pos);
      return { k: 'cmp', op: tok.s as CmpOp, l, r, pos: tok.pos };
    }
    return l;
  }
  add(): Expr {
    let l = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const t = this.next();
      l = { k: 'bin', op: t.s as BinOp, l, r: this.mul(), pos: t.pos };
    }
    return l;
  }
  mul(): Expr {
    let l = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const t = this.next();
      l = { k: 'bin', op: t.s as BinOp, l, r: this.unary(), pos: t.pos };
    }
    return l;
  }
  unary(): Expr {
    if (this.isOp('-')) {
      const t = this.next();
      const e = this.unary();
      if (e.k === 'num') return { k: 'num', v: -e.v, pos: t.pos };
      return { k: 'neg', e, pos: t.pos };
    }
    if (this.isOp('+')) {
      this.next();
      return this.unary();
    }
    return this.atom();
  }
  atom(): Expr {
    const tok = this.peek();
    if (tok.t === 'num') {
      this.next();
      return { k: 'num', v: BigInt(tok.s), pos: tok.pos };
    }
    if (tok.t === 'id') {
      this.next();
      if (tok.s === 'true' || tok.s === 'false') return { k: 'bool', v: tok.s === 'true', pos: tok.pos };
      if (tok.s in WORD_OPS) throw new ExprError('wordOp', tok.pos, { word: tok.s, op: WORD_OPS[tok.s]! });
      if (this.isOp('(')) {
        if (!(tok.s in ARITY)) throw new ExprError('unknownFn', tok.pos, { name: tok.s });
        const fn = tok.s as FnName;
        this.next();
        const args: Expr[] = [];
        if (!this.isOp(')')) {
          args.push(this.expr());
          while (this.isOp(',')) {
            this.next();
            args.push(this.expr());
          }
        }
        this.expectOp(')');
        if (args.length !== ARITY[fn]) throw new ExprError('arity', tok.pos, { fn, n: String(ARITY[fn]) });
        return { k: 'call', fn, args, pos: tok.pos };
      }
      return { k: 'var', name: tok.s, pos: tok.pos };
    }
    if (tok.t === 'op' && tok.s === '(') {
      this.next();
      const first = this.expr();
      if (this.isOp(',')) {
        const items = [first];
        while (this.isOp(',')) {
          this.next();
          items.push(this.expr());
        }
        this.expectOp(')');
        return { k: 'tuple', items, pos: tok.pos };
      }
      this.expectOp(')');
      return first;
    }
    return this.fail(tok);
  }

  /** After a complete expression, nothing may follow. */
  end(): void {
    const tok = this.peek();
    if (tok.t === 'end') return;
    this.explain(tok);
    if (tok.t === 'id' || tok.t === 'num' || (tok.t === 'op' && tok.s === '(')) throw new ExprError('missingOp', tok.pos, { tok: tok.s });
    if (tok.t === 'op' && tok.s === ',') throw new ExprError('bareTuple', tok.pos);
    this.fail(tok);
  }
}

/** Parse without any variable or type checks. */
export function parseRaw(src: string): Expr {
  if (src.trim() === '') throw new ExprError('empty', 0);
  const p = new Parser(src);
  const e = p.expr();
  p.end();
  return e;
}

// ---------------------------------------------------------------- types

export type Ty = 'int' | 'bool' | 'tuple';

export function typeOf(e: Expr): Ty {
  const want = (x: Expr, t: 'int' | 'bool') => {
    const got = typeOf(x);
    if (got === 'tuple') throw new ExprError('tupleHere', x.pos);
    if (got !== t) throw new ExprError(t === 'int' ? 'wantInt' : 'wantBool', x.pos);
  };
  switch (e.k) {
    case 'num':
    case 'var':
      return 'int';
    case 'bool':
      return 'bool';
    case 'neg':
      want(e.e, 'int');
      return 'int';
    case 'bin':
      want(e.l, 'int');
      want(e.r, 'int');
      return 'int';
    case 'call':
      for (const a of e.args) want(a, 'int');
      return 'int';
    case 'cmp':
      want(e.l, 'int');
      want(e.r, 'int');
      return 'bool';
    case 'and':
    case 'or':
      want(e.l, 'bool');
      want(e.r, 'bool');
      return 'bool';
    case 'not':
      want(e.e, 'bool');
      return 'bool';
    case 'tuple':
      for (const a of e.items) want(a, 'int');
      return 'tuple';
  }
}

export function varsOf(e: Expr, out = new Set<string>()): Set<string> {
  switch (e.k) {
    case 'var':
      out.add(e.name);
      break;
    case 'neg':
    case 'not':
      varsOf(e.e, out);
      break;
    case 'bin':
    case 'cmp':
    case 'and':
    case 'or':
      varsOf(e.l, out);
      varsOf(e.r, out);
      break;
    case 'call':
      for (const a of e.args) varsOf(a, out);
      break;
    case 'tuple':
      for (const a of e.items) varsOf(a, out);
      break;
  }
  return out;
}

function firstVarPos(e: Expr, name: string): number {
  if (e.k === 'var') return e.name === name ? e.pos : -1;
  const kids: Expr[] =
    e.k === 'neg' || e.k === 'not' ? [e.e] : e.k === 'bin' || e.k === 'cmp' || e.k === 'and' || e.k === 'or' ? [e.l, e.r] : e.k === 'call' ? e.args : e.k === 'tuple' ? e.items : [];
  for (const kid of kids) {
    const p = firstVarPos(kid, name);
    if (p >= 0) return p;
  }
  return -1;
}

export interface Scope {
  vars: string[]; // variables visible at the loop head
  locals?: string[]; // variables that only exist inside the loop body
}

function checkVars(e: Expr, scope: Scope): void {
  for (const name of varsOf(e)) {
    if (scope.vars.includes(name)) continue;
    const pos = firstVarPos(e, name);
    if (scope.locals?.includes(name)) throw new ExprError('localVar', pos, { name, vars: scope.vars.join(', ') });
    throw new ExprError('unknownVar', pos, { name, vars: scope.vars.join(', ') });
  }
}

/** "Steps left": an integer expression, or (when allowed) a tuple of them. */
export function parseRank(src: string, scope: Scope, allowTuple: boolean): Expr {
  const e = parseRaw(src);
  const ty = typeOf(e);
  if (ty === 'bool') throw new ExprError('rankIsCond', e.pos);
  if (ty === 'tuple') {
    if (!allowTuple) throw new ExprError('tupleLocked', e.pos);
  }
  checkVars(e, scope);
  return e;
}

/** A railing or a bottomless zone: a condition. */
export function parseCond(src: string, scope: Scope): Expr {
  const e = parseRaw(src);
  const ty = typeOf(e);
  if (ty === 'tuple') throw new ExprError('tupleHere', e.pos);
  if (ty === 'int') throw new ExprError('condIsNum', e.pos);
  checkVars(e, scope);
  return e;
}

/** A start value typed by the player: a (possibly negative) integer literal. */
export function parseIntLiteral(src: string): bigint {
  const s = src.trim().replace(/[−–]/g, '-');
  if (s === '') throw new ExprError('emptyValue', 0);
  if (!/^[-+]?[0-9]+$/.test(s)) throw new ExprError('notInteger', 0, { text: s });
  if (s.replace(/^[-+]/, '').length > 15) throw new ExprError('tooBig', 0);
  return BigInt(s);
}

/** Length of an answer: number of non-space characters. */
export function answerLength(src: string): number {
  return [...src.replace(/\s+/g, '')].length;
}

// ---------------------------------------------------------------- printing

const PREC: Record<string, number> = { or: 1, and: 2, not: 3, cmp: 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, neg: 7 };

export function show(e: Expr, pretty = false): string {
  const op = (s: string) => (pretty ? ({ '<=': '≤', '>=': '≥', '!=': '≠', '&&': '∧', '||': '∨', '!': '¬' } as Record<string, string>)[s] ?? s : s);
  const go = (x: Expr, ctx: number): string => {
    let p: number;
    let s: string;
    switch (x.k) {
      case 'num':
        return x.v < 0n && ctx > 5 ? `(${x.v})` : String(x.v);
      case 'bool':
        return String(x.v);
      case 'var':
        return x.name;
      case 'neg':
        p = PREC.neg!;
        s = `-${go(x.e, p)}`;
        break;
      case 'bin':
        p = PREC[x.op]!;
        s = `${go(x.l, p)} ${x.op} ${go(x.r, p + 1)}`;
        break;
      case 'call':
        return `${x.fn}(${x.args.map((a) => go(a, 0)).join(', ')})`;
      case 'cmp':
        p = PREC.cmp!;
        s = `${go(x.l, p + 1)} ${op(x.op)} ${go(x.r, p + 1)}`;
        break;
      case 'and':
      case 'or':
        p = PREC[x.k]!;
        s = `${go(x.l, p)} ${op(x.k === 'and' ? '&&' : '||')} ${go(x.r, p + 1)}`;
        break;
      case 'not': {
        // Always parenthesise a compound operand: "!(x == 0)" reads better than "!x == 0".
        const inner = x.e.k === 'var' || x.e.k === 'bool' || x.e.k === 'call' || x.e.k === 'not' ? go(x.e, PREC.not!) : `(${go(x.e, 0)})`;
        p = PREC.not!;
        s = `${op('!')}${inner}`;
        break;
      }
      case 'tuple':
        return `(${x.items.map((a) => go(a, 0)).join(', ')})`;
    }
    return p < ctx ? `(${s})` : s;
  };
  return go(e, 0);
}

// ---------------------------------------------------------------- evaluation

export type Env = Record<string, bigint>;

/** Euclidean division as in SMT-LIB: a = b*q + r with 0 <= r < |b|. b = 0 gives 0. */
export function ediv(a: bigint, b: bigint): bigint {
  if (b === 0n) return 0n;
  let q = a / b; // truncates toward zero
  const r = a - q * b;
  if (r < 0n) q = b > 0n ? q - 1n : q + 1n;
  return q;
}

/** Euclidean remainder, always >= 0. b = 0 gives a (so that a = b*(a/b) + a%b still holds). */
export function emod(a: bigint, b: bigint): bigint {
  if (b === 0n) return a;
  const r = a % b; // sign of a
  return r < 0n ? r + (b < 0n ? -b : b) : r;
}

export class EvalError extends Error {
  name_: string;
  constructor(name: string) {
    super(`unbound variable ${name}`);
    this.name_ = name;
  }
}

function arith(op: BinOp, a: bigint, b: bigint): bigint {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return ediv(a, b);
    case '%':
      return emod(a, b);
  }
}

function compare(op: CmpOp, a: bigint, b: bigint): boolean {
  switch (op) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
  }
}

export function evalInt(e: Expr, env: Env): bigint {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'var': {
      const v = env[e.name];
      if (v === undefined) throw new EvalError(e.name);
      return v;
    }
    case 'neg':
      return -evalInt(e.e, env);
    case 'bin':
      return arith(e.op, evalInt(e.l, env), evalInt(e.r, env));
    case 'call': {
      const xs = e.args.map((a) => evalInt(a, env));
      const [a, b] = [xs[0]!, xs[1]!];
      if (e.fn === 'abs') return a < 0n ? -a : a;
      if (e.fn === 'min') return a <= b ? a : b;
      return a >= b ? a : b;
    }
    default:
      throw new Error(`not an integer expression: ${e.k}`);
  }
}

export function evalBool(e: Expr, env: Env): boolean {
  switch (e.k) {
    case 'bool':
      return e.v;
    case 'cmp':
      return compare(e.op, evalInt(e.l, env), evalInt(e.r, env));
    case 'and':
      return evalBool(e.l, env) && evalBool(e.r, env);
    case 'or':
      return evalBool(e.l, env) || evalBool(e.r, env);
    case 'not':
      return !evalBool(e.e, env);
    default:
      throw new Error(`not a condition: ${e.k}`);
  }
}

/** Components of "steps left": one for a plain expression, k for a tuple. */
export function rankParts(e: Expr): Expr[] {
  return e.k === 'tuple' ? e.items : [e];
}

export function evalRank(e: Expr, env: Env): bigint[] {
  return rankParts(e).map((x) => evalInt(x, env));
}

/** Strict lexicographic "a < b" on equal-length tuples. */
export function lexLess(a: bigint[], b: bigint[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i]! < b[i]!) return true;
    if (a[i]! > b[i]!) return false;
  }
  return false;
}

export function lexEqual(a: bigint[], b: bigint[]): boolean {
  return a.every((x, i) => x === b[i]);
}

/** Replace variables by expressions (used for symbolic execution of the loop body). */
export function subst(e: Expr, sub: Map<string, Expr>): Expr {
  switch (e.k) {
    case 'num':
    case 'bool':
      return e;
    case 'var':
      return sub.get(e.name) ?? e;
    case 'neg':
    case 'not':
      return { ...e, e: subst(e.e, sub) };
    case 'bin':
    case 'cmp':
    case 'and':
    case 'or':
      return { ...e, l: subst(e.l, sub), r: subst(e.r, sub) } as Expr;
    case 'call':
      return { ...e, args: e.args.map((a) => subst(a, sub)) };
    case 'tuple':
      return { ...e, items: e.items.map((a) => subst(a, sub)) };
  }
}
