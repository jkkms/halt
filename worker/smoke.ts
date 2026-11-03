// Runs the score server end to end against a local `wrangler dev --local` (never the deployed one by default):
//   cd worker && npx wrangler@4 d1 execute halt-scores --local --file=schema.sql
//   npx wrangler@4 dev --local --port 8787 &
//   node smoke.ts http://127.0.0.1:8787
// start → finish → top → me, a higher and a lower second run, and the cases that must fail.
import assert from 'node:assert/strict';
import { answerCard, currentCard, nextCard, pickCard, startRush, submittedAnswers, type SubmittedAnswer } from '../src/core/rush.ts';
import { rushCardById, type RushVerdict } from '../src/core/rushCards.ts';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const ORIGIN = 'http://localhost:4180';
const stamp = Date.now().toString(36).slice(-5);
const NICK = `smoke${stamp}`;
const tokenA = crypto.randomUUID();
const tokenB = crypto.randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let checks = 0;

async function req(method: string, path: string, body?: unknown, origin = ORIGIN): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { origin, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

function expect(name: string, got: { status: number; json: any }, status: number, error?: string) {
  checks++;
  assert.equal(got.status, status, `${name}: ${JSON.stringify(got.json)}`);
  if (error) assert.equal(got.json?.error, error, name);
  console.log(`ok   ${name} → ${status}${error ? ` ${error}` : ''}`);
}

/** A run as the game plays it: `plan` of right / wrong answers until the third wrong, each taking `ms`. */
function run(plan: ('r' | 'w')[], ms: number, seed: number): { answers: SubmittedAnswer[]; score: number } {
  let n = seed;
  const rand = (k: number) => (n = (n * 1103515245 + 12345) % 2147483648) % k;
  let st = startRush(pickCard({ position: 1, run: [], seen: [], rand }));
  for (const p of plan) {
    const v = rushCardById(currentCard(st)).verdict;
    const other: RushVerdict = v === 'ends' ? 'never' : 'ends';
    st = answerCard(st, p === 'r' ? v : other, ms, v);
    st = nextCard(st, () => pickCard({ position: st.cards.length + 1, run: st.cards, seen: [], rand }));
    if (st.phase === 'over') break;
  }
  assert.equal(st.phase, 'over');
  return { answers: submittedAnswers(st), score: st.score };
}

const totalMs = (a: SubmittedAnswer[]) => a.reduce((s, x) => s + x.ms, 0);

// ------------------------------------------------------------ CORS
{
  const ok = await fetch(`${BASE}/run/start`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  checks++;
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  console.log('ok   CORS preflight from localhost → 204 with Access-Control-Allow-Origin');
  const vercel = await req('GET', '/top', undefined, 'https://halt-seven-delta.vercel.app');
  checks++;
  assert.equal(vercel.headers.get('access-control-allow-origin'), 'https://halt-seven-delta.vercel.app');
  console.log('ok   CORS for the game’s address');
  const evil = await fetch(`${BASE}/run/start`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  checks++;
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  console.log('ok   CORS preflight from another site → 403, no Access-Control-Allow-Origin');
}

// ------------------------------------------------------------ nicknames
expect('nick: too short', await req('POST', '/nick', { token: tokenA, nick: 'x' }), 400, 'nick-length');
expect('nick: blocked word', await req('POST', '/nick', { token: tokenA, nick: 'fuck1' }), 400, 'nick-blocked');
expect('nick: bad characters', await req('POST', '/nick', { token: tokenA, nick: 'a<b>' }), 400, 'nick-chars');
expect('nick: bad token', await req('POST', '/nick', { token: 'nope', nick: NICK }), 400, 'bad-token');
expect('nick: claimed by device A', await req('POST', '/nick', { token: tokenA, nick: NICK }), 200);
expect('nick: device A again', await req('POST', '/nick', { token: tokenA, nick: NICK }), 200);
expect('nick: taken for device B', await req('POST', '/nick', { token: tokenB, nick: NICK }), 409, 'taken');
expect('nick: taken whatever the case', await req('POST', '/nick', { token: tokenB, nick: NICK.toUpperCase() }), 409, 'taken');
expect('run/start: taken nick for device B', await req('POST', '/run/start', { token: tokenB, nick: NICK }), 409, 'taken');

// ------------------------------------------------------------ a ranked run
const first = run(['r', 'r', 'w', 'r', 'w', 'r', 'r', 'w'], 300, 7);
const s1 = await req('POST', '/run/start', { token: tokenA, nick: NICK });
expect('run/start', s1, 200);
const runId1: string = s1.json.runId;
expect('run/start again within 3 s', await req('POST', '/run/start', { token: tokenA, nick: NICK }), 429, 'too-soon');
expect('run/finish faster than the wall clock', await req('POST', '/run/finish', { runId: runId1, token: tokenA, answers: first.answers }), 400, 'too-fast');
await sleep(totalMs(first.answers) + 200);
expect('run/finish with someone else’s token', await req('POST', '/run/finish', { runId: runId1, token: tokenB, answers: first.answers }), 403, 'not-yours');
expect('run/finish with a tampered time', await req('POST', '/run/finish', { runId: runId1, token: tokenA, answers: first.answers.map((a, i) => (i === 0 ? { ...a, ms: 120 } : a)) }), 400, 'bad-time@1');
expect('run/finish with an answer after the third wrong', await req('POST', '/run/finish', { runId: runId1, token: tokenA, answers: [...first.answers, { ...first.answers[0]!, ms: 900 }] }), 400, `after-end@${first.answers.length + 1}`);
expect('run/finish with an unknown card', await req('POST', '/run/finish', { runId: runId1, token: tokenA, answers: [{ ...first.answers[0]!, id: 4242 }, ...first.answers.slice(1)] }), 400, 'unknown-card@1');
const wrongOrder = [...first.answers];
const j = wrongOrder.findIndex((a) => rushCardById(a.id).tier !== rushCardById(wrongOrder[0]!.id).tier);
[wrongOrder[0], wrongOrder[j]] = [wrongOrder[j]!, wrongOrder[0]!];
expect('run/finish in the wrong order of tiers', await req('POST', '/run/finish', { runId: runId1, token: tokenA, answers: wrongOrder }), 400, 'wrong-tier@1');
expect('run/finish that stops before the third wrong', await req('POST', '/run/finish', { runId: runId1, token: tokenA, answers: first.answers.slice(0, -1) }), 400, 'not-over');
expect('run/finish of a run that does not exist', await req('POST', '/run/finish', { runId: 'f'.repeat(36), token: tokenA, answers: first.answers }), 404, 'no-run');
const f1 = await req('POST', '/run/finish', { runId: runId1, token: tokenA, answers: first.answers, score: 999999 });
expect('run/finish', f1, 200);
checks++;
assert.equal(f1.json.score, first.score, 'the server computed the same score as the game');
assert.equal(f1.json.newBest, true);
assert.ok(f1.json.top.some((r: any) => r.nick === NICK && r.score === first.score));
console.log(`ok   finish: score ${f1.json.score} (as the game), rank ${f1.json.rank}, best ${f1.json.best}`);
expect('run/finish the same run again', await req('POST', '/run/finish', { runId: runId1, token: tokenA, answers: first.answers }), 409, 'finished');

// ------------------------------------------------------------ top and me
const top = await req('GET', '/top?limit=10');
expect('top', top, 200);
checks++;
assert.ok(Array.isArray(top.json) && top.json.length <= 50);
assert.match(top.headers.get('cache-control') ?? '', /max-age=15/);
assert.ok(top.json.every((r: any, i: number, a: any[]) => i === 0 || a[i - 1].score >= r.score), 'sorted by score');
console.log(`ok   top: ${top.json.length} rows, cached 15 s`);
const me = await req('POST', '/me', { token: tokenA });
expect('me', me, 200);
checks++;
assert.deepEqual([me.json.nick, me.json.best], [NICK, first.score]);
console.log(`ok   me: ${me.json.nick}, best ${me.json.best}, rank ${me.json.rank}`);
const nobody = await req('POST', '/me', { token: tokenB });
checks++;
assert.deepEqual(nobody.json, { nick: null, best: 0, rank: null });
console.log('ok   me for a device without a nickname');

// ------------------------------------------------------------ a higher, then a lower run
await sleep(3100);
const higher = run(['r', 'r', 'r', 'r', 'r', 'r', 'w', 'r', 'r', 'r', 'w', 'r', 'w'], 250, 9);
assert.ok(higher.score > first.score);
const s2 = await req('POST', '/run/start', { token: tokenA, nick: NICK });
expect('run/start (second run)', s2, 200);
await sleep(totalMs(higher.answers) + 200);
const f2 = await req('POST', '/run/finish', { runId: s2.json.runId, token: tokenA, answers: higher.answers });
expect('run/finish (higher)', f2, 200);
checks++;
assert.deepEqual([f2.json.score, f2.json.best, f2.json.newBest], [higher.score, higher.score, true]);
console.log(`ok   a higher run raises the best: ${first.score} → ${f2.json.best}`);
await sleep(3100);
const lower = run(['w', 'r', 'w', 'w'], 400, 3);
const s3 = await req('POST', '/run/start', { token: tokenA, nick: NICK });
await sleep(totalMs(lower.answers) + 200);
const f3 = await req('POST', '/run/finish', { runId: s3.json.runId, token: tokenA, answers: lower.answers });
expect('run/finish (lower)', f3, 200);
checks++;
assert.deepEqual([f3.json.score, f3.json.best, f3.json.newBest], [lower.score, higher.score, false]);
console.log(`ok   a lower run (${lower.score}) leaves the best at ${f3.json.best}`);
const me2 = await req('POST', '/me', { token: tokenA, nick: NICK });
checks++;
assert.equal(me2.json.best, higher.score);
console.log('ok   me after three runs');

// ------------------------------------------------------------ limits
expect('a body over 100 KB', await req('POST', '/run/finish', JSON.stringify({ runId: runId1, token: tokenA, answers: [], pad: 'x'.repeat(120_000) })), 413, 'too-big');
expect('not JSON', await req('POST', '/nick', '{nope'), 400, 'bad-json');
expect('unknown path', await req('GET', '/admin'), 404, 'not-found');

console.log(`\n${checks} checks passed against ${BASE}`);
