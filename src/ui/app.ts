// The app shell: hash routes for the screens, the shared stage, the judge, language and sound.
//   #/              title
//   #/tutorial      the tutorial        #/tutorial/3   its page 3
//   #/intro/7       the intro before level 7 (also #/intro/5, #/intro/10, and #/intro/7/2 for its page 2)
//   #/levels        proof mode (level select)          #/level/7      a level
//   #/rush          rush mode: explanation, nickname, hall of fame
//   #/rush/play     a ranked rush run                  #/rush/practice   a practice run
//   #/fame          the hall of fame alone (the 🏆 at the top right of the title screen)
//   (#/daily, the old daily puzzle, and #/rush/today now lead to the title and the rush screen.)
import type { Judge } from '../core/judge.ts';
import { LEVELS } from '../core/levels.ts';
import { loadJudge, type Z3Status } from '../z3/browser.ts';
import { isMuted, setMuted, sfx, unlock } from './audio.ts';
import { h } from './dom.ts';
import { defaultLang, lang, setLang, t } from './i18n.ts';
import { LevelScreen } from './level.ts';
import { closeAllModals } from './overlay.ts';
import { RushScreen } from './rush.ts';
import { FameScreen } from './fame.ts';
import { SelectScreen } from './select.ts';
import { StageHost } from './stage.ts';
import { load, save, type Saved } from './store.ts';
import { TitleScreen } from './title.ts';
import { INTRO_LEVELS } from '../core/tutorial.ts';
import { TutorialScreen } from './tutorialView.ts';

export interface Screen {
  el: HTMLElement;
  /** Called after the screen is in the document. */
  shown?(): void;
  relang?(): void;
  destroy?(): void;
  z3Changed?(): void;
}

export interface BarOptions {
  back?: { label: string; href: string };
  title?: string | Node;
  extra?: Node[];
  /** Dark bar over the stage (title, tutorial). */
  dark?: boolean;
}

export class App {
  saved: Saved;
  stage = new StageHost();
  judge: Judge | null = null;
  z3: Z3Status = { state: 'waiting' };
  private waiters: ((j: Judge | null) => void)[] = [];
  private root: HTMLElement;
  private screen: Screen | null = null;
  private levelCache: LevelScreen | null = null;
  private route: string | null = null;
  /** Where an intro returns to (the level that opened it). */
  private introReturn: Record<number, string> = {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.saved = load();
    setLang(this.saved.lang ?? defaultLang());
    setMuted(!!this.saved.muted);
    const wake = () => unlock();
    window.addEventListener('pointerdown', wake, { capture: true });
    window.addEventListener('keydown', wake, { capture: true });
    window.addEventListener('hashchange', () => this.render());
    this.render();
    setTimeout(() => this.startJudge(), 60);
  }

  persist(): void {
    save(this.saved);
  }

  nav(hash: string): void {
    if (location.hash === hash) this.render();
    else location.hash = hash;
  }

  /** Show the intro before a level; its last page (and Skip) go back to `returnTo`. */
  openIntro(level: number, returnTo: string, replace = false): void {
    this.introReturn[level] = returnTo;
    if (replace) location.replace(`#/intro/${level}`);
    else location.hash = `#/intro/${level}`;
  }

  // ------------------------------------------------------------ judge

  private startJudge(): void {
    loadJudge((st) => {
      this.z3 = st;
      this.screen?.z3Changed?.();
    })
      .then((j) => {
        this.judge = j;
        for (const w of this.waiters.splice(0)) w(j);
        this.screen?.z3Changed?.();
      })
      .catch(() => {
        for (const w of this.waiters.splice(0)) w(null);
        this.screen?.z3Changed?.();
      });
  }

  /** The judge, once loaded; null if it cannot load in this browser (one retry per check). */
  judgeReady(): Promise<Judge | null> {
    if (this.judge) return Promise.resolve(this.judge);
    const p = new Promise<Judge | null>((resolve) => this.waiters.push(resolve));
    if (this.z3.state === 'error') this.startJudge();
    return p;
  }

  // ------------------------------------------------------------ routing

  private render(): void {
    const hash = location.hash || '#/';
    const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const route = parts.join('/');
    if (route === this.route && this.screen) return;
    let next: Screen;
    const [head, arg, sub] = parts;
    // Old links (11/3): the daily puzzle is gone, and rush has no "today's rush" any more.
    if (head === 'daily' || (head === 'rush' && arg === 'today')) {
      location.replace(head === 'daily' ? '#/' : '#/rush');
      return;
    }
    const levelId = head === 'level' && arg ? Math.min(LEVELS.length, Math.max(1, Number(arg) || 1)) : null;
    // The first time level 5, 7 or 10 opens, its short intro comes first.
    if (levelId !== null && INTRO_LEVELS.includes(levelId) && !this.saved.introsShown.includes(levelId)) {
      this.saved.introsShown.push(levelId);
      this.persist();
      this.openIntro(levelId, hash, true);
      return;
    }
    this.route = route;
    if (head === 'tutorial') next = new TutorialScreen(this, { k: 'tutorial' }, (Number(arg) || 1) - 1);
    else if (head === 'intro' && INTRO_LEVELS.includes(Number(arg))) {
      const level = Number(arg);
      next = new TutorialScreen(this, { k: 'intro', level, returnTo: this.introReturn[level] ?? `#/level/${level}` }, (Number(sub) || 1) - 1);
    } else if (head === 'levels') next = new SelectScreen(this);
    else if (head === 'rush') next = new RushScreen(this, arg === 'play' || arg === 'practice' ? arg : null);
    else if (head === 'fame') next = new FameScreen(this);
    else if (levelId !== null) {
      const id = levelId;
      const cached = this.levelCache;
      if (cached && cached.levelId === id) next = cached;
      else {
        cached?.destroy();
        next = this.levelCache = new LevelScreen(this, id);
      }
    } else next = new TitleScreen(this);
    // a dialog the old screen opened (e.g. the tutorial suggestion on level 1) does not follow to the next one
    closeAllModals();
    const prev = this.screen;
    if (prev && prev !== next && prev !== this.levelCache) prev.destroy?.();
    this.screen = next;
    // Screens with a stage mount it again in shown(); the others leave it paused.
    this.stage.setActive(false);
    this.root.replaceChildren(next.el);
    document.title = next instanceof LevelScreen ? `Halt? · ${t('levelN', { n: next.levelId })}` : next instanceof RushScreen ? `Halt? · ${t('menuRush')}` : 'Halt?';
    window.scrollTo(0, 0);
    next.shown?.();
  }

  // ------------------------------------------------------------ shared UI

  toggleLang(): void {
    const next = lang() === 'en' ? 'ko' : 'en';
    setLang(next);
    this.saved.lang = next;
    this.persist();
    this.stage.relang();
    if (this.screen?.relang) this.screen.relang();
    else this.rerender();
  }

  /** Rebuild the current screen (a level keeps its progress, which lives in its object). */
  rerender(): void {
    this.route = null;
    if (this.screen && this.screen !== this.levelCache) this.screen.destroy?.();
    this.screen = null;
    this.render();
  }

  toggleSound(): void {
    this.saved.muted = !this.saved.muted;
    setMuted(this.saved.muted);
    this.persist();
    if (!this.saved.muted) sfx.click();
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-role="sound"]')) paintSound(b);
  }

  bar(o: BarOptions): HTMLElement {
    const langBtn = h('button', { type: 'button', class: 'icon-btn lang-btn', title: t('langToggleTitle'), onclick: () => this.toggleLang() }, t('langToggle'));
    const sound = h('button', { type: 'button', class: 'icon-btn', 'data-role': 'sound', onclick: () => this.toggleSound() });
    paintSound(sound);
    return h(
      'header',
      { class: `bar${o.dark ? ' dark' : ''}` },
      h(
        'div',
        { class: 'bar-left' },
        o.back ? h('a', { class: 'back', href: o.back.href }, h('span', { 'aria-hidden': 'true' }, '←'), h('span', { class: 'back-label' }, o.back.label)) : null,
        h('a', { class: 'mini-brand', href: '#/', 'aria-label': 'Halt?' }, logoMark(), h('span', {}, 'Halt?')),
        o.title ? h('div', { class: 'bar-title' }, o.title) : null,
      ),
      h('div', { class: 'bar-right' }, ...(o.extra ?? []), sound, langBtn),
    );
  }

  /** "Judge ready" and friends; call `.paint()` when the status changes. */
  judgeBadge(onClick?: () => void): HTMLButtonElement & { paint: () => void } {
    const b = h('button', { type: 'button', class: 'judge-badge', onclick: () => onClick?.() }) as HTMLButtonElement & { paint: () => void };
    b.paint = () => {
      const st = this.z3;
      b.dataset.state = st.state;
      let icon = '…';
      let text = t('judgeWaiting');
      if (st.state === 'ready') [icon, text] = ['✓', t('judgeReady')];
      else if (st.state === 'error') [icon, text] = ['!', t('judgeError')];
      else if (st.state === 'loading' && st.total) {
        const pct = Math.min(99, Math.round(((st.loaded ?? 0) / st.total) * 100));
        [icon, text] = [`${pct}%`, t('judgeLoadingPct', { pct })];
      } else if (st.state === 'loading') text = t('judgeLoading');
      b.replaceChildren(h('span', { class: 'jb-icon' }, icon), ' ', h('span', { class: 'jb-text' }, text));
      b.title = text;
    };
    b.paint();
    return b;
  }
}

/** The mute button is a toggle: pressed = muted, shown by a red slash across the speaker. */
export function paintSound(b: HTMLButtonElement): void {
  const off = isMuted();
  b.replaceChildren(soundIcon(off));
  b.classList.toggle('muted', off);
  b.dataset.muted = off ? 'true' : 'false';
  b.setAttribute('aria-label', t('muteLabel'));
  b.setAttribute('aria-pressed', off ? 'true' : 'false');
  b.title = `${t('soundTitle')} · ${off ? t('soundOff') : t('soundOn')}`;
}

function soundIcon(off: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>' +
    '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
    (off ? ' opacity="0.45"/>' : '/>') +
    // the slash: a halo in the button's own background, then red on top, so it reads on dark and light bars
    (off ? '<path class="slash-halo" d="M3.5 3.5l17 17" stroke-width="5" stroke-linecap="round"/><path class="slash" d="M3.5 3.5l17 17" stroke-width="2.6" stroke-linecap="round"/>' : '');
  return svg;
}

/** The mark: stairs going down to a lit doorway. */
export function logoMark(cls = 'logo'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 32');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path d="M1 7h8v6h7v6h7v6h0v5H1z" class="logo-stairs"/>' +
    '<rect x="27" y="13" width="11" height="17" rx="5.5" class="logo-door"/>' +
    '<circle cx="5" cy="3.2" r="2.2" class="logo-lamp"/>';
  return svg;
}
