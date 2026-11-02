// Parse errors in the player's language.
import type { ExprError } from '../core/expr.ts';
import { strings, t, type Key } from './i18n.ts';

export function errorText(e: ExprError): string {
  const key = `err_${e.code}`;
  const base = key in strings() ? t(key as Key, e.args) : e.code;
  return e.code === 'empty' || e.code === 'emptyValue' || e.code === 'notInteger' || e.code === 'tooBig' ? base : base + t('errAt', { n: e.pos + 1 });
}
