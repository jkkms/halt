// The title screen: the building at dusk with the walker going down, the hook, and what the game is for.
import { dailyLevelId, utcDateKey } from '../core/game.ts';
import { recommendedNext } from '../core/groups.ts';
import { levelById, LEVELS } from '../core/levels.ts';
import { initialState } from '../core/sim.ts';
import { runScene } from '../core/stage.ts';
import { HOOK, PURPOSE } from '../core/tutorial.ts';
import type { App, Screen } from './app.ts';
import { logoMark } from './app.ts';
import { h } from './dom.ts';
import { lang, t } from './i18n.ts';

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
    const newcomer = app.saved.tutorial !== 'done' && !Object.keys(app.saved.best).length;
    const next = recommendedNext(app.saved.best);
    const today = dailyLevelId(utcDateKey(new Date()), LEVELS.length);
    const btn = (label: string, href: string, cls: string, sub?: string) =>
      h('a', { class: `menu-btn ${cls}`, href }, h('span', { class: 'menu-label' }, label), sub ? h('span', { class: 'menu-sub' }, sub) : null);
    const content = h(
      'div',
      { class: 'title-content' },
      h('h1', { class: 'wordmark' }, logoMark('logo big'), h('span', {}, 'Halt?')),
      h('p', { class: 'hook' }, HOOK[L]),
      h('p', { class: 'purpose' }, PURPOSE[L]),
      h(
        'nav',
        { class: 'menu', 'aria-label': 'menu' },
        btn(t('menuTutorial'), '#/tutorial', newcomer ? 'primary' : '', newcomer ? t('startHere') : undefined),
        btn(t('menuLevels'), '#/levels', newcomer ? '' : 'primary', next && !newcomer ? t('menuContinue', { n: next }) : undefined),
        btn(t('menuDaily'), '#/daily', '', `${t('levelN', { n: today })} · ${levelById(today).title[L]}`),
      ),
      h(
        'div',
        { class: 'title-foot' },
        h('a', { href: 'https://github.com/jkkms/halt', target: '_blank', rel: 'noopener' }, t('github')),
        h('span', {}, t('footLine')),
      ),
    );
    const bar = app.bar({ dark: true });
    bar.classList.add('title-bar');
    this.el.replaceChildren(this.stageBox, h('div', { class: 'title-shade', 'aria-hidden': 'true' }), bar, content);
  }

  shown(): void {
    const l1 = levelById(1);
    this.app.stage.mount(this.stageBox);
    this.app.stage.show(runScene(l1, initialState(l1, { n: 5n }), null), { hud: false, loop: true, zoom: 1.45, shift: 0.2 });
  }

  relang(): void {
    this.build();
    this.shown();
  }
}
