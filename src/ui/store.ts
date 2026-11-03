// Progress kept in localStorage. Every access is wrapped: the game must work without storage
// (private windows, blocked site data, thumbnails).
import type { Lang } from '../core/levels.ts';

export interface DailyRecord {
  level: number;
  marks: string[];
  solved: boolean;
  length: number | null;
}

/** Rush mode: the best score of each day's rush (UTC date) and the best practice score. */
export interface RushRecord {
  daily: Record<string, number>;
  practiceBest: number;
}

export interface Saved {
  lang?: Lang;
  best: Record<string, number>;
  /** v0.3: the 8-page tutorial was read to the end ('done') or skipped. */
  tutorial?: 'done' | 'skipped';
  /** v0.3: levels whose first visit already showed something (1: the tutorial suggestion; 9, 10: their intro). */
  introsShown: number[];
  current?: number;
  daily: Record<string, DailyRecord>;
  muted?: boolean;
  rush: RushRecord;
}

const KEY = 'it-ends:v1';

function blank(): Saved {
  return { best: {}, introsShown: [], daily: {}, rush: { daily: {}, practiceBest: 0 } };
}

const numbers = (x: unknown): number[] => (Array.isArray(x) ? x.filter((n): n is number => typeof n === 'number') : []);

/** Days of rush scores kept (the newest). */
export const RUSH_DAYS_KEPT = 30;

function rushRecord(x: unknown): RushRecord {
  const r = (x ?? {}) as Partial<RushRecord>;
  const days = Object.entries(r.daily ?? {})
    .filter((e): e is [string, number] => /^\d{4}-\d{2}-\d{2}$/.test(e[0]) && typeof e[1] === 'number' && e[1] >= 0)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, RUSH_DAYS_KEPT);
  return { daily: Object.fromEntries(days), practiceBest: typeof r.practiceBest === 'number' && r.practiceBest >= 0 ? r.practiceBest : 0 };
}

/** Keep the better score; returns true when it is a new best. */
export function recordRush(rec: RushRecord, day: string | null, score: number): boolean {
  if (day === null) {
    if (score <= rec.practiceBest) return false;
    rec.practiceBest = score;
    return true;
  }
  const prev = rec.daily[day];
  if (prev !== undefined && score <= prev) return false;
  rec.daily[day] = score;
  Object.assign(rec, rushRecord(rec));
  return true;
}

export function load(): Saved {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return blank();
    const data = JSON.parse(raw) as Partial<Saved>;
    return {
      lang: data.lang === 'ko' || data.lang === 'en' ? data.lang : undefined,
      best: { ...(data.best ?? {}) },
      tutorial: data.tutorial === 'done' || data.tutorial === 'skipped' ? data.tutorial : undefined,
      introsShown: numbers(data.introsShown),
      current: typeof data.current === 'number' ? data.current : undefined,
      daily: { ...(data.daily ?? {}) },
      muted: typeof data.muted === 'boolean' ? data.muted : undefined,
      rush: rushRecord(data.rush),
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
