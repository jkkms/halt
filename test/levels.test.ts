// Every level against the spec: facts, reference answers, wrong answers, never-witnesses, sample runs.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evalBool, evalRank, lexLess } from '../src/core/expr.ts';
import {
  isFailure,
  isSolved,
  nobodyKnows,
  parseR,
  parseV,
  proofLength,
  proveEnds,
  proveZone,
  runNever,
  type Outcome,
} from '../src/core/game.ts';
import { LEVELS, levelById, type Level } from '../src/core/levels.ts';
import { guardHolds, initialState, sampleInputs, sampleStates, simulate, startAllowed, step, SIM_CAP } from '../src/core/sim.ts';
import { ANSWERS } from './answers.ts';
import { nodeJudge } from './z3-node.ts';

let z: Awaited<ReturnType<typeof nodeJudge>>;
before(async () => {
  z = await nodeJudge();
});
after(async () => {
  await z.close();
});

const texts = (start: Record<string, number>) => Object.fromEntries(Object.entries(start).map(([k, v]) => [k, String(v)]));

/** A counterexample must really be one when replayed with the simulator. */
function assertGenuine(level: Level, o: Extract<Outcome, { type: 'ends' }>) {
  for (const d of o.details) {
    if (d.status !== 'fail') continue;
    assert.ok(d.s, `${d.id} has a state`);
    assert.notEqual(d.reason, 'model-mismatch', `level ${level.id} ${d.id}: Z3's next state equals the simulator's`);
    const s = d.s!;
    const R = o.R;
    switch (d.id) {
      case 'railStart':
        assert.ok(startAllowed(level, Object.fromEntries(level.inputs.map((v) => [v, s[v]!]))));
        assert.deepEqual(initialState(level, s), s);
        assert.equal(evalBool(R!, s), false);
        break;
      case 'railStep':
        assert.ok(evalBool(level.factsExpr, s) && evalBool(R!, s) && guardHolds(level, s));
        assert.equal(evalBool(R!, step(level, s).next), false);
        break;
      case 'bounded':
        assert.ok(evalBool(level.factsExpr, s) && (!R || evalBool(R, s)) && guardHolds(level, s));
        assert.ok(evalRank(o.V, s).some((x) => x < 0n), 'V is below ground at the counterexample');
        break;
      case 'decreasing': {
        assert.ok(evalBool(level.factsExpr, s) && (!R || evalBool(R, s)) && guardHolds(level, s));
        const next = step(level, s).next;
        assert.deepEqual(d.s2, next);
        assert.equal(lexLess(evalRank(o.V, next), evalRank(o.V, s)), false, 'the step does not go down');
        assert.ok(d.move === 'flat' || d.move === 'up');
        break;
      }
    }
  }
}

for (const level of LEVELS) {
  const ans = ANSWERS[level.id]!;
  describe(`level ${level.id} (${level.title.en}, ${level.kind})`, () => {
    it('samples satisfy the start condition', () => {
      assert.ok(level.samples.length >= 3 && level.samples.length <= 4);
      for (const inp of sampleInputs(level)) assert.ok(startAllowed(level, inp), JSON.stringify(level.samples));
    });

    if (level.kind === 'ends' || level.kind === 'open') {
      it('sample runs end within the cap', () => {
        for (const s0 of sampleStates(level)) {
          const run = simulate(level, s0, SIM_CAP);
          assert.equal(run.outcome, 'exit');
          assert.ok(run.states.length - 1 <= 200, 'samples stay small enough to draw');
        }
      });
    } else {
      it('samples include a run that never ends (and one that ends when possible)', () => {
        const outcomes = sampleStates(level).map((s0) => simulate(level, s0, SIM_CAP).outcome);
        assert.ok(outcomes.some((o) => o !== 'exit'));
        if (level.id !== 5) assert.ok(outcomes.includes('exit'));
      });
    }

    it('facts hold at the start and are inductive', async () => {
      const checks = await z.judge.checkFacts(level);
      for (const c of checks) assert.equal(c.status, 'pass', `${c.id}: ${JSON.stringify(c.s, (_, x) => (typeof x === 'bigint' ? String(x) : x))}`);
    });

    for (const a of ans.ends ?? []) {
      it(`reference answer passes: V=${a.V}${a.R ? ` R=${a.R}` : ''}`, async () => {
        const o = await proveEnds(z.judge, level, a.V, a.R ?? '');
        assert.equal(o.type, 'ends');
        if (o.type !== 'ends') return;
        assert.deepEqual(
          o.details.map((d) => [d.id, d.status]),
          o.details.map((d) => [d.id, 'pass']),
        );
        assert.equal(o.result, 'proved');
        assert.ok(isSolved(level, o));
      });
    }

    if (level.kind === 'ends') {
      it('some reference answer meets par', () => {
        const best = Math.min(...(ans.ends ?? []).map((a) => proofLength(level, a.V, a.R ?? '')));
        assert.ok(best <= level.par!, `best ${best} > par ${level.par}`);
      });
    }

    for (const a of ans.wrongEnds ?? []) {
      it(`wrong answer is rejected with a genuine counterexample: V=${a.V}${a.R ? ` R=${a.R}` : ''}`, async () => {
        const o = await proveEnds(z.judge, level, a.V, a.R ?? '');
        assert.equal(o.type, 'ends');
        if (o.type !== 'ends') return;
        assert.equal(o.result, 'refuted');
        assert.ok(isFailure(o));
        assert.ok(!isSolved(level, o));
        assertGenuine(level, o);
      });
    }

    for (const w of ans.never ?? []) {
      it(`never-witness passes: start ${JSON.stringify(w.start)}${w.Z ? `, Z=${w.Z}` : ''}`, async () => {
        const o = runNever(level, texts(w.start));
        if (w.expect === 'cycle') {
          assert.equal(o.type, 'cycle');
          assert.ok(isSolved(level, o));
          return;
        }
        assert.equal(o.type, 'needZone');
        if (o.type !== 'needZone') return;
        assert.equal(o.run.states.length - 1, SIM_CAP);
        const p = await proveZone(z.judge, level, o.s0, w.Z!, o.run);
        assert.equal(p.type, 'zone');
        if (p.type !== 'zone') return;
        assert.deepEqual(
          p.details.map((d) => [d.id, d.status]),
          [
            ['zoneStart', 'pass'],
            ['zoneGuard', 'pass'],
            ['zoneStep', 'pass'],
          ],
        );
        assert.ok(isSolved(level, p));
      });
    }

    for (const w of ans.wrongNever ?? []) {
      it(`wrong never-answer fails: start ${JSON.stringify(w.start)} (${w.expect})`, () => {
        const o = runNever(level, texts(w.start));
        assert.equal(o.type, w.expect);
        assert.ok(!isSolved(level, o));
        assert.equal(isFailure(o), w.expect === 'ended'); // a disallowed start costs nothing
      });
    }

    if (level.kind === 'never') {
      it('picking "It ends" cannot succeed (steps-left guesses are refuted)', async () => {
        for (const v of level.vars) {
          const o = await proveEnds(z.judge, level, v, '');
          assert.equal(o.type, 'ends');
          if (o.type === 'ends') assert.equal(o.result, 'refuted', `V=${v}`);
        }
      });
      it('a wrong zone is refuted', async () => {
        const w = (ans.never ?? []).find((x) => x.expect === 'zone');
        if (!w) return;
        const o = runNever(level, texts(w.start));
        assert.equal(o.type, 'needZone');
        if (o.type !== 'needZone') return;
        const p = await proveZone(z.judge, level, o.s0, 'true', o.run);
        assert.equal(p.type, 'zone');
        if (p.type === 'zone') assert.equal(p.result, 'refuted');
      });
    }

    if (level.kind === 'ends') {
      it('picking "It never ends": every sample start is shown ending', () => {
        for (const sample of level.samples) {
          const o = runNever(level, texts(sample));
          assert.equal(o.type, 'ended');
          assert.ok(isFailure(o));
        }
      });
    }

    it(`"Nobody knows" is ${level.kind === 'open' ? 'right' : 'wrong'}`, () => {
      const o = nobodyKnows(level);
      assert.equal(isSolved(level, o), level.kind === 'open');
      assert.equal(isFailure(o), level.kind !== 'open');
    });
  });
}

describe('special cases', () => {
  it('level 9: n-i passes only with the railing; the railing counts toward par', async () => {
    const l9 = levelById(9);
    assert.ok(parseR(l9, 'i<=n'));
    assert.equal(proofLength(l9, 'n-i', 'i <= n'), 7);
    assert.equal(proofLength(l9, 'n-i', ''), 3);
  });

  it('level 10: tuple and weighted sum both work, x+y fails on the minute rollover', async () => {
    const l10 = levelById(10);
    const o = await proveEnds(z.judge, l10, 'x+y', '');
    assert.equal(o.type, 'ends');
    if (o.type !== 'ends') return;
    const dec = o.details.find((d) => d.id === 'decreasing')!;
    assert.equal(dec.status, 'fail');
    assert.equal(dec.move, 'up');
    assert.equal(dec.s2!.y, 59n);
  });

  it('level 1: V=0 is a flat step, V=-n falls below ground', async () => {
    const l1 = levelById(1);
    const flat = await proveEnds(z.judge, l1, '0', '');
    assert.equal(flat.type, 'ends');
    if (flat.type === 'ends') {
      assert.deepEqual(
        flat.details.map((d) => [d.id, d.status]),
        [
          ['bounded', 'pass'],
          ['decreasing', 'fail'],
        ],
      );
      assert.equal(flat.details[1]!.move, 'flat');
    }
    const neg = await proveEnds(z.judge, l1, '-n', '');
    assert.equal(neg.type, 'ends');
    if (neg.type === 'ends') assert.equal(neg.details[0]!.status, 'fail');
  });

  it('level 18: V=n is refuted on an odd step (3n+1 goes up)', async () => {
    const l18 = levelById(18);
    const o = await proveEnds(z.judge, l18, 'n', '');
    assert.equal(o.type, 'ends');
    if (o.type !== 'ends') return;
    assert.equal(o.result, 'refuted');
    const dec = o.details.find((d) => d.id === 'decreasing')!;
    assert.equal(dec.move, 'up');
    assert.equal(dec.s!.n! % 2n, 1n);
  });

  it('level 18: "It never ends" with small starts shows the run ending', () => {
    const l18 = levelById(18);
    for (const n of [1, 6, 7, 27, 97]) assert.equal(runNever(l18, { n: String(n) }).type, 'ended');
  });

  it('level 12: the off-by-one start cycles immediately', () => {
    const o = runNever(levelById(12), { lo: '0', hi: '1', t: '1' });
    assert.equal(o.type, 'cycle');
    if (o.type === 'cycle') {
      assert.equal(o.run.cycleStart, 0);
      assert.equal(o.run.states.length, 2);
    }
  });

  it('never-level start values are parsed and checked', () => {
    const l5 = levelById(5);
    assert.equal(runNever(l5, { n: 'abc' }).type, 'parseError');
    assert.equal(runNever(l5, { n: '' }).type, 'parseError');
    assert.equal(runNever(l5, { n: '-4' }).type, 'notAllowed');
  });

  it('a timeout is "undecided", never a failure', () => {
    const o: Outcome = { type: 'ends', result: 'undecided', details: [], length: 1, V: parseV(levelById(1), 'n'), R: null };
    assert.equal(isFailure(o), false);
    assert.equal(isSolved(levelById(1), o), false);
  });
});
