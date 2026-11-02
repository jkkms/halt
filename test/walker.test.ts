// The walker's poses (src/ui/gait.ts) against the stairs: feet that should touch a tread reach it,
// no shoe sinks into a stair, and every beat starts and ends in the pose of the beat next to it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BODY, climb, exit, fall, guard, hipJoint, kneePole, legIK, stand, stepMs, stumble, walk, type Placed, type Pose, type Side } from '../src/ui/gait.ts';

const NOW = 1234;
const ctx = (parity: Side, reduced = false) => ({ parity, now: NOW, reduced });

/** The shoe's sole points (heel, ball, toe) in the pose frame after the leg IK. */
function soles(p: Pose): { side: Side; pts: [number, number][]; short: number; reach: number }[] {
  return ([0, 1] as const).map((side) => {
    const f = p.feet[side];
    const ik = legIK(hipJoint(p, side), f, kneePole(side));
    const c = Math.cos(f.pitch);
    const s = Math.sin(f.pitch);
    const rel: [number, number][] = [
      [-BODY.heel, -BODY.ankle],
      [BODY.ball, -BODY.ankle],
      [BODY.toe - 0.012, -BODY.ankle + 0.012],
    ];
    const pts = rel.map(([x, y]) => [ik.ankle.x + x * c - y * s, ik.ankle.y + x * s + y * c] as [number, number]);
    const j = hipJoint(p, side);
    return { side, pts, short: ik.short, reach: Math.hypot(j.x - ik.ankle.x, j.y - ik.ankle.y, j.z - ik.ankle.z) };
  });
}

/** Walk a beat in small steps and check the feet against two treads (the next one at dy past the edge). */
function checkBeat(name: string, beat: (u: number) => Placed, dy: number, len: number, floorBelow = -Infinity): void {
  const edge = len / 2;
  for (let i = 0; i <= 400; i++) {
    const u = i / 400;
    const { pose, x, y } = beat(u);
    for (const f of soles(pose)) {
      for (const [px, py] of f.pts) {
        const wx = px + x;
        const wy = py + y;
        const top = wx < edge ? 0 : Math.max(dy, floorBelow);
        assert.ok(wy > top - 0.012, `${name} u=${u.toFixed(3)}: foot ${f.side} sinks ${(top - wy).toFixed(3)} into the stair at x=${wx.toFixed(2)}`);
      }
      // a foot whose target is on a tread must get there
      const tgt = pose.feet[f.side];
      const sole = tgt.y + y - BODY.ankle;
      const wx = tgt.x + x;
      const top = wx < edge ? 0 : dy;
      if (Math.abs(sole - top) < 1e-4 && Math.abs(tgt.pitch) < 1e-6) assert.ok(f.short < 0.004, `${name} u=${u.toFixed(3)}: planted foot ${f.side} floats ${f.short.toFixed(3)}`);
      assert.ok(f.reach > 0.15, `${name} u=${u.toFixed(3)}: knee folded too far`);
    }
  }
}

function close(a: Pose, b: Pose, what: string): void {
  const near = (x: number, y: number, k: string) => assert.ok(Math.abs(x - y) < 1e-6, `${what}: ${k} ${x} vs ${y}`);
  near(a.hip.x, b.hip.x, 'hip.x');
  near(a.hip.y, b.hip.y, 'hip.y');
  near(a.hip.z, b.hip.z, 'hip.z');
  for (const s of [0, 1] as const) {
    near(a.feet[s].x, b.feet[s].x, `foot ${s} x`);
    near(a.feet[s].y, b.feet[s].y, `foot ${s} y`);
    near(a.feet[s].pitch, b.feet[s].pitch, `foot ${s} pitch`);
    near(a.arms[s].swing, b.arms[s].swing, `arm ${s} swing`);
    near(a.arms[s].out, b.arms[s].out, `arm ${s} out`);
  }
  near(a.lean, b.lean, 'lean');
  near(a.yaw, b.yaw, 'yaw');
  near(a.head.pitch, b.head.pitch, 'head pitch');
  near(a.head.yaw, b.head.yaw, 'head yaw');
}

const DROPS = [0, -0.04, -0.12, -0.2, -0.3, -0.42, -0.62, -1, -1.65, -2.5];

describe('walker poses', () => {
  for (const reduced of [false, true]) {
    for (const parity of [0, 1] as const) {
      const c = ctx(parity, reduced);
      const tag = `${reduced ? 'reduced ' : ''}parity ${parity}`;
      it(`steps down: feet on the treads, none sinks (${tag})`, () => {
        for (const dy of DROPS) checkBeat(`walk dy=${dy}`, (u) => walk(u, { ...c, dy, len: 1, dur: stepMs(dy) }), dy, 1);
        checkBeat('shaft step', (u) => walk(u, { ...c, dy: -0.42, len: 1, dur: stepMs(-0.42, 420) }), -0.42, 1);
        for (const len of [0.87, 0.93, 1.5, 2.12]) checkBeat(`level walk ${len}`, (u) => walk(u, { ...c, dy: 0, len }), 0, len);
      });
      it(`steps up and flat steps (${tag})`, () => {
        for (const dy of [0.04, 0.12]) checkBeat(`small step up dy=${dy}`, (u) => walk(u, { ...c, dy, len: 1, dur: 800 }), dy, 1);
        for (const dy of [0.13, 0.25, 0.62, 1.2, 2.3]) checkBeat(`climb dy=${dy}`, (u) => climb(u, { ...c, dy, len: 1 }), dy, 1);
        checkBeat('stumble', (u) => stumble(u, { ...c, dy: 0, len: 1 }), 0, 1);
      });
      it(`falls through the floor onto the stair below (${tag})`, () => {
        for (const [ay, by] of [
          [0.09, -0.6],
          [1.29, -0.57],
          [3.1, -1.2],
        ] as const) {
          checkBeat(`fall ${ay}→${by}`, (u) => fall(u, { ...c, dy: by - ay, len: 1 }), by - ay, 1, -Infinity);
        }
      });
      it(`every beat starts and ends in the standing pose (${tag})`, () => {
        const next = { ...c, parity: (1 - parity) as Side };
        const still = stand(c);
        for (const dy of DROPS) {
          close(walk(0, { ...c, dy, len: 1, dur: stepMs(dy) }).pose, still, `walk ${dy} start`);
          const end = walk(1, { ...c, dy, len: 1, dur: stepMs(dy) });
          assert.ok(Math.abs(end.x - 1) < 1e-9 && Math.abs(end.y - dy) < 1e-9);
          close(end.pose, stand(next), `walk ${dy} end`);
        }
        for (const len of [0.87, 2.12]) {
          const end = walk(1, { ...c, dy: 0, len });
          assert.ok(Math.abs(end.x - len) < 1e-9);
          close(end.pose, stand(next), `level walk ${len} end`);
        }
        for (const dy of [0.25, 1.2]) {
          close(climb(0, { ...c, dy, len: 1 }).pose, still, 'climb start');
          close(climb(1, { ...c, dy, len: 1 }).pose, stand(next), 'climb end');
        }
        close(stumble(0, { ...c, dy: 0, len: 1 }).pose, still, 'stumble start');
        close(stumble(1, { ...c, dy: 0, len: 1 }).pose, stand(next), 'stumble end');
        close(fall(0, { ...c, dy: -1, len: 1 }).pose, still, 'fall start');
        const f = fall(1, { ...c, dy: -1, len: 1 });
        assert.ok(Math.abs(f.y + 1) < 1e-9);
        close(f.pose, stand(next), 'fall end');
        close(guard(0, { ...c, holds: true }), still, 'check start');
        close(guard(1, { ...c, holds: true }), still, 'check end');
        close(exit(0, { ...c, len: 0.9 }).pose, guard(1, { ...c, holds: false }), 'door: the turn starts where the check ended');
      });
    }
  }
});
