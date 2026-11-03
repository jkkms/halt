// Presentation logic: stairs and beats on the stage, zero-step samples, level groups, strings, the tutorial (v0.3).
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evalBool, parseRaw } from '../src/core/expr.ts';
import { parseV, railingAllowed } from '../src/core/game.ts';
import { CAMPAIGN, codePreview, GROUPS, recommendedNext } from '../src/core/groups.ts';
import { helpMenu } from '../src/core/tours.ts';
import { LEVELS, levelById, RAILING_FROM, TUPLES_FROM, TUTORIAL_PROGRAMS, type TutorialKey } from '../src/core/levels.ts';
import { guardHolds, initialState, sampleInputs, step } from '../src/core/sim.ts';
import { allowsZeroSteps, beats, guardCheck, guardText, runScene, sampleScene, stairsWithV, walk, zeroStepSample, zeroSteps, type StageScene } from '../src/core/stage.ts';
import { tables } from '../src/ui/i18n.ts';
import {
  CHAPTERS,
  focusOf,
  heldBeat,
  HOOK,
  INTRO_LEVELS,
  INTROS,
  plainText,
  PURPOSE,
  richParts,
  sceneStart,
  shotProgram,
  STAGE_FOCUS,
  stepBeats,
  TUTORIAL,
  tutScene,
  type Shot,
  type TutPage,
} from '../src/core/tutorial.ts';

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
      for (const [k, v] of Object.entries(table)) assert.ok(typeof v === 'string' && v.trim(), `${lang}.${k}`);
    }
  });

  it('no letter V on screen: the UI says “남은 계단 수” / “steps left”', () => {
    const { en, ko } = tables();
    const texts: [string, string][] = [];
    for (const [lang, table] of Object.entries({ en, ko })) for (const [k, v] of Object.entries(table)) texts.push([`${lang}.${k}`, v]);
    for (const p of [...TUTORIAL, ...Object.values(INTROS).flatMap((i) => i.pages)])
      for (const L of ['ko', 'en'] as const) {
        texts.push([`page ${L}`, plainText(p.text[L])]);
        for (const sh of p.shots) if (sh.label) texts.push([`label ${L}`, sh.label[L]]);
      }
    texts.push(['purpose.ko', PURPOSE.ko], ['purpose.en', PURPOSE.en]);
    for (const [where, text] of texts) assert.ok(!/\bV\b/.test(text), `${where}: ${text}`);
    assert.equal(ko.stepsLeft, '남은 계단 수');
    assert.equal(en.stepsLeft, 'Steps left');
    assert.equal(ko.verdictQ, '1단계 · 판정 — 이 반복문, 끝날까요?');
    assert.equal(en.verdictQ, 'Step 1 · Verdict — Will this loop end?');
    assert.equal(ko.verdictHelp, '고른 다음 2단계에서 증명해요.');
    assert.equal(en.verdictHelp, 'Then prove it in step 2.');
    assert.equal(ko.proofTitle, '2단계 · 증명');
    assert.equal(en.proofTitle, 'Step 2 · Proof');
    assert.equal(ko.proofSubEnds, '남은 계단 수 쓰기');
    assert.equal(ko.proofSubNever, '영원히 걷는 시작값 주기');
    assert.equal(ko.proofLocked, '1단계에서 먼저 골라 주세요');
    assert.equal(en.proofLocked, 'Choose in step 1 first');
    assert.equal(ko.skip, '건너뛰기');
    assert.equal(en.skip, 'Skip');
  });

  it('“ranking function” is named only where the tutorial introduces it (page 11)', () => {
    const { en, ko } = tables();
    for (const table of [en, ko]) for (const [k, v] of Object.entries(table)) assert.ok(!/ranking function/i.test(v), k);
    assert.ok(!/ranking function/i.test(PURPOSE.ko + PURPOSE.en));
    const pages = [...TUTORIAL, ...Object.values(INTROS).flatMap((i) => i.pages)];
    const naming = pages.filter((p) => /ranking function/.test(p.text.ko) || /ranking function/.test(p.text.en));
    assert.deepEqual(naming, [TUTORIAL[10]]);
  });

  it('Safari: index.html turns COEP credentialless off before coi-serviceworker runs, and loads nothing from elsewhere', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const cfg = html.indexOf('window.coi = { coepCredentialless: () => false }');
    const coi = html.indexOf('<script src="./coi-serviceworker.js">');
    assert.ok(cfg > 0 && coi > cfg, 'the coi config comes first');
    assert.ok(!/(src|href)="(https?:)?\/\//.test(html), 'no cross-origin script, style or font');
  });

  it('the judge never fails silently: plain reasons and a retry in both languages (v0.4)', () => {
    const { en, ko } = tables();
    for (const table of [en, ko]) {
      for (const k of ['judgeErrIsolation', 'judgeErrDownload', 'judgeErrInit', 'judgeErrTitle', 'retry2', 'judgePreparing', 'judgePreparingPct'] as const) assert.ok(table[k].trim(), k);
      assert.ok(table.judgePreparingPct.includes('{pct}%'));
    }
    assert.ok(!ko.judgeError.includes('쓸 수 없음') && !/unavailable/i.test(en.judgeError));
    assert.equal(ko.retry2, '다시 시도');
    assert.equal(ko.judgePreparingPct.replace('{pct}', '42'), '판정기 준비 중… 42%');
  });

  it('v0.4 words: the graph, the last check, the collapsed step 1, the mute toggle', () => {
    const { en, ko } = tables();
    assert.equal(ko.graph, '예시 실행 한눈에 보기');
    assert.equal(en.graph, 'All sample runs at a glance');
    assert.equal(`4 < 4 ${ko.stExitCheck}`, '4 < 4 거짓 → 반복 끝, 출구로');
    assert.equal(`4 < 4 ${en.stExitCheck}`, '4 < 4 false → loop ends, to the exit');
    assert.equal(`${ko.verdictChosen}: ${ko.verdictEnds} · ${ko.changeVerdict}`, '1단계 판정: 끝난다 · 바꾸기');
    assert.equal(ko.facts, '알려진 사실');
    assert.ok(ko.muteLabel && en.muteLabel);
  });

  it('the counterexample for a flat step reads like the spec', () => {
    const { ko } = tables();
    const flat = ko.cexFlat.replace(/\{v\}/g, '2');
    assert.ok(flat.includes('이 걸음에서 남은 계단 수가 2 → 2 그대로예요'), flat);
  });

  it('uses the spec’s words for the zero-step run and the hook', () => {
    const { en, ko } = tables();
    assert.equal(ko.zeroStep, '조건이 처음부터 거짓 — 걷기 전에 끝');
    assert.match(en.zeroStep, /false from the start/);
    assert.equal(ko.menuTutorial, '튜토리얼');
    assert.equal(ko.menuLevels, '증명 모드');
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
  it('every level is in exactly one group, in campaign order', () => {
    const all = GROUPS.flatMap((g) => g.levels).sort((a, b) => a - b);
    assert.deepEqual(all, CAMPAIGN);
    assert.deepEqual(
      GROUPS.map((g) => g.levels),
      [
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9],
        [10, 11, 12, 13],
        [14, 15, 16, 17],
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

  it('the “?” opens the same menu on every level: the tutorial, the three intros, this screen’s guide (SPEC_guide)', () => {
    assert.deepEqual(helpMenu(), [{ k: 'tutorial' }, { k: 'intro', level: 5 }, { k: 'intro', level: 7 }, { k: 'intro', level: 10 }, { k: 'guide' }]);
    assert.deepEqual(INTRO_LEVELS, [5, 7, 10]);
    assert.deepEqual(Object.keys(INTROS).map(Number), [5, 7, 10]);
  });

  it('the railing unlocks at level 7, the first level whose proof needs one; tuples at level 10', () => {
    assert.equal(RAILING_FROM, 7);
    assert.equal(TUPLES_FROM, 10);
    assert.ok(!railingAllowed(levelById(6)) && railingAllowed(levelById(7)));
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

describe('tutorial (v0.6: 14 pages in five chapters)', () => {
  const allPages = (): TutPage[] => [...TUTORIAL, ...Object.values(INTROS).flatMap((i) => i.pages)];
  const allShots = (): Shot[] => allPages().flatMap((p) => p.shots);
  const runOf = (sh: Shot) => {
    assert.equal(sh.scene.k, 'run');
    return sh.scene as Extract<Shot['scene'], { k: 'run' }>;
  };
  const countdown = TUTORIAL_PROGRAMS.countdown;

  it('has exactly 14 pages, each narrated in Korean and English, in the five chapters', () => {
    assert.equal(TUTORIAL.length, 14);
    for (const p of allPages()) {
      assert.ok(p.text.ko.trim() && p.text.en.trim());
      assert.ok(p.shots.length >= 1);
    }
    assert.deepEqual(
      TUTORIAL.map((p) => p.chapter),
      ['start', 'stage', 'stage', 'stage', 'stage', 'stage', 'stage', 'stage', 'verdict', 'proof', 'proof', 'proof', 'proof', 'go'],
    );
    assert.deepEqual(
      Object.values(CHAPTERS).map((c) => c.ko),
      ['시작', '무대 읽기', '1단계 판정', '2단계 증명', '시작하기'],
    );
    for (const c of Object.values(CHAPTERS)) assert.ok(c.en.trim());
    for (const intro of Object.values(INTROS)) assert.equal(intro.pages.length, 2, `intro ${intro.level}`);
  });

  it('keeps the spec’s words (spot checks; the full texts were compared with SPEC_v0.6 §D, §E)', () => {
    assert.ok(TUTORIAL[0]!.text.ko.startsWith('**Halt?에 오신 것을 환영해요!**'));
    assert.ok(TUTORIAL[0]!.text.en.endsWith("first let's go through the parts of the screen one at a time."));
    assert.ok(TUTORIAL[1]!.text.ko.startsWith('**먼저 코드부터 보세요.**'));
    assert.ok(TUTORIAL[2]!.text.ko.includes('**걸음 0**은') && TUTORIAL[2]!.text.en.includes('**step 0**'));
    assert.ok(TUTORIAL[5]!.text.ko.includes('**한 단계 ▶**') && TUTORIAL[5]!.text.en.includes('**One step ▶**'));
    assert.ok(TUTORIAL[8]!.text.ko.startsWith('**1단계 · 판정.**'));
    assert.ok(TUTORIAL[9]!.text.ko.startsWith('**2단계 · 증명(끝난다).**'));
    assert.ok(TUTORIAL[11]!.text.ko.includes('x = 2로 시작하면 2, −1, 2, −1, … 같은 두 칸을 맴돌아서'));
    assert.equal(TUTORIAL[13]!.text.ko, '이제 레벨 1에서 직접 해 봐요!');
    assert.equal(TUTORIAL[13]!.text.en, 'Now try level 1 yourself!');
    assert.ok(INTROS[7]!.pages[1]!.text.ko.includes('**난간** `k >= 0`'));
    assert.ok(INTROS[10]!.pages[1]!.text.en.includes('`(f, s)`'));
    assert.ok(INTROS[5]!.pages[1]!.text.ko.includes('Z = `x > 0`'));
  });

  it('quotes the UI labels exactly as the UI shows them', () => {
    const { en, ko } = tables();
    const both = (i: number, k: string, e: string) => {
      assert.ok(TUTORIAL[i]!.text.ko.includes(k), `page ${i + 1} ko: ${k}`);
      assert.ok(TUTORIAL[i]!.text.en.includes(e), `page ${i + 1} en: ${e}`);
    };
    // the step counter and the state at the top left of the stage
    both(2, `**${ko.stepCounter.replace('{k}', '0')}**`, `**${en.stepCounter.replace('{k}', '0')}**`);
    // the step button
    both(5, `**${ko.stepOne}**`, `**${en.stepOne}**`);
    // the verdict buttons and the level screen's Inputs line
    for (const k of ['verdictEnds', 'verdictNever', 'verdictNobody', 'inputs'] as const) both(8, `**${ko[k]}**`, `**${en[k]}**`);
    // the ruler's ground tick, and the stage's marks
    both(9, `**0 · ${ko.ground}**`, `**0 · ${en.ground}**`);
    for (const k of ['stFlat', 'stUp', 'stBelow'] as const) both(10, `**${ko[k]}**`, `**${en[k]}**`);
    // the zone's name on the stage
    assert.ok(INTROS[5]!.pages[1]!.text.ko.includes(`**${ko.zone}**`));
    assert.ok(INTROS[5]!.pages[1]!.text.en.toLowerCase().includes(`**${en.zone.toLowerCase()}**`));
  });

  it('directions are layout-free: no “right/top” of the code, “그림 왼쪽 위” only for the step counter', () => {
    for (const p of allPages())
      for (const L of ['ko', 'en'] as const) {
        const text = plainText(p.text[L]);
        assert.ok(!/오른쪽 위|top right|upper right/.test(text), text);
        if (/왼쪽 위/.test(text)) assert.ok(/그림 왼쪽 위/.test(text), text);
      }
  });

  it('every page has a focus or says why not; every focus is a known target', () => {
    const known = new Set([...STAGE_FOCUS, 'code', 'codeLine', 'hud', 'extra']);
    for (const p of allPages()) {
      const all = [...(p.focus ?? []), ...p.shots.flatMap((sh) => sh.focus ?? [])];
      assert.ok(all.length || p.noFocus, `page “${p.text.en.slice(0, 40)}” has no focus and no reason`);
      for (const f of all) assert.ok(known.has(f), f);
      if (all.includes('extra')) assert.ok(p.extra, 'a focus on the card needs a card');
    }
    assert.deepEqual(
      TUTORIAL.map((p) => p.focus ?? null),
      [null, ['code'], ['hud'], ['walker', 'stairHere'], ['check', 'codeLine'], ['codeLine', 'walker'], ['door', 'check'], null, ['extra'], ['ruler'], null, ['ring'], ['extra'], null],
    );
    assert.deepEqual(
      TUTORIAL[10]!.shots.map((_, i) => focusOf(TUTORIAL[10]!, i)),
      [['mark'], ['mark'], []],
    );
    assert.deepEqual(focusOf(INTROS[5]!.pages[0]!, 0), ['walker']);
    assert.deepEqual(focusOf(INTROS[5]!.pages[1]!, 0), ['zone']);
    assert.deepEqual(focusOf(INTROS[7]!.pages[1]!, 0), ['railing', 'ghost']);
    assert.deepEqual(focusOf(INTROS[10]!.pages[1]!, 0), ['ruler']);
  });

  it('holds, step mode and cards are where the spec puts them', () => {
    assert.deepEqual(
      TUTORIAL.map((p) => p.hold ?? (p.step ? 'step' : null)),
      [null, 'start', 'start', 'start', 'check:0:decided', 'step', 'lastCheck', null, null, null, null, null, null, null],
    );
    assert.deepEqual(
      TUTORIAL.map((p) => p.extra ?? null),
      [null, null, null, null, null, 'stepper', null, 'legend', 'verdicts', 'tryV', null, null, 'chips', 'levelCard'],
    );
    assert.ok(TUTORIAL[0]!.wide && TUTORIAL[13]!.wide);
    // the countdown runs from n = 3 on pages 2–13 and from n = 5 on the wide pages
    for (const [i, p] of TUTORIAL.entries()) {
      const sh = p.shots[0]!;
      if (shotProgram(sh) !== 'countdown') continue;
      assert.deepEqual(runOf(sh).start, p.wide ? { n: 5 } : { n: 3 }, `page ${i + 1}`);
    }
  });

  it('narration markup: **bold** and `code`', () => {
    assert.deepEqual(richParts('a **b** c `d` e'), [
      { kind: 'text', s: 'a ' },
      { kind: 'bold', s: 'b' },
      { kind: 'text', s: ' c ' },
      { kind: 'code', s: 'd' },
      { kind: 'text', s: ' e' },
    ]);
    assert.equal(plainText(TUTORIAL[9]!.text.ko).includes('`'), false);
    assert.equal(plainText(TUTORIAL[9]!.text.ko).includes('**'), false);
  });

  it('uses only tutorial-only programs, never a level (countdown is level 1’s code on purpose)', () => {
    const levelIds = new Set(LEVELS.map((l) => l.id));
    for (const prog of Object.values(TUTORIAL_PROGRAMS)) assert.ok(!levelIds.has(prog.id), `id ${prog.id}`);
    assert.equal(TUTORIAL_PROGRAMS.countdown.code, levelById(1).code);
    for (const key of ['flip', 'railing', 'floors', 'grow'] as TutorialKey[])
      for (const l of LEVELS) assert.notEqual(TUTORIAL_PROGRAMS[key].code, l.code, `${key} vs level ${l.id}`);
    const used = new Set<string>();
    for (const sh of allShots()) used.add(shotProgram(sh));
    assert.deepEqual([...used].sort(), ['countdown', 'flip', 'floors', 'grow', 'railing']);
  });

  it('every tutorial and intro shot builds a scene; several shots each have a label', () => {
    for (const p of allPages()) {
      for (const sh of p.shots) {
        assert.ok(tutScene(sh.scene).k);
        if (p.shots.length > 1) assert.ok(sh.label?.ko && sh.label.en, 'several shots: each has a label');
      }
    }
    // page 9: the code card follows the shot (countdown, then the back-and-forth loop)
    assert.deepEqual(
      TUTORIAL[8]!.shots.map(shotProgram),
      ['countdown', 'flip'],
    );
  });

  it('pages 2–8: from n = 3 the walker goes down 3 stairs and leaves by the exit', () => {
    for (const i of [1, 2, 3, 4, 5, 6, 7]) {
      const sc = stairsOf(tutScene(TUTORIAL[i]!.shots[0]!.scene));
      assert.deepEqual(
        sc.stairs.map((s) => s.h),
        [3, 2, 1, 0],
        `page ${i + 1}`,
      );
      assert.equal(sc.end, 'exit');
      assert.deepEqual(
        beats(sc).filter((b) => b.kind === 'step' || b.kind === 'exit').map((b) => b.kind),
        ['step', 'step', 'step', 'exit'],
      );
    }
  });

  it('step mode: the beats of the countdown from n = 3, with lines, step counter and status (KO/EN)', () => {
    const bs = stepBeats(countdown, sceneStart(runOf(TUTORIAL[5]!.shots[0]!)));
    const w = countdown.prog.whileLine;
    assert.equal(w, 0);
    assert.deepEqual(
      bs.map((b) => [b.kind, b.k, b.lines, b.steps, Number(b.state.n), b.holds ?? null, b.ended ?? null, !!b.auto]),
      [
        ['start', 0, [], 0, 3, null, null, false],
        ['check', 0, [0], 0, 3, true, null, false],
        ['step', 1, [1], 1, 2, null, null, false],
        ['check', 1, [0], 1, 2, true, null, false],
        ['step', 2, [1], 2, 1, null, null, false],
        ['check', 2, [0], 2, 1, true, null, false],
        ['step', 3, [1], 3, 0, null, null, false],
        ['check', 3, [0], 3, 0, false, null, false],
        ['exit', 3, [0], 3, 0, false, 3, true],
      ],
    );
    assert.deepEqual(
      bs.map((b) => b.status.ko),
      [
        '처음 상태: n = 3, 아직 한 바퀴도 안 돌았어요',
        '조건 검사: 3 > 0 → 참',
        '`n := n - 1` 실행: n = 2, 한 칸 내려가요',
        '조건 검사: 2 > 0 → 참',
        '`n := n - 1` 실행: n = 1, 한 칸 내려가요',
        '조건 검사: 1 > 0 → 참',
        '`n := n - 1` 실행: n = 0, 한 칸 내려가요',
        '조건 검사: 0 > 0 → 거짓, 반복이 끝나 출구로 나가요',
        '조건 검사: 0 > 0 → 거짓, 반복이 끝나 출구로 나가요',
      ],
    );
    assert.deepEqual(
      bs.map((b) => b.status.en),
      [
        'Start: n = 3, no round yet',
        'Check: 3 > 0 → true',
        'Run `n := n - 1`: n = 2, one stair down',
        'Check: 2 > 0 → true',
        'Run `n := n - 1`: n = 1, one stair down',
        'Check: 1 > 0 → true',
        'Run `n := n - 1`: n = 0, one stair down',
        'Check: 0 > 0 → false, so the loop ends and the walker leaves by the exit',
        'Check: 0 > 0 → false, so the loop ends and the walker leaves by the exit',
      ],
    );
    // seven presses: four checks and three steps; the walk out of the door follows the last check
    assert.equal(bs.filter((b) => b.kind !== 'start' && !b.auto).length, 7);
  });

  it('held pages show the beat the spec names', () => {
    const bs = stepBeats(countdown, sceneStart(runOf(TUTORIAL[1]!.shots[0]!)));
    assert.equal(heldBeat(bs, 'start').kind, 'start');
    const c0 = heldBeat(bs, 'check:0:decided');
    assert.ok(c0.kind === 'check' && c0.holds && c0.state.n === 3n && c0.steps === 0);
    const last = heldBeat(bs, 'lastCheck');
    assert.ok(last.kind === 'check' && !last.holds && last.state.n === 0n && last.steps === 3 && last.ended === undefined);
  });

  it('page 9: the verdict buttons, with one run that ends and one that never does', () => {
    const p = TUTORIAL[8]!;
    assert.equal(p.extra, 'verdicts');
    assert.equal(stairsOf(tutScene(p.shots[0]!.scene)).end, 'exit');
    assert.equal(tutScene(p.shots[1]!.scene).k, 'ring');
  });

  it('page 10: stairs labelled 3, 2, 1 for n = 3, 2, 1, and a box to type n', () => {
    const p = TUTORIAL[9]!;
    assert.equal(p.extra, 'tryV');
    const sc = stairsOf(tutScene(p.shots[0]!.scene));
    const walking = sc.stairs.filter((s) => s.walking);
    assert.deepEqual(
      walking.map((s) => s.v![0]),
      [3n, 2n, 1n],
    );
    assert.deepEqual(
      walking.map((s) => s.s.n),
      [3n, 2n, 1n],
    );
    assert.ok(sc.stairs.every((s) => !s.bad));
  });

  it('page 11: 0 (flat stairs), then −n (below ground), then n again (good)', () => {
    const shots = TUTORIAL[10]!.shots;
    assert.deepEqual(
      shots.map((sh) => runOf(sh).V),
      ['0', '-n', 'n'],
    );
    const bad = (sh: Shot) => stairsOf(tutScene(sh.scene)).stairs.map((s) => s.bad).filter(Boolean);
    assert.ok(bad(shots[0]!).length && bad(shots[0]!).every((b) => b === 'flat'));
    assert.ok(bad(shots[1]!).length && bad(shots[1]!).every((b) => b === 'below'));
    assert.deepEqual(bad(shots[2]!), []);
  });

  it('page 12: from x = 2 the values go 2, −1, 2, −1, … around the same two stairs', () => {
    const sh = TUTORIAL[11]!.shots[0]!;
    assert.deepEqual(sh.scene, { k: 'cycle', prog: 'flip', start: { x: 2 } });
    const sc = tutScene(sh.scene);
    assert.equal(sc.k, 'ring');
    if (sc.k === 'ring') {
      assert.deepEqual(sc.prefix, []);
      assert.deepEqual(
        sc.cycle.map((s) => s.x),
        [2n, -1n],
      );
    }
  });

  it('bottomless-zone intro: from x = 1 the walk is a shaft 1, 4, 7, 10, …, then the same shaft with the zone x > 0', () => {
    const [p1, p2] = INTROS[5]!.pages;
    const shaft = tutScene(p1!.shots[0]!.scene);
    assert.equal(shaft.k, 'shaft');
    if (shaft.k === 'shaft') {
      assert.deepEqual(
        shaft.states.slice(0, 4).map((s) => s.x),
        [1n, 4n, 7n, 10n],
      );
      assert.equal(shaft.zone, undefined);
      assert.equal(new Set(shaft.states.map((s) => s.x)).size, shaft.states.length, 'no state comes back');
    }
    const zoned = tutScene(p2!.shots[0]!.scene);
    assert.ok(zoned.k === 'shaft' && zoned.zone === 'x > 0');
    assert.throws(() => tutScene({ k: 'run', prog: 'countdown', start: { n: 3 }, zone: 'n > 0' }), /zone/);
  });

  it('railing intro: k = −5 goes below ground; the railing k >= 0 holds on the real run and leaves k = −5 out', () => {
    const [p1, p2] = INTROS[7]!.pages;
    const real = stairsOf(tutScene(p1!.shots[0]!.scene));
    assert.deepEqual(
      real.stairs.map((s) => s.s.k),
      [10n, 9n, 8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n, 0n],
    );
    const ghostRun = stairsOf(tutScene(p1!.shots[1]!.scene));
    assert.equal(ghostRun.stairs[0]!.s.k, -5n);
    assert.ok(ghostRun.stairs.every((s) => s.walking && s.bad === 'below'), 'still walking, below ground');
    assert.equal(ghostRun.end, 'more');
    const fenced = stairsOf(tutScene(p2!.shots[0]!.scene));
    const R = parseRaw(fenced.railing!);
    assert.equal(fenced.railing, 'k >= 0');
    for (const st of fenced.stairs) assert.ok(evalBool(R, st.s), 'the run stays inside the railing');
    assert.equal(fenced.ghost!.s.k, -5n);
    assert.equal(evalBool(R, fenced.ghost!.s), false, 'k = −5 is outside the railing');
    assert.equal(stairsOf(tutScene(p2!.shots[1]!.scene)).ghost, undefined, 'then the ghost is gone');
  });

  it('floors intro: (f, s) goes down a floor after the last step; f + s steps up there', () => {
    const [p1, p2] = INTROS[10]!.pages;
    const tuple = stairsOf(tutScene(p2!.shots[0]!.scene));
    assert.ok(tuple.tuple);
    assert.ok(tuple.stairs.every((s) => !s.bad));
    const floors = tuple.stairs.filter((s) => s.walking).map((s) => Number(s.s.f));
    assert.deepEqual(floors, [2, 2, 2, 1, 1, 1, 1, 1, 1]);
    const after = tuple.stairs.find((s) => s.s.f === 1n)!;
    assert.equal(after.s.s, 5n, 'the floor below starts at its top (step 5)');
    assert.deepEqual(
      p1!.shots.map((sh) => runOf(sh).V),
      ['(f, s)', 'f + s'],
    );
    // f + s goes up exactly where the floor changes: (2, 0) → (1, 5) and (1, 0) → (0, 5)
    const sum = stairsOf(tutScene(p1!.shots[1]!.scene));
    assert.deepEqual(
      sum.stairs.filter((s) => s.bad).map((s) => [s.bad, Number(s.s.f), Number(s.s.s)]),
      [
        ['up', 2, 0],
        ['up', 1, 0],
      ],
    );
  });

  it('no UI string still says the tutorial has 8 pages', () => {
    const { en, ko } = tables();
    for (const table of [en, ko])
      for (const [k, v] of Object.entries(table)) {
        assert.ok(!/8\s*(쪽|pages?\b|short pages)|\bEight\b|여덟/.test(v), `${k}: ${v}`);
      }
    assert.ok(ko.helpTutorial.includes('14') && en.helpTutorial.includes('14'));
  });
});
