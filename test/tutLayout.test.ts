// The tutorial's layout (SPEC_v0.7 §A as changed by the author): a wide band along the bottom of the stage whose top
// edge, left and width stay put; its text column of a comfortable width and the piece beside it; the scene framed
// above the tallest band, centred, clear of the step counter, the code card and the shot strip, in the frame where
// it comes out largest; one ring per piece (§C).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fitDistance, frameScale, pickFrame, type Bounds } from '../src/ui/frame.ts';
import { BAND, bandBox, bandColumns, clip, linePieces, overlap, phoneInset, pieceWidth, ringBox, sceneFrames, topStrip, within, type Box, type Insets } from '../src/ui/tutLayout.ts';

const sizes = [
  { w: 1440, h: 844 }, // 1440 × 900
  { w: 1280, h: 744 }, // 1280 × 800
  { w: 1024, h: 700 },
  { w: 800, h: 560 },
];
const codeAt = (st: { w: number }, lines: number): Box => {
  const w = Math.min(330, st.w * 0.42);
  return { x: st.w - 12 - w, y: 12, w, h: 30 + 20 * lines };
};
const HUD: Box = { x: 12, y: 12, w: 280, h: 30 };
const rectOf = (st: { w: number; h: number }, i: Insets): Box => ({ x: i.left, y: i.top, w: st.w - i.left - i.right, h: st.h - i.top - i.bottom });

describe('the band', () => {
  it('spans the stage less a 16 px margin on each side, at the bottom', () => {
    for (const st of sizes) {
      const b = bandBox(st, 260);
      assert.deepEqual(b, { x: 16, y: st.h - 16 - 260, w: st.w - 32, h: 260 });
      assert.ok(within({ x: 0, y: 0, ...st }, b));
    }
  });

  it('a text column of at most 800 px, the piece beside it at the right; no room: the piece goes under the text', () => {
    const wide = bandColumns(1408);
    assert.deepEqual(wide.text, { x: BAND.padX, w: 800 });
    assert.deepEqual(wide.piece, { x: 1408 - BAND.padX - 440, w: 440 });
    const mid = bandColumns(1248);
    assert.ok(mid.piece && mid.text.w + BAND.gap + mid.piece.w <= 1248 - 2 * BAND.padX, JSON.stringify(mid));
    assert.ok(mid.text.w >= BAND.textMin && mid.text.w <= BAND.textMax);
    for (const w of [1408, 1248, 992, 768, 729, 600]) {
      const c = bandColumns(w);
      // the text and the piece never overlap and stay inside the band's padding
      if (c.piece) {
        assert.ok(c.text.x + c.text.w + BAND.gap <= c.piece.x + 0.5, `${w}`);
        assert.ok(c.piece.x + c.piece.w <= w - BAND.padX + 0.5, `${w}`);
      } else {
        assert.ok(c.text.x + c.text.w <= w - BAND.padX + 0.5, `${w}`);
        assert.ok(pieceWidth(c, w) <= w);
      }
    }
    assert.equal(bandColumns(729).piece, null, 'a narrow stage has no room beside the text');
  });

  it('the shot strip sits along the top edge between the side cards, centred', () => {
    const s = topStrip({ w: 1440 }, 354);
    assert.deepEqual(s, { x: 354, w: 1440 - 2 * 354 });
    // a very narrow stage still gives it some room
    assert.ok(topStrip({ w: 500 }, 354).w >= 120);
  });
});

describe('the scene’s frames', () => {
  it('every frame is centred, above the band, inside the stage and clear of the step counter, the code card and the strip', () => {
    for (const st of sizes)
      for (const lines of [3, 4, 8])
        for (const bandH of [140, 260, 340]) {
          const band = bandBox(st, bandH);
          const code = codeAt(st, lines);
          const strip: Box = { x: st.w / 2 - 150, y: 12, w: 300, h: 34 };
          const frames = sceneFrames(st, band.y, [HUD, code, strip]);
          // there is always a frame when the room under all the top cards is tall enough for one
          const under = Math.max(...[HUD, code, strip].map((o) => o.y + o.h)) + BAND.frameGap;
          if (band.y - BAND.frameGap - under >= BAND.minFrame.h) assert.ok(frames.length > 0, `${st.w}×${st.h} code ${lines} band ${bandH}`);
          for (const f of frames) {
            const r = rectOf(st, f);
            assert.equal(f.left, f.right, 'centred');
            assert.ok(r.y + r.h <= band.y - BAND.frameGap + 0.5, 'above the band');
            assert.ok(within({ x: 0, y: 0, ...st }, r));
            for (const o of [HUD, code, strip]) assert.equal(overlap(r, o), 0, `${st.w}: frame ${JSON.stringify(f)} over ${JSON.stringify(o)}`);
            assert.ok(r.w >= BAND.minFrame.w && r.h >= BAND.minFrame.h);
          }
        }
  });

  it('offers both shapes: a tall column between the side cards and the full width under them', () => {
    const st = sizes[0]!;
    const band = bandBox(st, 300);
    const code = codeAt(st, 3);
    const frames = sceneFrames(st, band.y, [HUD, code]);
    const tall = frames.find((f) => f.top === BAND.frameGap);
    const wide = frames.find((f) => f.left === BAND.frameGap);
    assert.ok(tall && tall.left >= code.w, JSON.stringify(frames));
    assert.ok(wide && wide.top >= code.y + code.h, JSON.stringify(frames));
    // none lies inside another
    for (const a of frames) for (const b of frames) if (a !== b) assert.ok(!within(rectOf(st, a), rectOf(st, b)));
  });

  it('the stage takes the frame where the scene comes out largest', () => {
    const opts = { ring: false, all: true };
    const stairs: Bounds = { x0: -1.6, x1: 4.5, y0: -0.5, y1: 3.2 }; // the countdown from n = 3
    const long: Bounds = { x0: -1.6, x1: 13, y0: -0.5, y1: 3 }; // a long, low run
    const st = { w: 1440, h: 844 };
    const column: Insets = { top: 12, right: 354, bottom: 330, left: 354 };
    const under: Insets = { top: 200, right: 12, bottom: 330, left: 12 };
    assert.deepEqual(pickFrame([under, column], st, stairs, opts), column, 'a compact scene: the taller column');
    assert.deepEqual(pickFrame([column, under], st, long, opts), under, 'a long scene: the full width');
    assert.equal(pickFrame([], st, stairs, opts), undefined);
    // the scale is what the camera really gives: more room, larger
    assert.ok(frameScale(700, 500, stairs, opts) > frameScale(700, 300, stairs, opts));
  });

  it('the camera fit is unchanged from v0.6 (the distance a scene needs, the cap, following a long run)', () => {
    const b: Bounds = { x0: -1.6, x1: 4.5, y0: -0.5, y1: 3.2 };
    const tanV = Math.tan((15 * Math.PI) / 180);
    const need = Math.max(3.7 / 2 / tanV, 6.1 / 2 / (tanV * 1.6), 8.5) * 1.12 + 1.6;
    const fit = fitDistance(b, 1.6, { ring: false, all: false });
    assert.equal(fit.follow, false);
    assert.ok(Math.abs(fit.dist - need) < 1e-9);
    const huge: Bounds = { x0: -2, x1: 40, y0: -20, y1: 2 };
    assert.equal(fitDistance(huge, 1.6, { ring: false, all: false }).follow, true);
    assert.equal(fitDistance(huge, 1.6, { ring: false, all: true }).follow, false);
    assert.equal(fitDistance(huge, 1.6, { ring: true, all: false }).dist, 28);
  });
});

describe('phones and rings', () => {
  it('phone insets keep the scene below the top row and above the caption', () => {
    const st = { w: 390, h: 400 };
    const i = phoneInset(st, [{ x: 8, y: 8, w: 120, h: 26 }, { x: 250, y: 8, w: 132, h: 30 }, null], [{ x: 8, y: 350, w: 374, h: 42 }]);
    assert.deepEqual(i, { top: 44, right: 8, bottom: 56, left: 8 });
    assert.deepEqual(phoneInset(st, [], []), { top: 8, right: 8, bottom: 8, left: 8 });
  });

  it('a ring sits a little outside its piece: it contains it and is no more than 12 px larger each way', () => {
    const t: Box = { x: 100, y: 50, w: 40, h: 90 };
    const r = ringBox(t);
    assert.deepEqual(r, { x: 94, y: 44, w: 52, h: 102 });
    assert.ok(within(r, t));
    assert.ok(r.w * r.h <= (t.w + 12) * (t.h + 12));
  });

  it('lit code lines: lines next to each other are one piece, lines apart are a piece each', () => {
    const line = (y: number): Box => ({ x: 10, y, w: 200, h: 19 });
    assert.deepEqual(linePieces([line(40), line(21)]), [{ x: 10, y: 21, w: 200, h: 38 }]);
    assert.deepEqual(linePieces([line(2), line(60)]), [line(2), line(60)]);
    assert.deepEqual(linePieces([]), []);
  });

  it('clip keeps what is inside the area', () => {
    const area: Box = { x: 0, y: 0, w: 400, h: 300 };
    assert.deepEqual(clip({ x: 380, y: 280, w: 40, h: 40 }, area), { x: 380, y: 280, w: 20, h: 20 });
    assert.equal(clip({ x: 0, y: 310, w: 40, h: 40 }, area), null);
  });
});
