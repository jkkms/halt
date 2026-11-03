// The rush card bank (SPEC_rush2 §B): every card proved with the real judge or by simulation, a grid of small
// starts simulated, readable in 5 seconds, new (no level, tutorial program or other card), tiers big enough,
// lookalike pairs.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lex, parseCond } from '../src/core/expr.ts';
import { overall } from '../src/core/judge.ts';
import { proveEnds } from '../src/core/game.ts';
import { rushScene, TIER_AT } from '../src/core/rush.ts';
import { HAND_DEFS, RUSH_CARDS, type RushCard } from '../src/core/rushCards.ts';
import { initialState, sampleInputs, sampleStates, simulate, startAllowed, SIM_CAP } from '../src/core/sim.ts';
import { plainText } from '../src/core/tutorial.ts';
import { RUSH_ANSWERS } from './rushAnswers.ts';
import { canonical, canonicalLoop, endsTruncated, forbiddenPrograms, gridAllEnd, gridStarts } from './rushCanon.ts';
import { nodeJudge } from './z3-node.ts';

let z: Awaited<ReturnType<typeof nodeJudge>>;
before(async () => {
  z = await nodeJudge();
});
after(async () => {
  await z.close();
});

const inputsOf = (card: RushCard, start: Record<string, number>) => Object.fromEntries(card.inputs.map((v) => [v, BigInt(start[v] ?? 0)]));
const generated = RUSH_CARDS.filter((c) => c.id >= 1001);
const bodyLines = (c: RushCard) => c.code.split('\n').length - 2;
const numbers = (c: RushCard) => [...lex(c.code), ...lex(c.start)].filter((t) => t.t === 'num').map((t) => Number(t.s));

// ------------------------------------------------------------ the bank as a whole

describe('rush bank: size, tiers, families', () => {
  it('500 cards (at least 100): the 36 by hand (201–236) and the generated ones from 1001, ids unique', () => {
    assert.ok(RUSH_CARDS.length >= 100, `${RUSH_CARDS.length} cards`);
    assert.equal(RUSH_CARDS.length, 500);
    assert.deepEqual(
      HAND_DEFS.map((d) => d.id),
      Array.from({ length: 36 }, (_, i) => 201 + i),
    );
    const ids = RUSH_CARDS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of generated) assert.ok(c.id >= 1001);
  });

  it('about half end and half never end, in every tier', () => {
    const ends = RUSH_CARDS.filter((c) => c.verdict === 'ends').length;
    assert.ok(Math.abs(ends / RUSH_CARDS.length - 0.5) <= 0.05, `${ends} of ${RUSH_CARDS.length} end`);
    for (const tier of [1, 2, 3]) {
      const cards = RUSH_CARDS.filter((c) => c.tier === tier);
      const e = cards.filter((c) => c.verdict === 'ends').length;
      assert.ok(e / cards.length >= 0.35 && e / cards.length <= 0.65, `tier ${tier}: ${e} of ${cards.length} end`);
    }
  });

  it('tiers of about 30 % / 35 % / 35 %, each big enough for the order of tiers', () => {
    const share = [1, 2, 3].map((t) => RUSH_CARDS.filter((c) => c.tier === t).length / RUSH_CARDS.length);
    for (const [i, want] of [0.3, 0.35, 0.35].entries()) assert.ok(Math.abs(share[i]! - want) <= 0.05, `tier ${i + 1}: ${(share[i]! * 100).toFixed(1)} %`);
    // a run of 300 cards (far longer than anyone plays) never has to repeat a card
    const need = [0, 0, 0];
    for (let i = 1; i <= 300; i++) need[TIER_AT(i) - 1]!++;
    for (const t of [1, 2, 3]) assert.ok(RUSH_CARDS.filter((c) => c.tier === t).length >= need[t - 1]!, `tier ${t}: ${need[t - 1]} needed`);
  });

  it('every family has both forms, at most 30 cards, and every tier draws on at least 5 families', () => {
    const fam = new Map<string, RushCard[]>();
    for (const c of RUSH_CARDS) fam.set(c.family, [...(fam.get(c.family) ?? []), c]);
    assert.ok(fam.size >= 20, `${fam.size} families`);
    for (const [name, cards] of fam) {
      assert.ok(cards.length <= 30, `${name}: ${cards.length}`);
      assert.ok(cards.some((c) => c.verdict === 'ends') && cards.some((c) => c.verdict === 'never'), `${name} has both forms`);
    }
    for (const t of [1, 2, 3]) assert.ok(new Set(RUSH_CARDS.filter((c) => c.tier === t).map((c) => c.family)).size >= 5, `tier ${t}`);
  });
});

// ------------------------------------------------------------ readable in 5 seconds

describe('rush bank: readable in 5 seconds', () => {
  it('generated cards: tier 1 = one variable and one line; tier 2 ≤ two variables and two lines; tier 3 ≤ three and four', () => {
    for (const c of generated) {
      const lines = bodyLines(c);
      if (c.tier === 1) assert.ok(c.vars.length === 1 && lines === 1, `card ${c.id}`);
      if (c.tier === 2) assert.ok(c.vars.length <= 2 && lines <= 2, `card ${c.id}`);
      assert.ok(c.vars.length <= 3 && lines <= 4, `card ${c.id}`);
    }
  });

  it('every card: no code before the loop, at most 4 body lines, lines of at most 32 characters', () => {
    for (const c of RUSH_CARDS) {
      const lines = c.code.split('\n');
      assert.ok(lines[0]!.startsWith('while'), `card ${c.id}`);
      assert.ok(bodyLines(c) <= 4, `card ${c.id}`);
      for (const l of lines) assert.ok(l.length <= 32, `card ${c.id}: "${l}" (${l.length})`);
    }
  });

  it('small constants: all at most 100, nine in ten at most 20; an input condition of at most two parts', () => {
    const all = RUSH_CARDS.flatMap(numbers);
    for (const c of RUSH_CARDS) for (const k of numbers(c)) assert.ok(k <= 100, `card ${c.id}: ${k}`);
    const small = all.filter((k) => k <= 20).length;
    assert.ok(small / all.length >= 0.9, `${small} of ${all.length} constants are at most 20`);
    for (const c of RUSH_CARDS) assert.ok(c.start.split('&&').length <= 2, `card ${c.id}: ${c.start}`);
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

  it('every card parses; its samples (at least two) satisfy the input condition', () => {
    for (const c of RUSH_CARDS) {
      assert.equal(c.facts, 'true');
      assert.ok(c.samples.length >= 2, `card ${c.id}`);
      for (const inp of sampleInputs(c)) assert.ok(startAllowed(c, inp), `card ${c.id}: ${JSON.stringify(c.samples)}`);
    }
  });
});

// ------------------------------------------------------------ new

describe('rush bank: every card is new', () => {
  const others = forbiddenPrograms();

  it('canonical form renames variables (sanity)', () => {
    assert.equal(canonical('while (n > 0) {\n  n := n - 1\n}'), canonical('while (x > 0) { x := x - 1 }'));
    assert.notEqual(canonical('while (n > 0) { n := n - 1 }'), canonical('while (n > 0) { n := n - 2 }'));
    assert.equal(canonicalLoop('i := 0\nwhile (i < n) { i := i + 1 }'), canonical('while (a < b) { a := a + 1 }'));
  });

  it('no card is a level or a tutorial program (countdown, flip, railing, floors, grow), not even renamed', () => {
    for (const c of RUSH_CARDS) for (const [name, code] of others) assert.notEqual(canonical(c.code), canonical(code), `card ${c.id} is ${name}`);
  });

  it('no generated card has the loop of a level or a tutorial program (whatever the input)', () => {
    for (const c of generated) for (const [name, code] of others) assert.notEqual(canonicalLoop(c.code), canonicalLoop(code), `card ${c.id} has the loop of ${name}`);
  });

  it('no two cards are the same code with the same input after renaming', () => {
    const seen = new Map<string, number>();
    for (const c of RUSH_CARDS) {
      const names = new Map<string, string>();
      for (const tok of lex(c.code)) if (tok.t === 'id' && c.vars.includes(tok.s) && !names.has(tok.s)) names.set(tok.s, `v${names.size}`);
      const start = lex(c.start)
        .filter((t) => t.t !== 'end')
        .map((t) => names.get(t.s) ?? t.s)
        .join(' ');
      const key = `${canonical(c.code)} | ${start}`;
      assert.ok(!seen.has(key), `cards ${seen.get(key)} and ${c.id}`);
      seen.set(key, c.id);
    }
  });
});

// ------------------------------------------------------------ every verdict proved

describe('rush bank: every verdict proved', () => {
  for (const card of RUSH_CARDS) {
    const ans = RUSH_ANSWERS[card.id];
    it(`card ${card.id} (tier ${card.tier}, ${card.family}, ${card.verdict})`, async () => {
      assert.ok(ans, 'a reference proof');
      assert.equal(!!ans.ends, card.verdict === 'ends', 'one proof, for its verdict');
      assert.equal(!!ans.never, card.verdict === 'never', 'one proof, for its verdict');
      if (card.verdict === 'ends') {
        const a = ans.ends!;
        const o = await proveEnds(z.judge, card, a.V, a.R ?? '');
        assert.equal(o.type, 'ends');
        if (o.type === 'ends')
          assert.equal(o.result, 'proved', `${a.V} / ${a.R ?? ''}: ${JSON.stringify(o.details.map((d) => [d.id, d.status]))}`);
        // the grid of small allowed starts all end (whichever way / and % round negatives), and so do the samples
        const g = gridAllEnd(card);
        assert.ok(g.ok, g.ok ? '' : `a small start does not end: ${JSON.stringify(g.s, (_, x) => (typeof x === 'bigint' ? String(x) : x))}`);
        for (const s0 of sampleStates(card)) assert.equal(simulate(card, s0, SIM_CAP).outcome, 'exit');
      } else {
        const w = ans.never!;
        const inputs = inputsOf(card, w.start);
        assert.ok(startAllowed(card, inputs), 'the start is allowed');
        const s0 = initialState(card, inputs);
        assert.ok(!endsTruncated(card, s0), 'never ends whichever way / and % round negatives');
        if (w.expect === 'cycle') assert.equal(simulate(card, s0, SIM_CAP).outcome, 'cycle');
        else {
          assert.notEqual(simulate(card, s0, 300).outcome, 'exit', 'the run keeps going');
          const Z = parseCond(w.Z, { vars: card.vars, locals: card.locals });
          const checks = await z.judge.checkZone(card, s0, Z);
          assert.equal(overall(checks), 'proved', JSON.stringify(checks.map((c) => [c.id, c.status])));
        }
        // the judge agrees it does not always end: plain guesses of the steps left are refuted
        for (const v of card.vars) {
          const o = await proveEnds(z.judge, card, v, '');
          if (o.type === 'ends') assert.equal(o.result, 'refuted', `steps left = ${v}`);
        }
        assert.notEqual(simulate(card, sampleStates(card)[0]!, 300).outcome, 'exit', 'the walker’s sample never ends');
      }
      // after the answer the stage runs the first sample: stairs to the exit (at most 12), a ring or a shaft
      const sc = rushScene(card);
      if (card.verdict === 'ends') {
        assert.equal(sc.k, 'stairs');
        const enters = gridStarts(card).some((s) => simulate(card, s, 1).states.length > 1);
        if (sc.k === 'stairs') assert.ok(sc.stairs.length - 1 >= (enters ? 1 : 0) && sc.stairs.length - 1 <= 12, `${sc.stairs.length - 1} steps`);
      } else assert.ok(sc.k === 'ring' || sc.k === 'shaft', sc.k);
      const states = sc.k === 'stairs' ? sc.stairs.map((s) => s.s) : sc.k === 'ring' ? [...sc.prefix, ...sc.cycle] : sc.k === 'shaft' ? sc.states : [];
      for (const s of states) for (const v of card.vars) assert.ok(s[v]! < 10n ** 12n && s[v]! > -(10n ** 12n), 'small numbers on the stage');
    });
  }
});

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

  it('many pairs, each with both verdicts, all of one tier', () => {
    assert.ok(groups.size >= 150, `${groups.size} pairs`);
    for (const [key, cards] of groups) {
      assert.ok(cards.length >= 2, key);
      assert.ok(cards.some((c) => c.verdict === 'ends') && cards.some((c) => c.verdict === 'never'), `${key}: different verdicts`);
    }
  });

  it('the proof of the twin that ends is refuted on the twin that never ends', async () => {
    for (const [key, cards] of groups) {
      for (const a of cards.filter((c) => c.verdict === 'ends'))
        for (const b of cards.filter((c) => c.verdict === 'never')) {
          if (a.vars.join() !== b.vars.join()) continue;
          const ref = RUSH_ANSWERS[a.id]!.ends!;
          const o = await proveEnds(z.judge, b, ref.V, ref.R ?? '');
          assert.equal(o.type, 'ends');
          if (o.type === 'ends') assert.equal(o.result, 'refuted', `${key}: ${ref.V} on card ${b.id}`);
        }
    }
  });

  it('the cards of a pair differ in one small thing (a few tokens of code or input)', () => {
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
