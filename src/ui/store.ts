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
  /** v0.3: the 8-page tutorial was read to the end ('done') or skipped. */
  tutorial?: 'done' | 'skipped';
  /** v0.3: levels whose first visit already showed something (1: the tutorial suggestion; 9, 10: their intro). */
  introsShown: number[];
  current?: number;
  daily: Record<string, DailyRecord>;
  muted?: boolean;
}

const KEY = 'it-ends:v1';

function blank(): Saved {
  return { best: {}, introsShown: [], daily: {} };
}

const numbers = (x: unknown): number[] => (Array.isArray(x) ? x.filter((n): n is number => typeof n === 'number') : []);

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
