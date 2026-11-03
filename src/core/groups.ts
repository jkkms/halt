// Level select: chapters of levels, the recommended next level, and which tutorial chapter helps where.
// Pure data and functions (tested); the verdict of a level is never part of what is shown.

import { LEVELS, type Level, type Text } from './levels.ts';

export interface LevelGroup {
  id: string;
  title: Text;
  levels: number[];
}

export const GROUPS: LevelGroup[] = [
  // Groups follow the campaign order, so a group never tells which levels end and which do not.
  { id: 'basics', title: { ko: '기초', en: 'Basics' }, levels: [1, 2, 3, 4, 5] },
  { id: 'further', title: { ko: '한 걸음 더', en: 'One step further' }, levels: [6, 7, 8, 9] },
  { id: 'floors', title: { ko: '층과 계단', en: 'Floors and steps' }, levels: [10, 11, 12, 13] },
  { id: 'applied', title: { ko: '응용', en: 'Applied' }, levels: [14, 15, 16, 17] },
  { id: 'last', title: { ko: '마지막', en: 'The last one' }, levels: [18] },
];

/** The campaign order (the order the levels were designed to be played in). */
export const CAMPAIGN: number[] = LEVELS.map((l) => l.id);

/** First unsolved level in campaign order (null when every level is solved). */
export function recommendedNext(best: Record<string, number>): number | null {
  return CAMPAIGN.find((id) => !(best[id] ?? 0)) ?? null;
}

/**
 * What a level's "?" opens: levels 5, 7 and 10 their own intro (the bottomless zone; railing; floors and steps); the
 * other levels before level 7 the tutorial; every other level a small menu with the tutorial and the three intros.
 * Every level of a range gets the same help, so the help never tells which levels end.
 */
export type Help = { k: 'intro'; level: number } | { k: 'tutorial' } | { k: 'menu' };

export const INTRO_AT = { zone: 5, railing: 7, floors: 10 } as const;

export function helpFor(levelId: number): Help {
  if (levelId === INTRO_AT.zone || levelId === INTRO_AT.railing || levelId === INTRO_AT.floors) return { k: 'intro', level: levelId };
  return levelId < INTRO_AT.railing ? { k: 'tutorial' } : { k: 'menu' };
}

/** A tiny preview of the code for a level card: the init, the while line and the start of the body, on one line. */
export function codePreview(level: Level, max = 52): string {
  const lines = level.code.split('\n').map((l) => l.trim());
  const w = lines.findIndex((l) => l.startsWith('while'));
  const head = lines.slice(0, w + 1).join('; ');
  const body = lines
    .slice(w + 1, -1)
    .join('; ')
    .replace(/\{; /g, '{ ')
    .replace(/; \}/g, ' }')
    .replace(/\s+/g, ' ')
    .trim();
  if (head.length + body.length + 2 <= max) return `${head} ${body} }`;
  const room = Math.max(0, max - head.length - 3);
  const cut = body.slice(0, room).replace(/\s+\S*$/, '');
  return `${head} ${cut ? `${cut} ` : ''}… }`;
}
