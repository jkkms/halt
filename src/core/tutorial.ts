// The tutorial (8 pages, one flow) and the two short intros before level 7 (railing) and level 10 (floors).
// Plain data plus a pure scene builder, so every page is checked by `npm test` (the runs it shows really
// do what the narration says). Every program shown here is a tutorial-only program (TUTORIAL_PROGRAMS),
// never a level. Texts are the spec's (SPEC_v0.3 §3, §4) word for word; **bold** and `code` are markup.

import { parseV } from './game.ts';
import { TUTORIAL_PROGRAMS, type Level, type Text, type TutorialKey } from './levels.ts';
import { initialState, simulate, startAllowed, SIM_CAP, type State } from './sim.ts';
import { DRAW_MAX, ringScene, runScene, sceneBase, stairsWithV, type StageScene } from './stage.ts';

type Start = Record<string, number>;

export type TutScene =
  | { k: 'idle'; prog?: TutorialKey }
  /**
   * A run of a tutorial program. `start` gives the inputs (the initialization runs as usual); `at` instead
   * gives a loop-head state as it is (for a state the real program never reaches, such as k = −5).
   * With V the stairs are drawn at height V; without V at the real number of steps left.
   */
  | { k: 'run'; prog: TutorialKey; start?: Start; at?: Start; V?: string; max?: number; ghost?: Start; railing?: string }
  | { k: 'cycle'; prog: TutorialKey; start: Start };

/** Labels pinned to the stage. */
export type Callout = 'ground' | 'basement' | 'walker' | 'door' | 'stair';

/** One scene of a page. A page with several shots plays them one after another, again and again. */
export interface Shot {
  scene: TutScene;
  /** Caption under the stage. */
  label?: Text;
  /** A short name for its button when a page has several shots. */
  tag?: Text;
  callouts?: Callout[];
}

/** Extra content under the narration. */
export type Extra = 'verdicts' | 'tryV' | 'chips' | 'levelCard';

export interface TutPage {
  text: Text;
  shots: Shot[];
  /** Show this program's code beside the stage (lines light up as the walker moves). */
  code?: TutorialKey;
  extra?: Extra;
  /** Wide shot: the camera further away. */
  wide?: boolean;
}

export interface Intro {
  /** The level this intro comes before. */
  level: number;
  title: Text;
  pages: TutPage[];
}

export const HOOK: Text = { ko: '이 반복문, 끝나긴 할까?', en: 'Will this loop ever end?' };

export const PURPOSE: Text = {
  ko: "프로그램이 맞다는 증명은 두 조각입니다. '끝나면 결과가 맞다'(부분 정확성, 루프 불변식)와 '반드시 끝난다'(종료). Halt?는 뒤 조각을 연습하는 게임입니다. 반복문 18개가 끝나는지 하나씩 판정하고, 끝난다면 남은 계단 수(반복이 앞으로 몇 번 남았는지 세는 식)로, 안 끝난다면 영원히 도는 시작값으로 증명합니다. 증명은 Z3가 검사합니다. 끝나는지 아무도 모르는 반복문도 하나 있습니다.",
  en: "A proof that a program is correct has two pieces: 'if it ends, the result is right' (partial correctness, loop invariants) and 'it does end' (termination). Halt? is a game for practising the second piece. Judge 18 loops one by one: does it end? If it does, prove it by writing the steps left (an expression that counts how many more times the loop will run); if it does not, prove it with a start that runs forever. Z3 checks every proof. And one loop is in here that nobody knows the answer to.",
};

const C: TutorialKey = 'countdown';

/** The 8 pages (SPEC_v0.3 §3). Pages 2, 4, 5 and 7 use the countdown, which is level 1's program on purpose. */
export const TUTORIAL: TutPage[] = [
  {
    text: {
      ko: '**Halt?에 오신 여러분, 환영합니다!** 이 게임은 프로그램의 반복문(while)이 언젠가 끝나는지 알아맞히고, 왜 그런지 보여 주는 퍼즐이에요. 목표는 반복문 18개를 하나씩 판정하고 증명하는 거예요.',
      en: "**Welcome to Halt?!** This is a puzzle game about telling whether a program's loop (while) eventually ends, and showing why. Your goal is to judge and prove 18 loops, one by one.",
    },
    shots: [{ scene: { k: 'run', prog: C, start: { n: 5 } } }],
    wide: true,
  },
  {
    text: {
      ko: '반복문을 계단을 내려가는 사람이라고 생각해 봐요. 반복을 한 번 돌 때마다 한 칸 내려가고, 반복이 끝나면 출구로 나가요.',
      en: 'Think of a loop as a person walking down stairs. Each time the loop runs once, they go down one stair; when the loop ends, they leave by the exit.',
    },
    shots: [{ scene: { k: 'run', prog: C, start: { n: 3 } }, callouts: ['walker', 'stair', 'door'] }],
    code: C,
  },
  {
    text: {
      ko: "**1단계 · 판정.** 레벨마다 먼저 골라요. '끝난다'는 어떤 값으로 시작해도 언젠가 출구에 닿는다는 뜻, '안 끝난다'는 영원히 걷게 되는 시작값이 하나라도 있다는 뜻이에요.",
      en: '**Step 1 · Verdict.** In each level you first choose. "It ends" means that from any start the walker reaches the exit; "It never ends" means some start makes them walk forever.',
    },
    shots: [
      { scene: { k: 'run', prog: C, start: { n: 3 } }, label: { ko: '끝난다: 출구에 닿아요', en: 'It ends: the walker reaches the exit' }, tag: { ko: '끝난다', en: 'It ends' } },
      { scene: { k: 'cycle', prog: 'flip', start: { x: 2 } }, label: { ko: '안 끝난다: 영원히 걸어요', en: 'It never ends: the walker walks forever' }, tag: { ko: '안 끝난다', en: 'It never ends' } },
    ],
    extra: 'verdicts',
  },
  {
    text: {
      ko: '**2단계 · 증명(끝난다).** 반복이 앞으로 몇 번 남았는지 세는 식을 써요. 이 반복문은 n이 1씩 줄다가 0이 되면 멈추니까, 남은 계단 수는 `n`이에요. 게임은 이 값만큼의 높이로 계단을 그려요. 직접 `n`을 입력해 보세요.',
      en: '**Step 2 · Proof (it ends).** Write an expression that counts how many more times the loop will run. This loop lowers n by 1 and stops at 0, so the steps left are `n`. The game draws each stair at that height. Try typing `n`.',
    },
    shots: [{ scene: { k: 'run', prog: C, start: { n: 3 }, V: 'n' }, label: { ko: '남은 계단 수 = n', en: 'steps left = n' } }],
    code: C,
    extra: 'tryV',
  },
  {
    text: {
      ko: '정확한 횟수가 아니어도 괜찮아요. 판정기는 두 가지만 봐요. ① 한 번 돌 때마다 줄어드는가 — 안 줄면 계단이 평평해요. ② 걷는 동안 0 밑으로 안 내려가는가 — 내려가면 지하로 떨어져요. 이런 식을 ranking function이라고 불러요.',
      en: 'It need not be the exact count. The judge checks only two things: ① does it go down every time the loop runs? (if not, the stairs are flat) ② does it stay at 0 or above while walking? (if not, the walker falls into the basement). Such an expression is called a ranking function.',
    },
    shots: [
      { scene: { k: 'run', prog: C, start: { n: 3 }, V: '0' }, label: { ko: '남은 계단 수 = 0: 계단이 평평해요 (①)', en: 'steps left = 0: the stairs are flat (①)' }, tag: { ko: '0', en: '0' } },
      {
        scene: { k: 'run', prog: C, start: { n: 3 }, V: '-n' },
        label: { ko: '남은 계단 수 = −n: 지하로 떨어져요 (②)', en: 'steps left = −n: into the basement (②)' },
        tag: { ko: '−n', en: '−n' },
        callouts: ['ground', 'basement'],
      },
      { scene: { k: 'run', prog: C, start: { n: 3 }, V: 'n' }, label: { ko: '남은 계단 수 = n: ①② 모두 통과', en: 'steps left = n: passes ① and ②' }, tag: { ko: 'n', en: 'n' } },
    ],
    code: C,
  },
  {
    text: {
      ko: '**2단계 · 증명(안 끝난다).** 영원히 걷게 되는 시작값 하나를 주면 돼요. x = 2면 2, −1, 2, −1, … 같은 자리를 맴돌아요.',
      en: '**Step 2 · Proof (it never ends).** Give one start value that walks forever. From x = 2 the values go 2, −1, 2, −1, … around the same spot.',
    },
    shots: [{ scene: { k: 'cycle', prog: 'flip', start: { x: 2 } }, label: { ko: '시작값 x = 2: 같은 자리를 맴돌아요', en: 'start x = 2: around the same spot' } }],
    code: 'flip',
  },
  {
    text: {
      ko: '식에는 그 레벨의 변수, 숫자, + − * / %, 괄호, abs·min·max를 쓸 수 있어요. 변수 버튼을 누르면 바로 입력돼요.',
      en: "You can use the level's variables, numbers, + − * / %, parentheses, abs, min and max. Tap a variable button to insert it.",
    },
    shots: [{ scene: { k: 'run', prog: C, start: { n: 3 }, V: 'n' }, label: { ko: '남은 계단 수 = n', en: 'steps left = n' } }],
    code: C,
    extra: 'chips',
  },
  {
    text: { ko: '이제 레벨 1에서 직접 해 봐요!', en: 'Now try level 1 yourself!' },
    shots: [{ scene: { k: 'run', prog: C, start: { n: 5 } } }],
    wide: true,
    extra: 'levelCard',
  },
];

const R: TutorialKey = 'railing';
const F: TutorialKey = 'floors';

/**
 * The short intros (SPEC_v0.3 §4), shown the first time level 7 / level 10 is opened. The railing intro comes
 * before level 7, the first level whose proof needs a railing (SPEC_v0.4 §G).
 */
export const INTROS: Record<number, Intro> = {
  7: {
    level: 7,
    title: { ko: '난간', en: 'Railing' },
    pages: [
      {
        text: {
          ko: "남은 계단 수는 `k`예요. 그런데 판정기는 '혹시 k가 −5라면?' 하고 의심해요. 그러면 반복이 계속되는데 0 밑이거든요.",
          en: 'The steps left are `k`. But the judge asks: what if k were −5? Then the loop keeps going below zero.',
        },
        shots: [
          { scene: { k: 'run', prog: R, start: {}, V: 'k' }, label: { ko: '실제 실행: k = 10에서 출발', en: 'The real run: from k = 10' }, tag: { ko: 'k = 10', en: 'k = 10' } },
          {
            scene: { k: 'run', prog: R, at: { k: -5 }, V: 'k', max: 5 },
            label: { ko: '판정기의 의심: k = −5라면? 지하로 떨어져요', en: 'The judge asks: what if k = −5? Into the basement' },
            tag: { ko: 'k = −5', en: 'k = −5' },
            callouts: ['ground', 'basement'],
          },
        ],
        code: R,
      },
      {
        text: {
          ko: '실제로 k는 10에서 시작해 늘 0 이상이에요. 이 사실을 **난간** `k >= 0`으로 알려 주면 증명이 돼요. 난간은 시작할 때 참이고 한 걸음 뒤에도 참이어야 해요.',
          en: 'In fact k starts at 10 and never goes below 0. Tell the judge with a **railing** `k >= 0` and the proof goes through. A railing must hold at the start and still hold one step later.',
        },
        shots: [
          {
            scene: { k: 'run', prog: R, start: {}, V: 'k', railing: 'k >= 0', ghost: { k: -5 } },
            label: { ko: '난간 k ≥ 0: k = −5는 난간 밖이에요', en: 'Railing k ≥ 0: k = −5 is outside it' },
            tag: { ko: '난간 밖의 k = −5', en: 'k = −5 outside' },
          },
          { scene: { k: 'run', prog: R, start: {}, V: 'k', railing: 'k >= 0' }, label: { ko: '난간 안에서는 남은 계단 수 k로 증명 끝', en: 'Inside the railing, steps left k is a proof' }, tag: { ko: '난간 안', en: 'inside' } },
        ],
        code: R,
      },
    ],
  },
  10: {
    level: 10,
    title: { ko: '층과 계단', en: 'Floors and steps' },
    pages: [
      {
        text: {
          ko: '층 f와 그 층의 계단 s가 있어요. 한 층을 다 내려가면 아래층 꼭대기(계단 5)에서 다시 시작해요. 그래서 숫자 하나로는 셀 수 없어요.',
          en: 'There is a floor f and a step s on that floor. After the last step of a floor you start again at the top (step 5) of the floor below, so one number does not count it.',
        },
        shots: [
          { scene: { k: 'run', prog: F, start: { f: 2, s: 2 }, V: '(f, s)' }, label: { ko: '한 층을 다 내려가면 아래층 꼭대기로', en: 'After a floor, the top of the floor below' }, tag: { ko: '층과 계단', en: 'floors' } },
          { scene: { k: 'run', prog: F, start: { f: 2, s: 2 }, V: 'f + s' }, label: { ko: '숫자 하나(f + s)로 세면 아래층으로 갈 때 올라가요', en: 'One number (f + s) goes up when the floor changes' }, tag: { ko: 'f + s', en: 'f + s' } },
        ],
        code: F,
      },
      {
        text: {
          ko: '남은 계단 수를 (층, 계단) 짝 `(f, s)`로 쓰면 돼요. 층이 줄거나, 같은 층에서 계단이 줄면 내려간 거예요.',
          en: 'Write the steps left as a pair (floor, step): `(f, s)`. Going down means: a lower floor, or the same floor and a lower step.',
        },
        shots: [{ scene: { k: 'run', prog: F, start: { f: 2, s: 2 }, V: '(f, s)' }, label: { ko: '남은 계단 수 = (f, s): 매 걸음 내려가요', en: 'steps left = (f, s): every step goes down' } }],
        code: F,
      },
    ],
  },
};

/** Levels with an intro of their own. */
export const INTRO_LEVELS = [7, 10];

export function introFor(level: number): Intro | null {
  return INTROS[level] ?? null;
}

export function program(key: TutorialKey): Level {
  return TUTORIAL_PROGRAMS[key];
}

const big = (start: Start): State => Object.fromEntries(Object.entries(start).map(([k, v]) => [k, BigInt(v)]));

/** The start state of a run scene (inputs + initialization, or a loop-head state as given). */
export function sceneStart(scene: Extract<TutScene, { k: 'run' }>): State {
  const prog = program(scene.prog);
  if (scene.at) return big(scene.at);
  const inputs = big(scene.start ?? {});
  if (!startAllowed(prog, inputs)) throw new Error(`tutorial start not allowed for ${scene.prog}`);
  return initialState(prog, inputs);
}

/** Build the stage scene of a tutorial shot. Throws if the shot asks for something impossible (tests). */
export function tutScene(scene: TutScene): StageScene {
  if (scene.k === 'idle') return { ...sceneBase(program(scene.prog ?? C)), k: 'idle' };
  const prog = program(scene.prog);
  if (scene.k === 'cycle') {
    const inputs = big(scene.start);
    if (!startAllowed(prog, inputs)) throw new Error(`tutorial start not allowed for ${scene.prog}`);
    const run = simulate(prog, initialState(prog, inputs), SIM_CAP);
    if (run.outcome !== 'cycle') throw new Error('tutorial cycle does not cycle');
    return ringScene(prog, run.states, run.cycleStart ?? 0);
  }
  const V = scene.V ? parseV(prog, scene.V) : null;
  const out = runScene(prog, sceneStart(scene), V, scene.max ?? DRAW_MAX);
  if (out.k === 'stairs') {
    if (scene.railing) out.railing = scene.railing;
    if (scene.ghost && V) out.ghost = stairsWithV(prog, V, [big(scene.ghost)])[0];
  }
  return out;
}

export type RichPart = { kind: 'text' | 'bold' | 'code'; s: string };

/** Split narration markup into plain text, **bold** and `code` pieces. */
export function richParts(text: string): RichPart[] {
  const out: RichPart[] = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push({ kind: 'text', s: text.slice(at, m.index) });
    out.push(m[1] !== undefined ? { kind: 'bold', s: m[1] } : { kind: 'code', s: m[2]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', s: text.slice(at) });
  return out;
}

/** The narration as it reads on screen (markup removed). */
export function plainText(text: string): string {
  return richParts(text)
    .map((p) => p.s)
    .join('');
}
