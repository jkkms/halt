// Keep Z3's reference counts safe while a check runs.
//
// z3-solver frees Z3 objects from JavaScript finalizers on the main thread, but solver.check()
// runs on a worker thread and Z3's reference counts are not thread-safe: a finalizer that fires
// in the middle of a check can corrupt Z3's memory, and the check then never returns. Safari's
// garbage collector makes this likely. So while a check runs, dec_ref calls wait in a queue.
// (Same idea as Invariant Frog's z3-guard.ts.)

let solving = 0;
const queued: (() => void)[] = [];

/** Wrap every *dec_ref function of the low-level API so it waits while a check runs. */
export function guardDecRefs(Z3: object): void {
  const api = Z3 as Record<string, unknown>;
  for (const key of Object.keys(api)) {
    if (key !== 'dec_ref' && !key.endsWith('_dec_ref')) continue;
    const original = api[key] as (...args: unknown[]) => void;
    api[key] = (...args: unknown[]) => {
      if (solving) queued.push(() => original(...args));
      else original(...args);
    };
  }
}

/** Run a check with dec_ref calls held back until no check is running. */
export async function whileSolving<T>(run: () => Promise<T>): Promise<T> {
  solving++;
  try {
    return await run();
  } finally {
    if (--solving === 0) for (const f of queued.splice(0)) f();
  }
}
