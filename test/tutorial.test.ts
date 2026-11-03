// The tutorial-only examples against the real checker (SPEC_v0.3 §5, SPEC_v0.6 §E): the intended answers pass, the
// wrong answers the tutorial shows fail, and no tutorial answer gives away a level's answer (level 1's n aside).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lex } from '../src/core/expr.ts';
import { isFailure, isSolved, proveEnds, proveZone, runNever, type Outcome } from '../src/core/game.ts';
import { LEVELS, TUTORIAL_PROGRAMS, type Level } from '../src/core/levels.ts';
import { RUSH_CARDS } from '../src/core/rushCards.ts';
import { INTROS, TUTORIAL, type Shot } from '../src/core/tutorial.ts';
import { ANSWERS } from './answers.ts';
import { nodeJudge } from './z3-node.ts';

let z: Awaited<ReturnType<typeof nodeJudge>>;
before(async () => {
  z = await nodeJudge();
});
after(async () => {
  await z.close();
});

const { countdown, flip, railing, floors, grow } = TUTORIAL_PROGRAMS;

/** The program with its variables renamed v0, v1, … in order of first appearance (as in test/rush.test.ts). */
function canonical(code: string): string {
  const names = new Map<string, string>();
  return lex(code)
    .filter((tok) => tok.t !== 'end')
    .map((tok) => {
      if (tok.t !== 'id' || ['while', 'if', 'else', 'abs', 'min', 'max', 'true', 'false'].includes(tok.s)) return tok.s;
      if (!names.has(tok.s)) names.set(tok.s, `v${names.size}`);
      return names.get(tok.s)!;
    })
    .join(' ');
}

async function judged(prog: Level, V: string, R = ''): Promise<Extract<Outcome, { type: 'ends' }>> {
  const o = await proveEnds(z.judge, prog, V, R);
  assert.equal(o.type, 'ends', `${V} parses`);
  return o as Extract<Outcome, { type: 'ends' }>;
}

const statuses = (o: Extract<Outcome, { type: 'ends' }>) => Object.fromEntries(o.details.map((d) => [d.id, d.status]));

describe('tutorial-only programs and the real checker', () => {
  it('the facts of every tutorial program hold at the start and are inductive', async () => {
    for (const prog of Object.values(TUTORIAL_PROGRAMS)) {
      for (const c of await z.judge.checkFacts(prog)) assert.equal(c.status, 'pass', `${prog.title.en}: ${c.id}`);
    }
  });

  it('pages 10, 11 and 13 (countdown): n passes', async () => {
    const o = await judged(countdown, 'n');
    assert.equal(o.result, 'proved');
    assert.ok(isSolved(countdown, o));
  });

  it('page 11: 0 fails with a flat step, −n fails below ground', async () => {
    const flat = await judged(countdown, '0');
    assert.equal(flat.result, 'refuted');
    assert.deepEqual(statuses(flat), { bounded: 'pass', decreasing: 'fail' });
    assert.equal(flat.details.find((d) => d.id === 'decreasing')!.move, 'flat');
    const neg = await judged(countdown, '-n');
    assert.equal(neg.result, 'refuted');
    assert.equal(statuses(neg).bounded, 'fail');
    assert.ok(neg.details.find((d) => d.id === 'bounded')!.v![0]! < 0n);
  });

  it('pages 9 and 12 (back and forth): the start x = 2 is a cycle', () => {
    const o = runNever(flip, { x: '2' });
    assert.equal(o.type, 'cycle');
    if (o.type === 'cycle') {
      assert.deepEqual(
        o.run.states.map((s) => s.x),
        [2n, -1n, 2n],
      );
    }
    assert.ok(isSolved(flip, o));
    // and "It ends" cannot be proved for it
    assert.equal(runNever(flip, { x: '0' }).type, 'ended');
  });

  it('bottomless-zone intro (grow): x = 1 never repeats a state, and the zone x > 0 proves it never ends', async () => {
    const o = runNever(grow, { x: '1' });
    assert.equal(o.type, 'needZone', 'no cycle to show: it needs a zone');
    if (o.type !== 'needZone') return;
    assert.deepEqual(
      o.run.states.slice(0, 4).map((s) => s.x),
      [1n, 4n, 7n, 10n],
    );
    const p = await proveZone(z.judge, grow, o.s0, 'x > 0', o.run);
    assert.equal(p.type, 'zone');
    if (p.type !== 'zone') return;
    assert.equal(p.result, 'proved');
    // the intro's ① ② ③ are exactly the judge's three zone checks, in this order
    assert.deepEqual(
      p.details.map((d) => [d.id, d.status]),
      [
        ['zoneStart', 'pass'],
        ['zoneGuard', 'pass'],
        ['zoneStep', 'pass'],
      ],
    );
    assert.ok(isSolved(grow, p));
    // the zone is not just the loop condition: x ≠ 0 lets a step leave it (x = −3 goes to 0)
    const cond = await proveZone(z.judge, grow, o.s0, 'x != 0', o.run);
    assert.ok(cond.type === 'zone' && cond.result === 'refuted');
    if (cond.type === 'zone') assert.deepEqual(Object.fromEntries(cond.details.map((d) => [d.id, d.status])), { zoneStart: 'pass', zoneGuard: 'pass', zoneStep: 'fail' });
  });

  it('grow is a new program: no level and no rush card, not even with its variables renamed', () => {
    const g = canonical(grow.code);
    for (const l of LEVELS) assert.notEqual(canonical(l.code), g, `level ${l.id}`);
    for (const c of RUSH_CARDS) assert.notEqual(canonical(c.code), g, `rush card ${c.id}`);
    for (const [k, prog] of Object.entries(TUTORIAL_PROGRAMS)) if (k !== 'grow') assert.notEqual(canonical(prog.code), g, k);
  });

  it('railing intro: k fails without a railing (below ground) and passes with k >= 0', async () => {
    const bare = await judged(railing, 'k');
    assert.equal(bare.result, 'refuted');
    const below = bare.details.find((d) => d.id === 'bounded')!;
    assert.equal(below.status, 'fail');
    assert.ok(below.s!.k! < 0n, 'the judge doubts a negative k');
    assert.ok(isFailure(bare));
    const fenced = await judged(railing, 'k', 'k >= 0');
    assert.deepEqual(statuses(fenced), { railStart: 'pass', railStep: 'pass', bounded: 'pass', decreasing: 'pass' });
    assert.equal(fenced.result, 'proved');
  });

  it('floors intro: (f, s) passes and f + s fails (a step up when the floor changes)', async () => {
    const tuple = await judged(floors, '(f, s)');
    assert.equal(tuple.result, 'proved');
    const sum = await judged(floors, 'f + s');
    assert.equal(sum.result, 'refuted');
    const dec = sum.details.find((d) => d.id === 'decreasing')!;
    assert.equal(dec.status, 'fail');
    assert.equal(dec.move, 'up');
    assert.equal(dec.s2!.s, 5n, 'the step to the top of the floor below');
  });

  it('every steps-left expression the tutorial draws is judged as the narration says', async () => {
    // pass = drawn as the answer; fail = drawn as a wrong try (flat, below ground, step up, or no railing).
    const expect: Record<string, Record<string, 'proved' | 'refuted'>> = {
      countdown: { n: 'proved', '0': 'refuted', '-n': 'refuted' },
      railing: { k: 'refuted', 'k|k >= 0': 'proved' },
      floors: { '(f, s)': 'proved', 'f + s': 'refuted' },
    };
    const seen = new Set<string>();
    for (const sh of [...TUTORIAL, ...Object.values(INTROS).flatMap((i) => i.pages)].flatMap((p) => p.shots)) {
      if (sh.scene.k !== 'run' || !sh.scene.V) continue;
      const key = sh.scene.railing ? `${sh.scene.V}|${sh.scene.railing}` : sh.scene.V;
      const want = expect[sh.scene.prog]?.[key];
      assert.ok(want, `${sh.scene.prog}: ${key} has an expected verdict`);
      const o = await judged(TUTORIAL_PROGRAMS[sh.scene.prog], sh.scene.V, sh.scene.railing ?? '');
      assert.equal(o.result, want, `${sh.scene.prog}: ${key}`);
      seen.add(`${sh.scene.prog}:${key}`);
    }
    // the railing intro's first page draws k on its own (the judge's doubt), and k with the railing later
    assert.ok(seen.has('railing:k') && seen.has('railing:k|k >= 0'));
  });

  it('no tutorial answer is a level’s reference answer (only level 1’s n may overlap)', () => {
    const norm = (x: string) => x.replace(/\s+/g, '');
    const startKey = (s: Record<string, number>) => JSON.stringify(Object.entries(s).sort());
    const levelAnswers = new Map<string, number[]>();
    const add = (key: string, id: number) => levelAnswers.set(key, [...(levelAnswers.get(key) ?? []), id]);
    for (const l of LEVELS) {
      const a = ANSWERS[l.id]!;
      for (const e of a.ends ?? []) {
        add(`V:${norm(e.V)}`, l.id);
        if (e.R) add(`R:${norm(e.R)}`, l.id);
      }
      for (const w of a.never ?? []) {
        add(`start:${startKey(w.start)}`, l.id);
        if (w.Z) add(`R:${norm(w.Z)}`, l.id);
      }
    }
    const shown: string[] = [];
    const shots: Shot[] = [...TUTORIAL, ...Object.values(INTROS).flatMap((i) => i.pages)].flatMap((p) => p.shots);
    for (const sh of shots) {
      if (sh.scene.k === 'cycle') shown.push(`start:${startKey(sh.scene.start)}`);
      if (sh.scene.k === 'run') {
        if (sh.scene.V) shown.push(`V:${norm(sh.scene.V)}`);
        if (sh.scene.railing) shown.push(`R:${norm(sh.scene.railing)}`);
        if (sh.scene.zone) shown.push(`R:${norm(sh.scene.zone)}`, `start:${startKey(sh.scene.start ?? {})}`);
      }
    }
    // the answers named in the narration itself
    shown.push('V:n', 'V:k', 'R:k>=0', 'V:(f,s)', `start:${startKey({ x: 2 })}`, 'R:x>0', `start:${startKey({ x: 1 })}`);
    for (const key of new Set(shown)) {
      const ids = levelAnswers.get(key) ?? [];
      if (key === 'V:n') assert.deepEqual(ids, [1], 'n is level 1’s answer, the practice level');
      // SPEC_v0.6 §E names the start x = 1 for grow. Level 8's reference start is also x = 1, but for another
      // program (x := x - 2, whose zone is about odd numbers), and x = 1 is just the smallest start there is.
      else if (key === `start:${startKey({ x: 1 })}`) assert.deepEqual(ids, [8], 'x = 1 (the grow intro, as the spec says)');
      else assert.deepEqual(ids, [], `${key} is the answer of level ${ids.join(', ')}`);
    }
  });
});
