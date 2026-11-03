// Types shared by the stage host (main bundle) and the three.js renderer (lazy chunk).
import type { Bad, StageScene } from '../core/stage.ts';
import type { State } from '../core/sim.ts';

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
  /** A step: the state after the body ran (and its steps left), which the HUD shows. */
  after?: State;
  afterV?: bigint[] | null;
  bad?: Bad;
  steps?: number;
  /** The first pass of this scene (not a replay loop). */
  first: boolean;
}

export type SoundKind = 'step' | 'land' | 'fail' | 'fall';

/** Space kept free around the scene, in px of the stage box (the tutorial's text box, the code card, the controls). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Freeze the run at a beat: the start, the i-th loop check (decided), or the check that fails. */
export type StageHold = { at: 'start' } | { at: 'check'; i: number } | { at: 'lastCheck' };

/** Something on the stage a ring can be drawn around (SPEC_v0.6 §C; `floorStep`: the steps where a pair's first part goes down). */
export type StageTarget = 'walker' | 'stairHere' | 'check' | 'door' | 'ruler' | 'mark' | 'floorStep' | 'ring' | 'zone' | 'railing' | 'ghost';

/** A rectangle in px of the stage box. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShowOptions {
  /** Play the walk again and again (default true). */
  loop?: boolean;
  /** Sounds on the first pass. */
  sound?: boolean;
  onBeat?: (b: PlayInfo) => void;
  /** Camera distance multiplier (title: further away). */
  zoom?: number;
  /**
   * Frame the scene inside the stage minus these insets; several: the one where the scene comes out largest
   * (src/ui/frame.ts).
   */
  inset?: Insets | Insets[];
  /** Boxes over the stage (px of the stage box) that labels must keep out of: they move off them or hide. */
  keepOut?: Rect[];
  /** Freeze at a beat instead of playing. */
  hold?: StageHold;
  /** Step mode: held at the start; `step()` plays one beat and holds again. */
  step?: boolean;
  /** `all`: always fit the whole scene (no following camera, except down a bottomless shaft). */
  frame?: 'auto' | 'all';
  /** Show every flat/up/below mark at once (default: only the one where the walker is). */
  allMarks?: boolean;
  /** Called at the end of every drawn frame, once the labels are placed (focus rings follow them in the same frame). */
  onFrame?: () => void;
}

/** Where a run stands in step mode or on a held page. */
export interface HoldState {
  held: boolean;
  /** Step mode: the walk is over (the walker went out by the door). */
  done: boolean;
}

export interface StageRenderer {
  show(scene: StageScene, opts: ShowOptions): void;
  replay(): void;
  setText(text: StageText): void;
  setActive(on: boolean): void;
  resize(): void;
  dispose(): void;
  /** Change the insets (and the boxes labels keep out of) without restarting the run. */
  setInset(inset: Insets | Insets[] | undefined, keepOut?: Rect[]): void;
  /** Step mode: play the next beat; false when there is none. */
  step(): boolean;
  holdState(): HoldState;
  /**
   * A focus target in px of the stage box, as of the last frame: one rect per piece (every mark with its step, every
   * floor tick, …); none when it is not on screen.
   */
  focusRects(target: StageTarget): Rect[];
}

export interface RendererHooks {
  sound(kind: SoundKind, height: number): void;
  reducedMotion(): boolean;
  format: {
    state(vars: string[], s: State): string;
    rank(v: bigint[]): string;
  };
}
