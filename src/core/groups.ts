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

/** The tutorial chapter that explains what a level needs. */
export function helpChapter(levelId: number): number {
  if (levelId === 9) return 5;
  if ([10, 11, 13].includes(levelId)) return 6;
  // From level 5 on every level may end or not, so all of them point at the verdict chapter
  // (pointing only the never-ending ones there would give their verdict away).
  if (levelId >= 5) return 4;
  if (levelId <= 2) return 2;
  return 3;
}

/** Chapters 4–6 belong to a level; they are marked "new" once the player gets there. */
export const CHAPTER_LEVEL: Record<number, number> = { 4: 5, 5: 9, 6: 10 };

/** Levels whose first visit points at a tutorial chapter (a concept used there for the first time). */
export function introChapter(levelId: number): number | null {
  for (const [ch, id] of Object.entries(CHAPTER_LEVEL)) if (id === levelId) return Number(ch);
  return null;
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
