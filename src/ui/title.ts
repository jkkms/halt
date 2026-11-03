// The title screen, one centred composition (SPEC_v0.5 §A): the wordmark, the question and one line on what you
// do at the top; the building at dusk with the walker going down behind them; the menu in a row at the bottom.
// The long purpose paragraph lives in the README; tutorial page 1 gives the goal.
// Three modes (11/3): Tutorial, Proof mode (the 18 levels), Rush mode. A newcomer sees the tutorial first; a
// returning player sees Rush mode first and largest (MENU_ORDER, MENU_PRIMARY).
import { recommendedNext } from '../core/groups.ts';
import { levelById } from '../core/levels.ts';
import { initialState } from '../core/sim.ts';
import { runScene } from '../core/stage.ts';
import { HOOK } from '../core/tutorial.ts';
import type { App, Screen } from './app.ts';
import { logoMark } from './app.ts';
import { h } from './dom.ts';
import { lang, t } from './i18n.ts';
import type { Saved } from './store.ts';

type MenuKey = 'tutorial' | 'proof' | 'rush';

/** Newcomers: the tutorial first. Returning players: rush first (and largest), then the proofs, then the tutorial. */
export const MENU_ORDER: Record<'newcomer' | 'returning', MenuKey[]> = {
  newcomer: ['tutorial', 'rush', 'proof'],
  returning: ['rush', 'proof', 'tutorial'],
};
/** The orange (primary) buttons. */
export const MENU_PRIMARY: Record<'newcomer' | 'returning', MenuKey[]> = {
  newcomer: ['tutorial', 'rush'],
  returning: ['rush', 'proof'],
};

/** Returning = the tutorial was finished or skipped, a level was solved, or a rush card was answered. */
export function isReturning(saved: Pick<Saved, 'tutorial' | 'best' | 'rush'>): boolean {
  return saved.tutorial === 'done' || saved.tutorial === 'skipped' || Object.keys(saved.best).length > 0 || saved.rush.seen.length > 0 || saved.rush.best > 0 || saved.rush.practiceBest > 0;
}

export class TitleScreen implements Screen {
  el: HTMLElement;
  private app: App;
  private stageBox: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.stageBox = h('div', { class: 'title-stage' });
    this.el = h('div', { class: 'screen title-screen' });
    this.build();
  }

  private build(): void {
    const app = this.app;
    const L = lang();
    const next = recommendedNext(app.saved.best);
    const returning = isReturning(app.saved);
    const btn = (key: MenuKey) => {
      const sub =
        key === 'tutorial'
          ? returning
            ? undefined
            : t('startHere')
          : key === 'proof'
            ? next && Object.keys(app.saved.best).length
              ? t('menuContinue', { n: next })
              : undefined
            : t('menuRushSub');
      const label = key === 'tutorial' ? t('menuTutorial') : key === 'proof' ? t('menuLevels') : t('menuRush');
      const href = key === 'tutorial' ? '#/tutorial' : key === 'proof' ? '#/levels' : '#/rush';
      const cls = [MENU_PRIMARY[returning ? 'returning' : 'newcomer'].includes(key) ? 'primary' : '', returning && key === 'rush' ? 'lead' : ''].filter(Boolean).join(' ');
      return h('a', { class: `menu-btn ${cls}`, href, 'data-mode': key }, h('span', { class: 'menu-label' }, label), sub ? h('span', { class: 'menu-sub' }, sub) : null);
    };
    const content = h(
      'div',
      { class: 'title-content' },
      h(
        'div',
        { class: 'title-top' },
        h('h1', { class: 'wordmark' }, logoMark('logo big'), h('span', {}, 'Halt?')),
        h('p', { class: 'hook' }, HOOK[L]),
        h('p', { class: 'title-line' }, t('titleLine')),
      ),
      h(
        'div',
        { class: 'title-bottom' },
        h('nav', { class: `menu${returning ? ' returning' : ''}`, 'aria-label': 'menu' }, ...MENU_ORDER[returning ? 'returning' : 'newcomer'].map(btn)),
        h(
          'div',
          { class: 'title-foot' },
          h('a', { href: 'https://github.com/jkkms/halt', target: '_blank', rel: 'noopener' }, t('github')),
          h('span', {}, t('footLine')),
        ),
      ),
    );
    const bar = app.bar({ dark: true });
    bar.classList.add('title-bar');
    this.el.replaceChildren(this.stageBox, h('div', { class: 'title-shade', 'aria-hidden': 'true' }), bar, content);
  }

  shown(): void {
    const l1 = levelById(1);
    this.app.stage.mount(this.stageBox);
    this.app.stage.show(runScene(l1, initialState(l1, { n: 5n }), null), { hud: false, loop: true, zoom: 1.6 });
  }

  relang(): void {
    this.build();
    this.shown();
  }
}
