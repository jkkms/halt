// The tutorial's still text box (SPEC_v0.6 §A as changed by the author): one fixed slot at the upper left, the same
// rect on every page whatever the card, the code card or the caption; never over the code card, the step counter,
// the controls or the card; the card under it when there is room, else above the controls; the scene framed in
// what is left.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { boxWidth, deskLayout, maxBoxHeight, overlap, phoneInset, ringBox, SLOT, textBox, within, type Box, type DeskInput } from '../src/ui/tutLayout.ts';

const sizes = [
  { w: 1440, h: 844 },
  { w: 1280, h: 744 },
  { w: 1024, h: 700 },
  { w: 800, h: 560 },
];
const pillAt = (st: { w: number; h: number }): Box => ({ x: st.w / 2 - 190, y: st.h - 16 - 54, w: 380, h: 54 });
const codeAt = (st: { w: number; h: number }, lines: number): Box => {
  const w = Math.min(330, st.w * 0.42);
  return { x: st.w - 12 - w, y: 12, w, h: 30 + 20 * lines };
};
const HUD: Box = { x: 12, y: 12, w: 220, h: 28 };
const inStage = (b: Box, st: { w: number; h: number }) => within({ x: 0, y: 0, ...st }, b);
const scene = (st: { w: number; h: number }, i: { top: number; right: number; bottom: number; left: number }): Box => ({ x: i.left, y: i.top, w: st.w - i.left - i.right, h: st.h - i.top - i.bottom });

describe('the text box', () => {
  it('is 380–440 px wide', () => {
    assert.equal(boxWidth(1440), 432);
    assert.equal(boxWidth(1280), 384);
    assert.equal(boxWidth(900), 380);
    assert.equal(boxWidth(3000), 440);
  });

  it('has one rect per stage size, whatever the page shows', () => {
    for (const st of sizes) {
      const box = textBox(st, 300);
      assert.deepEqual(box, { x: SLOT.margin, y: SLOT.top, w: boxWidth(st.w), h: 300 });
      // the layout of a page never moves it: it takes the box as given
      for (const card of [null, { h: 120, hWide: 100 }, { h: 260, hWide: 220 }])
        for (const lines of [3, 8]) {
          const L = deskLayout({ stage: st, box, code: codeAt(st, lines), pill: pillAt(st), card, shots: null, caption: null });
          assert.ok(L.inset.left >= box.x + box.w, 'the scene starts right of the box');
        }
    }
  });

  it('never covers the step counter, the code card or the controls, and stays inside the stage', () => {
    for (const st of sizes) {
      const pill = pillAt(st);
      const box = textBox(st, Math.min(360, maxBoxHeight(st.h, pill)));
      assert.ok(inStage(box, st));
      assert.equal(overlap(box, HUD), 0);
      assert.equal(overlap(box, pill), 0);
      for (const lines of [3, 4, 8]) assert.equal(overlap(box, codeAt(st, lines)), 0, `${st.w}: code card of ${lines} lines`);
    }
  });

  it('leaves room under it above the controls for the shot buttons', () => {
    for (const st of sizes) {
      const pill = pillAt(st);
      const box = textBox(st, maxBoxHeight(st.h, pill));
      assert.ok(box.y + box.h + SLOT.gap + 30 <= pill.y, `${st.w}×${st.h}`);
    }
  });
});

describe('the card and the scene', () => {
  const at = (st: { w: number; h: number }, card: DeskInput['card'], extra: Partial<DeskInput> = {}) => {
    const pill = pillAt(st);
    const box = textBox(st, 320);
    const input: DeskInput = { stage: st, box, code: codeAt(st, 3), pill, card, shots: null, caption: null, ...extra };
    return { input, out: deskLayout(input) };
  };

  it('puts the card under the text box when it fits (down past the controls, which are not under it), else just above the controls', () => {
    const st = sizes[1]!;
    const fits = at(st, { h: 200, hWide: 160 });
    assert.ok(fits.out.cardInColumn);
    assert.deepEqual(fits.out.card, { x: 12, y: 52 + 320 + 12, w: fits.input.box.w, h: 200 });
    const tall = at(st, { h: 400, hWide: 300 });
    assert.equal(tall.out.cardInColumn, false);
    const c = tall.out.card!;
    assert.equal(c.y + c.h, tall.input.pill.y - SLOT.gap, 'just above the controls');
    assert.ok(c.x >= tall.input.box.x + tall.input.box.w + SLOT.gap, 'right of the text box');
    const wide = at(sizes[0]!, { h: 520, hWide: 380 });
    const cw = wide.out.card!;
    assert.equal(wide.out.cardInColumn, false);
    assert.ok(cw.x >= wide.input.box.x + wide.input.box.w + SLOT.gap, 'right of the text box');
    assert.ok(cw.x + cw.w <= sizes[0]!.w - SLOT.margin);
  });

  it('the card never covers the text box, the controls or the code card; the scene keeps clear of all of them', () => {
    for (const st of sizes)
      for (const h of st.h >= 700 ? [0, 90, 200, 300, 420] : [0, 90, 200, 300]) {
        const shots: Box = { x: 12, y: st.h - 16 - 10 - 30, w: 200, h: 30 };
        const caption: Box = { x: st.w - 12 - 300, y: st.h - 16 - 44, w: 300, h: 44 };
        const { input, out } = at(st, h ? { h, hWide: Math.round(h * 0.8) } : null, { shots, caption });
        const sc = scene(st, out.inset);
        assert.ok(sc.w > 200 && sc.h > 80, `${st.w}×${st.h} card ${h}: scene ${JSON.stringify(sc)}`);
        for (const b of [input.box, input.pill, input.code!, shots, caption]) assert.equal(overlap(sc, b), 0, `${st.w}×${st.h} card ${h}: scene over ${JSON.stringify(b)}`);
        if (out.card) {
          for (const b of [input.box, input.pill, input.code!]) assert.equal(overlap(out.card, b), 0, `${st.w}×${st.h} card ${h}`);
          assert.equal(overlap(sc, out.card), 0, 'the scene keeps clear of the card');
          if (out.cardInColumn) assert.equal(overlap(out.card, shots), 0, 'the card stays above the shot buttons');
        }
      }
  });

  it('without a code card the scene may use the top', () => {
    const st = sizes[0]!;
    const { out } = at(st, null, { code: null });
    assert.equal(out.inset.top, SLOT.margin);
  });
});

describe('phones and rings', () => {
  it('phone insets keep the scene below the top row and above the controls and the caption', () => {
    const st = { w: 390, h: 440 };
    const i = phoneInset(st, [{ x: 8, y: 8, w: 120, h: 26 }, { x: 250, y: 8, w: 132, h: 30 }, null], [{ x: 20, y: 380, w: 350, h: 50 }, { x: 8, y: 330, w: 374, h: 42 }]);
    assert.deepEqual(i, { top: 44, right: 8, bottom: 116, left: 8 });
    assert.deepEqual(phoneInset(st, [], []), { top: 8, right: 8, bottom: 8, left: 8 });
  });

  it('a ring sits a little outside its target and contains its centre', () => {
    const t: Box = { x: 100, y: 50, w: 40, h: 90 };
    const r = ringBox(t);
    assert.deepEqual(r, { x: 94, y: 44, w: 52, h: 102 });
    assert.ok(within(r, t));
  });
});
