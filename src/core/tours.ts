// The level screen's guide (SPEC_guide): four short tours, each a few steps with a focus ring on a real part of the
// screen and its text in the still narration box of the tutorial. Plain data plus pure rules (which tour is due,
// which ones "show this screen's guide again" replays, the "?" menu), so `npm test` checks them.
//
// The texts follow the spec's wording, changed only where the game works differently (SPEC_guide asks for that; the
// changes are listed in the report). They quote the UI's labels exactly (test/tours.test.ts checks them against
// i18n.ts). A tour is the same on every level of a band (only the railing, from level 7, adds a clause), so the
// guide never tells which levels end. **bold** and `code` are markup, as in the tutorial.

import { railingAllowed, type Outcome, type Verdict } from './game.ts';
import type { Level, Text } from './levels.ts';
import { SIM_CAP } from './sim.ts';
import { INTRO_LEVELS } from './tutorial.ts';

/** A: the parts of the level screen; B: the "ends" proof box; C: the result of a failed check; D: the "never" proof. */
export type TourId = 'screen' | 'proof' | 'result' | 'never';

export const TOUR_IDS: TourId[] = ['screen', 'proof', 'result', 'never'];

/**
 * What a step's ring goes around: `stage` the stage (with its sample-run buttons), `head` the level card's
 * header (number, title, stars, attempts), `code` the loop, `inputs` / `facts` the two lines under it, `verdict` the
 * step-1 card, `topbar` the judge badge and "?" in the bar, `vInput` the steps-left field, `chips` the chip bar and
 * the grey help under it, `checkRow` the Check button with the length, `graph` the chart card, `result` the result
 * card, `startFields` the start values, `runBtn` the Run button.
 */
export type GuideTarget =
  | 'stage'
  | 'head'
  | 'code'
  | 'inputs'
  | 'facts'
  | 'verdict'
  | 'topbar'
  | 'vInput'
  | 'chips'
  | 'checkRow'
  | 'graph'
  | 'result'
  | 'startFields'
  | 'runBtn';

export interface TourStep {
  targets: GuideTarget[];
  text: Text;
}

export interface Tour {
  id: TourId;
  title: Text;
  steps: TourStep[];
}

/** 10000 → "10,000" (the same in both languages, whatever the runtime's locale). */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const TITLES: Record<TourId, Text> = {
  screen: { ko: '레벨 화면 둘러보기', en: 'The level screen' },
  proof: { ko: '증명 칸', en: 'The proof box' },
  result: { ko: '결과', en: 'The result' },
  never: { ko: '안 끝난다 증명', en: 'Proving it never ends' },
};

const SCREEN: TourStep[] = [
  {
    targets: ['stage'],
    text: {
      ko: "건물 그림은 이 레벨의 반복문을 실제로 실행해 보여 주는 무대예요.\n\n**끝난다**를 고르고 남은 계단 수를 쓰면 **예시 실행** 버튼으로 고른 시작값에서 사람이 걷고,\n**안 끝난다**를 고르면 내가 넣은 시작값에서 걸어요.\n\n**↻ 다시 보기**는 처음부터 다시 보여 줘요.",
      en: 'The building is a stage that really runs this level’s loop.\n\nChoose **It ends** and write the steps left, and the person walks from the start you pick with the **Sample runs** buttons;\nchoose **It never ends**, and they walk from the start you enter.\n\n**↻ Replay** shows the walk from the beginning.',
    },
  },
  {
    targets: ['head'],
    text: {
      ko: '맨 위에는 레벨 번호와 이름, 별, 시도 횟수가 있어요.\n\n별은 ★ 풀면, ★★ 3번 안에 풀면 받아요.\n★★★은 거기에 더해, **끝난다** 레벨은 답이 기준 길이 이하일 때, 그 밖의 레벨은 첫 시도에 풀었을 때 받아요.',
      en: 'At the top: the level number and name, the stars and your attempts.\n\n★ for solving, ★★ for solving within 3 attempts,\n★★★ if also, on an **It ends** level, your answer is no longer than the par, or, on any other level, you solved it on the first attempt.',
    },
  },
  {
    targets: ['code'],
    text: {
      ko: '이번 레벨의 반복문이에요. 무대의 사람이 걸을 때 지금 실행하는 줄이 함께 밝아져요.',
      en: 'This level’s loop. While the person on the stage walks, the line being run lights up here too.',
    },
  },
  {
    targets: ['inputs'],
    text: {
      ko: '**입력**은 시작할 때 넣을 수 있는 값이에요. **아무 정수**라면 음수와 0도 들어가요.\n\n판정은 여기 적힌 모든 시작값을 두고 해요.',
      en: 'The **Inputs** line says which start values are allowed. **any integers** includes 0 and negative numbers.\n\nYour verdict is about every start allowed here.',
    },
  },
  {
    targets: ['facts'],
    text: {
      ko: '**알려진 사실**은 반복문이 조건을 검사할 때마다 늘 참인 조건이에요.\n판정기도 이 사실을 알아서, 남은 계단 수와 걸음을 검사할 때 이 사실이 참인 상태만 따져요.\n\n없으면 **없음**이라고 적혀 있어요.',
      en: '**Known facts** are conditions that hold every time the loop checks its condition.\nThe judge knows them too: when it checks the steps left and the steps, it only looks at states where they hold.\n\nIf there are none, it says **nothing extra**.',
    },
  },
  {
    targets: ['verdict'],
    text: {
      ko: '**1단계 · 판정**\n먼저 이 반복문이 끝나는지 골라요.\n\n**끝난다**나 **안 끝난다**를 고르면 아래에 2단계 증명 칸이 열리고,\n**아무도 모른다**는 고르는 즉시 판정해요.\n\n고른 판정은 나중에 **바꾸기**로 바꿀 수 있어요.',
      en: '**Step 1 · Verdict**\nFirst choose whether this loop ends.\n\n**It ends** or **It never ends** opens the step 2 proof box below;\n**Nobody knows** is judged as soon as you pick it.\n\nYou can change the verdict later with **change**.',
    },
  },
  {
    targets: ['topbar'],
    text: {
      ko: '**판정기 준비됨**은 증명을 검사할 Z3가 준비됐다는 표시예요(좁은 화면에서는 ✓만 보여요).\n\n**?**를 누르면 튜토리얼, 레벨 5·7·10 앞의 설명, 이 안내를 다시 볼 수 있어요.',
      en: '**Judge ready** means Z3, which checks your proofs, has loaded (a narrow screen shows just ✓).\n\nPress **?** to see the tutorial, the intros before levels 5, 7 and 10, or this guide again.',
    },
  },
];

function proofSteps(railing: boolean): TourStep[] {
  return [
    {
      targets: ['vInput'],
      text: {
        ko: '여기에 **남은 계단 수**를 써요. 쓰는 동안 무대에 그 식대로 계단이 그려져요.\n\n사람이 걷다가 **평평한 걸음!**이나 **땅 밑!** 같은 표시가 뜨면 그 칸에서 식이 틀린 거예요.',
        en: 'Write the **Steps left** here. As you type, the stage draws the stairs from your expression.\n\nIf a stair shows **flat step!** or **below ground!** as the person walks, your expression fails there.',
      },
    },
    {
      targets: ['chips'],
      text: {
        ko: '버튼을 누르면 변수와 기호가 입력칸에 들어가요.\n아래 회색 글씨는 쓸 수 있는 기호와 **문법 예시**예요.',
        en: 'The buttons put variables and symbols into the box.\nThe grey text below lists what you can use, with a **Syntax example**.',
      },
    },
    {
      targets: ['checkRow'],
      text: railing
        ? {
            ko: "**판정**을 누르면 Z3가 두 가지를 검사해요.\n한 바퀴마다 줄어드는가, 반복하는 동안 땅 위에 있는가. 난간 R을 썼다면 난간도 검사해요.\n\n옆의 '몇 자 · 기준 몇 자'는 난간까지 더한 답의 길이예요(빈칸은 세지 않아요). 3번 안에, 기준 이하로 풀면 ★★★을 받아요.",
            en: '**Check** makes Z3 test two things:\ndoes it go down every round, and does it stay above ground while the loop runs. If you wrote a railing R, it checks the railing too.\n\nThe “n chars · par m” next to it is your answer’s length, railing included (spaces not counted); solving within 3 attempts at or under par earns ★★★.',
          }
        : {
            ko: "**판정**을 누르면 Z3가 두 가지를 검사해요.\n한 바퀴마다 줄어드는가, 반복하는 동안 땅 위에 있는가.\n\n옆의 '몇 자 · 기준 몇 자'는 답의 길이예요(빈칸은 세지 않아요). 3번 안에, 기준 이하로 풀면 ★★★을 받아요.",
            en: '**Check** makes Z3 test two things:\ndoes it go down every round, and does it stay above ground while the loop runs.\n\nThe “n chars · par m” next to it is your answer’s length (spaces not counted); solving within 3 attempts at or under par earns ★★★.',
          },
    },
    {
      targets: ['graph'],
      text: {
        ko: '**예시 실행 한눈에 보기**를 펼치면 예시 시작값마다 내 식의 값이 걸음에 따라 어떻게 바뀌는지 그래프로 볼 수 있어요.',
        en: 'Open **All sample runs at a glance** to see, for each sample start, how your expression’s value changes step by step.',
      },
    },
  ];
}

const RESULT: TourStep[] = [
  {
    targets: ['result'],
    text: {
      ko: '틀리면 여기에 판정기가 찾은 **반례**가 적혀요. ✗가 붙은 검사를 통과하지 못하는 상태나 걸음이에요.\n\n무대도 그 반례를 그려 보여 줘요(예시 실행 가운데 끝나지 않는 것이 있으면 그 실행을 보여 줘요).\n\n틀린 답은 시도 횟수에 들어가요. 식을 고쳐서 다시 **판정**하면 돼요.',
      en: 'When a check fails, the **counterexample** the judge found is written here: a state or a step that fails the check marked ✗.\n\nThe stage draws it too (or, if one of the sample runs never ends, shows that run).\n\nA wrong answer counts as an attempt. Fix the expression and **Check** again.',
    },
  },
];

const NEVER: TourStep[] = [
  {
    targets: ['startFields'],
    text: {
      ko: '**시작값**에 영원히 걷는 값을 넣어요. **입력** 줄이 허락하는 값이어야 해요.',
      en: 'Under **Start values**, enter a start that walks forever. It must be allowed by the **Inputs** line.',
    },
  },
  {
    targets: ['runBtn'],
    text: {
      ko: `**걸어 보기**를 누르면 무대에서 그 시작값으로 걸어요.\n\n출구에 닿으면 이 시작값으로는 증명이 안 되고 시도 횟수가 하나 늘어요.\n같은 상태로 돌아오면 영원히 맴도는 것이니 그대로 증명이 끝나요.\n${grouped(SIM_CAP)}걸음을 걸어도 같은 상태가 다시 나오지 않으면 **바닥 없는 구역** Z를 정하는 칸이 열려요.`,
      en: `**Run** walks from that start on the stage.\n\nIf the walker reaches the exit, that start proves nothing and it counts as an attempt.\nIf it comes back to a state, it circles forever, and that already proves it.\nIf no state repeats in ${grouped(SIM_CAP)} steps, a box opens for a **Bottomless zone** Z.`,
    },
  },
];

/** A tour as it shows on this level (the railing, from level 7, adds a clause to the Check step). */
export function tourFor(id: TourId, level: Level): Tour {
  const steps = id === 'screen' ? SCREEN : id === 'proof' ? proofSteps(railingAllowed(level)) : id === 'result' ? RESULT : NEVER;
  return { id, title: TITLES[id], steps };
}

// ------------------------------------------------------------ when a tour shows

/** What the level screen shows now, as far as the guide cares. */
export interface GuideState {
  /** Tours already shown to the end or skipped (the store's `guidesSeen`). */
  seen: readonly string[];
  /** The step-2 form that is open: after choosing "It ends" or "It never ends". */
  form: 'ends' | 'never' | null;
  /** The result card shows a failed check of the steps left (with a counterexample). */
  failed: boolean;
}

/**
 * The level screen as the guide sees it: the step-2 form opens with "It ends" or "It never ends" ("Nobody knows" is
 * judged at once and has none); the result tour is about a failed check of the steps left, the only failure that
 * comes with a counterexample on the result card and the stage.
 */
export function screenState(verdict: Verdict | null, outcome: Outcome | null): Pick<GuideState, 'form' | 'failed'> {
  return { form: verdict === 'ends' || verdict === 'never' ? verdict : null, failed: outcome?.type === 'ends' && outcome.result === 'refuted' };
}

/** Can this tour show on the screen as it is (its parts are there)? */
export function tourFits(id: TourId, st: Pick<GuideState, 'form' | 'failed'>): boolean {
  switch (id) {
    case 'screen':
      return true;
    case 'proof':
      return st.form === 'ends';
    case 'never':
      return st.form === 'never';
    case 'result':
      return st.failed;
  }
}

/**
 * The tours due now, first one first: the level screen on the first visit, then the proof box the first time the
 * "ends" form is open (or the "never" one the first time that form is), then the result the first time a check
 * fails. One at a time; the next starts when the one before is over.
 */
export function dueTours(st: GuideState): TourId[] {
  return (['screen', 'proof', 'never', 'result'] as TourId[]).filter((id) => !st.seen.includes(id) && tourFits(id, st));
}

/** "Show this screen's guide again": the level screen, then the open form's tour, then the result if a check failed. */
export function replayTours(st: Pick<GuideState, 'form' | 'failed'>): TourId[] {
  return (['screen', 'proof', 'never', 'result'] as TourId[]).filter((id) => tourFits(id, st));
}

/** The seen list with this tour in it (unchanged if it was there). */
export function withSeen(seen: readonly string[] | undefined, id: TourId): string[] {
  const list = [...(seen ?? [])];
  if (!list.includes(id)) list.push(id);
  return list;
}

// ------------------------------------------------------------ the "?" menu

export type HelpItem = { k: 'tutorial' } | { k: 'intro'; level: number } | { k: 'guide' };

/**
 * What a level's "?" opens: the same menu on every level, the tutorial, the three intros and this screen's guide
 * (SPEC_guide §A: no level jumps straight to the tutorial or an intro any more, so the guide can always be replayed;
 * the menu never tells which levels end).
 */
export function helpMenu(): HelpItem[] {
  return [{ k: 'tutorial' }, ...INTRO_LEVELS.map((level) => ({ k: 'intro' as const, level })), { k: 'guide' }];
}
