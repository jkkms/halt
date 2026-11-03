// Rush mode rules (SPEC_rush2): the order of tiers, which card comes next, scoring in tenths of a second, the endless
// run (lives, streak, timeout), the server's check of a submitted run, nicknames, the store and the words.
// The card bank itself is checked in rushCards.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkNick, nickKey, normalizeNick } from '../src/core/nick.ts';
import {
  addSeen,
  answerCard,
  cardPoints,
  checkRun,
  clampMs,
  currentCard,
  isLast,
  MIN_ANSWER_MS,
  nextCard,
  pickCard,
  rightCount,
  RUSH_LIVES,
  RUSH_MS,
  RUSH_SECONDS,
  rushShareText,
  SEEN_KEPT,
  startRush,
  streakMultiplier,
  submittedAnswers,
  tenthsLeft,
  TIER_AT,
  TIER_PATTERN,
  type CardMeta,
  type RushState,
  type SubmittedAnswer,
} from '../src/core/rush.ts';
import { RUSH_CARDS, rushCardById, type RushVerdict } from '../src/core/rushCards.ts';
import { tables } from '../src/ui/i18n.ts';
import { load, recordRush, save } from '../src/ui/store.ts';

/** A seeded random integer in [0, n) for the tests. */
function seeded(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const other = (v: RushVerdict): RushVerdict => (v === 'ends' ? 'never' : 'ends');

// ------------------------------------------------------------ the order of tiers

describe('rush: the order of tiers', () => {
  it('positions 1–20 as in the spec, then the block 2,3,2,3,1,3,2,3,3,2 again and again', () => {
    const first = Array.from({ length: 20 }, (_, i) => TIER_AT(i + 1));
    assert.deepEqual(first, [1, 1, 1, 2, 1, 1, 2, 3, 2, 1, 2, 2, 1, 3, 2, 2, 3, 1, 3, 2]);
    for (let r = 0; r < 5; r++)
      assert.deepEqual(
        Array.from({ length: 10 }, (_, i) => TIER_AT(21 + 10 * r + i)),
        [2, 3, 2, 3, 1, 3, 2, 3, 3, 2],
      );
    assert.equal(TIER_AT(1000), TIER_PATTERN.repeat[(1000 - 21) % 10]);
  });

  it('is data: changing TIER_PATTERN changes TIER_AT', () => {
    const saved = TIER_PATTERN.head[0]!;
    TIER_PATTERN.head[0] = 3;
    try {
      assert.equal(TIER_AT(1), 3);
    } finally {
      TIER_PATTERN.head[0] = saved;
    }
  });
});

// ------------------------------------------------------------ which card

describe('rush: which card comes next', () => {
  const fake = (id: number, tier: 1 | 2 | 3, family: string, pair?: string): CardMeta => ({ id, tier, family, pair });

  it('a card of the position’s tier, unseen on this device first, uniformly', () => {
    const counts = new Map<number, number>();
    const rand = seeded(7);
    const seen = RUSH_CARDS.filter((c) => c.tier === 1)
      .slice(0, 100)
      .map((c) => c.id);
    for (let k = 0; k < 2000; k++) {
      const id = pickCard({ position: 1, run: [], seen, rand });
      assert.equal(rushCardById(id).tier, 1);
      assert.ok(!seen.includes(id), 'unseen first');
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const unseen = RUSH_CARDS.filter((c) => c.tier === 1 && !seen.includes(c.id)).length;
    assert.equal(counts.size, unseen, 'every unseen card can come');
    for (const n of counts.values()) assert.ok(n > 2000 / unseen / 3 && n < (2000 / unseen) * 3, 'roughly uniform');
  });

  it('when every card of the tier was seen: the one seen longest ago', () => {
    const cards = [fake(1, 1, 'a'), fake(2, 1, 'b'), fake(3, 1, 'c'), fake(9, 2, 'z')];
    assert.equal(pickCard({ position: 1, run: [], seen: [2, 3, 1], rand: seeded(1), cards }), 2);
    assert.equal(pickCard({ position: 1, run: [], seen: [3, 1, 2], rand: seeded(1), cards }), 3);
    assert.equal(pickCard({ position: 1, run: [], seen: [3, 2], rand: seeded(1), cards }), 1, 'an unseen one before any seen one');
  });

  it('never the family of either of the two cards before it, unless nothing else is left', () => {
    const cards = [fake(1, 1, 'a'), fake(2, 1, 'a'), fake(3, 1, 'b'), fake(4, 1, 'c')];
    for (let s = 0; s < 50; s++) assert.equal(pickCard({ position: 3, run: [1, 3], seen: [], rand: seeded(s), cards }), 4);
    assert.equal(pickCard({ position: 3, run: [3, 4], seen: [], rand: seeded(3), cards: [fake(3, 1, 'b'), fake(4, 1, 'c'), fake(5, 1, 'b')] }), 5, 'gives way');
  });

  it('never both cards of a lookalike pair in one run, unless nothing else is left', () => {
    const cards = [fake(1, 1, 'a', 'p'), fake(2, 1, 'b', 'p'), fake(3, 1, 'c'), fake(4, 1, 'd', 'q'), fake(5, 1, 'e')];
    for (let s = 0; s < 50; s++) assert.notEqual(pickCard({ position: 5, run: [1, 9, 9, 9], seen: [], rand: seeded(s), cards }), 2);
    assert.equal(pickCard({ position: 1, run: [1], seen: [], rand: seeded(1), cards: [fake(1, 1, 'a', 'p'), fake(2, 1, 'b', 'p')] }), 2, 'gives way');
  });

  it('no card twice in a run until its tier is used up', () => {
    const cards = [fake(1, 1, 'a'), fake(2, 1, 'b')];
    assert.equal(pickCard({ position: 1, run: [1], seen: [], rand: seeded(1), cards }), 2);
    assert.ok([1, 2].includes(pickCard({ position: 1, run: [1, 2], seen: [], rand: seeded(1), cards })), 'used up: repeats');
  });

  it('a long run with the real bank: tiers by position, no repeats, no family twice within three, no pair twice', () => {
    for (const seed of [1, 2, 3]) {
      const rand = seeded(seed);
      let seen: number[] = [];
      const run: number[] = [];
      for (let pos = 1; pos <= 200; pos++) {
        const id = pickCard({ position: pos, run, seen, rand });
        const c = rushCardById(id);
        assert.equal(c.tier, TIER_AT(pos));
        assert.ok(!run.includes(id), `card ${id} again at ${pos}`);
        for (const prev of run.slice(-2)) assert.notEqual(rushCardById(prev).family, c.family, `family ${c.family} twice near ${pos}`);
        if (c.pair) assert.ok(!run.some((p) => rushCardById(p).pair === c.pair), `pair ${c.pair} twice`);
        run.push(id);
        seen = addSeen(seen, id);
      }
    }
  });

  it('many runs on one device: unseen cards first, so 20 runs of 15 cards ask 300 different cards', () => {
    const rand = seeded(5);
    let seen: number[] = [];
    const all = new Set<number>();
    for (let r = 0; r < 20; r++) {
      const run: number[] = [];
      for (let pos = 1; pos <= 15; pos++) {
        const id = pickCard({ position: pos, run, seen, rand });
        run.push(id);
        seen = addSeen(seen, id);
        all.add(id);
      }
    }
    assert.equal(all.size, 300);
  });

  it('the seen list keeps the newest 600 ids, each once, newest last', () => {
    let seen: number[] = [];
    for (let i = 0; i < 700; i++) seen = addSeen(seen, 1000 + i);
    assert.equal(seen.length, SEEN_KEPT);
    assert.equal(seen[0], 1100);
    seen = addSeen(seen, 1200);
    assert.equal(seen.at(-1), 1200);
    assert.equal(seen.filter((x) => x === 1200).length, 1);
  });
});

// ------------------------------------------------------------ scoring

describe('rush scoring: 5 seconds, tenths', () => {
  it('right = round((100 + 100 × t / 5) × streak multiplier), t = seconds left floored to 0.1 s', () => {
    assert.equal(RUSH_SECONDS, 5);
    assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(streakMultiplier), [1, 1.25, 1.5, 1.75, 2, 2, 2]);
    assert.equal(tenthsLeft(1000), 40);
    assert.equal(tenthsLeft(1001), 39, 'floored: 3.999 s left counts as 3.9');
    assert.equal(tenthsLeft(5000), 0);
    assert.equal(cardPoints(1000, 1), 180);
    assert.equal(cardPoints(2550, 1), 148, '2.45 s left → 2.4');
    assert.equal(cardPoints(5000, 1), 100);
    assert.equal(cardPoints(MIN_ANSWER_MS, 1), 196, 'the fastest answer counted');
    assert.equal(cardPoints(1000, 5), 360);
    assert.equal(cardPoints(3300, 2), 168, '134 × 1.25 = 167.5 rounds to 168');
  });

  it('answer times are whole ms between 200 and 5000', () => {
    assert.deepEqual([clampMs(12), clampMs(199.6), clampMs(1234.4), clampMs(9000)], [200, 200, 1234, 5000]);
  });
});

// ------------------------------------------------------------ the run

describe('rush run: endless, 3 lives', () => {
  const first = RUSH_CARDS[0]!.id;
  const correct = (st: RushState) => rushCardById(currentCard(st)).verdict;
  const ids = RUSH_CARDS.map((c) => c.id);

  it('right answers build a streak; a timeout costs a life and resets it; the run never ends by itself', () => {
    let st = startRush(first);
    assert.deepEqual([st.phase, st.lives, st.score, st.streak], ['question', RUSH_LIVES, 0, 0]);
    let n = 0;
    const pick = () => ids[++n % ids.length]!;
    for (let i = 0; i < 60; i++) {
      st = answerCard(st, correct(st), 1000, correct(st));
      assert.ok(!isLast(st));
      st = nextCard(st, pick);
      assert.equal(st.phase, 'question');
    }
    assert.equal(st.streak, 60);
    assert.equal(st.score, 180 + 225 + 270 + 315 + 56 * 360);
    st = answerCard(st, null, 1234, correct(st)); // the time ran out
    const a = st.answers.at(-1)!;
    assert.deepEqual([st.lives, st.streak, a.right, a.given, a.ms, a.points], [RUSH_LIVES - 1, 0, false, null, RUSH_MS, 0]);
    assert.equal(st.bestStreak, 60);
  });

  it('the third wrong answer ends it; answers outside a question are ignored', () => {
    let st = startRush(first);
    const answered = answerCard(st, correct(st), 900, correct(st));
    assert.equal(answerCard(answered, 'ends', 900, 'ends'), answered);
    for (let i = 0; i < RUSH_LIVES; i++) {
      st = answerCard(st, other(correct(st)), 900, correct(st));
      assert.equal(isLast(st), i === RUSH_LIVES - 1);
      st = nextCard(st, () => ids[i + 1]!);
    }
    assert.equal(st.phase, 'over');
    assert.deepEqual([st.lives, st.score, rightCount(st), st.answers.length, st.cards.length], [0, 0, 0, 3, 3]);
  });
});

// ------------------------------------------------------------ the server's check

/** A run as the game plays it: picks by TIER_AT, then `plan` decides right / wrong / timeout per answer. */
function playRun(plan: ('r' | 'w' | 't')[], ms = 1500, seed = 11): { st: RushState; answers: SubmittedAnswer[] } {
  const rand = seeded(seed);
  let st = startRush(pickCard({ position: 1, run: [], seen: [], rand }));
  for (const step of plan) {
    const v = rushCardById(currentCard(st)).verdict;
    st = answerCard(st, step === 't' ? null : step === 'r' ? v : other(v), ms, v);
    st = nextCard(st, () => pickCard({ position: st.cards.length + 1, run: st.cards, seen: [], rand }));
    if (st.phase === 'over') break;
  }
  return { st, answers: submittedAnswers(st) };
}

const reasonOf = (x: ReturnType<typeof checkRun>) => (x.ok ? 'ok' : x.reason);

describe('rush server check: the score is recomputed', () => {
  const good = playRun(['r', 'r', 'r', 'w', 'r', 'r', 't', 'r', 'r', 'r', 'r', 'r', 'r', 'w']);

  it('a good run passes with the same score the game showed', () => {
    assert.equal(good.st.phase, 'over');
    const r = checkRun(good.answers);
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) {
      assert.equal(r.score, good.st.score);
      assert.equal(r.cards, rightCount(good.st));
      assert.equal(r.bestStreak, good.st.bestStreak);
      assert.equal(r.totalMs, good.answers.reduce((a, b) => a + b.ms, 0));
    }
  });

  it('tampered times fail: too fast, too slow, a timeout sent as quick, a fraction of a ms', () => {
    assert.deepEqual(
      checkRun(good.answers.map((a, i) => (i === 2 ? { ...a, ms: 150 } : a))),
      { ok: false, reason: 'bad-time', at: 3 },
    );
    assert.deepEqual(
      checkRun(good.answers.map((a, i) => (i === 2 ? { ...a, ms: 5001 } : a))),
      { ok: false, reason: 'bad-time', at: 3 },
    );
    assert.equal(reasonOf(checkRun(good.answers.map((a) => (a.given === null ? { ...a, ms: 1000 } : a)))), 'bad-time');
    assert.equal(reasonOf(checkRun(good.answers.map((a, i) => (i === 0 ? { ...a, ms: 1.5 } : a)))), 'bad-answer');
  });

  it('faster times only earn what the game’s own rule gives', () => {
    const faster = good.answers.map((a) => (a.given === null ? a : { ...a, ms: 200 }));
    const r = checkRun(faster);
    assert.ok(r.ok && r.score > good.st.score);
  });

  it('wrong order of tiers, unknown cards, repeats, extra answers after the third wrong, and unfinished runs fail', () => {
    const swapped = [...good.answers];
    const i = swapped.findIndex((a, k) => k > 0 && rushCardById(a.id).tier !== rushCardById(swapped[0]!.id).tier);
    [swapped[0], swapped[i]] = [swapped[i]!, swapped[0]!];
    assert.equal(reasonOf(checkRun(swapped)), 'wrong-tier');
    assert.equal(reasonOf(checkRun([{ ...good.answers[0]!, id: 999999 }, ...good.answers.slice(1)])), 'unknown-card');
    const repeated = [...good.answers];
    repeated[1] = { ...repeated[0]! };
    assert.equal(reasonOf(checkRun(repeated)), 'repeated-card');
    const extra = [...good.answers, { id: good.answers[1]!.id, given: 'ends' as const, ms: 900 }];
    assert.deepEqual(checkRun(extra), { ok: false, reason: 'after-end', at: good.answers.length + 1 });
    assert.deepEqual(checkRun(good.answers.slice(0, -1)), { ok: false, reason: 'not-over' });
    assert.deepEqual(checkRun([]), { ok: false, reason: 'empty' });
    assert.deepEqual(checkRun('nope'), { ok: false, reason: 'not-a-list' });
    assert.equal(reasonOf(checkRun([{ id: good.answers[0]!.id, given: 'maybe', ms: 900 }])), 'bad-answer');
  });

  it('a short run of three wrong answers is a valid run worth 0', () => {
    const r = checkRun(playRun(['w', 't', 'w']).answers);
    assert.deepEqual(r.ok && [r.score, r.cards, r.answered], [0, 0, 3]);
  });
});

// ------------------------------------------------------------ share line

describe('rush share line', () => {
  it('matches the spec and never names a card or a verdict', () => {
    assert.equal(rushShareText('ko', 2350, 18, 9), 'Halt? 러시 · 2,350점 · 18장 · 최고 연속 9');
    assert.equal(rushShareText('en', 2350, 18, 9), 'Halt? Rush · 2,350 pts · 18 cards · best streak 9');
    assert.equal(rushShareText('en', 100, 1, 1), 'Halt? Rush · 100 pts · 1 card · best streak 1');
  });
});

// ------------------------------------------------------------ nicknames

describe('rush nicknames', () => {
  it('2–12 characters of Hangul, Latin letters, digits, space, _ and -; trimmed and NFC', () => {
    for (const ok of ['민성', 'Minsung', 'a_b-c 1', '할트러너99', 'ㅋㅋ', '  Neo  ']) assert.ok(checkNick(ok).ok, ok);
    assert.equal(normalizeNick('  Neo   Two '), 'Neo Two');
    assert.equal(normalizeNick('가'), '가', 'NFC');
    assert.deepEqual(checkNick('x'), { ok: false, problem: 'length' });
    assert.deepEqual(checkNick('abcdefghijklm'), { ok: false, problem: 'length' });
    assert.deepEqual(checkNick('   '), { ok: false, problem: 'length' });
    for (const bad of ['a.b', 'hi!', '<b>x', 'na/me', '😀😀', 'ab\tcd!']) assert.deepEqual(checkNick(bad), { ok: false, problem: 'chars' }, bad);
    assert.deepEqual(checkNick(42), { ok: false, problem: 'chars' });
  });

  it('a short block list in Korean and English, also with spaces, _ or - in between', () => {
    for (const bad of ['fuck', 'Sh it', 'f_u_c_k', '씨발', '시 발', '병신아', 'ㅅㅂ', 'xxNiggaxx']) assert.deepEqual(checkNick(bad), { ok: false, problem: 'blocked' }, bad);
    for (const ok of ['classic', 'Hancock', '김민성']) assert.ok(checkNick(ok).ok, ok);
  });

  it('the same nickname whatever the case of Latin letters', () => {
    assert.equal(nickKey(' MinSung '), 'minsung');
    assert.equal(nickKey('민성'), '민성');
  });
});

// ------------------------------------------------------------ the store

describe('rush in the store', () => {
  it('keeps the best ranked and practice scores, the seen cards, the nickname and token under the same key', () => {
    const mem = new Map<string, string>();
    const fake = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const g = globalThis as { localStorage?: unknown };
    const before = g.localStorage;
    g.localStorage = fake;
    try {
      const saved = load();
      assert.deepEqual({ ...saved.rush }, { best: 0, practiceBest: 0, seen: [] });
      assert.equal(recordRush(saved.rush, 'rush', 900), true);
      assert.equal(recordRush(saved.rush, 'rush', 700), false);
      assert.equal(recordRush(saved.rush, 'practice', 300), true);
      saved.rush.seen = [1001, 1002];
      saved.rush.nick = '민성';
      saved.rush.token = '0f8fad5b-d9cb-469f-a165-70867728950e';
      save(saved);
      assert.deepEqual([...mem.keys()], ['it-ends:v1']);
      assert.deepEqual(load().rush, { best: 900, practiceBest: 300, seen: [1001, 1002], nick: '민성', token: '0f8fad5b-d9cb-469f-a165-70867728950e' });
      // an old save (the 15-second rush kept per-day scores; the daily puzzle kept its own records) still loads
      mem.set('it-ends:v1', JSON.stringify({ best: { 1: 3 }, daily: { '2026-11-01': { level: 3, marks: ['✅'], solved: true, length: 2 } }, rush: { daily: { '2026-11-03': 1450 }, practiceBest: 250 } }));
      const old = load();
      assert.deepEqual(old.rush, { best: 0, practiceBest: 250, seen: [] });
      assert.deepEqual(old.best, { 1: 3 });
      // junk
      mem.set('it-ends:v1', JSON.stringify({ rush: { best: -3, practiceBest: 'x', seen: [1, 'a', 1, 2.5, 3], nick: 'a!', token: 'not a token' } }));
      assert.deepEqual(load().rush, { best: 0, practiceBest: 0, seen: [1, 3] });
      mem.set('it-ends:v1', '{broken');
      assert.deepEqual(load().rush, { best: 0, practiceBest: 0, seen: [] });
    } finally {
      g.localStorage = before;
    }
  });
});

// ------------------------------------------------------------ words

describe('rush words', () => {
  it('menu, modes and the end use the spec’s words', () => {
    const { en, ko } = tables();
    assert.deepEqual([ko.menuRush, ko.menuRushSub, en.menuRush, en.menuRushSub], ['러시 모드', '5초 안에 판정 · 목숨 3개', 'Rush mode', 'Judge in 5 s · 3 lives']);
    assert.deepEqual([ko.menuTutorial, ko.menuLevels, en.menuTutorial, en.menuLevels], ['튜토리얼', '증명 모드', 'Tutorial', 'Proof mode']);
    assert.deepEqual([ko.selectTitle, ko.backLevels, en.selectTitle, en.backLevels], ['증명 모드', '증명 모드', 'Proof mode', 'Proof mode']);
    assert.deepEqual([ko.rushPlay, ko.rushPractice, ko.rushAgain, ko.backTitle], ['러시 시작', '연습', '다시', '처음 화면']);
    assert.deepEqual([en.rushPlay, en.rushPractice, en.rushAgain], ['Start rush', 'Practice', 'Again']);
    assert.deepEqual([ko.verdictEnds, ko.verdictNever, en.verdictEnds, en.verdictNever], ['끝난다', '안 끝난다', 'It ends', 'It never ends']);
    assert.deepEqual([ko.rushNextHint, en.rushNextHint], ['↓ 다음', '↓ next']);
    assert.deepEqual([ko.rushInput, en.rushInput, ko.rushAnyInt, en.rushAnyInt], ['입력', 'Input', '아무 정수', 'any integer']);
    assert.equal(ko.rushOffline, '순위표에 연결하지 못했어요');
    assert.ok(!('menuDaily' in ko) && !('menuDaily' in en), 'the daily puzzle is gone');
  });

  it('the explanation has its six parts in both languages, polite Korean, no exclamation marks', () => {
    const { en, ko } = tables();
    for (const k of ['rushAboutWhat', 'rushAboutRule', 'rushAboutTiers', 'rushAboutScore', 'rushAboutFame'] as const) {
      assert.ok(ko[k].length > 20 && en[k].length > 20, k);
      assert.ok(/요\.$/.test(ko[k]), `${k} ends politely`);
    }
    for (const k of ['rushAboutWhat', 'rushAboutRule', 'rushAboutTiers', 'rushAboutScore', 'rushAboutFame', 'rushStep1', 'rushStep2', 'rushStep3', 'rushStep4', 'rushStep5'] as const) {
      assert.ok(/요/.test(ko[k]) && en[k].length > 10, k);
      assert.ok(!/!/.test(ko[k] + en[k]), `${k}: no exclamation marks`);
    }
    assert.equal(ko.rushAboutWhatH, '러시는?');
    assert.equal(ko.rushTutorialLink, "처음이라면 튜토리얼의 '1단계 · 판정'부터");
  });
});
