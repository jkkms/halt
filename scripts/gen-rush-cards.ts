// Generates the rush card bank (SPEC_rush2 §B): families of short loops, each with an "ends" and a "never" form,
// many constants, variable names and input conditions. Deterministic. Every card is checked before it is written:
// its format (readable in 5 seconds), that it is new (no level, tutorial program, hand card or other card after
// renaming variables), a grid of small starts simulated with two division semantics, and its proof with the real
// Z3 judge. A card whose proof fails is not emitted.
//
//   node scripts/gen-rush-cards.ts        (npm run gen-cards)
//
// Writes src/core/rushBank.ts (the cards, committed) and test/rushBankAnswers.ts (their reference proofs, kept out
// of the game). Ids start at 1001 and stay stable across regenerations: a card keeps the id it had in the
// previous rushBank.ts (matched by its renamed code and input); new cards get ids after the largest one used.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lex, parseCond } from '../src/core/expr.ts';
import { proveEnds } from '../src/core/game.ts';
import { RUSH_DRAW } from '../src/core/rush.ts';
import { overall } from '../src/core/judge.ts';
import { compileLevel, type Level, type Text } from '../src/core/levels.ts';
import { RUSH_BANK } from '../src/core/rushBank.ts';
import { HAND_DEFS, type RushCardDef, type RushVerdict, type Tier } from '../src/core/rushCards.ts';
import { initialState, simulate, startAllowed, SIM_CAP, type State } from '../src/core/sim.ts';
import { canonical, canonicalLoop, endsTruncated, forbiddenPrograms, gridStarts } from '../test/rushCanon.ts';
import { nodeJudge } from '../test/z3-node.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------ targets

/** Cards wanted per tier, hand cards included (about 30 % / 35 % / 35 % of 500). */
const TIER_TARGET: Record<Tier, number> = { 1: 150, 2: 175, 3: 175 };
/** At most this many cards per family (so a run sees many kinds of loops). */
const FAMILY_CAP = 28;
/** Readability limits (also checked by the tests). */
export const MAX_LINE = 32;

// ------------------------------------------------------------ small helpers

type Proof = { ends: { V: string; R?: string } } | { never: { start: Record<string, number>; expect: 'cycle' } | { start: Record<string, number>; expect: 'zone'; Z: string } };

interface Cand {
  family: string;
  tier: Tier;
  code: string;
  inputs: string[];
  start: string;
  verdict: RushVerdict;
  why: Text;
  proof: Proof;
}

/** A pair group: cards that look alike (a lookalike pair when their verdicts differ). */
type Group = { key: string; cards: Cand[] };

const loop = (guard: string, body: string[]) => `while (${guard}) {\n${body.map((l) => `  ${l}`).join('\n')}\n}`;

/** −3 with a real minus sign, for the reason lines. */
const n = (x: number | bigint) => String(x).replace('-', '−');
const neg = (c: number) => (c < 0 ? `-${-c}` : String(c));
const plus = (v: string, d: number) => (d >= 0 ? `${v} + ${d}` : `${v} - ${-d}`);

/** Does the Korean reading of the last character end in a consonant (받침)? */
function batchim(s: string): boolean {
  const ch = s.replace(/[`\s)]+$/g, '').slice(-1).toLowerCase();
  if (/[0-9]/.test(ch)) return '013678'.includes(ch);
  if (/[a-z]/.test(ch)) return 'lmnr'.includes(ch);
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
}
/** Korean particles after code or a number: 이/가, 은/는, 을/를. */
const iga = (s: string) => `${s}${batchim(s) ? '이' : '가'}`;
const eunneun = (s: string) => `${s}${batchim(s) ? '은' : '는'}`;
const ira = (s: string) => `${s}${batchim(s) ? '이라' : '라'}`;
const ieyo = (s: string) => `${s}${batchim(s) ? '이에요' : '예요'}`;
const imyeon = (s: string) => `${s}${batchim(s) ? '이면' : '면'}`;
const q = (s: string) => `\`${s}\``;
const eul = (s: string) => `${s}${batchim(s) ? '을' : '를'}`;
/** 으로/로: 로 after a vowel or ㄹ (1 일, 7 칠, 8 팔, l, r). */
const ro = (s: string) => {
  const ch = s.replace(/[`\s)]+$/g, '').slice(-1).toLowerCase();
  return `${s}${batchim(s) && !'178lr'.includes(ch) ? '으로' : '로'}`;
};

const V1 = ['x', 'n', 'k', 'm', 'a', 'p', 'y', 'i', 'j', 's', 'b', 'q'];
const V2: [string, string][] = [
  ['x', 'y'],
  ['a', 'b'],
  ['i', 'j'],
  ['m', 'n'],
  ['p', 'q'],
  ['s', 't'],
  ['k', 'n'],
  ['x', 'z'],
  ['u', 'v'],
];

/** A deterministic pseudo-random sequence (mulberry32) for spreading constants and names. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], seed: number): T[] {
  const r = rng(seed);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const inv = (d: number, m: number) => range(1, m).find((k) => (((d * k) % m) + m) % m === 1)!;
const isqrt = (c: number) => Math.floor(Math.sqrt(c));

function compile(c: { code: string; inputs: string[]; start: string; verdict: RushVerdict }, id = 1000): Level {
  return compileLevel({ id, title: { ko: '', en: '' }, code: c.code, inputs: c.inputs, start: c.start, facts: 'true', kind: c.verdict, samples: [] });
}

/** The values of `v` along the run from `start`: "3, 1, −1, …" (or the whole run when it is short). */
function runText(c: { code: string; inputs: string[]; start: string; verdict: RushVerdict }, start: Record<string, number>, v: string, count = 3): string {
  const l = compile(c);
  const s0 = initialState(l, Object.fromEntries(l.inputs.map((x) => [x, BigInt(start[x] ?? 0)])));
  const run = simulate(l, s0, count);
  const vals = run.states.slice(0, count).map((s) => n(s[v]!));
  return `${vals.join(', ')}, …`;
}

// ------------------------------------------------------------ the families

/** Each family returns its groups in a spread-out order (constants and names mixed). */
const FAMILIES: Record<string, (seed: number) => Group[]> = {
  // ---------------- tier 1: one variable, one line, small constants
  down(seed) {
    const out: Group[] = [];
    let k = 0;
    for (const op of ['>', '>='])
      for (const c of range(0, 12))
        for (const d of range(1, 5)) {
          const v = V1[k++ % V1.length]!;
          const g = `${v} ${op} ${c}`;
          const w = op === '>' ? c + 1 : c;
          const ends: Cand = {
            family: 'down',
            tier: 1,
            code: loop(g, [`${v} := ${v} - ${d}`]),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: { ko: `${q(v)}${batchim(v) ? '이' : '가'} 매번 ${d}씩 줄어요. 곧 ${iga(q(g))} 거짓이 돼요.`, en: `${q(v)} drops by ${d} every time, so ${q(g)} soon turns false.` },
            proof: { ends: { V: op === '>' ? (c ? `${v} - ${c}` : v) : `${v} - ${c} + 1` } },
          };
          const never: Cand = {
            family: 'down',
            tier: 1,
            code: loop(g, [`${v} := ${v} + ${d}`]),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: '', en: '' },
            proof: { never: { start: { [v]: w }, expect: 'zone', Z: g } },
          };
          const r = runText(never, { [v]: w }, v);
          never.why = { ko: `${q(v)}${batchim(v) ? '이' : '가'} 커지기만 해서 ${iga(q(g))} 계속 참이에요. ${v} = ${w}: ${r}`, en: `${q(v)} only grows, so ${q(g)} stays true. ${v} = ${w}: ${r}` };
          out.push({ key: `down:${op}:${c}:${d}`, cards: [ends, never] });
        }
    return shuffle(out, seed);
  },

  up(seed) {
    const out: Group[] = [];
    let k = 3;
    for (const op of ['<', '<='])
      for (const c of range(0, 15))
        for (const d of range(1, 5)) {
          const v = V1[k++ % V1.length]!;
          const g = `${v} ${op} ${c}`;
          const w = op === '<' ? c - 1 : c;
          const ends: Cand = {
            family: 'up',
            tier: 1,
            code: loop(g, [`${v} := ${v} + ${d}`]),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: { ko: `${q(v)}${batchim(v) ? '이' : '가'} 매번 ${d}씩 커져요. 곧 ${iga(q(g))} 거짓이 돼요.`, en: `${q(v)} goes up by ${d} every time, so ${q(g)} soon turns false.` },
            proof: { ends: { V: op === '<' ? `${c} - ${v}` : `${c + 1} - ${v}` } },
          };
          const never: Cand = {
            family: 'up',
            tier: 1,
            code: loop(g, [`${v} := ${v} - ${d}`]),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: '', en: '' },
            proof: { never: { start: { [v]: w }, expect: 'zone', Z: g } },
          };
          const r = runText(never, { [v]: w }, v);
          never.why = { ko: `${q(v)}${batchim(v) ? '이' : '가'} 작아지기만 해서 ${iga(q(g))} 계속 참이에요. ${v} = ${n(w)}: ${r}`, en: `${q(v)} only shrinks, so ${q(g)} stays true. ${v} = ${n(w)}: ${r}` };
          out.push({ key: `up:${op}:${c}:${d}`, cards: [ends, never] });
        }
    return shuffle(out, seed);
  },

  scale(seed) {
    const out: Group[] = [];
    let k = 5;
    for (const op of ['>', '>='])
      for (const c of op === '>' ? range(0, 9) : range(1, 10))
        for (const d of [2, 3, 10]) {
          const v = V1[k++ % V1.length]!;
          const g = `${v} ${op} ${c}`;
          const cards: Cand[] = [
            {
              family: 'scale',
              tier: 1,
              code: loop(g, [`${v} := ${v} / ${d}`]),
              inputs: [v],
              start: 'true',
              verdict: 'ends',
              why: {
                ko: `${v} > 0이면 ${eunneun(q(`${v} / ${d}`))} ${q(v)}보다 작아요. 곧 ${iga(q(g))} 거짓이 돼요.`,
                en: `For ${v} > 0, ${q(`${v} / ${d}`)} is smaller than ${q(v)}, so ${q(g)} soon turns false.`,
              },
              proof: { ends: { V: v } },
            },
          ];
          if (d !== 10) {
            const w = op === '>' ? c + 1 : c;
            const never: Cand = {
              family: 'scale',
              tier: 1,
              code: loop(g, [`${v} := ${v} * ${d}`]),
              inputs: [v],
              start: 'true',
              verdict: 'never',
              why: { ko: '', en: '' },
              proof: { never: { start: { [v]: w }, expect: 'zone', Z: g } },
            };
            const r = runText(never, { [v]: w }, v);
            never.why = { ko: `${v} > 0이면 ${d}배로 커지기만 해요. ${iga(q(g))} 계속 참이에요. ${v} = ${w}: ${r}`, en: `For ${v} > 0, times ${d} only makes it bigger, so ${q(g)} stays true. ${v} = ${w}: ${r}` };
            cards.push(never);
          }
          out.push({ key: `scale:${op}:${c}:${d}`, cards });
        }
    return shuffle(out, seed);
  },

  const(seed) {
    const out: Group[] = [];
    const holds = (op: string, a: number, c: number) => (op === '>' ? a > c : op === '<' ? a < c : op === '>=' ? a >= c : op === '<=' ? a <= c : op === '!=' ? a !== c : a === c);
    const r = rng(seed);
    let k = 7;
    for (const op of ['>', '<', '>=', '<=', '!=', '=='])
      for (const c of range(1, 12)) {
        const v = V1[k++ % V1.length]!;
        const g = `${v} ${op} ${c}`;
        const pick = (want: boolean) => {
          const opts = range(0, 12).filter((a) => holds(op, a, c) === want);
          return opts.length ? opts[Math.floor(r() * opts.length)]! : null;
        };
        const cards: Cand[] = [];
        for (const want of [false, true]) {
          const d = pick(want);
          if (d === null) continue;
          const gd = g.replace(new RegExp(`^${v}`), String(d));
          const cand: Cand = {
            family: 'const',
            tier: 1,
            code: loop(g, [`${v} := ${d}`]),
            inputs: [v],
            start: 'true',
            verdict: want ? 'never' : 'ends',
            why: want
              ? { ko: `${q(v)}${batchim(v) ? '이' : '가'} ${d}${batchim(String(d)) ? '이' : '가'} 되면 ${iga(q(gd))} 참이라 ${d}에서 계속 돌아요.`, en: `Once ${q(v)} is ${d}, ${q(gd)} is true, so it stays at ${d} forever.` }
              : { ko: `한 번 돌면 ${eunneun(q(v))} ${d}${batchim(String(d)) ? '이' : '가'} 되고, ${eunneun(q(gd))} 거짓이라 끝나요.`, en: `After one round ${q(v)} is ${d}, and ${q(gd)} is false, so it ends.` },
            proof: want ? { never: { start: { [v]: d }, expect: 'cycle' } } : { ends: { V: `abs(${plus(v, -d)})` } },
          };
          cards.push(cand);
        }
        out.push({ key: `const:${op}:${c}`, cards });
      }
    return shuffle(out, seed);
  },

  net(seed) {
    const out: Group[] = [];
    let k = 2;
    for (const op of ['>', '<'])
      for (const c of range(0, 12))
        for (const [a, b] of [
          [3, 1],
          [4, 1],
          [5, 2],
          [2, 1],
          [5, 3],
          [6, 2],
          [4, 3],
        ] as [number, number][]) {
          const v = V1[k++ % V1.length]!;
          const g = `${v} ${op} ${c}`;
          const w = op === '>' ? c + 1 : c - 1;
          // '>': the loop ends when the net step goes down; '<': when it goes up.
          const goodBody = op === '>' ? `${v} - ${a} + ${b}` : `${v} + ${a} - ${b}`;
          const badBody = op === '>' ? `${v} - ${b} + ${a}` : `${v} + ${b} - ${a}`;
          const step = a - b;
          const ends: Cand = {
            family: 'net',
            tier: 1,
            code: loop(g, [`${v} := ${goodBody}`]),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: {
              ko: `${imyeon(q(goodBody))} 매번 ${step}씩 ${op === '>' ? '줄어요' : '커져요'}. 곧 ${iga(q(g))} 거짓이 돼요.`,
              en: `${q(goodBody)} is ${step} ${op === '>' ? 'less' : 'more'} each time, so ${q(g)} soon turns false.`,
            },
            proof: { ends: { V: op === '>' ? (c ? `${v} - ${c}` : v) : `${c} - ${v}` } },
          };
          const never: Cand = {
            family: 'net',
            tier: 1,
            code: loop(g, [`${v} := ${badBody}`]),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: '', en: '' },
            proof: { never: { start: { [v]: w }, expect: 'zone', Z: g } },
          };
          const r = runText(never, { [v]: w }, v);
          never.why = {
            ko: `${imyeon(q(badBody))} 매번 ${step}씩 ${op === '>' ? '커져요' : '줄어요'}. ${iga(q(g))} 계속 참이에요. ${v} = ${n(w)}: ${r}`,
            en: `${q(badBody)} is ${step} ${op === '>' ? 'more' : 'less'} each time, so ${q(g)} stays true. ${v} = ${n(w)}: ${r}`,
          };
          out.push({ key: `net:${op}:${c}:${a}:${b}`, cards: [ends, never] });
        }
    // tier 2: a step that adds and takes away the same amount (a zero step)
    for (const c of range(0, 9))
      for (const a of [2, 3, 4]) {
        const v = V1[k++ % V1.length]!;
        const op = c % 2 ? '>' : '<';
        const g = `${v} ${op} ${c}`;
        const w = op === '>' ? c + 1 : c - 1;
        const body = op === '>' ? `${v} - ${a} + ${a}` : `${v} + ${a} - ${a}`;
        out.push({
          key: `net0:${op}:${c}:${a}`,
          cards: [
            {
              family: 'net',
              tier: 2,
              code: loop(g, [`${v} := ${body}`]),
              inputs: [v],
              start: 'true',
              verdict: 'never',
              why: { ko: `${eunneun(q(body))} ${q(v)} 그대로예요. ${v} = ${n(w)}에서 영원히 돌아요.`, en: `${q(body)} is just ${q(v)}: from ${v} = ${n(w)} it runs forever.` },
              proof: { never: { start: { [v]: w }, expect: 'cycle' } },
            },
          ],
        });
      }
    return shuffle(out, seed);
  },

  flip(seed) {
    const out: Group[] = [];
    let k = 4;
    const name = () => V1[k++ % V1.length]!;
    for (const c of range(-3, 8)) {
      const v = name();
      // while (v > c) { v := -v }: ends for c ≥ 0 (one round), never for c < 0 (0 stays 0)
      const g = `${v} > ${neg(c)}`;
      out.push({
        key: `flip:>:${c}`,
        cards: [
          c >= 0
            ? {
                family: 'flip',
                tier: 1,
                code: loop(g, [`${v} := -${v}`]),
                inputs: [v],
                start: 'true',
                verdict: 'ends',
                why: { ko: `${v} > ${c}이면 ${eunneun(q(`-${v}`))} 0보다 작아서 한 번에 끝나요.`, en: `For ${v} > ${c}, ${q(`-${v}`)} is below 0, so one round ends it.` },
                proof: { ends: { V: v } },
              }
            : {
                family: 'flip',
                tier: 2,
                code: loop(g, [`${v} := -${v}`]),
                inputs: [v],
                start: 'true',
                verdict: 'never',
                why: { ko: `${v} = 0이면 ${ira(q('-0 = 0'))} ${iga(q(`0 > ${neg(c)}`))} 계속 참이에요.`, en: `From ${v} = 0, ${q('-0 = 0')}, so ${q(`0 > ${neg(c)}`)} stays true.` },
                proof: { never: { start: { [v]: 0 }, expect: 'cycle' } },
              },
        ],
      });
      // while (v < c) { v := -v }: ends for c ≤ 0, never for c > 0
      const v2 = name();
      const g2 = `${v2} < ${neg(-c)}`;
      out.push({
        key: `flip:<:${-c}`,
        cards: [
          -c <= 0
            ? {
                family: 'flip',
                tier: 1,
                code: loop(g2, [`${v2} := -${v2}`]),
                inputs: [v2],
                start: 'true',
                verdict: 'ends',
                why: { ko: `${v2} < ${n(-c)}이면 ${eunneun(q(`-${v2}`))} 0보다 커서 한 번에 끝나요.`, en: `For ${v2} < ${n(-c)}, ${q(`-${v2}`)} is above 0, so one round ends it.` },
                proof: { ends: { V: `-${v2}` } },
              }
            : {
                family: 'flip',
                tier: 2,
                code: loop(g2, [`${v2} := -${v2}`]),
                inputs: [v2],
                start: 'true',
                verdict: 'never',
                why: { ko: `${v2} = 0이면 ${ira(q('-0 = 0'))} ${iga(q(`0 < ${-c}`))} 계속 참이에요.`, en: `From ${v2} = 0, ${q('-0 = 0')}, so ${q(`0 < ${-c}`)} stays true.` },
                proof: { never: { start: { [v2]: 0 }, expect: 'cycle' } },
              },
        ],
      });
    }
    for (const c of range(-4, 6)) {
      const v = name();
      const w = c === 0 ? 2 : c + 1;
      const g = `${v} != ${neg(c)}`;
      const nev: Cand = {
        family: 'flip',
        tier: 1,
        code: loop(g, [`${v} := -${v}`]),
        inputs: [v],
        start: 'true',
        verdict: 'never',
        why: { ko: '', en: '' },
        proof: { never: { start: { [v]: w }, expect: 'cycle' } },
      };
      const r = runText(nev, { [v]: w }, v);
      nev.why = { ko: `부호만 바뀌어서 ${n(c)}에 닿지 못해요. ${v} = ${n(w)}: ${r}`, en: `Only the sign flips, so it never reaches ${n(c)}. ${v} = ${n(w)}: ${r}` };
      const cards = [nev];
      if (c !== 0) {
        const v2 = v;
        const g2 = `${v2} == ${neg(c)}`;
        cards.push({
          family: 'flip',
          tier: 1,
          code: loop(g2, [`${v2} := -${v2}`]),
          inputs: [v2],
          start: 'true',
          verdict: 'ends',
          why: { ko: `${v2} = ${n(c)}일 때만 돌고, 한 번 돌면 ${n(-c)}${batchim(String(-c)) ? '이' : '가'} 돼서 끝나요.`, en: `It only runs when ${v2} = ${n(c)}; one round makes it ${n(-c)}, which ends it.` },
          proof: { ends: { V: `abs(${plus(v2, c)})` } },
        });
      }
      out.push({ key: `flip:!=:${c}`, cards });
    }
    return shuffle(out, seed);
  },

  // ---------------- tier 2: one trap
  neq(seed) {
    const out: Group[] = [];
    let k = 1;
    for (const c of range(1, 12)) {
      const v = V1[k++ % V1.length]!;
      const g = `${v} != ${c}`;
      const down1 = loop(g, [`${v} := ${v} - 1`]);
      const down2 = loop(g, [`${v} := ${v} - 2`]);
      const f1: Cand = { family: 'neq', tier: 2, code: down1, inputs: [v], start: 'true', verdict: 'never', why: { ko: '', en: '' }, proof: { never: { start: { [v]: c - 1 }, expect: 'zone', Z: `${v} < ${c}` } } };
      const r1 = runText(f1, { [v]: c - 1 }, v);
      f1.why = { ko: `${v} < ${c}이면 ${c}에서 멀어지기만 해요. ${v} = ${c - 1}: ${r1}`, en: `Below ${c}, ${q(v)} only moves away from ${c}. ${v} = ${c - 1}: ${r1}` };
      const f2: Cand = {
        family: 'neq',
        tier: 2,
        code: down1,
        inputs: [v],
        start: `${v} >= ${c}`,
        verdict: 'ends',
        why: { ko: `입력이 ${v} ≥ ${ira(String(c))} 1씩 내려가면 꼭 ${c}에 닿아요.`, en: `The input is ${v} ≥ ${c}, so going down by 1 always lands on ${c}.` },
        proof: { ends: { V: `${v} - ${c}`, R: `${v} >= ${c}` } },
      };
      const f3: Cand = {
        family: 'neq',
        tier: 2,
        code: down2,
        inputs: [v],
        start: `${v} >= ${c}`,
        verdict: 'never',
        why: { ko: '', en: '' },
        proof: { never: { start: { [v]: c + 1 }, expect: 'zone', Z: `(${v} - ${c}) % 2 == 1` } },
      };
      const r3 = runText(f3, { [v]: c + 1 }, v, 4);
      f3.why = { ko: `2씩 내려가면 ${v} = ${c + 1}에서 ${eul(String(c))} 건너뛰어요: ${r3}`, en: `Going down by 2 from ${v} = ${c + 1} jumps over ${c}: ${r3}` };
      out.push({ key: `neq:down:${c}`, cards: [f1, f2, f3] });

      const u = V1[k++ % V1.length]!;
      const gu = `${u} != ${c}`;
      const up1 = loop(gu, [`${u} := ${u} + 1`]);
      const up2 = loop(gu, [`${u} := ${u} + 2`]);
      const f4: Cand = { family: 'neq', tier: 2, code: up1, inputs: [u], start: 'true', verdict: 'never', why: { ko: '', en: '' }, proof: { never: { start: { [u]: c + 1 }, expect: 'zone', Z: `${u} > ${c}` } } };
      const r4 = runText(f4, { [u]: c + 1 }, u);
      f4.why = { ko: `${u} > ${c}이면 ${c}에서 멀어지기만 해요. ${u} = ${c + 1}: ${r4}`, en: `Above ${c}, ${q(u)} only moves away from ${c}. ${u} = ${c + 1}: ${r4}` };
      const f5: Cand = {
        family: 'neq',
        tier: 2,
        code: up1,
        inputs: [u],
        start: `${u} <= ${c}`,
        verdict: 'ends',
        why: { ko: `입력이 ${u} ≤ ${ira(String(c))} 1씩 올라가면 꼭 ${c}에 닿아요.`, en: `The input is ${u} ≤ ${c}, so going up by 1 always lands on ${c}.` },
        proof: { ends: { V: `${c} - ${u}`, R: `${u} <= ${c}` } },
      };
      const f6: Cand = {
        family: 'neq',
        tier: 2,
        code: up2,
        inputs: [u],
        start: `${u} <= ${c}`,
        verdict: 'never',
        why: { ko: '', en: '' },
        proof: { never: { start: { [u]: c - 1 }, expect: 'zone', Z: `(${c} - ${u}) % 2 == 1` } },
      };
      const r6 = runText(f6, { [u]: c - 1 }, u, 4);
      f6.why = { ko: `2씩 올라가면 ${u} = ${c - 1}에서 ${eul(String(c))} 건너뛰어요: ${r6}`, en: `Going up by 2 from ${u} = ${c - 1} jumps over ${c}: ${r6}` };
      out.push({ key: `neq:up:${c}`, cards: [f4, f5, f6] });
    }
    return shuffle(out, seed);
  },

  noentry(seed) {
    const out: Group[] = [];
    let k = 6;
    for (const c of range(0, 12))
      for (const d of [1, 2, 3]) {
        const v = V1[k++ % V1.length]!;
        const up = (c + d) % 2 === 0;
        const g = up ? `${v} > ${c}` : `${v} < ${c}`;
        const body = up ? `${v} := ${v} + ${d}` : `${v} := ${v} - ${d}`;
        const code = loop(g, [body]);
        const shut = up ? `${v} <= ${c}` : `${v} >= ${c}`;
        const open = up ? `${v} >= ${c}` : `${v} <= ${c}`;
        const w = up ? c + 1 : c - 1;
        const nev: Cand = { family: 'noentry', tier: 2, code, inputs: [v], start: open, verdict: 'never', why: { ko: '', en: '' }, proof: { never: { start: { [v]: w }, expect: 'zone', Z: g } } };
        nev.why = {
          ko: `${v} = ${imyeon(n(w))} ${iga(q(g))} 참이고 ${q(v)}${batchim(v) ? '은' : '는'} ${up ? '커지기만' : '작아지기만'} 해요.`,
          en: `From ${v} = ${n(w)}, ${q(g)} holds and ${q(v)} only ${up ? 'grows' : 'shrinks'}.`,
        };
        out.push({
          key: `noentry:${g}:${d}`,
          cards: [
            {
              family: 'noentry',
              tier: 2,
              code,
              inputs: [v],
              start: shut,
              verdict: 'ends',
              why: {
                ko: `입력이 ${v} ${up ? '≤' : '≥'} ${ira(String(c))} ${iga(q(g))} 처음부터 거짓이에요. 한 번도 안 돌아요.`,
                en: `The input is ${v} ${up ? '≤' : '≥'} ${c}, so ${q(g)} is false from the start: it never runs.`,
              },
              proof: { ends: { V: '0', R: shut } },
            },
            nev,
          ],
        });
      }
    return shuffle(out, seed);
  },

  halve(seed) {
    const out: Group[] = [];
    let k = 8;
    const name = () => V1[k++ % V1.length]!;
    {
      const v = name();
      const code = loop(`${v} != 1`, [`${v} := ${v} / 2`]);
      out.push({
        key: 'halve:!=1',
        cards: [
          { family: 'halve', tier: 2, code, inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = 0이면 ${ira(q('0 / 2 = 0'))} 1에 닿지 못해요.`, en: `From ${v} = 0, ${q('0 / 2 = 0')}: ${q(v)} never reaches 1.` }, proof: { never: { start: { [v]: 0 }, expect: 'cycle' } } },
          {
            family: 'halve',
            tier: 2,
            code,
            inputs: [v],
            start: `${v} >= 1`,
            verdict: 'ends',
            why: { ko: `입력이 ${v} ≥ 1이라 반으로 나눠도 1 이상이고, 계속 작아져 1에 닿아요.`, en: `The input is ${v} ≥ 1: halving keeps it at 1 or more and smaller, so it reaches 1.` },
            proof: { ends: { V: v, R: `${v} >= 1` } },
          },
        ],
      });
    }
    for (const d of [2, 3, 10]) {
      for (const c of [0, -1]) {
        const v = name();
        const g = c === 0 ? `${v} >= 0` : `${v} > -1`;
        const v2 = v;
        out.push({
          key: `halve:>=0:${d}:${c}`,
          cards: [
            { family: 'halve', tier: 2, code: loop(g, [`${v} := ${v} / ${d}`]), inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = 0이면 ${ira(q(`0 / ${d} = 0`))} ${iga(q(`0 ${g.split(' ')[1]} ${neg(c)}`))} 계속 참이에요.`, en: `From ${v} = 0, ${q(`0 / ${d} = 0`)}, so ${q(`0 ${g.split(' ')[1]} ${neg(c)}`)} stays true.` }, proof: { never: { start: { [v]: 0 }, expect: 'cycle' } } },
            {
              family: 'halve',
              tier: 2,
              code: loop(`${v2} >= 1`, [`${v2} := ${v2} / ${d}`]),
              inputs: [v2],
              start: 'true',
              verdict: 'ends',
              why: { ko: `${v2} ≥ 1이면 ${eunneun(q(`${v2} / ${d}`))} ${q(v2)}보다 작아요. 곧 0이 돼요.`, en: `For ${v2} ≥ 1, ${q(`${v2} / ${d}`)} is smaller than ${q(v2)}; it soon reaches 0.` },
              proof: { ends: { V: v2 } },
            },
          ],
        });
      }
      const v = name();
      out.push({
        key: `halve:!=0:${d}`,
        cards: [
          {
            family: 'halve',
            tier: 2,
            code: loop(`${v} != 0`, [`${v} := ${v} / ${d}`]),
            inputs: [v],
            start: `${v} >= 0`,
            verdict: 'ends',
            why: { ko: `입력이 ${v} ≥ 0이라 ${ro(String(d))} 나눌 때마다 작아져서 0에 닿아요.`, en: `The input is ${v} ≥ 0, so dividing by ${d} shrinks it until it reaches 0.` },
            proof: { ends: { V: v, R: `${v} >= 0` } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  double(seed) {
    const out: Group[] = [];
    let k = 9;
    const name = () => V1[k++ % V1.length]!;
    for (const c of [5, 8, 10, 12, 15, 16, 20, 24, 30, 40])
      for (const d of [2, 3]) {
        const v = name();
        const g = `${v} < ${c}`;
        const code = loop(g, [`${v} := ${v} * ${d}`]);
        const wide = c % 2 === 0 ? 'true' : `${v} >= 0`;
        out.push({
          key: `double:${c}:${d}`,
          cards: [
            {
              family: 'double',
              tier: 2,
              code,
              inputs: [v],
              start: `${v} >= 1`,
              verdict: 'ends',
              why: { ko: `입력이 ${v} ≥ 1이라 ${q(v)}${batchim(v) ? '이' : '가'} 매번 ${d}배로 커져요. 곧 ${c} 이상이 돼요.`, en: `The input is ${v} ≥ 1, so ${q(v)} grows ${d} times bigger each round and soon reaches ${c}.` },
              proof: { ends: { V: `${c} - ${v}`, R: `${v} >= 1` } },
            },
            {
              family: 'double',
              tier: 2,
              code,
              inputs: [v],
              start: wide,
              verdict: 'never',
              why: { ko: `${v} = 0이면 ${ira(q(`0 * ${d} = 0`))} 제자리예요. ${iga(q(`0 < ${c}`))} 계속 참이에요.`, en: `From ${v} = 0, ${q(`0 * ${d} = 0`)}: it stays put and ${q(`0 < ${c}`)} stays true.` },
              proof: { never: { start: { [v]: 0 }, expect: 'cycle' } },
            },
          ],
        });
      }
    for (const c of [8, 10, 12, 16, 20]) {
      const v = name();
      out.push({
        key: `double:!=:${c}`,
        cards: [
          {
            family: 'double',
            tier: 3,
            code: loop(`${v} != ${c}`, [`${v} := ${v} * 2`]),
            inputs: [v],
            start: `${v} >= 1`,
            verdict: 'never',
            why: { ko: `${v} = ${imyeon(String(c + 1))} 이미 ${c}보다 커서 커지기만 해요.`, en: `From ${v} = ${c + 1} it is already past ${c} and only grows.` },
            proof: { never: { start: { [v]: c + 1 }, expect: 'zone', Z: `${v} > ${c}` } },
          },
        ],
      });
    }
    for (const c of [6, 9, 10, 15, 20]) {
      const v = name();
      const code = loop(`${v} < ${c}`, [`${v} := ${v} * 2 + 1`]);
      out.push({
        key: `double:+1:${c}`,
        cards: [
          {
            family: 'double',
            tier: 3,
            code,
            inputs: [v],
            start: `${v} >= 0`,
            verdict: 'ends',
            why: { ko: `입력이 ${v} ≥ 0이라 ${eunneun(q(`${v} * 2 + 1`))} ${q(v)}보다 커요. 곧 ${c} 이상이 돼요.`, en: `The input is ${v} ≥ 0, so ${q(`${v} * 2 + 1`)} is bigger than ${q(v)}; it soon reaches ${c}.` },
            proof: { ends: { V: `${c} - ${v}`, R: `${v} >= 0` } },
          },
          {
            family: 'double',
            tier: 3,
            code,
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: `${v} = −1이면 ${ira(q('-1 * 2 + 1 = -1'))} 제자리예요.`, en: `From ${v} = −1, ${q('-1 * 2 + 1 = -1')}: it stays put.` },
            proof: { never: { start: { [v]: -1 }, expect: 'cycle' } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  mod(seed) {
    const out: Group[] = [];
    let k = 10;
    const name = () => V1[k++ % V1.length]!;
    // while (v > c) { v := v % m }: ends when m - 1 ≤ c
    for (const c of range(0, 10)) {
      const cards: Cand[] = [];
      const mEnd = Math.max(2, c + 1 - (c % 3));
      const mNever = c + 2 + (c % 4);
      const v = name();
      cards.push({
        family: 'mod',
        tier: 2,
        code: loop(`${v} > ${c}`, [`${v} := ${v} % ${mEnd}`]),
        inputs: [v],
        start: 'true',
        verdict: 'ends',
        why: { ko: `${eunneun(q(`${v} % ${mEnd}`))} 0~${ira(String(mEnd - 1))} 한 번 돌면 ${iga(q(`${v} > ${c}`))} 거짓이에요.`, en: `${q(`${v} % ${mEnd}`)} is between 0 and ${mEnd - 1}, so after one round ${q(`${v} > ${c}`)} is false.` },
        proof: { ends: { V: v } },
      });
      const w = c + 1;
      cards.push({
        family: 'mod',
        tier: 2,
        code: loop(`${v} > ${c}`, [`${v} := ${v} % ${mNever}`]),
        inputs: [v],
        start: 'true',
        verdict: 'never',
        why: { ko: `${v} = ${imyeon(String(w))} ${eunneun(q(`${w} % ${mNever}`))} ${w} 그대로예요. ${w}, ${w}, ${w}, …`, en: `From ${v} = ${w}, ${q(`${w} % ${mNever}`)} is still ${w}. ${w}, ${w}, ${w}, …` },
        proof: { never: { start: { [v]: w }, expect: 'cycle' } },
      });
      out.push({ key: `mod:>:${c}`, cards });
    }
    // while (v % m != 0) { v := v + d }: ends when gcd(d, m) = 1
    for (const m of range(2, 7))
      for (const d of range(1, 4)) {
        if (d > m) continue;
        const v = name();
        const g = gcd(d, m);
        const code = loop(`${v} % ${m} != 0`, [`${v} := ${v} + ${d}`]);
        if (g === 1) {
          out.push({
            key: `mod:+:${m}:${d}`,
            cards: [
              {
                family: 'mod',
                tier: d === 1 ? 2 : 3,
                code,
                inputs: [v],
                start: 'true',
                verdict: 'ends',
                why: { ko: `${d}씩 더하면 ${ro(String(m))} 나눈 나머지가 매번 바뀌어 ${m - 1}번 안에 0이 돼요.`, en: `Adding ${d} changes the remainder mod ${m} every time; within ${m - 1} rounds it is 0.` },
                proof: { ends: { V: `(${m - inv(d, m)} * ${v}) % ${m}` } },
              },
            ],
          });
        } else {
          const r = runText({ code, inputs: [v], start: 'true', verdict: 'never' }, { [v]: 1 }, v);
          out.push({
            key: `mod:+:${m}:${d}`,
            cards: [
              {
                family: 'mod',
                tier: d === m ? 2 : 3,
                code,
                inputs: [v],
                start: 'true',
                verdict: 'never',
                why:
                  d === m
                    ? { ko: `${eul(String(d))} 더해도 ${ro(String(m))} 나눈 나머지는 그대로예요. ${v} = 1: ${r}`, en: `Adding ${d} keeps the remainder mod ${m}. ${v} = 1: ${r}` }
                    : { ko: `${q(v)}${batchim(v) ? '이' : '가'} ${g}의 배수가 아니면 ${d}${batchim(String(d)) ? '을' : '를'} 더해도 계속 아니에요. ${v} = 1: ${r}`, en: `If ${q(v)} is not a multiple of ${g}, adding ${d} keeps it that way. ${v} = 1: ${r}` },
                proof: { never: { start: { [v]: 1 }, expect: 'zone', Z: `${v} % ${g} != 0` } },
              },
            ],
          });
        }
      }
    for (const m of range(2, 9)) {
      const v = name();
      out.push({
        key: `mod:-:${m}`,
        cards: [
          {
            family: 'mod',
            tier: 2,
            code: loop(`${v} % ${m} != 0`, [`${v} := ${v} - 1`]),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: { ko: `1씩 빼면 ${m - 1}번 안에 ${m}의 배수가 돼요.`, en: `Taking 1 away, ${q(v)} is a multiple of ${m} within ${m - 1} rounds.` },
            proof: { ends: { V: `${v} % ${m}` } },
          },
          {
            family: 'mod',
            tier: 2,
            code: loop(`${v} % ${m} != 0`, [`${v} := ${v} - ${m}`]),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: `${m}${batchim(String(m)) ? '을' : '를'} 빼도 ${m}의 배수가 아닌 건 그대로예요. ${v} = 1: ${runText({ code: loop(`${v} % ${m} != 0`, [`${v} := ${v} - ${m}`]), inputs: [v], start: 'true', verdict: 'never' }, { [v]: 1 }, v)}`, en: `Taking ${m} away never makes a multiple of ${m}. ${v} = 1: ${runText({ code: loop(`${v} % ${m} != 0`, [`${v} := ${v} - ${m}`]), inputs: [v], start: 'true', verdict: 'never' }, { [v]: 1 }, v)}` },
            proof: { never: { start: { [v]: 1 }, expect: 'zone', Z: `${v} % ${m} != 0` } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  absval(seed) {
    const out: Group[] = [];
    let k = 11;
    const name = () => V1[k++ % V1.length]!;
    for (const c of range(0, 9))
      for (const d of [1, 2, 3]) {
        if (d > c + 1) continue;
        const v = name();
        const g = `abs(${v}) > ${c}`;
        const w = -(c + 1);
        const nev: Cand = { family: 'absval', tier: 2, code: loop(g, [`${v} := ${v} - ${d}`]), inputs: [v], start: 'true', verdict: 'never', why: { ko: '', en: '' }, proof: { never: { start: { [v]: w }, expect: 'zone', Z: `${v} < ${-c}` } } };
        const r = runText(nev, { [v]: w }, v);
        nev.why = { ko: `${q(v)}${batchim(v) ? '이' : '가'} 음수면 빼도 0에서 멀어지기만 해요. ${v} = ${n(w)}: ${r}`, en: `A negative ${q(v)} only moves away from 0. ${v} = ${n(w)}: ${r}` };
        out.push({
          key: `absval:>:${c}:${d}`,
          cards: [
            {
              family: 'absval',
              tier: 2,
              code: loop(g, [`${v} := abs(${v}) - ${d}`]),
              inputs: [v],
              start: 'true',
              verdict: 'ends',
              why: { ko: `한 번 돌면 ${q(v)}${batchim(v) ? '이' : '가'} 0 이상이 되고, 그 뒤로 ${d}씩 줄어서 끝나요.`, en: `After one round ${q(v)} is 0 or more, then it drops by ${d} until ${q(g)} is false.` },
              proof: { ends: { V: c ? `abs(${v}) - ${c}` : `abs(${v})` } },
            },
            nev,
          ],
        });
      }
    for (const c of range(2, 12)) {
      const v = name();
      const d = 1 + (c % 3);
      const g = `abs(${v}) < ${c}`;
      const nev: Cand = { family: 'absval', tier: 2, code: loop(g, [`${v} := -${v}`]), inputs: [v], start: 'true', verdict: 'never', why: { ko: '', en: '' }, proof: { never: { start: { [v]: 1 }, expect: 'cycle' } } };
      nev.why = { ko: `부호만 바뀌어서 ${eunneun(q(`abs(${v})`))} 그대로예요. ${v} = 1: 1, −1, 1, …`, en: `Only the sign flips, so ${q(`abs(${v})`)} never changes. ${v} = 1: 1, −1, 1, …` };
      out.push({
        key: `absval:<:${c}`,
        cards: [
          {
            family: 'absval',
            tier: 2,
            code: loop(g, [`${v} := ${v} + ${d}`]),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: { ko: `${q(v)}${batchim(v) ? '이' : '가'} ${d}씩 커져서 곧 ${c} 이상이 돼요. 그러면 ${iga(q(g))} 거짓이에요.`, en: `${q(v)} goes up by ${d} until it is ${c} or more; then ${q(g)} is false.` },
            proof: { ends: { V: `${c} - ${v}` } },
          },
          nev,
        ],
      });
    }
    return shuffle(out, seed);
  },

  guardvar(seed) {
    const out: Group[] = [];
    let k = 0;
    for (const c of range(0, 8))
      for (const [d, e] of [
        [1, 1],
        [2, 1],
        [1, 2],
        [3, 1],
      ] as [number, number][]) {
        const [a, b] = V2[k++ % V2.length]!;
        const down = (c + d) % 2 === 0;
        const ga = down ? `${a} > ${c}` : `${a} < ${c}`;
        const gb = down ? `${b} > ${c}` : `${b} < ${c}`;
        const body = down ? [`${a} := ${a} - ${d}`, `${b} := ${b} + ${e}`] : [`${a} := ${a} + ${d}`, `${b} := ${b} - ${e}`];
        const w = down ? c + 1 : c - 1;
        const nev: Cand = {
          family: 'guardvar',
          tier: 2,
          code: loop(gb, body),
          inputs: [a, b],
          start: 'true',
          verdict: 'never',
          why: { ko: '', en: '' },
          proof: { never: { start: { [a]: 0, [b]: w }, expect: 'zone', Z: gb } },
        };
        const r = runText(nev, { [a]: 0, [b]: w }, b);
        nev.why = { ko: `조건은 ${q(b)}${batchim(b) ? '을' : '를'} 보는데 ${q(b)}${batchim(b) ? '은' : '는'} ${down ? '커지기만' : '작아지기만'} 해요. ${b} = ${n(w)}: ${r}`, en: `The condition checks ${q(b)}, and ${q(b)} only ${down ? 'grows' : 'shrinks'}. ${b} = ${n(w)}: ${r}` };
        out.push({
          key: `guardvar:${c}:${d}:${e}`,
          cards: [
            {
              family: 'guardvar',
              tier: 2,
              code: loop(ga, body),
              inputs: [a, b],
              start: 'true',
              verdict: 'ends',
              why: { ko: `${q(a)}${batchim(a) ? '이' : '가'} 매번 ${d}씩 ${down ? '줄어요' : '커져요'}. ${eunneun(q(b))} 끝나는 것과 상관없어요.`, en: `${q(a)} ${down ? 'drops' : 'goes up'} by ${d} every time; ${q(b)} has nothing to do with stopping.` },
              proof: { ends: { V: down ? (c ? `${a} - ${c}` : a) : `${c} - ${a}` } },
            },
            nev,
          ],
        });
        if (e === 1) {
          const [p, s] = V2[k++ % V2.length]!;
          const gp = down ? `${p} > ${c}` : `${p} < ${c}`;
          out.push({
            key: `guardvar:still:${c}:${d}`,
            cards: [
              {
                family: 'guardvar',
                tier: 2,
                code: loop(gp, [down ? `${s} := ${s} - ${d}` : `${s} := ${s} + ${d}`]),
                inputs: [p, s],
                start: 'true',
                verdict: 'never',
                why: { ko: `반복 안에서 ${q(p)}${batchim(p) ? '이' : '가'} 바뀌지 않아서 ${iga(q(gp))} 계속 참이에요.`, en: `Nothing in the loop changes ${q(p)}, so ${q(gp)} stays true.` },
                proof: { never: { start: { [p]: w, [s]: 0 }, expect: 'zone', Z: gp } },
              },
            ],
          });
        }
      }
    return shuffle(out, seed);
  },

  stride(seed) {
    const out: Group[] = [];
    let k = 2;
    for (const c of range(1, 12))
      for (const dir of ['down', 'up'] as const) {
        const [x, y] = V2[k++ % V2.length]!;
        const g = dir === 'down' ? `${x} > ${c}` : `${x} < ${c}`;
        const code = loop(g, [dir === 'down' ? `${x} := ${x} - ${y}` : `${x} := ${x} + ${y}`]);
        const w = dir === 'down' ? c + 1 : c - 1;
        const strict = c % 2 === 0 ? `${y} >= 1` : `${y} > 0`;
        const loose = c % 3 === 0 ? `${y} != 0` : `${y} >= 0`;
        const looseNever: Cand =
          loose === `${y} >= 0`
            ? {
                family: 'stride',
                tier: 2,
                code,
                inputs: [x, y],
                start: loose,
                verdict: 'never',
                why: { ko: `${y} = 0이면 ${q(x)}${batchim(x) ? '이' : '가'} 그대로예요. ${x} = ${n(w)}, ${y} = 0이면 영원히 돌아요.`, en: `With ${y} = 0, ${q(x)} never moves: ${x} = ${n(w)}, ${y} = 0 runs forever.` },
                proof: { never: { start: { [x]: w, [y]: 0 }, expect: 'cycle' } },
              }
            : {
                family: 'stride',
                tier: 2,
                code,
                inputs: [x, y],
                start: loose,
                verdict: 'never',
                why: {
                  ko: `${y} < 0이면 ${q(x)}${batchim(x) ? '이' : '가'} 오히려 ${dir === 'down' ? '커져요' : '작아져요'}. ${x} = ${n(w)}, ${y} = −1이면 영원히 돌아요.`,
                  en: `With ${y} < 0, ${q(x)} ${dir === 'down' ? 'grows' : 'shrinks'} instead: ${x} = ${n(w)}, ${y} = −1 runs forever.`,
                },
                proof: { never: { start: { [x]: w, [y]: -1 }, expect: 'zone', Z: `${g} && ${y} < 0` } },
              };
        out.push({
          key: `stride:${dir}:${c}`,
          cards: [
            {
              family: 'stride',
              tier: 2,
              code,
              inputs: [x, y],
              start: strict,
              verdict: 'ends',
              why: { ko: `입력이 ${ira(strict.replace('>=', '≥'))} ${q(x)}${batchim(x) ? '이' : '가'} 매번 ${dir === 'down' ? '줄어요' : '커져요'}. 곧 ${iga(q(g))} 거짓이 돼요.`, en: `The input is ${strict.replace('>=', '≥')}, so ${q(x)} ${dir === 'down' ? 'drops' : 'grows'} every time and ${q(g)} soon turns false.` },
              proof: { ends: { V: dir === 'down' ? `${x} - ${c}` : `${c} - ${x}`, R: strict } },
            },
            looseNever,
          ],
        });
      }
    return shuffle(out, seed);
  },

  sqgrow(seed) {
    const out: Group[] = [];
    let k = 3;
    const name = () => V1[k++ % V1.length]!;
    for (const c of [10, 12, 15, 20, 30, 50, 100]) {
      const v = name();
      const code = loop(`${v} < ${c}`, [`${v} := ${v} * ${v}`]);
      const s0 = c % 2 === 0 ? 1 : 0;
      const runs = [2];
      while (runs[runs.length - 1]! < c) runs.push(runs[runs.length - 1]! ** 2);
      out.push({
        key: `sqgrow:<:${c}`,
        cards: [
          { family: 'sqgrow', tier: 2, code, inputs: [v], start: `${v} >= 2`, verdict: 'ends', why: { ko: `입력이 ${v} ≥ 2라서 ${eunneun(q(`${v} * ${v}`))} ${v}보다 커요. ${runs.join(', ')}처럼 곧 ${c}${batchim(String(c)) ? '을' : '를'} 넘어요.`, en: `With ${v} ≥ 2, ${q(`${v} * ${v}`)} is bigger than ${v}: ${runs.join(', ')} soon passes ${c}.` }, proof: { ends: { V: `${c} - ${v}`, R: `${v} >= 2` } } },
          { family: 'sqgrow', tier: 2, code, inputs: [v], start: `${v} >= ${s0}`, verdict: 'never', why: { ko: `${v} = ${imyeon(String(s0))} ${ira(q(`${s0} * ${s0} = ${s0}`))} 제자리예요.`, en: `From ${v} = ${s0}, ${q(`${s0} * ${s0} = ${s0}`)}: it stays put.` }, proof: { never: { start: { [v]: s0 }, expect: 'cycle' } } },
        ],
      });
    }
    for (const c of [10, 17, 20, 26, 30, 40, 50])
      for (const d of [1, 2]) {
        const v = name();
        const kk = isqrt(c - 1);
        const g = `${v} * ${v} < ${c}`;
        const twinBody = d === 1 ? `${v} := ${v} * 2` : `${v} := -${v}`;
        const ws = d === 1 ? 0 : 1;
        out.push({
          key: `sqgrow:sq:${c}:${d}`,
          cards: [
            {
              family: 'sqgrow',
              tier: 2,
              code: loop(g, [`${v} := ${v} + ${d}`]),
              inputs: [v],
              start: 'true',
              verdict: 'ends',
              why: { ko: `${imyeon(q(g))} ${v}${batchim(v) ? '은' : '는'} −${kk}~${ieyo(String(kk))}. 커지기만 하니 곧 ${kk}${batchim(String(kk)) ? '을' : '를'} 넘어요.`, en: `${q(g)} means ${v} is between −${kk} and ${kk}; as ${q(v)} grows, it soon passes ${kk}.` },
              proof: { ends: { V: `${kk + 1} - ${v}` } },
            },
            {
              family: 'sqgrow',
              tier: 2,
              code: loop(g, [twinBody]),
              inputs: [v],
              start: 'true',
              verdict: 'never',
              why:
                d === 1
                  ? { ko: `${v} = 0이면 ${ira(q('0 * 2 = 0'))} ${iga(q(`0 * 0 < ${c}`))} 계속 참이에요.`, en: `From ${v} = 0, ${q('0 * 2 = 0')}, so ${q(`0 * 0 < ${c}`)} stays true.` }
                  : { ko: `부호만 바뀌어서 ${eunneun(q(`${v} * ${v}`))} 그대로예요. ${v} = 1: 1, −1, 1, …`, en: `Only the sign flips, so ${q(`${v} * ${v}`)} stays the same. ${v} = 1: 1, −1, 1, …` },
              proof: { never: { start: { [v]: ws }, expect: 'cycle' } },
            },
          ],
        });
      }
    return shuffle(out, seed);
  },

  modclock(seed) {
    const out: Group[] = [];
    let k = 6;
    for (const m of range(3, 9))
      for (const d of [1, 2]) {
        if (gcd(d, m) !== 1) continue;
        const v = V1[k++ % V1.length]!;
        const cIn = (m + 1 + 2 * d) % m;
        const iv = inv(d, m);
        const cOut = m + 1 + (m % 3);
        const body = `${v} := (${v} + ${d}) % ${m}`;
        out.push({
          key: `modclock:${m}:${d}`,
          cards: [
            {
              family: 'modclock',
              tier: 2,
              code: loop(`${v} != ${cIn}`, [body]),
              inputs: [v],
              start: 'true',
              verdict: 'ends',
              why: d === 1 ? { ko: `${q(v)}${batchim(v) ? '은' : '는'} 0~${eul(String(m - 1))} 차례로 돌아서 곧 ${cIn}${batchim(String(cIn)) ? '이' : '가'} 돼요.`, en: `${q(v)} goes round 0 to ${m - 1}, so it soon becomes ${cIn}.` } : { ko: `${q(v)}${batchim(v) ? '은' : '는'} ${d}씩 돌며 0~${m - 1}${batchim(String(m - 1)) ? '을' : '를'} 모두 거쳐서 곧 ${cIn}${batchim(String(cIn)) ? '이' : '가'} 돼요.`, en: `Stepping by ${d}, ${q(v)} visits every value from 0 to ${m - 1}, so it soon becomes ${cIn}.` },
              proof: { ends: { V: `(abs(${v} - ${v} % ${m}), ${iv === 1 ? `(${cIn} - ${v}) % ${m}` : `(${iv} * (${cIn} - ${v})) % ${m}`})` } },
            },
            {
              family: 'modclock',
              tier: 2,
              code: loop(`${v} != ${cOut}`, [body]),
              inputs: [v],
              start: 'true',
              verdict: 'never',
              why: { ko: `한 번 돌면 ${q(v)}${batchim(v) ? '은' : '는'} 0~${ira(String(m - 1))}서 ${cOut}${batchim(String(cOut)) ? '이' : '가'} 될 수 없어요.`, en: `After one round ${q(v)} is between 0 and ${m - 1}, so it can never be ${cOut}.` },
              proof: { never: { start: { [v]: 0 }, expect: 'cycle' } },
            },
          ],
        });
      }
    return shuffle(out, seed);
  },

  // ---------------- tier 3: lookalikes, two variables, more lines
  chase(seed) {
    const out: Group[] = [];
    let k = 0;
    for (const dir of ['up', 'down'] as const)
      for (const b of [1, 2, 3])
        for (const a of [b + 1, b + 2]) {
          const [x, y] = V2[k++ % V2.length]!;
          const g = dir === 'up' ? `${x} < ${y}` : `${x} > ${y}`;
          const body = (p: number) => (dir === 'up' ? [`${x} := ${x} + ${p}`, `${y} := ${y} + ${b}`] : [`${x} := ${x} - ${p}`, `${y} := ${y} - ${b}`]);
          const twinA = (a + b) % 2 === 0 ? b : Math.max(1, b - 1);
          const gap = dir === 'up' ? `${y} - ${x}` : `${x} - ${y}`;
          out.push({
            key: `chase:${dir}:${a}:${b}`,
            cards: [
              {
                family: 'chase',
                tier: 3,
                code: loop(g, body(a)),
                inputs: [x, y],
                start: 'true',
                verdict: 'ends',
                why: { ko: `${q(x)}${batchim(x) ? '이' : '가'} 매번 ${a - b}만큼 더 ${dir === 'up' ? '커져요' : '줄어요'}. 차이 ${iga(q(gap))} 줄어요.`, en: `${q(x)} gains ${a - b} on ${q(y)} every round, so the gap ${q(gap)} shrinks.` },
                proof: { ends: { V: gap } },
              },
              {
                family: 'chase',
                tier: 3,
                code: loop(g, body(twinA)),
                inputs: [x, y],
                start: 'true',
                verdict: 'never',
                why:
                  twinA === b
                    ? { ko: `둘 다 ${b}씩 ${dir === 'up' ? '커지면' : '줄면'} 차이 ${eunneun(q(gap))} 그대로예요.`, en: `Both move by ${b}, so the gap ${q(gap)} never changes.` }
                    : { ko: `${q(y)}${batchim(y) ? '이' : '가'} 더 빨리 ${dir === 'up' ? '커져서' : '줄어서'} 차이 ${iga(q(gap))} 벌어지기만 해요.`, en: `${q(y)} moves faster, so the gap ${q(gap)} only widens.` },
                proof: { never: { start: dir === 'up' ? { [x]: 0, [y]: 1 } : { [x]: 1, [y]: 0 }, expect: 'zone', Z: g } },
              },
            ],
          });
        }
    return shuffle(out, seed);
  },

  meet(seed) {
    const out: Group[] = [];
    let k = 4;
    for (const a of [1, 2, 3])
      for (const b of [1, 2, 3]) {
        const [x, y] = V2[k++ % V2.length]!;
        const body = [`${x} := ${x} + ${a}`, `${y} := ${y} - ${b}`];
        const s = a + b;
        const cards: Cand[] = [];
        if (!(a === 1 && b === 1))
          cards.push({
            family: 'meet',
            tier: 3,
            code: loop(`${x} < ${y}`, body),
            inputs: [x, y],
            start: 'true',
            verdict: 'ends',
            why: { ko: `차이 ${iga(q(`${y} - ${x}`))} 매번 ${s}씩 줄어요. 곧 ${iga(q(`${x} < ${y}`))} 거짓이 돼요.`, en: `The gap ${q(`${y} - ${x}`)} shrinks by ${s} each round, so ${q(`${x} < ${y}`)} soon turns false.` },
            proof: { ends: { V: `${y} - ${x}` } },
          });
        const nev: Cand = {
          family: 'meet',
          tier: 3,
          code: loop(`${x} != ${y}`, body),
          inputs: [x, y],
          start: 'true',
          verdict: 'never',
          why: { ko: `차이가 ${s}씩 줄어서 ${s}의 배수가 아니면 0을 건너뛰어요. 차이 1: 1, ${n(1 - s)}, ${n(1 - 2 * s)}, …`, en: `The gap drops by ${s}, so unless it is a multiple of ${s} it skips 0. Gap 1: 1, ${n(1 - s)}, ${n(1 - 2 * s)}, …` },
          proof: { never: { start: { [x]: 0, [y]: 1 }, expect: 'zone', Z: `(${y} - ${x}) % ${s} != 0` } },
        };
        cards.push(nev);
        out.push({ key: `meet:${a}:${b}`, cards });
      }
    return shuffle(out, seed);
  },

  reset(seed) {
    const out: Group[] = [];
    let k = 1;
    for (const c of range(1, 9)) {
      const pairs: [number, number][] = [
        [c + 3 + (c % 4), Math.max(0, c - 2 - (c % 2))],
        [c, c - 1],
      ];
      for (const [hi, lo] of pairs) {
        const v = V1[k++ % V1.length]!;
        const mk = (r: number) => loop(`${v} != ${c}`, [`if (${v} > ${c}) { ${v} := ${v} - 1 }`, `else { ${v} := ${r} }`]);
        out.push({
          key: `reset:down:${c}:${hi}`,
          cards: [
            {
              family: 'reset',
              tier: 3,
              code: mk(hi),
              inputs: [v],
              start: 'true',
              verdict: 'ends',
              why:
                hi === c
                  ? { ko: `${c}보다 작으면 바로 ${c}${batchim(String(c)) ? '이' : '가'} 되고, 크면 1씩 내려와요.`, en: `Below ${c} it jumps straight to ${c}; above, it comes down by 1.` }
                  : { ko: `${c}보다 작으면 ${ro(String(hi))} 갔다가 1씩 내려와 ${c}에 닿아요.`, en: `Below ${c} it jumps to ${hi}, then comes down by 1 and lands on ${c}.` },
              proof: { ends: { V: `(max(0, ${c} - ${v}), max(0, ${v} - ${c}))` } },
            },
            {
              family: 'reset',
              tier: 3,
              code: mk(lo),
              inputs: [v],
              start: 'true',
              verdict: 'never',
              why: { ko: `${c}보다 작으면 ${ro(String(lo))} 가는데, ${lo}에서는 계속 ${ieyo(String(lo))}.`, en: `Below ${c} it goes to ${lo}, and from ${lo} it stays at ${lo}.` },
              proof: { never: { start: { [v]: lo }, expect: 'cycle' } },
            },
          ],
        });
      }
      // going up: if (v < c) { v := v + 1 } else { v := r }
      const u = V1[k++ % V1.length]!;
      const lo = Math.max(0, c - 3);
      const hi = c + 2 + (c % 3);
      const mk = (r: number) => loop(`${u} != ${c}`, [`if (${u} < ${c}) { ${u} := ${u} + 1 }`, `else { ${u} := ${r} }`]);
      out.push({
        key: `reset:up:${c}`,
        cards: [
          {
            family: 'reset',
            tier: 3,
            code: mk(lo),
            inputs: [u],
            start: 'true',
            verdict: 'ends',
            why: { ko: `${c}보다 크면 ${ro(String(lo))} 갔다가 1씩 올라와 ${c}에 닿아요.`, en: `Above ${c} it drops to ${lo}, then climbs by 1 and lands on ${c}.` },
            proof: { ends: { V: `(max(0, ${u} - ${c}), max(0, ${c} - ${u}))` } },
          },
          {
            family: 'reset',
            tier: 3,
            code: mk(hi),
            inputs: [u],
            start: 'true',
            verdict: 'never',
            why: { ko: `${c}보다 크면 ${ro(String(hi))} 가는데, ${hi}에서는 계속 ${ieyo(String(hi))}.`, en: `Above ${c} it goes to ${hi}, and from ${hi} it stays at ${hi}.` },
            proof: { never: { start: { [u]: hi }, expect: 'cycle' } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  branch(seed) {
    const out: Group[] = [];
    let k = 5;
    for (const m of [2, 3, 4, 5]) {
      const v = V1[k++ % V1.length]!;
      const mk = (e: string) => loop(`${v} > 0`, [`if (${v} % ${m} == 0) { ${v} := ${v} / ${m} }`, `else { ${v} := ${e} }`]);
      const r = runText({ code: mk(`${v} + 1`), inputs: [v], start: 'true', verdict: 'never' }, { [v]: 1 }, v, m + 2);
      out.push({
        key: `branch:div:${m}`,
        cards: [
          { family: 'branch', tier: 3, code: mk(`${v} - 1`), inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${m}의 배수면 ${ro(String(m))} 나누고, 아니면 1을 빼요. 어느 쪽이든 줄어요.`, en: `A multiple of ${m} is divided by ${m}, anything else loses 1: either way it shrinks.` }, proof: { ends: { V: v } } },
          { family: 'branch', tier: 3, code: mk(`${v} + 1`), inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = 1이면 커지다 ${m}에서 1로 돌아와요: ${r}`, en: `From ${v} = 1 it climbs to ${m} and falls back to 1: ${r}` }, proof: { never: { start: { [v]: 1 }, expect: 'cycle' } } },
        ],
      });
    }
    for (const c of range(1, 10)) {
      const v = V1[k++ % V1.length]!;
      const fromAbove = c % 2 === 1;
      const mk = (back: number) =>
        fromAbove
          ? loop(`${v} != ${c}`, [`if (${v} > ${c}) { ${v} := ${v} - 2 }`, `else { ${v} := ${v} + ${back} }`])
          : loop(`${v} != ${c}`, [`if (${v} < ${c}) { ${v} := ${v} + 2 }`, `else { ${v} := ${v} - ${back} }`]);
      const r = runText({ code: mk(2), inputs: [v], start: 'true', verdict: 'never' }, { [v]: c + 1 }, v, 3);
      out.push({
        key: `branch:step:${c}`,
        cards: [
          {
            family: 'branch',
            tier: 3,
            code: mk(1),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: fromAbove
              ? { ko: `위에서는 2씩 내려오고, 지나치면 1씩 올라와서 ${c}에 닿아요.`, en: `From above it comes down by 2; if it overshoots, it climbs back by 1 onto ${c}.` }
              : { ko: `아래에서는 2씩 올라가고, 지나치면 1씩 내려와서 ${c}에 닿아요.`, en: `From below it goes up by 2; if it overshoots, it comes back by 1 onto ${c}.` },
            proof: { ends: { V: fromAbove ? `abs(${v} - ${c}) + max(0, ${v} - ${c})` : `abs(${v} - ${c}) + max(0, ${c} - ${v})` } },
          },
          {
            family: 'branch',
            tier: 3,
            code: mk(2),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: `양쪽 다 2씩 움직여서 ${c}${batchim(String(c)) ? '을' : '를'} 건너뛰어요: ${r}`, en: `It moves by 2 both ways and jumps over ${c}: ${r}` },
            proof: { never: { start: { [v]: c + 1 }, expect: 'cycle' } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  swap(seed) {
    const out: Group[] = [];
    let k = 0;
    const forms: [string, (a: string, b: string) => string[], RushVerdict, (a: string, b: string) => Text, (a: string, b: string) => Proof][] = [
      ['<', (a, b) => [`t := ${a}`, `${a} := ${b}`, `${b} := t`], 'ends', () => ({ ko: '한 번 바꾸면 순서가 뒤집혀서 바로 끝나요.', en: 'One swap turns the order around, so it stops right away.' }), (a, b) => ({ ends: { V: `${b} - ${a}` } })],
      ['>=', (a, b) => [`t := ${a}`, `${a} := ${b}`, `${b} := t`], 'never', (a, b) => ({ ko: `${q(a)}${batchim(a) ? '과' : '와'} ${iga(q(b))} 같으면 바꿔도 그대로라 계속 돌아요.`, en: `When ${q(a)} and ${q(b)} are equal, a swap changes nothing, so it keeps going.` }), (a, b) => ({ never: { start: { [a]: 1, [b]: 1 }, expect: 'cycle' } })],
      ['<=', (a, b) => [`t := ${a}`, `${a} := ${b}`, `${b} := t`], 'never', (a, b) => ({ ko: `${q(a)}${batchim(a) ? '과' : '와'} ${iga(q(b))} 같으면 바꿔도 그대로라 계속 돌아요.`, en: `When ${q(a)} and ${q(b)} are equal, a swap changes nothing, so it keeps going.` }), (a, b) => ({ never: { start: { [a]: 2, [b]: 2 }, expect: 'cycle' } })],
      ['>', (a, b) => [`${a} := ${b}`, `${b} := ${a}`], 'ends', (a, b) => ({ ko: `바꾸기가 아니에요. ${q(`${a} := ${b}`)} 뒤에는 둘이 같아서 한 번에 끝나요.`, en: `Not a swap: after ${q(`${a} := ${b}`)} both are equal, so one round ends it.` }), (a, b) => ({ ends: { V: `${a} - ${b}` } })],
      ['<', (a, b) => [`${a} := ${b}`, `${b} := ${a} + 1`], 'never', (a, b) => ({ ko: `${q(`${b} := ${a} + 1`)}${batchim('1') ? '은' : '는'} 새 ${q(a)}${batchim(a) ? '을' : '를'} 써서 ${q(b)}${batchim(b) ? '이' : '가'} 늘 1 더 커요.`, en: `${q(`${b} := ${a} + 1`)} uses the new ${q(a)}, so ${q(b)} always stays 1 ahead.` }), (a, b) => ({ never: { start: { [a]: 0, [b]: 1 }, expect: 'zone', Z: `${a} < ${b}` } })],
      ['!=', (a, b) => [`${b} := ${a}`, `${a} := ${b}`], 'ends', (a, b) => ({ ko: `바꾸기가 아니에요. ${q(`${b} := ${a}`)} 뒤에는 둘이 같아서 한 번에 끝나요.`, en: `Not a swap: after ${q(`${b} := ${a}`)} both are equal, so one round ends it.` }), (a, b) => ({ ends: { V: `abs(${a} - ${b})` } })],
      ['<', (a, b) => [`t := ${a}`, `${a} := ${b}`, `${b} := t + 1`], 'ends', (a, b) => ({ ko: `바꾸면 ${q(a)}${batchim(a) ? '이' : '가'} 더 커져서 ${iga(q(`${a} < ${b}`))} 바로 거짓이 돼요.`, en: `After the swap ${q(a)} is the bigger one, so ${q(`${a} < ${b}`)} is false right away.` }), (a, b) => ({ ends: { V: `${b} - ${a}` } })],
    ];
    for (const [op, body, verdict, why, proof] of forms) {
      const [a, b] = (V2.filter(([x, y]) => x !== 't' && y !== 't')[k++ % 6])!;
      out.push({ key: `swap:${op}:${k}`, cards: [{ family: 'swap', tier: 3, code: loop(`${a} ${op} ${b}`, body(a, b)), inputs: [a, b], start: 'true', verdict, why: why(a, b), proof: proof(a, b) }] });
    }
    return shuffle(out, seed);
  },

  andor(seed) {
    const out: Group[] = [];
    let k = 3;
    for (const c of range(0, 5))
      for (const d of range(0, 3)) {
        const [x, y] = V2[k++ % V2.length]!;
        if ((c + d) % 2 === 0) {
          const gx = c ? `${x} > ${c}` : `${x} > 0`;
          const gy = `${y} > ${d}`;
          const body = [`${x} := ${x} - 1`, `${y} := ${y} + 1`];
          out.push({
            key: `andor:a:${c}:${d}`,
            cards: [
              { family: 'andor', tier: 3, code: loop(`${gx} && ${gy}`, body), inputs: [x, y], start: 'true', verdict: 'ends', why: { ko: `${q('&&')}라서 ${iga(q(gx))} 거짓이 되면 끝나요. ${q(x)}${batchim(x) ? '은' : '는'} 매번 1씩 줄어요.`, en: `With ${q('&&')} it stops once ${q(gx)} fails, and ${q(x)} drops by 1 each round.` }, proof: { ends: { V: c ? `${x} - ${c}` : x } } },
              { family: 'andor', tier: 3, code: loop(`${gx} || ${gy}`, body), inputs: [x, y], start: 'true', verdict: 'never', why: { ko: `${q('||')}라서 ${q(gy)}만으로도 계속 돌아요. ${q(y)}${batchim(y) ? '은' : '는'} 커지기만 해요.`, en: `With ${q('||')}, ${q(gy)} alone keeps it going, and ${q(y)} only grows.` }, proof: { never: { start: { [x]: c, [y]: d + 1 }, expect: 'zone', Z: gy } } },
            ],
          });
        } else {
          const gx = `${x} > ${c}`;
          const gy = `${y} > ${d}`;
          out.push({
            key: `andor:o:${c}:${d}`,
            cards: [
              { family: 'andor', tier: 3, code: loop(`${gx} || ${gy}`, [`${x} := ${x} - 1`, `${y} := ${y} - 1`]), inputs: [x, y], start: 'true', verdict: 'ends', why: { ko: `${q(x)}${batchim(x) ? '과' : '와'} ${q(y)} 둘 다 매번 줄어서 곧 두 조건 모두 거짓이 돼요.`, en: `Both ${q(x)} and ${q(y)} drop every round, so soon neither part holds.` }, proof: { ends: { V: `max(${x} - ${c}, ${y} - ${d})` } } },
              { family: 'andor', tier: 3, code: loop(`${gx} || ${gy}`, [`${x} := ${x} - 1`]), inputs: [x, y], start: 'true', verdict: 'never', why: { ko: `${q(y)}${batchim(y) ? '은' : '는'} 바뀌지 않아요. ${y} = ${imyeon(String(d + 1))} ${q(gy)}만으로 계속 돌아요.`, en: `${q(y)} never changes: with ${y} = ${d + 1}, ${q(gy)} alone keeps it going.` }, proof: { never: { start: { [x]: 0, [y]: d + 1 }, expect: 'zone', Z: gy } } },
            ],
          });
        }
      }
    return shuffle(out, seed);
  },

  mirror(seed) {
    const out: Group[] = [];
    let k = 7;
    for (const c of range(3, 12)) {
      const v = V1[k++ % V1.length]!;
      // while (v < c) { v := d - v }: ends iff d ≥ 2c − 1
      const dEnd = 2 * c + (c % 3);
      const dNever = 2 * c - 2 - (c % 4);
      const w = Math.floor(dNever / 2) - (dNever % 2 === 0 && c % 2 === 1 ? 1 : 0);
      const back = dNever - w;
      out.push({
        key: `mirror:<:${c}`,
        cards: [
          { family: 'mirror', tier: 3, code: loop(`${v} < ${c}`, [`${v} := ${dEnd} - ${v}`]), inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${v} < ${c}이면 ${eunneun(q(`${dEnd} - ${v}`))} ${c}보다 커서 한 번에 끝나요.`, en: `For ${v} < ${c}, ${q(`${dEnd} - ${v}`)} is more than ${c}, so one round ends it.` }, proof: { ends: { V: `${c} - ${v}` } } },
          {
            family: 'mirror',
            tier: 3,
            code: loop(`${v} < ${c}`, [`${v} := ${dNever} - ${v}`]),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: w === back ? { ko: `${v} = ${imyeon(String(w))} ${ira(q(`${dNever} - ${w} = ${w}`))} 제자리예요.`, en: `From ${v} = ${w}, ${q(`${dNever} - ${w} = ${w}`)}: it stays put.` } : { ko: `${v} = ${imyeon(String(w))} ${back}, 다시 ${ieyo(String(w))}. ${c}에 닿지 못하고 왔다 갔다 해요.`, en: `${v} = ${w} goes to ${back} and back to ${w}; it never gets to ${c}.` },
            proof: { never: { start: { [v]: w }, expect: 'cycle' } },
          },
        ],
      });
      // while (v > c) { v := d - v }: ends iff d ≤ 2c + 1
      const u = V1[k++ % V1.length]!;
      const eEnd = 2 * c - (c % 3);
      const eNever = 2 * c + 2 + (c % 4);
      const wu = Math.ceil(eNever / 2) + (eNever % 2 === 0 && c % 2 === 0 ? 1 : 0);
      const backu = eNever - wu;
      if (c === 0) continue;
      out.push({
        key: `mirror:>:${c}`,
        cards: [
          { family: 'mirror', tier: 3, code: loop(`${u} > ${c}`, [`${u} := ${eEnd} - ${u}`]), inputs: [u], start: 'true', verdict: 'ends', why: { ko: `${u} > ${c}이면 ${eunneun(q(`${eEnd} - ${u}`))} ${c}보다 작아서 한 번에 끝나요.`, en: `For ${u} > ${c}, ${q(`${eEnd} - ${u}`)} is below ${c}, so one round ends it.` }, proof: { ends: { V: `${u} - ${c}` } } },
          {
            family: 'mirror',
            tier: 3,
            code: loop(`${u} > ${c}`, [`${u} := ${eNever} - ${u}`]),
            inputs: [u],
            start: 'true',
            verdict: 'never',
            why: wu === backu ? { ko: `${u} = ${imyeon(String(wu))} ${ira(q(`${eNever} - ${wu} = ${wu}`))} 제자리예요.`, en: `From ${u} = ${wu}, ${q(`${eNever} - ${wu} = ${wu}`)}: it stays put.` } : { ko: `${u} = ${imyeon(String(wu))} ${backu}, 다시 ${ieyo(String(wu))}. ${c} 아래로 못 내려가고 왔다 갔다 해요.`, en: `${u} = ${wu} goes to ${backu} and back to ${wu}; it never gets down to ${c}.` },
            proof: { never: { start: { [u]: wu }, expect: 'cycle' } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  fraction(seed) {
    const out: Group[] = [];
    let k = 9;
    for (const d of [2, 3, 4])
      for (const c of range(0, 6)) {
        if (c > d + 2) continue;
        const v = V1[k++ % V1.length]!;
        const code = loop(`${v} > ${c}`, [`${v} := ${v} - ${v} / ${d}`]);
        if (c >= d - 1) {
          out.push({
            key: `fraction:-:${d}:${c}`,
            cards: [{ family: 'fraction', tier: 3, code, inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${v} > ${c}이면 ${eunneun(q(`${v} / ${d}`))} 1 이상이라 ${q(v)}${batchim(v) ? '이' : '가'} 매번 줄어요.`, en: `For ${v} > ${c}, ${q(`${v} / ${d}`)} is at least 1, so ${q(v)} drops every round.` }, proof: { ends: { V: c ? `${v} - ${c}` : v } } }],
          });
        } else {
          const w = c + 1;
          out.push({
            key: `fraction:-:${d}:${c}`,
            cards: [{ family: 'fraction', tier: 3, code, inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = ${imyeon(String(w))} ${ira(q(`${w} / ${d} = 0`))} ${q(v)}${batchim(v) ? '이' : '가'} 그대로예요.`, en: `From ${v} = ${w}, ${q(`${w} / ${d} = 0`)}, so ${q(v)} never changes.` }, proof: { never: { start: { [v]: w }, expect: 'cycle' } } }],
          });
        }
      }
    for (const d of [2, 3, 4])
      for (const c of [10, 20, 30]) {
        const v = V1[k++ % V1.length]!;
        const code = loop(`${v} < ${c}`, [`${v} := ${v} + ${v} / ${d}`]);
        out.push({
          key: `fraction:+:${d}:${c}`,
          cards: [
            { family: 'fraction', tier: 3, code, inputs: [v], start: `${v} >= ${d}`, verdict: 'ends', why: { ko: `입력이 ${v} ≥ ${ira(String(d))} ${eunneun(q(`${v} / ${d}`))} 1 이상이에요. ${q(v)}${batchim(v) ? '이' : '가'} 매번 커져요.`, en: `The input is ${v} ≥ ${d}, so ${q(`${v} / ${d}`)} is at least 1 and ${q(v)} grows every round.` }, proof: { ends: { V: `${c} - ${v}`, R: `${v} >= ${d}` } } },
            { family: 'fraction', tier: 3, code, inputs: [v], start: `${v} >= 1`, verdict: 'never', why: { ko: `${v} = 1이면 ${ira(q(`1 / ${d} = 0`))} ${q(v)}${batchim(v) ? '이' : '가'} 그대로예요.`, en: `From ${v} = 1, ${q(`1 / ${d} = 0`)}, so ${q(v)} never changes.` }, proof: { never: { start: { [v]: 1 }, expect: 'cycle' } } },
          ],
        });
      }
    return shuffle(out, seed);
  },

  halfplus(seed) {
    const out: Group[] = [];
    let k = 1;
    for (const e of [1, 2, 3, 4]) {
      const fixed = 2 * e;
      // ends when every x above the guard is above the fixed point 2e; otherwise x = 2e stays put
      const pairs: [number, number][] = [
        [fixed, fixed - 1],
        [fixed + 1, fixed - 2],
      ];
      for (const [cEnd, cNever] of pairs) {
        const cards: Cand[] = [];
        const v = V1[k++ % V1.length]!;
        for (const c of [cEnd, cNever]) {
          if (c < 0) continue;
          const code = loop(`${v} > ${c}`, [`${v} := ${v} / 2 + ${e}`]);
          cards.push(
            c >= fixed
              ? { family: 'halfplus', tier: 3, code, inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${v} > ${c}이면 ${iga(q(`${v} / 2 + ${e}`))} ${v}보다 작아요. 곧 ${c} 이하가 돼요.`, en: `For ${v} > ${c}, ${q(`${v} / 2 + ${e}`)} is less than ${v}, so it soon gets to ${c} or less.` }, proof: { ends: { V: c ? `${v} - ${c}` : v } } }
              : { family: 'halfplus', tier: 3, code, inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = ${imyeon(String(fixed))} ${ira(q(`${fixed} / 2 + ${e} = ${fixed}`))} 제자리예요.`, en: `From ${v} = ${fixed}, ${q(`${fixed} / 2 + ${e} = ${fixed}`)}: it stays put.` }, proof: { never: { start: { [v]: fixed }, expect: 'cycle' } } },
          );
        }
        out.push({ key: `halfplus:${e}:${cEnd}`, cards });
      }
    }
    return shuffle(out, seed);
  },

  minmax(seed) {
    const out: Group[] = [];
    let k = 2;
    for (const c of range(2, 9)) {
      const v = V1[k++ % V1.length]!;
      const dLo = c - 1 - (c % 3);
      const dHi = c + 1 + (c % 2);
      out.push({
        key: `minmax:min:${c}`,
        cards: [
          { family: 'minmax', tier: 3, code: loop(`${v} > ${c}`, [`${v} := min(${v}, ${dLo})`]), inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${eunneun(q(`min(${v}, ${dLo})`))} ${dLo} 이하라 한 번 돌면 ${iga(q(`${v} > ${c}`))} 거짓이에요.`, en: `${q(`min(${v}, ${dLo})`)} is at most ${dLo}, so after one round ${q(`${v} > ${c}`)} is false.` }, proof: { ends: { V: `${v} - ${c}` } } },
          { family: 'minmax', tier: 3, code: loop(`${v} > ${c}`, [`${v} := min(${v}, ${dHi})`]), inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = ${imyeon(String(dHi))} ${ira(q(`min(${dHi}, ${dHi}) = ${dHi}`))} 제자리예요.`, en: `From ${v} = ${dHi}, ${q(`min(${dHi}, ${dHi}) = ${dHi}`)}: it stays put.` }, proof: { never: { start: { [v]: dHi }, expect: 'cycle' } } },
        ],
      });
      const u = V1[k++ % V1.length]!;
      const eHi = c + 1 + (c % 3);
      const eLo = c - 1 - (c % 2);
      out.push({
        key: `minmax:max:${c}`,
        cards: [
          { family: 'minmax', tier: 3, code: loop(`${u} < ${c}`, [`${u} := max(${u}, ${eHi})`]), inputs: [u], start: 'true', verdict: 'ends', why: { ko: `${eunneun(q(`max(${u}, ${eHi})`))} ${eHi} 이상이라 한 번 돌면 ${iga(q(`${u} < ${c}`))} 거짓이에요.`, en: `${q(`max(${u}, ${eHi})`)} is at least ${eHi}, so after one round ${q(`${u} < ${c}`)} is false.` }, proof: { ends: { V: `${c} - ${u}` } } },
          { family: 'minmax', tier: 3, code: loop(`${u} < ${c}`, [`${u} := max(${u}, ${eLo})`]), inputs: [u], start: 'true', verdict: 'never', why: { ko: `${u} = ${imyeon(String(eLo))} ${ira(q(`max(${eLo}, ${eLo}) = ${eLo}`))} 제자리예요.`, en: `From ${u} = ${eLo}, ${q(`max(${eLo}, ${eLo}) = ${eLo}`)}: it stays put.` }, proof: { never: { start: { [u]: eLo }, expect: 'cycle' } } },
        ],
      });
      const s = V1[k++ % V1.length]!;
      const t = c + 4;
      out.push({
        key: `minmax:cap:${c}`,
        cards: [
          { family: 'minmax', tier: 3, code: loop(`${s} != ${t}`, [`${s} := min(${s} + 1, ${t})`]), inputs: [s], start: 'true', verdict: 'ends', why: { ko: `${t}보다 작으면 1씩 커지고, 크면 바로 ${t}${batchim(String(t)) ? '이' : '가'} 돼요.`, en: `Below ${t} it goes up by 1; above ${t} it drops straight to ${t}.` }, proof: { ends: { V: `abs(${s} - ${t})` } } },
          { family: 'minmax', tier: 3, code: loop(`${s} != ${t}`, [`${s} := min(${s} + 1, ${t - 1})`]), inputs: [s], start: 'true', verdict: 'never', why: { ko: `${eunneun(q(`min(${s} + 1, ${t - 1})`))} ${t - 1}${batchim(String(t - 1)) ? '을' : '를'} 넘지 못해서 ${t}${batchim(String(t)) ? '이' : '가'} 될 수 없어요.`, en: `${q(`min(${s} + 1, ${t - 1})`)} is at most ${t - 1}, so it can never be ${t}.` }, proof: { never: { start: { [s]: t - 1 }, expect: 'cycle' } } },
        ],
      });
    }
    return shuffle(out, seed);
  },

  product(seed) {
    const out: Group[] = [];
    let k = 5;
    for (const c of [6, 8, 10, 12, 15, 16, 20, 24, 30]) {
      const [x, y] = V2[k++ % V2.length]!;
      const code = loop(`${x} < ${c}`, [`${x} := ${x} * ${y}`]);
      out.push({
        key: `product:${c}`,
        cards: [
          { family: 'product', tier: 3, code, inputs: [x, y], start: `${x} >= 1 && ${y} >= 2`, verdict: 'ends', why: { ko: `${x} ≥ 1, ${y} ≥ 2라서 ${eunneun(q(`${x} * ${y}`))} ${x}보다 커요. 곧 ${c} 이상이 돼요.`, en: `With ${x} ≥ 1 and ${y} ≥ 2, ${q(`${x} * ${y}`)} is bigger than ${x}, so it soon reaches ${c}.` }, proof: { ends: { V: `${c} - ${x}`, R: `${x} >= 1 && ${y} >= 2` } } },
          { family: 'product', tier: 3, code, inputs: [x, y], start: `${x} >= 1 && ${y} >= 1`, verdict: 'never', why: { ko: `${y} = 1이면 ${ira(q(`${x} * 1 = ${x}`))} ${q(x)}${batchim(x) ? '이' : '가'} 그대로예요.`, en: `With ${y} = 1, ${q(`${x} * 1 = ${x}`)}: ${q(x)} never moves.` }, proof: { never: { start: { [x]: 1, [y]: 1 }, expect: 'cycle' } } },
        ],
      });
    }
    return shuffle(out, seed);
  },
};

// ------------------------------------------------------------ checks

const FORBIDDEN = forbiddenPrograms();
const FORBIDDEN_FULL = new Set(FORBIDDEN.map(([, c]) => canonical(c)));
const FORBIDDEN_LOOP = new Set(FORBIDDEN.map(([, c]) => canonicalLoop(c)));
const keyOf = (c: { code: string; start: string; inputs: string[] }) => {
  // the start condition renamed the same way as the code
  const names = new Map<string, string>();
  for (const tok of lex(c.code)) if (tok.t === 'id' && !['while', 'if', 'else', 'abs', 'min', 'max', 'true', 'false'].includes(tok.s) && !names.has(tok.s)) names.set(tok.s, `v${names.size}`);
  const start = lex(c.start)
    .filter((t) => t.t !== 'end')
    .map((t) => (t.t === 'id' && names.has(t.s) ? names.get(t.s)! : t.s))
    .join(' ');
  return `${canonical(c.code)} | ${start}`;
};

const plain = (s: string) => s.replace(/`/g, '');

/** Format checks: readable in 5 seconds. Returns a problem or null. */
function formatProblem(c: Cand, l: Level): string | null {
  const lines = c.code.split('\n');
  const body = lines.length - 2;
  if (lines.some((x) => x.length > MAX_LINE)) return 'long line';
  if (body > 4) return 'too many lines';
  if (c.tier === 1 && (l.vars.length !== 1 || body !== 1)) return 'tier 1 is one variable, one line';
  if (c.tier === 2 && (l.vars.length > 2 || body > 2)) return 'tier 2 is at most two variables and two lines';
  if (l.vars.length > 3) return 'too many variables';
  for (const tok of lex(c.code)) if (tok.t === 'num' && Number(tok.s) > 100) return 'constant over 100';
  if ([...plain(c.why.ko)].length > 60) return `Korean reason too long (${[...plain(c.why.ko)].length}): ${c.why.ko}`;
  if ([...plain(c.why.en)].length > 95) return `English reason too long (${[...plain(c.why.en)].length}): ${c.why.en}`;
  if (!/요/.test(c.why.ko)) return 'Korean reason without ~요';
  if ((c.why.ko.match(/`/g) ?? []).length % 2 || (c.why.en.match(/`/g) ?? []).length % 2) return 'unpaired backticks';
  return null;
}

/** Walker start and a second sample: for "ends" the run with 2–6 steps closest to 3 (small numbers first). */
function chooseSamples(c: Cand, l: Level): Record<string, number>[] | string {
  const grid = gridStarts(l, -5, l.inputs.length === 1 ? 20 : 12).map((s) => ({ s, run: simulate(l, s, 60) }));
  const toObj = (s: State) => Object.fromEntries(l.inputs.map((v) => [v, Number(s[v]!)]));
  const size = (s: State) => l.inputs.reduce((a, v) => a + Math.abs(Number(s[v]!)), 0);
  const zero = grid.filter((g) => g.run.outcome === 'exit' && g.run.states.length === 1).sort((a, b) => size(a.s) - size(b.s));
  if (c.verdict === 'never') {
    const w = (c.proof as Extract<Proof, { never: unknown }>).never.start;
    const second = zero[0]?.s ?? grid.find((g) => l.inputs.some((v) => Number(g.s[v]) !== (w[v] ?? 0)))?.s;
    return second ? [w, toObj(second)] : 'no second sample';
  }
  const ends = grid.filter((g) => g.run.outcome === 'exit');
  const score = (g: (typeof grid)[number]) => {
    const steps = g.run.states.length - 1;
    const big = Math.max(...g.run.states.flatMap((s) => l.vars.map((v) => Math.abs(Number(s[v]!)))));
    return (steps === 0 ? 1000 : steps > 6 ? 100 + steps : Math.abs(steps - 3) * 10) + size(g.s) + (big > 999 ? 500 : 0);
  };
  const best = [...ends].sort((a, b) => score(a) - score(b))[0];
  if (!best) return 'no sample';
  const second = zero.find((g) => g !== best) ?? ends.filter((g) => g !== best).sort((a, b) => score(a) - score(b))[0];
  return second ? [toObj(best.s), toObj(second.s)] : 'no second sample';
}

/** The walker's run after the answer draws up to RUSH_DRAW steps; its numbers must stay readable. */
function stageTooBig(l: Level, start: Record<string, number>): boolean {
  const s0 = initialState(l, Object.fromEntries(l.inputs.map((v) => [v, BigInt(start[v] ?? 0)])));
  const run = simulate(l, s0, RUSH_DRAW);
  return run.states.some((s) => l.vars.some((v) => s[v]! >= 10n ** 12n || s[v]! <= -(10n ** 12n)));
}

/** Simulation sanity: ends = every small allowed start ends (both division semantics); never = the witness does not. */
function simProblem(c: Cand, l: Level): string | null {
  if (c.verdict === 'ends') {
    for (const s of gridStarts(l)) {
      if (simulate(l, s, SIM_CAP).outcome !== 'exit') return `start ${JSON.stringify(s, (_, x) => (typeof x === 'bigint' ? Number(x) : x))} does not end`;
      if (!endsTruncated(l, s)) return 'depends on how / and % round negatives';
    }
    return null;
  }
  const w = (c.proof as Extract<Proof, { never: unknown }>).never;
  const inputs = Object.fromEntries(l.inputs.map((v) => [v, BigInt(w.start[v] ?? 0)]));
  if (!startAllowed(l, inputs)) return 'witness not allowed by the input';
  const s0 = initialState(l, inputs);
  const run = simulate(l, s0, SIM_CAP);
  if (run.outcome === 'exit') return 'witness ends';
  if (w.expect === 'cycle' && run.outcome !== 'cycle') return 'witness does not cycle';
  if (endsTruncated(l, s0)) return 'depends on how / and % round negatives';
  return null;
}

async function proofProblem(judge: Awaited<ReturnType<typeof nodeJudge>>['judge'], c: Cand, l: Level): Promise<string | null> {
  if ('ends' in c.proof) {
    const o = await proveEnds(judge, l, c.proof.ends.V, c.proof.ends.R ?? '');
    if (o.type !== 'ends') return `proof does not parse: ${JSON.stringify(o)}`;
    return o.result === 'proved' ? null : `ends proof ${o.result}: ${c.proof.ends.V} / ${c.proof.ends.R ?? ''} ${JSON.stringify(o.details.map((d) => [d.id, d.status]))}`;
  }
  const w = c.proof.never;
  if (w.expect === 'cycle') return null; // the simulation found the repeated state
  const inputs = Object.fromEntries(l.inputs.map((v) => [v, BigInt(w.start[v] ?? 0)]));
  const s0 = initialState(l, inputs);
  const Z = parseCond(w.Z, { vars: l.vars, locals: l.locals });
  const checks = await judge.checkZone(l, s0, Z);
  return overall(checks) === 'proved' ? null : `zone ${w.Z}: ${JSON.stringify(checks.map((x) => [x.id, x.status]))}`;
}

// ------------------------------------------------------------ main

interface Out {
  def: RushCardDef;
  proof: Proof;
  key: string;
}

async function main() {
  const z = await nodeJudge();
  const verbose = process.argv.includes('--verbose');
  const taken = new Set<string>(HAND_DEFS.map(keyOf));
  const prevIds = new Map(RUSH_BANK.map((d) => [keyOf(d), d.id]));
  let nextId = Math.max(1000, ...RUSH_BANK.map((d) => d.id)) + 1;
  const handTier: Record<Tier, number> = { 1: 0, 2: 0, 3: 0 };
  for (const d of HAND_DEFS) handTier[d.tier]++;
  const handFamily = new Map<string, number>();
  for (const d of HAND_DEFS) handFamily.set(d.family, (handFamily.get(d.family) ?? 0) + 1);

  const queues = Object.entries(FAMILIES).map(([name, f], i) => ({ name, groups: f(1000 + i * 7919) }));
  const perFamily = new Map<string, number>(handFamily);
  const perTier: Record<Tier, number> = { ...handTier };
  const out: Out[] = [];
  const dropped = new Map<string, number>();
  const drop = (why: string, c: Cand) => {
    const k = `${c.family}: ${why.replace(/\(.*$/, '').slice(0, 60)}`;
    dropped.set(k, (dropped.get(k) ?? 0) + 1);
    if (verbose) console.log('drop', c.family, why, JSON.stringify(c.code));
  };

  // round robin over the families, one group at a time, until every tier has its share
  let progress = true;
  while (progress) {
    progress = false;
    for (const qd of queues) {
      while (qd.groups.length) {
        const g = qd.groups.shift()!;
        const tier = g.cards[0]!.tier;
        if (perTier[tier] >= TIER_TARGET[tier]) continue;
        if ((perFamily.get(qd.name) ?? 0) + g.cards.length > FAMILY_CAP) continue;
        const accepted: Out[] = [];
        for (const c of g.cards) {
          let l: Level;
          try {
            l = compile(c);
          } catch (e) {
            drop(`does not parse ${String(e)}`, c);
            continue;
          }
          const key = keyOf(c);
          if (taken.has(key) || accepted.some((a) => a.key === key)) {
            drop('duplicate', c);
            continue;
          }
          if (FORBIDDEN_FULL.has(canonical(c.code)) || FORBIDDEN_LOOP.has(canonicalLoop(c.code))) {
            drop('a level or tutorial program', c);
            continue;
          }
          const fp = formatProblem(c, l);
          if (fp) {
            drop(fp, c);
            continue;
          }
          const sp = simProblem(c, l);
          if (sp) {
            drop(sp, c);
            continue;
          }
          const samples = chooseSamples(c, l);
          if (typeof samples === 'string') {
            drop(samples, c);
            continue;
          }
          if (stageTooBig(l, samples[0]!)) {
            drop('numbers too big for the stage', c);
            continue;
          }
          const pp = await proofProblem(z.judge, c, l);
          if (pp) {
            drop(pp, c);
            continue;
          }
          accepted.push({
            key,
            proof: c.proof,
            def: { id: 0, tier: c.tier, family: c.family, code: c.code, inputs: c.inputs, start: c.start, verdict: c.verdict, why: c.why, samples },
          });
        }
        if (!accepted.length) continue;
        if (perTier[tier] + accepted.length > TIER_TARGET[tier]) continue;
        const verdicts = new Set(accepted.map((a) => a.def.verdict));
        for (const a of accepted) {
          if (verdicts.size === 2) a.def.pair = g.key;
          taken.add(a.key);
          out.push(a);
        }
        perFamily.set(qd.name, (perFamily.get(qd.name) ?? 0) + accepted.length);
        perTier[tier] += accepted.length;
        progress = true;
        break;
      }
    }
  }
  await z.close();

  // stable ids
  for (const o of out) o.def.id = prevIds.get(o.key) ?? 0;
  for (const o of [...out].sort((a, b) => (a.key < b.key ? -1 : 1))) if (!o.def.id) o.def.id = nextId++;
  out.sort((a, b) => a.def.id - b.def.id);

  // ---------------- write
  const lit = (x: unknown) => JSON.stringify(x);
  const defLine = (d: RushCardDef) =>
    `  { id: ${d.id}, tier: ${d.tier}, family: ${lit(d.family)}${d.pair ? `, pair: ${lit(d.pair)}` : ''}, code: ${lit(d.code)}, inputs: ${lit(d.inputs)}, start: ${lit(d.start)}, verdict: ${lit(d.verdict)}, why: { ko: ${lit(d.why.ko)}, en: ${lit(d.why.en)} }, samples: ${lit(d.samples)} },`;
  writeFileSync(
    join(root, 'src/core/rushBank.ts'),
    `// Generated by scripts/gen-rush-cards.ts. Do not edit by hand: change the generator and run \`npm run gen-cards\`.
// ${out.length} cards; their reference proofs are in test/rushBankAnswers.ts.
import type { RushCardDef } from './rushCards.ts';

export const RUSH_BANK: RushCardDef[] = [
${out.map((o) => defLine(o.def)).join('\n')}
];
`,
  );
  const ansLine = (o: Out) => `  ${o.def.id}: ${lit(o.proof)},`;
  writeFileSync(
    join(root, 'test/rushBankAnswers.ts'),
    `// Generated by scripts/gen-rush-cards.ts: the reference proofs of the generated rush cards (kept out of the game).
// ends: steps left V (and a railing R where the input matters); never: an allowed start that repeats a state
// (cycle), or a start and a bottomless zone Z.
import type { RushProof } from './rushAnswers.ts';

export const BANK_ANSWERS: Record<number, RushProof> = {
${out.map(ansLine).join('\n')}
};
`,
  );

  // ---------------- report
  const total = HAND_DEFS.length + out.length;
  console.log(`cards: ${total} (${HAND_DEFS.length} by hand + ${out.length} generated)`);
  for (const t of [1, 2, 3] as Tier[]) console.log(`tier ${t}: ${perTier[t]} (${((100 * perTier[t]) / total).toFixed(1)} %)`);
  const fam = new Map<string, { t: number[]; e: number; n: number }>();
  for (const d of [...HAND_DEFS, ...out.map((o) => o.def)]) {
    const f = fam.get(d.family) ?? { t: [0, 0, 0], e: 0, n: 0 };
    f.t[d.tier - 1]!++;
    if (d.verdict === 'ends') f.e++;
    else f.n++;
    fam.set(d.family, f);
  }
  for (const [name, f] of [...fam].sort()) console.log(`  ${name.padEnd(9)} ${String(f.t[0]! + f.t[1]! + f.t[2]!).padStart(3)}  tiers ${f.t.join('/')}  ends ${f.e} never ${f.n}`);
  console.log('dropped:');
  for (const [k, v] of [...dropped].sort()) console.log(`  ${v} × ${k}`);
}

await main();
