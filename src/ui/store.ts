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
  tutorialDone?: boolean;
  introsSeen: number[];
  current?: number;
  daily: Record<string, DailyRecord>;
}

const KEY = 'it-ends:v1';

function blank(): Saved {
  return { best: {}, introsSeen: [], daily: {} };
}

export function load(): Saved {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return blank();
    const data = JSON.parse(raw) as Partial<Saved>;
    return { ...blank(), ...data, best: { ...(data.best ?? {}) }, introsSeen: [...(data.introsSeen ?? [])], daily: { ...(data.daily ?? {}) } };
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
