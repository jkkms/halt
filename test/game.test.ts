// Scoring, dates, share text and the "judge could not decide" rule.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attemptMark, isFailure, proveEnds, shareText, starsFor, utcDateKey } from '../src/core/game.ts';
import { Judge } from '../src/core/judge.ts';
import { levelById } from '../src/core/levels.ts';
import { nodeJudge } from './z3-node.ts';

let z: Awaited<ReturnType<typeof nodeJudge>>;
before(async () => {
  z = await nodeJudge();
});
after(async () => {
  await z.close();
});

describe('stars', () => {
  const ends = levelById(10); // par 5
  const never = levelById(12);
  const open = levelById(18);
  it('ends-levels: ★ solved, ★★ within 3 attempts, ★★★ also length <= par', () => {
    assert.equal(starsFor(ends, 1, 5), 3);
    assert.equal(starsFor(ends, 3, 5), 3);
    assert.equal(starsFor(ends, 1, 6), 2);
    assert.equal(starsFor(ends, 3, 6), 2);
    assert.equal(starsFor(ends, 4, 5), 1);
  });
  it('never-levels and the last level: ★★★ on the first attempt', () => {
    assert.equal(starsFor(never, 1, null), 3);
    assert.equal(starsFor(never, 2, null), 2);
    assert.equal(starsFor(never, 4, null), 1);
    assert.equal(starsFor(open, 1, null), 3);
    assert.equal(starsFor(open, 3, null), 2);
  });
});

describe('dates and the share line', () => {
  it('uses the UTC date', () => {
    assert.equal(utcDateKey(new Date('2026-11-03T23:30:00-09:00')), '2026-11-04');
    assert.equal(utcDateKey(new Date('2026-11-03T08:30:00+09:00')), '2026-11-02');
  });
  it('share text matches the spec format and never contains the answer', () => {
    assert.equal(shareText('2026-11-03', 10, ['⬇', '⬇', '✅'], 5), 'Halt? #2026-11-03 L10 ⬇⬇✅ 5 chars');
    assert.equal(shareText('2026-11-03', 12, ['✅'], null), 'Halt? #2026-11-03 L12 ✅');
  });
});

describe('attempt marks', () => {
  it('fell below ground, flat step, step up', async () => {
    const neg = await proveEnds(z.judge, levelById(1), '-n', '');
    assert.equal(attemptMark(neg), '⬇');
    const flat = await proveEnds(z.judge, levelById(1), '0', '');
    assert.equal(attemptMark(flat), '➡');
    const up = await proveEnds(z.judge, levelById(10), 'x+y', '');
    assert.equal(attemptMark(up), '⬆');
  });
});

describe('the judge could not decide', () => {
  it('a Z3 timeout gives "undecided" and costs no attempt', async () => {
    const hasty = new Judge(z.ctx, 1); // 1 ms: Z3 gives up
    const o = await proveEnds(hasty, levelById(18), '(n*n*n*n) % 97 + n / 3', 'n >= 1 && n*n*n % 7 != 3');
    assert.equal(o.type, 'ends');
    if (o.type !== 'ends') return;
    assert.ok(o.details.some((d) => d.status === 'unknown'));
    if (!o.details.some((d) => d.status === 'fail')) {
      assert.equal(o.result, 'undecided');
      assert.equal(isFailure(o), false);
    }
  });
});
