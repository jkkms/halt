// Korean / English strings. Templates use {name} placeholders.
import type { Lang } from '../core/levels.ts';

export type { Lang };

const en = {
  tagline: 'Prove that a loop ends, one step at a time.',
  levels: 'Levels',
  daily: 'Daily',
  howTo: 'How to play',
  langToggle: '한국어',
  langToggleTitle: 'Switch to Korean',

  judgeWaiting: 'Judge: preparing…',
  judgeLoading: 'Judge: loading Z3…',
  judgeLoadingPct: 'Judge: loading Z3 {pct}%',
  judgeReady: 'Judge ready',
  judgeError: 'Judge unavailable',
  judgeErrIsolation:
    'The judge (Z3) needs a cross-origin isolated page and this browser did not allow it. Reload the page; private windows can block it. You can still run starts for “It never ends”.',
  judgeErrDownload: 'The judge (Z3) could not be downloaded. Check the connection and reload.',
  judgeErrInit: 'The judge (Z3) could not start in this browser.',
  judgeLoadingNote: 'You can read the level and type your answer while the judge loads (about 8 MB, once).',

  levelN: 'Level {n}',
  dailyTag: 'Daily puzzle {date}',
  inputs: 'Inputs',
  start: 'Start',
  anyIntegers: 'any integers',
  facts: 'Known at the loop head',
  none: 'nothing extra',
  localsNote: '{names} only lives inside one iteration of the loop.',
  intDomain: 'All variables are mathematical integers. / and % round like Z3: the remainder is never negative.',

  verdictQ: 'Does this loop always end?',
  verdictEnds: 'It ends',
  verdictNever: 'It never ends',
  verdictNobody: 'Nobody knows',
  verdictHelp: '“It ends”: from every allowed start the walker reaches the ground. “It never ends”: some allowed start walks forever.',

  stepsLeft: 'Steps left',
  railing: 'Railing',
  optional: 'optional',
  vPlaceholder: 'e.g. n - i',
  vPlaceholderTuple: 'e.g. n - i  or  (a, b)',
  rPlaceholder: 'e.g. i <= n',
  check: 'Check',
  checking: 'Checking…',
  waitingJudge: 'Waiting for the judge…',
  lengthPar: '{len:char:chars} · par {par}',
  lengthOnly: '{len:char:chars}',
  syntaxHelp: 'Use numbers, the variables, + - * / % ( ), abs(e), min(e, e), max(e, e).',
  syntaxTuple: 'A tuple (a, b) means floor a, step b on that floor.',
  railHelp: 'A condition that holds at the start and after every step. Use == != < <= > >=, &&, ||, !.',

  startValues: 'Start values',
  run: 'Run',
  runHelp: 'Pick a start that you think runs forever. The start must satisfy: {start}.',
  runHelpAny: 'Pick a start that you think runs forever. Any integers are allowed.',
  leftInRun: 'left in this run',
  zone: 'Bottomless zone',
  zonePlaceholder: 'e.g. x > 0',
  zoneHelp: 'A condition that holds at your start, keeps the loop running, and still holds after every step.',

  ckBounded: 'Above ground: while the loop runs, V ≥ 0',
  ckBoundedTuple: 'Above ground: while the loop runs, every part of V ≥ 0',
  ckDecreasing: 'Every step goes down: V drops by at least 1',
  ckDecreasingTuple: 'Every step goes down: down a floor, or same floor and down a step',
  ckRailStart: 'Railing at the start: every start satisfies R',
  ckRailStep: 'Railing holds: after any step, R still holds',
  ckZoneStart: 'Your start is inside the zone',
  ckZoneGuard: 'Inside the zone the loop keeps running',
  ckZoneStep: 'No step leaves the zone',

  proved: 'Proved: it ends.',
  refuted: 'Not a proof yet.',
  undecided: 'The judge could not decide.',
  undecidedBody: 'Z3 gave up after 5 seconds. This does not cost an attempt; try a simpler expression.',

  cexBelow: 'Still walking but {k:step:steps} below ground: at {s} the loop keeps going, and V = {v}.',
  cexBelowTuple: 'Still walking but below ground: at {s} the loop keeps going, and V = {v} has a negative part.',
  cexFlat: 'Flat step: {s} → {s2} keeps V at {v}. Every step must go down by at least 1.',
  cexUp: 'This step goes up from {v} to {v2} steps left: {s} → {s2}.',
  cexFlatTuple: 'This step stays put: V stays {v} on {s} → {s2}. It must go down a floor, or stay on the floor and go down a step.',
  cexUpTuple: 'This step goes up: V goes from {v} to {v2} on {s} → {s2}. It must go down a floor, or stay on the floor and go down a step.',
  cexRailStart: 'The railing is missing at the start: {s} is a start, but R is false there.',
  cexRailStep: 'The railing breaks: R holds at {s}, but not one step later at {s2}.',
  cexZoneStart: 'Your start {s} is not inside the zone.',
  cexZoneGuard: 'The zone contains {s}, where the loop stops ({guard} is false).',
  cexZoneStep: 'A step leaves the zone: {s} is inside, {s2} is not.',
  linesRun: 'Highlighted in the code: the lines this step runs.',
  railHint: 'Can the loop really reach {s} from a start? If not, a railing R can rule such states out.',

  notAllowed: 'This start is not allowed by the level ({start}). No attempt used.',
  ended: 'The walker reached the ground: the loop ended after {k:step:steps}.',
  endedLong: 'The walker reached the ground after {k} steps (a long walk, but it ends).',
  endedNot: 'So this start does not show that the loop never ends.',
  cycle: 'Back where it was: after {k:step:steps} the walker is at {s} again, so it circles forever. Proof by cycle.',
  needZone: 'Still walking after {cap} steps without ever repeating a state. To prove it never ends, mark a bottomless zone Z around this run.',
  zoneProved: 'Proved: from {s0} the walker never leaves the bottomless zone, so the loop never ends.',
  keepsGoing: 'Meanwhile the sample run from {s0} never reaches the ground.',
  nobodyWrong: 'Someone does know: try again.',
  collatzNote: 'This loop is the Collatz conjecture, open since 1937: nobody has proved that it ends for every n ≥ 1, and nobody has found an n that runs forever.',
  noAttempt: 'No attempt used.',

  solved: 'Solved!',
  attempts: 'Attempts: {n}',
  attemptsPractice: 'Tutorial: attempts do not count',
  next: 'Next level',
  retry: 'Play again',
  copyResult: 'Copy result',
  copied: 'Copied!',
  copyFailed: 'Copy this:',
  starsRule: '★ solved · ★★ within 3 attempts · ★★★ also {extra}',
  starsExtraEnds: 'answer ≤ par ({par} chars)',
  starsExtraFirst: 'on the first attempt',
  bestStars: 'Best: {stars}',

  sceneTitle: 'The building',
  chartTitle: 'Steps left on sample runs',
  chartTraceTitle: 'Variables on your run',
  chartEmpty: 'Type a steps-left expression V to see it on the sample runs.',
  chartNever: 'The chart shows a steps-left expression; for “It never ends” watch the building.',
  ground: 'ground',
  basement: 'basement',
  stepsLeftAxis: 'steps left',
  floorAxis: 'floor {a}, step {b}',
  floorN: 'floor {n}',
  stepAxis: 'step',
  stepCounter: 'step {k}',
  sceneIdle: 'Each loop iteration is one step down the stairs. Give a verdict, then an answer, to see the walk.',
  sceneSample: 'Sample run from {s0}',
  sceneCex: 'Counterexample from the judge',
  sceneRing: 'Circling forever',
  sceneShaft: 'Bottomless: still walking',
  sceneEnded: 'The walk ends after {k:step:steps}',
  sceneProved: 'Every walk reaches the ground',
  replay: 'Replay',
  sampleLabel: 'Sample',
  exit: 'exit',
  forever: 'forever',
  showing: 'showing the first {n} steps',

  tutSkip: 'Skip tutorial',
  tutNext: 'Next',
  tutDone: 'Done',
  tutPractice: 'Tutorial: attempts here do not count.',
  tutBuilding:
    'A loop is a person walking down the stairs of a building. One loop iteration is one step. The walker carries the variables (here n). When the loop stops, the walker is out on the ground.',
  tutVerdict: 'First, the verdict. Does this walk always end? Press “It ends”.',
  tutZero: 'Now prove it. V is the number of steps left. Start with a bad guess: type 0 and press Enter.',
  tutFlat: 'Flat step! With V = 0 the walker has 0 steps left before and after a step. Every step must go down by at least 1. Now type n and press Enter.',
  tutTryN: 'Not a proof yet: read the red line. Now type n and press Enter.',
  tutPass:
    'Both checks pass: while the loop runs, n is never below ground (n ≥ 0), and every step goes down (n becomes n − 1). That is a termination proof.',
  tutToNext: 'Press “Next level”.',
  tutL2: 'Here i counts up from 0 to n. Try V = n first.',
  tutL2n: 'n never changes, so every step is flat. Now try i.',
  tutL2i: 'i grows, so the walker climbs. And i can even be negative here: below ground. What gets smaller by one at every step?',
  tutL2Any: 'Read the counterexample: it is a real state where your V fails. What gets smaller by one at every step?',
  tutStars:
    'Stars: ★ solved, ★★ within 3 attempts, ★★★ also with an answer no longer than par (spaces do not count). Best stars are kept on this device.',
  tutL3: 'Your turn. A wrong answer always comes with a concrete counterexample: the state, the next state, and V before and after. That is the end of the tutorial.',

  introNeverTitle: 'A loop may also never end',
  introNever:
    'If you think some start runs forever, pick “It never ends” and give that start. If the walker comes back to a state it has been in, it circles forever: that is a proof. If it keeps finding new states, mark a bottomless zone Z: a condition that holds at your start, keeps the loop running, and still holds after every step.',
  introRailTitle: 'Railings',
  introRail:
    'Sometimes V only works on the states the loop can really reach. A railing R is a condition that holds at every start and stays true after every step (an invariant). The judge then checks V only on states inside the railing. The railing counts toward par.',
  introTupleTitle: 'Floors',
  introTuple:
    'Steps left can now be a tuple (a, b): floor a, step b on that floor. A step may go down a floor, and then the step count may reset to anything, even back to the top. Or it stays on the floor and goes down a step. Every part must be ≥ 0 while the loop runs.',
  gotIt: 'Got it',

  helpTitle: 'How to play',
  helpReplay: 'Replay the tutorial',
  helpClose: 'Close',
  helpIntro:
    'Each level is a loop. First give a verdict, then prove it. The judge is the Z3 SMT solver, running in your browser.',
  helpVerdicts: 'Verdicts',
  helpEndsRow: 'Give V, the steps left (a ranking function), optionally a railing R. Z3 checks that V ≥ 0 while the loop runs and that every step lowers V by at least 1.',
  helpNeverRow: 'Give a start that runs forever. A repeated state proves it; otherwise also give a bottomless zone Z.',
  helpNobodyRow: 'Right only on the last level.',
  helpConcepts: 'Concept ↔ game',
  helpConceptRows: [
    ['ranking function', 'steps left V'],
    ['V ≥ 0 while looping', 'staying above ground'],
    ['V decreases by ≥ 1', 'every step goes down'],
    ['lexicographic (a, b)', 'floor a, step b; a floor down resets the steps'],
    ['supporting invariant', 'railing R'],
    ['recurrent set', 'bottomless zone Z'],
  ] as [string, string][],
  helpSyntax: 'Expressions',
  helpSyntaxBody:
    'Numbers, the level’s variables, + - * / % ( ), abs, min, max. Conditions: == != < <= > >=, &&, ||, !. A tuple (a, b, …) from level 10. / and % are Euclidean as in Z3 (−7 / 2 = −4, −7 % 2 = 1). Enter submits.',
  helpStars: 'Stars',
  helpStarsBody: '★ solved · ★★ within 3 attempts · ★★★ also length ≤ par (ends-levels) or first attempt (never-levels and the last level). Parse errors, disallowed starts and judge timeouts cost nothing.',
  helpDaily: 'Daily puzzle',
  helpDailyBody: 'One level per day (UTC). After solving it, copy a result line that shows your attempts but not your answer.',
  helpTopics: 'Short intros',

  endTitle: 'Nobody knows',
  endBody1:
    'Right. For every start anyone has tried, this loop reaches 1 and stops. But nobody has proved that it always does: this is the Collatz conjecture, open since 1937.',
  endBody2:
    'Termination in general is undecidable: by the halting problem, no program can take every loop and correctly say whether it ends. So every termination prover, including you with Z3, must sometimes say “I don’t know”. This specific loop is not known to be undecidable; it is simply an open problem.',
  endBody3: 'Thank you for playing It Ends.',
  close: 'Close',

  errAt: ' (at character {n})',
  err_empty: 'Type an expression.',
  err_emptyValue: 'Type a whole number.',
  err_notInteger: '“{text}” is not a whole number.',
  err_tooBig: 'Use at most 15 digits.',
  err_badChar: 'Unexpected character “{ch}”.',
  err_unexpected: 'Unexpected “{tok}”.',
  err_unexpectedEnd: 'The expression stops too early.',
  err_expected: 'Expected “{want}” but found “{got}”.',
  err_expectedEnd: 'Missing “{want}” at the end.',
  err_assignEq: 'To compare, write == (a single = is not allowed).',
  err_singleAmp: 'Write {op}.',
  err_wordOp: 'Write {op} instead of “{word}”.',
  err_implicitMul: 'Write {num}*{name} to multiply.',
  err_chainedCmp: 'Comparisons cannot be chained: write a < b && b < c.',
  err_unknownFn: 'Unknown function “{name}”. Available: abs, min, max.',
  err_arity: '{fn} takes {n} value(s).',
  err_unknownVar: 'There is no variable “{name}” here. Variables: {vars}.',
  err_localVar: '“{name}” only exists inside one iteration. Use the variables at the loop head: {vars}.',
  err_wantInt: 'A number is needed here, not a condition.',
  err_wantBool: 'A condition (like x > 0) is needed here, not a number.',
  err_tupleHere: 'A tuple (a, b) can only be the whole steps-left answer.',
  err_tupleLocked: 'Tuples (a, b) unlock at level 10.',
  err_rankIsCond: 'Steps left must be a number (like n - i), not a condition.',
  err_condIsNum: 'This must be a condition (like i <= n), not a number.',
  err_missingOp: 'Missing an operator before “{tok}”.',
  err_bareTuple: 'Put a tuple in parentheses: (a, b).',
};

type Strings = typeof en;

const ko: Strings = {
  tagline: '반복문이 끝난다는 것을 한 걸음씩 증명하는 퍼즐',
  levels: '레벨',
  daily: '오늘의 문제',
  howTo: '하는 법',
  langToggle: 'English',
  langToggleTitle: '영어로 바꾸기',

  judgeWaiting: '판정기 준비 중…',
  judgeLoading: 'Z3 불러오는 중…',
  judgeLoadingPct: 'Z3 불러오는 중 {pct}%',
  judgeReady: '판정기 준비됨',
  judgeError: '판정기를 쓸 수 없음',
  judgeErrIsolation:
    '판정기(Z3)는 교차 출처 격리(cross-origin isolation)가 된 페이지에서만 돌아가는데, 이 브라우저에서는 켜지지 않았어요. 새로고침해 보세요. 시크릿 창에서는 막힐 수 있어요. “안 끝난다”의 시작값 실행은 지금도 할 수 있어요.',
  judgeErrDownload: '판정기(Z3)를 내려받지 못했어요. 연결을 확인하고 새로고침해 보세요.',
  judgeErrInit: '이 브라우저에서 판정기(Z3)를 시작하지 못했어요.',
  judgeLoadingNote: '판정기를 불러오는 동안에도 문제를 읽고 답을 입력할 수 있어요 (처음 한 번, 약 8 MB).',

  levelN: '레벨 {n}',
  dailyTag: '오늘의 문제 {date}',
  inputs: '입력',
  start: '시작 조건',
  anyIntegers: '아무 정수',
  facts: '반복 시작마다 알려진 사실',
  none: '없음',
  localsNote: '{names}: 반복 한 번 안에서만 쓰는 변수예요.',
  intDomain: '모든 변수는 수학의 정수예요. /와 %는 Z3처럼 계산해서 나머지가 음수가 되지 않아요.',

  verdictQ: '이 반복문은 언제나 끝날까요?',
  verdictEnds: '끝난다',
  verdictNever: '안 끝난다',
  verdictNobody: '아무도 모른다',
  verdictHelp: '“끝난다”: 허용된 모든 시작에서 걷는 사람이 땅에 닿아요. “안 끝난다”: 영원히 걷는 시작이 하나라도 있어요.',

  stepsLeft: '남은 걸음',
  railing: '난간',
  optional: '선택',
  vPlaceholder: '예: n - i',
  vPlaceholderTuple: '예: n - i 또는 (a, b)',
  rPlaceholder: '예: i <= n',
  check: '판정',
  checking: '판정 중…',
  waitingJudge: '판정기를 기다리는 중…',
  lengthPar: '{len}자 · 기준 {par}자',
  lengthOnly: '{len}자',
  syntaxHelp: '숫자, 변수, + - * / % ( ), abs(e), min(e, e), max(e, e)를 쓸 수 있어요.',
  syntaxTuple: '튜플 (a, b)는 a층의 b번째 계단이라는 뜻이에요.',
  railHelp: '시작할 때 참이고 매 걸음 뒤에도 참인 조건이에요. == != < <= > >=, &&, ||, !를 쓸 수 있어요.',

  startValues: '시작값',
  run: '걸어 보기',
  runHelp: '영원히 걸을 것 같은 시작값을 고르세요. 시작값은 이 조건을 지켜야 해요: {start}.',
  runHelpAny: '영원히 걸을 것 같은 시작값을 고르세요. 아무 정수나 넣을 수 있어요.',
  leftInRun: '이 실행의 남은 걸음',
  zone: '바닥 없는 구역',
  zonePlaceholder: '예: x > 0',
  zoneHelp: '내 시작값에서 참이고, 그 안에서는 반복이 계속되며, 매 걸음 뒤에도 참인 조건이에요.',

  ckBounded: '땅 위: 반복하는 동안 V ≥ 0',
  ckBoundedTuple: '땅 위: 반복하는 동안 V의 모든 성분 ≥ 0',
  ckDecreasing: '매 걸음 내려감: V가 1 이상 줄어듦',
  ckDecreasingTuple: '매 걸음 내려감: 한 층 내려가거나, 같은 층에서 한 계단 내려감',
  ckRailStart: '시작할 때 난간: 모든 시작이 R을 만족',
  ckRailStep: '난간 유지: 한 걸음 뒤에도 R이 참',
  ckZoneStart: '내 시작값이 구역 안에 있음',
  ckZoneGuard: '구역 안에서는 반복이 계속됨',
  ckZoneStep: '어떤 걸음도 구역을 벗어나지 않음',

  proved: '증명 완료: 끝나요.',
  refuted: '아직 증명이 아니에요.',
  undecided: '판정기가 결정하지 못했어요.',
  undecidedBody: 'Z3가 5초 안에 답을 못 냈어요. 시도 횟수는 그대로예요. 더 단순한 식으로 해 보세요.',

  cexBelow: '아직 걷는 중인데 땅 밑이에요: {s}에서 반복이 계속되는데 V = {v}, 땅 밑 {k}칸.',
  cexBelowTuple: '아직 걷는 중인데 땅 밑이에요: {s}에서 반복이 계속되는데 V = {v}, 음수 성분이 있어요.',
  cexFlat: '평평한 걸음: {s} → {s2}에서 V가 {v} 그대로예요. 매 걸음 1 이상 내려가야 해요.',
  cexUp: '이 걸음은 오히려 올라가요. 남은 걸음 {v} → {v2} ({s} → {s2}).',
  cexFlatTuple: '이 걸음은 제자리예요: {s} → {s2}에서 V가 {v} 그대로예요. 한 층 내려가거나, 같은 층에서 한 계단 내려가야 해요.',
  cexUpTuple: '이 걸음은 올라가요: {s} → {s2}에서 V: {v} → {v2}. 한 층 내려가거나, 같은 층에서 한 계단 내려가야 해요.',
  cexRailStart: '시작할 때 난간이 없어요: 시작 상태 {s}에서 R이 거짓이에요.',
  cexRailStep: '난간이 끊겨요: {s}에서는 R이 참인데 한 걸음 뒤 {s2}에서는 거짓이에요.',
  cexZoneStart: '내 시작값이 구역 밖에 있어요: {s}.',
  cexZoneGuard: '구역 안의 {s}에서 반복이 멈춰요 ({guard} 거짓).',
  cexZoneStep: '한 걸음에 구역을 벗어나요: {s} (안) → {s2} (밖).',
  linesRun: '코드에서 강조한 줄이 이 걸음에 실행되는 줄이에요.',
  railHint: '반복이 시작부터 정말 {s}에 갈 수 있을까요? 갈 수 없다면 난간 R로 그런 상태를 빼 줄 수 있어요.',

  notAllowed: '이 레벨에서 허용하지 않는 시작이에요 ({start}). 시도 횟수는 그대로예요.',
  ended: '걷는 사람이 땅에 닿았어요. {k}걸음 만에 반복이 끝났어요.',
  endedLong: '{k}걸음 만에 땅에 닿았어요. 오래 걸렸지만 끝나요.',
  endedNot: '그래서 이 시작값으로는 안 끝난다는 걸 보일 수 없어요.',
  cycle: '제자리로 돌아왔어요: {k}걸음 뒤 다시 {s} 상태가 되니 영원히 같은 곳을 돌아요. 순환으로 증명 완료.',
  needZone: '{cap}걸음을 걸었는데 같은 상태가 한 번도 되풀이되지 않았어요. 안 끝난다는 걸 증명하려면 이 걸음을 감싸는 바닥 없는 구역 Z를 정하세요.',
  zoneProved: '증명 완료: {s0}에서 출발하면 바닥 없는 구역을 벗어나지 않으니 반복이 끝나지 않아요.',
  keepsGoing: '한편 {s0}에서 출발한 예시 실행은 땅에 닿지 않아요.',
  nobodyWrong: '아는 사람이 있어요. 다시 생각해 보세요.',
  collatzNote: '이 반복문은 1937년부터 풀리지 않은 콜라츠 추측이에요. 모든 n ≥ 1에서 끝난다는 증명도, 영원히 도는 n도 아직 아무도 찾지 못했어요.',
  noAttempt: '시도 횟수는 그대로예요.',

  solved: '해결!',
  attempts: '시도 {n}회',
  attemptsPractice: '튜토리얼: 시도 횟수를 세지 않아요',
  next: '다음 레벨',
  retry: '다시 하기',
  copyResult: '결과 복사',
  copied: '복사했어요!',
  copyFailed: '이 줄을 복사하세요:',
  starsRule: '★ 해결 · ★★ 3번 안에 · ★★★ 거기에 {extra}',
  starsExtraEnds: '답 길이 ≤ 기준 ({par}자)',
  starsExtraFirst: '첫 시도에',
  bestStars: '최고 기록: {stars}',

  sceneTitle: '건물',
  chartTitle: '예시 실행의 남은 걸음',
  chartTraceTitle: '내 실행의 변수 값',
  chartEmpty: '남은 걸음 V를 입력하면 예시 실행 위에 그려져요.',
  chartNever: '그래프는 남은 걸음 식을 보여 줘요. “안 끝난다”에서는 건물 그림을 보세요.',
  ground: '땅',
  basement: '지하',
  stepsLeftAxis: '남은 걸음',
  floorAxis: '{a}층, {b}번째 계단',
  floorN: '{n}층',
  stepAxis: '걸음',
  stepCounter: '걸음 {k}',
  sceneIdle: '반복 한 번이 계단 한 칸이에요. 판정을 고르고 답을 넣으면 걷는 모습이 보여요.',
  sceneSample: '예시 실행: {s0}에서 출발',
  sceneCex: '판정기가 찾은 반례',
  sceneRing: '영원히 같은 곳을 도는 중',
  sceneShaft: '바닥이 없어요: 계속 걷는 중',
  sceneEnded: '{k}걸음 만에 끝나요',
  sceneProved: '모든 걸음이 땅에 닿아요',
  replay: '다시 보기',
  sampleLabel: '예시',
  exit: '출구',
  forever: '영원히',
  showing: '처음 {n}걸음만 그렸어요',

  tutSkip: '튜토리얼 건너뛰기',
  tutNext: '다음',
  tutDone: '끝',
  tutPractice: '튜토리얼에서는 시도 횟수를 세지 않아요.',
  tutBuilding:
    '반복문은 건물 계단을 내려가는 사람이에요. 반복 한 번이 한 걸음이고, 걷는 사람은 변수(여기서는 n)를 들고 다녀요. 반복이 멈추면 땅에 내려선 거예요.',
  tutVerdict: '먼저 판정이에요. 이 걸음은 언제나 끝날까요? “끝난다”를 누르세요.',
  tutZero: '이제 증명할 차례예요. V는 남은 걸음 수예요. 일부러 틀린 답부터: 0을 입력하고 Enter를 누르세요.',
  tutFlat: '평평한 걸음이에요! V = 0이면 걸음 전에도 뒤에도 남은 걸음이 0이에요. 매 걸음 1 이상 내려가야 해요. 이제 n을 입력하고 Enter를 누르세요.',
  tutTryN: '아직 증명이 아니에요. 빨간 줄을 읽어 보고, 이제 n을 입력한 뒤 Enter를 누르세요.',
  tutPass: '두 검사를 모두 통과했어요. 반복하는 동안 n은 땅 밑으로 내려가지 않고(n ≥ 0), 매 걸음 내려가요(n이 n − 1이 됨). 이것이 종료 증명이에요.',
  tutToNext: '“다음 레벨”을 누르세요.',
  tutL2: '여기서 i는 0부터 n까지 올라가요. 먼저 V = n을 넣어 보세요.',
  tutL2n: 'n은 변하지 않으니 걸음마다 평평해요. 이번에는 i를 넣어 보세요.',
  tutL2i: 'i가 커지니 걷는 사람이 올라가요. 여기서는 i가 음수일 수도 있어서 땅 밑이 되기도 해요. 매 걸음 1씩 줄어드는 건 무엇일까요?',
  tutL2Any: '반례를 읽어 보세요. V가 실패하는 실제 상태예요. 매 걸음 1씩 줄어드는 건 무엇일까요?',
  tutStars: '별: ★ 해결, ★★ 3번 안에 해결, ★★★ 거기에 답 길이가 기준 이하(빈칸은 세지 않음). 최고 기록은 이 기기에 남아요.',
  tutL3: '이제 혼자 해 보세요. 틀린 답에는 언제나 구체적인 반례가 따라와요: 상태, 다음 상태, 그리고 그때의 V. 튜토리얼은 여기까지예요.',

  introNeverTitle: '끝나지 않는 반복도 있어요',
  introNever:
    '영원히 도는 시작값이 있다고 생각하면 “안 끝난다”를 고르고 그 시작값을 넣으세요. 걷는 사람이 전에 있던 상태로 돌아오면 영원히 돌아요. 그걸로 증명 끝이에요. 계속 새 상태로 간다면 바닥 없는 구역 Z를 정하세요. 내 시작값에서 참이고, 그 안에서는 반복이 계속되며, 매 걸음 뒤에도 참인 조건이에요.',
  introRailTitle: '난간',
  introRail:
    '어떤 V는 반복이 실제로 갈 수 있는 상태에서만 맞아요. 난간 R은 모든 시작에서 참이고 매 걸음 뒤에도 참인 조건(불변식)이에요. 난간을 주면 판정기는 난간 안의 상태에서만 V를 검사해요. 난간 길이도 답 길이에 들어가요.',
  introTupleTitle: '층',
  introTuple:
    '이제 남은 걸음을 튜플 (a, b)로 쓸 수 있어요: a층의 b번째 계단. 한 층 내려가면 계단 수는 아무 값으로나, 꼭대기로도 다시 올라갈 수 있어요. 아니면 같은 층에서 한 계단 내려가야 해요. 반복하는 동안 모든 성분은 0 이상이어야 해요.',
  gotIt: '알겠어요',

  helpTitle: '하는 법',
  helpReplay: '튜토리얼 다시 보기',
  helpClose: '닫기',
  helpIntro: '레벨마다 반복문이 하나 있어요. 먼저 판정을 고르고, 그다음 증명해요. 판정기는 브라우저 안에서 돌아가는 SMT 풀이기 Z3예요.',
  helpVerdicts: '판정',
  helpEndsRow: '남은 걸음 V(ranking function)를 주고, 필요하면 난간 R도 줘요. Z3가 반복하는 동안 V ≥ 0인지, 매 걸음 V가 1 이상 줄어드는지 검사해요.',
  helpNeverRow: '영원히 도는 시작값을 줘요. 같은 상태가 되풀이되면 증명 끝, 아니면 바닥 없는 구역 Z도 줘요.',
  helpNobodyRow: '마지막 레벨에서만 정답이에요.',
  helpConcepts: '개념 ↔ 게임',
  helpConceptRows: [
    ['ranking function', '남은 걸음 V'],
    ['반복하는 동안 V ≥ 0', '땅 위에 있기'],
    ['V가 1 이상 감소', '매 걸음 내려가기'],
    ['사전식 순서 (a, b)', 'a층 b계단, 한 층 내려가면 계단 수가 다시 채워짐'],
    ['보조 불변식 (supporting invariant)', '난간 R'],
    ['재귀 집합 (recurrent set)', '바닥 없는 구역 Z'],
  ],
  helpSyntax: '식 쓰는 법',
  helpSyntaxBody:
    '숫자, 레벨의 변수, + - * / % ( ), abs, min, max. 조건: == != < <= > >=, &&, ||, !. 튜플 (a, b, …)는 레벨 10부터. /와 %는 Z3와 같은 유클리드 나눗셈이에요 (−7 / 2 = −4, −7 % 2 = 1). Enter로 제출해요.',
  helpStars: '별',
  helpStarsBody: '★ 해결 · ★★ 3번 안에 · ★★★ 거기에 답 길이 ≤ 기준(끝나는 레벨) 또는 첫 시도(안 끝나는 레벨과 마지막 레벨). 식 오류, 허용되지 않는 시작값, 판정기 시간 초과는 시도로 세지 않아요.',
  helpDaily: '오늘의 문제',
  helpDailyBody: '하루에 한 레벨(UTC 기준). 풀고 나면 답은 빼고 시도 기록만 담긴 결과 한 줄을 복사할 수 있어요.',
  helpTopics: '짧은 설명',

  endTitle: '아무도 모른다',
  endBody1: '맞아요. 지금까지 시도한 모든 시작값에서 이 반복문은 1에 닿고 멈춰요. 하지만 언제나 그렇다는 증명은 아무도 못 했어요. 1937년부터 풀리지 않은 콜라츠 추측이에요.',
  endBody2:
    '일반적으로 종료 여부는 결정할 수 없는 문제예요. 정지 문제 때문에, 모든 반복문을 받아서 끝나는지 항상 옳게 말해 주는 프로그램은 없어요. 그래서 Z3와 함께하는 여러분을 포함한 모든 종료 증명기는 가끔 “모르겠다”고 말할 수밖에 없어요. 다만 이 반복문 자체가 결정 불가능하다고 알려진 건 아니고, 그냥 아직 풀리지 않은 문제예요.',
  endBody3: 'It Ends를 끝까지 해 주셔서 고마워요.',
  close: '닫기',

  errAt: ' ({n}번째 글자)',
  err_empty: '식을 입력하세요.',
  err_emptyValue: '정수를 입력하세요.',
  err_notInteger: '정수가 아니에요: “{text}”',
  err_tooBig: '15자리 이하로 입력하세요.',
  err_badChar: '쓸 수 없는 문자가 있어요: “{ch}”',
  err_unexpected: '여기에 올 수 없는 기호예요: “{tok}”',
  err_unexpectedEnd: '식이 덜 끝났어요.',
  err_expected: '여기에는 “{want}”가 와야 해요 (지금은 “{got}”).',
  err_expectedEnd: '끝에 “{want}”가 빠졌어요.',
  err_assignEq: '같은지 비교할 때는 ==를 써요 (= 하나는 안 돼요).',
  err_singleAmp: '{op}로 쓰세요.',
  err_wordOp: '“{word}” 대신 {op}를 쓰세요.',
  err_implicitMul: '곱셈은 {num}*{name}처럼 *를 써요.',
  err_chainedCmp: '비교는 이어 쓸 수 없어요. a < b && b < c처럼 쓰세요.',
  err_unknownFn: '없는 함수예요: “{name}”. 쓸 수 있는 함수: abs, min, max.',
  err_arity: '{fn}에는 값이 {n}개 들어가요.',
  err_unknownVar: '없는 변수예요: “{name}”. 쓸 수 있는 변수: {vars}.',
  err_localVar: '“{name}”: 반복 한 번 안에서만 있는 변수예요. 반복 시작의 변수를 쓰세요: {vars}.',
  err_wantInt: '여기에는 조건이 아니라 수가 와야 해요.',
  err_wantBool: '여기에는 수가 아니라 조건(예: x > 0)이 와야 해요.',
  err_tupleHere: '튜플 (a, b)는 남은 걸음 답 전체로만 쓸 수 있어요.',
  err_tupleLocked: '튜플 (a, b)는 레벨 10부터 쓸 수 있어요.',
  err_rankIsCond: '남은 걸음은 조건이 아니라 수(예: n - i)여야 해요.',
  err_condIsNum: '여기에는 수가 아니라 조건(예: i <= n)이 와야 해요.',
  err_missingOp: '연산자가 빠졌어요: “{tok}” 앞',
  err_bareTuple: '튜플은 괄호로 감싸세요: (a, b).',
};

export type Key = { [K in keyof Strings]: Strings[K] extends string ? K : never }[keyof Strings];

const TABLE: Record<Lang, Strings> = { en, ko };

let current: Lang = 'en';

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
}

export function lang(): Lang {
  return current;
}

/** {name} inserts a parameter; {k:step:steps} also adds an English singular/plural word. */
export function t(key: Key, params: Record<string, string | number> = {}): string {
  const s = TABLE[current][key] as string;
  return s.replace(/\{(\w+)(?::([^:}]*):([^}]*))?\}/g, (whole, k: string, one?: string, many?: string) => {
    if (!(k in params)) return whole;
    const v = String(params[k]);
    return one === undefined ? v : `${v} ${v === '1' ? one : many}`;
  });
}

export function strings(): Strings {
  return TABLE[current];
}

export function hasKey(key: string): key is Key {
  return key in en && typeof (en as Record<string, unknown>)[key] === 'string';
}

export function defaultLang(): Lang {
  const l = typeof navigator !== 'undefined' ? navigator.language : '';
  return l && l.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
