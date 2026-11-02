import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { answerLength, ExprError, parseCond, parseIntLiteral, parseRank, parseRaw, show, typeOf } from '../src/core/expr.ts';
import { levelById, LEVELS } from '../src/core/levels.ts';
import { parseR, parseV, parseZ } from '../src/core/game.ts';
import { parseProgram } from '../src/core/program.ts';

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ExprError) return e.code;
    throw e;
  }
  return 'ok';
};

describe('parser: precedence and printing', () => {
  const cases: [string, string][] = [
    ['a+b*c', 'a + b * c'],
    ['(a+b)*c', '(a + b) * c'],
    ['a-(b-c)', 'a - (b - c)'],
    ['a-b-c', 'a - b - c'],
    ['-x % 3', '-x % 3'],
    ['- -x', '--x'],
    ['abs(x-1)', 'abs(x - 1)'],
    ['min(a, max(b, 3))', 'min(a, max(b, 3))'],
    ['a < b && b <= c || !(x == 0)', 'a < b && b <= c || !(x == 0)'],
    ['!(a > 0 && b > 0)', '!(a > 0 && b > 0)'],
    ['(x, y)', '(x, y)'],
    ['i ≤ n', 'i <= n'],
    ['x ≠ 0 ∧ y ≥ 1', 'x != 0 && y >= 1'],
    ['3−x', '3 - x'],
    ['x % 2 == 1', 'x % 2 == 1'],
  ];
  for (const [src, want] of cases) {
    it(`${src} -> ${want}`, () => {
      const e = parseRaw(src);
      assert.equal(show(e), want);
      // printing is stable: parse(show(e)) prints the same
      assert.equal(show(parseRaw(show(e))), want);
    });
  }

  it('! binds looser than comparison, tighter than &&', () => {
    const e = parseRaw('!x == 0 && y > 0');
    assert.equal(e.k, 'and');
    assert.equal(typeOf(e), 'bool');
  });

  it('negative literals fold', () => {
    const e = parseRaw('-3');
    assert.equal(e.k, 'num');
  });
});

describe('parser: errors are specific', () => {
  const l1 = levelById(1);
  const l2 = levelById(2);
  const l4 = levelById(4);
  const l5 = levelById(5);
  const l10 = levelById(10);
  const cases: [string, () => unknown, string][] = [
    ['empty', () => parseV(l1, '  '), 'empty'],
    ['dangling operator', () => parseV(l1, 'n +'), 'unexpectedEnd'],
    ['missing close paren', () => parseV(l1, '(n + 1'), 'expectedEnd'],
    ['= instead of ==', () => parseZ(l1, 'n = 1'), 'assignEq'],
    ['2n', () => parseV(l1, '2n'), 'implicitMul'],
    ['chained comparison', () => parseZ(l2, 'i < n < 5'), 'chainedCmp'],
    ['unknown function', () => parseV(l1, 'sqrt(n)'), 'unknownFn'],
    ['arity', () => parseV(l1, 'abs(n, 1)'), 'arity'],
    ['unknown variable', () => parseV(l1, 'k'), 'unknownVar'],
    ['local variable', () => parseV(l4, 'hi - mid'), 'localVar'],
    ['tuple before level 10', () => parseV(l5, '(n, i)'), 'tupleLocked'],
    ['tuple inside expression', () => parseV(l10, '(x, y) + 1'), 'tupleHere'],
    ['condition as steps left', () => parseV(l1, 'n > 0'), 'rankIsCond'],
    ['number as zone', () => parseZ(l1, 'n'), 'condIsNum'],
    ['and as a word', () => parseZ(l2, 'i < n and n > 0'), 'wordOp'],
    ['single &', () => parseZ(l2, 'i < n & n > 0'), 'singleAmp'],
    ['bad character', () => parseV(l1, 'n # 2'), 'badChar'],
    ['missing operator', () => parseV(l2, 'n i'), 'missingOp'],
    ['bare tuple', () => parseV(l10, 'x, y'), 'bareTuple'],
    ['int where bool needed', () => parseZ(l2, 'i && n > 0'), 'wantBool'],
    ['bool where int needed', () => parseV(l2, 'abs(i < n)'), 'wantInt'],
  ];
  for (const [name, f, want] of cases) it(name, () => assert.equal(code(f), want));

  it('railing is ignored before level 7 and parsed from level 7 (v0.4)', () => {
    assert.equal(parseR(levelById(6), 'x > 0'), null);
    assert.ok(parseR(levelById(7), 'a >= 1 && b >= 1'));
    assert.ok(parseR(levelById(9), 'i <= n'));
    assert.equal(parseR(levelById(9), ''), null);
  });

  it('tuples are allowed from level 10', () => {
    assert.equal(parseV(l10, '(x,y)').k, 'tuple');
    assert.equal(code(() => parseV(levelById(9), '(n,i)')), 'tupleLocked');
  });

  it('error positions point at the problem', () => {
    try {
      parseRank('n + k', { vars: ['n'] }, false);
      assert.fail('should throw');
    } catch (e) {
      assert.ok(e instanceof ExprError);
      assert.equal(e.pos, 4);
      assert.equal(e.args.name, 'k');
    }
  });

  it('conditions parse with all operators', () => {
    const e = parseCond('!(a == b) || a != b && a < b || a <= b || a > b || a >= b', { vars: ['a', 'b'] });
    assert.equal(typeOf(e), 'bool');
  });
});

describe('answer length and start values', () => {
  it('length counts non-space characters', () => {
    assert.equal(answerLength(' n - i '), 3);
    assert.equal(answerLength('(x, y)'), 5);
    assert.equal(answerLength('abs(x)'), 6);
    assert.equal(answerLength('i <= n'), 4);
  });
  it('start values are integer literals', () => {
    assert.equal(parseIntLiteral(' -3 '), -3n);
    assert.equal(parseIntLiteral('+7'), 7n);
    assert.equal(parseIntLiteral('−2'), -2n);
    assert.equal(code(() => parseIntLiteral('3.5')), 'notInteger');
    assert.equal(code(() => parseIntLiteral('')), 'emptyValue');
    assert.equal(code(() => parseIntLiteral('1e3')), 'notInteger');
    assert.equal(code(() => parseIntLiteral('1234567890123456')), 'tooBig');
  });
});

describe('level programs', () => {
  it('all 18 levels compile, in campaign order', () => {
    assert.deepEqual(
      LEVELS.map((l) => l.id),
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
  });
  it('locals are recognised', () => {
    assert.deepEqual(levelById(4).locals, ['mid']);
    assert.deepEqual(levelById(12).locals, ['mid']);
    assert.deepEqual(levelById(14).locals, ['r']);
    assert.deepEqual(levelById(2).vars, ['n', 'i']);
    assert.deepEqual(levelById(13).vars, ['a', 'b', 'c', 'd']);
  });
  it('else-if chains give one branch per arm', () => {
    assert.equal(levelById(13).branches.length, 4);
    assert.equal(levelById(4).branches.length, 2);
    assert.equal(levelById(1).branches.length, 1);
  });
  it('program parse errors are reported', () => {
    assert.equal(code(() => parseProgram('while (x > 0) { x := }')), 'unexpected');
    assert.equal(code(() => parseProgram('while (x > 0) { x = 1 }')), 'assignEq');
    assert.equal(code(() => parseProgram('while (x > 0) { x := 1 ')), 'unexpectedEnd');
  });
  it('kinds and par match the spec', () => {
    const kinds = LEVELS.map((l) => l.kind[0]).join('');
    assert.equal(kinds, 'eeeeneeneeeneeeeno');
    assert.deepEqual(
      LEVELS.filter((l) => l.kind === 'ends').map((l) => [l.id, l.par]),
      [
        [1, 1],
        [2, 3],
        [3, 5],
        [4, 5],
        [6, 6],
        [7, 13],
        [9, 7],
        [10, 5],
        [11, 15],
        [13, 9],
        [14, 1],
        [15, 1],
        [16, 5],
      ],
    );
  });
});
