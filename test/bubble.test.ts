// The tutorial's speech bubble (SPEC_v0.5 §B): placement beside the walker, clamping to the stage, keeping off the
// code card and the controls, leaving the stage's labels visible (body and tail) when there is room, no flicker
// between spots, the fixed spot when the walker is unknown, the tail and its outline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUBBLE, bubblePath, overlap, placeBubble, tailFor, type Box, type PlaceInput, type Placement, type Pt, type SoftBox, type WalkerSpot } from '../src/ui/bubble.ts';

const DESK = { w: 1440, h: 844 };
const PHONE = { w: 390, h: 591 };
// the desktop tutorial at 1440 × 900: the code card top right, the controls pill and the card above it bottom centre
const CODE: Box = { x: 1086, y: 12, w: 330, h: 101 };
const PILL: Box = { x: 575, y: 774, w: 290, h: 54 };
const CARD: Box = { x: 470, y: 520, w: 500, h: 244 };

const at = (x: number, y: number, tall = 100): WalkerSpot => ({ head: { x, y }, feet: { x, y: y + tall } });
const inStage = (b: Box, s: { w: number; h: number }) => b.x >= BUBBLE.margin - 0.01 && b.y >= BUBBLE.margin - 0.01 && b.x + b.w <= s.w - BUBBLE.margin + 0.01 && b.y + b.h <= s.h - BUBBLE.margin + 0.01;
const contains = (b: Box, p: Pt) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Does the tail (from where it leaves the bubble to its tip) pass over the box? */
const tailCrosses = (p: Placement, o: Box) => {
  const t = tailFor(p.box, p.tip, p.side);
  if (!t) return false;
  const flat = t.edge === 'top' || t.edge === 'bottom';
  const base = flat ? { x: p.box.x + t.at, y: p.box.y + (t.edge === 'bottom' ? p.box.h : 0) } : { x: p.box.x + (t.edge === 'right' ? p.box.w : 0), y: p.box.y + t.at };
  for (let i = 0; i <= 40; i++) {
    const x = base.x + ((p.tip.x - base.x) * i) / 40;
    const y = base.y + ((p.tip.y - base.y) * i) / 40;
    if (contains(o, { x, y })) return true;
  }
  return false;
};

describe('speech bubble placement', () => {
  const base: PlaceInput = { stage: DESK, walker: at(700, 380), size: { w: 380, h: 130 }, avoid: [CODE, PILL] };

  it('with room, sits beside the head on the right, the tail tip close to the head', () => {
    const p = placeBubble(base);
    assert.equal(p.fallback, false);
    assert.equal(p.side, 'right');
    assert.ok(p.box.x > 700, 'right of the head');
    assert.ok(inStage(p.box, DESK));
    assert.ok(!contains(p.box, { x: 700, y: 380 }), 'does not cover the head');
    assert.ok(dist(p.tip, { x: 700, y: 380 }) <= 40, `tip ${JSON.stringify(p.tip)}`);
    const tail = tailFor(p.box, p.tip, p.side);
    assert.ok(tail);
    assert.equal(tail.edge, 'left');
  });

  it('keeps the side it is on unless the other side is clearly better', () => {
    assert.equal(placeBubble({ ...base, side: 'left' }).side, 'left');
    assert.equal(placeBubble({ ...base, side: 'right' }).side, 'right');
  });

  it('flips to the other side near an edge of the stage', () => {
    const right = placeBubble({ ...base, walker: at(1360, 420), side: 'right' });
    assert.equal(right.side, 'left');
    assert.ok(inStage(right.box, DESK));
    assert.ok(!contains(right.box, { x: 1360, y: 420 }));
    const left = placeBubble({ ...base, walker: at(60, 420), side: 'left' });
    assert.equal(left.side, 'right');
    assert.ok(inStage(left.box, DESK));
  });

  it('never covers the code card, the controls or the interactive card, and stays inside the stage', () => {
    const avoid = [CODE, PILL, CARD];
    let n = 0;
    for (const size of [
      { w: 380, h: 130 },
      { w: 380, h: 210 },
      { w: 220, h: 56 },
    ])
      for (let x = 20; x <= 1420; x += 40)
        for (let y = 60; y <= 800; y += 40)
          for (const side of ['left', 'right'] as const) {
            const p = placeBubble({ stage: DESK, walker: at(x, y), size, avoid, side });
            n++;
            for (const a of avoid) assert.equal(overlap(p.box, a), 0, `head (${x}, ${y}) size ${size.w}×${size.h}: covers ${JSON.stringify(a)} with ${JSON.stringify(p.box)}`);
            assert.ok(inStage(p.box, DESK), `head (${x}, ${y}): ${JSON.stringify(p.box)}`);
          }
    assert.ok(n > 2000);
  });

  it('moves away from the code card when the walker stands right under it', () => {
    const p = placeBubble({ ...base, walker: at(1200, 190, 90), side: 'right' });
    assert.equal(overlap(p.box, CODE), 0);
    assert.ok(dist(p.tip, { x: 1200, y: 190 }) <= 40);
  });

  it('would rather not cover the stage labels (soft), but may', () => {
    const label: Box = { x: 760, y: 280, w: 380, h: 120 };
    const free = placeBubble({ ...base, soft: [] });
    assert.ok(overlap(free.box, label) > 0, 'right beside the head covers the label');
    const shy = placeBubble({ ...base, soft: [label] });
    assert.equal(overlap(shy.box, label), 0, 'with the label marked, it goes elsewhere');
  });

  // Desktop tutorial page 2 as the stage reported it (1440 × 844 stage): the walker at the exit door, his callout
  // "the walker = the running program" right over his head, the other callouts, the step badges and the ruler.
  const PAGE2: SoftBox[] = [
    { x: 12, y: 12, w: 99, h: 23, kind: 'ui' },
    { x: 992, y: 328, w: 77, h: 18, kind: 'text' },
    { x: 922, y: 430, w: 178, h: 26, kind: 'text' },
    { x: 568, y: 212, w: 136, h: 26, kind: 'text' },
    { x: 961, y: 244, w: 156, h: 26, kind: 'text' },
    { x: 519, y: 330, w: 35, h: 36, kind: 'number' },
    { x: 666, y: 435, w: 35, h: 36, kind: 'number' },
    { x: 814, y: 541, w: 35, h: 36, kind: 'number' },
    { x: 355, y: 574, w: 36, h: 13, kind: 'number' },
  ];
  const door: WalkerSpot = { head: { x: 1017.8, y: 514.3 }, feet: { x: 998.1, y: 635.7 } };
  const page2 = (walker: WalkerSpot, side: 'left' | 'right', slot?: string): PlaceInput => ({ stage: DESK, walker, size: { w: 380, h: 102 }, avoid: [CODE, PILL], soft: PAGE2, side, slot });
  const words = PAGE2.filter((o) => o.kind === 'text');

  it('leaves the stage’s words visible when there is room: neither the bubble nor its tail covers them', () => {
    for (const side of ['left', 'right'] as const)
      for (const slot of [undefined, `${side}:high:x36`, `${side}:beside:`]) {
        const p = placeBubble(page2(door, side, slot));
        const what = `${side} ${slot}: ${JSON.stringify(p.box)}`;
        for (const w of words) {
          assert.equal(overlap(p.box, w), 0, `covers ${JSON.stringify(w)} (${what})`);
          assert.ok(!tailCrosses(p, w), `tail crosses ${JSON.stringify(w)} (${what})`);
        }
        assert.ok(dist(p.tip, door.head) <= 40, what);
      }
  });

  it('a callout that rides over the walker’s head: kept clear all along a walk', () => {
    for (let x = 300; x <= 1100; x += 25)
      for (let y = 260; y <= 560; y += 30) {
        const walker = at(x, y, 110);
        const callout: SoftBox = { x: x - 85, y: y - 75, w: 170, h: 26, kind: 'text' };
        const p = placeBubble({ stage: DESK, walker, size: { w: 380, h: 102 }, avoid: [CODE, PILL], soft: [callout] });
        assert.equal(overlap(p.box, callout), 0, `(${x}, ${y}) ${JSON.stringify(p.box)}`);
        assert.ok(!tailCrosses(p, callout), `(${x}, ${y}) tail`);
      }
  });

  it('its tail keeps off the stage’s loop check over the head, as wide as the stage showed it', () => {
    // desktop tutorial page 4 (EN): the walker at the door, the check "0 > 0 × false → loop ends, to the exit" over him
    const card: Box = { x: 470, y: 664, w: 500, h: 100 };
    for (const side of ['left', 'right'] as const) {
      const walker: WalkerSpot = { head: { x: 1010, y: 459 }, feet: { x: 1000, y: 580 } };
      const check = { w: 262, h: 30 };
      const p = placeBubble({ stage: DESK, walker, size: { w: 380, h: 153 }, avoid: [CODE, PILL, card], soft: [{ x: 972, y: 270, w: 112, h: 18, kind: 'text' }], side, check });
      const tall = 121;
      const box: Box = { x: 1010 - check.w / 2, y: 459 - tall * 0.34 + 4 - check.h, w: check.w, h: check.h };
      assert.ok(!tailCrosses(p, box), `${side}: ${JSON.stringify(p.box)}`);
      assert.equal(overlap(p.box, box), 0, side);
      assert.ok(dist(p.tip, walker.head) <= 40);
    }
  });

  it('near the right edge, clamping does not slide the bubble onto the walker', () => {
    for (const x of [1300, 1350, 1400, 1420]) {
      const walker: WalkerSpot = { head: { x, y: 514 }, feet: { x: x - 20, y: 636 } };
      for (const side of ['left', 'right'] as const) {
        const p = placeBubble({ ...page2(walker, side), soft: [] });
        const core: Box = { x: x - 20 - 19, y: 514 - 14, w: 20 + 38, h: 122 + 14 };
        assert.equal(overlap(p.box, core), 0, `${x} ${side}: ${JSON.stringify(p.box)}`);
      }
    }
  });

  it('keeps its spot while the walker moves a little (no flicker between spots)', () => {
    let side: 'left' | 'right' | undefined;
    let slot: string | undefined;
    const seq: string[] = [];
    for (let k = 0; k <= 120; k++) {
      // two pixels right and one down per frame, past the labels of page 2
      const walker = at(560 + k * 2, 300 + k, 110);
      const p = placeBubble({ stage: DESK, walker, size: { w: 380, h: 102 }, avoid: [CODE, PILL], soft: PAGE2, side, slot });
      seq.push(p.slot);
      side = p.side;
      slot = p.slot;
    }
    const changes = seq.filter((x, i) => i > 0 && x !== seq[i - 1]).length;
    // a bounce: back to the spot it left within a few frames
    const bounces = seq.filter((x, i) => i >= 2 && x !== seq[i - 1] && seq.slice(Math.max(0, i - 8), i - 1).includes(x)).length;
    assert.equal(bounces, 0, seq.join(' '));
    assert.ok(changes <= 8, `${changes} changes: ${seq.join(' ')}`);
  });

  it('is clamped into the stage when the walker is near a corner', () => {
    for (const [x, y] of [
      [15, 15],
      [1430, 15],
      [15, 830],
      [1430, 830],
    ] as const) {
      const p = placeBubble({ ...base, walker: at(x, y, 60) });
      assert.ok(inStage(p.box, DESK), `(${x}, ${y}): ${JSON.stringify(p.box)}`);
    }
  });

  it('on a phone stage: over the stage, clear of the controls', () => {
    const pill: Box = { x: 30, y: 531, w: 330, h: 50 };
    for (let x = 40; x <= 350; x += 30)
      for (let y = 120; y <= 480; y += 30) {
        const p = placeBubble({ stage: PHONE, walker: at(x, y, 50), size: { w: 300, h: 190 }, avoid: [pill] });
        assert.equal(overlap(p.box, pill), 0, `(${x}, ${y})`);
        assert.ok(inStage(p.box, PHONE), `(${x}, ${y}): ${JSON.stringify(p.box)}`);
      }
  });

  it('with no walker: the fixed spot at the upper left, the tail pointing down-right', () => {
    const p = placeBubble({ ...base, walker: null });
    assert.equal(p.fallback, true);
    assert.deepEqual([p.box.x, p.box.y], [BUBBLE.margin, BUBBLE.margin]);
    const tail = tailFor(p.box, p.tip, p.side)!;
    assert.equal(tail.edge, 'bottom');
    assert.ok(tail.tip.x > tail.at && tail.tip.y > p.box.h, 'down and to the right');
  });

  it('with no walker and something at the upper left: just below it', () => {
    const hud: Box = { x: 12, y: 12, w: 200, h: 30 };
    const p = placeBubble({ ...base, walker: null, soft: [hud] });
    assert.equal(overlap(p.box, hud), 0);
    assert.ok(p.box.y < 80);
    const card: Box = { x: 0, y: 0, w: 500, h: 120 };
    const q = placeBubble({ ...base, walker: null, avoid: [card] });
    assert.equal(overlap(q.box, card), 0);
  });
});

describe('speech bubble tail and outline', () => {
  const box: Box = { x: 100, y: 100, w: 300, h: 120 };

  it('leaves from the edge facing the tip, kept clear of the rounded corners', () => {
    const lo = BUBBLE.radius + BUBBLE.half;
    const cases: [Pt, string][] = [
      [{ x: 60, y: 200 }, 'left'],
      [{ x: 440, y: 200 }, 'right'],
      [{ x: 250, y: 260 }, 'bottom'],
      [{ x: 250, y: 60 }, 'top'],
      [{ x: 395, y: 300 }, 'bottom'],
    ];
    for (const [tip, edge] of cases) {
      const t = tailFor(box, tip, 'right')!;
      assert.equal(t.edge, edge, JSON.stringify(tip));
      const len = edge === 'top' || edge === 'bottom' ? box.w : box.h;
      assert.ok(t.at >= lo && t.at <= len - lo, `${edge} at ${t.at}`);
      assert.deepEqual(t.tip, { x: tip.x - box.x, y: tip.y - box.y });
    }
  });

  it('has no tail when the tip is inside the bubble', () => {
    assert.equal(tailFor(box, { x: 200, y: 150 }, 'left'), null);
  });

  it('draws one closed outline through the tip', () => {
    for (const tip of [
      { x: 60, y: 200 },
      { x: 440, y: 200 },
      { x: 250, y: 260 },
      { x: 250, y: 60 },
    ]) {
      const t = tailFor(box, tip, 'left')!;
      const d = bubblePath(box.w, box.h, t);
      assert.match(d, /^M16 0 /);
      assert.match(d, / Z$/);
      assert.ok(d.includes(`L${tip.x - box.x} ${tip.y - box.y}`), d);
      assert.equal((d.match(/A/g) ?? []).length, 4, 'four rounded corners');
    }
    assert.ok(!bubblePath(300, 120, null).includes('NaN'));
  });
});
