// Reference proofs for the rush cards (kept out of the game bundle, like test/answers.ts).
// ends: steps left V (and a railing R where the start condition matters), checked by the real judge.
// never: an allowed start whose run repeats a state (cycle), or a start and a bottomless zone Z checked by the judge.
// The 32 hand-written cards are here; the generated bank's proofs are in rushBankAnswers.ts.

import type { EndsAnswer } from './answers.ts';
import { BANK_ANSWERS } from './rushBankAnswers.ts';

export type RushNever = { start: Record<string, number>; expect: 'cycle' } | { start: Record<string, number>; expect: 'zone'; Z: string };
export type RushProof = { ends?: EndsAnswer; never?: RushNever };

const HAND_ANSWERS: Record<number, RushProof> = {
  202: { never: { start: { x: 1 }, expect: 'zone', Z: 'x > 0' } },
  237: { ends: { V: '-x' } },
  203: { ends: { V: '10 - k' } },
  204: { never: { start: { k: 9 }, expect: 'zone', Z: 'k < 10' } },
  205: { ends: { V: 'n' } },
  206: { never: { start: { n: 1, m: 0 }, expect: 'zone', Z: 'n > 0' } },
  207: { never: { start: { x: 1 }, expect: 'zone', Z: 'x != 0' } },
  208: { ends: { V: 'a' } },
  209: { never: { start: { a: 0, b: 1 }, expect: 'zone', Z: 'b > 0' } },
  213: { ends: { V: '10 - x' } },
  238: { never: { start: { x: 0 }, expect: 'cycle' } },
  214: { never: { start: { x: 3 }, expect: 'cycle' } },
  215: { ends: { V: 'x' } },
  216: { ends: { V: 'x' } },
  217: { never: { start: { x: 0 }, expect: 'cycle' } },
  218: { never: { start: { x: 1 }, expect: 'zone', Z: 'x % 3 != 0' } },
  // x % 3 = 1 → 2 steps left, x % 3 = 2 → 1 step left
  219: { ends: { V: '(-x) % 3' } },
  220: { ends: { V: '8 - x' } },
  221: { never: { start: { x: 3 }, expect: 'cycle' } },
  222: { ends: { V: 'a - b' } },
  223: { never: { start: { a: 1, b: 0 }, expect: 'cycle' } },
  224: { ends: { V: 'abs(a - b)' } },
  225: { ends: { V: '100 - x', R: 'x >= 2' } },
  226: { never: { start: { x: 1 }, expect: 'cycle' } },
  227: { ends: { V: 't - s', R: 'd >= 1' } },
  228: { never: { start: { s: 0, t: 1, d: 0 }, expect: 'cycle' } },
  231: { ends: { V: 'x' } },
  232: { never: { start: { x: 0, y: 1 }, expect: 'zone', Z: 'y > 0' } },
  // below 3: up to 10 first (a floor down); above 3: one step down at a time
  233: { ends: { V: '(max(0, 3 - x), max(0, x - 3))' } },
  234: { never: { start: { x: 0 }, expect: 'cycle' } },
  235: { never: { start: { x: 3 }, expect: 'cycle' } },
  236: { ends: { V: '10 - x' } },
};

export const RUSH_ANSWERS: Record<number, RushProof> = { ...HAND_ANSWERS, ...BANK_ANSWERS };
