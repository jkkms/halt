// v0.2 presentation logic: stairs and beats on the stage, zero-step samples, level groups, tutorial pages.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evalBool, parseRaw } from '../src/core/expr.ts';
import { parseV } from '../src/core/game.ts';
import { CAMPAIGN, codePreview, GROUPS, helpChapter, introChapter, recommendedNext } from '../src/core/groups.ts';
import { LEVELS, levelById } from '../src/core/levels.ts';
import { guardHolds, initialState, sampleInputs, step } from '../src/core/sim.ts';
import { allowsZeroSteps, beats, guardCheck, guardText, runScene, sampleScene, stairsWithV, walk, zeroStepSample, zeroSteps, type StageScene } from '../src/core/stage.ts';
import { tables } from '../src/ui/i18n.ts';
import { CHAPTERS, chapterByN, FIRST_CHAPTERS, HOOK, PURPOSE, tutScene } from '../src/core/tutorial.ts';

type Stairs = Extract<StageScene, { k: 'stairs' }>;
const stairsOf = (s: StageScene): Stairs => {
  assert.equal(s.k, 'stairs');
  return s as Stairs;
};

describe('zero-step sample runs', () => {
  it('level 2 has a negative-n sample that runs zero times', () => {
    const l2 = levelById(2);
    const i = zeroStepSample(l2);
    assert.ok(i >= 0);
    const all = sampleInputs(l2);
    const idx = all.findIndex((x) => x.n! < 0n);
    assert.ok(idx >= 0, 'a sample with n < 0');
    assert.ok(zeroSteps(l2, all[idx]!));
    const sc = stairsOf(sampleScene(l2, idx, parseV(l2, 'n - i')));
    assert.equal(sc.stairs.length, 1);
    assert.equal(sc.end, 'exit');
    assert.deepEqual(
      beats(sc).map((b) => b.kind),
      ['guard', 'exit'],
    );
    const [g, e] = beats(sc);
    assert.ok(g!.kind === 'guard' && !g!.holds && g!.line === l2.prog.whileLine);
    assert.ok(e!.kind === 'exit' && e!.steps === 0);
  });

  it('every level that allows a zero-step start has one among its samples', () => {
    for (const l of LEVELS) {
      if (allowsZeroSteps(l)) assert.ok(zeroStepSample(l) >= 0, `level ${l.id}`);
      else assert.equal(zeroStepSample(l), -1, `level ${l.id}`);
    }
    assert.equal(allowsZeroSteps(levelById(5)), false, 'level 5: n >= 1 and i = 0 always enter the loop');
  });
});

describe('the loop condition on the stage', () => {
  it('shows the condition with the state filled in', () => {
    const l2 = levelById(2);
    assert.equal(guardText(l2), 'i < n');
    assert.equal(guardCheck(l2, initialState(l2, { n: -3n })), '0 < −3');
    assert.equal(guardText(levelById(9)), 'i ≠ n');
    const sc = stairsOf(runScene(levelById(1), initialState(levelById(1), { n: 2n }), null));
    assert.deepEqual(
      sc.stairs.map((s) => s.check),
      ['2 > 0', '1 > 0', '0 > 0'],
    );
  });
});

describe('strings', () => {
  it('every string exists, non-empty, in Korean and English', () => {
    const { en, ko } = tables();
    assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
    for (const [lang, table] of Object.entries({ en, ko })) {
      for (const [k, v] of Object.entries(table)) {
        if (typeof v === 'string') assert.ok(v.trim(), `${lang}.${k}`);
        else assert.ok(Array.isArray(v) && v.length, `${lang}.${k}`);
      }
    }
  });

  it('uses the spec’s words for the zero-step run and the hook', () => {
    const { en, ko } = tables();
    assert.equal(ko.zeroStep, '조건이 처음부터 거짓 — 걷기 전에 끝');
    assert.match(en.zeroStep, /false from the start/);
    assert.equal(ko.menuTutorial, '튜토리얼');
    assert.equal(ko.menuLevels, '레벨');
    assert.equal(ko.menuDaily, '오늘의 문제');
  });
});

describe('stairs and beats', () => {
  const l1 = levelById(1);
  const s0 = initialState(l1, { n: 4n });

  it('a correct V walks down every stair and leaves through the door', () => {
    const sc = stairsOf(runScene(l1, s0, parseV(l1, 'n')));
    assert.deepEqual(
      sc.stairs.map((s) => s.h),
      [4, 3, 2, 1, 0],
    );
    assert.ok(sc.stairs.every((s) => !s.bad));
    assert.deepEqual(
      sc.stairs.map((s) => s.walking),
      [true, true, true, true, false],
    );
    const b = beats(sc);
    assert.deepEqual(
      b.map((x) => x.kind),
      ['guard', 'step', 'guard', 'step', 'guard', 'step', 'guard', 'step', 'guard', 'exit'],
    );
    const st = b.find((x) => x.kind === 'step');
    assert.ok(st?.kind === 'step' && st.lines.includes(1), 'the body line runs on a step');
  });

  it('the condition is checked before the first step', () => {
    const sc = stairsOf(runScene(l1, initialState(l1, { n: 0n }), parseV(l1, 'n')));
    assert.deepEqual(
      beats(sc).map((x) => x.kind),
      ['guard', 'exit'],
    );
  });

  it('marks flat steps, steps below ground and steps up', () => {
    const flat = stairsOf(runScene(l1, s0, parseV(l1, '0')));
    assert.equal(flat.stairs[0]!.bad, 'flat');
    const below = stairsOf(runScene(l1, s0, parseV(l1, '-n')));
    assert.equal(below.stairs[0]!.bad, 'below');
    const plus = stairsOf(runScene(l1, s0, parseV(l1, 'n + 1')));
    assert.ok(plus.stairs.every((s) => !s.bad));
    const l10 = levelById(10);
    const up = stairsOf(runScene(l10, initialState(l10, { x: 2n, y: 0n }), parseV(l10, 'x + y'), 6));
    assert.equal(up.stairs[0]!.bad, 'up');
    assert.equal(up.end, 'more');
  });

  it('tuples are drawn on floors: (x, y) goes down a floor when the minutes roll over', () => {
    const l10 = levelById(10);
    const sc = stairsOf(runScene(l10, initialState(l10, { x: 2n, y: 0n }), parseV(l10, '(x, y)')));
    assert.ok(sc.tuple);
    assert.ok(sc.stairs.every((s) => !s.bad));
    const hs = sc.stairs.filter((s) => s.walking).map((s) => s.h);
    for (let i = 1; i < hs.length; i++) assert.ok(hs[i]! < hs[i - 1]!, 'heights go down');
    assert.equal(Math.floor(hs[0]!), 2);
    assert.equal(Math.floor(hs[1]!), 1);
  });

  it('without V a finished run is drawn with its real steps left; a run that never ends is a shaft or a ring', () => {
    const real = stairsOf(runScene(l1, s0, null));
    assert.ok(real.real);
    assert.deepEqual(
      real.stairs.map((s) => s.h),
      [4, 3, 2, 1, 0],
    );
    const l5 = levelById(5);
    assert.equal(runScene(l5, initialState(l5, { n: 1n }), null).k, 'shaft');
    const l17 = levelById(17);
    const ring = runScene(l17, initialState(l17, { x: 1n, y: 0n }), null);
    assert.equal(ring.k, 'ring');
    if (ring.k === 'ring') assert.equal(ring.cycle.length, 1);
  });

  it('long runs stop drawing after the cap and say the walk goes on', () => {
    const l10 = levelById(10);
    const sc = stairsOf(runScene(l10, initialState(l10, { x: 3n, y: 59n }), parseV(l10, '(x, y)'), 20));
    assert.equal(sc.stairs.length, 21);
    assert.equal(sc.end, 'more');
    assert.equal(beats(sc).at(-1)!.kind, 'more');
  });

  it('a walk agrees with the simulator', () => {
    for (const l of LEVELS) {
      for (const inp of sampleInputs(l)) {
        const w = walk(l, initialState(l, inp), 30);
        for (let k = 0; k + 1 < w.states.length; k++) assert.deepEqual(w.states[k + 1], step(l, w.states[k]!).next);
        if (w.exited) assert.equal(guardHolds(l, w.states.at(-1)!), false);
      }
    }
  });
});

describe('level groups', () => {
  it('every level is in exactly one group, in the spec’s chapters', () => {
    const all = GROUPS.flatMap((g) => g.levels).sort((a, b) => a - b);
    assert.deepEqual(all, CAMPAIGN);
    assert.deepEqual(
      GROUPS.map((g) => g.levels),
      [
        [1, 2, 3, 4],
        [5, 8, 12, 17],
        [9, 10, 11, 13],
        [6, 7, 14, 15, 16],
        [18],
      ],
    );
    for (const g of GROUPS) assert.ok(g.title.ko && g.title.en);
  });

  it('recommends the first unsolved level in campaign order', () => {
    assert.equal(recommendedNext({}), 1);
    assert.equal(recommendedNext({ 1: 3, 2: 1 }), 3);
    assert.equal(recommendedNext({ 1: 3, 3: 2 }), 2);
    assert.equal(recommendedNext(Object.fromEntries(CAMPAIGN.map((id) => [id, 1]))), null);
  });

  it('points every level at an existing tutorial chapter', () => {
    for (const l of LEVELS) assert.ok(CHAPTERS.some((c) => c.n === helpChapter(l.id)));
    assert.equal(helpChapter(9), 5);
    assert.equal(helpChapter(10), 6);
    assert.equal(helpChapter(5), 4);
    assert.equal(introChapter(5), 4);
    assert.equal(introChapter(9), 5);
    assert.equal(introChapter(10), 6);
    assert.equal(introChapter(1), null);
  });

  it('code previews show the loop head and never the verdict', () => {
    for (const l of LEVELS) {
      const p = codePreview(l);
      assert.match(p, /while \(/);
      assert.ok(!/never|ends|open|끝/.test(p), p);
    }
    assert.equal(codePreview(levelById(1)), 'while (n > 0) { n := n - 1 }');
    assert.equal(codePreview(levelById(2)), 'i := 0; while (i < n) { i := i + 1 }');
    assert.ok(codePreview(levelById(13)).endsWith('… }'));
  });
});

describe('tutorial', () => {
  it('has the seven chapters of the spec, each with narrated pages in both languages', () => {
    assert.deepEqual(
      CHAPTERS.map((c) => c.n),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.deepEqual(FIRST_CHAPTERS, [1, 2, 3]);
    for (const c of CHAPTERS) {
      assert.ok(c.title.ko && c.title.en && c.summary.ko && c.summary.en);
      assert.ok(c.pages.length >= 3, `chapter ${c.n}`);
      for (const p of c.pages) assert.ok(p.text.ko.trim() && p.text.en.trim());
    }
    assert.equal(chapterByN(4).level, 5);
    assert.equal(chapterByN(5).level, 9);
    assert.equal(chapterByN(6).level, 10);
  });

  it('the purpose text keeps “ranking function” in English and names both proof pieces', () => {
    assert.ok(PURPOSE.ko.includes('ranking function'));
    assert.ok(PURPOSE.ko.includes('부분 정확성') && PURPOSE.ko.includes('종료'));
    assert.ok(/termination/i.test(PURPOSE.en) && /partial correctness/i.test(PURPOSE.en));
    assert.ok(HOOK.ko && HOOK.en);
    assert.equal(chapterByN(1).pages[0]!.extra, 'purpose');
  });

  it('every page builds a scene, and its code card matches its level', () => {
    for (const c of CHAPTERS) {
      for (const p of c.pages) {
        const sc = tutScene(p.scene);
        assert.ok(sc.k);
        if (p.code && p.scene.k !== 'idle') assert.equal(p.code, p.scene.level, `chapter ${c.n}`);
      }
    }
  });

  it('chapter 1 shows level 2 with n = -3 running zero steps', () => {
    const page = chapterByN(1).pages.find((p) => p.scene.k === 'run' && p.scene.level === 2);
    assert.ok(page);
    const sc = stairsOf(tutScene(page!.scene));
    assert.deepEqual(
      beats(sc).map((b) => b.kind),
      ['guard', 'exit'],
    );
    assert.ok(page!.text.ko.includes('−3') && page!.text.en.includes('−3'));
  });

  it('chapter 2 animates 0 (flat), -n (below ground), n + 1 (passes), then n', () => {
    const vs = chapterByN(2)
      .pages.map((p) => (p.scene.k === 'run' ? p.scene.V : undefined))
      .filter(Boolean);
    const order = ['0', '-n', 'n + 1', 'n'];
    let at = 0;
    for (const v of vs) if (v === order[at]) at++;
    assert.equal(at, order.length, `order of V in chapter 2: ${vs.join(', ')}`);
    const bad = (V: string) => stairsOf(tutScene({ k: 'run', level: 1, start: { n: 4 }, V })).stairs.map((s) => s.bad).filter(Boolean);
    assert.equal(bad('0')[0], 'flat');
    assert.equal(bad('-n')[0], 'below');
    assert.deepEqual(bad('n + 1'), []);
    assert.deepEqual(bad('n'), []);
    assert.ok(chapterByN(2).pages.some((p) => p.extra === 'tryV'));
  });

  it('chapter 3 offers chips, symbols, the / and % rule, and length', () => {
    const extras = chapterByN(3).pages.map((p) => p.extra);
    for (const e of ['chips', 'symbols', 'divmod', 'length'] as const) assert.ok(extras.includes(e), e);
  });

  it('chapter 4 shows a run of level 5 that never ends, a cycle, and the zone i < n', () => {
    const pages = chapterByN(4).pages;
    const never = pages.find((p) => p.scene.k === 'never' && p.scene.level === 5);
    assert.ok(never);
    assert.equal(tutScene(never!.scene).k, 'shaft');
    const cyc = pages.find((p) => p.scene.k === 'cycle');
    assert.equal(tutScene(cyc!.scene).k, 'ring');
    const zone = pages.find((p) => p.scene.k === 'never' && p.scene.zone);
    const sc = tutScene(zone!.scene);
    assert.ok(sc.k === 'shaft' && sc.zone === 'i < n');
    // the zone holds on every drawn state of the run
    if (sc.k === 'shaft') for (const s of sc.states) assert.ok(evalBool(parseRaw('i < n'), s));
    assert.ok(pages.some((p) => p.extra === 'verdicts'));
  });

  it('chapter 5: the ghost state breaks V without a railing, and the railing rules it out', () => {
    const l9 = levelById(9);
    const page = chapterByN(5).pages.find((p) => p.scene.k === 'run' && p.scene.railing && p.scene.ghost);
    assert.ok(page && page.scene.k === 'run');
    const sc = stairsOf(tutScene(page!.scene));
    const g = sc.ghost!;
    assert.ok(guardHolds(l9, g.s), 'the loop would keep running there');
    assert.equal(g.bad, 'below');
    const R = parseRaw(sc.railing!);
    assert.equal(evalBool(R, g.s), false, 'outside the railing');
    for (const st of sc.stairs) assert.ok(evalBool(R, st.s), 'the run stays inside the railing');
  });

  it('chapter 6: x + y steps up on the minute rollover, (x, y) does not', () => {
    const pages = chapterByN(6).pages;
    const xy = pages.find((p) => p.scene.k === 'run' && p.scene.V === 'x + y');
    assert.equal(stairsOf(tutScene(xy!.scene)).stairs[0]!.bad, 'up');
    const tup = pages.find((p) => p.scene.k === 'run' && p.scene.V === '(x, y)');
    assert.ok(stairsOf(tutScene(tup!.scene)).stairs.every((s) => !s.bad));
  });

  it('the stairs drawn for a V agree with stairsWithV', () => {
    const l1 = levelById(1);
    const w = walk(l1, initialState(l1, { n: 3n }), 10);
    const a = stairsWithV(l1, parseV(l1, 'n'), w.states).map((s) => s.h);
    assert.deepEqual(a, [3, 2, 1, 0]);
  });
});
