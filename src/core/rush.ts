// Rush mode rules (SPEC_rush, SPEC_rush2): the order of tiers, which card comes next, scoring, the lives/streak/
// timeout state machine of an endless run, the server's check of a submitted run, the share line, and what the
// stage shows after an answer. Pure, so `npm test`, the browser and the score server (worker/) run the same code.

import { RUSH_CARDS, rushCardById, hasRushCard, type RushCard, type RushVerdict, type Tier } from './rushCards.ts';
import type { Lang } from './levels.ts';
import { initialState, sameState, sampleInputs, type State } from './sim.ts';
import { ringScene, shaftScene, sceneBase, stairsOfRun, walk, type StageScene } from './stage.ts';

export const RUSH_SECONDS = 5;
export const RUSH_MS = RUSH_SECONDS * 1000;
export const RUSH_LIVES = 3;
/** The fastest answer the server accepts; quicker answers count as this long. */
export const MIN_ANSWER_MS = 200;
/** A timeout is sent as RUSH_MS; the server accepts anything from here up for it. */
export const TIMEOUT_MIN_MS = 4800;
/** Card ids remembered per device (newest last), so that a new run asks unseen cards first. */
export const SEEN_KEPT = 600;
/** More answers than this in one run are refused by the server (a run that long would take hours). */
export const MAX_ANSWERS = 2000;

// ------------------------------------------------------------ the order of tiers (data: tune it here)

/**
 * The tier asked at each position: `head` for positions 1, 2, …, then `repeat` again and again.
 * Easy cards first, then more and more of the middle and hard ones.
 */
export const TIER_PATTERN: { head: Tier[]; repeat: Tier[] } = {
  head: [1, 1, 1, 2, 1, 1, 2, 3, 2, 1, 2, 2, 1, 3, 2, 2, 3, 1, 3, 2],
  repeat: [2, 3, 2, 3, 1, 3, 2, 3, 3, 2],
};

/** The tier of the card at position i (1-based). */
export function TIER_AT(i: number): Tier {
  const { head, repeat } = TIER_PATTERN;
  const n = Math.max(1, Math.floor(i));
  if (n <= head.length) return head[n - 1]!;
  return repeat[(n - head.length - 1) % repeat.length]!;
}

// ------------------------------------------------------------ scoring

/** ×1 for the first right answer in a row, then +0.25 per answer up to ×2 (the 5th in a row and after). */
export function streakMultiplier(streak: number): number {
  return 1 + 0.25 * Math.min(Math.max(streak - 1, 0), 4);
}

/** The time an answer took as counted: whole ms between MIN_ANSWER_MS and RUSH_MS. */
export function clampMs(ms: number): number {
  return Math.min(RUSH_MS, Math.max(MIN_ANSWER_MS, Math.round(ms)));
}

/** Seconds left, floored to 0.1 s, in tenths (0 … 50). */
export function tenthsLeft(ms: number): number {
  return Math.min(50, Math.max(0, Math.floor((RUSH_MS - ms) / 100)));
}

/** A right answer: round((100 + 100 × t / 5) × streak multiplier), t = seconds left floored to 0.1 s. */
export function cardPoints(ms: number, streak: number): number {
  return Math.round((100 + 2 * tenthsLeft(ms)) * streakMultiplier(streak));
}

// ------------------------------------------------------------ the run (endless: it ends when the lives run out)

export interface RushAnswer {
  card: number;
  /** null = the time ran out. */
  given: RushVerdict | null;
  /** How long the answer took, as counted (MIN_ANSWER_MS … RUSH_MS; a timeout is RUSH_MS). */
  ms: number;
  right: boolean;
  points: number;
}

export interface RushState {
  /** Card ids asked so far; the last one is being asked (or, in 'feedback', was just answered). */
  cards: number[];
  phase: 'question' | 'feedback' | 'over';
  score: number;
  lives: number;
  streak: number;
  bestStreak: number;
  answers: RushAnswer[];
}

export function startRush(first: number): RushState {
  return { cards: [first], phase: 'question', score: 0, lives: RUSH_LIVES, streak: 0, bestStreak: 0, answers: [] };
}

/** The current card's id. */
export function currentCard(st: RushState): number {
  return st.cards[st.cards.length - 1]!;
}

/** Answer the current card (`given` null = timeout). Only in 'question'; anything else is ignored. */
export function answerCard(st: RushState, given: RushVerdict | null, ms: number, correct: RushVerdict): RushState {
  if (st.phase !== 'question') return st;
  const right = given === correct;
  const took = given === null ? RUSH_MS : clampMs(ms);
  const streak = right ? st.streak + 1 : 0;
  const points = right ? cardPoints(took, streak) : 0;
  return {
    ...st,
    phase: 'feedback',
    score: st.score + points,
    lives: right ? st.lives : st.lives - 1,
    streak,
    bestStreak: Math.max(st.bestStreak, streak),
    answers: [...st.answers, { card: currentCard(st), given, ms: took, right, points }],
  };
}

/** After this feedback the run is over: no lives left. */
export function isLast(st: RushState): boolean {
  return st.phase === 'feedback' && st.lives <= 0;
}

/** From the feedback to the next card (`pick` gives its id), or to the end when no life is left. */
export function nextCard(st: RushState, pick: () => number): RushState {
  if (st.phase !== 'feedback') return st;
  if (isLast(st)) return { ...st, phase: 'over' };
  return { ...st, phase: 'question', cards: [...st.cards, pick()] };
}

export function rightCount(st: Pick<RushState, 'answers'>): number {
  return st.answers.filter((a) => a.right).length;
}

// ------------------------------------------------------------ which card comes next

export type CardMeta = Pick<RushCard, 'id' | 'tier' | 'family' | 'pair'>;

export interface PickOptions {
  /** Position of the card to pick (1-based). */
  position: number;
  /** Ids asked earlier in this run, in order. */
  run: readonly number[];
  /** Ids answered on this device, newest last. */
  seen: readonly number[];
  /** A uniform random integer in [0, n). */
  rand: (n: number) => number;
  cards?: readonly CardMeta[];
}

const keep = <T>(xs: T[], ok: (x: T) => boolean): T[] => {
  const ys = xs.filter(ok);
  return ys.length ? ys : xs;
};

/**
 * The card for a position: a card of TIER_AT(position), not asked yet in this run (unless the tier is used up),
 * not the twin of a lookalike already asked in this run, not of the same family as either of the two cards before
 * it (both rules give way only when nothing else is left); then uniformly among the cards this device has not seen,
 * or, when it has seen them all, the one seen longest ago.
 */
export function pickCard(o: PickOptions): number {
  const cards = o.cards ?? RUSH_CARDS;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const pool = cards.filter((c) => c.tier === TIER_AT(o.position));
  if (!pool.length) throw new Error(`no card of tier ${TIER_AT(o.position)}`);
  const inRun = new Set(o.run);
  let cands = keep([...pool], (c) => !inRun.has(c.id));
  const pairs = new Set(o.run.map((id) => byId.get(id)?.pair).filter((p): p is string => !!p));
  cands = keep(cands, (c) => !c.pair || !pairs.has(c.pair));
  const recent = new Set(o.run.slice(-2).map((id) => byId.get(id)?.family));
  cands = keep(cands, (c) => !recent.has(c.family));
  const seenAt = new Map(o.seen.map((id, i) => [id, i]));
  const unseen = cands.filter((c) => !seenAt.has(c.id));
  if (unseen.length) return unseen[Math.min(unseen.length - 1, Math.max(0, Math.floor(o.rand(unseen.length))))]!.id;
  let best = cands[0]!;
  for (const c of cands) if (seenAt.get(c.id)! < seenAt.get(best.id)!) best = c;
  return best.id;
}

/** The seen list after answering `id`: moved to the end, at most SEEN_KEPT ids. */
export function addSeen(seen: readonly number[], id: number): number[] {
  const out = seen.filter((x) => x !== id);
  out.push(id);
  return out.slice(-SEEN_KEPT);
}

/** A uniform random integer in [0, n) from crypto.getRandomValues (rejection sampling, no modulo bias). */
export function cryptoRand(n: number): number {
  if (n <= 1) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

// ------------------------------------------------------------ the server's check of a finished run

export interface SubmittedAnswer {
  id: number;
  given: RushVerdict | null;
  ms: number;
}

export type RunReason =
  | 'not-a-list'
  | 'empty'
  | 'too-long'
  | 'bad-answer'
  | 'unknown-card'
  | 'wrong-tier'
  | 'repeated-card'
  | 'bad-time'
  | 'after-end'
  | 'not-over';

export type RunCheck =
  | { ok: true; score: number; cards: number; bestStreak: number; totalMs: number; answered: number }
  | { ok: false; reason: RunReason; at?: number };

/**
 * Replays a submitted run with the game's own rules: the ids exist and follow TIER_AT by position, no id comes
 * twice unless its tier was used up first, every time is within the limits, and the run stops exactly at the
 * answer that took the last life. The score is computed here, never taken from the client.
 */
export function checkRun(answers: unknown): RunCheck {
  if (!Array.isArray(answers)) return { ok: false, reason: 'not-a-list' };
  if (!answers.length) return { ok: false, reason: 'empty' };
  if (answers.length > MAX_ANSWERS) return { ok: false, reason: 'too-long' };
  const tierSize = new Map<Tier, number>();
  for (const c of RUSH_CARDS) tierSize.set(c.tier, (tierSize.get(c.tier) ?? 0) + 1);
  const usedInTier = new Map<Tier, Set<number>>();
  let st: RushState | null = null;
  let totalMs = 0;
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i] as Partial<SubmittedAnswer> | null;
    const at = i + 1;
    if (!a || typeof a !== 'object' || !Number.isInteger(a.id) || !Number.isInteger(a.ms) || !(a.given === 'ends' || a.given === 'never' || a.given === null))
      return { ok: false, reason: 'bad-answer', at };
    if (st && isLast(st)) return { ok: false, reason: 'after-end', at };
    if (!hasRushCard(a.id!)) return { ok: false, reason: 'unknown-card', at };
    const card = rushCardById(a.id!);
    if (card.tier !== TIER_AT(at)) return { ok: false, reason: 'wrong-tier', at };
    const used = usedInTier.get(card.tier) ?? new Set<number>();
    if (used.has(card.id) && used.size < tierSize.get(card.tier)!) return { ok: false, reason: 'repeated-card', at };
    used.add(card.id);
    usedInTier.set(card.tier, used);
    const ms = a.ms!;
    if (a.given === null ? ms < TIMEOUT_MIN_MS || ms > RUSH_MS : ms < MIN_ANSWER_MS || ms > RUSH_MS) return { ok: false, reason: 'bad-time', at };
    totalMs += ms;
    st = st ? nextCard(st, () => card.id) : startRush(card.id);
    st = answerCard(st, a.given!, ms, card.verdict);
  }
  if (!st || !isLast(st)) return { ok: false, reason: 'not-over' };
  return { ok: true, score: st.score, cards: rightCount(st), bestStreak: st.bestStreak, totalMs, answered: st.answers.length };
}

/** What the game sends for a finished run. */
export function submittedAnswers(st: RushState): SubmittedAnswer[] {
  return st.answers.map((a) => ({ id: a.card, given: a.given, ms: a.ms }));
}

// ------------------------------------------------------------ share line

export function formatScore(n: number): string {
  return n.toLocaleString('en-US');
}

/** e.g. `Halt? 러시 · 2,350점 · 18장 · 최고 연속 9`; never shows a card or a verdict. */
export function rushShareText(lang: Lang, score: number, cards: number, bestStreak: number): string {
  return lang === 'ko'
    ? `Halt? 러시 · ${formatScore(score)}점 · ${cards}장 · 최고 연속 ${bestStreak}`
    : `Halt? Rush · ${formatScore(score)} pts · ${cards} ${cards === 1 ? 'card' : 'cards'} · best streak ${bestStreak}`;
}

// ------------------------------------------------------------ the stage after an answer

/** Steps drawn after an answer: the walker only has a few seconds. */
export const RUSH_DRAW = 24;

/** The first sample's start state (the walker's run after the answer). */
export function rushStart(card: RushCard): State {
  return initialState(card, sampleInputs(card)[0]!);
}

/**
 * The run of the first sample: real stairs when it ends, a ring when it repeats a state, a shaft otherwise.
 * Unlike runScene it never simulates past the drawing, so a fast-growing run costs nothing.
 */
export function rushScene(card: RushCard): StageScene {
  const s0 = rushStart(card);
  const w = walk(card, s0, RUSH_DRAW);
  if (w.exited) {
    const total = w.states.length - 1;
    return { ...sceneBase(card), k: 'stairs', stairs: stairsOfRun(card, w.states, total), end: 'exit', tuple: false, real: true };
  }
  for (let j = 1; j < w.states.length; j++) {
    const i = w.states.findIndex((s) => sameState(card, s, w.states[j]!));
    if (i < j) return ringScene(card, w.states.slice(0, j + 1), i);
  }
  return shaftScene(card, w.states);
}
