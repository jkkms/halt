// What the stage draws, as plain data: every state of a run becomes a stair at height V, plus the
// "beats" of the walk (check the loop condition, run the body, step) that the code panel follows.
// No DOM and no three.js here, so the drawing rules are tested with `npm test`.

import { evalRank, lexEqual, lexLess, show, subst, type Expr } from './expr.ts';
import type { Level } from './levels.ts';
import { guardHolds, initialState, sampleInputs, simulate, startAllowed, step, SIM_CAP, type State } from './sim.ts';

export type Bad = 'below' | 'flat' | 'up';

export interface Stair {
  s: State;
  /** V at this state; null when the heights come from the run itself (the real number of steps left). */
  v: bigint[] | null;
  /** Display height in steps (1 = one step); negative = below ground. Tuples: floor + position inside it. */
  h: number;
  /** The loop condition holds here (false: the loop has stopped, the walker is out on the ground). */
  walking: boolean;
  /** 'below': V < 0 while walking. 'flat'/'up': the step leaving this stair does not go down. */
  bad?: Bad;
  /** Body lines that run on the step leaving this stair (empty when not walking). */
  lines: number[];
  /** The loop condition with this state's values filled in, e.g. "0 < −3". */
  check: string;
}

/**
 * exit: the last stair is where the loop stopped (a door on the ground).
 * more: the run goes on past the last drawn stair.
 * cut: only part of a run is shown (a counterexample: a state and the next one).
 */
export type StairsEnd = 'exit' | 'more' | 'cut';

/** Shared by every scene: the level's variables, the while line, and the loop condition as text. */
interface SceneBase {
  vars: string[];
  whileLine: number;
  guard: string;
}

export type StageScene =
  | (SceneBase & { k: 'idle' })
  | (SceneBase & {
      k: 'stairs';
      stairs: Stair[];
      end: StairsEnd;
      /** V is a tuple: draw floors. */
      tuple: boolean;
      /** Heights are the real steps left of this run (no V given). */
      real: boolean;
      /** A railing R is drawn along the stairs. */
      railing?: string;
      /** A state the loop can never reach, drawn apart (where V fails without a railing). */
      ghost?: Stair;
      /** Steps of the whole run when it is longer than the drawing. */
      total?: number;
    })
  | (SceneBase & { k: 'shaft'; states: State[]; lines: number[][]; checks: string[]; zone?: string })
  | (SceneBase & { k: 'ring'; prefix: State[]; cycle: State[]; lines: number[][]; checks: string[] });

const pretty = (src: string) => src.replace(/-/g, '−');

/** The loop condition as the player reads it (n > 0, i ≠ n, …). */
export function guardText(level: Level): string {
  return pretty(show(level.prog.guard, true));
}

/** The loop condition with the values of s filled in: "0 < −3". */
export function guardCheck(level: Level, s: State): string {
  const sub = new Map<string, Expr>(level.vars.map((v) => [v, { k: 'num', v: s[v]!, pos: 0 }]));
  return pretty(show(subst(level.prog.guard, sub), true));
}

export function sceneBase(level: Level): SceneBase {
  return { vars: level.vars, whileLine: level.prog.whileLine, guard: guardText(level) };
}

/** Stairs drawn at most (longer runs end with "more"). */
export const DRAW_MAX = 60;

/** Walk up to n steps (no cycle detection; for drawing). */
export function walk(level: Level, s0: State, n: number): { states: State[]; exited: boolean } {
  const states = [s0];
  let cur = s0;
  for (let k = 0; k < n; k++) {
    if (!guardHolds(level, cur)) return { states, exited: true };
    cur = step(level, cur).next;
    states.push(cur);
  }
  return { states, exited: !guardHolds(level, cur) };
}

/** Display height of a V value. Tuples: floor = first part, position inside the floor = rank of the rest. */
export function heightMap(all: bigint[][]): (v: bigint[]) => number {
  if (all.every((v) => v.length <= 1)) return (v) => Number(v[0] ?? 0n);
  const key = (v: bigint[]) => v.slice(1).join(',');
  const rests = new Map<string, bigint[]>();
  for (const v of all) rests.set(key(v), v.slice(1));
  const sorted = [...rests.entries()].sort(([, a], [, b]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
    return 0;
  });
  const rankOf = new Map(sorted.map(([k], i) => [k, i]));
  const n = sorted.length;
  return (v) => {
    const r = rankOf.get(key(v)) ?? 0;
    return Number(v[0]) + (n <= 1 ? 0.5 : 0.1 + 0.8 * (r / (n - 1)));
  };
}

function linesOf(level: Level, s: State): number[] {
  return guardHolds(level, s) ? step(level, s).lines : [];
}

/** The states of a run drawn with the player's V. */
export function stairsWithV(level: Level, V: Expr, states: State[]): Stair[] {
  const values = states.map((s) => evalRank(V, s));
  const hmap = heightMap(values);
  return states.map((s, k) => {
    const walking = guardHolds(level, s);
    const v = values[k]!;
    let bad: Bad | undefined;
    if (walking && v.some((x) => x < 0n)) bad = 'below';
    else if (walking && k + 1 < states.length) {
      const v2 = values[k + 1]!;
      if (!lexLess(v2, v)) bad = lexEqual(v2, v) ? 'flat' : 'up';
    }
    return { s, v, h: hmap(v), walking, bad, lines: walking ? linesOf(level, s) : [], check: guardCheck(level, s) };
  });
}

/** A finished run drawn with its real number of steps left (no V needed). */
export function stairsOfRun(level: Level, states: State[], total: number): Stair[] {
  return states.map((s, k) => {
    const walking = guardHolds(level, s);
    return { s, v: null, h: total - k, walking, lines: walking ? linesOf(level, s) : [], check: guardCheck(level, s) };
  });
}

/** The sample run `index` of a level, drawn with V (or with the real steps left when V is null and the run ends). */
export function sampleScene(level: Level, index: number, V: Expr | null): StageScene {
  const inputs = sampleInputs(level);
  const s0 = initialState(level, inputs[Math.min(index, inputs.length - 1)]!);
  return runScene(level, s0, V);
}

/** Any run from s0: stairs from V; without V, the real steps left if it ends in the drawing, else a shaft. */
export function runScene(level: Level, s0: State, V: Expr | null, max = DRAW_MAX): StageScene {
  const base = sceneBase(level);
  const w = walk(level, s0, max);
  if (V) {
    return { ...base, k: 'stairs', stairs: stairsWithV(level, V, w.states), end: w.exited ? 'exit' : 'more', tuple: V.k === 'tuple', real: false };
  }
  if (w.exited) {
    const total = w.states.length - 1;
    return { ...base, k: 'stairs', stairs: stairsOfRun(level, w.states, total), end: 'exit', tuple: false, real: true };
  }
  const run = simulate(level, s0, SIM_CAP);
  if (run.outcome === 'cycle') return ringScene(level, run.states, run.cycleStart ?? 0);
  return shaftScene(level, w.states);
}

export function shaftScene(level: Level, states: State[], zone?: string): StageScene {
  const shown = states.slice(0, DRAW_MAX + 1);
  return { ...sceneBase(level), k: 'shaft', states: shown, lines: shown.map((s) => linesOf(level, s)), checks: shown.map((s) => guardCheck(level, s)), zone };
}

/** states = a run whose last state equals states[cycleStart]. */
export function ringScene(level: Level, states: State[], cycleStart: number): StageScene {
  const prefix = states.slice(0, cycleStart);
  const cycle = states.slice(cycleStart, Math.max(cycleStart + 1, states.length - 1));
  return { ...sceneBase(level), k: 'ring', prefix, cycle, lines: cycle.map((s) => linesOf(level, s)), checks: cycle.map((s) => guardCheck(level, s)) };
}

/** A counterexample: one state (below ground) or a state and the next one (a step that does not go down). */
export function cexScene(level: Level, V: Expr, s: State, s2?: State): StageScene {
  const states = s2 ? [s, s2] : [s];
  const stairs = stairsWithV(level, V, states);
  return { ...sceneBase(level), k: 'stairs', stairs, end: 'cut', tuple: V.k === 'tuple', real: false };
}

// ------------------------------------------------------------ beats

export type Beat =
  /** The walker checks the loop condition at stair k. */
  | { k: number; kind: 'guard'; holds: boolean; line: number }
  /** The body runs and the walker moves from stair k to k + 1. */
  | { k: number; kind: 'step'; lines: number[]; bad?: Bad; fall: boolean }
  /** The condition was false: the walker leaves through the door at stair k. */
  | { k: number; kind: 'exit'; steps: number }
  /** The drawing stops here; the walk goes on (or the counterexample ends). */
  | { k: number; kind: 'more' }
  | { k: number; kind: 'cut' };

/**
 * The walk along drawn stairs, beat by beat. The loop condition is checked before every step,
 * including the first: a run whose start already fails the condition is [guard false, exit] (0 steps).
 */
export function beats(scene: Extract<StageScene, { k: 'stairs' }>): Beat[] {
  const out: Beat[] = [];
  const { stairs, whileLine } = scene;
  for (let k = 0; k < stairs.length; k++) {
    const st = stairs[k]!;
    out.push({ k, kind: 'guard', holds: st.walking, line: whileLine });
    if (!st.walking) {
      out.push({ k, kind: 'exit', steps: k });
      return out;
    }
    if (k + 1 >= stairs.length) {
      out.push({ k, kind: scene.end === 'cut' ? 'cut' : 'more' });
      return out;
    }
    const next = stairs[k + 1]!;
    out.push({ k, kind: 'step', lines: st.lines, bad: st.bad, fall: next.walking && next.bad === 'below' });
  }
  return out;
}

// ------------------------------------------------------------ zero-step runs

/** Does the loop run zero times from these inputs (the condition is already false at the start)? */
export function zeroSteps(level: Level, inputs: Record<string, bigint>): boolean {
  return !guardHolds(level, initialState(level, inputs));
}

/** Index of a sample that runs zero times, or -1. */
export function zeroStepSample(level: Level): number {
  return sampleInputs(level).findIndex((inp) => zeroSteps(level, inp));
}

/** Is there an allowed start (inputs in [-box, box]) where the loop runs zero times? */
export function allowsZeroSteps(level: Level, box = 4): boolean {
  const vals: bigint[] = [];
  for (let x = -box; x <= box; x++) vals.push(BigInt(x));
  const go = (i: number, inputs: Record<string, bigint>): boolean => {
    if (i === level.inputs.length) return startAllowed(level, inputs) && zeroSteps(level, inputs);
    return vals.some((x) => go(i + 1, { ...inputs, [level.inputs[i]!]: x }));
  };
  return go(0, {});
}
