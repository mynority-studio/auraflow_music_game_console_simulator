/**
 * Melody-chord 对齐诊断:对某个 seed 跑 mg, 检查 melody 每个音落在当时 chord
 * 的 chord-scale 内还是外面。
 *
 * Outside-scale 高频率 = "跑调感"的客观证据。
 * 若 mg 内部都对得上 -> 锁定 adapter / 管线/ playback 问题。
 * 若 mg 内部就大量 outside -> 是 mg 算法的"jazz tension"特性 / bug。
 */

import { Engine as MgEngine, Random as MgRandom } from '../../melodygenerative/src/lib/musicEngine';
import type { ChordDef, NoteEvent } from '../../melodygenerative/src/lib/musicEngine';
import { CHORD_TYPES } from '../../melodygenerative/src/lib/musicTheory';

const SEED = process.argv[2] ?? '1226615747';
const STYLES = (process.argv[3]?.split(',') ?? ['POP', 'JAZZ', 'RNB']) as string[];

function pcOf(midi: number): number { return ((midi % 12) + 12) % 12; }
function pcName(pc: number): string {
    return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pc];
}

/**
 * 给一个 chord (root + type),拿到 chord-tones + 常见 chord-scale pcs。
 * chord-scale 用一种宽容估计:chord intervals(从 CHORD_TYPES 表)+ 主流可接受 tensions。
 * 这不是精确乐理,只是粗略"落音是否合理"判定。
 */
function getChordPcs(rootPc: number, type: string): { chordTones: Set<number>; chordScale: Set<number> } {
    const intervals = CHORD_TYPES[type] ?? [0, 4, 7];
    const chordTones = new Set<number>();
    for (const iv of intervals) chordTones.add((rootPc + iv) % 12);

    // 粗略 chord-scale:基于 chord type 推荐 7-音阶
    let scaleIntervals: number[];
    if (type.startsWith('maj') || type === '6/9' || type === 'add9' || type === '6' || type === '') {
        scaleIntervals = [0, 2, 4, 5, 7, 9, 11]; // Ionian
    } else if (type.startsWith('m') && !type.startsWith('maj') && !type.startsWith('m7b5') && !type.startsWith('m9b5')) {
        scaleIntervals = [0, 2, 3, 5, 7, 9, 10]; // Dorian (jazz-leaning;实际 m chord 常用)
    } else if (type === 'm7b5' || type === 'm9b5') {
        scaleIntervals = [0, 1, 3, 5, 6, 8, 10]; // Locrian
    } else if (type.startsWith('7') || type === '9' || type === '11' || type === '13' || type === '13b9' || type === '9sus4') {
        scaleIntervals = [0, 2, 4, 5, 7, 9, 10]; // Mixolydian
    } else if (type === '7alt') {
        scaleIntervals = [0, 1, 3, 4, 6, 8, 10]; // Altered
    } else if (type === 'dim7' || type === 'dim') {
        scaleIntervals = [0, 2, 3, 5, 6, 8, 9, 11]; // Whole-half diminished
    } else {
        scaleIntervals = [0, 2, 4, 5, 7, 9, 11]; // fallback Ionian
    }
    const chordScale = new Set<number>();
    for (const iv of scaleIntervals) chordScale.add((rootPc + iv) % 12);
    return { chordTones, chordScale };
}

function analyzeStyle(seed: string, style: string) {
    const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto' };
    const eng = new MgEngine(new MgRandom(cfg.seed));
    const chords: ChordDef[] = eng.generateProgressions(cfg);
    const timeline = eng.generateArrangement(chords, cfg);
    const melody: NoteEvent[] = timeline.events.filter(e => e.part === 'melody');

    // 用 chord.duration 累积起始拍
    const chordStarts: number[] = [];
    let cursor = 0;
    for (const c of chords) {
        chordStarts.push(cursor);
        cursor += c.duration;
    }
    const totalBeats = cursor;

    // 给每个 melody event 配对所在 chord
    let chordTone = 0, scaleColor = 0, outside = 0;
    const outsideExamples: { bar: number; chord: string; pc: number; pcName: string; chordRootPc: number }[] = [];
    let chordIdx = 0;

    for (const ev of melody) {
        // 找到 ev.time 在哪个 chord 段
        while (chordIdx < chords.length - 1 && ev.time >= chordStarts[chordIdx + 1] - 0.0001) chordIdx++;
        const chord = chords[chordIdx];
        const rootPc = pcOf(chord.rootMidi);
        const { chordTones, chordScale } = getChordPcs(rootPc, chord.type);
        const evPc = pcOf(ev.noteNumber);

        if (chordTones.has(evPc)) {
            chordTone++;
        } else if (chordScale.has(evPc)) {
            scaleColor++;
        } else {
            outside++;
            if (outsideExamples.length < 8) {
                outsideExamples.push({
                    bar: Math.floor(ev.time / 4),
                    chord: `${pcName(rootPc)}${chord.type}`,
                    pc: evPc,
                    pcName: pcName(evPc),
                    chordRootPc: rootPc,
                });
            }
        }
    }

    const total = chordTone + scaleColor + outside;
    const ct = (chordTone / total * 100).toFixed(1);
    const sc = (scaleColor / total * 100).toFixed(1);
    const os = (outside / total * 100).toFixed(1);

    console.log(`\n=== ${style} | seed ${seed} ===`);
    console.log(`Chord progression (${chords.length} bars, ${totalBeats} beats):`);
    const summary = chords.map((c, i) => `bar${i}:${c.roman}=${pcName(pcOf(c.rootMidi))}${c.type}`).slice(0, 16).join(' | ');
    console.log(`  ${summary}${chords.length > 16 ? ' ...' : ''}`);

    console.log(`\nMelody-chord alignment (${total} melody notes):`);
    console.log(`  ChordTone(根/3/5/7/9/11/13 字面音): ${chordTone} (${ct}%)`);
    console.log(`  ScaleColor(在 chord-scale 内但非字面音): ${scaleColor} (${sc}%)`);
    console.log(`  Outside(scale 之外,潜在"跑调"): ${outside} (${os}%)`);

    if (outsideExamples.length > 0) {
        console.log(`\n  Outside-scale 示例:`);
        for (const ex of outsideExamples) {
            console.log(`    bar ${ex.bar} | chord ${ex.chord} | melody pc=${ex.pcName} (offset ${(ex.pc - ex.chordRootPc + 12) % 12} from root)`);
        }
    }
}

console.log(`Diagnosing seed: ${SEED}`);
for (const style of STYLES) {
    try { analyzeStyle(SEED, style); }
    catch (e: any) { console.log(`\n${style}: ERROR ${e.message ?? e}`); }
}
