// Modal dialogs.
import { h } from './dom.ts';

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

/** The open dialogs' close functions: a dialog belongs to the screen that opened it. */
const open = new Set<() => void>();

/** Close every open dialog (the route changed, so the screen that opened them is gone). */
export function closeAllModals(): void {
  for (const close of [...open]) close();
}

export function openModal(title: string, body: (Node | string)[], buttons: ModalButton[], opts: { wide?: boolean } = {}): () => void {
  const prevFocus = document.activeElement as HTMLElement | null;
  const close = () => {
    open.delete(close);
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
  open.add(close);
  document.addEventListener('keydown', onKey);
  (btns.find((_, i) => buttons[i]!.primary) ?? btns[0])?.focus();
  return close;
}
