// The hall of fame client (SPEC_rush2 §F). Only ranked rush runs talk to the server; practice never does.
// Every call can fail (no network, server not deployed yet): the game keeps working and says so.
import type { SubmittedAnswer } from '../core/rush.ts';

/** The score server. The main session fills in the deployed address; VITE_SCORES_API overrides it at build time. */
export const SCORES_API: string = ((import.meta.env.VITE_SCORES_API as string | undefined) || 'https://halt-scores.REPLACE.workers.dev').replace(/\/+$/, '');

export interface FameRow {
  rank: number;
  nick: string;
  score: number;
  cards: number;
  at: number;
}

export interface FinishResult {
  score: number;
  cards: number;
  bestStreak: number;
  /** The rank this run's score reached. */
  rank: number;
  /** The nickname's best score (this run or an earlier one) and its rank. */
  best: number;
  bestRank: number;
  newBest: boolean;
  top: FameRow[];
}

export interface MeResult {
  nick: string | null;
  best: number;
  rank: number | null;
}

/** status 0 = the server could not be reached. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const TIMEOUT_MS = 8000;

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SCORES_API}${path}`, { ...init, mode: 'cors', credentials: 'omit', signal: ctrl.signal });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) return { ok: false, status: res.status, error: body?.error ?? `http-${res.status}` };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const scores = {
  claimNick: (token: string, nick: string) => post<{ nick: string }>('/nick', { token, nick }),
  start: (token: string, nick: string) => post<{ runId: string }>('/run/start', { token, nick }),
  finish: (runId: string, token: string, answers: SubmittedAnswer[]) => post<FinishResult>('/run/finish', { runId, token, answers }),
  top: (limit = 50) => call<FameRow[]>(`/top?limit=${limit}`, { method: 'GET' }),
  me: (token: string, nick?: string) => post<MeResult>('/me', { token, nick }),
};

/** A new device token (only ever sent in POST bodies). */
export function newToken(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
