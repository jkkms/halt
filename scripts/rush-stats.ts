// Numbers of the rush card bank: size, tiers, hand-written and generated cards, lookalike pairs, cards per family
// (= per template of the generator), clumsy code (test/rushLint.ts) and loops of a level or tutorial program
// (test/rushCanon.ts loopShape). Read-only.
//
//   node scripts/rush-stats.ts            (add --list to print every flagged card)

import { RUSH_CARDS, type RushCard } from '../src/core/rushCards.ts';
import { forbiddenPrograms, loopShape } from '../test/rushCanon.ts';
import { lintCard, lintText } from '../test/rushLint.ts';

const list = process.argv.includes('--list');
const cards = RUSH_CARDS;
const hand = cards.filter((c) => c.id < 1001);
const tiers = [1, 2, 3].map((t) => cards.filter((c) => c.tier === t).length);
console.log(`total ${cards.length} (${hand.length} by hand + ${cards.length - hand.length} generated)`);
console.log(`tiers ${tiers.join(' / ')}`);
const ends = cards.filter((c) => c.verdict === 'ends').length;
console.log(`verdicts: ends ${ends}, never ${cards.length - ends}`);

const groups = new Map<string, RushCard[]>();
for (const c of cards) if (c.pair) groups.set(c.pair, [...(groups.get(c.pair) ?? []), c]);
let pairs = 0;
let sameCode = 0;
for (const g of groups.values())
  for (const a of g)
    for (const b of g)
      if (a.verdict === 'ends' && b.verdict === 'never') {
        pairs++;
        if (a.code === b.code) sameCode++;
      }
const sizes = new Map<number, number>();
for (const g of groups.values()) sizes.set(g.length, (sizes.get(g.length) ?? 0) + 1);
console.log(`pair groups ${groups.size} (${[...sizes].sort().map(([n, k]) => `${k} of ${n} cards`).join(', ')}); opposite-verdict two-card pairs ${pairs}; same code, different input ${sameCode}`);
console.log(`cards in a pair group: ${cards.filter((c) => c.pair).length}`);

const fam = new Map<string, RushCard[]>();
for (const c of cards) fam.set(c.family, [...(fam.get(c.family) ?? []), c]);
console.log(`families (templates): ${fam.size}`);
for (const [name, cs] of [...fam].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))) {
  const t = [1, 2, 3].map((k) => cs.filter((c) => c.tier === k).length);
  const e = cs.filter((c) => c.verdict === 'ends').length;
  console.log(`  ${name.padEnd(10)} ${String(cs.length).padStart(3)}  tiers ${t.join('/')}  ends ${e} never ${cs.length - e}`);
}

let lintBad = 0;
for (const c of cards) {
  const ps = lintCard(c.code, c.start);
  if (ps.length) {
    lintBad++;
    if (list) console.log(`lint ${c.id} (${c.family}): ${c.code.replace(/\s+/g, ' ')} | ${c.start} → ${lintText(ps)}`);
  }
}
console.log(`lint violations: ${lintBad} cards`);

const forbidden = forbiddenPrograms().map(([name, code]) => [name, loopShape(code)] as const);
const dupBy = new Map<string, number>();
let dups = 0;
for (const c of cards) {
  const s = loopShape(c.code);
  const hit = forbidden.filter(([, f]) => f === s).map(([name]) => name);
  if (hit.length) {
    dups++;
    for (const h of hit) dupBy.set(h, (dupBy.get(h) ?? 0) + 1);
    if (list) console.log(`level loop ${c.id} (${c.family}): ${c.code.replace(/\s+/g, ' ')} = ${hit.join(', ')}`);
  }
}
console.log(`level/tutorial loops: ${dups} cards${dups ? ` (${[...dupBy].map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}`);
