// Reference and wrong answers from the spec (kept out of the game bundle).

export interface EndsAnswer {
  V: string;
  R?: string;
}

export interface NeverAnswer {
  start: Record<string, number>;
  /** cycle: the run repeats a state; zone: needs the bottomless zone Z. */
  expect: 'cycle' | 'zone';
  Z?: string;
}

export interface WrongNever {
  start: Record<string, number>;
  expect: 'notAllowed' | 'ended';
}

export interface Answers {
  ends?: EndsAnswer[];
  wrongEnds?: EndsAnswer[];
  never?: NeverAnswer[];
  wrongNever?: WrongNever[];
}

export const ANSWERS: Record<number, Answers> = {
  1: { ends: [{ V: 'n' }], wrongEnds: [{ V: '0' }, { V: '-n' }] },
  2: { ends: [{ V: 'n-i' }], wrongEnds: [{ V: 'n' }, { V: 'i' }] },
  3: { ends: [{ V: 'hi-lo' }], wrongEnds: [{ V: 'hi' }] },
  4: { ends: [{ V: 'hi-lo' }], wrongEnds: [{ V: 'hi' }] },
  5: { never: [{ start: { n: 1 }, expect: 'zone', Z: 'i<n' }], wrongNever: [{ start: { n: 0 }, expect: 'notAllowed' }] },
  6: { ends: [{ V: 'abs(x)' }], wrongEnds: [{ V: 'x' }] },
  // 7, 11, 16 (v0.4): no loop-head facts, so the invariant must be given as a railing.
  7: { ends: [{ V: 'a+b', R: 'a>=1 && b>=1' }, { V: 'max(a,b)', R: 'a>=1 && b>=1' }], wrongEnds: [{ V: 'a+b' }, { V: 'a+b', R: 'a>=1' }, { V: 'a' }] },
  8: { never: [{ start: { x: 1 }, expect: 'zone', Z: 'x%2==1' }], wrongNever: [{ start: { x: 4 }, expect: 'ended' }] },
  9: { ends: [{ V: 'n-i', R: 'i<=n' }], wrongEnds: [{ V: 'n-i' }] },
  10: { ends: [{ V: '60*x+y' }, { V: '(x,y)' }], wrongEnds: [{ V: 'x+y' }] },
  11: { ends: [{ V: '(x,y)', R: '0<=y && y<=m' }, { V: '(x,y)', R: '0<=y && 0<=m' }], wrongEnds: [{ V: '(x,y)' }, { V: '(x,y)', R: '0<=y' }, { V: 'x+y' }] },
  12: { never: [{ start: { lo: 0, hi: 1, t: 1 }, expect: 'cycle' }], wrongNever: [{ start: { lo: 0, hi: 1, t: 0 }, expect: 'ended' }] },
  13: { ends: [{ V: '(a,b,c,d)' }, { V: '1000*a+100*b+10*c+d' }], wrongEnds: [{ V: 'a+b+c+d' }] },
  14: { ends: [{ V: 'b' }], wrongEnds: [{ V: 'a' }] },
  15: { ends: [{ V: 'x' }], wrongEnds: [{ V: '0' }] },
  16: { ends: [{ V: 'x', R: 'y>=1' }], wrongEnds: [{ V: 'x' }, { V: 'y' }] },
  17: { never: [{ start: { x: 1, y: 0 }, expect: 'cycle' }], wrongNever: [{ start: { x: 1, y: 1 }, expect: 'ended' }] },
  18: { wrongEnds: [{ V: 'n' }] },
};
