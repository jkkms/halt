// halt-scores: the rush hall of fame (SPEC_rush2 §F). A Cloudflare Worker with one D1 database (binding DB).
//
//   POST /nick        {token, nick}               → {nick}                    claim a nickname (or check it is ours)
//   POST /run/start   {token, nick}               → {runId}                   claims or checks the nickname too
//   POST /run/finish  {runId, token, answers}     → {score, cards, bestStreak, rank, best, bestRank, newBest, top}
//   GET  /top?limit=10                            → [{rank, nick, score, cards, at}]   (cached 15 s)
//   POST /me          {token, nick?}              → {nick, best, rank}
//
// The score of a run is recomputed here with the game's own rules; the client's numbers are never trusted.
// Only a SHA-256 of the device token is stored, never the token; no IP addresses are stored.

import { nickKey } from '../../src/core/nick.ts';
import {
  BODY_LIMIT,
  DAY_MS,
  finishDecision,
  nickDecision,
  originAllowed,
  parseFinish,
  parseNickRequest,
  ranked,
  sha256Hex,
  startLimit,
  tokenOk,
  topLimit,
  TOP_MAX,
  type BestRow,
  type Fail,
  type RunRow,
} from './logic.ts';

// ------------------------------------------------------------ the bits of the Workers runtime used here

interface D1Result<T> {
  results: T[];
  meta: { changes?: number };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}
interface ExecutionContext {
  waitUntil(p: Promise<unknown>): void;
}
export interface Env {
  DB: D1Database;
}

const TOP_KEY = 'https://halt-scores.cache/top';
const TOP_SECONDS = 15;

function edgeCache(): Cache | null {
  const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
  return c?.default ?? null;
}

// ------------------------------------------------------------ responses

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin', 'Cross-Origin-Resource-Policy': 'cross-origin' };
  if (origin && originAllowed(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'content-type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(data: unknown, status: number, origin: string | null, cache = 'no-store'): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, ...corsHeaders(origin) } });
}

const failed = (f: Fail, origin: string | null) => json({ error: f.error }, f.status, origin);

async function readJson(req: Request): Promise<unknown | Fail> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > BODY_LIMIT) return { ok: false, status: 413, error: 'too-big' } as Fail;
  const text = await req.text();
  if (text.length > BODY_LIMIT) return { ok: false, status: 413, error: 'too-big' } as Fail;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { ok: false, status: 400, error: 'bad-json' } as Fail;
  }
}

const isFail = (x: unknown): x is Fail => typeof x === 'object' && x !== null && (x as Fail).ok === false && typeof (x as Fail).status === 'number';

// ------------------------------------------------------------ queries

async function nickOwner(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT token_hash FROM players WHERE nick_key = ?').bind(key).first<{ token_hash: string }>();
  return row?.token_hash ?? null;
}

/** Claim the nickname for this token if nobody has it; fails when another device has it. */
async function claimNick(db: D1Database, nick: string, key: string, tokenHash: string, now: number): Promise<Fail | null> {
  const d = nickDecision(await nickOwner(db, key), tokenHash);
  if (!d.ok) return d;
  if (!d.claim) return null;
  await db.prepare('INSERT INTO players (nick_key, nick, token_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(nick_key) DO NOTHING').bind(key, nick, tokenHash, now).run();
  // two devices racing for the same name: only the row that landed counts
  const again = nickDecision(await nickOwner(db, key), tokenHash);
  return again.ok ? null : again;
}

async function rankOf(db: D1Database, score: number, exceptKey: string | null): Promise<number> {
  const row = exceptKey
    ? await db.prepare('SELECT COUNT(*) AS n FROM best WHERE score > ? AND nick_key != ?').bind(score, exceptKey).first<{ n: number }>()
    : await db.prepare('SELECT COUNT(*) AS n FROM best WHERE score > ?').bind(score).first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

async function topRows(db: D1Database): Promise<ReturnType<typeof ranked>> {
  const { results } = await db.prepare('SELECT nick, score, cards, at FROM best ORDER BY score DESC, at ASC LIMIT ?').bind(TOP_MAX).all<BestRow>();
  return ranked(results);
}

// ------------------------------------------------------------ routes

async function postNick(req: Request, env: Env, origin: string | null): Promise<Response> {
  const body = await readJson(req);
  if (isFail(body)) return failed(body, origin);
  const p = parseNickRequest(body);
  if (!p.ok) return failed(p, origin);
  const f = await claimNick(env.DB, p.nick, p.key, await sha256Hex(p.token), Date.now());
  return f ? failed(f, origin) : json({ nick: p.nick }, 200, origin);
}

async function runStart(req: Request, env: Env, origin: string | null): Promise<Response> {
  const body = await readJson(req);
  if (isFail(body)) return failed(body, origin);
  const p = parseNickRequest(body);
  if (!p.ok) return failed(p, origin);
  const now = Date.now();
  const tokenHash = await sha256Hex(p.token);
  const f = await claimNick(env.DB, p.nick, p.key, tokenHash, now);
  if (f) return failed(f, origin);
  const lim = await env.DB.prepare('SELECT MAX(started_at) AS last, SUM(CASE WHEN started_at > ? THEN 1 ELSE 0 END) AS today FROM runs WHERE token_hash = ?')
    .bind(now - DAY_MS, tokenHash)
    .first<{ last: number | null; today: number | null }>();
  const limited = startLimit(lim?.last ?? null, lim?.today ?? 0, now);
  if (limited) return failed(limited, origin);
  const runId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO runs (id, token_hash, nick_key, started_at) VALUES (?, ?, ?, ?)').bind(runId, tokenHash, p.key, now).run();
  return json({ runId }, 200, origin);
}

async function runFinish(req: Request, env: Env, ctx: ExecutionContext, origin: string | null): Promise<Response> {
  const body = await readJson(req);
  if (isFail(body)) return failed(body, origin);
  const p = parseFinish(body);
  if (!p.ok) return failed(p, origin);
  const now = Date.now();
  const tokenHash = await sha256Hex(p.token);
  const run = await env.DB.prepare('SELECT token_hash, nick_key, started_at, finished_at FROM runs WHERE id = ?').bind(p.runId).first<RunRow>();
  const d = finishDecision(run, tokenHash, p.answers, now);
  if (!d.ok) return failed(d, origin);
  const r = d.result;
  const done = await env.DB.prepare('UPDATE runs SET finished_at = ?, score = ?, cards = ?, best_streak = ? WHERE id = ? AND finished_at IS NULL').bind(now, r.score, r.cards, r.bestStreak, p.runId).run();
  if (done.meta.changes !== undefined && done.meta.changes !== 1) return failed({ ok: false, status: 409, error: 'finished' }, origin);
  const key = run!.nick_key;
  const nick = (await env.DB.prepare('SELECT nick FROM players WHERE nick_key = ?').bind(key).first<{ nick: string }>())?.nick ?? key;
  const before = (await env.DB.prepare('SELECT score FROM best WHERE nick_key = ?').bind(key).first<{ score: number }>())?.score ?? null;
  const newBest = before === null || r.score > before;
  if (newBest) {
    await env.DB.prepare(
      'INSERT INTO best (nick_key, nick, score, cards, best_streak, at) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(nick_key) DO UPDATE SET nick = excluded.nick, score = excluded.score, cards = excluded.cards, best_streak = excluded.best_streak, at = excluded.at WHERE excluded.score > best.score',
    )
      .bind(key, nick, r.score, r.cards, r.bestStreak, now)
      .run();
    const cache = edgeCache();
    if (cache) ctx.waitUntil(cache.delete(TOP_KEY));
  }
  const best = newBest ? r.score : before!;
  return json(
    {
      score: r.score,
      cards: r.cards,
      bestStreak: r.bestStreak,
      rank: await rankOf(env.DB, r.score, key),
      best,
      bestRank: await rankOf(env.DB, best, null),
      newBest,
      top: await topRows(env.DB),
    },
    200,
    origin,
  );
}

async function getTop(url: URL, env: Env, ctx: ExecutionContext, origin: string | null): Promise<Response> {
  const limit = topLimit(url.searchParams.get('limit'));
  const cache = edgeCache();
  const key = new Request(TOP_KEY);
  let rows: ReturnType<typeof ranked> | null = null;
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) rows = (await hit.json()) as ReturnType<typeof ranked>;
  if (!rows) {
    rows = await topRows(env.DB);
    if (cache) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TOP_SECONDS}` } })));
  }
  return json(rows.slice(0, limit), 200, origin, `public, max-age=${TOP_SECONDS}`);
}

async function postMe(req: Request, env: Env, origin: string | null): Promise<Response> {
  const body = (await readJson(req)) as Record<string, unknown> | Fail;
  if (isFail(body)) return failed(body, origin);
  if (!tokenOk(body.token)) return failed({ ok: false, status: 400, error: 'bad-token' }, origin);
  const tokenHash = await sha256Hex(body.token);
  let key: string | null = null;
  if (typeof body.nick === 'string') {
    const k = nickKey(body.nick);
    if ((await nickOwner(env.DB, k)) === tokenHash) key = k;
  }
  if (!key) key = (await env.DB.prepare('SELECT nick_key FROM players WHERE token_hash = ? ORDER BY created_at DESC LIMIT 1').bind(tokenHash).first<{ nick_key: string }>())?.nick_key ?? null;
  if (!key) return json({ nick: null, best: 0, rank: null }, 200, origin);
  const nick = (await env.DB.prepare('SELECT nick FROM players WHERE nick_key = ?').bind(key).first<{ nick: string }>())?.nick ?? key;
  const best = (await env.DB.prepare('SELECT score FROM best WHERE nick_key = ?').bind(key).first<{ score: number }>())?.score ?? null;
  return json({ nick, best: best ?? 0, rank: best === null ? null : await rankOf(env.DB, best, null) }, 200, origin);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: originAllowed(origin) ? 204 : 403, headers: corsHeaders(origin) });
    const url = new URL(req.url);
    try {
      switch (`${req.method} ${url.pathname}`) {
        case 'GET /':
          return json({ name: 'halt-scores' }, 200, origin);
        case 'GET /top':
          return await getTop(url, env, ctx, origin);
        case 'POST /nick':
          return await postNick(req, env, origin);
        case 'POST /run/start':
          return await runStart(req, env, origin);
        case 'POST /run/finish':
          return await runFinish(req, env, ctx, origin);
        case 'POST /me':
          return await postMe(req, env, origin);
        default:
          return json({ error: 'not-found' }, 404, origin);
      }
    } catch (e) {
      console.error(e);
      return json({ error: 'server' }, 500, origin);
    }
  },
};
