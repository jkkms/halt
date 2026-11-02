// The always-visible input help: the level's variables and the symbols, as chips that type themselves.
import { h } from './dom.ts';
import { t } from './i18n.ts';

export interface ChipOptions {
  vars: string[];
  /** Conditions (railing, zone): comparisons and logic too. */
  cond: boolean;
  tuple: boolean;
  /** The input the chips type into. */
  target: () => HTMLInputElement | null;
  onInsert?: () => void;
  example?: boolean;
}

/** Insert text at the caret; `back` moves the caret left afterwards (inside "abs()"). */
export function insertAt(input: HTMLInputElement, text: string, back = 0): void {
  const a = input.selectionStart ?? input.value.length;
  const b = input.selectionEnd ?? a;
  const before = input.value.slice(0, a);
  const pad = text.length > 1 && /^[a-z]/.test(text) && /[A-Za-z0-9_)]$/.test(before) ? ' ' : '';
  input.value = before + pad + text + input.value.slice(b);
  const at = a + pad.length + text.length - back;
  input.setSelectionRange(at, at);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function syntaxExample(vars: string[], cond: boolean): string {
  const a = vars[0] ?? 'x';
  const b = vars[1] ?? a;
  return cond ? `${a} >= 0 && ${b} != 3` : `max(${a}, 0) - abs(${b})`;
}

export function chipBar(o: ChipOptions): HTMLElement {
  const chip = (label: string, insert: string, back: number, cls: string, title?: string) =>
    h(
      'button',
      {
        type: 'button',
        class: `chip ${cls}`,
        title: title ?? insert,
        // keep the focus (and the caret) in the input
        onmousedown: (e: Event) => e.preventDefault(),
        onclick: () => {
          const input = o.target();
          if (!input) return;
          insertAt(input, insert, back);
          if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
          o.onInsert?.();
        },
      },
      label,
    );
  const syms: [string, string, number][] = [
    ['+', ' + ', 0],
    ['−', ' - ', 0],
    ['*', '*', 0],
    ['/', ' / ', 0],
    ['%', ' % ', 0],
    ['(', '(', 0],
    [')', ')', 0],
    ['abs( )', 'abs()', 1],
    ['min( , )', 'min(, )', 3],
    ['max( , )', 'max(, )', 3],
  ];
  if (o.tuple) syms.push(['( , )', '(, )', 3]);
  if (o.cond) syms.push(['==', ' == ', 0], ['!=', ' != ', 0], ['<', ' < ', 0], ['<=', ' <= ', 0], ['>', ' > ', 0], ['>=', ' >= ', 0], ['&&', ' && ', 0], ['||', ' || ', 0], ['!', '!', 0]);
  return h(
    'div',
    { class: 'chips' },
    h('div', { class: 'chip-row' }, h('span', { class: 'chip-label' }, t('inputVars')), ...o.vars.map((v) => chip(v, v, 0, 'chip-var'))),
    h('div', { class: 'chip-row' }, h('span', { class: 'chip-label' }, t('inputSyms')), ...syms.map(([l, ins, back]) => chip(l, ins, back, 'chip-sym'))),
    o.example === false ? null : h('p', { class: 'chip-example' }, `${t('inputExample')}: `, h('code', {}, syntaxExample(o.vars, o.cond))),
  );
}
