// Progress kept in localStorage. Every access is wrapped: the game must work without storage
// (private windows, blocked site data, thumbnails).
import type { Lang } from '../core/levels.ts';
import { checkNick, normalizeNick } from '../core/nick.ts';
import { SEEN_KEPT } from '../core/rush.ts';

export interface DailyRecord {
  level: number;
  marks: string[];
  solved: boolean;
  length: number | null;
}

/**
 * Rush mode (SPEC_rush2): the best ranked score and the best practice score on this device, the cards answered here
 * (newest last, so a new run asks unseen cards first), the nickname and the random device token for the hall of fame.
 */
export interface RushRecord {
  best: number;
  practiceBest: number;
  seen: number[];
  nick?: string;
  /** crypto.randomUUID(); only ever sent in a POST body, never shown and never put in a URL. */
  token?: string;
}

export interface Saved {
  lang?: Lang;
  best: Record<string, number>;
  /** v0.3: the 8-page tutorial was read to the end ('done') or skipped. */
  tutorial?: 'done' | 'skipped';
  /** v0.3: levels whose first visit already showed something (1: the tutorial suggestion; 5, 7, 10: their intro). */
  introsShown: number[];
  /** SPEC_guide: the level screen's tours already shown to the end or skipped ('screen', 'proof', 'result', 'never'). */
  guidesSeen?: string[];
  current?: number;
  daily: Record<string, DailyRecord>;
  muted?: boolean;
  rush: RushRecord;
}

const KEY = 'it-ends:v1';

function blank(): Saved {
  return { best: {}, introsShown: [], daily: {}, rush: { best: 0, practiceBest: 0, seen: [] } };
}

const numbers = (x: unknown): number[] => (Array.isArray(x) ? x.filter((n): n is number => typeof n === 'number') : []);

const score = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0);

/** The rush record from storage; anything odd is dropped (old saves had per-day scores of the 15-second rush). */
function rushRecord(x: unknown): RushRecord {
  const r = (x ?? {}) as Partial<RushRecord>;
  const seen = Array.isArray(r.seen) ? [...new Set(r.seen.filter((n): n is number => Number.isInteger(n)))].slice(-SEEN_KEPT) : [];
  const nick = typeof r.nick === 'string' && checkNick(r.nick).ok ? normalizeNick(r.nick) : undefined;
  const token = typeof r.token === 'string' && /^[0-9a-f-]{20,64}$/i.test(r.token) ? r.token : undefined;
  return { best: score(r.best), practiceBest: score(r.practiceBest), seen, ...(nick ? { nick } : {}), ...(token ? { token } : {}) };
}

/** Keep the better score of a ranked run or of practice; returns true when it is a new best. */
export function recordRush(rec: RushRecord, mode: 'rush' | 'practice', points: number): boolean {
  const key = mode === 'rush' ? 'best' : 'practiceBest';
  if (points <= rec[key]) return false;
  rec[key] = points;
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
      guidesSeen: Array.isArray(data.guidesSeen) ? [...new Set(data.guidesSeen.filter((x): x is string => typeof x === 'string'))] : undefined,
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
