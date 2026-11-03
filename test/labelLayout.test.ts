// The stage's label layout pass (SPEC_v0.6 §B): priority, the smallest move up or down, hiding when nothing
// clears, the walker (stair badges excepted), boxes to keep out of, and no flicker.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hits, layoutLabels, SPARE, type LabelIn, type Rect } from '../src/ui/labelLayout.ts';

const L = (x: number, y: number, w: number, h: number, priority: number, more: Partial<LabelIn> = {}): LabelIn => ({ rect: { x, y, w, h }, priority, dy: 0, hidden: false, ...more });
const drawn = (out: ReturnType<typeof layoutLabels>) => out.filter((o) => !o.hidden).map((o) => o.rect!);

describe('label layout pass', () => {
  it('leaves labels that do not overlap where they are', () => {
    const out = layoutLabels([L(0, 0, 50, 20, 1), L(100, 0, 50, 20, 2)], [], null);
    assert.deepEqual(
      out.map((o) => [o.dy, o.hidden]),
      [
        [0, false],
        [0, false],
      ],
    );
  });

  it('the lower-priority label moves by the smallest offset that clears, up or down', () => {
    // the mark (1) wins; the badge (2) sits 6 px lower, so moving down is the smaller move
    const out = layoutLabels([L(0, 6, 60, 20, 2), L(10, 0, 60, 20, 1)], [], null);
    assert.equal(out[1]!.dy, 0);
    assert.equal(out[0]!.dy, 20 - 6 + SPARE + 1);
    assert.ok(!hits(out[0]!.rect!, out[1]!.rect!));
    // 6 px higher instead: it moves up
    const up = layoutLabels([L(0, -6, 60, 20, 2), L(10, 0, 60, 20, 1)], [], null);
    assert.ok(up[0]!.dy < 0 && !hits(up[0]!.rect!, up[1]!.rect!));
  });

  it('a label that cannot clear within its own height hides', () => {
    // a tall blocker right on top of it
    const out = layoutLabels([L(0, 50, 60, 20, 5)], [{ x: 0, y: 0, w: 100, h: 120 }], null);
    assert.equal(out[0]!.hidden, true);
    assert.equal(out[0]!.rect, null);
  });

  it('keeps off the walker, except stair badges', () => {
    const walker: Rect = { x: 0, y: 0, w: 40, h: 100 };
    const out = layoutLabels([L(0, 40, 60, 16, 3), L(0, 40, 60, 16, 2, { overWalker: true })], [], walker);
    assert.equal(out[0]!.hidden, true, 'the door sign cannot clear a walker 100 px tall: it hides');
    assert.equal(out[1]!.hidden, false);
    assert.equal(out[1]!.dy, 0, 'the badge stays on its stair');
    const near = layoutLabels([L(0, 95, 60, 16, 4)], [], walker);
    assert.ok(!near[0]!.hidden && !hits(near[0]!.rect!, walker), 'just under the feet: moves down');
  });

  it('boxes to keep out of (the loop-check bubble, the tutorial text box) come first', () => {
    const check: Rect = { x: 0, y: 0, w: 120, h: 30 };
    const out = layoutLabels([L(10, 20, 50, 18, 1), L(200, 0, 50, 18, 1)], [check], null);
    assert.ok(!hits(out[0]!.rect!, check));
    assert.equal(out[1]!.dy, 0);
  });

  it('no two drawn labels overlap, whatever the pile', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let round = 0; round < 200; round++) {
      const labels = Array.from({ length: 12 }, () => L(rnd() * 300, rnd() * 200, 30 + rnd() * 60, 14 + rnd() * 10, 1 + Math.floor(rnd() * 6), { overWalker: rnd() < 0.3 }));
      const walker: Rect = { x: rnd() * 300, y: rnd() * 150, w: 40, h: 90 };
      const out = layoutLabels(labels, [], walker);
      const r = drawn(out);
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert.ok(!hits(r[i]!, r[j]!), `round ${round}`);
      out.forEach((o, i) => {
        if (!o.hidden) {
          assert.ok(Math.abs(o.dy) <= labels[i]!.rect.h + 0.5, 'moves at most its own height');
          if (!labels[i]!.overWalker) assert.ok(!hits(o.rect!, walker), 'off the walker');
        }
      });
    }
  });

  it('does not flicker: a moved label stays put while its old place is only just clear', () => {
    const blocker: Rect = { x: 0, y: 0, w: 100, h: 20 };
    // last frame it had moved down by 3; now its own place is clear by 1 px only: it stays moved
    const a = layoutLabels([L(0, 21, 60, 16, 5, { dy: 3 })], [blocker], null);
    assert.equal(a[0]!.dy, 3);
    // with the spare room it moves back
    const b = layoutLabels([L(0, 20 + SPARE + 2, 60, 16, 5, { dy: 3 })], [blocker], null);
    assert.equal(b[0]!.dy, 0);
    // a hidden label comes back only with the spare room
    const c = layoutLabels([L(0, 21, 60, 16, 5, { hidden: true })], [blocker], null);
    assert.notEqual(c[0]!.dy, 0, 'not at its place with 1 px to spare');
  });
});
