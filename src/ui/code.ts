// The code of a level, line by line, so the lines can light up while the walker moves.
import type { Level } from '../core/levels.ts';
import { h } from './dom.ts';
import type { PlayInfo } from './stageTypes.ts';

export interface CodeView {
  el: HTMLPreElement;
  lines: HTMLElement[];
}

export function codeView(level: Level, failing: Set<number> = new Set()): CodeView {
  const pre = h('pre', { class: 'code', 'aria-label': 'code' });
  const lines: HTMLElement[] = [];
  level.code.split('\n').forEach((line, i) => {
    const row = h('span', { class: `code-line${failing.has(i) ? ' lit' : ''}` });
    for (const tok of line.split(/(\bwhile\b|\bif\b|\belse\b|:=|\b\d+\b)/)) {
      if (!tok) continue;
      if (/^(while|if|else)$/.test(tok)) row.append(h('span', { class: 'kw' }, tok));
      else if (/^\d+$/.test(tok)) row.append(h('span', { class: 'nm' }, tok));
      else if (tok === ':=') row.append(h('span', { class: 'op' }, tok));
      else row.append(tok);
    }
    lines.push(row);
    pre.append(row, '\n');
  });
  return { el: pre, lines };
}

/** Light up the lines the walker is running: the while line while it checks, the body lines while it steps. */
export function follow(view: CodeView, b: PlayInfo): void {
  // After the last check the while line stays lit (false): the loop is over.
  if (b.kind === 'exit' || b.kind === 'more' || b.kind === 'cut') return;
  for (const l of view.lines) l.classList.remove('run', 'check-yes', 'check-no');
  if (b.kind === 'guard') {
    const l = view.lines[b.lines[0] ?? -1];
    l?.classList.add('run', b.holds ? 'check-yes' : 'check-no');
  } else if (b.kind === 'step') {
    for (const i of b.lines) view.lines[i]?.classList.add('run');
  }
}
