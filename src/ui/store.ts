// Progress kept in localStorage. Every access is wrapped: the game must work without storage
// (private windows, blocked site data, thumbnails).
import type { Lang } from '../core/levels.ts';

export interface DailyRecord {
  level: number;
  marks: string[];
  solved: boolean;
  length: number | null;
}

export interface Saved {
  lang?: Lang;
  best: Record<string, number>;
  /** v0.1: the coach-mark tutorial was finished. */
  tutorialDone?: boolean;
  /** Levels whose "new idea" note (a tutorial chapter) was already shown. */
  introsSeen: number[];
  current?: number;
  daily: Record<string, DailyRecord>;
  /** Tutorial chapters read to the end. */
  chapters: number[];
  /** Highest level opened so far (chapters 4–6 are marked new from their level on). */
  reached?: number;
  muted?: boolean;
}

const KEY = 'it-ends:v1';

function blank(): Saved {
  return { best: {}, introsSeen: [], daily: {}, chapters: [] };
}

export function load(): Saved {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return blank();
    const data = JSON.parse(raw) as Partial<Saved>;
    return {
      ...blank(),
      ...data,
      best: { ...(data.best ?? {}) },
      introsSeen: [...(data.introsSeen ?? [])],
      daily: { ...(data.daily ?? {}) },
      chapters: Array.isArray(data.chapters) ? data.chapters.filter((n) => typeof n === 'number') : [],
    };
  } catch {
    return blank();
  }
}

export function save(data: Saved): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage unavailable: progress lives only in this tab
  }
}
