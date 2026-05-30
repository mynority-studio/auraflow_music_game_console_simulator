// ============================================================
// Phase 8 对照 harness — Transform(变换装饰)
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/phase8-transform.ts
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseVocab, parseScales, setActiveVocab, setActiveScales } from '../vocab';
import { ChordPart } from '../chordpart';
import { Grammar } from '../grammar';
import { realize, type SlotNote } from '../lickgen';
import { parseTransform, applyTransform } from '../transform';

const here = dirname(fileURLToPath(import.meta.url));
const voc = readFileSync(join(here, '../vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(voc));
setActiveScales(parseScales(voc));
const transDir = join(here, '../transforms');

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? '\n      ' + d : ''}`); } };
const totalDur = (m: SlotNote[]) => m.reduce((s, n) => s + n.durationSlots, 0);

// ------------------------------------------------------------
// (1) 确定性:手写 transform,每非休止音升 diatonic 三度(C→E over CM7)
// ------------------------------------------------------------
console.log('— 确定性 transpose-diatonic —');
{
    const subs = parseTransform(`
(substitution (name up3)(type embellishment)(enabled true)(weight 1)
  (transformation (weight 1)(enabled true)
    (source-notes n1)
    (guard-condition (not (rest? n1)))
    (target-notes (transpose-diatonic 3 n1))))`);
    const cp = ChordPart.fromTokens(['CM7']);
    const melody: SlotNote[] = [60, 64, 67, 71].map((p, i) => ({ pitch: p, startSlot: i * 120, durationSlots: 120 }));
    const out = applyTransform(melody, cp, subs);
    // C→E, E→G, G→B, B→D(+oct)。over CM7: 1→3,3→5,5→7,7→2(9度)
    ok('每音升 diatonic 三度:[60,64,67,71]→[64,67,71,74]', JSON.stringify(out.map(n => n.pitch)) === JSON.stringify([64, 67, 71, 74]),
        `got ${JSON.stringify(out.map(n => n.pitch))}`);
    ok('保时值', totalDur(out) === totalDur(melody));
}

// ------------------------------------------------------------
// (2) 解析真实 .transform
// ------------------------------------------------------------
console.log('\n— 解析真实 .transform —');
{
    const subs = parseTransform(readFileSync(join(transDir, 'My.transform'), 'utf8'));
    ok('My.transform 解析出 substitution', subs.length > 0, `subs=${subs.length}`);
    ok('每 sub 有 rules', subs.every(s => s.rules.length > 0));
}

// ------------------------------------------------------------
// (3) 应用真实 transform 到生成的 solo:保时值 + 输出合法 + 确有改写
// ------------------------------------------------------------
console.log('\n— 应用到 solo(保时值 / 合法 / 有改写)—');
{
    const cp = ChordPart.fromTokens(['CM7', 'Am7', 'Dm7', 'G7']);
    const g = Grammar.fromText(readFileSync(join(here, '../../data/grammars/CharlieParker.grammar'), 'utf8'));
    const files = readdirSync(transDir).filter(f => f.endsWith('.transform'));

    let durPreserved = true, allValid = true, anyChanged = false, errors = 0;
    for (const f of files) {
        const subs = parseTransform(readFileSync(join(transDir, f), 'utf8'));
        for (let i = 0; i < 5; i++) {
            const melody = realize(g.run(cp.getTotalSlots()), cp);
            try {
                const out = applyTransform(melody, cp, subs);
                if (totalDur(out) !== totalDur(melody)) durPreserved = false;
                if (out.some(n => n.pitch >= 0 && (n.pitch < 0 || n.pitch > 127))) allValid = false;
                if (out.length !== melody.length) anyChanged = true;
            } catch { errors++; }
        }
    }
    ok('全 6 transform 应用无抛错', errors === 0, `errors=${errors}`);
    ok('保时值(应用后总时值不变)', durPreserved);
    ok('输出 MIDI 合法', allValid);
    ok('确有 transform 触发改写(音数变化)', anyChanged);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
