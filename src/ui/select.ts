// Level select: cards grouped by chapter, with best stars and a tiny code preview (never the verdict).
import { dailyLevelId, utcDateKey } from '../core/game.ts';
import { codePreview, GROUPS, recommendedNext } from '../core/groups.ts';
import { levelById, LEVELS } from '../core/levels.ts';
import type { App, Screen } from './app.ts';
import { h } from './dom.ts';
import { starsText } from './format.ts';
import { lang, t } from './i18n.ts';

export class SelectScreen implements Screen {
  el: HTMLElement;
  private app: App;

  constructor(app: App) {
    this.app = app;
    this.el = h('div', { class: 'screen select-screen' });
    this.build();
  }

  private build(): void {
    const app = this.app;
    const L = lang();
    const next = recommendedNext(app.saved.best);
    const today = dailyLevelId(utcDateKey(new Date()), LEVELS.length);
    const needTutorial = app.saved.tutorial !== 'done';
    const card = (id: number) => {
      const l = levelById(id);
      const best = app.saved.best[id] ?? 0;
      return h(
        'a',
        { class: `lv-card${best ? ' solved' : ''}${id === next ? ' next' : ''}`, href: `#/level/${id}`, 'data-level': id },
        h('span', { class: 'lv-top' }, h('span', { class: 'lv-num' }, String(id)), h('span', { class: 'lv-stars', 'aria-label': `${best}/3` }, starsText(best))),
        h('span', { class: 'lv-title' }, l.title[L]),
        h('code', { class: 'lv-code' }, codePreview(l)),
        h('span', { class: 'lv-tags' }, id === next ? h('span', { class: 'tag next' }, t('nextUp')) : null, id === today ? h('span', { class: 'tag today' }, t('todayTag')) : null),
      );
    };
    this.el.replaceChildren(
      app.bar({ back: { label: t('backTitle'), href: '#/' }, title: t('selectTitle') }),
      h(
        'main',
        { class: 'page' },
        h('div', { class: 'page-head' }, h('h1', {}, t('selectTitle')), h('p', { class: 'lead' }, t('selectIntro'))),
        needTutorial ? h('p', { class: 'nudge' }, t('tutorialNudge'), ' ', h('a', { class: 'btn small', href: '#/tutorial' }, t('openTutorial'))) : null,
        ...GROUPS.map((g) => h('section', { class: 'lv-group' }, h('h2', {}, g.title[L]), h('div', { class: 'lv-grid' }, ...g.levels.map(card)))),
      ),
    );
  }

  relang(): void {
    this.build();
  }
}
