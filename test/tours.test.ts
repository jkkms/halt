// The level screen's guide (SPEC_guide): the four tours, when each one shows, what "?" replays, the box's place,
// and that every text says what the game really does (stars, facts, checks, the never flow) with the UI's labels.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFailure, isSolved, proveEnds, runNever, starsFor, type Outcome } from '../src/core/game.ts';
import { LEVELS, levelById, RAILING_FROM } from '../src/core/levels.ts';
import { SIM_CAP } from '../src/core/sim.ts';
import { dueTours, helpMenu, replayTours, screenState, TOUR_IDS, tourFits, tourFor, withSeen, type GuideTarget, type TourId } from '../src/core/tours.ts';
import { plainText, richParts } from '../src/core/tutorial.ts';
import { tables } from '../src/ui/i18n.ts';
import { load } from '../src/ui/store.ts';
import { clip, deskBox, deskTextWidth, phoneSheet, revealDelta, sceneInset, stageFree, TOUR, union } from '../src/ui/tourLayout.ts';
import { overlap, within, type Box } from '../src/ui/tutLayout.ts';
import { nodeJudge } from './z3-node.ts';

const L1 = levelById(1);
const bold = (text: string) => richParts(text).filter((p) => p.kind === 'bold').map((p) => p.s);

describe('the tours', () => {
  it('A: the level screen in 7 steps, B: the proof box in 4, C: the result in 1, D: the never proof in 2', () => {
    const targets = (id: TourId) => tourFor(id, L1).steps.map((s) => s.targets);
    assert.deepEqual(targets('screen'), [['stage'], ['head'], ['code'], ['inputs'], ['facts'], ['verdict'], ['topbar']]);
    assert.deepEqual(targets('proof'), [['vInput'], ['chips'], ['checkRow'], ['graph']]);
    assert.deepEqual(targets('result'), [['result']]);
    assert.deepEqual(targets('never'), [['startFields'], ['runBtn']]);
    assert.deepEqual(TOUR_IDS, ['screen', 'proof', 'result', 'never']);
    for (const id of TOUR_IDS) {
      const t = tourFor(id, L1);
      assert.ok(t.title.ko && t.title.en);
      for (const s of t.steps) {
        assert.ok(s.targets.length > 0);
        assert.ok(s.text.ko.trim() && s.text.en.trim());
      }
    }
    assert.equal(tourFor('screen', L1).title.ko, '레벨 화면 둘러보기');
    assert.equal(tourFor('never', L1).title.en, 'Proving it never ends');
  });

  it('are the same on every level of a band, whatever the level’s verdict (the guide never tells which levels end)', () => {
    for (const id of TOUR_IDS) {
      const bands = [LEVELS.filter((l) => l.id < RAILING_FROM), LEVELS.filter((l) => l.id >= RAILING_FROM)];
      for (const band of bands) {
        const json = new Set(band.map((l) => JSON.stringify(tourFor(id, l))));
        assert.equal(json.size, 1, `${id}: one tour per band`);
        // each band mixes levels that end and levels that do not
        const kinds = new Set(band.map((l) => l.kind));
        assert.ok(kinds.has('ends') && kinds.has('never'));
      }
    }
    // only the Check step changes, and only with the railing
    const a = tourFor('proof', levelById(6)).steps;
    const b = tourFor('proof', levelById(7)).steps;
    assert.deepEqual(a.map((s) => s.targets), b.map((s) => s.targets));
    a.forEach((s, i) => (i === 2 ? assert.notDeepEqual(s.text, b[i]!.text) : assert.deepEqual(s.text, b[i]!.text)));
    assert.ok(!a[2]!.text.ko.includes('난간') && b[2]!.text.ko.includes('난간 R'));
    assert.ok(!/railing/i.test(a[2]!.text.en) && b[2]!.text.en.includes('railing R'));
  });

  it('quote the UI’s labels exactly, in both languages', () => {
    const T = tables();
    for (const L of ['ko', 'en'] as const) {
      const s = T[L];
      const step = (id: TourId, i: number) => tourFor(id, levelById(7)).steps[i]!.text[L];
      const has = (text: string, labels: string[]) => {
        for (const label of labels) assert.ok(bold(text).includes(label), `${L}: “${label}” in bold in “${plainText(text)}”`);
      };
      has(step('screen', 0), [s.samplesLabel, `↻ ${s.replay}`, s.verdictEnds, s.verdictNever]);
      has(step('screen', 3), [s.inputs, s.anyIntegers]);
      has(step('screen', 4), [s.facts, s.none]);
      has(step('screen', 5), [s.verdictQ.split(' — ')[0]!, s.verdictEnds, s.verdictNever, s.verdictNobody, s.changeVerdict]);
      has(step('screen', 6), [s.judgeReady, '?']);
      has(step('proof', 0), [s.stepsLeft, s.stFlat, s.stBelow]);
      has(step('proof', 1), [s.inputExample]);
      has(step('proof', 2), [s.check]);
      has(step('proof', 3), [s.graph]);
      has(step('result', 0), [s.check]);
      has(step('never', 0), [s.startValues, s.inputs]);
      has(step('never', 1), [s.run, s.zone]);
      // the length shown beside Check: "n chars · par m" / "몇 자 · 기준 몇 자"
      assert.ok(plainText(step('proof', 2)).includes(L === 'ko' ? '몇 자 · 기준 몇 자' : 'n chars · par m'));
      // the box's buttons
      assert.equal(s.guideGotIt, L === 'ko' ? '알겠어요' : 'Got it');
      assert.equal(s.guideReplay, L === 'ko' ? '이 화면 안내 다시 보기' : 'Show this screen’s guide again');
    }
  });

  it('follow the screen’s text rules: no letter V, no “ranking function”', () => {
    for (const id of TOUR_IDS)
      for (const l of [L1, levelById(7)])
        for (const s of tourFor(id, l).steps)
          for (const L of ['ko', 'en'] as const) {
            const text = plainText(s.text[L]);
            assert.ok(!/\bV\b/.test(text), text);
            assert.ok(!/ranking function/i.test(text), text);
          }
  });
});

describe('the texts say what the game does', () => {
  let z: Awaited<ReturnType<typeof nodeJudge>>;
  before(async () => {
    z = await nodeJudge();
  });
  after(async () => {
    await z.close();
  });

  it('stars (A2): ★ solved, ★★ within 3 attempts, ★★★ also par on an ends level, first attempt on any other', () => {
    const text = tourFor('screen', L1).steps[1]!.text;
    assert.ok(text.ko.includes('★★ 3번 안에') && text.ko.includes('기준 길이 이하') && text.ko.includes('그 밖의 레벨은 첫 시도'));
    assert.ok(text.en.includes('★★ for solving within 3 attempts') && text.en.includes('on any other level, you solved it on the first attempt'));
    for (const l of LEVELS) {
      assert.equal(starsFor(l, 4, 1), 1, `level ${l.id}: more than 3 attempts`);
      if (l.kind === 'ends') {
        assert.equal(starsFor(l, 3, l.par!), 3);
        assert.equal(starsFor(l, 3, l.par! + 1), 2);
        assert.equal(starsFor(l, 2, l.par! + 1), 2);
      } else {
        assert.equal(starsFor(l, 1, null), 3, `level ${l.id}`);
        assert.equal(starsFor(l, 2, null), 2, `level ${l.id}`);
      }
    }
  });

  it('Check (B3) tests two things, and the railing too when there is one', async () => {
    const ids = (o: Outcome) => (o.type === 'ends' ? o.details.map((d) => d.id) : []);
    assert.deepEqual(ids(await proveEnds(z.judge, L1, 'n', '')), ['bounded', 'decreasing']);
    const l7 = levelById(7);
    assert.deepEqual(ids(await proveEnds(z.judge, l7, 'a + b', 'a >= 1 && b >= 1')), ['railStart', 'railStep', 'bounded', 'decreasing']);
    // the length counts the railing and ignores spaces
    const o = await proveEnds(z.judge, l7, 'a +  b', 'a >= 1');
    assert.equal(o.type === 'ends' ? o.length : -1, 'a+b'.length + 'a>=1'.length);
  });

  it('the never flow (D2): reaching the exit costs an attempt, a repeated state proves it, else the zone box opens after SIM_CAP steps', () => {
    const text = tourFor('never', L1).steps[1]!.text;
    assert.ok(text.ko.includes('10,000걸음') && text.en.includes('10,000 steps'));
    assert.equal(SIM_CAP, 10_000);
    const l5 = levelById(5);
    const zone = runNever(l5, { n: '1' });
    assert.equal(zone.type, 'needZone');
    assert.ok(zone.type === 'needZone' && zone.run.states.length - 1 >= SIM_CAP);
    assert.ok(!isFailure(zone) && !isSolved(l5, zone));
    // a level that ends: every allowed start reaches the exit, which is a failed attempt
    const ended = runNever(L1, { n: '3' });
    assert.equal(ended.type, 'ended');
    assert.ok(isFailure(ended));
    // a start that comes back to a state proves a never level at once
    const cyc = LEVELS.filter((l) => l.kind === 'never')
      .flatMap((l) => l.samples.map((smp) => ({ l, o: runNever(l, Object.fromEntries(Object.entries(smp).map(([k, v]) => [k, String(v)]))) })))
      .find((x) => x.o.type === 'cycle');
    assert.ok(cyc, 'some never level has a sample start that cycles');
    assert.ok(isSolved(cyc!.l, cyc!.o) && !isFailure(cyc!.o));
  });

  it('facts (A5): they hold at every loop check, and the judge assumes them when it checks the steps left', async () => {
    const text = tourFor('screen', L1).steps[4]!.text;
    assert.ok(text.ko.includes('검사할 때마다 늘 참인') && text.en.includes('hold every time the loop checks its condition'));
    const withFacts = LEVELS.filter((l) => l.facts !== 'true');
    assert.ok(withFacts.length > 0);
    for (const l of withFacts) for (const c of await z.judge.checkFacts(l)) assert.equal(c.status, 'pass', `level ${l.id}: ${c.id}`);
    // level 10 knows y >= 0: the same answer is a proof with the fact and fails "above ground" without it
    const l10 = levelById(10);
    assert.equal(l10.facts, 'y >= 0');
    const proved = await proveEnds(z.judge, l10, '60*x+y', '');
    assert.equal(proved.type === 'ends' && proved.result, 'proved');
    const blind = await proveEnds(z.judge, { ...l10, facts: 'true', factsExpr: L1.factsExpr }, '60*x+y', '');
    assert.equal(blind.type === 'ends' && blind.result, 'refuted');
    assert.ok(blind.type === 'ends' && blind.details.find((d) => d.id === 'bounded')?.status === 'fail');
  });
});

describe('when a tour shows', () => {
  const st = (seen: string[], form: 'ends' | 'never' | null = null, failed = false) => ({ seen, form, failed });

  it('A on the first visit, then B or D the first time that form is open, then C the first time a check fails', () => {
    assert.deepEqual(dueTours(st([])), ['screen']);
    assert.deepEqual(dueTours(st([], 'ends')), ['screen', 'proof']);
    assert.deepEqual(dueTours(st([], 'ends', true)), ['screen', 'proof', 'result']);
    assert.deepEqual(dueTours(st(['screen'], 'ends')), ['proof']);
    assert.deepEqual(dueTours(st(['screen'], 'never')), ['never']);
    assert.deepEqual(dueTours(st(['screen', 'proof'], 'ends', true)), ['result']);
    assert.deepEqual(dueTours(st(['screen', 'proof', 'result'], 'ends', true)), []);
    assert.deepEqual(dueTours(st(['screen', 'proof'], 'never')), ['never']);
    assert.deepEqual(dueTours(st(['screen', 'never'], 'never')), []);
    assert.deepEqual(dueTours(st(['screen'])), []);
  });

  it('the screen state: the form of "It ends" / "It never ends" (none for "Nobody knows"); C only after a refuted check', () => {
    assert.deepEqual(screenState(null, null), { form: null, failed: false });
    assert.deepEqual(screenState('ends', null), { form: 'ends', failed: false });
    assert.deepEqual(screenState('never', null), { form: 'never', failed: false });
    assert.deepEqual(screenState('nobody', { type: 'nobody', correct: false }), { form: null, failed: false });
    const refuted = { type: 'ends', result: 'refuted', details: [], length: 1, V: { k: 'num', v: 0n }, R: null } as unknown as Outcome;
    assert.deepEqual(screenState('ends', refuted), { form: 'ends', failed: true });
    const undecided = { ...refuted, result: 'undecided' } as Outcome;
    assert.equal(screenState('ends', undecided).failed, false);
    assert.equal(screenState('never', { type: 'ended', run: { states: [], outcome: 'exit' }, totalSteps: 3, s0: {} } as unknown as Outcome).failed, false);
  });

  it('a tour fits only while its parts are on screen', () => {
    assert.ok(tourFits('screen', { form: null, failed: false }));
    assert.ok(tourFits('proof', { form: 'ends', failed: false }) && !tourFits('proof', { form: 'never', failed: false }));
    assert.ok(tourFits('never', { form: 'never', failed: false }) && !tourFits('never', { form: null, failed: false }));
    assert.ok(tourFits('result', { form: 'ends', failed: true }) && !tourFits('result', { form: 'ends', failed: false }));
  });

  it('"show this screen’s guide again" replays A, then the open form’s tour, then C if a check failed', () => {
    assert.deepEqual(replayTours({ form: null, failed: false }), ['screen']);
    assert.deepEqual(replayTours({ form: 'ends', failed: false }), ['screen', 'proof']);
    assert.deepEqual(replayTours({ form: 'never', failed: false }), ['screen', 'never']);
    assert.deepEqual(replayTours({ form: 'ends', failed: true }), ['screen', 'proof', 'result']);
  });

  it('seen once, remembered once', () => {
    const seen = ['screen'];
    assert.deepEqual(withSeen(seen, 'proof'), ['screen', 'proof']);
    assert.deepEqual(withSeen(seen, 'screen'), ['screen']);
    assert.deepEqual(seen, ['screen'], 'the list given is not changed');
    assert.deepEqual(withSeen(undefined, 'never'), ['never']);
  });

  it('the store keeps the seen tours (strings only, once each) and works without them', () => {
    const mem = new Map<string, string>();
    const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) },
    });
    try {
      mem.set('it-ends:v1', JSON.stringify({ best: {}, introsShown: [1], guidesSeen: ['screen', 'screen', 7, 'proof'] }));
      assert.deepEqual(load().guidesSeen, ['screen', 'proof']);
      mem.set('it-ends:v1', JSON.stringify({ best: {}, introsShown: [] }));
      assert.equal(load().guidesSeen, undefined);
      mem.set('it-ends:v1', '{broken');
      assert.equal(load().guidesSeen, undefined);
    } finally {
      if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('"?" opens the same menu on every level, with this guide in it', () => {
    const menu = helpMenu();
    assert.deepEqual(menu.at(-1), { k: 'guide' });
    assert.deepEqual(menu[0], { k: 'tutorial' });
    assert.deepEqual(
      menu.filter((m) => m.k === 'intro').map((m) => (m.k === 'intro' ? m.level : 0)),
      [5, 7, 10],
    );
  });
});

describe('where the box goes', () => {
  const stages = [
    { w: 940, h: 844 }, // 1440 × 900
    { w: 780, h: 744 }, // 1280 × 800
    { w: 520, h: 640 },
    { w: 401, h: 700 }, // 901 px wide: the narrowest wide layout
  ];

  it('wide (SPEC_v0.7): a band along the bottom of the stage, its full width less the margins; the text at most a comfortable width', () => {
    for (const st of stages) {
      const band = deskBox(st, 220);
      assert.deepEqual(band, { x: TOUR.margin, y: st.h - TOUR.margin - 220, w: st.w - 2 * TOUR.margin, h: 220 });
      assert.ok(within({ x: 0, y: 0, ...st }, band));
      const text = deskTextWidth(band.w);
      assert.ok(text <= 800 && text <= band.w - 2 * TOUR.padX, `${st.w}: text ${text}`);
    }
    assert.equal(deskTextWidth(908), 800);
    assert.equal(deskTextWidth(748), 712);
  });

  it('wide: the top edge is that of the tallest step; a shorter step keeps it (only the height changes)', () => {
    const st = stages[0]!;
    const tallest = deskBox(st, 240);
    // what the view does for a step: the same top, left and width, its own height
    for (const h of [90, 160, 240]) {
      const step = { ...tallest, h };
      assert.equal(step.y, tallest.y);
      assert.ok(step.y + step.h <= st.h - TOUR.margin + 0.01);
    }
  });

  it('wide: the scene is framed above the tallest band, and the stage rings keep off it', () => {
    for (const st of stages) {
      const box = deskBox(st, 220);
      const i = sceneInset(st, box);
      const scene: Box = { x: i.left, y: i.top, w: st.w - i.left - i.right, h: st.h - i.top - i.bottom };
      assert.equal(overlap(scene, box), 0);
      assert.equal(i.left, i.right, 'the scene stays centred');
      assert.ok(scene.h > st.h * 0.4, 'the scene keeps most of the stage');
      const free = stageFree({ x: 0, y: 0, ...st }, box);
      assert.equal(overlap(free, box), 0);
    }
  });

  it('phones: a sheet near the bottom of the viewport at its tallest, inside it; its top stays', () => {
    for (const view of [{ w: 390, h: 844 }, { w: 360, h: 640 }, { w: 820, h: 1180 }]) {
      const sheet = phoneSheet(view, 230);
      assert.ok(within({ x: 0, y: 0, ...view }, sheet));
      assert.equal(sheet.y + sheet.h, view.h - TOUR.sheet);
      assert.equal(sheet.w, view.w - 2 * TOUR.sheet);
    }
  });

  it('rings and scrolling', () => {
    const area: Box = { x: 0, y: 100, w: 400, h: 400 };
    assert.equal(revealDelta({ x: 0, y: 200, w: 100, h: 50 }, area), 0);
    assert.equal(revealDelta({ x: 0, y: 40, w: 100, h: 50 }, area), 40 - 110);
    assert.equal(revealDelta({ x: 0, y: 600, w: 100, h: 50 }, area), 650 - 490);
    assert.equal(revealDelta({ x: 0, y: 300, w: 100, h: 900 }, area), 300 - 110, 'a tall target shows its top');
    assert.deepEqual(clip({ x: -10, y: 90, w: 50, h: 50 }, area), { x: 0, y: 100, w: 40, h: 40 });
    assert.equal(clip({ x: 0, y: 0, w: 10, h: 10 }, area), null);
    assert.deepEqual(union([{ x: 0, y: 0, w: 10, h: 10 }, null, { x: 20, y: 5, w: 10, h: 10 }]), { x: 0, y: 0, w: 30, h: 15 });
    assert.equal(union([]), null);
  });
});

// keep the target names in one place: every target of every tour is one the view knows
const KNOWN: GuideTarget[] = ['stage', 'head', 'code', 'inputs', 'facts', 'verdict', 'topbar', 'vInput', 'chips', 'checkRow', 'graph', 'result', 'startFields', 'runBtn'];
describe('targets', () => {
  it('every step names targets the level screen has', () => {
    for (const id of TOUR_IDS) for (const s of tourFor(id, L1).steps) for (const t of s.targets) assert.ok(KNOWN.includes(t), t);
  });
});
