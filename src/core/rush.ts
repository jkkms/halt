// Rush mode rules (SPEC_rush): scoring, the lives/streak/timeout state machine, the seeded card order, the share
// line, and what the stage shows after an answer. Pure, so `npm test` checks the same code the browser runs.

import { RUSH_CARDS, type RushCard, type RushVerdict } from './rushCards.ts';
import type { Lang } from './levels.ts';
import { initialState, sameState, sampleInputs, type State } from './sim.ts';
import { ringScene, shaftScene, sceneBase, stairsOfRun, walk, type StageScene } from './stage.ts';

export const RUSH_SECONDS = 15;
export const RUSH_LIVES = 3;
export const CLEAR_BONUS = 500;

// ------------------------------------------------------------ scoring

/** ×1 for the first right answer in a row, then +0.25 per answer up to ×2 (the 5th in a row and after). */
export function streakMultiplier(streak: number): number {
  return 1 + 0.25 * Math.min(Math.max(streak - 1, 0), 4);
}

/** A right answer: 100 + 10 × whole seconds left, times the streak multiplier (streak counts this answer). */
export function cardPoints(secondsLeft: number, streak: number): number {
  const whole = Math.max(0, Math.min(RUSH_SECONDS, Math.floor(secondsLeft)));
  return Math.round((100 + 10 * whole) * streakMultiplier(streak));
}

// ------------------------------------------------------------ the run

export interface RushAnswer {
  card: number;
  /** null = the time ran out. */
  given: RushVerdict | null;
  right: boolean;
  points: number;
}

export interface RushState {
  order: number[];
  /** The card being asked, or (in 'feedback') the one just answered. */
  index: number;
  phase: 'question' | 'feedback' | 'over';
  score: number;
  lives: number;
  streak: number;
  bestStreak: number;
  answers: RushAnswer[];
  /** Every card answered with a life left (the +500 is in the score). */
  cleared: boolean;
}

export function startRush(order: number[]): RushState {
  return { order, index: 0, phase: 'question', score: 0, lives: RUSH_LIVES, streak: 0, bestStreak: 0, answers: [], cleared: false };
}

/** Answer the current card (`given` null = timeout). Only in 'question'; anything else is ignored. */
export function answerCard(st: RushState, given: RushVerdict | null, secondsLeft: number, correct: RushVerdict): RushState {
  if (st.phase !== 'question') return st;
  const right = given === correct;
  const streak = right ? st.streak + 1 : 0;
  const points = right ? cardPoints(secondsLeft, streak) : 0;
  return {
    ...st,
    phase: 'feedback',
    score: st.score + points,
    lives: right ? st.lives : st.lives - 1,
    streak,
    bestStreak: Math.max(st.bestStreak, streak),
    answers: [...st.answers, { card: st.order[st.index]!, given, right, points }],
  };
}

/** After this feedback the run is over: no lives left, or no cards left. */
export function isLast(st: RushState): boolean {
  return st.phase === 'feedback' && (st.lives <= 0 || st.index + 1 >= st.order.length);
}

/** From the feedback to the next card, or to the end (with the bonus when every card was answered). */
export function nextCard(st: RushState): RushState {
  if (st.phase !== 'feedback') return st;
  if (isLast(st)) {
    const cleared = st.lives > 0;
    return { ...st, phase: 'over', cleared, score: st.score + (cleared ? CLEAR_BONUS : 0) };
  }
  return { ...st, phase: 'question', index: st.index + 1 };
}

export function rightCount(st: RushState): number {
  return st.answers.filter((a) => a.right).length;
}

/** ✔ / ✘ per answered card. */
export function rushMarks(st: RushState): string {
  return st.answers.map((a) => (a.right ? '✔' : '✘')).join('');
}

// ------------------------------------------------------------ order

/** FNV-1a of a string: the seed of the order. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** mulberry32: a small deterministic generator in [0, 1). */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Card ids, shuffled within each tier by the seed; tier 1 first, then 2, then 3. */
export function rushOrder(seed: string, cards: RushCard[] = RUSH_CARDS): number[] {
  const rand = generator(hashSeed(seed));
  const out: number[] = [];
  for (const tier of [1, 2, 3] as const) {
    const ids = cards.filter((c) => c.tier === tier).map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    out.push(...ids);
  }
  return out;
}

/** Today's rush: the same order for everyone on that UTC date. */
export function dailyRushOrder(dateKey: string): number[] {
  return rushOrder(`rush:${dateKey}`);
}

// ------------------------------------------------------------ share line

export function formatScore(n: number): string {
  return n.toLocaleString('en-US');
}

/** e.g. `Halt? 러시 2026-11-03 · 1,450점 · ✔✔✘✔`; never shows a card or a verdict. */
export function rushShareText(lang: Lang, dateKey: string, score: number, marks: string): string {
  return lang === 'ko' ? `Halt? 러시 ${dateKey} · ${formatScore(score)}점 · ${marks}` : `Halt? Rush ${dateKey} · ${formatScore(score)} pts · ${marks}`;
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
