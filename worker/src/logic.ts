// The score server's decisions as pure functions (SPEC_rush2 §F), so `npm test` checks them without a database.
// The score of a run is always recomputed here with the game's own rules (src/core/rush.ts).

import { checkNick } from '../../src/core/nick.ts';
import { checkRun, MAX_ANSWERS, type RunCheck } from '../../src/core/rush.ts';

/** Requests larger than this are refused before they are parsed. */
export const BODY_LIMIT = 100_000;
/** One /run/start per token at most every this many ms … */
export const START_GAP_MS = 3000;
/** … and at most this many runs per token in 24 hours. */
export const RUNS_PER_DAY = 300;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const TOP_DEFAULT = 50;
export const TOP_MAX = 50;

export const ALLOWED_ORIGINS = ['https://halt-seven-delta.vercel.app'];

/** The game's address, and any local port for development. */
export function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** A device token: crypto.randomUUID() (accepts any hex-and-dash string of a sensible length). */
export function tokenOk(x: unknown): x is string {
  return typeof x === 'string' && /^[0-9a-f-]{20,64}$/i.test(x);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Body of POST /run/start and POST /nick. */
export function parseNickRequest(body: unknown): { ok: true; token: string; nick: string; key: string } | Fail {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!tokenOk(b.token)) return fail(400, 'bad-token');
  const n = checkNick(b.nick);
  if (!n.ok) return fail(400, `nick-${n.problem}`);
  return { ok: true, token: b.token, nick: n.nick, key: n.key };
}

/** Who owns a nickname: nobody yet (claim it), this token, or another device. */
export function nickDecision(owner: string | null, tokenHash: string): { ok: true; claim: boolean } | Fail {
  if (owner === null) return { ok: true, claim: true };
  if (owner === tokenHash) return { ok: true, claim: false };
  return fail(409, 'taken');
}

/** Abuse limits for /run/start: the last start of this token and how many runs it started in the last 24 hours. */
export function startLimit(lastStart: number | null, runsToday: number, now: number): Fail | null {
  if (lastStart !== null && now - lastStart < START_GAP_MS) return fail(429, 'too-soon');
  if (runsToday >= RUNS_PER_DAY) return fail(429, 'daily-limit');
  return null;
}

/** Body of POST /run/finish. */
export function parseFinish(body: unknown): { ok: true; runId: string; token: string; answers: unknown[] } | Fail {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.runId !== 'string' || !/^[0-9a-f-]{20,64}$/i.test(b.runId)) return fail(400, 'bad-run');
  if (!tokenOk(b.token)) return fail(400, 'bad-token');
  if (!Array.isArray(b.answers)) return fail(400, 'not-a-list');
  if (b.answers.length > MAX_ANSWERS) return fail(400, 'too-long');
  return { ok: true, runId: b.runId, token: b.token, answers: b.answers };
}

export interface RunRow {
  token_hash: string;
  nick_key: string;
  started_at: number;
  finished_at: number | null;
}

/**
 * May this run be finished with these answers? The run must exist, belong to this token and not be finished yet;
 * the answers must pass the game's rules (checkRun); and the wall time since /run/start must cover every answer.
 */
export function finishDecision(run: RunRow | null, tokenHash: string, answers: unknown[], now: number): { ok: true; result: Extract<RunCheck, { ok: true }> } | Fail {
  if (!run) return fail(404, 'no-run');
  if (run.token_hash !== tokenHash) return fail(403, 'not-yours');
  if (run.finished_at !== null) return fail(409, 'finished');
  const r = checkRun(answers);
  if (!r.ok) return fail(400, r.at ? `${r.reason}@${r.at}` : r.reason);
  if (now - run.started_at < r.totalMs) return fail(400, 'too-fast');
  return { ok: true, result: r };
}

export function topLimit(raw: string | null): number {
  const n = Number(raw ?? TOP_DEFAULT);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, TOP_MAX) : TOP_DEFAULT;
}

export interface BestRow {
  nick: string;
  score: number;
  cards: number;
  at: number;
}

/** Ranks with ties: equal scores share a rank (1, 2, 2, 4). Rows come sorted by score, then time. */
export function ranked(rows: BestRow[]): (BestRow & { rank: number })[] {
  let rank = 0;
  let prev: number | null = null;
  return rows.map((r, i) => {
    if (r.score !== prev) {
      rank = i + 1;
      prev = r.score;
    }
    return { rank, nick: r.nick, score: r.score, cards: r.cards, at: r.at };
  });
}
