// Generates the rush card bank (SPEC_rush2 §B): families of short loops (one family = one template), each with an
// "ends" and a "never" form, many constants, variable names and input conditions. Deterministic. Every card is
// checked before it is written: its format (readable in 5 seconds), that it reads like a person wrote it (no clumsy
// code, test/rushLint.ts), that it is new (no level or tutorial loop even with other names and constants,
// test/rushCanon.ts loopShape; no hand card or other card after renaming variables), a grid of small starts simulated
// with two division semantics, and its proof with the real Z3 judge (plus what the tests check: the plain guesses of
// a "never" card are refuted, the stage after an "ends" card shows at most 12 steps, the twin of a lookalike pair
// refutes the other's proof). A card that fails any of these is not emitted.
//
//   node scripts/gen-rush-cards.ts        (npm run gen-cards; --verbose lists every dropped card)
//   node scripts/gen-rush-cards.ts --all  (checks every candidate of every family, writes nothing)
//
// Choosing: round robin over the families until every tier has its share; at most FAMILY_CAP cards per family; in a
// family, lookalike pairs before single cards and cards already in the bank before new ones; enough slots per tier
// (SLOT_TARGET) for a long run that never shows both twins of a pair. Numbers: node scripts/rush-stats.ts.
//
// Writes src/core/rushBank.ts (the cards, committed) and test/rushBankAnswers.ts (their reference proofs and the
// retired ids, kept out of the game). Ids start at 1001 and stay stable across regenerations: a card keeps the id it
// had in the previous rushBank.ts (matched by its renamed code and input); new cards get ids after the largest one
// ever used, so the id of a card that left the bank (RETIRED_IDS) never comes back.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { lex, parseCond } from '../src/core/expr.ts';
import { proveEnds } from '../src/core/game.ts';
import { RUSH_DRAW, rushScene } from '../src/core/rush.ts';
import { overall } from '../src/core/judge.ts';
import { compileLevel, type Level, type Text } from '../src/core/levels.ts';
import { RUSH_BANK } from '../src/core/rushBank.ts';
import { HAND_DEFS, type RushCard, type RushCardDef, type RushVerdict, type Tier } from '../src/core/rushCards.ts';
import { initialState, simulate, startAllowed, SIM_CAP, type State } from '../src/core/sim.ts';
import { RETIRED_IDS } from '../test/rushBankAnswers.ts';
import { canonical, endsTruncated, forbiddenPrograms, gridStarts, loopShape } from '../test/rushCanon.ts';
import { lintCard, lintText } from '../test/rushLint.ts';
import { nodeJudge } from '../test/z3-node.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Z3 frees its objects only when JavaScript collects their wrappers. Thousands of checks in one process can fill
// Z3's 2 GB of memory before a collection comes, so the generator asks for one now and then.
setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;

// ------------------------------------------------------------ targets

/** Cards wanted per tier, hand cards included (about 30 % / 35 % / 35 % of 500). */
const TIER_TARGET: Record<Tier, number> = { 1: 150, 2: 175, 3: 175 };
/**
 * At least this many slots per tier (a slot = a lookalike pair group or a card without a twin): a run never shows
 * both twins of a pair, so a long run of a tier needs this many slots (200 cards ask 94 of tier 3, 80 of tier 2).
 */
const SLOT_TARGET: Record<Tier, number> = { 1: 0, 2: 90, 3: 98 };
/** At most this many cards per family (= per template), hand cards included, so a run sees many kinds of loops. */
const FAMILY_CAP = 25;
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
const wa = (s: string) => `${s}${batchim(s) ? '과' : '와'}`;
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
    // `while (v > c) { v := v - d }` is level 1 with other constants, so no card counts down like that. What stays:
    // the wrong way (`v := v + d` never ends), paired with the same step under `<` (it ends).
    const out: Group[] = [];
    let k = 0;
    for (const c of range(0, 12))
      for (const d of range(1, 5)) {
        const v = V1[k++ % V1.length]!;
        const g = `${v} > ${c}`;
        const gl = `${v} < ${c}`;
        const w = c + 1;
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
        never.why = { ko: `${iga(q(v))} 커지기만 해서 ${iga(q(g))} 계속 참이에요. ${v} = ${w}: ${r}`, en: `${q(v)} only grows, so ${q(g)} stays true. ${v} = ${w}: ${r}` };
        const ends: Cand = {
          family: 'down',
          tier: 1,
          code: loop(gl, [`${v} := ${v} + ${d}`]),
          inputs: [v],
          start: 'true',
          verdict: 'ends',
          why: { ko: `${iga(q(v))} 매번 ${d}씩 커져요. 곧 ${iga(q(gl))} 거짓이 돼요.`, en: `${q(v)} goes up by ${d} every time, so ${q(gl)} soon turns false.` },
          proof: { ends: { V: c ? `${c} - ${v}` : `-${v}` } },
        };
        out.push({ key: `down:${c}:${d}`, cards: [never, ends] });
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
          // `v < c; v := v + d` and its twin come from `down`; the name is still drawn so the names stay as they were
          if (op === '<') continue;
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
          // times 10 would leave the stage's numbers too big: / 10 has no twin
          if (d === 10) {
            out.push({ key: `scale:${op}:${c}:${d}`, cards });
            continue;
          }
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
                why: { ko: `${imyeon(`${v} > ${c}`)} ${eunneun(q(`-${v}`))} 0보다 작아서 한 번에 끝나요.`, en: `For ${v} > ${c}, ${q(`-${v}`)} is below 0, so one round ends it.` },
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
                why: { ko: `${imyeon(`${v2} < ${n(-c)}`)} ${eunneun(q(`-${v2}`))} 0보다 커서 한 번에 끝나요.`, en: `For ${v2} < ${n(-c)}, ${q(`-${v2}`)} is above 0, so one round ends it.` },
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
      for (const dir of ['down', 'up']) {
        const [x, y] = V2[k++ % V2.length]!;
        // `x > c; x := x - y` is levels 16 and 17 (big steps): only the way up stays (the names are drawn as before)
        if (dir === 'down') continue;
        const g = `${x} < ${c}`;
        const code = loop(g, [`${x} := ${x} + ${y}`]);
        const w = c - 1;
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
                  ko: `${y} < 0이면 ${q(x)}${batchim(x) ? '이' : '가'} 오히려 작아져요. ${x} = ${n(w)}, ${y} = −1이면 영원히 돌아요.`,
                  en: `With ${y} < 0, ${q(x)} shrinks instead: ${x} = ${n(w)}, ${y} = −1 runs forever.`,
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
              why: { ko: `입력이 ${ira(strict.replace('>=', '≥'))} ${q(x)}${batchim(x) ? '이' : '가'} 매번 커져요. 곧 ${iga(q(g))} 거짓이 돼요.`, en: `The input is ${strict.replace('>=', '≥')}, so ${q(x)} grows every time and ${q(g)} soon turns false.` },
              proof: { ends: { V: `${c} - ${x}`, R: strict } },
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
    for (const dir of ['up', 'down'])
      for (const b of [1, 2, 3])
        for (const a of [b + 1, b + 2]) {
          const [x, y] = V2[k++ % V2.length]!;
          // `x < y` with both growing is level 5 (moving finish line): only the way down stays (the names are drawn
          // as before)
          if (dir === 'up') continue;
          const g = `${x} > ${y}`;
          const body = (p: number) => [`${x} := ${x} - ${p}`, `${y} := ${y} - ${b}`];
          const twinA = (a + b) % 2 === 0 ? b : Math.max(1, b - 1);
          const gap = `${x} - ${y}`;
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
                why: { ko: `${q(x)}${batchim(x) ? '이' : '가'} 매번 ${a - b}만큼 더 줄어요. 차이 ${iga(q(gap))} 줄어요.`, en: `${q(x)} gains ${a - b} on ${q(y)} every round, so the gap ${q(gap)} shrinks.` },
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
                    ? { ko: `둘 다 ${b}씩 줄면 차이 ${eunneun(q(gap))} 그대로예요.`, en: `Both move by ${b}, so the gap ${q(gap)} never changes.` }
                    : { ko: `${q(y)}${batchim(y) ? '이' : '가'} 더 빨리 줄어서 차이 ${iga(q(gap))} 벌어지기만 해요.`, en: `${q(y)} moves faster, so the gap ${q(gap)} only widens.` },
                proof: { never: { start: { [x]: 1, [y]: 0 }, expect: 'zone', Z: g } },
              },
            ],
          });
        }
    return shuffle(out, seed);
  },

  meet(seed) {
    // Two variables moving toward each other. `x < y` would be level 3 (meet in the middle) with other constants, so
    // the guard is `x != y`: it ends only when the gap is a multiple of the step, which the input can promise. Its
    // twin promises a gap that is a multiple of the step plus one.
    const out: Group[] = [];
    let k = 4;
    for (const a of [1, 2, 3])
      for (const b of [1, 2, 3]) {
        const [x, y] = V2[k++ % V2.length]!;
        const body = [`${x} := ${x} + ${a}`, `${y} := ${y} - ${b}`];
        const s = a + b;
        const code = loop(`${x} != ${y}`, body);
        const promise = (m: number) => `${x} <= ${y} && (${y} - ${x}) % ${m} == 0`;
        const skips: Cand = {
          family: 'meet',
          tier: 3,
          code,
          inputs: [x, y],
          start: 'true',
          verdict: 'never',
          why: { ko: `차이가 ${s}씩 줄어서 ${s}의 배수가 아니면 0을 건너뛰어요. 차이 1: 1, ${n(1 - s)}, ${n(1 - 2 * s)}, …`, en: `The gap drops by ${s}, so unless it is a multiple of ${s} it skips 0. Gap 1: 1, ${n(1 - s)}, ${n(1 - 2 * s)}, …` },
          proof: { never: { start: { [x]: 0, [y]: 1 }, expect: 'zone', Z: `(${y} - ${x}) % ${s} != 0` } },
        };
        out.push({ key: `meet:${a}:${b}`, cards: [skips] });
        out.push({
          key: `meet:promise:${a}:${b}`,
          cards: [
            {
              family: 'meet',
              tier: 3,
              code,
              inputs: [x, y],
              start: promise(s),
              verdict: 'ends',
              why: { ko: `입력에서 ${x} ≤ ${y}, 차이는 ${s}의 배수예요. 차이가 ${s}씩 줄어 꼭 0에 닿아요.`, en: `The input has ${x} ≤ ${y} and a gap that is a multiple of ${s}; it drops by ${s} and lands on 0.` },
              proof: { ends: { V: `${y} - ${x}`, R: promise(s) } },
            },
            {
              family: 'meet',
              tier: 3,
              code,
              inputs: [x, y],
              start: promise(s + 1),
              verdict: 'never',
              why: { ko: `차이가 ${imyeon(String(s + 1))} ${s}씩 줄어 0을 건너뛰어요. 차이 ${s + 1}: ${s + 1}, 1, ${n(1 - s)}, …`, en: `A gap of ${s + 1} drops by ${s} and jumps over 0. Gap ${s + 1}: ${s + 1}, 1, ${n(1 - s)}, …` },
              proof: { never: { start: { [x]: 0, [y]: s + 1 }, expect: 'zone', Z: `(${y} - ${x}) % ${s} != 0` } },
            },
          ],
        });
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
    // `v != c` with `if (v > c) { v := v - 2 } else { v := v + 1 }` was level 6 (toward zero) with other constants.
    // Instead: halve (or divide by m) or take 1, down to 1; the input decides.
    for (const m of [2, 3, 4, 5]) {
      const v = V1[k++ % V1.length]!;
      const code = loop(`${v} != 1`, [`if (${v} % ${m} == 0) { ${v} := ${v} / ${m} }`, `else { ${v} := ${v} - 1 }`]);
      out.push({
        key: `branch:to1:${m}`,
        cards: [
          {
            family: 'branch',
            tier: 3,
            code,
            inputs: [v],
            start: `${v} >= 1`,
            verdict: 'ends',
            why: { ko: `입력이 ${v} ≥ 1이라 ${ro(String(m))} 나누거나 1을 빼도 1 이상이고, 줄다가 1에 닿아요.`, en: `The input is ${v} ≥ 1: dividing by ${m} or taking 1 keeps it at 1 or more, and it shrinks to 1.` },
            proof: { ends: { V: v, R: `${v} >= 1` } },
          },
          { family: 'branch', tier: 3, code, inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = 0이면 ${ira(q(`0 / ${m} = 0`))} 제자리예요.`, en: `From ${v} = 0, ${q(`0 / ${m} = 0`)}: it stays put.` }, proof: { never: { start: { [v]: 0 }, expect: 'cycle' } } },
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
    // the swap without a third variable: a := a + b; b := a - b; a := a - b
    const plusSwap = (a: string, b: string) => [`${a} := ${a} + ${b}`, `${b} := ${a} - ${b}`, `${a} := ${a} - ${b}`];
    // (renamed copies are the same card, so one of each: `>` and `<`, and one with `!=` and its broken twin)
    for (const [i, [a, b]] of V2.filter(([x, y]) => x !== 't' && y !== 't').slice(2, 4).entries()) {
      const flip = i === 0;
      const [lt, le] = flip ? ['>', '>='] : ['<', '<='];
      out.push({
        key: `swap:plus:${a}${b}`,
        cards: [
          {
            family: 'swap',
            tier: 3,
            code: loop(`${a} ${lt} ${b}`, plusSwap(a, b)),
            inputs: [a, b],
            start: 'true',
            verdict: 'ends',
            why: { ko: `세 줄이 ${wa(q(a))} ${eul(q(b))} 맞바꿔요. 바꾸면 ${iga(q(`${a} ${lt} ${b}`))} 거짓이에요.`, en: `The three lines swap ${q(a)} and ${q(b)}; after the swap ${q(`${a} ${lt} ${b}`)} is false.` },
            proof: { ends: { V: flip ? `${a} - ${b}` : `${b} - ${a}` } },
          },
          {
            family: 'swap',
            tier: 3,
            code: loop(`${a} ${le} ${b}`, plusSwap(a, b)),
            inputs: [a, b],
            start: 'true',
            verdict: 'never',
            why: { ko: `${wa(q(a))} ${iga(q(b))} 같으면 맞바꿔도 그대로라 계속 돌아요.`, en: `When ${q(a)} and ${q(b)} are equal, the swap changes nothing, so it keeps going.` },
            proof: { never: { start: { [a]: 1, [b]: 1 }, expect: 'cycle' } },
          },
        ],
      });
      if (i) continue;
      const [p, r] = V2[5]!;
      out.push({
        key: `swap:plusne:${a}${b}`,
        cards: [
          {
            family: 'swap',
            tier: 3,
            code: loop(`${p} != ${r}`, plusSwap(p, r)),
            inputs: [p, r],
            start: 'true',
            verdict: 'never',
            why: { ko: `맞바꿔도 둘은 여전히 달라요. ${p} = 1, ${r} = 0이면 자리만 계속 바꿔요.`, en: `After the swap they still differ: from ${p} = 1, ${r} = 0 they just keep trading places.` },
            proof: { never: { start: { [p]: 1, [r]: 0 }, expect: 'cycle' } },
          },
          {
            family: 'swap',
            tier: 3,
            code: loop(`${p} != ${r}`, [`${p} := ${p} + ${r}`, `${r} := ${p} - ${r}`, `${p} := ${r}`]),
            inputs: [p, r],
            start: 'true',
            verdict: 'ends',
            why: { ko: `바꾸기가 아니에요. 마지막 줄 ${q(`${p} := ${r}`)} 뒤에는 둘이 같아서 한 번에 끝나요.`, en: `Not a swap: after the last line ${q(`${p} := ${r}`)} both are equal, so one round ends it.` },
            proof: { ends: { V: `abs(${p} - ${r})` } },
          },
        ],
      });
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
          { family: 'mirror', tier: 3, code: loop(`${v} < ${c}`, [`${v} := ${dEnd} - ${v}`]), inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${imyeon(`${v} < ${c}`)} ${eunneun(q(`${dEnd} - ${v}`))} ${c}보다 커서 한 번에 끝나요.`, en: `For ${v} < ${c}, ${q(`${dEnd} - ${v}`)} is more than ${c}, so one round ends it.` }, proof: { ends: { V: `${c} - ${v}` } } },
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
      // `v > c; v := d - v` is level 15 (flip) with other constants: not a card (its name is still drawn, so the
      // names of the cards above stay as they were)
      k++;
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
            cards: [{ family: 'fraction', tier: 3, code, inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${imyeon(`${v} > ${c}`)} ${eunneun(q(`${v} / ${d}`))} 1 이상이라 ${q(v)}${batchim(v) ? '이' : '가'} 매번 줄어요.`, en: `For ${v} > ${c}, ${q(`${v} / ${d}`)} is at least 1, so ${q(v)} drops every round.` }, proof: { ends: { V: c ? `${v} - ${c}` : v } } }],
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
              ? { family: 'halfplus', tier: 3, code, inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${imyeon(`${v} > ${c}`)} ${iga(q(`${v} / 2 + ${e}`))} ${v}보다 작아요. 곧 ${c} 이하가 돼요.`, en: `For ${v} > ${c}, ${q(`${v} / 2 + ${e}`)} is less than ${v}, so it soon gets to ${c} or less.` }, proof: { ends: { V: c ? `${v} - ${c}` : v } } }
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

  // ---------------- added 11/3: more kinds of loops (renamed copies are the same card, so every form differs in
  // more than its names)

  clamp(seed) {
    // tier 1: min and max with the loop's own bound. `min(v, c)` under `v > c` ends in one round; `max` keeps v.
    const out: Group[] = [];
    let k = 1;
    for (const c of range(0, 12)) {
      const v = V1[k++ % V1.length]!;
      const above = c % 2 === 0;
      const g = above ? `${v} > ${c}` : `${v} < ${c}`;
      const [good, bad] = above ? ['min', 'max'] : ['max', 'min'];
      const w = above ? c + 1 : c - 1;
      out.push({
        key: `clamp:${above ? '>' : '<'}:${c}`,
        cards: [
          {
            family: 'clamp',
            tier: 1,
            code: loop(g, [`${v} := ${good}(${v}, ${c})`]),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: { ko: `${eunneun(q(`${good}(${v}, ${c})`))} ${c} ${above ? '이하라' : '이상이라'} 한 번 돌면 끝나요.`, en: `${q(`${good}(${v}, ${c})`)} is at ${above ? 'most' : 'least'} ${c}, so one round ends it.` },
            proof: { ends: { V: above ? `${v} - ${c}` : `${c} - ${v}` } },
          },
          {
            family: 'clamp',
            tier: 1,
            code: loop(g, [`${v} := ${bad}(${v}, ${c})`]),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: `${imyeon(`${v} ${above ? '>' : '<'} ${c}`)} ${eunneun(q(`${bad}(${v}, ${c})`))} ${q(v)} 그대로예요. 제자리에서 돌아요.`, en: `For ${v} ${above ? '>' : '<'} ${c}, ${q(`${bad}(${v}, ${c})`)} is just ${q(v)}: it stays put.` },
            proof: { never: { start: { [v]: w }, expect: 'cycle' } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },
  nonneg(seed) {
    // tier 1: abs is never negative. Below 0, one round ends it; abs alone keeps 0 (or 1) where it is, while
    // abs(v) + 1 always climbs.
    const out: Group[] = [];
    let k = 5;
    {
      const v = V1[k++ % V1.length]!;
      out.push({
        key: 'nonneg:0',
        cards: [
          { family: 'nonneg', tier: 1, code: loop(`${v} < 0`, [`${v} := abs(${v})`]), inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${eunneun(q(`abs(${v})`))} 0 이상이라 한 번 돌면 ${iga(q(`${v} < 0`))} 거짓이 돼요.`, en: `${q(`abs(${v})`)} is 0 or more, so after one round ${q(`${v} < 0`)} is false.` }, proof: { ends: { V: `-${v}` } } },
          { family: 'nonneg', tier: 1, code: loop(`${v} < 1`, [`${v} := abs(${v})`]), inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = 0이면 ${ira(q('abs(0) = 0'))} 제자리예요. ${iga(q(`${v} < 1`))} 계속 참이에요.`, en: `From ${v} = 0, ${q('abs(0) = 0')}: it stays put and ${q(`${v} < 1`)} stays true.` }, proof: { never: { start: { [v]: 0 }, expect: 'cycle' } } },
        ],
      });
    }
    for (const c of [3, 6, 10]) {
      const v = V1[k++ % V1.length]!;
      const g = `${v} < ${c}`;
      out.push({
        key: `nonneg:${c}`,
        cards: [
          { family: 'nonneg', tier: 1, code: loop(g, [`${v} := abs(${v}) + 1`]), inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${eunneun(q(`abs(${v}) + 1`))} 늘 ${q(v)}보다 커요. 곧 ${iga(q(g))} 거짓이 돼요.`, en: `${q(`abs(${v}) + 1`)} is always more than ${q(v)}, so ${q(g)} soon turns false.` }, proof: { ends: { V: `${c} - ${v}` } } },
          { family: 'nonneg', tier: 1, code: loop(g, [`${v} := abs(${v})`]), inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = 1이면 ${ira(q('abs(1) = 1'))} 제자리예요. ${iga(q(g))} 계속 참이에요.`, en: `From ${v} = 1, ${q('abs(1) = 1')}: it stays put and ${q(g)} stays true.` }, proof: { never: { start: { [v]: 1 }, expect: 'cycle' } } },
        ],
      });
    }
    return shuffle(out, seed);
  },

  digits(seed) {
    // loops over the digits of a number: / 10 drops the last digit, % 10 is the last digit (and the same in base 2)
    const out: Group[] = [];
    let k = 2;
    const one = () => V1[k++ % V1.length]!;
    const PAIRS: [string, string][] = [
      ['n', 's'],
      ['x', 'd'],
      ['m', 'k'],
      ['a', 'b'],
      ['p', 'q'],
    ];
    for (const base of [10, 2]) {
      const [x, s] = PAIRS[k++ % PAIRS.length]!;
      // the digit sum (or the number of 1 bits) ends; with % in the last line the number never shrinks
      const sum = (last: string) => loop(`${x} > 0`, [`${s} := ${s} + ${x} % ${base}`, `${x} := ${last}`]);
      const w = base === 10 ? 5 : 1;
      out.push({
        key: `digits:sum:${base}`,
        cards: [
          {
            family: 'digits',
            tier: 2,
            code: sum(`${x} / ${base}`),
            inputs: [x, s],
            start: 'true',
            verdict: 'ends',
            why:
              base === 10
                ? { ko: `${eunneun(q(`${x} / 10`))} 끝자리를 지워요. ${iga(q(x))} 매번 줄어서 곧 0이 돼요.`, en: `${q(`${x} / 10`)} drops the last digit, so ${q(x)} shrinks every round and soon reaches 0.` }
                : { ko: `${x} > 0이면 ${eunneun(q(`${x} / 2`))} ${q(x)}보다 작아요. 곧 0이 돼요.`, en: `For ${x} > 0, ${q(`${x} / 2`)} is smaller than ${q(x)}, so it soon reaches 0.` },
            proof: { ends: { V: x } },
          },
          {
            family: 'digits',
            tier: 2,
            code: sum(`${x} % ${base}`),
            inputs: [x, s],
            start: 'true',
            verdict: 'never',
            why: { ko: `${x} = ${imyeon(String(w))} ${ira(q(`${w} % ${base} = ${w}`))} ${iga(q(x))} 그대로예요. ${eunneun(q(s))} 커지기만 해요.`, en: `From ${x} = ${w}, ${q(`${w} % ${base} = ${w}`)}: ${q(x)} never changes; only ${q(s)} grows.` },
            proof: { never: { start: { [x]: w, [s]: 0 }, expect: 'zone', Z: `0 < ${x} && ${x} < ${base}` } },
          },
        ],
      });
      // counting digits: `y != 0` needs y ≥ 0 (a negative y stays negative under Euclidean /, which would depend on
      // how / rounds); the twin keeps the last digit instead of dropping it
      const [y, c] = PAIRS[k++ % PAIRS.length]!;
      const count = (last: string) => loop(`${y} != 0`, [`${c} := ${c} + 1`, `${y} := ${last}`]);
      out.push({
        key: `digits:count:${base}`,
        cards: [
          {
            family: 'digits',
            tier: 2,
            code: count(`${y} / ${base}`),
            inputs: [y, c],
            start: `${y} >= 0`,
            verdict: 'ends',
            why: { ko: `입력이 ${y} ≥ 0이라 ${ro(String(base))} 나눌 때마다 작아져서 0에 닿아요.`, en: `The input is ${y} ≥ 0, so dividing by ${base} shrinks it until it reaches 0.` },
            proof: { ends: { V: y, R: `${y} >= 0` } },
          },
          {
            family: 'digits',
            tier: 2,
            code: count(`${y} % ${base}`),
            inputs: [y, c],
            start: `${y} >= 0`,
            verdict: 'never',
            why: { ko: `${y} = ${imyeon(String(w))} ${ira(q(`${w} % ${base} = ${w}`))} 0이 되지 않아요. ${eunneun(q(c))} 커지기만 해요.`, en: `From ${y} = ${w}, ${q(`${w} % ${base} = ${w}`)}: it never becomes 0, and ${q(c)} only grows.` },
            proof: { never: { start: { [y]: w, [c]: 0 }, expect: 'zone', Z: `0 < ${y} && ${y} < ${base}` } },
          },
        ],
      });
    }
    // strip the trailing zeros (the factors of m): needs a number that is not 0
    for (const m of [10, 2, 3]) {
      const v = one();
      const code = loop(`${v} % ${m} == 0`, [`${v} := ${v} / ${m}`]);
      out.push({
        key: `digits:strip:${m}`,
        cards: [
          {
            family: 'digits',
            tier: 2,
            code,
            inputs: [v],
            start: `${v} >= 1`,
            verdict: 'ends',
            why: { ko: `입력이 ${v} ≥ 1이라 ${ro(String(m))} 나누면 작아지지만 0은 안 돼요. 곧 멈춰요.`, en: `The input is ${v} ≥ 1: dividing by ${m} shrinks it but never makes 0, so it stops.` },
            proof: { ends: { V: v, R: `${v} >= 1` } },
          },
          {
            family: 'digits',
            tier: 2,
            code,
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: `${v} = 0이면 ${eunneun(q(`0 % ${m}`))} 0이고 ${ira(q(`0 / ${m} = 0`))} 제자리예요.`, en: `From ${v} = 0, ${q(`0 % ${m}`)} is 0 and ${q(`0 / ${m} = 0`)}: it stays put.` },
            proof: { never: { start: { [v]: 0 }, expect: 'cycle' } },
          },
        ],
      });
    }
    // add up quotient and remainder until one digit (or one bit) is left
    for (const base of [10, 2]) {
      const v = one();
      const e = `${v} / ${base} + ${v} % ${base}`;
      const w = base === 10 ? 5 : 1;
      out.push({
        key: `digits:root:${base}`,
        cards: [
          {
            family: 'digits',
            tier: 2,
            code: loop(`${v} > ${base - 1}`, [`${v} := ${e}`]),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why:
              base === 10
                ? { ko: `두 자리 이상이면 ${iga(q(e))} ${q(v)}보다 작아요. 곧 한 자리가 돼요.`, en: `With two digits or more, ${q(e)} is less than ${q(v)}; it soon has one digit.` }
                : { ko: `${v} ≥ 2면 ${iga(q(e))} ${q(v)}보다 작아요. 곧 1이 돼요.`, en: `For ${v} ≥ 2, ${q(e)} is less than ${q(v)}, so it soon gets down to 1.` },
            proof: { ends: { V: v } },
          },
          {
            family: 'digits',
            tier: 2,
            code: loop(`${v} > 0`, [`${v} := ${e}`]),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: `${v} = ${imyeon(String(w))} ${ira(q(`${w} / ${base} + ${w} % ${base} = ${w}`))} 제자리예요.`, en: `From ${v} = ${w}, ${q(`${w} / ${base} + ${w} % ${base} = ${w}`)}: it stays put.` },
            proof: { never: { start: { [v]: w }, expect: 'cycle' } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  parity(seed) {
    // odd and even: adding 1 (or 3) changes the parity, adding 2 or multiplying by 3 keeps it
    const out: Group[] = [];
    let k = 4;
    const forms: { g: string; good: string; bad: string; ko: [string, string]; en: [string, string]; w: number; V: string }[] = [
      { g: '% 2 == 1', good: '+ 1', bad: '+ 2', ko: ['홀수에 1을 더하면 짝수예요. 한 번 돌면 끝나요.', '홀수에 2를 더해도 홀수예요.'], en: ['An odd number plus 1 is even, so one round ends it.', 'An odd number plus 2 is still odd.'], w: 1, V: '% 2' },
      { g: '% 2 != 0', good: '+ 3', bad: '* 3', ko: ['홀수에 3을 더하면 짝수예요. 한 번 돌면 끝나요.', '홀수에 3을 곱해도 홀수예요.'], en: ['An odd number plus 3 is even, so one round ends it.', 'An odd number times 3 is still odd.'], w: 1, V: '% 2' },
      { g: '% 2 == 0', good: '- 1', bad: '- 2', ko: ['짝수에서 1을 빼면 홀수예요. 한 번 돌면 끝나요.', '짝수에서 2를 빼도 짝수예요.'], en: ['An even number minus 1 is odd, so one round ends it.', 'An even number minus 2 is still even.'], w: 0, V: '' },
      { g: '% 2 == 0', good: '+ 3', bad: '* 2', ko: ['짝수에 3을 더하면 홀수예요. 한 번 돌면 끝나요.', '짝수에 2를 곱해도 짝수예요.'], en: ['An even number plus 3 is odd, so one round ends it.', 'An even number times 2 is still even.'], w: 2, V: '' },
      { g: '% 2 == 0', good: '+ 1', bad: '+ 2', ko: ['짝수에 1을 더하면 홀수예요. 한 번 돌면 끝나요.', '짝수에 2를 더해도 짝수예요.'], en: ['An even number plus 1 is odd, so one round ends it.', 'An even number plus 2 is still even.'], w: 0, V: '' },
      { g: '% 3 != 0', good: '* 3', bad: '* 2', ko: ['3을 곱하면 3의 배수가 돼서 한 번 돌면 끝나요.', '3의 배수가 아니면 2를 곱해도 아니에요.'], en: ['Times 3 makes a multiple of 3, so one round ends it.', 'Doubling a number that is not a multiple of 3 never makes one.'], w: 1, V: '% 3' },
      { g: '% 2 == 1', good: '* 2', bad: '* 2 + 1', ko: ['홀수에 2를 곱하면 짝수예요. 한 번 돌면 끝나요.', '두 배에 1을 더하면 다시 홀수예요.'], en: ['An odd number times 2 is even, so one round ends it.', 'Twice a number plus 1 is odd again.'], w: 1, V: '% 2' },
    ];
    for (const [i, f] of forms.entries()) {
      const v = V1[k++ % V1.length]!;
      const g = `${v} ${f.g}`;
      const never: Cand = { family: 'parity', tier: 2, code: loop(g, [`${v} := ${v} ${f.bad}`]), inputs: [v], start: 'true', verdict: 'never', why: { ko: '', en: '' }, proof: { never: { start: { [v]: f.w }, expect: 'zone', Z: g } } };
      const r = runText(never, { [v]: f.w }, v);
      never.why = { ko: `${f.ko[1]} ${v} = ${n(f.w)}: ${r}`, en: `${f.en[1]} ${v} = ${n(f.w)}: ${r}` };
      out.push({
        key: `parity:${i}`,
        cards: [
          {
            family: 'parity',
            tier: 2,
            code: loop(g, [`${v} := ${v} ${f.good}`]),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: { ko: f.ko[0], en: f.en[0] },
            proof: { ends: { V: f.V ? `${v} ${f.V}` : `1 - ${v} % 2` } },
          },
          never,
        ],
      });
    }
    // tier 3: divide while it is a multiple of m, with && or || (with ||, 0 keeps the loop going)
    for (const m of [2, 3, 10]) {
      const v = V1[k++ % V1.length]!;
      const body = [`${v} := ${v} / ${m}`];
      out.push({
        key: `parity:andor:${m}`,
        cards: [
          {
            family: 'parity',
            tier: 3,
            code: loop(`${v} % ${m} == 0 && ${v} > 0`, body),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: { ko: `${q('&&')}라서 0 이하면 멈춰요. 양수인 ${m}의 배수는 ${ro(String(m))} 나누면 작아져요.`, en: `With ${q('&&')} it stops at 0 or below, and a positive multiple of ${m} shrinks when divided by ${m}.` },
            proof: { ends: { V: v } },
          },
          {
            family: 'parity',
            tier: 3,
            code: loop(`${v} % ${m} == 0 || ${v} > 0`, body),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: `${q('||')}라서 ${v} = 0에서도 돌아요. ${ira(q(`0 / ${m} = 0`))} 제자리예요.`, en: `With ${q('||')} it also runs at ${v} = 0, and ${q(`0 / ${m} = 0`)}: it stays put.` },
            proof: { never: { start: { [v]: 0 }, expect: 'cycle' } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  gap(seed) {
    // tier 2: one variable walks down to the other; its twin moves the wrong one. (Walking up, `x < y; x := x + d`,
    // is the loop of level 2 with other constants.)
    const out: Group[] = [];
    let k = 1;
    for (const d of range(1, 5))
      for (const op of ['>', '>=']) {
        const [x, y] = V2[k++ % V2.length]!;
        const down = op[0] === '>';
        const g = `${x} ${op} ${y}`;
        const step = (v: string) => `${v} := ${v} ${down ? '-' : '+'} ${d}`;
        const w = op === '>' ? { [x]: 1, [y]: 0 } : op === '<' ? { [x]: 0, [y]: 1 } : { [x]: 0, [y]: 0 };
        out.push({
          key: `gap:${op}:${d}`,
          cards: [
            {
              family: 'gap',
              tier: 2,
              code: loop(g, [step(x)]),
              inputs: [x, y],
              start: 'true',
              verdict: 'ends',
              why: { ko: `${iga(q(x))} ${d}씩 ${down ? '줄어서' : '커져서'} ${q(y)} 쪽으로 가요. 곧 ${iga(q(g))} 거짓이 돼요.`, en: `${q(x)} moves toward ${q(y)} by ${d} each round, so ${q(g)} soon turns false.` },
              proof: { ends: { V: down ? `${x} - ${y}` : `${y} - ${x}` } },
            },
            {
              family: 'gap',
              tier: 2,
              code: loop(g, [step(y)]),
              inputs: [x, y],
              start: 'true',
              verdict: 'never',
              why: { ko: `움직이는 건 ${ieyo(q(y))}. ${q(x)}에서 멀어지기만 해서 ${iga(q(g))} 계속 참이에요.`, en: `Only ${q(y)} moves, and away from ${q(x)}, so ${q(g)} stays true.` },
              proof: { never: { start: w, expect: 'zone', Z: g } },
            },
          ],
        });
      }
    // doubling up to y, halving down to y: the input decides
    {
      const [x, y] = V2[k++ % V2.length]!;
      const code = loop(`${x} < ${y}`, [`${x} := ${x} * 2`]);
      out.push({
        key: 'gap:double',
        cards: [
          { family: 'gap', tier: 2, code, inputs: [x, y], start: `${x} >= 1`, verdict: 'ends', why: { ko: `입력이 ${x} ≥ 1이라 ${iga(q(x))} 매번 두 배가 돼요. 곧 ${q(y)} 이상이 돼요.`, en: `The input is ${x} ≥ 1, so ${q(x)} doubles every round and soon reaches ${q(y)}.` }, proof: { ends: { V: `${y} - ${x}`, R: `${x} >= 1` } } },
          { family: 'gap', tier: 2, code, inputs: [x, y], start: `${x} >= 0`, verdict: 'never', why: { ko: `${x} = 0이면 ${ira(q('0 * 2 = 0'))} 제자리예요. ${y} = 1이면 영원히 돌아요.`, en: `From ${x} = 0, ${q('0 * 2 = 0')}: with ${y} = 1 it never stops.` }, proof: { never: { start: { [x]: 0, [y]: 1 }, expect: 'cycle' } } },
        ],
      });
      const [p, r] = V2[k++ % V2.length]!;
      const half = loop(`${p} > ${r}`, [`${p} := ${p} / 2`]);
      out.push({
        key: 'gap:half',
        cards: [
          { family: 'gap', tier: 2, code: half, inputs: [p, r], start: `${r} >= 0`, verdict: 'ends', why: { ko: `입력이 ${r} ≥ 0이라 ${eunneun(q(p))} 양수예요. 반씩 줄다가 곧 ${q(r)} 이하가 돼요.`, en: `The input is ${r} ≥ 0, so ${q(p)} is positive and halving brings it down to ${q(r)}.` }, proof: { ends: { V: `${p} - ${r}`, R: `${r} >= 0` } } },
          { family: 'gap', tier: 2, code: half, inputs: [p, r], start: 'true', verdict: 'never', why: { ko: `${p} = 0, ${r} = −1이면 ${ira(q('0 / 2 = 0'))} 제자리예요.`, en: `From ${p} = 0, ${r} = −1, ${q('0 / 2 = 0')}: it stays put.` }, proof: { never: { start: { [p]: 0, [r]: -1 }, expect: 'cycle' } } },
        ],
      });
    }
    return shuffle(out, seed);
  },

  accum(seed) {
    // a sum that grows by a step that itself grows (or shrinks)
    const out: Group[] = [];
    let k = 2;
    const PAIRS: [string, string][] = [
      ['s', 'i'],
      ['t', 'k'],
      ['x', 'd'],
      ['a', 'b'],
      ['m', 'j'],
      ['y', 'n'],
    ];
    for (const c of [5, 8, 10, 12, 15, 20])
      for (const form of ['add', 'inc', 'sub', 'dbl'] as const) {
        const [s, i] = PAIRS[k++ % PAIRS.length]!;
        if (form === 'dbl') {
          const code = loop(`${s} < ${c}`, [`${s} := ${s} + ${i}`, `${i} := ${i} * 2`]);
          out.push({
            key: `accum:dbl:${c}`,
            cards: [
              { family: 'accum', tier: 2, code, inputs: [s, i], start: `${i} >= 1`, verdict: 'ends', why: { ko: `입력이 ${i} ≥ 1이라 ${iga(q(s))} 매번 1 이상 커져요. 곧 ${c} 이상이 돼요.`, en: `The input is ${i} ≥ 1, so ${q(s)} grows by at least 1 each round and soon reaches ${c}.` }, proof: { ends: { V: `${c} - ${s}`, R: `${i} >= 1` } } },
              { family: 'accum', tier: 2, code, inputs: [s, i], start: `${i} >= 0`, verdict: 'never', why: { ko: `${i} = 0이면 ${ira(q('0 * 2 = 0'))} ${iga(q(s))} 그대로예요.`, en: `With ${i} = 0, ${q('0 * 2 = 0')}: ${q(s)} never moves.` }, proof: { never: { start: { [s]: 0, [i]: 0 }, expect: 'cycle' } } },
            ],
          });
          continue;
        }
        const up = form !== 'sub';
        const g = up ? `${s} < ${c}` : `${s} > ${c}`;
        const use = up ? `${s} := ${s} + ${i}` : `${s} := ${s} - ${i}`;
        const body = (dir: '+' | '-') => (form === 'inc' ? [`${i} := ${i} ${dir} 1`, use] : [use, `${i} := ${i} ${dir} 1`]);
        const firstLeft = form === 'inc' ? `max(0, -${i})` : `max(0, 1 - ${i})`;
        const ws = up ? 0 : c + 1;
        out.push({
          key: `accum:${form}:${c}`,
          cards: [
            {
              family: 'accum',
              tier: 2,
              code: loop(g, body('+')),
              inputs: [s, i],
              start: 'true',
              verdict: 'ends',
              why: { ko: `${iga(q(i))} 1씩 커져서 언젠가 양수가 돼요. 그 뒤로 ${iga(q(s))} 매번 ${up ? '커져요' : '줄어요'}.`, en: `${q(i)} goes up by 1, so it turns positive; from then on ${q(s)} ${up ? 'grows' : 'drops'} every round.` },
              proof: { ends: { V: `(${firstLeft}, ${up ? `${c} - ${s}` : `${s} - ${c}`})` } },
            },
            {
              family: 'accum',
              tier: 2,
              code: loop(g, body('-')),
              inputs: [s, i],
              start: 'true',
              verdict: 'never',
              why: { ko: `${iga(q(i))} 계속 줄어서 ${iga(q(s))} ${up ? '커지지' : '줄지'} 못해요. ${s} = ${ws}, ${i} = 0이면 영원히 돌아요.`, en: `${q(i)} keeps shrinking, so ${q(s)} never ${up ? 'grows' : 'drops'}: ${s} = ${ws}, ${i} = 0 runs forever.` },
              proof: { never: { start: { [s]: ws, [i]: 0 }, expect: 'zone', Z: `${g} && ${i} <= 0` } },
            },
          ],
        });
      }
    // tier 3: three variables (the step, how fast it grows, or the factor tells the forms apart)
    const TRIPLES: [string, string, string][] = [
      ['s', 'n', 'k'],
      ['t', 'm', 'i'],
      ['a', 'b', 'd'],
    ];
    for (const [j, [s, nn, i]] of TRIPLES.entries()) {
      const d = j + 1;
      out.push({
        key: `accum:3:grow:${d}`,
        cards: [
          { family: 'accum', tier: 3, code: loop(`${s} < ${nn}`, [`${s} := ${s} + ${i}`, `${i} := ${i} + ${d}`]), inputs: [s, nn, i], start: 'true', verdict: 'ends', why: { ko: `${iga(q(i))} ${d}씩 커져서 언젠가 양수가 돼요. 그 뒤로 ${iga(q(s))} 매번 커져요.`, en: `${q(i)} goes up by ${d}, so it turns positive; from then on ${q(s)} grows every round.` }, proof: { ends: { V: `(max(0, 1 - ${i}), ${nn} - ${s})` } } },
          { family: 'accum', tier: 3, code: loop(`${s} < ${nn}`, [`${s} := ${s} + ${i}`, `${i} := ${i} - ${d}`]), inputs: [s, nn, i], start: 'true', verdict: 'never', why: { ko: `${iga(q(i))} 계속 줄어서 ${iga(q(s))} 커지지 못해요. ${s} = 0, ${nn} = 1, ${i} = 0이면 영원히 돌아요.`, en: `${q(i)} keeps shrinking, so ${q(s)} never grows: ${s} = 0, ${nn} = 1, ${i} = 0 runs forever.` }, proof: { never: { start: { [s]: 0, [nn]: 1, [i]: 0 }, expect: 'zone', Z: `${s} < ${nn} && ${i} <= 0` } } },
        ],
      });
      // i counts up to n while s adds up the i's; the twin feeds the sum back into i
      out.push({
        key: `accum:3:feed:${d}`,
        cards: [
          { family: 'accum', tier: 3, code: loop(`${i} < ${nn}`, [`${s} := ${s} + ${i}`, `${i} := ${i} + ${d}`]), inputs: [s, nn, i], start: 'true', verdict: 'ends', why: { ko: `${iga(q(i))} ${d}씩 커져서 곧 ${q(nn)}에 닿아요. ${eunneun(q(s))} 끝나는 것과 상관없어요.`, en: `${q(i)} goes up by ${d} and soon reaches ${q(nn)}; ${q(s)} has nothing to do with stopping.` }, proof: { ends: { V: `${nn} - ${i}` } } },
          { family: 'accum', tier: 3, code: loop(`${i} < ${nn}`, [`${s} := ${s} + ${i}`, `${i} := ${s} + ${d}`]), inputs: [s, nn, i], start: 'true', verdict: 'never', why: { ko: `${s} = −5, ${i} = 0, ${nn} = 1이면 ${iga(q(i))} 늘 음수라 ${q(nn)}에 닿지 못해요.`, en: `From ${s} = −5, ${i} = 0, ${nn} = 1, ${q(i)} stays negative and never reaches ${q(nn)}.` }, proof: { never: { start: { [s]: -5, [nn]: 1, [i]: 0 }, expect: 'zone', Z: `${s} <= ${-d - 1} && ${i} <= 0 && ${nn} >= 1` } } },
        ],
      });
      // multiply s until it reaches n, counting the rounds in i
      const f = [2, 3, 10][j]!;
      const code = loop(`${s} < ${nn}`, [`${s} := ${s} * ${f}`, `${i} := ${i} + 1`]);
      out.push({
        key: `accum:3:pow:${f}`,
        cards: [
          { family: 'accum', tier: 3, code, inputs: [s, nn, i], start: `${s} >= 1`, verdict: 'ends', why: { ko: `입력이 ${s} ≥ 1이라 ${iga(q(s))} 매번 ${f}배가 돼요. 곧 ${q(nn)} 이상이 돼요.`, en: `The input is ${s} ≥ 1, so ${q(s)} grows ${f} times bigger each round and soon reaches ${q(nn)}.` }, proof: { ends: { V: `${nn} - ${s}`, R: `${s} >= 1` } } },
          { family: 'accum', tier: 3, code, inputs: [s, nn, i], start: `${s} >= 0`, verdict: 'never', why: { ko: `${s} = 0이면 ${ira(q(`0 * ${f} = 0`))} ${iga(q(s))} 그대로예요. ${nn} = 1이면 영원히 돌아요.`, en: `From ${s} = 0, ${q(`0 * ${f} = 0`)}: ${q(s)} never moves, so ${nn} = 1 runs forever.` }, proof: { never: { start: { [s]: 0, [nn]: 1, [i]: 0 }, expect: 'zone', Z: `${s} == 0 && ${nn} >= 1` } } },
        ],
      });
    }
    return shuffle(out, seed);
  },

  rotate(seed) {
    // three variables passed round with a spare t: (a, b, c) becomes (b, c, a)
    const out: Group[] = [];
    const TRIPLES: [string, string, string][] = [
      ['a', 'b', 'c'],
      ['x', 'y', 'z'],
      ['p', 'q', 'r'],
      ['i', 'j', 'k'],
    ];
    /** [x < y] as 0 or 1 */
    const lt = (x: string, y: string) => `min(1, max(0, ${y} - ${x}))`;
    // which variable a comparison looks at after one round (the value of a moves to c, of b to a, of c to b)
    const back = (v: 0 | 1 | 2): 0 | 1 | 2 => ((v + 1) % 3) as 0 | 1 | 2;
    const orders: [0 | 1 | 2, 0 | 1 | 2][] = [
      [0, 1],
      [1, 0],
      [0, 2],
      [2, 0],
      [1, 2],
      [2, 1],
    ];
    for (const [j, [P, Q]] of orders.entries()) {
      const names = TRIPLES[j % TRIPLES.length]!;
      const [a, b, c] = names;
      const at = (v: 0 | 1 | 2) => names[v]!;
      const rot = [`t := ${a}`, `${a} := ${b}`, `${b} := ${c}`, `${c} := t`];
      // `x < y` written with the first variable on the left: a < b, a > b (= b < a), …
      const left = Math.min(P, Q) as 0 | 1 | 2;
      const right = Math.max(P, Q) as 0 | 1 | 2;
      const op = P < Q ? '<' : '>';
      const g = `${at(left)} ${op} ${at(right)}`;
      const loose = `${at(left)} ${op}= ${at(right)}`;
      const show = (p: 0 | 1 | 2, q2: 0 | 1 | 2) => (p < q2 ? `${at(p)} < ${at(q2)}` : `${at(q2)} > ${at(p)}`);
      const [P2, Q2] = [back(P), back(Q)];
      const [P3, Q3] = [back(P2), back(Q2)];
      const V = `${lt(at(P), at(Q))} + min(max(0, ${at(Q)} - ${at(P)}), ${lt(at(P2), at(Q2))})`;
      out.push({
        key: `rotate:${P}${Q}`,
        cards: [
          { family: 'rotate', tier: 3, code: loop(g, rot), inputs: [a, b, c], start: 'true', verdict: 'ends', why: { ko: `처음 값으로 치면 ${q(g)}, ${q(show(P2, Q2))}, ${eul(q(show(P3, Q3)))} 차례로 물어요. 셋 다 참일 수는 없어요.`, en: `In the starting values the rounds ask ${q(g)}, then ${q(show(P2, Q2))}, then ${q(show(P3, Q3))}: never all three.` }, proof: { ends: { V } } },
          { family: 'rotate', tier: 3, code: loop(loose, rot), inputs: [a, b, c], start: 'true', verdict: 'never', why: { ko: `셋이 같으면 돌려도 그대로라 ${iga(q(loose))} 계속 참이에요.`, en: `If all three are equal, rotating changes nothing and ${q(loose)} stays true.` }, proof: { never: { start: { [a]: 1, [b]: 1, [c]: 1 }, expect: 'cycle' } } },
        ],
      });
    }
    // without t it is not a rotation: c gets the new a, which is b
    const [a, b, c] = TRIPLES[1]!;
    out.push({
      key: 'rotate:not',
      cards: [
        { family: 'rotate', tier: 3, code: loop(`${a} != ${c}`, [`${a} := ${b}`, `${b} := ${c}`, `${c} := ${a}`]), inputs: [a, b, c], start: 'true', verdict: 'ends', why: { ko: `돌리기가 아니에요. 한 번 돌면 ${wa(q(a))} ${q(c)} 둘 다 ${b} 값이 돼서 끝나요.`, en: `Not a rotation: after one round ${q(a)} and ${q(c)} both hold ${b}’s value, so it ends.` }, proof: { ends: { V: `abs(${a} - ${c})` } } },
        { family: 'rotate', tier: 3, code: loop(`${a} != ${c}`, [`t := ${a}`, `${a} := ${b}`, `${b} := ${c}`, `${c} := t`]), inputs: [a, b, c], start: 'true', verdict: 'never', why: { ko: `${q('t')}로 제대로 돌려서 세 값이 계속 돌아요. ${a} = 1, ${b} = 2, ${c} = 3이면 영원히 돌아요.`, en: `With ${q('t')} it really rotates, so the values keep cycling: ${a} = 1, ${b} = 2, ${c} = 3 runs forever.` }, proof: { never: { start: { [a]: 1, [b]: 2, [c]: 3 }, expect: 'cycle' } } },
      ],
    });
    return shuffle(out, seed);
  },

  toward(seed) {
    // two variables: the smaller one goes up (or the bigger one comes down) until they meet
    const out: Group[] = [];
    let k = 3;
    for (const up of [true, false]) {
      const [x, y] = V2[k++ % V2.length]!;
      const cond = up ? `${x} < ${y}` : `${x} > ${y}`;
      const s = up ? '+' : '-';
      const mk = (thenS: string, elseS: string) => loop(`${x} != ${y}`, [`if (${cond}) { ${thenS} }`, `else { ${elseS} }`]);
      out.push({
        key: `toward:${up ? 'up' : 'down'}`,
        cards: [
          { family: 'toward', tier: 3, code: mk(`${x} := ${x} ${s} 1`, `${y} := ${y} ${s} 1`), inputs: [x, y], start: 'true', verdict: 'ends', why: { ko: `${up ? '작은' : '큰'} 쪽이 1씩 ${up ? '커져서' : '줄어서'} 차이가 매번 1씩 줄어요. 곧 둘이 같아져요.`, en: `The ${up ? 'smaller' : 'bigger'} one moves by 1, so the gap shrinks by 1 every round until they meet.` }, proof: { ends: { V: `abs(${x} - ${y})` } } },
          {
            family: 'toward',
            tier: 3,
            code: mk(`${x} := ${x} ${s} 1`, `${y} := ${y} ${up ? '-' : '+'} 1`),
            inputs: [x, y],
            start: 'true',
            verdict: 'never',
            why: { ko: `${iga(q(y))} ${up ? '작으면' : '크면'} ${iga(q(y))} 더 ${up ? '작아져서' : '커져서'} 멀어지기만 해요. ${x} = ${up ? 1 : 0}, ${y} = ${up ? 0 : 1}이면 영원히 돌아요.`, en: `If ${q(y)} is the ${up ? 'smaller' : 'bigger'} one it moves further away: ${x} = ${up ? 1 : 0}, ${y} = ${up ? 0 : 1} runs forever.` },
            proof: { never: { start: up ? { [x]: 1, [y]: 0 } : { [x]: 0, [y]: 1 }, expect: 'zone', Z: up ? `${x} > ${y}` : `${x} < ${y}` } },
          },
          {
            family: 'toward',
            tier: 3,
            code: mk(`${x} := ${x} ${s} 2`, `${y} := ${y} ${s} 2`),
            inputs: [x, y],
            start: 'true',
            verdict: 'never',
            why: { ko: `2씩 움직이면 차이가 홀수일 때 0을 건너뛰어요. ${x} = 0, ${y} = 1이면 영원히 돌아요.`, en: `Moving by 2, an odd gap jumps over 0: ${x} = 0, ${y} = 1 runs forever.` },
            proof: { never: { start: { [x]: 0, [y]: 1 }, expect: 'zone', Z: `(${x} - ${y}) % 2 == 1` } },
          },
        ],
      });
      const [p, r] = V2[k++ % V2.length]!;
      const cond3 = up ? `${p} < ${r}` : `${p} > ${r}`;
      out.push({
        key: `toward:${up ? 'up' : 'down'}:3`,
        cards: [
          {
            family: 'toward',
            tier: 3,
            code: loop(`${p} != ${r}`, [`if (${cond3}) { ${p} := ${p} ${s} 3 }`, `else { ${r} := ${r} ${s} 3 }`]),
            inputs: [p, r],
            start: 'true',
            verdict: 'never',
            why: { ko: `3씩 움직이면 차이가 3의 배수가 아닐 때 0을 건너뛰어요. ${p} = 0, ${r} = 1이면 영원히 돌아요.`, en: `Moving by 3, a gap that is not a multiple of 3 jumps over 0: ${p} = 0, ${r} = 1 runs forever.` },
            proof: { never: { start: { [p]: 0, [r]: 1 }, expect: 'zone', Z: `(${p} - ${r}) % 3 != 0` } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },

  stepif(seed) {
    // big steps while far away, small steps near the end
    const out: Group[] = [];
    let k = 6;
    for (const c of range(2, 6)) {
      const v = V1[k++ % V1.length]!;
      const mk = (e: string) => loop(`${v} > 0`, [`if (${v} > ${c}) { ${v} := ${v} - ${c} }`, `else { ${v} := ${e} }`]);
      const r = runText({ code: mk(`${v} + 1`), inputs: [v], start: 'true', verdict: 'never' }, { [v]: 1 }, v, 3);
      out.push({
        key: `stepif:down:${c}`,
        cards: [
          { family: 'stepif', tier: 3, code: mk(`${v} - 1`), inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${c}보다 크면 ${c}씩, 아니면 1씩 줄어요. 어느 쪽이든 ${iga(q(v))} 줄어요.`, en: `Above ${c} it drops by ${c}, otherwise by 1: either way ${q(v)} shrinks.` }, proof: { ends: { V: v } } },
          { family: 'stepif', tier: 3, code: mk(`${v} + 1`), inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = 1이면 ${c + 1}까지 커졌다가 다시 1로 떨어져요: ${r}`, en: `From ${v} = 1 it climbs to ${c + 1} and falls back to 1: ${r}` }, proof: { never: { start: { [v]: 1 }, expect: 'cycle' } } },
        ],
      });
    }
    for (const [t, c, d] of [
      [20, 10, 5],
      [12, 6, 3],
      [15, 9, 4],
      [10, 4, 3],
      [16, 8, 2],
    ] as [number, number, number][]) {
      const v = V1[k++ % V1.length]!;
      const mk = (e: string) => loop(`${v} < ${t}`, [`if (${v} < ${c}) { ${v} := ${v} + ${d} }`, `else { ${v} := ${e} }`]);
      const r = runText({ code: mk(`${v} - 1`), inputs: [v], start: 'true', verdict: 'never' }, { [v]: c }, v, 4);
      out.push({
        key: `stepif:up:${t}:${c}`,
        cards: [
          { family: 'stepif', tier: 3, code: mk(`${v} + 1`), inputs: [v], start: 'true', verdict: 'ends', why: { ko: `${c}보다 작으면 ${d}씩, 아니면 1씩 커져요. 곧 ${t}에 닿아요.`, en: `Below ${c} it goes up by ${d}, otherwise by 1, so it soon reaches ${t}.` }, proof: { ends: { V: `${t} - ${v}` } } },
          { family: 'stepif', tier: 3, code: mk(`${v} - 1`), inputs: [v], start: 'true', verdict: 'never', why: { ko: `${v} = ${imyeon(String(c))} 1 줄었다가 ${d} 커지기를 되풀이해요: ${r}`, en: `From ${v} = ${c} it keeps dropping by 1 and jumping up by ${d}: ${r}` }, proof: { never: { start: { [v]: c }, expect: 'cycle' } } },
        ],
      });
    }
    return shuffle(out, seed);
  },

  wrap(seed) {
    // a counter that wraps around: from m it goes back to 0 (or from 0 back to m)
    const out: Group[] = [];
    let k = 8;
    for (const m of range(3, 9)) {
      const v = V1[k++ % V1.length]!;
      const cIn = Math.floor(m / 2);
      const cOut = m + 1 + (m % 3);
      const up = m % 2 === 1;
      const mk = (c: number, test: string) =>
        up ? loop(`${v} != ${c}`, [`if (${v} ${test} ${m}) { ${v} := 0 }`, `else { ${v} := ${v} + 1 }`]) : loop(`${v} != ${c}`, [`if (${v} ${test} 0) { ${v} := ${m} }`, `else { ${v} := ${v} - 1 }`]);
      const big = up ? '>=' : '<=';
      const w = up ? m + 1 : -1;
      out.push({
        key: `wrap:${m}`,
        cards: [
          {
            family: 'wrap',
            tier: 3,
            code: mk(cIn, big),
            inputs: [v],
            start: 'true',
            verdict: 'ends',
            why: up
              ? { ko: `${m} 이상이면 0으로 돌아가고 아니면 1씩 커져요. 곧 ${cIn}에 닿아요.`, en: `At ${m} or more it wraps to 0, otherwise it goes up by 1, so it soon hits ${cIn}.` }
              : { ko: `0 이하면 ${ro(String(m))} 돌아가고 아니면 1씩 줄어요. 곧 ${cIn}에 닿아요.`, en: `At 0 or less it wraps to ${m}, otherwise it goes down by 1, so it soon hits ${cIn}.` },
            proof: { ends: { V: up ? `(min(1, max(0, ${v} - ${cIn})), max(0, ${m + 1} - ${v}))` : `(min(1, max(0, ${cIn} - ${v})), max(0, ${v} + 1))` } },
          },
          {
            family: 'wrap',
            tier: 3,
            code: mk(cOut, big),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: { ko: `한 번 돌아가면 0~${m}만 돌아서 ${cOut}에 닿지 못해요.`, en: `Once it wraps it only goes round 0 to ${m}, so it never reaches ${cOut}.` },
            proof: { never: { start: { [v]: 0 }, expect: 'cycle' } },
          },
          {
            family: 'wrap',
            tier: 3,
            code: mk(cIn, '=='),
            inputs: [v],
            start: 'true',
            verdict: 'never',
            why: up
              ? { ko: `${v} = ${imyeon(String(w))} ${iga(q(`${v} == ${m}`))} 거짓이라 1씩 커지기만 해요.`, en: `From ${v} = ${w}, ${q(`${v} == ${m}`)} is false, so it only goes up.` }
              : { ko: `${v} = −1이면 ${iga(q(`${v} == 0`))} 거짓이라 1씩 줄기만 해요.`, en: `From ${v} = −1, ${q(`${v} == 0`)} is false, so it only goes down.` },
            proof: { never: { start: { [v]: w }, expect: 'zone', Z: up ? `${v} > ${m}` : `${v} < 0` } },
          },
        ],
      });
    }
    return shuffle(out, seed);
  },
};

// ------------------------------------------------------------ checks

const FORBIDDEN = forbiddenPrograms();
/** The loop shapes of the levels and tutorial programs: no card may have one (other names and constants included). */
const FORBIDDEN_SHAPE = new Map(FORBIDDEN.map(([name, c]) => [loopShape(c), name]));
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

/** A card as the game compiles it (for the stage after the answer). */
function asCard(c: Cand, l: Level, samples: Record<string, number>[]): RushCard {
  const lv = compileLevel({ id: l.id, title: l.title, code: c.code, inputs: c.inputs, start: c.start, facts: 'true', kind: c.verdict, samples });
  return { ...lv, tier: c.tier, family: c.family, verdict: c.verdict, why: c.why };
}

/** What the tests check beyond the proof: a "never" card refutes the plain guesses; an "ends" card's stage. */
async function testProblem(judge: Awaited<ReturnType<typeof nodeJudge>>['judge'], c: Cand, card: RushCard): Promise<string | null> {
  if (c.verdict === 'never') {
    for (const v of card.vars) {
      const o = await proveEnds(judge, card, v, '');
      if (o.type === 'ends' && o.result !== 'refuted') return `steps left = ${v} is ${o.result}, not refuted`;
    }
    if (simulate(card, initialState(card, Object.fromEntries(card.inputs.map((v) => [v, BigInt(card.samples[0]![v] ?? 0)]))), 300).outcome === 'exit') return 'the walker’s sample ends';
  }
  const sc = rushScene(card);
  if (c.verdict === 'ends') {
    if (sc.k !== 'stairs') return `the stage is a ${sc.k}`;
    const enters = gridStarts(card).some((st) => simulate(card, st, 1).states.length > 1);
    const steps = sc.stairs.length - 1;
    if (steps > 12 || steps < (enters ? 1 : 0)) return `${steps} steps on the stage`;
  } else if (sc.k !== 'ring' && sc.k !== 'shaft') return `the stage is a ${sc.k}`;
  return null;
}

/** Edit distance between two token lists (as in the tests: the cards of a pair differ in a few tokens). */
function distance(a: string[], b: string[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}
const tokensOf = (c: { code: string; start: string }) => [...lex(c.code), ...lex(c.start)].filter((t) => t.t !== 'end').map((t) => t.s);

/** A lookalike pair: every "ends" and "never" card differ in 1–6 tokens, and the proof of the one that ends is refuted on the other. */
async function pairProblem(judge: Awaited<ReturnType<typeof nodeJudge>>['judge'], cards: { c: Cand; card: RushCard }[]): Promise<string | null> {
  for (const a of cards.filter((x) => x.c.verdict === 'ends'))
    for (const b of cards.filter((x) => x.c.verdict === 'never')) {
      const d = distance(tokensOf(a.c), tokensOf(b.c));
      if (d < 1 || d > 6) return `twins differ by ${d} tokens`;
      if (a.card.vars.join() !== b.card.vars.join()) continue;
      const ref = (a.c.proof as Extract<Proof, { ends: unknown }>).ends;
      const o = await proveEnds(judge, b.card, ref.V, ref.R ?? '');
      if (o.type !== 'ends' || o.result !== 'refuted') return `the twin's proof ${ref.V} is not refuted on the never card`;
    }
  return null;
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
  // --all: check every candidate of every family (no caps, no tier targets) and write nothing
  const all = process.argv.includes('--all');
  const taken = new Set<string>(HAND_DEFS.map(keyOf));
  const prevIds = new Map(RUSH_BANK.map((d) => [keyOf(d), d.id]));
  // never reuse an id: not one in the bank now, not one that left it
  let nextId = Math.max(1000, ...RUSH_BANK.map((d) => d.id), ...RETIRED_IDS) + 1;
  const handTier: Record<Tier, number> = { 1: 0, 2: 0, 3: 0 };
  for (const d of HAND_DEFS) handTier[d.tier]++;
  const handFamily = new Map<string, number>();
  for (const d of HAND_DEFS) handFamily.set(d.family, (handFamily.get(d.family) ?? 0) + 1);

  // within a family: lookalike pairs before single cards, and in each, the groups already in the bank (they keep
  // their ids) before the new ones
  const prevFamily = new Map(RUSH_BANK.map((d) => [keyOf(d), d.family]));
  const known = (g: Group) => g.cards.some((c) => prevFamily.get(keyOf(c)) === c.family);
  const isPair = (g: Group) => new Set(g.cards.map((c) => c.verdict)).size === 2;
  const rank = (g: Group) => (isPair(g) ? 0 : 2) + (known(g) ? 0 : 1);
  // each family's shuffle seed comes from its place in this list (the families of 10/2025 first, in their old order,
  // so that their cards keep coming in the same order and keep their names; net and neq are gone)
  const SEED_ORDER = ['down', 'up', 'scale', 'const', 'net', 'flip', 'neq', 'noentry', 'halve', 'double', 'mod', 'absval', 'guardvar', 'stride', 'sqgrow', 'modclock', 'chase', 'meet', 'reset', 'branch', 'swap', 'andor', 'mirror', 'fraction', 'halfplus', 'minmax', 'product'];
  for (const name of Object.keys(FAMILIES)) if (!SEED_ORDER.includes(name)) SEED_ORDER.push(name);
  const queues = Object.entries(FAMILIES).map(([name, f]) => {
    const groups = f(1000 + SEED_ORDER.indexOf(name) * 7919);
    return { name, groups: [0, 1, 2, 3].flatMap((r) => groups.filter((g) => rank(g) === r)) };
  });
  const perFamily = new Map<string, number>(handFamily);
  const perTier: Record<Tier, number> = { ...handTier };
  const perSlots: Record<Tier, number> = { 1: 0, 2: 0, 3: 0 };
  for (const t of [1, 2, 3] as Tier[]) perSlots[t] = new Set(HAND_DEFS.filter((d) => d.tier === t).map((d) => d.pair ?? `card ${d.id}`)).size;
  const out: Out[] = [];
  const dropped = new Map<string, number>();
  const drop = (why: string, c: Cand) => {
    const k = `${c.family}: ${why.replace(/\(.*$/, '').slice(0, 60)}`;
    dropped.set(k, (dropped.get(k) ?? 0) + 1);
    if (verbose) console.log('drop', c.family, why, JSON.stringify(c.code));
  };

  // round robin over the families, one group at a time, until every tier has its share
  let progress = true;
  let checkedGroups = 0;
  while (progress) {
    progress = false;
    for (const qd of queues) {
      while (qd.groups.length) {
        const g = qd.groups.shift()!;
        const tier = g.cards[0]!.tier;
        if (!all && perTier[tier] >= TIER_TARGET[tier]) continue;
        if (!all && (perFamily.get(qd.name) ?? 0) + g.cards.length > FAMILY_CAP) continue;
        const accepted: (Out & { c: Cand; card: RushCard })[] = [];
        if (++checkedGroups % 20 === 0) collect();
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
          const level = FORBIDDEN_SHAPE.get(loopShape(c.code));
          if (level) {
            drop(`the loop of ${level}`, c);
            continue;
          }
          const lint = lintCard(c.code, c.start);
          if (lint.length) {
            drop(`clumsy: ${lintText(lint)}`, c);
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
          const card = asCard(c, l, samples);
          const tp = await testProblem(z.judge, c, card);
          if (tp) {
            drop(tp, c);
            continue;
          }
          accepted.push({
            key,
            proof: c.proof,
            c,
            card,
            def: { id: 0, tier: c.tier, family: c.family, code: c.code, inputs: c.inputs, start: c.start, verdict: c.verdict, why: c.why, samples },
          });
        }
        if (!accepted.length) continue;
        if (!all && perTier[tier] + accepted.length > TIER_TARGET[tier]) continue;
        let paired = new Set(accepted.map((a) => a.def.verdict)).size === 2;
        if (paired) {
          const pp = await pairProblem(z.judge, accepted);
          if (pp) {
            dropped.set(`${qd.name}: not a pair: ${pp.slice(0, 50)}`, (dropped.get(`${qd.name}: not a pair: ${pp.slice(0, 50)}`) ?? 0) + 1);
            if (verbose) console.log('unpaired', g.key, pp);
            paired = false;
          }
        }
        // keep enough cards of the tier for the slots still missing (each later card may have to be a single)
        const slots = paired ? 1 : accepted.length;
        if (!all && TIER_TARGET[tier] - perTier[tier] - accepted.length < SLOT_TARGET[tier] - perSlots[tier] - slots) continue;
        for (const a of accepted) {
          if (paired) a.def.pair = g.key;
          taken.add(a.key);
          out.push({ def: a.def, proof: a.proof, key: a.key });
        }
        perFamily.set(qd.name, (perFamily.get(qd.name) ?? 0) + accepted.length);
        perTier[tier] += accepted.length;
        perSlots[tier] += slots;
        progress = true;
        break;
      }
    }
  }
  await z.close();
  if (all) {
    const fam = new Map<string, number[]>();
    for (const o of out) {
      const f = fam.get(o.def.family) ?? [0, 0, 0, 0];
      f[o.def.tier - 1]!++;
      if (o.def.pair) f[3]!++;
      fam.set(o.def.family, f);
    }
    console.log(`every candidate: ${out.length} pass the checks`);
    for (const [name, f] of [...fam].sort()) console.log(`  ${name.padEnd(9)} ${String(f[0]! + f[1]! + f[2]!).padStart(3)}  tiers ${f.slice(0, 3).join('/')}  in pairs ${f[3]}`);
    console.log('dropped:');
    for (const [k, v] of [...dropped].sort()) console.log(`  ${v} × ${k}`);
    return;
  }

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
  const kept = new Set(out.map((o) => o.def.id));
  const retired = [...new Set([...RETIRED_IDS, ...RUSH_BANK.map((d) => d.id).filter((id) => !kept.has(id))])].sort((a, b) => a - b);
  writeFileSync(
    join(root, 'test/rushBankAnswers.ts'),
    `// Generated by scripts/gen-rush-cards.ts: the reference proofs of the generated rush cards (kept out of the game).
// ends: steps left V (and a railing R where the input matters); never: an allowed start that repeats a state
// (cycle), or a start and a bottomless zone Z.
import type { RushProof } from './rushAnswers.ts';

export const BANK_ANSWERS: Record<number, RushProof> = {
${out.map(ansLine).join('\n')}
};

/** Ids of cards that left the bank (generated or by hand): never given to a new card. */
export const RETIRED_IDS: number[] = ${lit(retired)};
`,
  );

  // ---------------- report
  const total = HAND_DEFS.length + out.length;
  console.log(`cards: ${total} (${HAND_DEFS.length} by hand + ${out.length} generated)`);
  for (const t of [1, 2, 3] as Tier[]) console.log(`tier ${t}: ${perTier[t]} (${((100 * perTier[t]) / total).toFixed(1)} %), ${perSlots[t]} slots`);
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
