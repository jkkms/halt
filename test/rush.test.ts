// Rush mode (SPEC_rush): every card's verdict proved with the real judge or by simulation, the lookalike pairs,
// "no card is a level", the scoring, the lives/streak/timeout state machine and the seeded order.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lex, parseCond } from '../src/core/expr.ts';
import { overall } from '../src/core/judge.ts';
import { proveEnds } from '../src/core/game.ts';
import { LEVELS, TUTORIAL_PROGRAMS, type Level } from '../src/core/levels.ts';
import {
  answerCard,
  cardPoints,
  CLEAR_BONUS,
  dailyRushOrder,
  isLast,
  nextCard,
  RUSH_LIVES,
  RUSH_SECONDS,
  rightCount,
  rushMarks,
  rushOrder,
  rushScene,
  rushShareText,
  startRush,
  streakMultiplier,
  type RushState,
} from '../src/core/rush.ts';
import { RUSH_CARDS, rushCardById, type RushCard } from '../src/core/rushCards.ts';
import { initialState, sampleInputs, sampleStates, simulate, startAllowed, SIM_CAP } from '../src/core/sim.ts';
import { plainText } from '../src/core/tutorial.ts';
import { tables } from '../src/ui/i18n.ts';
import { load, recordRush, RUSH_DAYS_KEPT, save } from '../src/ui/store.ts';
import { RUSH_ANSWERS } from './rushAnswers.ts';
import { nodeJudge } from './z3-node.ts';

let z: Awaited<ReturnType<typeof nodeJudge>>;
before(async () => {
  z = await nodeJudge();
});
after(async () => {
  await z.close();
});

const inputsOf = (card: RushCard, start: Record<string, number>) => Object.fromEntries(card.inputs.map((v) => [v, BigInt(start[v] ?? 0)]));

// ------------------------------------------------------------ the deck

describe('rush cards: the deck', () => {
  it('about 36 cards with their own ids, about half ending and half never ending, every tier', () => {
    assert.ok(RUSH_CARDS.length >= 30 && RUSH_CARDS.length <= 40, `${RUSH_CARDS.length} cards`);
    const ids = RUSH_CARDS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.ok(id > 200, 'ids never clash with a level or a tutorial program');
    const ends = RUSH_CARDS.filter((c) => c.verdict === 'ends').length;
    const never = RUSH_CARDS.filter((c) => c.verdict === 'never').length;
    assert.equal(ends + never, RUSH_CARDS.length, 'no "nobody knows" card');
    assert.ok(Math.abs(ends - never) <= 2, `${ends} end, ${never} never end`);
    for (const tier of [1, 2, 3]) {
      const cards = RUSH_CARDS.filter((c) => c.tier === tier);
      assert.ok(cards.length >= 6, `tier ${tier}`);
      assert.ok(cards.some((c) => c.verdict === 'ends') && cards.some((c) => c.verdict === 'never'), `tier ${tier} mixes both verdicts`);
    }
  });

  it('short: at most 4 lines of loop body, at most 3 variables, mostly 1–2', () => {
    for (const c of RUSH_CARDS) {
      const lines = c.code.split('\n');
      const w = lines.findIndex((l) => l.startsWith('while'));
      assert.equal(w, 0, `card ${c.id}: no code before the loop`);
      assert.ok(lines.length - 2 <= 4, `card ${c.id}: ${lines.length - 2} body lines`);
      assert.ok(c.vars.length <= 3, `card ${c.id}`);
    }
    const small = RUSH_CARDS.filter((c) => c.vars.length <= 2).length;
    assert.ok(small >= RUSH_CARDS.length * 0.9, `${small} of ${RUSH_CARDS.length} cards use 1–2 variables`);
  });

  it('every card parses; its samples satisfy the start condition', () => {
    for (const c of RUSH_CARDS) {
      assert.equal(c.facts, 'true');
      assert.ok(c.samples.length >= 2, `card ${c.id}`);
      for (const inp of sampleInputs(c)) assert.ok(startAllowed(c, inp), `card ${c.id}: ${JSON.stringify(c.samples)}`);
    }
  });

  it('a reason in Korean and English for every card: one short line, no letter V, no “ranking function”', () => {
    for (const c of RUSH_CARDS) {
      for (const L of ['ko', 'en'] as const) {
        const raw = c.why[L];
        const text = plainText(raw);
        assert.ok(text.trim() && !text.includes('\n'), `card ${c.id} ${L}`);
        assert.equal((raw.match(/`/g) ?? []).length % 2, 0, `card ${c.id} ${L}: backticks pair up`);
        assert.ok(!/\bV\b/.test(text) && !/ranking function/i.test(text), `card ${c.id} ${L}: ${text}`);
        assert.ok([...text].length <= (L === 'ko' ? 60 : 95), `card ${c.id} ${L} is short: ${[...text].length}`);
      }
      assert.ok(/요/.test(c.why.ko), `card ${c.id}: polite ~요 ending`);
    }
  });
});

// ------------------------------------------------------------ not a level

/** The program with its variables renamed v0, v1, … in order of first appearance. */
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

describe('rush cards are new', () => {
  const others: [string, Level][] = [...LEVELS.map((l): [string, Level] => [`level ${l.id}`, l]), ...Object.entries(TUTORIAL_PROGRAMS).map(([k, l]): [string, Level] => [`tutorial ${k}`, l])];

  it('canonical form renames variables (sanity)', () => {
    assert.equal(canonical('while (n > 0) {\n  n := n - 1\n}'), canonical('while (x > 0) { x := x - 1 }'));
    assert.notEqual(canonical('while (n > 0) { n := n - 1 }'), canonical('while (n > 0) { n := n - 2 }'));
  });

  it('no card is one of the 18 levels (or a tutorial program), not even renamed, whatever the start condition', () => {
    for (const c of RUSH_CARDS) {
      for (const [name, l] of others) assert.notEqual(canonical(c.code), canonical(l.code), `card ${c.id} is ${name}`);
    }
  });

  it('no two cards are the same program with the same start', () => {
    const seen = new Map<string, number>();
    for (const c of RUSH_CARDS) {
      const key = `${canonical(c.code)} | ${c.start}`;
      assert.ok(!seen.has(key), `cards ${seen.get(key)} and ${c.id}`);
      seen.set(key, c.id);
    }
  });
});

// ------------------------------------------------------------ verdicts

for (const card of RUSH_CARDS) {
  const ans = RUSH_ANSWERS[card.id];
  describe(`rush card ${card.id} (tier ${card.tier}, ${card.verdict})`, () => {
    it('has exactly one reference proof, for its verdict', () => {
      assert.ok(ans, 'a reference answer');
      assert.equal(!!ans!.ends, card.verdict === 'ends');
      assert.equal(!!ans!.never, card.verdict === 'never');
    });

    if (card.verdict === 'ends') {
      it(`ends: the steps left ${ans?.ends?.V}${ans?.ends?.R ? ` with the railing ${ans.ends.R}` : ''} pass the judge`, async () => {
        const a = ans!.ends!;
        const o = await proveEnds(z.judge, card, a.V, a.R ?? '');
        assert.equal(o.type, 'ends');
        if (o.type !== 'ends') return;
        assert.deepEqual(
          o.details.map((d) => [d.id, d.status]),
          o.details.map((d) => [d.id, 'pass']),
        );
        assert.equal(o.result, 'proved');
      });
      it('ends: every sample run ends', () => {
        for (const s0 of sampleStates(card)) assert.equal(simulate(card, s0, SIM_CAP).outcome, 'exit', JSON.stringify(s0, (_, x) => (typeof x === 'bigint' ? String(x) : x)));
      });
    } else {
      it(`never: ${ans?.never?.expect === 'cycle' ? 'a start that repeats a state' : `a start and the bottomless zone ${ans?.never?.expect === 'zone' ? ans.never.Z : ''}`}`, async () => {
        const w = ans!.never!;
        const inputs = inputsOf(card, w.start);
        assert.ok(startAllowed(card, inputs), 'the start is allowed');
        const s0 = initialState(card, inputs);
        if (w.expect === 'cycle') {
          const run = simulate(card, s0, SIM_CAP);
          assert.equal(run.outcome, 'cycle');
          return;
        }
        assert.notEqual(simulate(card, s0, 300).outcome, 'exit', 'the run keeps going');
        const Z = parseCond(w.Z, { vars: card.vars, locals: card.locals });
        const checks = await z.judge.checkZone(card, s0, Z);
        assert.deepEqual(
          checks.map((c) => [c.id, c.status]),
          [
            ['zoneStart', 'pass'],
            ['zoneGuard', 'pass'],
            ['zoneStep', 'pass'],
          ],
        );
        assert.equal(overall(checks), 'proved');
      });
      it('never: simple steps-left guesses are refuted (the judge agrees it does not always end)', async () => {
        for (const v of card.vars) {
          const o = await proveEnds(z.judge, card, v, '');
          assert.equal(o.type, 'ends');
          if (o.type === 'ends') assert.equal(o.result, 'refuted', `steps left = ${v}`);
        }
      });
      it('never: the walker’s sample (the first one) never ends', () => {
        const s0 = sampleStates(card)[0]!;
        assert.notEqual(simulate(card, s0, 300).outcome, 'exit');
      });
    }

    it('after the answer the stage runs the first sample: stairs to the exit, a ring or a shaft', () => {
      const sc = rushScene(card);
      if (card.verdict === 'ends') {
        assert.equal(sc.k, 'stairs');
        if (sc.k === 'stairs') {
          assert.equal(sc.end, 'exit');
          assert.ok(sc.stairs.length - 1 >= 1 && sc.stairs.length - 1 <= 12, `${sc.stairs.length - 1} steps`);
        }
      } else assert.ok(sc.k === 'ring' || sc.k === 'shaft', sc.k);
      const states = sc.k === 'stairs' ? sc.stairs.map((s) => s.s) : sc.k === 'ring' ? [...sc.prefix, ...sc.cycle] : sc.k === 'shaft' ? sc.states : [];
      for (const s of states) for (const v of card.vars) assert.ok(s[v]! < 10n ** 12n && s[v]! > -(10n ** 12n), `card ${card.id}: small numbers on the stage`);
    });
  });
}

// ------------------------------------------------------------ lookalike pairs

/** Edit distance between two token lists. */
function distance(a: string[], b: string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

const tokens = (c: RushCard) => [...lex(c.code), ...lex(c.start)].filter((t) => t.t !== 'end').map((t) => t.s);

describe('rush lookalike pairs', () => {
  const groups = new Map<string, RushCard[]>();
  for (const c of RUSH_CARDS) if (c.pair) groups.set(c.pair, [...(groups.get(c.pair) ?? []), c]);

  it('many pairs, each with both verdicts (each verdict proved above)', () => {
    assert.ok(groups.size >= 12, `${groups.size} pairs`);
    for (const [key, cards] of groups) {
      assert.ok(cards.length >= 2, key);
      assert.ok(cards.some((c) => c.verdict === 'ends') && cards.some((c) => c.verdict === 'never'), `${key}: different verdicts`);
    }
  });

  it('the proof of the twin that ends is refuted on the twin that never ends', async () => {
    for (const [key, cards] of groups) {
      for (const a of cards.filter((c) => c.verdict === 'ends'))
        for (const b of cards.filter((c) => c.verdict === 'never')) {
          const ref = RUSH_ANSWERS[a.id]!.ends!;
          const o = await proveEnds(z.judge, b, ref.V, ref.R ?? '');
          assert.equal(o.type, 'ends');
          if (o.type === 'ends') assert.equal(o.result, 'refuted', `${key}: ${ref.V} on card ${b.id}`);
        }
    }
  });

  it('the cards of a pair differ in one small thing (a few tokens of code or start)', () => {
    for (const [key, cards] of groups) {
      for (const a of cards)
        for (const b of cards) {
          if (a === b || a.verdict === b.verdict) continue;
          const d = distance(tokens(a), tokens(b));
          assert.ok(d >= 1 && d <= 6, `${key}: cards ${a.id} and ${b.id} differ by ${d} tokens`);
        }
    }
  });
});

// ------------------------------------------------------------ scoring and the run

describe('rush scoring', () => {
  it('a right answer: 100 + 10 × whole seconds left, × the streak multiplier (×1 … ×2)', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(streakMultiplier), [1, 1.25, 1.5, 1.75, 2, 2, 2]);
    assert.equal(cardPoints(15, 1), 250);
    assert.equal(cardPoints(14.99, 1), 240, 'whole seconds');
    assert.equal(cardPoints(0.4, 1), 100);
    assert.equal(cardPoints(12, 2), Math.round(220 * 1.25));
    assert.equal(cardPoints(15, 5), 500);
    assert.equal(cardPoints(15, 9), 500);
    assert.equal(cardPoints(3, 2), 163, '162.5 rounds to 163');
    assert.equal(cardPoints(99, 1), 250, 'never more than 15 seconds');
  });
});

describe('rush run: lives, streak, timeout', () => {
  const order = rushOrder('test');
  const correct = (st: RushState) => rushCardById(st.order[st.index]!).verdict;
  const wrong = (st: RushState) => (correct(st) === 'ends' ? 'never' : 'ends');

  it('three right answers build a streak; a timeout costs a life and resets it', () => {
    let st = startRush(order);
    assert.deepEqual([st.phase, st.lives, st.score, st.streak], ['question', RUSH_LIVES, 0, 0]);
    const pts: number[] = [];
    for (let i = 0; i < 3; i++) {
      st = answerCard(st, correct(st), 15 - i, correct(st));
      assert.equal(st.phase, 'feedback');
      pts.push(st.answers.at(-1)!.points);
      assert.ok(!isLast(st));
      st = nextCard(st);
      assert.equal(st.index, i + 1);
    }
    assert.deepEqual(pts, [250, Math.round(240 * 1.25), Math.round(230 * 1.5)]);
    assert.equal(st.streak, 3);
    assert.equal(st.score, pts[0]! + pts[1]! + pts[2]!);
    st = answerCard(st, null, 0, correct(st)); // the time ran out
    assert.deepEqual([st.lives, st.streak, st.answers.at(-1)!.right, st.answers.at(-1)!.given], [RUSH_LIVES - 1, 0, false, null]);
    assert.equal(st.bestStreak, 3);
    assert.equal(rushMarks(st), '✔✔✔✘');
  });

  it('answers outside a question are ignored', () => {
    let st = startRush(order);
    st = answerCard(st, correct(st), 10, correct(st));
    const again = answerCard(st, correct(st), 10, correct(st));
    assert.equal(again, st);
    assert.equal(nextCard(startRush(order)).index, 0);
  });

  it('lives 0 ends the run (no bonus)', () => {
    let st = startRush(order);
    for (let i = 0; i < RUSH_LIVES; i++) {
      st = answerCard(st, wrong(st), 9, correct(st));
      assert.equal(isLast(st), i === RUSH_LIVES - 1);
      st = nextCard(st);
    }
    assert.equal(st.phase, 'over');
    assert.deepEqual([st.lives, st.score, st.cleared, rightCount(st)], [0, 0, false, 0]);
  });

  it('answering every card with a life left gives the +500 bonus', () => {
    let st = startRush(order);
    let sum = 0;
    while (st.phase !== 'over') {
      const miss = st.index === 5; // one miss on the way
      st = answerCard(st, miss ? wrong(st) : correct(st), 7, correct(st));
      sum += st.answers.at(-1)!.points;
      st = nextCard(st);
    }
    assert.equal(st.answers.length, RUSH_CARDS.length);
    assert.equal(st.cleared, true);
    assert.equal(st.lives, RUSH_LIVES - 1);
    assert.equal(st.score, sum + CLEAR_BONUS);
    assert.equal(rightCount(st), RUSH_CARDS.length - 1);
  });

  it('the time limit is 15 seconds and there are 3 lives', () => {
    assert.equal(RUSH_SECONDS, 15);
    assert.equal(RUSH_LIVES, 3);
  });
});

describe('rush order', () => {
  const tierOf = (id: number) => rushCardById(id).tier;

  it('every card once, tier 1 first, then 2, then 3', () => {
    for (const seed of ['a', 'b', 'rush:2026-11-03']) {
      const o = rushOrder(seed);
      assert.deepEqual([...o].sort(), RUSH_CARDS.map((c) => c.id).sort());
      const tiers = o.map(tierOf);
      assert.deepEqual(tiers, [...tiers].sort());
    }
  });

  it("today's rush: the same date gives the same order, different dates different orders", () => {
    assert.deepEqual(dailyRushOrder('2026-11-03'), dailyRushOrder('2026-11-03'));
    assert.notDeepEqual(dailyRushOrder('2026-11-03'), dailyRushOrder('2026-11-04'));
    const seen = new Set<string>();
    for (let d = 0; d < 60; d++) {
      const key = new Date(Date.UTC(2026, 10, 1) + d * 86400000).toISOString().slice(0, 10);
      seen.add(dailyRushOrder(key).join(','));
    }
    assert.equal(seen.size, 60);
  });

  it('the order is shuffled (not the deck order)', () => {
    assert.notDeepEqual(dailyRushOrder('2026-11-03'), RUSH_CARDS.map((c) => c.id));
  });
});

describe('rush share line', () => {
  it('matches the spec and never names a card or a verdict', () => {
    assert.equal(rushShareText('ko', '2026-11-03', 1450, '✔✔✘✔✔✔✘✘'), 'Halt? 러시 2026-11-03 · 1,450점 · ✔✔✘✔✔✔✘✘');
    assert.equal(rushShareText('en', '2026-11-03', 1450, '✔✘'), 'Halt? Rush 2026-11-03 · 1,450 pts · ✔✘');
    assert.equal(rushShareText('ko', '2026-11-03', 90, ''), 'Halt? 러시 2026-11-03 · 90점 · ');
  });
});

describe('rush best scores in the store', () => {
  it('keeps the best of each day and of practice, under the same key, and survives junk', () => {
    const mem = new Map<string, string>();
    const fake = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const g = globalThis as { localStorage?: unknown };
    const before = g.localStorage;
    g.localStorage = fake;
    try {
      const saved = load();
      assert.deepEqual(saved.rush, { daily: {}, practiceBest: 0 });
      assert.equal(recordRush(saved.rush, '2026-11-03', 900), true);
      assert.equal(recordRush(saved.rush, '2026-11-03', 700), false);
      assert.equal(recordRush(saved.rush, '2026-11-03', 1450), true);
      assert.equal(recordRush(saved.rush, null, 300), true);
      assert.equal(recordRush(saved.rush, null, 200), false);
      save(saved);
      assert.deepEqual([...mem.keys()], ['it-ends:v1']);
      assert.deepEqual(load().rush, { daily: { '2026-11-03': 1450 }, practiceBest: 300 });
      // only the newest days are kept
      for (let d = 1; d <= RUSH_DAYS_KEPT + 5; d++) recordRush(saved.rush, `2027-01-${String(d).padStart(2, '0')}`, d);
      assert.equal(Object.keys(saved.rush.daily).length, RUSH_DAYS_KEPT);
      assert.ok(!('2026-11-03' in saved.rush.daily));
      // junk in storage
      mem.set('it-ends:v1', JSON.stringify({ rush: { daily: { nope: 5, '2026-11-04': 'x', '2026-11-05': 40 }, practiceBest: -3 } }));
      assert.deepEqual(load().rush, { daily: { '2026-11-05': 40 }, practiceBest: 0 });
      mem.set('it-ends:v1', '{broken');
      assert.deepEqual(load().rush, { daily: {}, practiceBest: 0 });
    } finally {
      g.localStorage = before;
    }
  });
});

describe('rush words', () => {
  it('uses the spec’s words for the menu, the start panel and the end', () => {
    const { en, ko } = tables();
    assert.deepEqual([ko.menuRush, ko.menuRushSub, en.menuRush, en.menuRushSub], ['러시', '15초 안에 판정 · 목숨 3개', 'Rush', 'Judge in 15 s · 3 lives']);
    assert.deepEqual([ko.rushToday, ko.rushPractice, ko.rushAgain, ko.backTitle], ['오늘의 러시', '연습', '다시', '처음 화면']);
    assert.deepEqual([en.rushToday, en.rushPractice, en.rushAgain], ['Today’s rush', 'Practice', 'Again']);
    assert.deepEqual([ko.verdictEnds, ko.verdictNever, en.verdictEnds, en.verdictNever], ['끝난다', '안 끝난다', 'It ends', 'It never ends']);
    assert.equal(ko.rushTitle, '끝날까? 러시');
    for (const k of ['rushRule1', 'rushRule2', 'rushRule3'] as const) assert.ok(ko[k].endsWith('요.') && en[k].endsWith('.'), k);
  });
});
