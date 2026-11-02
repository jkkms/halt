// The tutorial: chapters of narrated pages, each with a scene for the stage.
// Plain data plus a pure scene builder, so every page is checked by `npm test`
// (the runs it shows really do what the narration says).

import { parseV } from './game.ts';
import { levelById, type Text } from './levels.ts';
import { initialState, simulate, startAllowed, SIM_CAP } from './sim.ts';
import { DRAW_MAX, ringScene, runScene, sceneBase, shaftScene, stairsWithV, walk, type StageScene } from './stage.ts';

type Start = Record<string, number>;

export type TutScene =
  | { k: 'idle'; level?: number }
  /** A run from `start`; with V the stairs are drawn at height V, without V at the real steps left. */
  | { k: 'run'; level: number; start: Start; V?: string; max?: number; ghost?: Start; railing?: string }
  | { k: 'cycle'; level: number; start: Start }
  | { k: 'never'; level: number; start: Start; zone?: string };

/** Extra content under the narration. */
export type Extra = 'purpose' | 'tryV' | 'chips' | 'symbols' | 'divmod' | 'length' | 'verdicts' | 'stars' | 'daily';

/** Labels pinned to the stage. */
export type Callout = 'ground' | 'basement' | 'walker' | 'door' | 'stair';

export interface TutPage {
  text: Text;
  scene: TutScene;
  /** Show this level's code beside the stage (lines light up as the walker moves). */
  code?: number;
  extra?: Extra;
  callouts?: Callout[];
}

export interface Chapter {
  n: number;
  title: Text;
  summary: Text;
  /** The level where this chapter is first needed (chapters 1–3: before level 1). */
  level?: number;
  pages: TutPage[];
}

export const PURPOSE: Text = {
  ko: "프로그램이 맞다는 증명은 두 조각입니다. '끝나면 결과가 맞다'(부분 정확성, 루프 불변식)와 '반드시 끝난다'(종료). It Ends는 뒤 조각을 연습하는 게임입니다. 반복문이 끝나는지 판정하고, 끝난다면 ranking function(남은 계단 수)으로, 안 끝난다면 영원히 도는 시작값으로 증명합니다. 증명은 Z3가 검사합니다. 끝나는지 아무도 모르는 반복문도 하나 있습니다.",
  en: "A proof that a program is correct has two pieces: 'if it ends, the result is right' (partial correctness, loop invariants) and 'it does end' (termination). It Ends is a game for practising the second piece. Decide whether a loop ends; if it does, prove it with a ranking function (the number of stairs left); if it does not, prove it with a start that runs forever. Z3 checks every proof. And one loop is in here that nobody knows the answer to.",
};

export const HOOK: Text = { ko: '이 반복문, 끝나긴 할까?', en: 'Will this loop ever end?' };

const L1 = { level: 1, start: { n: 4 } } as const;

export const CHAPTERS: Chapter[] = [
  {
    n: 1,
    title: { ko: '무대', en: 'The stage' },
    summary: { ko: '건물, 계단, 땅(0), 지하. 걷는 사람이 곧 실행 중인 프로그램이에요.', en: 'The building, the stairs, the ground (0), the basement. The walker is the running program.' },
    pages: [
      {
        text: { ko: '먼저 이 게임이 무엇을 연습하는지부터요.', en: 'First, what this game is for.' },
        scene: { k: 'run', level: 1, start: { n: 5 } },
        extra: 'purpose',
      },
      {
        text: {
          ko: '건물 앞에 계단이 있어요. 땅의 높이가 0이고, 땅 밑은 지하예요. 계단을 내려가는 사람이 지금 실행 중인 프로그램이에요.',
          en: 'Stairs run down the front of a building. The ground is height 0; below it is the basement. The person walking down is the program while it runs.',
        },
        scene: { k: 'run', level: 1, start: { n: 3 } },
        callouts: ['ground', 'basement', 'walker'],
      },
      {
        text: {
          ko: '걷는 사람은 변수 값을 들고 다녀요(지금은 n = 3). 반복을 한 번 돌 때마다 계단을 한 칸 내려가요. 계단 한 칸이 반복 한 번이에요.',
          en: 'The walker carries the values of the variables (here n = 3). Each time the loop body runs, the walker goes down one stair. One stair = one loop iteration.',
        },
        scene: { k: 'run', level: 1, start: { n: 3 } },
        code: 1,
        callouts: ['stair'],
      },
      {
        text: {
          ko: '한 걸음 내딛기 전에 언제나 반복 조건(n > 0)부터 확인해요. 코드에서 while 줄이 켜지는 순간이에요. 참이면 본문을 실행하고 한 칸 내려가요. 거짓이면 문으로 나가요. 반복문이 끝난 거예요.',
          en: 'Before every step the walker first checks the loop condition (n > 0); watch the while line light up. True: run the body and go down one stair. False: leave through the door. The loop has ended.',
        },
        scene: { k: 'run', level: 1, start: { n: 3 } },
        code: 1,
        callouts: ['door'],
      },
      {
        text: {
          ko: '첫 걸음 전에도 확인해요. 레벨 2에서 n = −3이면 i = 0이라 조건 i < n은 0 < −3, 처음부터 거짓이에요. 걷는 사람은 한 걸음도 걷지 않고 바로 문으로 나가요. 0걸음 만에 끝나요. 이 반복문은 음수 n에서도 끝나요.',
          en: 'It checks before the first step too. In level 2 with n = −3, i starts at 0, so i < n is 0 < −3: false from the start. The walker takes no step at all and leaves through the door. The run takes 0 steps, so this loop ends for negative n as well.',
        },
        scene: { k: 'run', level: 2, start: { n: -3 } },
        code: 2,
        callouts: ['door'],
      },
      {
        text: {
          ko: "그래서 '끝난다'는 허용된 모든 시작값에서 걷는 사람이 언젠가 문에 닿는다는 뜻이에요. 지금까지 계단 높이는 실제로 남은 걸음 수였어요. 이제 그 높이를 여러분이 정해요.",
          en: "So 'it ends' means: from every allowed start, the walker reaches the door sooner or later. So far the stair heights were the real number of steps left. Next, you set the heights.",
        },
        scene: { k: 'run', level: 1, start: { n: 5 } },
      },
    ],
  },
  {
    n: 2,
    title: { ko: '계단 높이는 내가 정한다', en: 'You set the stair heights' },
    summary: { ko: '상태마다 수 V를 정하면 그 높이로 계단이 그려져요. 맞는 V는 내려가기만 해요.', en: 'Give each state a number V and the stairs are drawn at that height. A correct V only goes down.' },
    pages: [
      {
        text: {
          ko: '핵심은 이거예요. 여러분이 식 V를 하나 쓰면, 게임은 예시 실행의 상태 하나하나를 높이 V인 계단으로 그려요. 계단 위의 숫자가 그 상태의 V예요. V는 남은 계단 수, 곧 ranking function이에요.',
          en: 'The key idea: you write one expression V, and the game draws every state of a sample run as a stair at height V. The number on each stair is V at that state. V is the number of stairs left: a ranking function.',
        },
        scene: { k: 'run', ...L1, V: 'n' },
        code: 1,
      },
      {
        text: {
          ko: '맞는 V는 내려가기만 하는 계단을 그려요. 두 가지를 지키면 돼요. ① 걷는 동안 땅 밑(V < 0)으로 내려가지 않는다. ② 한 걸음마다 1 이상 내려간다. 그러면 계단이 바닥나기 전에 반드시 멈춰요.',
          en: 'A correct V draws stairs that only go down. Two rules: (1) while walking, never below ground (V < 0); (2) every step goes down by at least 1. Then the walk must stop before the stairs run out.',
        },
        scene: { k: 'run', ...L1, V: 'n' },
        code: 1,
      },
      {
        text: {
          ko: 'V = 0이면 어떨까요? 계단이 모두 높이 0이라 걸음이 평평해요. 걷는 사람이 휘청해요. 한 걸음마다 1 이상 내려가야 하니 증명이 아니에요.',
          en: 'What about V = 0? Every stair is at height 0, so the step is flat and the walker stumbles. Each step has to go down by at least 1, so this is not a proof.',
        },
        scene: { k: 'run', ...L1, V: '0' },
        code: 1,
      },
      {
        text: {
          ko: 'V = −n이면 계단이 땅 밑에 생겨요. 아직 걷는 중인데 땅 밑이라 걷는 사람이 지하로 떨어져요. 이것도 증명이 아니에요.',
          en: 'With V = −n the stairs are below ground. The walker is still walking but under the ground, so it falls into the basement. Not a proof either.',
        },
        scene: { k: 'run', ...L1, V: '-n' },
        code: 1,
      },
      {
        text: {
          ko: 'V = n + 1은요? 계단이 모두 한 칸씩 높아졌지만, 여전히 한 걸음마다 1씩 내려가고 땅 위에 있어요. 이것도 맞는 답이에요. 맞는 답은 여러 개일 수 있고, 짧을수록 별을 더 받아요.',
          en: 'And V = n + 1? Every stair is one higher, but each step still goes down by 1 and stays above ground. That is also a correct answer. Many answers can be right; shorter ones earn more stars.',
        },
        scene: { k: 'run', ...L1, V: 'n + 1' },
        code: 1,
      },
      {
        text: {
          ko: 'V = n: 남은 계단 수 그대로예요. 한 글자로 끝나요.',
          en: 'V = n: exactly the stairs left. One character.',
        },
        scene: { k: 'run', ...L1, V: 'n' },
        code: 1,
      },
      {
        text: {
          ko: '그림은 예시 실행 몇 개로 그리지만, 판정은 Z3가 조건이 참인 모든 상태를 두고 해요. 그림에 없는 상태에서 틀리면 Z3가 그 상태를 반례로 보여 줘요. 아래에 직접 V를 써 보세요.',
          en: 'The drawing uses a few sample runs, but Z3 judges every state where the condition holds. If V fails on a state that is not drawn, Z3 shows you that state as a counterexample. Try your own V below.',
        },
        scene: { k: 'run', ...L1, V: 'n' },
        code: 1,
        extra: 'tryV',
      },
    ],
  },
  {
    n: 3,
    title: { ko: '무엇을 입력하나', en: 'What you can type' },
    summary: { ko: '변수, + − * / %, abs·min·max, 괄호. 길이와 기준(par).', en: 'Variables, + − * / %, abs, min, max, parentheses. Length and par.' },
    pages: [
      {
        text: {
          ko: '입력칸에는 그 레벨의 변수를 써요. 레벨 2라면 n과 i예요. 아래 칩을 누르면 글자가 들어가요. 직접 쳐도 돼요.',
          en: 'In the answer box you use the variables of the level; in level 2 those are n and i. Press a chip below to insert it, or just type.',
        },
        scene: { k: 'run', level: 2, start: { n: 3 } },
        code: 2,
        extra: 'chips',
      },
      {
        text: {
          ko: '쓸 수 있는 것: 정수, 연산자 + − * / %, 괄호 ( ), 함수 abs(e), min(e, e), max(e, e). 곱셈은 2*n처럼 *를 꼭 써요(2n은 안 돼요).',
          en: 'You can use whole numbers, the operators + − * / %, parentheses ( ), and the functions abs(e), min(e, e), max(e, e). Multiplication needs a *: write 2*n, not 2n.',
        },
        scene: { k: 'idle', level: 2 },
        extra: 'symbols',
      },
      {
        text: {
          ko: '/와 %는 화면에 적힌 규칙대로 계산해요. 나머지는 언제나 0 이상이에요. 그래서 −7 / 2 = −4, −7 % 2 = 1이에요. 0으로 나누면 x / 0 = 0, x % 0 = x로 정해 두었어요.',
          en: '/ and % follow the rule shown on screen: the remainder is never negative. So −7 / 2 = −4 and −7 % 2 = 1. Dividing by zero is fixed as x / 0 = 0 and x % 0 = x.',
        },
        scene: { k: 'idle', level: 2 },
        extra: 'divmod',
      },
      {
        text: {
          ko: '답의 길이는 빈칸을 뺀 글자 수예요. 레벨마다 기준(par)이 있어요. 길이가 기준 이하이면 ★★★을 받을 수 있어요. 난간 R을 쓰면 그 길이도 더해요.',
          en: 'The length of an answer is the number of characters without spaces. Each level has a par; an answer no longer than par can earn ★★★. A railing R counts toward the length too.',
        },
        scene: { k: 'idle', level: 2 },
        extra: 'length',
      },
      {
        text: {
          ko: '뒤에서 더 쓰게 될 것: 레벨 9부터 난간 R에는 조건(== != < <= > >=, &&, ||, !)을, 레벨 10부터는 튜플 (a, b)를 써요. "안 끝난다"를 고르면 시작값으로 정수를 넣어요. Enter를 누르면 제출돼요.',
          en: 'Coming later: from level 9 a railing R is a condition (== != < <= > >=, &&, ||, !); from level 10 you can write a tuple (a, b). For "It never ends" you type whole numbers as start values. Enter submits.',
        },
        scene: { k: 'idle', level: 2 },
      },
    ],
  },
  {
    n: 4,
    title: { ko: '판정 셋', en: 'Three verdicts' },
    summary: { ko: '끝난다 · 안 끝난다 · 아무도 모른다. 영원히 도는 시작값과 바닥 없는 구역.', en: 'It ends · it never ends · nobody knows. Starts that run forever, and bottomless zones.' },
    level: 5,
    pages: [
      {
        text: {
          ko: '판정은 셋이에요. 끝난다: 남은 계단 수 V로 증명해요. 안 끝난다: 영원히 도는 시작값으로 증명해요. 아무도 모른다: 증명할 것이 없어요.',
          en: 'There are three verdicts. It ends: prove it with the stairs left, V. It never ends: prove it with a start that runs forever. Nobody knows: nothing to prove.',
        },
        scene: { k: 'idle' },
        extra: 'verdicts',
      },
      {
        text: {
          ko: '레벨 5를 보세요. i가 n을 쫓아가지만 n도 함께 커져요. n = 1에서 출발하면 걷는 사람은 문에 닿지 못하고 계속 지하로 내려가요.',
          en: 'Look at level 5. i chases n, but n grows too. From n = 1 the walker never reaches the door; it keeps going down into the basement.',
        },
        scene: { k: 'never', level: 5, start: { n: 1 } },
        code: 5,
      },
      {
        text: {
          ko: '"안 끝난다"를 고르면 시작값을 넣어요(여기서는 n = 1). 게임이 그 시작값으로 1만 걸음까지 걸어 봐요. 그 안에 문에 닿으면 증명이 아니에요.',
          en: 'Pick "It never ends" and give a start (here n = 1). The game walks from that start for up to 10,000 steps. If the walker reaches the door, it is not a proof.',
        },
        scene: { k: 'never', level: 5, start: { n: 1 } },
        code: 5,
      },
      {
        text: {
          ko: '걷다가 전에 있던 상태로 돌아오면 같은 곳을 영원히 돌아요(순환). 그걸로 증명 끝이에요. 예를 들어 레벨 17에서 x = 1, y = 0이면 x가 그대로라 한 걸음 뒤에 같은 상태가 돼요.',
          en: 'If the walk comes back to a state it has been in, it circles forever (a cycle), and that is the proof. For example, in level 17 with x = 1, y = 0, x never changes, so one step later the state is the same.',
        },
        scene: { k: 'cycle', level: 17, start: { x: 1, y: 0 } },
        code: 17,
      },
      {
        text: {
          ko: '레벨 5처럼 상태가 계속 새로우면 바닥 없는 구역 Z를 정해요. Z는 ① 내 시작값에서 참이고, ② Z 안에서는 반복 조건이 참이라 계속 걷고, ③ 한 걸음 뒤에도 참인 조건이에요. 여기서는 Z = i < n. Z3가 세 가지를 검사해요.',
          en: 'If the states keep being new, as in level 5, mark a bottomless zone Z: a condition that (1) holds at your start, (2) keeps the loop condition true, so the walk goes on, and (3) still holds after every step. Here Z = i < n. Z3 checks all three.',
        },
        scene: { k: 'never', level: 5, start: { n: 1 }, zone: 'i < n' },
        code: 5,
      },
      {
        text: {
          ko: '"아무도 모른다"는 딱 한 레벨에서만 정답이에요. 다른 레벨에서 고르면 "아는 사람이 있어요"라는 답과 함께 시도 한 번으로 세요.',
          en: '"Nobody knows" is right on exactly one level. Anywhere else it counts as an attempt, with the reply "Someone does know".',
        },
        scene: { k: 'idle' },
      },
    ],
  },
  {
    n: 5,
    title: { ko: '난간', en: 'Railings' },
    summary: { ko: '실행이 절대 가지 않는 상태는 난간 R로 빼요.', en: 'Rule out states the run never reaches, with a railing R.' },
    level: 9,
    pages: [
      {
        text: {
          ko: '레벨 9: i가 0부터 n까지 올라가요(n ≥ 0). V = n − i는 예시 실행에서 잘 내려가요.',
          en: 'Level 9: i counts up from 0 to n (n ≥ 0). On the sample run, V = n − i goes down nicely.',
        },
        scene: { k: 'run', level: 9, start: { n: 3 }, V: 'n - i' },
        code: 9,
      },
      {
        text: {
          ko: '그런데 Z3는 조건(i != n)이 참인 모든 상태를 검사해요. 실행에서는 절대 나오지 않는 i = 5, n = 3 같은 상태까지요. 거기서는 V = −2라 땅 밑이에요. 그래서 난간 없이는 증명이 안 돼요.',
          en: 'But Z3 checks every state where the condition (i != n) holds, even states the run can never reach, such as i = 5, n = 3. There V = −2 is below ground, so without a railing this is not a proof.',
        },
        scene: { k: 'run', level: 9, start: { n: 3 }, V: 'n - i', ghost: { n: 3, i: 5 } },
        code: 9,
      },
      {
        text: {
          ko: '난간 R을 주면 그런 상태를 뺄 수 있어요. 난간은 시작할 때 참이고(i = 0 ≤ n) 한 걸음 뒤에도 참이어야 해요(불변식, supporting invariant). 그러면 Z3는 난간 안의 상태에서만 V를 검사해요.',
          en: 'A railing R rules such states out. It must hold at the start (i = 0 ≤ n) and still hold after every step (an invariant, the supporting invariant). Then Z3 checks V only on states inside the railing.',
        },
        scene: { k: 'run', level: 9, start: { n: 3 }, V: 'n - i', ghost: { n: 3, i: 5 }, railing: 'i <= n' },
        code: 9,
      },
      {
        text: {
          ko: '난간의 글자 수도 답 길이에 들어가요. 꼭 필요할 때만 쓰세요.',
          en: 'The railing counts toward the length of your answer, so use one only when you need it.',
        },
        scene: { k: 'run', level: 9, start: { n: 3 }, V: 'n - i', railing: 'i <= n' },
        code: 9,
      },
    ],
  },
  {
    n: 6,
    title: { ko: '층과 계단', en: 'Floors and steps' },
    summary: { ko: '튜플 (a, b): a층의 b번째 계단. 한 층 내려가면 계단 수가 다시 채워져요.', en: 'A tuple (a, b): floor a, step b. One floor down and the steps refill.' },
    level: 10,
    pages: [
      {
        text: {
          ko: '레벨 10은 시계예요. y분이 1씩 줄다가 0이 되면 x시가 하나 줄고 y는 59가 돼요. V = x + y라면 x = 2, y = 0에서 한 걸음 뒤 x = 1, y = 59가 되니 V가 2에서 60으로 올라가요.',
          en: 'Level 10 is a clock. The minutes y count down; at 0, the hours x drop by one and y becomes 59. With V = x + y, the step from x = 2, y = 0 to x = 1, y = 59 takes V from 2 up to 60.',
        },
        scene: { k: 'run', level: 10, start: { x: 2, y: 0 }, V: 'x + y', max: 6 },
        code: 10,
      },
      {
        text: {
          ko: '튜플 V = (a, b)는 "a층의 b번째 계단"이에요. 먼저 층을 비교하고, 층이 같을 때만 계단을 비교해요(사전식 순서). 한 층 내려가면 계단 수는 다시 꼭대기부터 시작해도 돼요.',
          en: 'A tuple V = (a, b) means "floor a, step b". Floors are compared first; steps only when the floor is the same (lexicographic order). After going down a floor, the step count may start again from the top.',
        },
        scene: { k: 'run', level: 10, start: { x: 2, y: 0 }, V: '(x, y)', max: 8 },
        code: 10,
      },
      {
        text: {
          ko: '걷는 동안 튜플의 모든 성분이 0 이상이어야 해요. 튜플은 레벨 10부터 쓸 수 있어요.',
          en: 'While walking, every part of the tuple must be ≥ 0. Tuples can be used from level 10 on.',
        },
        scene: { k: 'run', level: 10, start: { x: 1, y: 3 }, V: '(x, y)' },
        code: 10,
      },
    ],
  },
  {
    n: 7,
    title: { ko: '별과 오늘의 문제', en: 'Stars and the daily puzzle' },
    summary: { ko: '별을 받는 법, 시도로 세지 않는 것, 오늘의 문제.', en: 'How stars work, what does not count as an attempt, and the daily puzzle.' },
    pages: [
      {
        text: {
          ko: '★ 풀면, ★★ 세 번 안에 풀면, ★★★ 거기에 더해 답 길이가 기준 이하이면(끝나는 레벨) 또는 첫 시도에 풀면(나머지 레벨). 최고 기록은 이 기기에 남아요.',
          en: '★ solved, ★★ solved within three attempts, ★★★ also with an answer no longer than par (levels that end) or on the first attempt (the others). Best stars stay on this device.',
        },
        scene: { k: 'run', level: 1, start: { n: 5 } },
        extra: 'stars',
      },
      {
        text: {
          ko: '시도로 세지 않는 것: 식 오류, 레벨이 허용하지 않는 시작값, 판정기가 5초 안에 결정하지 못한 경우. 틀린 판정과 틀린 증명만 시도로 세요.',
          en: 'What does not count as an attempt: a typo in the expression, a start the level does not allow, and the judge giving up after 5 seconds. Only wrong verdicts and wrong proofs count.',
        },
        scene: { k: 'run', level: 1, start: { n: 5 } },
      },
      {
        text: {
          ko: '오늘의 문제는 날짜(UTC)마다 레벨 하나예요. 풀고 나면 답은 빼고 시도 기록만 담긴 한 줄을 복사해 친구와 비교할 수 있어요.',
          en: 'The daily puzzle is one level per date (UTC). After solving it, copy a one-line result that shows your attempts but not your answer, and compare with friends.',
        },
        scene: { k: 'run', level: 1, start: { n: 5 } },
        extra: 'daily',
      },
    ],
  },
];

/** Chapters suggested before level 1. */
export const FIRST_CHAPTERS = [1, 2, 3];

export function chapterByN(n: number): Chapter {
  const c = CHAPTERS.find((x) => x.n === n);
  if (!c) throw new Error(`no chapter ${n}`);
  return c;
}

const big = (start: Start) => Object.fromEntries(Object.entries(start).map(([k, v]) => [k, BigInt(v)]));

/** Build the stage scene of a tutorial page. Throws if the page asks for something impossible (tests). */
export function tutScene(scene: TutScene): StageScene {
  if (scene.k === 'idle') {
    const l = levelById(scene.level ?? 1);
    return { ...sceneBase(l), k: 'idle' };
  }
  const level = levelById(scene.level);
  const inputs = big(scene.start);
  if (!startAllowed(level, inputs)) throw new Error(`tutorial start not allowed on level ${level.id}`);
  const s0 = initialState(level, inputs);
  if (scene.k === 'cycle') {
    const run = simulate(level, s0, SIM_CAP);
    if (run.outcome !== 'cycle') throw new Error('tutorial cycle does not cycle');
    return ringScene(level, run.states, run.cycleStart ?? 0);
  }
  if (scene.k === 'never') return shaftScene(level, walk(level, s0, DRAW_MAX).states, scene.zone);
  const V = scene.V ? parseV(level, scene.V) : null;
  const out = runScene(level, s0, V, scene.max ?? DRAW_MAX);
  if (out.k === 'stairs') {
    if (scene.railing) out.railing = scene.railing;
    if (scene.ghost && V) {
      const g = initialState(level, big(scene.ghost));
      // initialState re-runs the init (i := 0); a ghost is a loop-head state as given.
      const ghostState = { ...g, ...big(scene.ghost) };
      out.ghost = stairsWithV(level, V, [ghostState])[0];
    }
  }
  return out;
}
