// The simulator's integer semantics must match Z3 exactly, especially `/` and `%` on negative numbers.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ediv, emod, evalInt, parseRaw, type Expr } from '../src/core/expr.ts';
import { nodeJudge } from './z3-node.ts';

let z: Awaited<ReturnType<typeof nodeJudge>>;
before(async () => {
  z = await nodeJudge();
});
after(async () => {
  await z.close();
});

describe('/ and % agree with Z3 (Euclidean)', () => {
  it('textbook values', () => {
    assert.equal(ediv(-7n, 2n), -4n);
    assert.equal(emod(-7n, 2n), 1n);
    assert.equal(ediv(-7n, -2n), 4n);
    assert.equal(emod(-7n, -2n), 1n);
    assert.equal(ediv(7n, -2n), -3n);
    assert.equal(emod(7n, -2n), 1n);
    assert.equal(emod(-1n, 2n), 1n); // C would say -1; this is why level 8's zone x%2==1 works
    assert.equal(ediv(-1n, 2n), -1n);
  });

  it('every a in [-12, 12], b in [-5, 5] \\ {0} matches raw Z3 div/mod', async () => {
    const { ctx } = z;
    const solver = new ctx.Solver();
    const cells: { a: bigint; b: bigint; q: ReturnType<typeof ctx.Int.const>; r: ReturnType<typeof ctx.Int.const> }[] = [];
    for (let a = -12n; a <= 12n; a++) {
      for (let b = -5n; b <= 5n; b++) {
        if (b === 0n) continue;
        const q = ctx.Int.const(`q_${a}_${b}`);
        const r = ctx.Int.const(`r_${a}_${b}`);
        solver.add(q.eq(ctx.Int.val(a).div(ctx.Int.val(b))), r.eq(ctx.Int.val(a).mod(ctx.Int.val(b))));
        cells.push({ a, b, q, r });
      }
    }
    assert.equal(await solver.check(), 'sat');
    const m = solver.model();
    for (const c of cells) {
      const q = m.eval(c.q, true);
      const r = m.eval(c.r, true);
      assert.ok(ctx.isIntVal(q) && ctx.isIntVal(r));
      assert.equal(ediv(c.a, c.b), q.value(), `${c.a} / ${c.b}`);
      assert.equal(emod(c.a, c.b), r.value(), `${c.a} % ${c.b}`);
    }
  });

  it('division by zero: the judge uses the same fixed choice as the simulator (x/0 = 0, x%0 = x)', async () => {
    const { ctx, judge } = z;
    const x = ctx.Int.const('x0');
    const y = ctx.Int.const('y0');
    const env = new Map([
      ['x', x],
      ['y', y],
    ]);
    for (const xv of [-7n, 0n, 5n]) {
      const solver = new ctx.Solver();
      const q = ctx.Int.const('q0');
      const r = ctx.Int.const('r0');
      solver.add(x.eq(ctx.Int.val(xv)), y.eq(0), q.eq(judge.int(parseRaw('x / y'), env)), r.eq(judge.int(parseRaw('x % y'), env)));
      assert.equal(await solver.check(), 'sat');
      const m = solver.model();
      const qv = m.eval(q, true);
      const rv = m.eval(r, true);
      assert.ok(ctx.isIntVal(qv) && ctx.isIntVal(rv));
      assert.equal(qv.value(), ediv(xv, 0n));
      assert.equal(rv.value(), emod(xv, 0n));
    }
  });

  it('random expressions evaluate the same in the simulator and in Z3', async () => {
    const { ctx, judge } = z;
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const gen = (depth: number): string => {
      if (depth === 0 || rnd(4) === 0) return rnd(2) ? ['x', 'y', 'z'][rnd(3)]! : String(rnd(11) - 5);
      switch (rnd(9)) {
        case 0:
          return `(${gen(depth - 1)} + ${gen(depth - 1)})`;
        case 1:
          return `(${gen(depth - 1)} - ${gen(depth - 1)})`;
        case 2:
          return `(${gen(depth - 1)} * ${gen(depth - 1)})`;
        case 3:
          return `(${gen(depth - 1)} / ${gen(depth - 1)})`;
        case 4:
          return `(${gen(depth - 1)} % ${gen(depth - 1)})`;
        case 5:
          return `abs(${gen(depth - 1)})`;
        case 6:
          return `min(${gen(depth - 1)}, ${gen(depth - 1)})`;
        case 7:
          return `max(${gen(depth - 1)}, ${gen(depth - 1)})`;
        default:
          return `-${gen(depth - 1)}`;
      }
    };
    const solver = new ctx.Solver();
    const checks: { e: Expr; src: string; env: Record<string, bigint>; out: ReturnType<typeof ctx.Int.const> }[] = [];
    for (let i = 0; i < 300; i++) {
      const env = { x: BigInt(rnd(15) - 7), y: BigInt(rnd(15) - 7), z: BigInt(rnd(5) - 2) };
      const src = gen(4);
      const e = parseRaw(src);
      const zenv = new Map(Object.entries(env).map(([k, v]) => [k, ctx.Int.val(v)]));
      const out = ctx.Int.const(`out_${i}`);
      solver.add(out.eq(judge.int(e, zenv)));
      checks.push({ e, src, env, out });
    }
    assert.equal(await solver.check(), 'sat');
    const m = solver.model();
    for (const c of checks) {
      const v = m.eval(c.out, true);
      assert.ok(ctx.isIntVal(v));
      assert.equal(evalInt(c.e, c.env), v.value(), `${c.src} with ${JSON.stringify(c.env, (_, x) => (typeof x === 'bigint' ? String(x) : x))}`);
    }
  });
});
