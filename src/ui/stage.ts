// The stage host: one place on screen that shows a StageScene. It loads the three.js renderer lazily
// (its own chunk) and falls back to the flat SVG drawing of v0.1 when WebGL is not available.
// One renderer is shared by all screens: the stage element moves to whichever screen is open.

import type { StageScene } from '../core/stage.ts';
import type { State } from '../core/sim.ts';
import { sfx } from './audio.ts';
import { clear, h } from './dom.ts';
import { rank, stateShort } from './format.ts';
import { t } from './i18n.ts';
import type { SoftKind, WalkerSpot } from './bubble.ts';
import { Scene as FlatScene, type SceneModel } from './scene.ts';
import type { PlayInfo, ShowOptions, StageRenderer, StageText } from './stageTypes.ts';

export interface HostOptions extends ShowOptions {
  caption?: string;
  /** ✓, ✗ or ∞ in the corner. */
  badge?: string;
  /** Buttons over the stage (sample runs, replay). */
  controls?: Node[];
  /** Show the step counter and the walker's state (default true). */
  hud?: boolean;
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function stageText(): StageText {
  return {
    ground: t('ground'),
    basement: t('basement'),
    exit: t('stExit'),
    floor: (n) => t('floorN', { n }),
    unreachable: t('stUnreachable'),
    outsideRail: t('stOutsideRail'),
    railing: t('railing'),
    zone: t('zone'),
    more: t('stMore'),
    flat: t('stFlat'),
    up: t('stUp'),
    below: t('stBelow'),
    callouts: { ground: t('coGround'), basement: t('coBasement'), walker: t('coWalker'), door: t('coDoor'), stair: t('coStair') },
    yes: t('stYes'),
    no: t('stNo'),
    exitCheck: t('stExitCheck'),
    vUnknown: t('vUnknown'),
    stepsLeft: t('stepsLeftAxis'),
  };
}

const fmtState = (vars: string[], s: State) => stateShort(vars, s).replace(/-/g, '−');

export class StageHost {
  el: HTMLElement;
  private view: HTMLElement;
  private layer: HTMLElement;
  private hud: HTMLElement;
  private captionEl: HTMLElement;
  private controlsEl: HTMLElement;
  private badgeEl: HTMLElement;
  private renderer: StageRenderer | null = null;
  private flat: FlatScene | null = null;
  private loading: Promise<void> | null = null;
  private current: { scene: StageScene; opts: HostOptions } | null = null;

  constructor() {
    this.view = h('div', { class: 'stage-view' });
    this.layer = h('div', { class: 'stage-labels', 'aria-hidden': 'true' });
    this.hud = h('div', { class: 'stage-hud', 'aria-live': 'off' });
    this.badgeEl = h('div', { class: 'stage-badge', 'aria-hidden': 'true' });
    this.controlsEl = h('div', { class: 'stage-controls' });
    this.captionEl = h('p', { class: 'stage-caption', 'aria-live': 'polite' });
    this.el = h('div', { class: 'stage', role: 'img' }, h('div', { class: 'stage-sky', 'aria-hidden': 'true' }), this.view, this.layer, this.hud, this.badgeEl, this.controlsEl, this.captionEl);
  }

  /** Put the stage into a screen. */
  mount(container: HTMLElement): void {
    container.append(this.el);
    this.renderer?.setActive(true);
    requestAnimationFrame(() => this.renderer?.resize());
  }

  setActive(on: boolean): void {
    this.renderer?.setActive(on);
  }

  private ensure(): Promise<void> {
    if (this.renderer || this.flat) return Promise.resolve();
    if (this.loading) return this.loading;
    const forceFlat = /[?&]flat\b/.test(location.search);
    this.el.classList.add('loading');
    this.loading = (forceFlat ? Promise.reject(new Error('flat requested')) : import('./stage3d.ts'))
      .then((m) => {
        this.renderer = m.createStage3D(this.view, this.layer, stageText(), {
          sound: (kind, height) => (kind === 'step' ? sfx.step(height) : sfx[kind]()),
          reducedMotion: reduced,
          format: { state: fmtState, rank },
        });
        this.el.dataset.renderer = 'webgl';
      })
      .catch(() => {
        // No WebGL (or the chunk failed): the flat drawing of v0.1.
        this.flat = new FlatScene(this.view, flatText());
        this.el.dataset.renderer = 'svg';
        this.el.classList.add('flat');
      })
      .finally(() => {
        this.el.classList.remove('loading');
        if (this.current) this.paint();
      });
    return this.loading;
  }

  show(scene: StageScene, opts: HostOptions = {}): void {
    this.current = { scene, opts };
    this.captionEl.textContent = opts.caption ?? '';
    this.captionEl.hidden = !opts.caption;
    this.el.setAttribute('aria-label', opts.caption ?? t('sceneTitle'));
    this.badgeEl.textContent = opts.badge ?? '';
    this.badgeEl.dataset.badge = opts.badge ?? '';
    clear(this.controlsEl);
    if (opts.controls) this.controlsEl.append(...opts.controls);
    this.hud.hidden = opts.hud === false;
    this.hud.textContent = '';
    if (this.renderer || this.flat) this.paint();
    else void this.ensure();
  }

  replay(): void {
    if (this.renderer) this.renderer.replay();
    else this.flat?.replay();
  }

  /** The walker's head and feet in pixels of the stage box; null when unknown (loading, flat drawing, off screen). */
  walkerSpot(): WalkerSpot | null {
    return this.renderer?.walkerSpot() ?? null;
  }

  /**
   * The stage's own boxes over the drawing, for things floating over it (the tutorial's speech bubble): its words
   * (the callouts, the exit sign, the caption, the railing and zone signs), its numbers (the step badges, the ruler)
   * and its buttons (the step counter, the shot buttons). The loop-check bubble is left out: it comes and goes, and
   * the speech bubble keeps clear of where it will be anyway.
   */
  overlays(): { rect: DOMRect; kind: SoftKind }[] {
    const out: { rect: DOMRect; kind: SoftKind }[] = [];
    const add = (el: HTMLElement, kind: SoftKind) => {
      if (el.hidden || !el.childNodes.length || el.style.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push({ rect: r, kind });
    };
    add(this.hud, 'ui');
    add(this.controlsEl, 'ui');
    add(this.captionEl, 'text');
    for (const el of this.layer.querySelectorAll<HTMLElement>('.l3:not(.l3-check)')) add(el, el.matches('.l3-v, .l3-tick, .l3-inf, .l3-more') ? 'number' : 'text');
    return out;
  }

  /** The size of the loop-check bubble over the walker's head while it is shown; null otherwise. */
  checkSize(): { w: number; h: number } | null {
    const el = this.layer.querySelector<HTMLElement>('.l3-check');
    if (!el || el.style.display === 'none') return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { w: r.width, h: r.height } : null;
  }

  relang(): void {
    this.renderer?.setText(stageText());
    if (this.flat) this.flat.text = flatText();
  }

  private paint(): void {
    if (!this.current) return;
    const { scene, opts } = this.current;
    if (this.renderer) {
      this.renderer.show(scene, { ...opts, onBeat: (b) => this.beat(scene, b, opts) });
    } else if (this.flat) {
      this.flat.show(toFlat(scene, opts.caption ?? ''), []);
    }
  }

  private beat(scene: StageScene, b: PlayInfo, opts: HostOptions): void {
    if (opts.hud !== false) this.hud.replaceChildren(...hudParts(scene, b));
    opts.onBeat?.(b);
  }
}

function hudParts(scene: StageScene, b: PlayInfo): Node[] {
  if (scene.k === 'idle' || !b.state) return [];
  const steps = b.kind === 'step' ? b.k + 1 : b.kind === 'exit' ? (b.steps ?? b.k) : b.k;
  const parts: Node[] = [h('span', { class: 'hud-step' }, t('stepCounter', { k: steps }))];
  parts.push(h('span', { class: 'hud-state' }, fmtState(scene.vars, b.state)));
  if (b.v) parts.push(h('span', { class: 'hud-v' }, t('hudLeft', { v: rank(b.v).replace(/-/g, '−') })));
  if (b.kind === 'exit') parts.push(h('span', { class: 'hud-done' }, t('hudEnded', { k: b.steps ?? 0 })));
  return parts;
}

function flatText() {
  return {
    ground: t('ground'),
    basement: t('basement'),
    stepCounter: (k: number) => t('stepCounter', { k }),
    floor: (n: number) => t('floorN', { n }),
    exit: t('exit'),
    forever: t('forever'),
    replay: t('replay'),
    vUnknown: t('vUnknown'),
    stepsLeft: t('stepsLeftAxis'),
  };
}

/** The same scene for the flat SVG drawing. */
function toFlat(scene: StageScene, caption: string): SceneModel {
  switch (scene.k) {
    case 'idle':
      return { k: 'idle', caption };
    case 'stairs':
      return {
        k: 'stairs',
        caption,
        points: scene.stairs.map((st) => ({ s: st.s, v: st.v ?? [BigInt(Math.round(st.h))], walking: st.walking, bad: st.bad })),
        door: scene.end === 'exit',
        loop: scene.end === 'cut',
        truncated: scene.end === 'more',
      };
    case 'shaft':
      return { k: 'shaft', states: scene.states, caption };
    case 'ring':
      return { k: 'ring', prefix: scene.prefix, cycle: scene.cycle, caption };
  }
}
