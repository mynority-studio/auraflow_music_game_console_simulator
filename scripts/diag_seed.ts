// 诊断 seed 的调性一致性
// 用法：npx tsx scripts/diag_seed.ts [seed]
// 检查每条轨道在绝对空间下的 pitch class 是否落在 (scale + keyOffset) 内
// 以及每个旋律音是否与同时间和弦协和

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { Orchestrator } from '../src/core/generation/arrangement/Orchestrator';
import { SCALE_INTERVALS, CHORD_INTERVALS, ChordQuality, TonalityName, NoteData, GeneratedChord } from '../src/core/generation/types';
import { StyleId } from '../src/core/generation/config/StyleFlags';

const SEED = Number(process.argv[2] ?? 20107772);
PRNGManager.setSeed(SEED);
PRNGManager.next();  // 模拟 App 层 step 1 的 ×1 PRNG 消耗

const { track, context } = runPipeline();
const arranged = Orchestrator.arrange(track, StyleId.AcgLightMusic, context);

const keyOffset = track.keyOffset;
const tonality = track.tonality;
const scaleIntervals = SCALE_INTERVALS[tonality];
const scaleSet = new Set<number>();
for (const iv of scaleIntervals) scaleSet.add((iv + keyOffset + 12) % 12);

console.log('='.repeat(70));
console.log(`SEED ${SEED}`);
console.log(`bpm=${track.bpm}  key=${track.key}  keyOffset=${keyOffset}  tonality=${TonalityName[tonality]}`);
console.log(`scale (abs pcs): ${[...scaleSet].sort((a, b) => a - b).join(',')}`);
console.log(`useViterbiHarmony=${context.style?.useViterbiHarmony}`);
console.log('='.repeat(70));

function pitchClass(p: number): number {
    return ((Math.round(p) % 12) + 12) % 12;
}

function diagTrack(name: string, notes: NoteData[]) {
    if (!notes || notes.length === 0) {
        console.log(`${name.padEnd(18)} empty`);
        return;
    }
    let outOfScale = 0;
    const pcCount: Record<number, number> = {};
    for (const n of notes) {
        const pc = pitchClass(n.pitch);
        pcCount[pc] = (pcCount[pc] ?? 0) + 1;
        if (!scaleSet.has(pc)) outOfScale++;
    }
    const distrib = Object.entries(pcCount)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([pc, cnt]) => `${pc}:${cnt}${scaleSet.has(Number(pc)) ? '' : '*'}`)
        .join(' ');
    console.log(`${name.padEnd(18)} N=${notes.length}  out-of-scale=${outOfScale}  pc distrib: ${distrib}`);
}

console.log('--- Per-track pitch class scan (* = out-of-scale) ---');
diagTrack('melody', arranged.melody);
diagTrack('pianoRH', arranged.pianoRH);
diagTrack('pianoLH', arranged.pianoLH);
diagTrack('counterMelody', arranged.counterMelody ?? []);
diagTrack('secondaryMelody', arranged.secondaryMelody ?? []);

const chords = arranged.chords ?? [];
console.log('\n--- Chord progression (first 16, abs pcs) ---');
for (let i = 0; i < Math.min(chords.length, 16); i++) {
    const c = chords[i];
    const qEnum = ChordQuality[c.quality as keyof typeof ChordQuality];
    const intervals = CHORD_INTERVALS[qEnum];
    const absPcs: number[] = [];
    for (const iv of intervals) absPcs.push(((c.root + iv + (c.keyOffset ?? keyOffset)) % 12 + 12) % 12);
    console.log(`  [${i.toString().padStart(2)}] ${c.numeral.padEnd(8)} root=${c.root.toString().padStart(2)} keyOff=${c.keyOffset ?? keyOffset} chord-pcs(abs)=${absPcs.sort((a,b)=>a-b).join(',')}  beats[${c.startBeat.toFixed(2)}, ${c.endBeat.toFixed(2)})`);
}

function chordPcsAt(beat: number, chs: GeneratedChord[]): { pcs: Set<number>; numeral: string } | null {
    for (const c of chs) {
        if (beat >= c.startBeat - 0.001 && beat < c.endBeat - 0.001) {
            const qEnum = ChordQuality[c.quality as keyof typeof ChordQuality];
            const intervals = CHORD_INTERVALS[qEnum];
            const set = new Set<number>();
            for (const iv of intervals) set.add(((c.root + iv + (c.keyOffset ?? keyOffset)) % 12 + 12) % 12);
            return { pcs: set, numeral: c.numeral };
        }
    }
    return null;
}

function chordHarmonyRate(name: string, notes: NoteData[]): void {
    if (!notes || notes.length === 0) return;
    let inChord = 0, total = 0, inScale = 0;
    const violations: string[] = [];
    for (const n of notes) {
        const info = chordPcsAt(n.onset, chords);
        if (!info) continue;
        total++;
        const pc = pitchClass(n.pitch);
        if (info.pcs.has(pc)) inChord++;
        if (scaleSet.has(pc)) inScale++;
        else if (violations.length < 6) {
            violations.push(`onset=${n.onset.toFixed(2)} pitch=${n.pitch} pc=${pc} chord=${info.numeral} chord-pcs=[${[...info.pcs].sort((a,b)=>a-b).join(',')}]`);
        }
    }
    console.log(`${name.padEnd(18)} chord-tone ${inChord}/${total} (${(100*inChord/total).toFixed(1)}%) | in-scale ${inScale}/${total} (${(100*inScale/total).toFixed(1)}%)`);
    if (violations.length > 0) {
        console.log(`  out-of-scale samples:`);
        for (const v of violations) console.log(`    ${v}`);
    }
}

console.log('\n--- Chord-tone & scale-tone hit rate ---');
chordHarmonyRate('melody', arranged.melody);
chordHarmonyRate('pianoRH', arranged.pianoRH);
chordHarmonyRate('pianoLH', arranged.pianoLH);
chordHarmonyRate('counterMelody', arranged.counterMelody ?? []);
chordHarmonyRate('secondaryMelody', arranged.secondaryMelody ?? []);

const chordKeyOffsets = new Set<number>();
for (const c of chords) chordKeyOffsets.add(c.keyOffset ?? -1);
console.log(`\n--- keyOffset consistency ---`);
console.log(`track.keyOffset = ${track.keyOffset}`);
console.log(`chord.keyOffset values seen: ${[...chordKeyOffsets].join(',')}`);
console.log(`(should be a single value matching track.keyOffset)`);

// Sanity check: melody 第一个音 vs pianoLH 第一个音的 pitch class 是否落入同一调
const m0 = arranged.melody[0];
const lh0 = arranged.pianoLH[0];
console.log(`\nFirst-note sanity: melody[0].pitch=${m0?.pitch} (pc=${m0 ? pitchClass(m0.pitch) : '-'})  vs  pianoLH[0].pitch=${lh0?.pitch} (pc=${lh0 ? pitchClass(lh0.pitch) : '-'})`);
