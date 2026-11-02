// Types shared by the stage host (main bundle) and the three.js renderer (lazy chunk).
import type { Bad, StageScene } from '../core/stage.ts';
import type { State } from '../core/sim.ts';
import type { Callout } from '../core/tutorial.ts';

export interface StageText {
  ground: string;
  basement: string;
  exit: string;
  floor: (n: number) => string;
  unreachable: string;
  outsideRail: string;
  railing: string;
  zone: string;
  more: string;
  flat: string;
  up: string;
  below: string;
  callouts: Record<Callout, string>;
  yes: string;
  no: string;
  /** The last check of a run: "false → loop ends, to the exit". */
  exitCheck: string;
  vUnknown: string;
  stepsLeft: string;
}

/** What the walker is doing now (the code panel and the HUD follow it). */
export interface PlayInfo {
  kind: 'start' | 'guard' | 'step' | 'exit' | 'more' | 'cut';
  /** Stair / state index (steps taken so far on a ring or shaft). */
  k: number;
  /** Lines of code running now (the while line during a check, the body lines during a step). */
  lines: number[];
  holds?: boolean;
  state?: State;
  v?: bigint[] | null;
  bad?: Bad;
  steps?: number;
  /** The first pass of this scene (not a replay loop). */
  first: boolean;
}

export type SoundKind = 'step' | 'land' | 'fail' | 'fall';

export interface ShowOptions {
  /** Play the walk again and again (default true). */
  loop?: boolean;
  /** Sounds on the first pass. */
  sound?: boolean;
  callouts?: Callout[];
  onBeat?: (b: PlayInfo) => void;
  /** Camera distance multiplier (title: further away). */
  zoom?: number;
  /** Move the subject right by this fraction of the width (title: room for the text on the left). */
  shift?: number;
}

export interface StageRenderer {
  show(scene: StageScene, opts: ShowOptions): void;
  replay(): void;
  setText(text: StageText): void;
  setActive(on: boolean): void;
  resize(): void;
  dispose(): void;
}

export interface RendererHooks {
  sound(kind: SoundKind, height: number): void;
  reducedMotion(): boolean;
  format: {
    state(vars: string[], s: State): string;
    rank(v: bigint[]): string;
  };
}
