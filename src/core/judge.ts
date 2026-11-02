// The judge: the exact Z3 checks of the spec. Works with any z3-solver Context (browser or Node).
//
// Notation (spec): Start = start condition + initialization, Facts = loop-head facts,
// G = loop guard, Step(s, s') = OR over body paths of (path condition AND s' = assign(s)).

import type { Arith, Bool, Context, Model } from 'z3-solver';
import { rankParts, type Expr } from './expr.ts';
import { branches } from './program.ts';
import type { Level } from './levels.ts';
import type { State } from './sim.ts';

type Ctx = Context<'main'>;
type ZInt = Arith<'main'>;
type ZBool = Bool<'main'>;
type Env = Map<string, ZInt>;

export type CheckId = 'railStart' | 'railStep' | 'bounded' | 'decreasing' | 'zoneStart' | 'zoneGuard' | 'zoneStep' | 'factsStart' | 'factsStep';
export type Status = 'pass' | 'fail' | 'unknown';

export interface CheckResult {
  id: CheckId;
  status: Status;
  /** Counterexample: a state (and the next state, for checks about one step). */
  s?: State;
  s2?: State;
  reason?: string;
}

export const Z3_TIMEOUT_MS = 5000;

export class Judge {
  ctx: Ctx;
  timeoutMs: number;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(ctx: Ctx, timeoutMs = Z3_TIMEOUT_MS) {
    this.ctx = ctx;
    this.timeoutMs = timeoutMs;
  }

  // ------------------------------------------------------------ translation

  private vars(level: Level, suffix: string): Env {
    return new Map(level.vars.map((v) => [v, this.ctx.Int.const(v + suffix)]));
  }

  int(e: Expr, env: Env): ZInt {
    const { ctx } = this;
    switch (e.k) {
      case 'num':
        return ctx.Int.val(e.v);
      case 'var': {
        const z = env.get(e.name);
        if (!z) throw new Error(`unbound variable ${e.name}`);
        return z;
      }
      case 'neg':
        return this.int(e.e, env).neg();
      case 'bin': {
        const a = this.int(e.l, env);
        const b = this.int(e.r, env);
        const nonzeroLiteral = e.r.k === 'num' && e.r.v !== 0n;
        switch (e.op) {
          case '+':
            return a.add(b);
          case '-':
            return a.sub(b);
          case '*':
            return a.mul(b);
          case '/':
            // SMT-LIB leaves x/0 unspecified; we fix x/0 = 0 so that runs and proofs agree.
            return nonzeroLiteral ? a.div(b) : (ctx.If(b.eq(0), ctx.Int.val(0), a.div(b)) as ZInt);
          case '%':
            // ... and x%0 = x.
            return nonzeroLiteral ? a.mod(b) : (ctx.If(b.eq(0), a, a.mod(b)) as ZInt);
        }
        throw new Error('unreachable');
      }
      case 'call': {
        const [a, b] = e.args.map((x) => this.int(x, env));
        if (e.fn === 'abs') return ctx.If(a!.ge(0), a!, a!.neg()) as ZInt;
        if (e.fn === 'min') return ctx.If(a!.le(b!), a!, b!) as ZInt;
        return ctx.If(a!.ge(b!), a!, b!) as ZInt;
      }
      default:
        throw new Error(`not an integer expression: ${e.k}`);
    }
  }

  bool(e: Expr, env: Env): ZBool {
    const { ctx } = this;
    switch (e.k) {
      case 'bool':
        return ctx.Bool.val(e.v);
      case 'cmp': {
        const a = this.int(e.l, env);
        const b = this.int(e.r, env);
        switch (e.op) {
          case '==':
            return a.eq(b);
          case '!=':
            return a.neq(b);
          case '<':
            return a.lt(b);
          case '<=':
            return a.le(b);
          case '>':
            return a.gt(b);
          case '>=':
            return a.ge(b);
        }
        throw new Error('unreachable');
      }
      case 'and':
        return ctx.And(this.bool(e.l, env), this.bool(e.r, env));
      case 'or':
        return ctx.Or(this.bool(e.l, env), this.bool(e.r, env));
      case 'not':
        return ctx.Not(this.bool(e.e, env));
      default:
        throw new Error(`not a condition: ${e.k}`);
    }
  }

  private and(xs: ZBool[]): ZBool {
    return xs.length === 0 ? this.ctx.Bool.val(true) : xs.length === 1 ? xs[0]! : this.ctx.And(...xs);
  }

  private or(xs: ZBool[]): ZBool {
    return xs.length === 0 ? this.ctx.Bool.val(false) : xs.length === 1 ? xs[0]! : this.ctx.Or(...xs);
  }

  /** Start(s): the inputs satisfy the start condition and the other variables hold their initial values. */
  start(level: Level, pre: Env): ZBool {
    const parts = [this.bool(level.startExpr, pre)];
    const [init] = branches(level.prog.init);
    for (const v of level.initVars) parts.push(pre.get(v)!.eq(this.int(init!.sub.get(v)!, pre)));
    return this.and(parts);
  }

  /** Step(s, s'). */
  step(level: Level, pre: Env, post: Env): ZBool {
    return this.or(
      level.branches.map((b) =>
        this.and([
          ...b.conds.map((c) => this.bool(c, pre)),
          ...level.vars.map((v) => post.get(v)!.eq(this.int(b.sub.get(v) ?? { k: 'var', name: v, pos: 0 }, pre))),
        ]),
      ),
    );
  }

  /** Strict lexicographic decrease: a < b. */
  private lexLess(a: ZInt[], b: ZInt[]): ZBool {
    const [a0, ...as] = a;
    const [b0, ...bs] = b;
    if (as.length === 0) return a0!.le(b0!.sub(1));
    return this.ctx.Or(a0!.lt(b0!), this.ctx.And(a0!.eq(b0!), this.lexLess(as, bs)));
  }

  // ------------------------------------------------------------ solving

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private read(model: Model<'main'>, env: Env): State {
    const s: State = {};
    for (const [v, z] of env) {
      const val = model.eval(z, true);
      if (!this.ctx.isIntVal(val)) throw new Error(`model gave no integer for ${v}`);
      s[v] = val.value();
    }
    return s;
  }

  /** Is the conjunction satisfiable? unsat = the check passes; a model = a counterexample. */
  private async refute(id: CheckId, constraints: ZBool[], pre: Env, post?: Env): Promise<CheckResult> {
    return this.serial(async () => {
      try {
        const solver = new this.ctx.Solver();
        solver.set('timeout', this.timeoutMs);
        for (const c of constraints) solver.add(c);
        const r = await solver.check();
        if (r === 'unsat') return { id, status: 'pass' as const };
        if (r === 'unknown') return { id, status: 'unknown' as const, reason: solver.reasonUnknown() };
        const model = solver.model();
        return { id, status: 'fail' as const, s: this.read(model, pre), s2: post ? this.read(model, post) : undefined };
      } catch (err) {
        return { id, status: 'unknown' as const, reason: String(err) };
      }
    });
  }

  // ------------------------------------------------------------ the checks

  /** "It ends": V (number or tuple) with optional railing R. */
  async checkEnds(level: Level, V: Expr, R: Expr | null): Promise<CheckResult[]> {
    const pre = this.vars(level, '');
    const post = this.vars(level, "'");
    const { ctx } = this;
    const F = this.bool(level.factsExpr, pre);
    const G = this.bool(level.prog.guard, pre);
    const S = this.step(level, pre, post);
    const Rpre = R ? this.bool(R, pre) : ctx.Bool.val(true);
    const out: CheckResult[] = [];
    if (R) {
      out.push(await this.refute('railStart', [this.start(level, pre), ctx.Not(Rpre)], pre));
      out.push(await this.refute('railStep', [F, Rpre, G, S, ctx.Not(this.bool(R, post))], pre, post));
    }
    const Vpre = rankParts(V).map((x) => this.int(x, pre));
    const Vpost = rankParts(V).map((x) => this.int(x, post));
    out.push(await this.refute('bounded', [F, Rpre, G, ctx.Not(this.and(Vpre.map((x) => x.ge(0))))], pre));
    out.push(await this.refute('decreasing', [F, Rpre, G, S, ctx.Not(this.lexLess(Vpost, Vpre))], pre, post));
    return out;
  }

  /** "It never ends" with a bottomless zone Z for the start state s0. */
  async checkZone(level: Level, s0: State, Z: Expr): Promise<CheckResult[]> {
    const pre = this.vars(level, '');
    const post = this.vars(level, "'");
    const { ctx } = this;
    const F = this.bool(level.factsExpr, pre);
    const G = this.bool(level.prog.guard, pre);
    const Zpre = this.bool(Z, pre);
    const at = level.vars.map((v) => pre.get(v)!.eq(ctx.Int.val(s0[v]!)));
    return [
      await this.refute('zoneStart', [...at, ctx.Not(Zpre)], pre),
      await this.refute('zoneGuard', [Zpre, ctx.Not(G)], pre),
      await this.refute('zoneStep', [F, Zpre, G, this.step(level, pre, post), ctx.Not(this.bool(Z, post))], pre, post),
    ];
  }

  /** Designer check (tests): facts hold at the start and are inductive. */
  async checkFacts(level: Level): Promise<CheckResult[]> {
    const pre = this.vars(level, '');
    const post = this.vars(level, "'");
    const { ctx } = this;
    const F = this.bool(level.factsExpr, pre);
    return [
      await this.refute('factsStart', [this.start(level, pre), ctx.Not(F)], pre),
      await this.refute(
        'factsStep',
        [F, this.bool(level.prog.guard, pre), this.step(level, pre, post), ctx.Not(this.bool(level.factsExpr, post))],
        pre,
        post,
      ),
    ];
  }
}

/** Overall verdict of a list of checks: any fail = refuted, else any unknown = undecided. */
export function overall(checks: CheckResult[]): 'proved' | 'refuted' | 'undecided' {
  if (checks.some((c) => c.status === 'fail')) return 'refuted';
  if (checks.some((c) => c.status === 'unknown')) return 'undecided';
  return 'proved';
}
