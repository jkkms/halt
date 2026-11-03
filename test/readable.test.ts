// Readable texts (SPEC_v0.7 §B): `\n` breaks a line and `\n\n` a paragraph, with the markup still working; a bold
// lead stands on its own line; ①, ②, ③ start lines (with a hanging indent); paragraphs are short. Checked on every
// text of the tutorial, the intros, the level-screen tours and the rush explanation. Also the focus choices §C fixed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, levelById } from '../src/core/levels.ts';
import { TOUR_IDS, tourFor } from '../src/core/tours.ts';
import { focusOf, INTROS, leadOf, plainText, richBlocks, TUTORIAL } from '../src/core/tutorial.ts';
import { tables } from '../src/ui/i18n.ts';

/** Every long text of the game, with where it is. */
function allTexts(): [string, string][] {
  const out: [string, string][] = [];
  for (const L of ['ko', 'en'] as const) {
    TUTORIAL.forEach((p, i) => out.push([`tutorial ${i + 1} ${L}`, p.text[L]]));
    for (const intro of Object.values(INTROS)) intro.pages.forEach((p, i) => out.push([`intro ${intro.level}/${i + 1} ${L}`, p.text[L]]));
    for (const id of TOUR_IDS)
      for (const l of [LEVELS[0]!, levelById(7)]) tourFor(id, l).steps.forEach((s, i) => out.push([`tour ${id} ${i + 1} (level ${l.id}) ${L}`, s.text[L]]));
    const T = tables()[L];
    for (const k of ['rushAboutWhat', 'rushAboutRule', 'rushAboutTiers', 'rushAboutScore', 'rushAboutFame'] as const) out.push([`rush ${k} ${L}`, T[k]]);
  }
  return out;
}

const lineText = (parts: { s: string }[]) => parts.map((p) => p.s).join('');
/** Sentence ends in plain text: . ! ? at the end or before a word that starts a sentence ("flat step! or" is a label). */
const sentences = (s: string) => (s.match(/[.?!](?=\s+[A-Z가-힣0-9①-⑳'"(`*★]|$)/g) ?? []).length;

describe('narration blocks', () => {
  it('\\n breaks a line, \\n\\n a paragraph; markup works on every line', () => {
    const b = richBlocks('**Lead.**\nBody `x` here.\n\n① **one**: a\n② two\n- three');
    assert.equal(b.length, 2);
    assert.deepEqual(
      b[0]!.map((l) => l.parts),
      [
        [{ kind: 'bold', s: 'Lead.' }],
        [
          { kind: 'text', s: 'Body ' },
          { kind: 'code', s: 'x' },
          { kind: 'text', s: ' here.' },
        ],
      ],
    );
    assert.deepEqual(
      b[1]!.map((l) => [l.list, lineText(l.parts)]),
      [
        [true, '① one: a'],
        [true, '② two'],
        [true, '- three'],
      ],
    );
    assert.equal(b[0]![0]!.list, false);
  });

  it('a text without breaks is one paragraph of one line; empty lines and spaces at the ends go', () => {
    assert.deepEqual(richBlocks('a b'), [[{ list: false, parts: [{ kind: 'text', s: 'a b' }] }]]);
    assert.deepEqual(richBlocks('a \n\n\n b\n\n'), [[{ list: false, parts: [{ kind: 'text', s: 'a' }] }], [{ list: false, parts: [{ kind: 'text', s: 'b' }] }]]);
    assert.deepEqual(richBlocks(''), []);
  });

  it('a bold lead is a bold opening that is a sentence or a heading of its own', () => {
    assert.equal(leadOf('**Halt?에 오신 것을 환영해요!**\n이 게임은'), 'Halt?에 오신 것을 환영해요!');
    assert.equal(leadOf('**1단계 · 판정**\n먼저'), '1단계 · 판정');
    assert.equal(leadOf('**Step 1 · Verdict**: first'), 'Step 1 · Verdict');
    assert.equal(leadOf('**입력**은 시작할 때'), null);
    assert.equal(leadOf('그림 **걸음 0**'), null);
  });
});

describe('every long text reads well', () => {
  const texts = allTexts();

  it('a bold lead stands on its own line (the first line is the lead)', () => {
    let leads = 0;
    for (const [where, text] of texts) {
      const lead = leadOf(text);
      if (!lead) continue;
      leads++;
      const first = richBlocks(text)[0]![0]!;
      assert.equal(lineText(first.parts), lead, `${where}: the first line is “${lineText(first.parts)}”`);
      assert.ok(richBlocks(text).flat().length > 1, `${where}: a body follows the lead`);
    }
    // the tutorial's five leads and the verdict step of tour A, in both languages
    assert.equal(leads, 2 * (5 + 2));
  });

  it('every ①, ②, ③ that starts an item starts a line ((①) referring back is not an item)', () => {
    let items = 0;
    for (const [where, text] of texts)
      for (const line of richBlocks(text).flat()) {
        const s = lineText(line.parts);
        for (const m of s.matchAll(/[①②③]/g)) {
          if (m.index === 0) {
            items++;
            assert.ok(line.list, `${where}: a list line`);
          } else assert.equal(s[m.index! - 1], '(', `${where}: “${s}” has ${m[0]} inside a line`);
        }
      }
    assert.ok(items >= 2 * (2 + 3), `${items} items`);
  });

  it('paragraphs are short: at most 3 sentences besides the lead, a list item at most 3 of its own', () => {
    for (const [where, text] of texts) {
      const lead = leadOf(text);
      richBlocks(text).forEach((para, pi) => {
        const lines = para.filter((l, li) => !(pi === 0 && li === 0 && lead));
        const body = lines.filter((l) => !l.list).map((l) => lineText(l.parts));
        assert.ok(sentences(body.join(' ')) <= 3, `${where}, paragraph ${pi + 1}: ${body.join(' / ')}`);
        for (const l of lines.filter((x) => x.list)) assert.ok(sentences(lineText(l.parts)) <= 3, `${where}: ${lineText(l.parts)}`);
      });
    }
  });

  it('breaks only: the words are those of the texts with every break read as a space', () => {
    // spot checks against the v0.6 wording (SPEC_v0.6 §D), with the layout words the band made wrong removed
    const flat = (s: string) => plainText(s).replace(/\s*\n+\s*/g, ' ');
    assert.equal(
      flat(TUTORIAL[1]!.text.ko),
      "먼저 코드부터 보세요. 이번에 살펴볼 반복문이에요. 첫 줄 while (n > 0)은 'n이 0보다 큰 동안 안쪽을 되풀이하라'는 뜻이고, 안쪽 줄 n := n - 1은 'n을 1 줄여라'는 뜻이에요. 그러니 한 바퀴 돌 때마다 n이 1씩 줄어요. 이제 이 코드가 실행되는 모습을 건물 그림으로 하나씩 보여 드릴게요.",
    );
    assert.equal(
      flat(TUTORIAL[10]!.text.en),
      'It need not be the exact count. The judge (Z3) checks just two things. ① Does it go down every round? Each stair down must be lower. If it stays level or rises, that stair shows flat step! or step up! ② Is it above ground? While the loop keeps going, the height must be 0 or more. Below 0 you get a red below ground! stair. An expression that passes both is called a ranking function. If you submit a wrong one in a level, the judge finds one step that fails (a counterexample) and shows it in the picture.',
    );
    // layout-free: nothing points "below" at the piece, which now sits beside the text on a wide screen
    for (const i of [5, 8, 9]) {
      assert.ok(!/아래 버튼|아래의 \*\*|아래 칸/.test(TUTORIAL[i]!.text.ko), `page ${i + 1}`);
      assert.ok(!/\bbelow\.|below to|lights up below/.test(TUTORIAL[i]!.text.en), `page ${i + 1}`);
    }
  });

  it('the rush explanation breaks into lines and paragraphs too', () => {
    const { ko, en } = tables();
    assert.equal(richBlocks(ko.rushAboutRule).length, 2);
    assert.equal(richBlocks(ko.rushAboutRule)[0]!.length, 2);
    assert.equal(richBlocks(en.rushAboutScore).length, 2);
  });
});

describe('focus choices (SPEC_v0.7 §C)', () => {
  it('intro 10 page 1 points at the steps where the floor changes: the floor-change steps, then each up mark', () => {
    const p = INTROS[10]!.pages[0]!;
    assert.deepEqual(focusOf(p, 0), ['floorStep']);
    assert.deepEqual(focusOf(p, 1), ['mark']);
  });

  it('tutorial page 11 rings the marks of the shot on stage (each mark its own ring, drawn by the stage)', () => {
    assert.deepEqual(
      TUTORIAL[10]!.shots.map((_, i) => focusOf(TUTORIAL[10]!, i)),
      [['mark'], ['mark'], []],
    );
  });
});
