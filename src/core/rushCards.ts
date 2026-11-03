// The cards of the rush mode: short loops to judge in 5 seconds (SPEC_rush, SPEC_rush2). New loops only: none is a
// level or a renamed copy of one, because rush shows the right verdict after every card. Verdicts are proved in
// the tests with the real judge or by simulation; the reference proofs live in test/rushAnswers.ts and
// test/rushBankAnswers.ts, never in the game.
//
// The 36 hand-written cards (ids 201–236) are below; the generated bank (ids 1001 and up) is in rushBank.ts,
// written by scripts/gen-rush-cards.ts.
// Tier 1: obvious. Tier 2: one trap. Tier 3: lookalike pairs and loops with two variables or more lines.
// Cards with the same `pair` look alike, differ in one small thing, and get different verdicts.
// `family` names the kind of loop; a run never shows two cards of a family within three positions.

import { compileLevel, type Level, type Text } from './levels.ts';
import { RUSH_BANK } from './rushBank.ts';

export type RushVerdict = 'ends' | 'never';
export type Tier = 1 | 2 | 3;

export interface RushCardDef {
  /** 201–236 by hand, 1001 and up generated: never the id of a level or a tutorial program. */
  id: number;
  tier: Tier;
  family: string;
  pair?: string;
  code: string;
  inputs: string[];
  /** Start condition on the inputs ('true' = any integers). The facts are always 'true'. */
  start: string;
  startText?: string;
  verdict: RushVerdict;
  /** One line on why, shown after the answer. `code` in backticks. */
  why: Text;
  /** Start states; the first one is what the walker runs on the stage after the answer. */
  samples: Record<string, number>[];
}

export interface RushCard extends Level {
  tier: Tier;
  family: string;
  pair?: string;
  verdict: RushVerdict;
  why: Text;
}

export const HAND_DEFS: RushCardDef[] = [
  // ------------------------------------------------------------ tier 1: obvious
  {
    id: 201,
    tier: 1,
    family: 'down',
    pair: 'step3',
    code: `while (x > 0) {
  x := x - 3
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '`x`가 매번 3씩 줄어요. 곧 0 이하가 돼서 멈춰요.', en: '`x` drops by 3 every time, so it soon reaches 0 or less.' },
    samples: [{ x: 7 }, { x: 0 }],
  },
  {
    id: 202,
    tier: 1,
    family: 'down',
    pair: 'step3',
    code: `while (x > 0) {
  x := x + 3
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: '`x`가 커지기만 해서 `x > 0`이 계속 참이에요. x = 1: 1, 4, 7, …', en: '`x` only grows, so `x > 0` stays true. x = 1: 1, 4, 7, …' },
    samples: [{ x: 1 }, { x: 0 }],
  },
  {
    id: 203,
    tier: 1,
    family: 'up',
    pair: 'to10',
    code: `while (k < 10) {
  k := k + 1
}`,
    inputs: ['k'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '`k`가 1씩 커져서 10에 닿아요. 남은 계단 수는 `10 - k`예요.', en: '`k` goes up by 1 until it reaches 10. The steps left are `10 - k`.' },
    samples: [{ k: 6 }, { k: 12 }],
  },
  {
    id: 204,
    tier: 1,
    family: 'up',
    pair: 'to10',
    code: `while (k < 10) {
  k := k - 1
}`,
    inputs: ['k'],
    start: 'true',
    verdict: 'never',
    why: { ko: '`k`가 작아지기만 해서 `k < 10`이 계속 참이에요. k = 9: 9, 8, 7, …', en: '`k` only shrinks, so `k < 10` stays true. k = 9: 9, 8, 7, …' },
    samples: [{ k: 9 }, { k: 10 }],
  },
  {
    id: 205,
    tier: 1,
    family: 'scale',
    code: `while (n >= 10) {
  n := n / 10
}`,
    inputs: ['n'],
    start: 'true',
    verdict: 'ends',
    why: { ko: 'n ≥ 10이면 `n / 10`이 `n`보다 작아요. 자릿수가 하나씩 줄어요.', en: 'For n ≥ 10, `n / 10` is smaller than `n`: one digit fewer each time.' },
    samples: [{ n: 4321 }, { n: 7 }],
  },
  {
    id: 206,
    tier: 1,
    family: 'guardvar',
    code: `while (n > 0) {
  m := m + 1
}`,
    inputs: ['n', 'm'],
    start: 'true',
    verdict: 'never',
    why: { ko: '반복 안에서 `n`이 바뀌지 않아서 `n > 0`이 계속 참이에요.', en: 'Nothing in the loop changes `n`, so `n > 0` stays true.' },
    samples: [
      { n: 1, m: 0 },
      { n: 0, m: 5 },
    ],
  },
  {
    id: 207,
    tier: 1,
    family: 'scale',
    code: `while (x != 0) {
  x := x * 2
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: '0이 아닌 수는 두 배 해도 0이 아니에요. x = 1: 1, 2, 4, …', en: 'Doubling a number that is not 0 never gives 0. x = 1: 1, 2, 4, …' },
    samples: [{ x: 1 }, { x: 0 }],
  },
  {
    id: 208,
    tier: 1,
    family: 'guardvar',
    pair: 'guardvar',
    code: `while (a > 0) {
  a := a - 1
  b := b + 1
}`,
    inputs: ['a', 'b'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '`a`가 매번 1씩 줄어요. `b`는 끝나는 것과 상관없어요.', en: '`a` drops by 1 every time; `b` has nothing to do with stopping.' },
    samples: [
      { a: 3, b: 0 },
      { a: 0, b: 2 },
    ],
  },
  {
    id: 209,
    tier: 1,
    family: 'guardvar',
    pair: 'guardvar',
    code: `while (b > 0) {
  a := a - 1
  b := b + 1
}`,
    inputs: ['a', 'b'],
    start: 'true',
    verdict: 'never',
    why: { ko: '조건은 `b`를 보는데 `b`는 커지기만 해요. b = 1: 1, 2, 3, …', en: 'The condition checks `b`, and `b` only grows. b = 1: 1, 2, 3, …' },
    samples: [
      { a: 3, b: 1 },
      { a: 3, b: 0 },
    ],
  },

  // ------------------------------------------------------------ tier 2: one trap
  {
    id: 210,
    tier: 2,
    family: 'neq',
    pair: 'down1',
    code: `while (x != 0) {
  x := x - 1
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: '`x`가 음수면 0에서 멀어지기만 해요. x = −1: −1, −2, −3, …', en: 'A negative `x` only moves away from 0. x = −1: −1, −2, −3, …' },
    samples: [{ x: -1 }, { x: 3 }, { x: 0 }],
  },
  {
    id: 211,
    tier: 2,
    family: 'neq',
    pair: 'down1',
    code: `while (x != 0) {
  x := x - 1
}`,
    inputs: ['x'],
    start: 'x >= 0',
    verdict: 'ends',
    why: { ko: 'x ≥ 0에서 1씩 내려가면 꼭 0에 닿아요. 남은 계단 수는 `x`예요.', en: 'From x ≥ 0, going down by 1 always lands on 0. The steps left are `x`.' },
    samples: [{ x: 4 }, { x: 0 }],
  },
  {
    id: 212,
    tier: 2,
    family: 'neq',
    pair: 'by2',
    code: `while (x != 10) {
  x := x + 2
}`,
    inputs: ['x'],
    start: 'x <= 10',
    verdict: 'never',
    why: { ko: '`x`가 홀수면 10을 건너뛰어요. x = 9: 9, 11, 13, …', en: 'An odd `x` jumps over 10. x = 9: 9, 11, 13, …' },
    samples: [{ x: 9 }, { x: 6 }, { x: 10 }],
  },
  {
    id: 213,
    tier: 2,
    family: 'up',
    pair: 'by2',
    code: `while (x < 10) {
  x := x + 2
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '`x`가 2씩 커지다가 10 이상이 되면 멈춰요. 10을 건너뛰어도 괜찮아요.', en: '`x` goes up by 2 and stops once it is 10 or more; skipping 10 is fine.' },
    samples: [{ x: 5 }, { x: 10 }],
  },
  {
    id: 214,
    tier: 2,
    family: 'mod',
    pair: 'mod7',
    code: `while (x > 0) {
  x := x % 7
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: 'x가 1~6이면 `x % 7`은 x 그대로예요. x = 3: 3, 3, 3, …', en: 'For x from 1 to 6, `x % 7` is just x. x = 3: 3, 3, 3, …' },
    samples: [{ x: 3 }, { x: 0 }],
  },
  {
    id: 215,
    tier: 2,
    family: 'mod',
    pair: 'mod7',
    code: `while (x > 6) {
  x := x % 7
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '`x % 7`은 0~6이라 한 번 돌면 `x > 6`이 거짓이 돼요.', en: '`x % 7` is between 0 and 6, so after one step `x > 6` is false.' },
    samples: [{ x: 20 }, { x: 4 }],
  },
  {
    id: 216,
    tier: 2,
    family: 'halve',
    pair: 'half',
    code: `while (x > 0) {
  x := x / 2
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'ends',
    why: { ko: 'x > 0이면 `x / 2`가 `x`보다 작아요. 결국 0이 돼요.', en: 'For x > 0, `x / 2` is smaller than `x`; it ends at 0.' },
    samples: [{ x: 12 }, { x: -3 }],
  },
  {
    id: 217,
    tier: 2,
    family: 'halve',
    pair: 'half',
    code: `while (x != 1) {
  x := x / 2
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: 'x = 0이면 `0 / 2 = 0`이라 1에 닿지 못해요.', en: 'From x = 0, `0 / 2 = 0`: `x` never reaches 1.' },
    samples: [{ x: 0 }, { x: 12 }],
  },
  {
    id: 218,
    tier: 2,
    family: 'mod',
    pair: 'mod3',
    code: `while (x % 3 != 0) {
  x := x + 3
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: '3을 더해도 3으로 나눈 나머지는 그대로예요. x = 1: 1, 4, 7, …', en: 'Adding 3 keeps the remainder mod 3. x = 1: 1, 4, 7, …' },
    samples: [{ x: 1 }, { x: 6 }],
  },
  {
    id: 219,
    tier: 2,
    family: 'mod',
    pair: 'mod3',
    code: `while (x % 3 != 0) {
  x := x + 1
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '1씩 더하면 두 번 안에 3의 배수가 돼요.', en: 'Adding 1, `x` becomes a multiple of 3 within two steps.' },
    samples: [{ x: 7 }, { x: 9 }],
  },
  {
    id: 220,
    tier: 2,
    family: 'sqgrow',
    pair: 'sq50',
    code: `while (x * x < 50) {
  x := x + 1
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '`x * x < 50`이면 x는 −7~7이에요. 1씩 커지다 8에서 멈춰요.', en: '`x * x < 50` means x is between −7 and 7; going up by 1, it stops at 8.' },
    samples: [{ x: 4 }, { x: 9 }],
  },
  {
    id: 221,
    tier: 2,
    family: 'sqgrow',
    pair: 'sq50',
    code: `while (x * x < 50) {
  x := -x
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: '부호만 바뀌어서 `x * x`는 그대로예요. x = 3: 3, −3, 3, …', en: 'Only the sign flips, so `x * x` stays the same. x = 3: 3, −3, 3, …' },
    samples: [{ x: 3 }, { x: 8 }],
  },

  // ------------------------------------------------------------ tier 3: lookalike pairs, two variables
  {
    id: 222,
    tier: 3,
    family: 'swap',
    pair: 'swap',
    code: `while (a > b) {
  t := a
  a := b
  b := t
}`,
    inputs: ['a', 'b'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '한 번 바꾸면 a < b가 돼서 바로 끝나요.', en: 'One swap makes a < b, so it stops right away.' },
    samples: [
      { a: 5, b: 2 },
      { a: 1, b: 4 },
    ],
  },
  {
    id: 223,
    tier: 3,
    family: 'swap',
    pair: 'swap',
    code: `while (a != b) {
  t := a
  a := b
  b := t
}`,
    inputs: ['a', 'b'],
    start: 'true',
    verdict: 'never',
    why: {
      ko: '바꿔도 `a`와 `b`는 여전히 달라요. a = 1, b = 0이면 자리만 계속 바꿔요.',
      en: 'After a swap `a` and `b` still differ: from a = 1, b = 0 they just keep trading places.',
    },
    samples: [
      { a: 1, b: 0 },
      { a: 2, b: 2 },
    ],
  },
  {
    id: 224,
    tier: 3,
    family: 'swap',
    pair: 'swap',
    code: `while (a != b) {
  a := b
  b := a
}`,
    inputs: ['a', 'b'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '바꾸기가 아니에요. `a := b` 뒤에는 둘 다 b 값이라 한 번에 끝나요.', en: 'Not a swap: after `a := b` both hold b’s value, so one step ends it.' },
    samples: [
      { a: 1, b: 0 },
      { a: 2, b: 2 },
    ],
  },
  {
    id: 225,
    tier: 3,
    family: 'sqgrow',
    pair: 'square',
    code: `while (x < 100) {
  x := x * x
}`,
    inputs: ['x'],
    start: 'x >= 2',
    verdict: 'ends',
    why: { ko: 'x ≥ 2면 `x * x`가 x보다 커요. 2, 4, 16, 256으로 100을 넘어요.', en: 'For x ≥ 2, `x * x` is bigger than x: 2, 4, 16, 256 passes 100.' },
    samples: [{ x: 2 }, { x: 150 }],
  },
  {
    id: 226,
    tier: 3,
    family: 'sqgrow',
    pair: 'square',
    code: `while (x < 100) {
  x := x * x
}`,
    inputs: ['x'],
    start: 'x >= 1',
    verdict: 'never',
    why: { ko: 'x = 1이면 `1 * 1 = 1`이라 제자리예요.', en: 'From x = 1, `1 * 1 = 1`: it stays put.' },
    samples: [{ x: 1 }, { x: 3 }],
  },
  {
    id: 227,
    tier: 3,
    family: 'stride',
    pair: 'stride',
    code: `while (s < t) {
  s := s + d
}`,
    inputs: ['s', 't', 'd'],
    start: 'd >= 1',
    verdict: 'ends',
    why: { ko: 'd ≥ 1이라 `s`가 매번 커져요. 남은 계단 수 `t - s`가 줄어요.', en: 'With d ≥ 1, `s` grows every time; the steps left `t - s` go down.' },
    samples: [
      { s: 0, t: 7, d: 2 },
      { s: 5, t: 1, d: 1 },
    ],
  },
  {
    id: 228,
    tier: 3,
    family: 'stride',
    pair: 'stride',
    code: `while (s < t) {
  s := s + d
}`,
    inputs: ['s', 't', 'd'],
    start: 'd >= 0',
    verdict: 'never',
    why: { ko: 'd = 0이면 `s`가 그대로예요. s = 0, t = 1, d = 0이면 영원히 돌아요.', en: 'With d = 0, `s` never moves: s = 0, t = 1, d = 0 runs forever.' },
    samples: [
      { s: 0, t: 1, d: 0 },
      { s: 0, t: 7, d: 2 },
    ],
  },
  {
    id: 229,
    tier: 3,
    family: 'chase',
    pair: 'chase',
    code: `while (x < y) {
  x := x + 2
  y := y + 1
}`,
    inputs: ['x', 'y'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '`x`가 `y`보다 1씩 더 빨라요. 차이 `y - x`가 매번 1씩 줄어요.', en: '`x` gains 1 on `y` every time: the gap `y - x` shrinks by 1.' },
    samples: [
      { x: 0, y: 4 },
      { x: 3, y: 1 },
    ],
  },
  {
    id: 230,
    tier: 3,
    family: 'chase',
    pair: 'chase',
    code: `while (x < y) {
  x := x + 1
  y := y + 1
}`,
    inputs: ['x', 'y'],
    start: 'true',
    verdict: 'never',
    why: { ko: '둘 다 1씩 커지면 차이 `y - x`는 그대로예요.', en: 'Both go up by 1, so the gap `y - x` never changes.' },
    samples: [
      { x: 0, y: 1 },
      { x: 2, y: 2 },
    ],
  },
  {
    id: 231,
    tier: 3,
    family: 'andor',
    pair: 'andor',
    code: `while (x > 0 && y > 0) {
  x := x - 1
  y := y + 1
}`,
    inputs: ['x', 'y'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '`&&`라서 `x`가 0이 되면 끝나요. `x`는 매번 1씩 줄어요.', en: 'With `&&` the loop stops once `x` hits 0, and `x` drops by 1 each time.' },
    samples: [
      { x: 3, y: 1 },
      { x: 0, y: 4 },
    ],
  },
  {
    id: 232,
    tier: 3,
    family: 'andor',
    pair: 'andor',
    code: `while (x > 0 || y > 0) {
  x := x - 1
  y := y + 1
}`,
    inputs: ['x', 'y'],
    start: 'true',
    verdict: 'never',
    why: { ko: '`||`라서 `y > 0`만으로도 계속 돌아요. `y`는 커지기만 해요.', en: 'With `||`, `y > 0` alone keeps it going, and `y` only grows.' },
    samples: [
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ],
  },
  {
    id: 233,
    tier: 3,
    family: 'reset',
    pair: 'reset',
    code: `while (x != 3) {
  if (x > 3) { x := x - 1 }
  else { x := 10 }
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'ends',
    why: { ko: '3보다 작으면 10으로 갔다가 1씩 내려와 3에 닿아요.', en: 'Below 3 it jumps to 10, then comes down by 1 and lands on 3.' },
    samples: [{ x: 1 }, { x: 6 }, { x: 3 }],
  },
  {
    id: 234,
    tier: 3,
    family: 'reset',
    pair: 'reset',
    code: `while (x != 3) {
  if (x > 3) { x := x - 1 }
  else { x := 0 }
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: '3보다 작으면 0으로 가는데, 0에서는 계속 0이에요.', en: 'Below 3 it goes to 0, and from 0 it stays at 0.' },
    samples: [{ x: 1 }, { x: 6 }],
  },
  {
    id: 235,
    tier: 3,
    family: 'mirror',
    pair: 'mirror',
    code: `while (x < 10) {
  x := 10 - x
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'never',
    why: { ko: 'x = 3이면 7, 다시 3이에요. 10에 닿지 못하고 왔다 갔다 해요.', en: 'x = 3 goes to 7 and back to 3; it never gets to 10.' },
    samples: [{ x: 3 }, { x: 0 }],
  },
  {
    id: 236,
    tier: 3,
    family: 'mirror',
    pair: 'mirror',
    code: `while (x < 10) {
  x := 20 - x
}`,
    inputs: ['x'],
    start: 'true',
    verdict: 'ends',
    why: { ko: 'x < 10이면 `20 - x`는 10보다 커서 한 번에 끝나요.', en: 'For x < 10, `20 - x` is more than 10, so one step ends it.' },
    samples: [{ x: 3 }, { x: 12 }],
  },
];

function compileCard(def: RushCardDef): RushCard {
  const level = compileLevel({
    id: def.id,
    title: { ko: `러시 카드 ${def.id}`, en: `Rush card ${def.id}` },
    code: def.code,
    inputs: def.inputs,
    start: def.start,
    startText: def.startText,
    facts: 'true',
    kind: def.verdict,
    samples: def.samples,
  });
  return { ...level, tier: def.tier, family: def.family, pair: def.pair, verdict: def.verdict, why: def.why };
}

/** Every card: the hand-written ones, then the generated bank. */
export const RUSH_DEFS: RushCardDef[] = [...HAND_DEFS, ...RUSH_BANK];

export const RUSH_CARDS: RushCard[] = RUSH_DEFS.map(compileCard);

const BY_ID = new Map(RUSH_CARDS.map((c) => [c.id, c]));

export function rushCardById(id: number): RushCard {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`no rush card ${id}`);
  return c;
}

export function hasRushCard(id: number): boolean {
  return BY_ID.has(id);
}
