// Concrete runs of a level's loop, with the same integer semantics as the Z3 checks.

import { evalBool, type Env } from './expr.ts';
import { exec } from './program.ts';
import type { Level } from './levels.ts';

export type State = Record<string, bigint>;

export const SIM_CAP = 10_000;

/** Is this assignment of the inputs allowed by the level's start condition? */
export function startAllowed(level: Level, inputs: Record<string, bigint>): boolean {
  return evalBool(level.startExpr, inputs);
}

/** Apply the initialization (code before `while`) to the inputs. */
export function initialState(level: Level, inputs: Record<string, bigint>): State {
  const env: Env = {};
  for (const v of level.inputs) env[v] = inputs[v] ?? 0n;
  exec(level.prog.init, env, []);
  return project(level, env);
}

function project(level: Level, env: Env): State {
  const s: State = {};
  for (const v of level.vars) s[v] = env[v]!;
  return s;
}

export function guardHolds(level: Level, s: State): boolean {
  return evalBool(level.prog.guard, s);
}

/** One loop iteration (the guard is assumed to hold). Locals are dropped afterwards. */
export function step(level: Level, s: State): { next: State; lines: number[] } {
  const env: Env = { ...s };
  const lines: number[] = [];
  exec(level.prog.body, env, lines);
  return { next: project(level, env), lines };
}

export function stateKey(level: Level, s: State): string {
  return level.vars.map((v) => s[v]!.toString()).join(',');
}

export function sameState(level: Level, a: State, b: State): boolean {
  return level.vars.every((v) => a[v] === b[v]);
}

export interface Run {
  /** states[k] = state at the loop head before iteration k+1 (states[0] = start). */
  states: State[];
  /**
   * exit: the guard is false at the last state (the loop ended after states.length - 1 steps).
   * cycle: the last state equals states[cycleStart] (the walker circles forever).
   * cap: still walking after `cap` steps, no state repeated.
   */
  outcome: 'exit' | 'cycle' | 'cap';
  cycleStart?: number;
}

export function simulate(level: Level, s0: State, cap = SIM_CAP): Run {
  const states: State[] = [s0];
  const seen = new Map<string, number>([[stateKey(level, s0), 0]]);
  let s = s0;
  for (let k = 0; k < cap; k++) {
    if (!guardHolds(level, s)) return { states, outcome: 'exit' };
    s = step(level, s).next;
    const key = stateKey(level, s);
    states.push(s);
    const earlier = seen.get(key);
    if (earlier !== undefined) return { states, outcome: 'cycle', cycleStart: earlier };
    seen.set(key, states.length - 1);
  }
  if (!guardHolds(level, s)) return { states, outcome: 'exit' };
  return { states, outcome: 'cap' };
}

export function sampleStates(level: Level): State[] {
  return level.samples.map((sample) => {
    const inputs: Record<string, bigint> = {};
    for (const v of level.inputs) inputs[v] = BigInt(sample[v] ?? 0);
    return initialState(level, inputs);
  });
}

export function sampleInputs(level: Level): Record<string, bigint>[] {
  return level.samples.map((sample) => Object.fromEntries(level.inputs.map((v) => [v, BigInt(sample[v] ?? 0)])));
}
