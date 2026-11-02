// Modal dialogs and the coach-mark bubble used by the tutorial.
import { h } from './dom.ts';

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

export function openModal(title: string, body: (Node | string)[], buttons: ModalButton[], opts: { wide?: boolean } = {}): () => void {
  const prevFocus = document.activeElement as HTMLElement | null;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const btns = buttons.map((b) =>
    h(
      'button',
      {
        type: 'button',
        class: `btn ${b.primary ? 'primary' : 'ghost'}`,
        onclick: () => {
          close();
          b.onClick?.();
        },
      },
      b.label,
    ),
  );
  const titleId = `m${Math.random().toString(36).slice(2)}`;
  const dialog = h(
    'div',
    { class: `modal${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('h2', { id: titleId }, title),
    h('div', { class: 'modal-body' }, ...body),
    h('div', { class: 'modal-actions' }, ...btns),
  );
  const overlay = h(
    'div',
    {
      class: 'modal-overlay',
      onclick: (e: Event) => {
        if (e.target === overlay) close();
      },
    },
    dialog,
  );
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  (btns.find((_, i) => buttons[i]!.primary) ?? btns[0])?.focus();
  return close;
}

/** A speech bubble pointing at an element on the real board. */
export class Coach {
  bubble: HTMLElement;
  textEl: HTMLElement;
  actions: HTMLElement;
  target: HTMLElement | null = null;
  private raf = 0;

  constructor() {
    this.textEl = h('p', { class: 'coach-text' });
    this.actions = h('div', { class: 'coach-actions' });
    this.bubble = h('div', { class: 'coach', role: 'status', 'aria-live': 'polite', hidden: true }, h('div', { class: 'coach-arrow' }), this.textEl, this.actions);
    document.body.append(this.bubble);
    const reposition = () => this.position();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, { passive: true });
  }

  show(target: HTMLElement | null, text: string, actions: Node[], scroll = true): void {
    this.target?.classList.remove('coach-target');
    this.target = target;
    target?.classList.add('coach-target');
    this.textEl.textContent = text;
    this.actions.replaceChildren(...actions);
    this.bubble.hidden = false;
    if (scroll && target) {
      const r = target.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 160) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    this.position();
  }

  hide(): void {
    this.target?.classList.remove('coach-target');
    this.target = null;
    this.bubble.hidden = true;
  }

  position(): void {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      if (this.bubble.hidden) return;
      const b = this.bubble;
      const narrow = window.innerWidth < 760;
      b.classList.toggle('docked', narrow || !this.target);
      if (narrow || !this.target || !this.target.isConnected) {
        b.style.left = '';
        b.style.top = '';
        return;
      }
      const r = this.target.getBoundingClientRect();
      const bw = Math.min(340, window.innerWidth - 32);
      b.style.width = `${bw}px`;
      const bh = b.offsetHeight;
      let left = r.left + r.width / 2 - bw / 2;
      left = Math.max(16, Math.min(left, window.innerWidth - bw - 16));
      let top = r.bottom + 12;
      let below = true;
      if (top + bh > window.innerHeight - 8 && r.top - bh - 12 > 8) {
        top = r.top - bh - 12;
        below = false;
      }
      b.classList.toggle('above', !below);
      b.style.left = `${left + window.scrollX}px`;
      b.style.top = `${top + window.scrollY}px`;
      const arrow = b.querySelector<HTMLElement>('.coach-arrow');
      if (arrow) arrow.style.left = `${Math.max(14, Math.min(bw - 14, r.left + r.width / 2 - left))}px`;
    });
  }
}
