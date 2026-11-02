// Z3 in Node for the tests (the browser loads it differently, see src/z3/browser.ts).
import { init, killThreads } from 'z3-solver';
import { Judge } from '../src/core/judge.ts';

export async function nodeJudge() {
  const api = await init();
  const ctx = api.Context('main');
  return {
    ctx,
    judge: new Judge(ctx),
    close: () => killThreads(api.em),
  };
}
