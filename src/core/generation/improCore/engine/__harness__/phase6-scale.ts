// ============================================================
// Phase 6 对照 harness — SCALE 音阶约束
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/phase6-scale.ts
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseVocab, parseScales, setActiveVocab, setActiveScales, getScalePCs } from '../vocab';
import { Chord } from '../chord';
import { ChordPart } from '../chordpart';
import { Grammar } from '../grammar';
import { realize, type SlotNote } from '../lickgen';
import { getExpectancy, scoreMelody, pickBest } from '../expectancy';

const here = dirname(fileURLToPath(import.meta.url));
const voc = readFileSync(join(here, '../vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(voc));
setActiveScales(parseScales(voc));

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? '\n      ' + d : ''}`); } };
const sortedEq = (a: number[], b: number[]) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

console.log('— 音阶解析 —');
ok('major = [0,2,4,5,7,9,11]', sortedEq(getScalePCs('major') ?? [], [0, 2, 4, 5, 7, 9, 11]), JSON.stringify(getScalePCs('major')));
ok('mixolydian = [0,2,4,5,7,9,10]', sortedEq(getScalePCs('mixolydian') ?? [], [0, 2, 4, 5, 7, 9, 10]));
ok('dominant(=mixolydian 别名)解析到 = mixolydian', sortedEq(getScalePCs('dominant') ?? [], getScalePCs('mixolydian') ?? [99]));

console.log('\n— 和弦首音阶(按 root 移调)—');
ok('CM7 首音阶 = C major', sortedEq(Chord.makeChord('CM7')!.getFirstScalePCs() ?? [], [0, 2, 4, 5, 7, 9, 11]),
    JSON.stringify(Chord.makeChord('CM7')!.getFirstScalePCs()));
ok('Amaj7 首音阶 = A major [9,11,1,2,4,6,8]', sortedEq(Chord.makeChord('Amaj7')!.getFirstScalePCs() ?? [], [9, 11, 1, 2, 4, 6, 8]),
    JSON.stringify(Chord.makeChord('Amaj7')!.getFirstScalePCs()));

console.log('\n— S8 音吸附到和弦音阶 —');
{
    const cp = ChordPart.fromTokens(['CM7']);
    const g = Grammar.fromText('(startsymbol P)\n(rule (P Y) (S8 (P (- Y 60))) 1.0)');
    const cmajor = new Set([0, 2, 4, 5, 7, 9, 11]);
    let allInScale = true, n = 0;
    for (let i = 0; i < 30; i++) {
        for (const note of realize(g.run(480), cp)) {
            if (note.pitch < 0) continue;
            n++;
            if (!cmajor.has(((note.pitch % 12) + 12) % 12)) allInScale = false;
        }
    }
    ok(`S8 over CM7 全在 C major 音阶(×30 次,${n} 音)`, allInScale && n > 0);

    // Amaj7:S8 应吸附 A major(含 C#/F#/G#)
    const cpA = ChordPart.fromTokens(['Amaj7']);
    const amajor = new Set([9, 11, 1, 2, 4, 6, 8]);
    let aOK = true;
    for (let i = 0; i < 30; i++) for (const note of realize(g.run(480), cpA)) if (note.pitch >= 0 && !amajor.has(((note.pitch % 12) + 12) % 12)) aOK = false;
    ok('S8 over Amaj7 全在 A major 音阶', aOK);
}

console.log('\n— Expectancy 评分 + 择优 —');
{
    const cm7 = Chord.makeChord('CM7')!;
    // 同样的前两音下,和弦根音(C=60)的期待应 > 外音(C#=61)
    const eChord = getExpectancy(60, 62, 64, cm7);  // stability 6
    const eOut = getExpectancy(61, 62, 64, cm7);    // stability 1
    ok('和弦音期待 > 外音', eChord > eOut, `chord=${eChord.toFixed(1)} out=${eOut.toFixed(1)}`);

    // pickBest:平滑和弦音旋律 vs 大跳外音旋律 → 选前者
    const cp = ChordPart.fromTokens(['CM7']);
    const smooth: SlotNote[] = [60, 62, 64, 65, 64, 62].map((p, i) => ({ pitch: p, startSlot: i * 60, durationSlots: 60 }));
    const jumpy: SlotNote[] = [61, 78, 49, 80, 51, 79].map((p, i) => ({ pitch: p, startSlot: i * 60, durationSlots: 60 }));
    ok('scoreMelody(平滑) > scoreMelody(大跳外音)', scoreMelody(smooth, cp) > scoreMelody(jumpy, cp),
        `smooth=${scoreMelody(smooth, cp).toFixed(1)} jumpy=${scoreMelody(jumpy, cp).toFixed(1)}`);
    ok('pickBest 选平滑那条', pickBest([jumpy, smooth, jumpy], cp) === smooth);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
