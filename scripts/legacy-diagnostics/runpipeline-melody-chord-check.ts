/**
 * 用户实际听到的曲子复现:走完整 runPipeline 路径,然后做 melody-chord 对齐检查。
 *
 * 关键:runPipeline 内部 Stage 1+2 消耗 PRNG,所以 HarmonyEngine 拿到的 mgSeed
 * 跟用户输入的 1226615747 不一样。要复现用户体验必须走 runPipeline。
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { CHORD_INTERVALS, ChordQuality, ChordQualityName } from '../src/core/generation/types';
import { AbsoluteTransposer } from '../src/core/generation/pipeline/AbsoluteTransposer';

const SEED = parseInt(process.argv[2] ?? '1226615747', 10);

function pcOf(midi: number): number { return ((midi % 12) + 12) % 12; }
function pcName(pc: number): string {
    return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pc];
}

function getChordTones(rootPc: number, quality: ChordQuality): Set<number> {
    const intervals = CHORD_INTERVALS[quality] ?? [0, 4, 7];
    const out = new Set<number>();
    for (const iv of intervals) out.add(((rootPc + iv) % 12 + 12) % 12);
    return out;
}

/**
 * 粗略 chord-scale(根据 quality):
 *  Major* → Ionian
 *  Minor* → Dorian
 *  Dominant* → Mixolydian
 *  Dom7Alt → Altered
 *  HalfDim → Locrian
 *  Diminished → WH dim
 */
function getChordScale(rootPc: number, quality: ChordQuality): Set<number> {
    let ivs: number[];
    const name = ChordQualityName[quality];
    if (quality === ChordQuality.Dom7Alt) ivs = [0,1,3,4,6,8,10];
    else if (quality === ChordQuality.HalfDiminished) ivs = [0,1,3,5,6,8,10];
    else if (quality === ChordQuality.Diminished || quality === ChordQuality.Diminished7) ivs = [0,2,3,5,6,8,9,11];
    else if (/^Dom/.test(name) || /^Dominant/.test(name)) ivs = [0,2,4,5,7,9,10];
    else if (/^Minor/.test(name)) ivs = [0,2,3,5,7,9,10];
    else if (/^(Major|Sus4|Add9)/.test(name)) ivs = [0,2,4,5,7,9,11];
    else ivs = [0,2,4,5,7,9,11];
    const out = new Set<number>();
    for (const iv of ivs) out.add(((rootPc + iv) % 12 + 12) % 12);
    return out;
}

console.log(`=== runPipeline seed=${SEED} 完整复现 ===\n`);

PRNGManager.setSeed(SEED);
const { track, context } = runPipeline({});
const { chords, melody, keyOffset, key, tonality, bpm, sections } = track;

console.log(`Output:`);
console.log(`  style: id=${context.style?.id ?? '?'}  name=${context.style?.id !== undefined ? ['ModernPop','ChillJazz','NeoSoul'][context.style.id] : '?'}`);
console.log(`  key: ${key}  keyOffset: ${keyOffset}  tonality: ${tonality}`);
console.log(`  bpm: ${bpm}  bars(=totalBeats/4): ${chords.length}`);
console.log(`  sections: ${sections.length}  melody notes: ${melody.length}`);
console.log();

// 列出 chord progression (RELATIVE,加 keyOffset 才是真实音名)
console.log('Chord progression (RELATIVE = mg C-key output, +keyOffset 是实际 sounding key):');
console.log(`  keyOffset=${keyOffset} (== ${pcName(keyOffset)})`);
for (let i = 0; i < Math.min(chords.length, 20); i++) {
    const c = chords[i];
    const realRoot = (c.root + keyOffset) % 12;
    const realBass = c.bassOverride !== undefined ? (c.bassOverride + keyOffset) % 12 : realRoot;
    const slash = realBass !== realRoot ? `/${pcName(realBass)}` : '';
    console.log(`  bar${i.toString().padStart(2)} (beats ${c.startBeat}-${c.endBeat}) ${c.numeral.padEnd(10)} → ${pcName(realRoot)}${ChordQualityName[c.quality]}${slash}`);
}
if (chords.length > 20) console.log(`  ... (+${chords.length-20} more)`);

/**
 * 对齐分析:scenario 标签描述用 chord 和 melody 哪个空间(RELATIVE/ABSOLUTE)
 */
function analyze(label: string, chordRootPc: (i: number) => number, melodyPitches: number[]) {
    let chordTone = 0, scaleColor = 0, outside = 0;
    const outsideExamples: any[] = [];

    let chordIdx = 0;
    for (let i = 0; i < melody.length; i++) {
        while (chordIdx < chords.length - 1 && melody[i].onset >= chords[chordIdx + 1].startBeat - 0.0001) chordIdx++;
        const chord = chords[chordIdx];
        const rootPc = chordRootPc(chordIdx);
        const tones = getChordTones(rootPc, chord.quality);
        const scale = getChordScale(rootPc, chord.quality);
        const notePc = pcOf(melodyPitches[i]);
        if (tones.has(notePc)) chordTone++;
        else if (scale.has(notePc)) scaleColor++;
        else {
            outside++;
            if (outsideExamples.length < 8) {
                outsideExamples.push({
                    bar: Math.floor(melody[i].onset / 4),
                    beat: melody[i].onset.toFixed(2),
                    chord: `${pcName(rootPc)}${ChordQualityName[chord.quality]}`,
                    melodyPc: pcName(notePc),
                    offset: ((notePc - rootPc) % 12 + 12) % 12,
                });
            }
        }
    }
    const total = chordTone + scaleColor + outside;
    console.log(`\n${label}:`);
    console.log(`  ChordTone: ${chordTone} (${(chordTone/total*100).toFixed(1)}%)`);
    console.log(`  ScaleColor: ${scaleColor} (${(scaleColor/total*100).toFixed(1)}%)`);
    console.log(`  Outside: ${outside} (${(outside/total*100).toFixed(1)}%)`);
    if (outsideExamples.length > 0) {
        console.log(`  outside 示例:`);
        for (const ex of outsideExamples) {
            console.log(`    bar ${ex.bar} beat ${ex.beat} | ${ex.chord} | melody pc=${ex.melodyPc} (offset ${ex.offset} from root)`);
        }
    }
    return { chordTone, scaleColor, outside, total };
}

// === Scenario A:RELATIVE 模式 (runPipeline 输出原貌) ===
// chord.root + melody.pitch 都没加 keyOffset。这是 track 字段的真实状态。
console.log('\n=== Scenario A: RELATIVE mode (runPipeline 直接 return,未经 AbsoluteTransposer) ===');
analyze('Alignment (RELATIVE, chord.root vs melody.pitch 都不加 keyOffset)',
        (i) => ((chords[i].root % 12) + 12) % 12,
        melody.map(n => n.pitch));

// === Scenario B:ABSOLUTE 模式 (走 AbsoluteTransposer 之后的真实播放空间) ===
// 真实路径是 melody 加 keyOffset(由 AbsoluteTransposer 在 playSong 里加),
// chord.root 也加 keyOffset(在 visualizer 显示真实音名 / bass-atmosphere 计算时)。
// 数学上 chord 和 melody 同时加同一个 keyOffset → 对齐结果跟 RELATIVE 完全一样
const arranged = AbsoluteTransposer.arrange(track, context.style?.id ?? 0, context);
console.log('\n=== Scenario B: ABSOLUTE mode (经 AbsoluteTransposer.arrange) ===');
analyze('Alignment (chord.root +keyOffset vs arranged.melody.pitch)',
        (i) => ((chords[i].root + keyOffset) % 12 + 12) % 12,
        arranged.melody.map(n => n.pitch));
