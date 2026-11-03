// The tutorial (14 pages in five chapters, SPEC_v0.6 §D) and the short intros before level 5 (the bottomless
// zone), level 7 (railing) and level 10 (floors). Plain data plus pure builders, so every page is checked by
// `npm test` (the runs it shows really do what the narration says). Every program shown here is a tutorial-only
// program (TUTORIAL_PROGRAMS), never a level, except the countdown, which is level 1's on purpose.
// Texts are the spec's (SPEC_v0.6 §D, §E; the railing and floors intros SPEC_v0.3 §4); **bold** and `code` are markup,
// `\n` starts a line and `\n\n` a paragraph (SPEC_v0.7 §B: a bold lead on its own line, ①/② on new lines, short
// paragraphs; the words are unchanged except where the band made a direction wrong, marked below).

import { parseV } from './game.ts';
import { TUTORIAL_PROGRAMS, type Level, type Text, type TutorialKey } from './levels.ts';
import { guardHolds, initialState, simulate, startAllowed, step, SIM_CAP, type State } from './sim.ts';
import { DRAW_MAX, guardCheck, ringScene, runScene, sceneBase, stairsWithV, type StageScene } from './stage.ts';

type Start = Record<string, number>;

export type TutScene =
  | { k: 'idle'; prog?: TutorialKey }
  /**
   * A run of a tutorial program. `start` gives the inputs (the initialization runs as usual); `at` instead
   * gives a loop-head state as it is (for a state the real program never reaches, such as k = −5).
   * With V the stairs are drawn at height V; without V at the real number of steps left (or a shaft when the run
   * never ends; `zone` then marks the bottomless zone around it).
   */
  | { k: 'run'; prog: TutorialKey; start?: Start; at?: Start; V?: string; max?: number; ghost?: Start; railing?: string; zone?: string }
  | { k: 'cycle'; prog: TutorialKey; start: Start };

/**
 * What a page talks about; a ring is drawn around it (SPEC_v0.6 §C). `code` is the code card, `codeLine` its lit
 * line, `hud` the step counter and state at the stage's top left, `extra` the page's interactive card; the others
 * are on the stage: the walker, the badge of the stair it stands on, the loop-check bubble, the door, the ruler
 * (its floor ticks for a pair), the flat/up/below marks (each with its step), the steps where the floor changes
 * (a pair whose first part goes down), the ∞ ring of a cycle, the zone, the railing and the ghost stair (a state the
 * real run never reaches). A target made of several pieces gets one ring per piece (SPEC_v0.7 §C).
 */
export type Focus =
  | 'code'
  | 'codeLine'
  | 'hud'
  | 'walker'
  | 'stairHere'
  | 'check'
  | 'door'
  | 'ruler'
  | 'mark'
  | 'floorStep'
  | 'ring'
  | 'zone'
  | 'railing'
  | 'ghost'
  | 'extra';

/** Focus targets that live on the stage (the rest are cards around it). */
export const STAGE_FOCUS: Focus[] = ['walker', 'stairHere', 'check', 'door', 'ruler', 'mark', 'floorStep', 'ring', 'zone', 'railing', 'ghost'];

/**
 * Freeze the run at a beat instead of looping: `start` (on the first stair before the first check), the i-th loop
 * check with its ✓/✗ shown, or the check that fails (before walking out).
 */
export type Hold = 'start' | `check:${number}:decided` | 'lastCheck';

/** One scene of a page. A page with several shots plays them one after another, again and again. */
export interface Shot {
  scene: TutScene;
  /** Caption on the stage. */
  label?: Text;
  /** A short name for its button when a page has several shots. */
  tag?: Text;
  /** What this shot talks about (overrides the page's focus); [] = nothing. */
  focus?: Focus[];
}

/** The interactive card of a page. */
export type Extra = 'verdicts' | 'tryV' | 'chips' | 'levelCard' | 'stepper' | 'legend';

export type ChapterId = 'start' | 'stage' | 'verdict' | 'proof' | 'go';

export const CHAPTERS: Record<ChapterId, Text> = {
  start: { ko: '시작', en: 'Start' },
  stage: { ko: '무대 읽기', en: 'Reading the stage' },
  verdict: { ko: '1단계 판정', en: 'Step 1, verdict' },
  proof: { ko: '2단계 증명', en: 'Step 2, proof' },
  go: { ko: '시작하기', en: 'Your turn' },
};

export interface TutPage {
  text: Text;
  shots: Shot[];
  chapter?: ChapterId;
  extra?: Extra;
  /** Wide shot: the camera further away, no step counter. */
  wide?: boolean;
  /** What the page talks about (a ring around each; the first is the main one). */
  focus?: Focus[];
  /** Why the page has no focus (every page has a focus or says why not). */
  noFocus?: string;
  hold?: Hold;
  /** Step mode: held at the start, one beat per press of the card's button. */
  step?: boolean;
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
const C3: TutScene = { k: 'run', prog: C, start: { n: 3 } };
const C5: TutScene = { k: 'run', prog: C, start: { n: 5 } };
const FLIP: TutScene = { k: 'cycle', prog: 'flip', start: { x: 2 } };

/** The 14 pages (SPEC_v0.6 §D). The countdown is level 1's program on purpose; it runs from n = 3 unless said. */
export const TUTORIAL: TutPage[] = [
  // ---------------------------------------------------------------- 시작 / Start
  {
    chapter: 'start',
    text: {
      ko: '**Halt?에 오신 것을 환영해요!**\n이 게임은 반복문(while)이 언젠가 끝나는지 알아맞히고, 왜 그런지 증명하는 퍼즐이에요. 반복문 18개를 하나씩 풀어요.\n\n처음 보는 화면이니, 먼저 화면의 각 부분이 무엇인지 하나씩 짚어 볼게요.',
      en: "**Welcome to Halt?!**\nThis is a puzzle about telling whether a loop (while) eventually ends, and proving why. You will solve 18 loops one by one.\n\nIt is all new, so first let's go through the parts of the screen one at a time.",
    },
    shots: [{ scene: C5 }],
    wide: true,
    noFocus: 'the welcome page: the whole picture, nothing named yet',
  },
  // ---------------------------------------------------------------- 무대 읽기 / Reading the stage
  {
    chapter: 'stage',
    text: {
      ko: "**먼저 코드부터 보세요.**\n이번에 살펴볼 반복문이에요.\n\n첫 줄 `while (n > 0)`은 'n이 0보다 큰 동안 안쪽을 되풀이하라'는 뜻이고,\n안쪽 줄 `n := n - 1`은 'n을 1 줄여라'는 뜻이에요.\n그러니 한 바퀴 돌 때마다 n이 1씩 줄어요.\n\n이제 이 코드가 실행되는 모습을 건물 그림으로 하나씩 보여 드릴게요.",
      en: "**Start with the code.**\nThis is the loop we will look at.\n\nThe first line `while (n > 0)` means 'repeat the inside while n is greater than 0',\nand the inside line `n := n - 1` means 'make n one smaller'.\nSo every round lowers n by 1.\n\nNext, the building picture will show this code running, one part at a time.",
    },
    shots: [{ scene: C3 }],
    hold: 'start',
    focus: ['code'],
  },
  {
    chapter: 'stage',
    text: {
      ko: '그림 왼쪽 위의 작은 글씨를 보세요.\n**걸음 0**은 반복을 몇 바퀴 돌았는지 세는 숫자이고,\n**n=3**은 지금 변수 n의 값이에요.\n\n이번에는 n = 3에서 시작해요. 아직 한 바퀴도 안 돌았으니 걸음은 0이에요.',
      en: 'Look at the small text at the top left of the picture.\n**step 0** counts how many rounds the loop has done,\nand **n=3** is the current value of n.\n\nThis time we start from n = 3. No round yet, so the count is 0.',
    },
    shots: [{ scene: C3 }],
    hold: 'start',
    focus: ['hud'],
  },
  {
    chapter: 'stage',
    text: {
      ko: '건물 앞의 사람이 **지금 실행 중인 프로그램**이에요. 사람이 서 있는 계단 칸은 프로그램의 지금 상태예요.\n\n칸 앞면의 작은 글씨 `n=3`이 그 칸에서의 변수 값이고,\n큰 숫자 3은 그 칸의 **높이**예요.\n\n지금은 출구까지 남은 칸 수와 같아요. 높이는 증명할 때 다시 나와요.',
      en: "The person in front of the building is **the running program**. The stair they stand on is the program's current state:\nthe small `n=3` on its front is the variable value there,\nand the big 3 is the stair's **height**.\n\nHere it equals the number of stairs left to the exit. Heights come back when you prove things.",
    },
    shots: [{ scene: C3 }],
    hold: 'start',
    focus: ['walker', 'stairHere'],
  },
  {
    chapter: 'stage',
    text: {
      ko: "반복문은 한 바퀴를 돌기 전에 매번 **조건을 검사**해요. 사람 머리 위의 `3 > 0`이 바로 그 검사예요.\n\nn이 3이니 '3이 0보다 큰가?'를 묻는 거예요. 참(✓)이면 안쪽 줄을 실행하러 가요.\n\n코드에서도 지금 검사하는 `while` 줄이 밝게 표시돼요.",
      en: "Before every round the loop **checks its condition**. The `3 > 0` above the person's head is that check: n is 3, so it asks 'is 3 greater than 0?'.\n\nIf true (✓), the inside line runs next.\n\nIn the code, the `while` line being checked lights up too.",
    },
    shots: [{ scene: C3 }],
    hold: 'check:0:decided',
    focus: ['check', 'codeLine'],
  },
  {
    chapter: 'stage',
    text: {
      // "아래의" / "below" dropped (SPEC_v0.7): the button now sits beside the text on a wide screen
      ko: "참이면 안쪽 줄 `n := n - 1`이 실행돼 n이 3에서 2가 되고, 사람은 한 칸 아래 `n=2` 칸으로 내려가요. 그림 왼쪽 위의 걸음도 1이 돼요.\n\n**한 단계 ▶** 버튼으로 직접 움직여 보세요. 누를 때마다 '조건 검사'와 '한 칸 내려가기'가 하나씩 진행되고, 코드의 밝은 줄도 함께 움직여요.",
      en: 'If true, the inside line `n := n - 1` runs: n goes from 3 to 2 and the person steps down to the `n=2` stair. The step count at the top left becomes 1.\n\nUse **One step ▶** to move them yourself. Each press does one thing, a check or one stair down, and the lit line in the code moves along.',
    },
    shots: [{ scene: C3 }],
    step: true,
    focus: ['codeLine', 'walker'],
    extra: 'stepper',
  },
  {
    chapter: 'stage',
    text: {
      ko: '세 칸을 내려가면 n이 0이 돼요. 이번 검사 `0 > 0`은 거짓(✗)이라 반복이 끝나요.\n\n그러면 사람은 **출구**로 나가요. 출구에 닿았다는 건 반복문이 끝났다는 뜻이에요.',
      en: 'After three stairs n is 0. This time the check `0 > 0` is false (✗), so the loop ends and the person leaves by the **exit**.\n\nReaching the exit means the loop has ended.',
    },
    shots: [{ scene: C3 }],
    hold: 'lastCheck',
    focus: ['door', 'check'],
  },
  {
    chapter: 'stage',
    text: {
      ko: '정리해 볼게요.\n반복 한 바퀴는 계단 한 칸이고, 조건이 거짓이 되면 출구로 나가요.\n\nn = 3에서 시작하면 세 칸을 내려가 출구로 나가니, 이 반복문은 세 바퀴 돌고 끝나요. 이제 처음부터 끝까지 이어서 보세요.',
      en: 'To sum up: one round of the loop is one stair down, and when the condition becomes false the person leaves by the exit.\n\nFrom n = 3 they go down three stairs and out, so this loop runs three rounds and ends. Now watch it from start to finish.',
    },
    shots: [{ scene: C3 }],
    extra: 'legend',
    noFocus: 'the summary: the legend card names every part, and the whole run plays',
  },
  // ---------------------------------------------------------------- 1단계 판정 / Step 1, verdict
  {
    chapter: 'verdict',
    text: {
      // "아래" / "below" dropped (SPEC_v0.7): the verdict card now sits beside the text on a wide screen
      ko: "**1단계 · 판정.**\n레벨마다 먼저 '이 반복문은 끝나는가?'를 골라요.\n\n**끝난다**는 허락된 어떤 값으로 시작해도 언젠가 출구에 닿는다는 뜻이에요.\n**안 끝난다**는 영원히 걷게 되는 시작값이 하나라도 있다는 뜻이에요.\n어떤 값이 허락되는지는 레벨 화면의 **입력** 줄에 적혀 있어요.\n\n그림이 두 장면을 번갈아 보여 주면, 버튼 중 그 장면에 맞는 판정이 밝아져요.\n**아무도 모른다**는 수학자들도 아직 답을 모르는 반복문에 쓰는 판정이에요.",
      en: "**Step 1 · Verdict.**\nIn each level you first choose: does this loop end?\n\n**It ends** means that from every allowed start the walker reaches the exit some day.\n**It never ends** means at least one start keeps them walking forever.\nWhich starts are allowed is written on the level's **Inputs** line.\n\nThe picture switches between two scenes, and the matching verdict lights up.\n**Nobody knows** is for a loop that mathematicians have not solved yet.",
    },
    shots: [
      { scene: C3, label: { ko: '끝난다: 출구에 닿아요', en: 'It ends: the walker reaches the exit' }, tag: { ko: '끝난다', en: 'It ends' } },
      { scene: FLIP, label: { ko: '안 끝난다: 영원히 걸어요', en: 'It never ends: the walker walks forever' }, tag: { ko: '안 끝난다', en: 'It never ends' } },
    ],
    extra: 'verdicts',
    focus: ['extra'],
  },
  // ---------------------------------------------------------------- 2단계 증명 / Step 2, proof
  {
    chapter: 'proof',
    text: {
      // "아래 칸" → "입력칸", "in the box below" → "in the box" (SPEC_v0.7): the box now sits beside the text
      ko: "**2단계 · 증명(끝난다).**\n'끝난다'를 골랐다면 왜 끝나는지 보여야 해요. **남은 계단 수**, 곧 '반복이 앞으로 몇 바퀴 남았는지'를 세는 식을 쓰면 돼요. 이 반복문은 n이 1씩 줄다가 0에서 멈추니 남은 계단 수는 `n`이에요.\n\n그림은 각 칸을 이 식의 값만큼 높게 그려요. 왼쪽의 세로 눈금이 그 높이이고, 맨 아래 **0 · 땅**이 바닥이에요.\n\n입력칸에 `n`을 직접 입력해 보세요.",
      en: "**Step 2 · Proof (it ends).**\nIf you chose 'It ends', show why. Write the **steps left**: an expression that counts how many more rounds the loop has. This loop lowers n by 1 and stops at 0, so the steps left are `n`.\n\nThe picture draws each stair as high as this value. The scale on the left shows the height, and **0 · ground** at the bottom is the floor.\n\nType `n` in the box.",
    },
    shots: [{ scene: { k: 'run', prog: C, start: { n: 3 }, V: 'n' }, label: { ko: '남은 계단 수 = n', en: 'steps left = n' } }],
    extra: 'tryV',
    focus: ['ruler'],
  },
  {
    chapter: 'proof',
    text: {
      ko: '정확한 횟수가 아니어도 돼요. 판정기(Z3)는 두 가지만 검사해요.\n① **한 바퀴마다 줄어드는가**: 한 칸 내려갈 때마다 높이가 낮아져야 해요. 같거나 높아지면 그 칸에 **평평한 걸음!**이나 **올라가는 걸음!**이 떠요.\n② **땅 위에 있는가**: 반복이 계속되는 칸은 높이가 0 이상이어야 해요. 0보다 낮으면 빨간 **땅 밑!** 칸이 생겨요.\n\n두 검사를 모두 통과하는 식을 **ranking function**이라고 해요. 레벨에서 틀린 식을 내면 판정기가 검사를 통과하지 못하는 걸음 하나(**반례**)를 찾아 그림으로 보여 줘요.',
      en: 'It need not be the exact count. The judge (Z3) checks just two things.\n① **Does it go down every round?** Each stair down must be lower. If it stays level or rises, that stair shows **flat step!** or **step up!**\n② **Is it above ground?** While the loop keeps going, the height must be 0 or more. Below 0 you get a red **below ground!** stair.\n\nAn expression that passes both is called a **ranking function**. If you submit a wrong one in a level, the judge finds one step that fails (a **counterexample**) and shows it in the picture.',
    },
    shots: [
      { scene: { k: 'run', prog: C, start: { n: 3 }, V: '0' }, label: { ko: '남은 계단 수 = 0: 계단이 평평해요 (①)', en: 'steps left = 0: the stairs are flat (①)' }, tag: { ko: '0', en: '0' }, focus: ['mark'] },
      { scene: { k: 'run', prog: C, start: { n: 3 }, V: '-n' }, label: { ko: '남은 계단 수 = −n: 땅 밑으로 내려가요 (②)', en: 'steps left = −n: below ground (②)' }, tag: { ko: '−n', en: '−n' }, focus: ['mark'] },
      { scene: { k: 'run', prog: C, start: { n: 3 }, V: 'n' }, label: { ko: '남은 계단 수 = n: ①② 모두 통과', en: 'steps left = n: passes ① and ②' }, tag: { ko: 'n', en: 'n' }, focus: [] },
    ],
  },
  {
    chapter: 'proof',
    text: {
      ko: "**2단계 · 증명(안 끝난다).**\n이번엔 다른 반복문이에요. 먼저 코드를 보세요. x가 0이 아닌 동안 x를 `1 - x`로 바꿔요.\n\n'안 끝난다'를 골랐다면 영원히 걷게 되는 **시작값** 하나를 주면 돼요. x = 2로 시작하면 2, −1, 2, −1, … 같은 두 칸을 맴돌아서 출구에 닿지 않아요. 고리 모양 길과 ∞ 표시가 그 뜻이에요.\n\n같은 칸으로 돌아오지 않고 끝없이 걷는 반복문도 있는데, 그건 레벨 5 앞에서 따로 알려 드릴게요.",
      en: "**Step 2 · Proof (it never ends).**\nA different loop this time. Look at the code first: while x is not 0, x becomes `1 - x`.\n\nIf you chose 'It never ends', give one **start value** that walks forever. From x = 2 the values go 2, −1, 2, −1, … around the same two stairs and never reach the exit; the ring-shaped path and the ∞ say so.\n\nSome loops walk forever without ever coming back to a stair; level 5 has its own short intro for those.",
    },
    shots: [{ scene: FLIP, label: { ko: '시작값 x = 2: 같은 두 칸을 맴돌아요', en: 'start x = 2: around the same two stairs' } }],
    focus: ['ring'],
  },
  {
    chapter: 'proof',
    text: {
      ko: '식에는 그 레벨의 변수, 숫자, `+ - * / %`, 괄호, `abs` · `min` · `max`를 쓸 수 있어요.\n\n변수 버튼이나 기호 버튼을 누르면 입력칸에 바로 들어가요. 버튼으로 `n`을 넣어 보세요.',
      en: "You can use the level's variables, numbers, `+ - * / %`, parentheses, `abs`, `min` and `max`.\n\nTap a variable or symbol button to put it into the box. Try putting in `n` with a button.",
    },
    shots: [{ scene: { k: 'run', prog: C, start: { n: 3 }, V: 'n' }, label: { ko: '남은 계단 수 = n', en: 'steps left = n' } }],
    extra: 'chips',
    focus: ['extra'],
  },
  // ---------------------------------------------------------------- 시작하기 / Your turn
  {
    chapter: 'go',
    text: { ko: '이제 레벨 1에서 직접 해 봐요!', en: 'Now try level 1 yourself!' },
    shots: [{ scene: C5 }],
    wide: true,
    extra: 'levelCard',
    noFocus: 'the last page: the level card is the way on, the whole picture plays',
  },
];

const R: TutorialKey = 'railing';
const F: TutorialKey = 'floors';
const G: TutorialKey = 'grow';

/**
 * The short intros, shown the first time level 5 / 7 / 10 is opened: the bottomless zone (SPEC_v0.6 §E; level 5 is
 * the first level whose "never" proof needs a zone), the railing (level 7, the first level whose proof needs one,
 * SPEC_v0.4 §G) and floors (level 10). The railing and floors texts are SPEC_v0.3 §4's.
 */
export const INTROS: Record<number, Intro> = {
  5: {
    level: 5,
    title: { ko: '바닥 없는 구역', en: 'Bottomless zone' },
    pages: [
      {
        text: {
          ko: '이 반복문은 x = 1에서 시작하면 1, 4, 7, 10, … 계속 커져서 0에 닿지 않아요. 그런데 같은 상태가 다시 나오지 않으니 맴도는 시작값으로는 증명할 수 없어요.\n\n그림에서도 사람은 같은 칸으로 돌아오지 않고 끝없이 내려가요.',
          en: 'From x = 1 this loop goes 1, 4, 7, 10, … and never reaches 0. But no state ever comes back, so a start that goes round in a circle cannot prove it.\n\nIn the picture the person never returns to a stair and keeps going down.',
        },
        shots: [{ scene: { k: 'run', prog: G, start: { x: 1 } } }],
        focus: ['walker'],
      },
      {
        text: {
          ko: '이럴 땐 시작값과 함께 **바닥 없는 구역** Z를 정해요. Z는 세 가지를 만족해야 해요.\n① 시작값이 Z 안에 있다.\n② Z 안에서는 반복 조건이 참이라 출구로 나갈 수 없다.\n③ Z 안에서 한 걸음 가도 다시 Z 안이다.\n\n여기서는 Z = `x > 0`이에요. x = 1은 0보다 크고(①), 0보다 크면 0이 아니고(②), 3을 더해도 여전히 0보다 커요(③).',
          en: 'Then, together with the start, give a **bottomless zone** Z. Z must satisfy three things:\n① the start is in Z;\n② inside Z the loop condition is true, so there is no way out;\n③ one step from inside Z lands inside Z again.\n\nHere Z = `x > 0`: x = 1 is above 0 (①), a number above 0 is not 0 (②), and adding 3 keeps it above 0 (③).',
        },
        shots: [{ scene: { k: 'run', prog: G, start: { x: 1 }, zone: 'x > 0' } }],
        focus: ['zone'],
      },
    ],
  },
  7: {
    level: 7,
    title: { ko: '난간', en: 'Railing' },
    pages: [
      {
        text: {
          ko: "남은 계단 수는 `k`예요.\n그런데 판정기는 '혹시 k가 −5라면?' 하고 의심해요. 그러면 반복이 계속되는데 0 밑이거든요.",
          en: 'The steps left are `k`.\nBut the judge asks: what if k were −5? Then the loop keeps going below zero.',
        },
        shots: [
          { scene: { k: 'run', prog: R, start: {}, V: 'k' }, label: { ko: '실제 실행: k = 10에서 출발', en: 'The real run: from k = 10' }, tag: { ko: 'k = 10', en: 'k = 10' }, focus: ['ruler'] },
          {
            scene: { k: 'run', prog: R, at: { k: -5 }, V: 'k', max: 5 },
            label: { ko: '판정기의 의심: k = −5라면? 땅 밑으로 내려가요', en: 'The judge asks: what if k = −5? Below ground' },
            tag: { ko: 'k = −5', en: 'k = −5' },
            focus: ['mark'],
          },
        ],
      },
      {
        text: {
          ko: '실제로 k는 10에서 시작해 늘 0 이상이에요. 이 사실을 **난간** `k >= 0`으로 알려 주면 증명이 돼요.\n\n난간은 시작할 때 참이고 한 걸음 뒤에도 참이어야 해요.',
          en: 'In fact k starts at 10 and never goes below 0. Tell the judge with a **railing** `k >= 0` and the proof goes through.\n\nA railing must hold at the start and still hold one step later.',
        },
        shots: [
          {
            scene: { k: 'run', prog: R, start: {}, V: 'k', railing: 'k >= 0', ghost: { k: -5 } },
            label: { ko: '난간 k ≥ 0: k = −5는 난간 밖이에요', en: 'Railing k ≥ 0: k = −5 is outside it' },
            tag: { ko: '난간 밖의 k = −5', en: 'k = −5 outside' },
            focus: ['railing', 'ghost'],
          },
          { scene: { k: 'run', prog: R, start: {}, V: 'k', railing: 'k >= 0' }, label: { ko: '난간 안에서는 남은 계단 수 k로 증명 끝', en: 'Inside the railing, steps left k is a proof' }, tag: { ko: '난간 안', en: 'inside' }, focus: ['railing'] },
        ],
      },
    ],
  },
  10: {
    level: 10,
    title: { ko: '층과 계단', en: 'Floors and steps' },
    pages: [
      {
        text: {
          ko: '층 f와 그 층의 계단 s가 있어요.\n한 층을 다 내려가면 아래층 꼭대기(계단 5)에서 다시 시작해요. 그래서 f나 s 하나만으로는 셀 수 없어요.',
          en: 'There is a floor f and a step s on that floor.\nAfter the last step of a floor you start again at the top (step 5) of the floor below, so neither f nor s alone counts it.',
        },
        // SPEC_v0.7 §C: the rings sit on the steps where the floor changes (the first shot's were on the ruler)
        shots: [
          { scene: { k: 'run', prog: F, start: { f: 2, s: 2 }, V: '(f, s)' }, label: { ko: '한 층을 다 내려가면 아래층 꼭대기로', en: 'After a floor, the top of the floor below' }, tag: { ko: '층과 계단', en: 'floors' }, focus: ['floorStep'] },
          { scene: { k: 'run', prog: F, start: { f: 2, s: 2 }, V: 'f + s' }, label: { ko: 'f + s로 세면 아래층으로 갈 때 올라가요', en: 'Counting with f + s goes up when the floor changes' }, tag: { ko: 'f + s', en: 'f + s' }, focus: ['mark'] },
        ],
      },
      {
        text: {
          ko: '남은 계단 수를 (층, 계단) 짝 `(f, s)`로 쓰면 돼요.\n층이 줄거나, 같은 층에서 계단이 줄면 내려간 거예요.',
          en: 'Write the steps left as a pair (floor, step): `(f, s)`.\nGoing down means: a lower floor, or the same floor and a lower step.',
        },
        shots: [{ scene: { k: 'run', prog: F, start: { f: 2, s: 2 }, V: '(f, s)' }, label: { ko: '남은 계단 수 = (f, s): 매 걸음 내려가요', en: 'steps left = (f, s): every step goes down' } }],
        focus: ['ruler'],
      },
    ],
  },
};

/** Levels with an intro of their own. */
export const INTRO_LEVELS = [5, 7, 10];

export function introFor(level: number): Intro | null {
  return INTROS[level] ?? null;
}

export function program(key: TutorialKey): Level {
  return TUTORIAL_PROGRAMS[key];
}

/** The program a shot shows (the code card follows it). */
export function shotProgram(sh: Shot): TutorialKey {
  return sh.scene.k === 'idle' ? (sh.scene.prog ?? C) : sh.scene.prog;
}

/** What a shot of a page talks about: the shot's own focus, else the page's. */
export function focusOf(p: TutPage, shot: number): Focus[] {
  return p.shots[shot]?.focus ?? p.focus ?? [];
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
  if (scene.zone) {
    if (out.k !== 'shaft') throw new Error('a zone needs a run that never ends without repeating a state');
    out.zone = scene.zone;
  }
  return out;
}

// ---------------------------------------------------------------- step mode (page 6)

/**
 * One beat of the step mode, as the screen shows it after the beat: the lit code lines, the step counter and the
 * state at the top left (with the length of the whole run once the walker is out), and a status line in words.
 * `auto`: follows the beat before it without a press (the walk out of the door after the check that fails).
 */
export interface StepBeat {
  kind: 'start' | 'check' | 'step' | 'exit';
  /** The stair the walker is on. */
  k: number;
  lines: number[];
  holds?: boolean;
  steps: number;
  state: State;
  ended?: number;
  auto?: boolean;
  status: Text;
}

const minus = (s: string) => s.replace(/-/g, '−');
const stateWords = (prog: Level, s: State) => prog.vars.map((v) => `${v} = ${minus(s[v]!.toString())}`).join(', ');

/** The beats of the step mode from the simulator: start, then a check before every step, the last one false. */
export function stepBeats(prog: Level, s0: State, max = 30): StepBeat[] {
  const codeLines = prog.code.split('\n');
  const out: StepBeat[] = [
    {
      kind: 'start',
      k: 0,
      lines: [],
      steps: 0,
      state: s0,
      status: { ko: `처음 상태: ${stateWords(prog, s0)}, 아직 한 바퀴도 안 돌았어요`, en: `Start: ${stateWords(prog, s0)}, no round yet` },
    },
  ];
  let s = s0;
  for (let k = 0; k <= max; k++) {
    const check = guardCheck(prog, s);
    const w = prog.prog.whileLine;
    if (!guardHolds(prog, s)) {
      out.push({
        kind: 'check',
        k,
        lines: [w],
        holds: false,
        steps: k,
        state: s,
        status: { ko: `조건 검사: ${check} → 거짓, 반복이 끝나 출구로 나가요`, en: `Check: ${check} → false, so the loop ends and the walker leaves by the exit` },
      });
      out.push({ kind: 'exit', k, lines: [w], holds: false, steps: k, state: s, ended: k, auto: true, status: out[out.length - 1]!.status });
      return out;
    }
    out.push({ kind: 'check', k, lines: [w], holds: true, steps: k, state: s, status: { ko: `조건 검사: ${check} → 참`, en: `Check: ${check} → true` } });
    if (k === max) break;
    const { next, lines } = step(prog, s);
    const body = lines.map((i) => `\`${codeLines[i]!.trim()}\``).join(' ');
    out.push({
      kind: 'step',
      k: k + 1,
      lines,
      steps: k + 1,
      state: next,
      status: { ko: `${body} 실행: ${stateWords(prog, next)}, 한 칸 내려가요`, en: `Run ${body}: ${stateWords(prog, next)}, one stair down` },
    });
    s = next;
  }
  return out;
}

/** The beat a held page shows (start, the i-th check, or the check that fails). */
export function heldBeat(beats: StepBeat[], hold: Hold): StepBeat {
  if (hold === 'start') return beats[0]!;
  const checks = beats.filter((b) => b.kind === 'check');
  if (hold === 'lastCheck') return checks.find((b) => !b.holds) ?? checks[checks.length - 1]!;
  const i = Number(hold.split(':')[1]);
  return checks[i] ?? checks[checks.length - 1]!;
}

// ---------------------------------------------------------------- narration markup

export type RichPart = { kind: 'text' | 'bold' | 'code'; s: string };

/** One line of a narration: its pieces, and whether it is a list item (①, ★, "- ": a hanging indent). */
export interface RichLine {
  list: boolean;
  parts: RichPart[];
}

/** A paragraph: its lines. */
export type RichPara = RichLine[];

/** A line that starts a numbered or listed item gets a hanging indent (SPEC_v0.7 §B). */
const LIST_LINE = /^(?:[①-⑳]|★|- )/;

/**
 * Narration as blocks (SPEC_v0.7 §B): `\n\n` splits paragraphs, `\n` lines; each line keeps its **bold** and `code`
 * markup. Empty lines and spaces at the ends of lines are dropped.
 */
export function richBlocks(text: string): RichPara[] {
  return text
    .split(/\n[ \t]*\n+/)
    .map((para) =>
      para
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => ({ list: LIST_LINE.test(line), parts: richParts(line) })),
    )
    .filter((para) => para.length > 0);
}

/**
 * The bold lead of a narration: a **bold** opening that is a sentence or a heading of its own (it ends with . ! ?
 * or the line ends right after it). Null when the text does not open that way ("**입력**은 …" is a word in bold,
 * not a lead).
 */
export function leadOf(text: string): string | null {
  const m = /^\*\*(.+?)\*\*/.exec(text);
  if (!m) return null;
  const after = text.slice(m[0].length);
  if (/[.!?]$/.test(m[1]!) || /^\s*(\n|$)/.test(after) || /^:/.test(after)) return m[1]!;
  return null;
}

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
