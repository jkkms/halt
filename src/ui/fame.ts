// The hall of fame: the table the rush screen shows, and a screen of its own (#/fame) that the title bar's 🏆 opens.
import { nickKey } from '../core/nick.ts';
import { formatScore } from '../core/rush.ts';
import type { App, Screen } from './app.ts';
import { h } from './dom.ts';
import { t } from './i18n.ts';
import { scores, type FameRow } from './scores.ts';

/** How many rows the screen of its own loads. */
const FAME_ROWS = 10;

/** "🏆 Hall of fame" heading. */
export function fameTitle(tag: 'h1' | 'h2' = 'h2'): HTMLElement {
  return h(tag, { class: 'rush-fame-title' }, h('span', { class: 'fame-trophy', 'aria-hidden': 'true' }, '🏆'), ' ', t('rushFame'));
}

/** The table; the row of `mine` (a nickname) is lit. */
export function fameTable(rows: FameRow[], mine: string | null): HTMLElement {
  const key = mine ? nickKey(mine) : null;
  return h(
    'table',
    { class: 'rush-fame-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('rushColRank')), h('th', { scope: 'col' }, t('rushColNick')), h('th', { scope: 'col' }, t('rushColScore')), h('th', { scope: 'col' }, t('rushColCards')))),
    h(
      'tbody',
      {},
      ...rows.map((r) =>
        h(
          'tr',
          { class: key && nickKey(r.nick) === key ? 'me' : '', 'data-nick': r.nick, 'data-score': r.score },
          h('td', { class: 'num' }, String(r.rank)),
          h('td', { class: 'nick' }, r.nick),
          h('td', { class: 'num' }, formatScore(r.score)),
          h('td', { class: 'num' }, String(r.cards)),
        ),
      ),
    ),
  );
}

/** #/fame: the board alone, with a way into rush mode. */
export class FameScreen implements Screen {
  el: HTMLElement;
  private app: App;
  private state: { k: 'loading' } | { k: 'ok'; rows: FameRow[] } | { k: 'offline' } = { k: 'loading' };

  constructor(app: App) {
    this.app = app;
    this.el = h('div', { class: 'screen fame-screen' });
    this.build();
    void this.load();
  }

  relang(): void {
    this.build();
  }

  private async load(): Promise<void> {
    const res = await scores.top(FAME_ROWS);
    this.state = res.ok && Array.isArray(res.data) ? { k: 'ok', rows: res.data } : { k: 'offline' };
    this.build();
  }

  private build(): void {
    const bar = this.app.bar({ back: { label: t('backTitle'), href: '#/' }, title: t('rushFame'), dark: true });
    const s = this.state;
    const body =
      s.k === 'loading'
        ? h('p', { class: 'rush-fame-note' }, t('rushFameLoading'))
        : s.k === 'offline'
          ? h('p', { class: 'rush-fame-note' }, t('rushOffline'))
          : s.rows.length
            ? fameTable(s.rows, this.app.saved.rush.nick ?? null)
            : h('p', { class: 'rush-fame-note' }, t('rushFameEmpty'));
    const panel = h(
      'section',
      { class: 'rush-panel rush-fame', 'data-role': 'fame', 'data-state': s.k },
      fameTitle('h1'),
      body,
      h('div', { class: 'fame-actions' }, h('a', { class: 'btn primary', href: '#/rush' }, t('menuRush'))),
    );
    this.el.replaceChildren(bar, h('main', { class: 'page fame-page' }, panel));
  }
}
