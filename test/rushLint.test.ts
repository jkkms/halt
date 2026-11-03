// The clumsy-code lint of the rush cards (test/rushLint.ts) and the loop shape that keeps level loops out of rush
// (test/rushCanon.ts loopShape): what they flag and what they leave alone.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, TUTORIAL_PROGRAMS } from '../src/core/levels.ts';
import { loopShape } from './rushCanon.ts';
import { lintCard, lintText } from './rushLint.ts';

const w = (guard: string, ...body: string[]) => `while (${guard}) {\n${body.map((l) => `  ${l}`).join('\n')}\n}`;
const rules = (code: string, start = 'true') => lintCard(code, start).map((p) => p.rule);
const flags = (code: string, rule: string, start = 'true') => assert.ok(rules(code, start).includes(rule), `${code.replace(/\s+/g, ' ')} | ${start}: ${lintText(lintCard(code, start)) || 'nothing'}`);
const clean = (code: string, start = 'true') => assert.deepEqual(lintCard(code, start), [], `${code.replace(/\s+/g, ' ')} | ${start}`);

describe('rush lint: clumsy code', () => {
  it('two constants that fold: k + 2 - 5, x - 3 + 2, 2 + x - 1, x * 2 * 3, 10 - 4, min(2, 5), x * 6 / 2', () => {
    flags(w('k > 0', 'k := k + 2 - 5'), 'constants that fold');
    flags(w('x > 0', 'x := x - 3 + 2'), 'constants that fold');
    flags(w('x < 9', 'x := 2 + x - 1'), 'constants that fold');
    flags(w('x < 99', 'x := x * 2 * 3'), 'constants that fold');
    flags(w('x < 99', 'x := 2 * x * 3'), 'constants that fold');
    flags(w('x < 9', 'x := 10 - 4'), 'constants that fold');
    flags(w('x < 9', 'x := min(2, 5)'), 'constants that fold');
    flags(w('x < 99', 'x := x * 6 / 2'), 'constants that fold');
    flags(w('x + 1 > 5', 'x := x - 1'), 'constants that fold across the comparison');
    flags(w('2 * x != 10', 'x := x + 1'), 'constants that fold across the comparison');
  });

  it('negative constants and double negation: x - (-3), x + -3, - -3, --x, -(-x), !!c', () => {
    flags(w('x < 9', 'x := x - (-3)'), 'adds or takes away a negative constant');
    flags(w('x < 9', 'x := x - (-3)'), 'double negation');
    flags(w('x < 9', 'x := x + -3'), 'adds or takes away a negative constant');
    flags(w('x < 9', 'x := - -3'), 'double negation');
    flags(w('x < 9', 'x := --x'), 'double negation');
    flags(w('x < 9', 'x := -(-x)'), 'double negation');
    flags(w('!!(x < 9)', 'x := x + 1'), 'double negation');
  });

  it('operations that do nothing: x * 1, 1 * x, x + 0, 0 + x, x - 0, x / 1, x % 1, x := x, min(x, x)', () => {
    flags(w('x < 9', 'x := x * 1'), 'multiplies by 1');
    flags(w('x < 9', 'x := 1 * x'), 'multiplies by 1');
    flags(w('x < 9', 'x := x + 0'), 'adds or takes away 0');
    flags(w('x < 9', 'x := 0 + x'), 'adds or takes away 0');
    flags(w('x < 9', 'x := x - 0'), 'adds or takes away 0');
    flags(w('x < 9', 'x := x / 1'), 'divides by 1');
    flags(w('x < 9', 'x := x % 1'), 'x % 1 is 0');
    flags(w('x < 9', 'x := x'), 'x := x does nothing');
    flags(w('x < 9', 'x := min(x, x)'), 'min(x, x) is x');
    flags(w('x < 9', 'x := x * -1'), 'multiplies by -1 (write -x)');
    flags(w('x < 9', 'x := 0 - x'), '0 - x is -x');
    flags(w('x < 9', 'x := 3 + x'), 'constant before + (write x + 3)');
    flags(w('x < 9', 'x := x - x'), 'x - x is 0');
  });

  it('redundant parentheses (but not the ones the code needs)', () => {
    flags(w('x > 0', 'x := (x - 1)'), 'redundant parentheses');
    flags(w('(x > 0)', 'x := x - 1'), 'redundant parentheses');
    flags(w('x > 0', 'x := (x * 2) + 1'), 'redundant parentheses');
    flags(w('x > 0', 'x := (x) / 2'), 'redundant parentheses');
    flags(w('x > 0', 'x := x / 2'), 'redundant parentheses', '(x >= 1)');
    clean(w('x != 3', 'x := (x + 1) % 5'));
    clean(w('x > 0', 'x := x - (y - 1)'), 'y >= 2');
    clean(w('abs(x) > 3', 'x := min(x, 2)'));
  });

  it('! in front of a comparison: write the opposite comparison', () => {
    flags(w('!(x > 3)', 'x := x + 1'), '! in front of a comparison');
    flags(w('!(x == 3)', 'x := x + 1'), '! in front of a comparison');
  });

  it('conditions that are constant by sight, parts that never matter, branches that do the same', () => {
    flags(w('true', 'x := x + 1'), 'constant condition');
    flags(w('1 > 0', 'x := x + 1'), 'constant condition');
    flags(w('x == x', 'x := x + 1'), 'compares a thing with itself');
    flags(w('x * x >= 0', 'x := x + 1'), 'condition that is always true or always false');
    flags(w('abs(x) < 0', 'x := x + 1'), 'condition that is always true or always false');
    flags(w('x % 5 < 5', 'x := x + 1'), 'condition that is always true or always false');
    flags(w('x > 0 && x % 7 > 6', 'x := x + 1'), 'condition that is always true or always false');
    flags(w('x % 2 == 0 || x != 0', 'x := x / 2'), 'condition that is always true or always false');
    flags(w('x > 3 || x < 5', 'x := x - 1'), 'condition that is always true or always false');
    flags(w('x > 3 && x > 5', 'x := x - 1'), 'a part of the condition that never matters');
    flags(w('x > 3 || x == 5', 'x := x - 1'), 'a part of the condition that never matters');
    flags(w('x != 3', 'if (x > 3) { x := 1 }', 'else { x := 1 }'), 'both branches do the same');
    flags(w('x != 3', 'if (x >= x) { x := 1 }', 'else { x := 2 }'), 'compares a thing with itself');
    flags(w('x > 0', 'x := x - 1'), 'condition that is always true or always false', 'x * x >= 0');
    flags(w('x > 0', 'x := 3', 'x := 4'), 'a value overwritten before it is read');
  });

  it('leaves code a person writes alone', () => {
    clean(w('x * x < 50', 'x := x + 1'));
    clean(w('x != 0', 'x := x * 2'));
    clean(w('x < 10', 'x := 10 - x'));
    clean(w('x < 10', 'x := x * 2 + 1'));
    clean(w('x > 2', 'x := x - x / 2'));
    clean(w('x % 3 != 0', 'x := x + 1'));
    clean(w('a != b', 't := a', 'a := b', 'b := t'));
    clean(w('x > 0 || y > 0', 'x := x - 1', 'y := y + 1'));
    clean(w('x > 0 && y > 0', 'x := x - 1', 'y := y + 1'));
    clean(w('x != 3', 'if (x > 3) { x := x - 1 }', 'else { x := 10 }'));
    clean(w('s != 7', 's := min(s + 1, 7)'));
    clean(w('n > 0', 's := s + n % 10', 'n := n / 10'));
    clean(w('x > -1', 'x := x / 2'));
    clean(w('x < y', 'x := x * y'), 'x >= 1 && y >= 2');
    clean(w('x < 9', 'x := -x'));
    clean(w('x > 0', 'x := x - y'), '0 <= y && y <= 5');
    clean(w('(y - x) % 2 != 0', 'x := x + 1', 'y := y - 1'));
  });
});

describe('loop shape: a level loop with other names and constants', () => {
  const level = (id: number) => loopShape(LEVELS.find((l) => l.id === id)!.code);

  it('renames variables and replaces constants', () => {
    assert.equal(loopShape(w('x > 0', 'x := x - 3')), level(1));
    assert.equal(loopShape(w('k > 7', 'k := k - 1')), level(1));
    assert.equal(loopShape(w('lo < hi', 'lo := lo + 2', 'hi := hi - 1')), level(3));
    assert.equal(loopShape(w('i != n', 'i := i + 3')), level(9));
    assert.equal(loopShape(w('a > 0', 'a := 5 - a')), level(15));
    assert.equal(loopShape(w('q != 2', 'q := q + 5')), loopShape(TUTORIAL_PROGRAMS.grow.code));
  });

  it('sees through trivially equivalent guards: 0 < n, n >= 1, !(n <= 0), a < b as b > a', () => {
    assert.equal(loopShape(w('0 < n', 'n := n - 1')), level(1));
    assert.equal(loopShape(w('n >= 1', 'n := n - 2')), level(1));
    assert.equal(loopShape(w('!(n <= 0)', 'n := n - 1')), level(1));
    assert.equal(loopShape(w('y > x', 'x := x + 1', 'y := y + 2')), level(5));
    assert.equal(loopShape(w('b > a', 'b := b + 1', 'a := a + 1')), level(5), 'independent lines in either order');
    assert.equal(loopShape(w('x != 2', 'if (x < 2) { x := x + 1 }', 'else { x := x - 1 }')), level(6), 'if/else the other way round');
    assert.equal(loopShape(w('x > 0', 'x := x - z')), level(16));
    assert.equal(loopShape(w('k <= m', 'k := k + 2')), level(2), 'i <= n is i < n one off');
    assert.equal(loopShape(w('n >= k', 'k := k + 1')), level(2));
  });

  it('keeps different loops apart', () => {
    assert.notEqual(loopShape(w('x > 0', 'x := x + 3')), level(1));
    assert.notEqual(loopShape(w('x != 0', 'x := x - 3')), level(1));
    assert.notEqual(loopShape(w('x > 0', 'x := x / 2')), level(1));
    assert.notEqual(loopShape(w('x > y', 'x := x - 3')), level(1));
    assert.notEqual(loopShape(w('x > 0', 'x := x - 1', 'y := y + 1')), level(1));
    assert.notEqual(loopShape(w('x < y', 'x := x + 1', 'y := y - 1')), level(5));
    assert.notEqual(loopShape(w('x != 2', 'if (x > 2) { x := x - 1 }', 'else { x := 9 }')), level(6));
  });
});
