/**
 * 用"是否在父调音阶"做"是不是真跑调"判定。
 *
 * 原脚本用 chord-specific scale (Dorian for minor chords) 过严 — Em7 上的 C 算 outside。
 * 实际上 Em7 是 C 大调 iii,正确 chord-scale 是 Phrygian, C 是 b6 在 Phrygian 内。
 * 而且 C 是 C 大调音阶里的根音, 任何 C 大调曲子里 C 音都不"跑调"。
 *
 * 新分类:
 *   - chord tone
 *   - in parent key (diatonic to C major)  ← 这是 in-key 但跟当前 chord 多少有冲突
 *   - chromatic (跑出 C 大调音阶) ← 这才是潜在"跑调"
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { CHORD_INTERVALS, ChordQuality, ChordQualityName, Tonality } from '../src/core/generation/types';

const SEED = parseInt(process.argv[2] ?? '1226615747', 10);

function pcOf(midi: number): number { return ((midi % 12) + 12) % 12; }
function pcName(pc: number): string {
    return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][pc];
}

function getChordTones(rootPc: number, quality: ChordQuality): Set<number> {
    const intervals = CHORD_INTERVALS[quality] ?? [0, 4, 7];
    const out = new Set<number>();
    for (const iv of intervals) out.add(((rootPc + iv) % 12 + 12) % 12);
    return out;
}

// 父调音阶(mg 在 C 调下生成,即 RELATIVE 空间下父调 = C major / C minor)
function getParentKeyScale(tonality: Tonality): Set<number> {
    if (tonality === Tonality.Minor) return new Set([0, 2, 3, 5, 7, 8, 10]); // C natural minor
    return new Set([0, 2, 4, 5, 7, 9, 11]); // C major
}

PRNGManager.setSeed(SEED);
const { track, context } = runPipeline({});
const { chords, melody, tonality } = track;

const parentScale = getParentKeyScale(tonality);
console.log(`Style=${['ModernPop','ChillJazz','NeoSoul'][context.style?.id ?? 0]}, Tonality=${tonality === 0 ? 'Major' : 'Minor'}`);
console.log(`Parent key scale (RELATIVE space, C-based): {${[...parentScale].sort((a,b)=>a-b).map(pcName).join(',')}}`);

let chordTone = 0, parentKey = 0, chromatic = 0;
const chromaticExamples: any[] = [];

let chordIdx = 0;
for (const note of melody) {
    while (chordIdx < chords.length - 1 && note.onset >= chords[chordIdx + 1].startBeat - 0.0001) chordIdx++;
    const chord = chords[chordIdx];
    const rootPc = ((chord.root % 12) + 12) % 12;
    const tones = getChordTones(rootPc, chord.quality);
    const notePc = pcOf(note.pitch);
    if (tones.has(notePc)) chordTone++;
    else if (parentScale.has(notePc)) parentKey++;
    else {
        chromatic++;
        if (chromaticExamples.length < 15) {
            chromaticExamples.push({
                bar: Math.floor(note.onset / 4),
                beat: note.onset.toFixed(2),
                dur: note.duration.toFixed(2),
                vel: note.velocity.toFixed(2),
                chord: `${pcName(rootPc)}${ChordQualityName[chord.quality]}`,
                melodyPc: pcName(notePc),
                offsetFromRoot: ((notePc - rootPc) % 12 + 12) % 12,
            });
        }
    }
}

const total = chordTone + parentKey + chromatic;
console.log(`\nMelody note classification (${total} notes total):`);
console.log(`  Chord tone:    ${chordTone} (${(chordTone/total*100).toFixed(1)}%)  ← 完美对齐`);
console.log(`  In parent key: ${parentKey} (${(parentKey/total*100).toFixed(1)}%)  ← 跟 chord 不一致但在调内,正常`);
console.log(`  Chromatic:     ${chromatic} (${(chromatic/total*100).toFixed(1)}%)  ← 跑出父调音阶,潜在"真跑调"`);

if (chromaticExamples.length > 0) {
    console.log(`\nChromatic 示例:`);
    for (const ex of chromaticExamples) {
        console.log(`  bar${ex.bar.toString().padStart(2)} beat ${ex.beat.padStart(6)} dur=${ex.dur} vel=${ex.vel} | ${ex.chord.padEnd(12)} | melody pc=${ex.melodyPc} (offset ${ex.offsetFromRoot})`);
    }
}

// 同样对比 mg-direct path 做 baseline
console.log('\n\n=== Baseline:mg-direct seed=' + SEED + '::harmony,POP ===');
import('../src/core/generation/harmony-engine/musicEngine').then((mgMod) => {
    const mg = mgMod;
    const cfg: any = { seed: `${SEED}::harmony`, style: ['POP','JAZZ','RNB'][context.style?.id ?? 0], key: 'C', mode: tonality === 1 ? 'Minor' : 'Major', emotion: 'auto' };
    const eng = new mg.Engine(new mg.Random(cfg.seed));
    const directChords = eng.generateProgressions(cfg);
    const directMelody = eng.generateArrangement(directChords, cfg).events.filter((e: any) => e.part === 'melody');

    let directChordTone = 0, directParentKey = 0, directChromatic = 0;
    let chordIdx2 = 0;
    let cursor = 0;
    const chordStarts: number[] = [];
    for (const c of directChords) { chordStarts.push(cursor); cursor += c.duration; }

    for (const ev of directMelody) {
        while (chordIdx2 < directChords.length - 1 && ev.time >= chordStarts[chordIdx2 + 1] - 0.0001) chordIdx2++;
        const chord = directChords[chordIdx2];
        const rootPc = ((chord.rootMidi % 12) + 12) % 12;
        // Convert mg chord type to ChordQuality enum is non-trivial; use type-aware tones
        const mgIntervals = (mgMod as any).CHORD_TYPES?.[chord.type] ?? [0, 4, 7];
        const tones = new Set<number>();
        for (const iv of mgIntervals) tones.add(((rootPc + iv) % 12 + 12) % 12);
        const notePc = pcOf(ev.noteNumber);
        if (tones.has(notePc)) directChordTone++;
        else if (parentScale.has(notePc)) directParentKey++;
        else directChromatic++;
    }
    const directTotal = directChordTone + directParentKey + directChromatic;
    console.log(`Melody note classification (${directTotal} notes total):`);
    console.log(`  Chord tone:    ${directChordTone} (${(directChordTone/directTotal*100).toFixed(1)}%)`);
    console.log(`  In parent key: ${directParentKey} (${(directParentKey/directTotal*100).toFixed(1)}%)`);
    console.log(`  Chromatic:     ${directChromatic} (${(directChromatic/directTotal*100).toFixed(1)}%)`);
});
