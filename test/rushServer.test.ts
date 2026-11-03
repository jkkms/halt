// The score server's decisions (worker/src/logic.ts, SPEC_rush2 §F) as pure functions: CORS origins, nickname
// claims, abuse limits, and finishing a run (the score recomputed, tampered or repeated finishes refused).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { answerCard, currentCard, nextCard, pickCard, startRush, submittedAnswers, type RushState } from '../src/core/rush.ts';
import { rushCardById, type RushVerdict } from '../src/core/rushCards.ts';
import {
  finishDecision,
  nickDecision,
  originAllowed,
  parseFinish,
  parseNickRequest,
  ranked,
  RUNS_PER_DAY,
  sha256Hex,
  START_GAP_MS,
  startLimit,
  topLimit,
  type RunRow,
} from '../worker/src/logic.ts';

const TOKEN = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** A finished run: right answers in `rights` positions, wrong elsewhere until the third wrong. */
function finishedRun(plan: ('r' | 'w')[], ms = 1500): RushState {
  let n = 0;
  const rand = (k: number) => (n++ * 7) % k;
  let st = startRush(pickCard({ position: 1, run: [], seen: [], rand }));
  for (const p of plan) {
    const v = rushCardById(currentCard(st)).verdict;
    const other: RushVerdict = v === 'ends' ? 'never' : 'ends';
    st = answerCard(st, p === 'r' ? v : other, ms, v);
    st = nextCard(st, () => pickCard({ position: st.cards.length + 1, run: st.cards, seen: [], rand }));
    if (st.phase === 'over') break;
  }
  return st;
}

describe('score server: CORS', () => {
  it('allows the game and local development only', () => {
    for (const o of ['https://halt-seven-delta.vercel.app', 'http://localhost:5173', 'http://127.0.0.1:4180', 'http://localhost']) assert.ok(originAllowed(o), o);
    for (const o of [null, '', 'https://evil.example', 'http://localhost.evil.example', 'https://localhost:5173', 'http://halt-seven-delta.vercel.app', 'https://halt-seven-delta.vercel.app.evil.example'])
      assert.ok(!originAllowed(o), String(o));
  });
});

describe('score server: nicknames', () => {
  it('a request needs a device token and a good nickname', () => {
    assert.deepEqual(parseNickRequest({ token: TOKEN, nick: '  민성 ' }), { ok: true, token: TOKEN, nick: '민성', key: '민성' });
    assert.deepEqual(parseNickRequest({ token: 'short', nick: '민성' }), { ok: false, status: 400, error: 'bad-token' });
    assert.deepEqual(parseNickRequest({ token: TOKEN, nick: 'x' }), { ok: false, status: 400, error: 'nick-length' });
    assert.deepEqual(parseNickRequest({ token: TOKEN, nick: 'fuck' }), { ok: false, status: 400, error: 'nick-blocked' });
    assert.deepEqual(parseNickRequest(null), { ok: false, status: 400, error: 'bad-token' });
  });

  it('a nickname belongs to the first token that used it', () => {
    assert.deepEqual(nickDecision(null, 'aaa'), { ok: true, claim: true });
    assert.deepEqual(nickDecision('aaa', 'aaa'), { ok: true, claim: false });
    assert.deepEqual(nickDecision('aaa', 'bbb'), { ok: false, status: 409, error: 'taken' });
  });

  it('stores a SHA-256 of the token, never the token', async () => {
    assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.notEqual(await sha256Hex(TOKEN), TOKEN);
  });
});

describe('score server: abuse limits', () => {
  it('one start per token every 3 s, at most 300 runs a day', () => {
    const now = 10_000_000;
    assert.equal(startLimit(null, 0, now), null);
    assert.deepEqual(startLimit(now - START_GAP_MS + 1, 1, now), { ok: false, status: 429, error: 'too-soon' });
    assert.equal(startLimit(now - START_GAP_MS, 1, now), null);
    assert.deepEqual(startLimit(now - 60_000, RUNS_PER_DAY, now), { ok: false, status: 429, error: 'daily-limit' });
    assert.equal(startLimit(now - 60_000, RUNS_PER_DAY - 1, now), null);
  });

  it('the top list is at most 50 long', () => {
    assert.deepEqual([topLimit(null), topLimit('5'), topLimit('500'), topLimit('-1'), topLimit('abc')], [10, 5, 10, 10, 10]);
  });
});

describe('score server: finishing a run', () => {
  const st = finishedRun(['r', 'r', 'w', 'r', 'r', 'r', 'w', 'r', 'w']);
  const answers = submittedAnswers(st);
  const totalMs = answers.reduce((a, b) => a + b.ms, 0);
  const run = (over: Partial<RunRow> = {}): RunRow => ({ token_hash: 'mine', nick_key: '민성', started_at: 1_000_000, finished_at: null, ...over });
  const later = 1_000_000 + totalMs + 30_000;

  it('a good run: the server’s own score', () => {
    assert.equal(st.phase, 'over');
    const d = finishDecision(run(), 'mine', answers, later);
    assert.ok(d.ok);
    if (d.ok) assert.deepEqual([d.result.score, d.result.cards, d.result.bestStreak], [st.score, 6, 3]);
  });

  it('refused: no such run, someone else’s run, a run finished again, answers faster than the wall clock', () => {
    assert.deepEqual(finishDecision(null, 'mine', answers, later), { ok: false, status: 404, error: 'no-run' });
    assert.deepEqual(finishDecision(run(), 'theirs', answers, later), { ok: false, status: 403, error: 'not-yours' });
    assert.deepEqual(finishDecision(run({ finished_at: later - 1 }), 'mine', answers, later), { ok: false, status: 409, error: 'finished' });
    assert.deepEqual(finishDecision(run(), 'mine', answers, 1_000_000 + totalMs - 1), { ok: false, status: 400, error: 'too-fast' });
  });

  it('refused: tampered times, wrong order, extra answers after the third wrong, unknown cards', () => {
    const fail = (a: unknown[]) => {
      const d = finishDecision(run(), 'mine', a, later);
      return d.ok ? 'ok' : d.error;
    };
    assert.equal(fail(answers.map((a, i) => (i === 1 ? { ...a, ms: 100 } : a))), 'bad-time@2');
    assert.equal(fail([answers[1], answers[0], ...answers.slice(2)]).replace(/@.*/, ''), rushCardById(answers[0]!.id).tier === rushCardById(answers[1]!.id).tier ? 'ok' : 'wrong-tier');
    assert.equal(fail([...answers, { id: answers[0]!.id, given: 'ends', ms: 900 }]), `after-end@${answers.length + 1}`);
    assert.equal(fail([{ ...answers[0]!, id: 4242 }, ...answers.slice(1)]), 'unknown-card@1');
    assert.equal(fail(answers.slice(0, -1)), 'not-over');
  });

  it('the request body: a run id, a token and a list of answers', () => {
    assert.ok(parseFinish({ runId: TOKEN, token: TOKEN, answers }).ok);
    assert.deepEqual(parseFinish({ runId: 'x', token: TOKEN, answers }), { ok: false, status: 400, error: 'bad-run' });
    assert.deepEqual(parseFinish({ runId: TOKEN, token: TOKEN, answers: 'no' }), { ok: false, status: 400, error: 'not-a-list' });
    assert.deepEqual(parseFinish({ runId: TOKEN, token: TOKEN, answers: Array(2001).fill(answers[0]) }), { ok: false, status: 400, error: 'too-long' });
  });
});

describe('score server: ranks', () => {
  it('equal scores share a rank', () => {
    const rows = [
      { nick: 'a', score: 900, cards: 6, at: 1 },
      { nick: 'b', score: 700, cards: 5, at: 2 },
      { nick: 'c', score: 700, cards: 5, at: 3 },
      { nick: 'd', score: 100, cards: 1, at: 4 },
    ];
    assert.deepEqual(
      ranked(rows).map((r) => [r.nick, r.rank]),
      [
        ['a', 1],
        ['b', 2],
        ['c', 2],
        ['d', 4],
      ],
    );
  });
});
