// Game rules on top of the judge and the simulator: parsing answers, verdicts, attempts, stars, daily puzzle.
// Pure apart from the judge, so the same code runs in the browser and in `npm test`.

import {
  answerLength,
  evalBool,
  evalRank,
  ExprError,
  lexEqual,
  lexLess,
  parseCond,
  parseIntLiteral,
  parseRank,
  type Expr,
} from './expr.ts';
import { overall, type CheckId, type CheckResult, type Judge, type Status } from './judge.ts';
import { RAILING_FROM, TUPLES_FROM, type Level } from './levels.ts';
import { guardHolds, initialState, sameState, simulate, startAllowed, step, SIM_CAP, type Run, type State } from './sim.ts';

export type Verdict = 'ends' | 'never' | 'nobody';
export type Field = 'V' | 'R' | 'Z' | string; // string = an input variable name

export interface FieldError {
  field: Field;
  error: ExprError;
}

/** A check result enriched for display: values of V before/after, which branch ran, etc. */
export interface Detail {
  id: CheckId;
  status: Status;
  s?: State;
  s2?: State;
  v?: bigint[];
  v2?: bigint[];
  /** decreasing failure: the step is flat (V' = V) or goes up (V' > V). */
  move?: 'flat' | 'up';
  /** body lines that ran on the step s -> s2. */
  lines?: number[];
  reason?: string;
}

export type Outcome =
  | { type: 'parseError'; errors: FieldError[] }
  | { type: 'ends'; result: 'proved' | 'refuted' | 'undecided'; details: Detail[]; length: number; V: Expr; R: Expr | null }
  | { type: 'notAllowed'; inputs: Record<string, bigint> }
  | { type: 'ended'; run: Run; totalSteps: number; s0: State }
  | { type: 'cycle'; run: Run; s0: State }
  | { type: 'needZone'; run: Run; s0: State }
  | { type: 'zone'; result: 'proved' | 'refuted' | 'undecided'; details: Detail[]; s0: State; Z: Expr; run: Run }
  | { type: 'nobody'; correct: boolean };

export const railingAllowed = (level: Level) => level.id >= RAILING_FROM;
export const tuplesAllowed = (level: Level) => level.id >= TUPLES_FROM;

const scope = (level: Level) => ({ vars: level.vars, locals: level.locals });

export function parseV(level: Level, text: string): Expr {
  return parseRank(text, scope(level), tuplesAllowed(level));
}

export function parseR(level: Level, text: string): Expr | null {
  if (!railingAllowed(level) || text.trim() === '') return null;
  return parseCond(text, scope(level));
}

export function parseZ(level: Level, text: string): Expr {
  return parseCond(text, scope(level));
}

/** Length counted for par: V plus the railing, ignoring spaces. */
export function proofLength(level: Level, vText: string, rText: string): number {
  return answerLength(vText) + (railingAllowed(level) && rText.trim() !== '' ? answerLength(rText) : 0);
}

function detail(level: Level, c: CheckResult, V: Expr | null): Detail {
  const d: Detail = { id: c.id, status: c.status, s: c.s, s2: c.s2, reason: c.reason };
  if (c.status !== 'fail' || !c.s) return d;
  // Programs are deterministic, so the next state is fixed by s; recompute it with the simulator
  // (same semantics) to know which lines ran.
  if (c.s2 && guardHolds(level, c.s)) {
    const { next, lines } = step(level, c.s);
    d.lines = lines;
    if (!sameState(level, next, c.s2)) d.reason = 'model-mismatch';
    d.s2 = next;
  }
  if (V) {
    d.v = evalRank(V, c.s);
    if (d.s2) d.v2 = evalRank(V, d.s2);
    if (c.id === 'decreasing' && d.v && d.v2) d.move = lexEqual(d.v, d.v2) ? 'flat' : 'up';
  }
  return d;
}

/** "It ends": check V (and R) with the judge. */
export async function proveEnds(judge: Judge, level: Level, vText: string, rText: string): Promise<Outcome> {
  const errors: FieldError[] = [];
  let V: Expr | null = null;
  let R: Expr | null = null;
  try {
    V = parseV(level, vText);
  } catch (e) {
    if (e instanceof ExprError) errors.push({ field: 'V', error: e });
    else throw e;
  }
  try {
    R = parseR(level, rText);
  } catch (e) {
    if (e instanceof ExprError) errors.push({ field: 'R', error: e });
    else throw e;
  }
  if (errors.length || !V) return { type: 'parseError', errors };
  const checks = await judge.checkEnds(level, V, R);
  const details = checks.map((c) => detail(level, c, V));
  return { type: 'ends', result: overall(checks), details, length: proofLength(level, vText, rText), V, R };
}

export function parseInputs(level: Level, texts: Record<string, string>): { inputs?: Record<string, bigint>; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const inputs: Record<string, bigint> = {};
  for (const v of level.inputs) {
    try {
      inputs[v] = parseIntLiteral(texts[v] ?? '');
    } catch (e) {
      if (e instanceof ExprError) errors.push({ field: v, error: e });
      else throw e;
    }
  }
  return errors.length ? { errors } : { inputs, errors };
}

/** Steps we are willing to keep walking (counting only) to show that a long run does end. */
export const LONG_RUN_CAP = 1_000_000;

/** "It never ends", part 1: run the player's start. */
export function runNever(level: Level, texts: Record<string, string>): Outcome {
  const { inputs, errors } = parseInputs(level, texts);
  if (!inputs) return { type: 'parseError', errors };
  if (!startAllowed(level, inputs)) return { type: 'notAllowed', inputs };
  const s0 = initialState(level, inputs);
  const run = simulate(level, s0, SIM_CAP);
  if (run.outcome === 'exit') return { type: 'ended', run, totalSteps: run.states.length - 1, s0 };
  if (run.outcome === 'cycle') return { type: 'cycle', run, s0 };
  if (level.kind === 'ends') {
    // We know this loop ends; walk on (without storing states) so the player sees the run end.
    let s = run.states[run.states.length - 1]!;
    for (let k = SIM_CAP; k < LONG_RUN_CAP; k++) {
      if (!guardHolds(level, s)) return { type: 'ended', run, totalSteps: k, s0 };
      s = step(level, s).next;
    }
  }
  return { type: 'needZone', run, s0 };
}

/** "It never ends", part 2: the bottomless zone. */
export async function proveZone(judge: Judge, level: Level, s0: State, zText: string, run: Run): Promise<Outcome> {
  let Z: Expr;
  try {
    Z = parseZ(level, zText);
  } catch (e) {
    if (e instanceof ExprError) return { type: 'parseError', errors: [{ field: 'Z', error: e }] };
    throw e;
  }
  const checks = await judge.checkZone(level, s0, Z);
  return { type: 'zone', result: overall(checks), details: checks.map((c) => detail(level, c, null)), s0, Z, run };
}

export function nobodyKnows(level: Level): Outcome {
  return { type: 'nobody', correct: level.kind === 'open' };
}

/** Did this outcome solve the level? */
export function isSolved(level: Level, o: Outcome): boolean {
  switch (o.type) {
    case 'ends':
      return o.result === 'proved' && level.kind === 'ends';
    case 'cycle':
      return level.kind === 'never';
    case 'zone':
      return o.result === 'proved' && level.kind === 'never';
    case 'nobody':
      return o.correct;
    default:
      return false;
  }
}

/** Does this outcome cost an attempt (a definite failure)? Parse errors, disallowed starts and timeouts do not. */
export function isFailure(o: Outcome): boolean {
  switch (o.type) {
    case 'ends':
    case 'zone':
      return o.result === 'refuted';
    case 'ended':
      return true;
    case 'nobody':
      return !o.correct;
    default:
      return false;
  }
}

/** One emoji per attempt for the daily share text. */
export function attemptMark(o: Outcome): string {
  if (o.type === 'ends' && o.result === 'refuted') {
    const failed = o.details.filter((d) => d.status === 'fail');
    if (failed.some((d) => d.id === 'railStart' || d.id === 'railStep')) return '❌';
    if (failed.some((d) => d.id === 'bounded')) return '⬇';
    const dec = failed.find((d) => d.id === 'decreasing');
    if (dec) return dec.move === 'up' ? '⬆' : '➡';
  }
  return '❌';
}

/**
 * Stars: ★ solved; ★★ solved within 3 attempts; ★★★ also: for ends-levels the answer length is at most par
 * (railing counts); for never-levels and the last level, solved on the first attempt.
 */
export function starsFor(level: Level, attempts: number, length: number | null): number {
  if (attempts > 3) return 1;
  const bonus = level.kind === 'ends' ? length !== null && level.par !== undefined && length <= level.par : attempts === 1;
  return bonus ? 3 : 2;
}

// ------------------------------------------------------------ helpers for display

/** Is V below ground at s (some component negative)? */
export function belowGround(V: Expr, s: State): boolean {
  return evalRank(V, s).some((x) => x < 0n);
}

/** Does the step s -> s2 fail to go down? */
export function notDown(V: Expr, s: State, s2: State): boolean {
  return !lexLess(evalRank(V, s2), evalRank(V, s));
}

export function holds(e: Expr, s: State): boolean {
  return evalBool(e, s);
}

// ------------------------------------------------------------ daily puzzle

export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Deterministic level of the day (FNV-1a hash of the UTC date). */
export function dailyLevelId(key: string, count: number): number {
  let h = 0x811c9dc5;
  for (const ch of key) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % count) + 1;
}

export function shareText(key: string, levelId: number, marks: string[], length: number | null): string {
  return `It Ends #${key} L${levelId} ${marks.join('')}${length !== null ? ` ${length} chars` : ''}`;
}
