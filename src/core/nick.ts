// Nicknames for the rush hall of fame (SPEC_rush2 §E). The same rules run in the game and on the score server.

export const NICK_MIN = 2;
export const NICK_MAX = 12;

/** Hangul (syllables and jamo), Latin letters, digits, space, `_` and `-`. */
const ALLOWED = /^[\p{Script=Hangul}A-Za-z0-9 _-]+$/u;

/**
 * Words a nickname may not contain (checked on the lower-cased name with spaces, `_` and `-` removed).
 * Kept short on purpose: obvious slurs and profanity in Korean and English.
 */
const BLOCKED = [
  // English
  'fuck',
  'fuk',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'whore',
  'slut',
  'dick',
  'pussy',
  'asshole',
  'bastard',
  'nazi',
  'hitler',
  'porn',
  // Korean
  '씨발',
  '시발',
  '씨빨',
  '십새',
  'ㅅㅂ',
  'ㅆㅂ',
  '병신',
  'ㅂㅅ',
  'ㅄ',
  '븅신',
  '좆',
  'ㅈ같',
  '존나',
  '졸라',
  '개새',
  '새끼',
  'ㅅㄲ',
  '지랄',
  'ㅈㄹ',
  '염병',
  '썅',
  '니애미',
  '느금',
  '애미',
  '애비',
  '미친놈',
  '미친년',
  '창녀',
  '보지',
  '자지',
  '섹스',
  '틀딱',
  '한남충',
  '김치녀',
  '짱깨',
  '쪽바리',
  '장애새',
  'ㅗ',
];

/** Trimmed, NFC, runs of spaces as one. */
export function normalizeNick(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** The key that makes two nicknames the same one (Latin letters ignore case). */
export function nickKey(raw: string): string {
  return normalizeNick(raw).toLowerCase();
}

export type NickProblem = 'length' | 'chars' | 'blocked';

export function checkNick(raw: unknown): { ok: true; nick: string; key: string } | { ok: false; problem: NickProblem } {
  if (typeof raw !== 'string') return { ok: false, problem: 'chars' };
  const nick = normalizeNick(raw);
  const len = [...nick].length;
  if (len < NICK_MIN || len > NICK_MAX) return { ok: false, problem: 'length' };
  if (!ALLOWED.test(nick)) return { ok: false, problem: 'chars' };
  const squashed = nick.toLowerCase().replace(/[\s_-]/g, '');
  if (BLOCKED.some((w) => squashed.includes(w))) return { ok: false, problem: 'blocked' };
  return { ok: true, nick, key: nick.toLowerCase() };
}
