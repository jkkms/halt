// The 18 levels of the campaign (fixed by the spec; answers live in test/answers.ts, not here).

import { parseRaw, varsOf, type Expr } from './expr.ts';
import { assignedVars, branches, localReadBeforeWrite, parseProgram, readVars, type Branch, type Program } from './program.ts';

export type Kind = 'ends' | 'never' | 'open';
export type Lang = 'en' | 'ko';
export type Text = Record<Lang, string>;

export interface LevelDef {
  id: number;
  title: Text;
  note?: Text;
  code: string;
  inputs: string[];
  /** Precondition on the inputs, in the expression language ('true' = any integers). */
  start: string;
  /** Loop-head facts the level states as known ('true' = none). */
  facts: string;
  /** Display text for start / facts (math notation). Defaults to the expression. */
  startText?: string;
  factsText?: string;
  kind: Kind;
  par?: number;
  /**
   * Start states for the drawings (3–4). Wherever the start condition allows it, one of them makes the
   * loop condition false right away: the loop runs zero times (checked before every step, even the first).
   */
  samples: Record<string, number>[];
}

export interface Level extends LevelDef {
  prog: Program;
  /** Variables of the state at the loop head: inputs, then initialized variables. */
  vars: string[];
  /** Variables that only live inside one iteration (assigned before read), e.g. mid, r. */
  locals: string[];
  initVars: string[];
  startExpr: Expr;
  factsExpr: Expr;
  branches: Branch[];
}

export const RAILING_FROM = 9;
export const TUPLES_FROM = 10;

const DEFS: LevelDef[] = [
  {
    id: 1,
    title: { en: 'Countdown', ko: '카운트다운' },
    code: `while (n > 0) {
  n := n - 1
}`,
    inputs: ['n'],
    start: 'true',
    facts: 'true',
    kind: 'ends',
    par: 1,
    samples: [{ n: 5 }, { n: 3 }, { n: 1 }, { n: 0 }],
  },
  {
    id: 2,
    title: { en: 'Counting up', ko: '올려 세기' },
    code: `i := 0
while (i < n) {
  i := i + 1
}`,
    inputs: ['n'],
    start: 'true',
    facts: 'true',
    kind: 'ends',
    par: 3,
    samples: [{ n: 4 }, { n: 2 }, { n: 0 }, { n: -3 }],
  },
  {
    id: 3,
    title: { en: 'Meet in the middle', ko: '가운데서 만나기' },
    code: `while (lo < hi) {
  lo := lo + 1
  hi := hi - 1
}`,
    inputs: ['lo', 'hi'],
    start: 'true',
    facts: 'true',
    kind: 'ends',
    par: 5,
    samples: [
      { lo: 0, hi: 6 },
      { lo: -6, hi: -1 },
      { lo: 2, hi: 3 },
      { lo: 4, hi: 1 },
    ],
  },
  {
    id: 4,
    title: { en: 'Binary search', ko: '이진 탐색' },
    code: `while (lo < hi) {
  mid := (lo + hi) / 2
  if (mid < t) {
    lo := mid + 1
  } else {
    hi := mid
  }
}`,
    inputs: ['lo', 'hi', 't'],
    start: 'true',
    facts: 'true',
    kind: 'ends',
    par: 5,
    samples: [
      { lo: 0, hi: 8, t: 5 },
      { lo: 0, hi: 8, t: 0 },
      { lo: -5, hi: 3, t: 1 },
      { lo: 3, hi: 3, t: 0 },
    ],
  },
  {
    id: 5,
    title: { en: 'Moving finish line', ko: '도망가는 결승선' },
    code: `i := 0
while (i < n) {
  i := i + 1
  n := n + 1
}`,
    inputs: ['n'],
    start: 'n >= 1',
    facts: 'true',
    kind: 'never',
    samples: [{ n: 1 }, { n: 2 }, { n: 4 }],
  },
  {
    id: 6,
    title: { en: 'Toward zero', ko: '0을 향해' },
    code: `while (x != 0) {
  if (x > 0) {
    x := x - 1
  } else {
    x := x + 1
  }
}`,
    inputs: ['x'],
    start: 'true',
    facts: 'true',
    kind: 'ends',
    par: 6,
    samples: [{ x: 4 }, { x: -3 }, { x: 0 }],
  },
  {
    id: 7,
    title: { en: 'Subtraction GCD', ko: '뺄셈 최대공약수' },
    code: `while (a != b) {
  if (a > b) {
    a := a - b
  } else {
    b := b - a
  }
}`,
    inputs: ['a', 'b'],
    start: 'a >= 1 && b >= 1',
    startText: 'a ≥ 1, b ≥ 1',
    facts: 'a >= 1 && b >= 1',
    factsText: 'a ≥ 1, b ≥ 1',
    kind: 'ends',
    par: 3,
    samples: [
      { a: 12, b: 8 },
      { a: 5, b: 3 },
      { a: 2, b: 9 },
      { a: 7, b: 7 },
    ],
  },
  {
    id: 8,
    title: { en: 'Skipping zero', ko: '0 건너뛰기' },
    code: `while (x != 0) {
  x := x - 2
}`,
    inputs: ['x'],
    start: 'true',
    facts: 'true',
    kind: 'never',
    samples: [{ x: 4 }, { x: 1 }, { x: -3 }, { x: 0 }],
  },
  {
    id: 9,
    title: { en: 'Counting up to n', ko: 'n까지 올려 세기' },
    code: `i := 0
while (i != n) {
  i := i + 1
}`,
    inputs: ['n'],
    start: 'n >= 0',
    facts: 'true',
    kind: 'ends',
    par: 7,
    samples: [{ n: 3 }, { n: 5 }, { n: 0 }],
  },
  {
    id: 10,
    title: { en: 'Clock', ko: '시계' },
    code: `while (x > 0) {
  if (y > 0) {
    y := y - 1
  } else {
    x := x - 1
    y := 59
  }
}`,
    inputs: ['x', 'y'],
    start: 'y >= 0',
    facts: 'y >= 0',
    kind: 'ends',
    par: 5,
    samples: [
      { x: 1, y: 3 },
      { x: 2, y: 0 },
      { x: 0, y: 5 },
    ],
  },
  {
    id: 11,
    title: { en: 'Clock with m minutes', ko: 'm분 시계' },
    code: `while (x > 0) {
  if (y > 0) {
    y := y - 1
  } else {
    x := x - 1
    y := m
  }
}`,
    inputs: ['x', 'y', 'm'],
    start: '0 <= y && y <= m',
    startText: '0 ≤ y ≤ m',
    facts: '0 <= y && y <= m',
    factsText: '0 ≤ y ≤ m',
    kind: 'ends',
    par: 5,
    samples: [
      { x: 2, y: 1, m: 3 },
      { x: 1, y: 2, m: 2 },
      { x: 3, y: 0, m: 1 },
      { x: 0, y: 2, m: 3 },
    ],
  },
  {
    id: 12,
    title: { en: 'Off by one', ko: '하나 차이' },
    note: { en: 'the classic off-by-one', ko: '흔한 하나 차이 실수' },
    code: `while (lo < hi) {
  mid := (lo + hi) / 2
  if (mid < t) {
    lo := mid
  } else {
    hi := mid
  }
}`,
    inputs: ['lo', 'hi', 't'],
    start: 'true',
    facts: 'true',
    kind: 'never',
    samples: [
      { lo: 0, hi: 8, t: 0 },
      { lo: 0, hi: 8, t: 5 },
      { lo: -3, hi: 4, t: 9 },
      { lo: 2, hi: 2, t: 0 },
    ],
  },
  {
    id: 13,
    title: { en: 'Odometer', ko: '주행 거리계' },
    note: { en: 'four digits, counting down', ko: '네 자리 숫자를 거꾸로 셈' },
    code: `while (a > 0 || b > 0 || c > 0 || d > 0) {
  if (d > 0) {
    d := d - 1
  } else if (c > 0) {
    c := c - 1; d := 9
  } else if (b > 0) {
    b := b - 1; c := 9; d := 9
  } else {
    a := a - 1; b := 9; c := 9; d := 9
  }
}`,
    inputs: ['a', 'b', 'c', 'd'],
    start: '0 <= a && a <= 9 && 0 <= b && b <= 9 && 0 <= c && c <= 9 && 0 <= d && d <= 9',
    startText: '0 ≤ a, b, c, d ≤ 9',
    facts: '0 <= a && a <= 9 && 0 <= b && b <= 9 && 0 <= c && c <= 9 && 0 <= d && d <= 9',
    factsText: '0 ≤ a, b, c, d ≤ 9',
    kind: 'ends',
    par: 9,
    samples: [
      { a: 0, b: 0, c: 1, d: 2 },
      { a: 0, b: 0, c: 3, d: 0 },
      { a: 0, b: 1, c: 0, d: 0 },
      { a: 0, b: 0, c: 0, d: 0 },
    ],
  },
  {
    id: 14,
    title: { en: 'Euclid', ko: '유클리드 호제법' },
    code: `while (b > 0) {
  r := a % b
  a := b
  b := r
}`,
    inputs: ['a', 'b'],
    start: 'a >= 0 && b >= 0',
    startText: 'a ≥ 0, b ≥ 0',
    facts: 'a >= 0 && b >= 0',
    factsText: 'a ≥ 0, b ≥ 0',
    kind: 'ends',
    par: 1,
    samples: [
      { a: 12, b: 8 },
      { a: 5, b: 13 },
      { a: 21, b: 34 },
      { a: 7, b: 0 },
    ],
  },
  {
    id: 15,
    title: { en: 'Flip', ko: '뒤집기' },
    code: `while (x > 0) {
  x := 1 - x
}`,
    inputs: ['x'],
    start: 'true',
    facts: 'true',
    kind: 'ends',
    par: 1,
    samples: [{ x: 3 }, { x: 1 }, { x: -2 }],
  },
  {
    id: 16,
    title: { en: 'Big steps', ko: '큰 걸음' },
    code: `while (x > 0) {
  x := x - y
}`,
    inputs: ['x', 'y'],
    start: 'y >= 1',
    facts: 'y >= 1',
    kind: 'ends',
    par: 1,
    samples: [
      { x: 7, y: 2 },
      { x: 5, y: 5 },
      { x: 4, y: 1 },
      { x: -1, y: 2 },
    ],
  },
  {
    id: 17,
    title: { en: 'Big steps, any y', ko: '아무 y로 큰 걸음' },
    code: `while (x > 0) {
  x := x - y
}`,
    inputs: ['x', 'y'],
    start: 'true',
    facts: 'true',
    kind: 'never',
    samples: [
      { x: 7, y: 2 },
      { x: 3, y: 0 },
      { x: 2, y: -1 },
      { x: 0, y: 3 },
    ],
  },
  {
    id: 18,
    title: { en: 'Collatz', ko: '콜라츠' },
    code: `while (n > 1) {
  if (n % 2 == 0) {
    n := n / 2
  } else {
    n := 3 * n + 1
  }
}`,
    inputs: ['n'],
    start: 'n >= 1',
    facts: 'true',
    kind: 'open',
    samples: [{ n: 6 }, { n: 7 }, { n: 27 }, { n: 1 }],
  },
];

export function compileLevel(def: LevelDef): Level {
  const prog = parseProgram(def.code);
  const initVars = [...assignedVars(prog.init)].filter((v) => !def.inputs.includes(v));
  const vars = [...def.inputs, ...initVars];
  const bodyAssigned = assignedVars(prog.body);
  const locals = [...bodyAssigned].filter((v) => !vars.includes(v));
  const bad = localReadBeforeWrite(prog.body, locals);
  if (bad) throw new Error(`level ${def.id}: ${bad} is read before it is written`);
  const known = new Set([...vars, ...locals]);
  for (const v of [...varsOf(prog.guard), ...readVars(prog.body), ...readVars(prog.init)]) {
    if (!known.has(v)) throw new Error(`level ${def.id}: unknown variable ${v}`);
  }
  for (const v of varsOf(prog.guard)) if (locals.includes(v)) throw new Error(`level ${def.id}: guard reads local ${v}`);
  const startExpr = parseRaw(def.start);
  const factsExpr = parseRaw(def.facts);
  for (const v of varsOf(startExpr)) if (!def.inputs.includes(v)) throw new Error(`level ${def.id}: start uses ${v}`);
  for (const v of varsOf(factsExpr)) if (!vars.includes(v)) throw new Error(`level ${def.id}: facts use ${v}`);
  return { ...def, prog, vars, locals, initVars, startExpr, factsExpr, branches: branches(prog.body) };
}

export const LEVELS: Level[] = DEFS.map(compileLevel);

export function levelById(id: number): Level {
  const l = LEVELS.find((x) => x.id === id);
  if (!l) throw new Error(`no level ${id}`);
  return l;
}

// ---------------------------------------------------------------- tutorial-only programs

/**
 * Programs that appear only in the tutorial and in the short intros before levels 9 and 10. They are not
 * levels (never in LEVELS, never in the level select), so the tutorial cannot give away a level's answer.
 * `countdown` is level 1's code on purpose: level 1 is the practice level.
 * Their ids start at 101 so they never clash with a level; the railing and tuple gates of the game rules
 * (open from level 9 and 10) are therefore open for them, which the railing and floors intros need.
 */
export type TutorialKey = 'countdown' | 'flip' | 'railing' | 'floors';

const TUTORIAL_DEFS: Record<TutorialKey, LevelDef> = {
  countdown: {
    id: 101,
    title: { en: 'Countdown', ko: '카운트다운' },
    code: DEFS[0]!.code,
    inputs: ['n'],
    start: 'true',
    facts: 'true',
    kind: 'ends',
    samples: [{ n: 3 }],
  },
  flip: {
    id: 102,
    title: { en: 'Back and forth', ko: '왔다 갔다' },
    code: `while (x != 0) {
  x := 1 - x
}`,
    inputs: ['x'],
    start: 'true',
    facts: 'true',
    kind: 'never',
    samples: [{ x: 2 }],
  },
  railing: {
    id: 103,
    title: { en: 'Railing', ko: '난간' },
    code: `k := 10
while (k != 0) {
  k := k - 1
}`,
    inputs: [],
    start: 'true',
    facts: 'true',
    kind: 'ends',
    samples: [{}],
  },
  floors: {
    id: 104,
    title: { en: 'Floors and steps', ko: '층과 계단' },
    code: `while (f > 0) {
  if (s > 0) {
    s := s - 1
  } else {
    f := f - 1
    s := 5
  }
}`,
    inputs: ['f', 's'],
    start: 's >= 0',
    startText: 's ≥ 0',
    facts: 's >= 0',
    factsText: 's ≥ 0',
    kind: 'ends',
    samples: [{ f: 2, s: 2 }],
  },
};

export const TUTORIAL_PROGRAMS = Object.fromEntries(
  Object.entries(TUTORIAL_DEFS).map(([k, def]) => [k, compileLevel(def)]),
) as Record<TutorialKey, Level>;
