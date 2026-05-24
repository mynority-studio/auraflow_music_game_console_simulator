// ============================================================
// Af2MelodyGen — AF2 自家 chord-tone melody 生成器(MVP)
// ============================================================
//
// 8 层架构 #6 "乐手 idiom" 内的算法实现。当 musician 卡 af2Overrides.melodyAlgorithm
// = 'af2' 时,PianoIdiom.planMelody 调用本模块替代 mg.notes.melody pass-through。
//
// MVP 算法:
//   per chord:
//     1. 计算 chord-tone PC cycle:[root, 5, 3, 7](按 chord.quality 取 minor/major 3rd 等)
//     2. 决定 numNotes(默认 ~chordBeats,即每拍一个,clamp [2, 8])
//     3. per note 取 cycle[i % len] → resolve PC → placeNearAnchor(prev, melodyLo, melodyHi)
//     4. emit NoteData with onset=chord.startBeat + i*stepDur, dur=stepDur, vel=0.7
//   全曲 sort by onset。
//
// **AF2 ≠ MG**:不查 mg.tendency / mg.evaluator,音符 only chord-tone(无 NCT)。
// MVP 听感会偏"机械直接",听感测试后可加:
//   - passing tones(scale-tone insert between chord tones)
//   - phrase contour(per-section 上行/下行偏好)
//   - 节奏变化(8分音符 / 切分)
//   - persona 消费(sparsity → 删音 / syncopation → 切分)
// ============================================================

import type { NoteData, SectionMetadata } from '../types';
import type { GeneratedChord } from '../ir';
import { ChordQuality } from '../types';
import type { MusicianPlanInput } from './Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from './Conductor';

const MELODY_DEFAULT_VELOCITY = 0.72;

function thirdInterval(q: ChordQuality): number {
    switch (q) {
        case ChordQuality.Minor:
        case ChordQuality.Minor7:
        case ChordQuality.Minor9:
        case ChordQuality.Minor11:
        case ChordQuality.HalfDiminished:
        case ChordQuality.Diminished:
        case ChordQuality.Diminished7:
            return 3;
        default:
            return 4;
    }
}

function fifthInterval(q: ChordQuality): number {
    switch (q) {
        case ChordQuality.Diminished:
        case ChordQuality.Diminished7:
        case ChordQuality.HalfDiminished:
            return 6;
        case ChordQuality.Augmented:
            return 8;
        default:
            return 7;
    }
}

function seventhInterval(q: ChordQuality): number {
    switch (q) {
        case ChordQuality.Major7:
        case ChordQuality.Major9:
        case ChordQuality.Major13:
        case ChordQuality.Major7Sharp11:
            return 11;  // major 7th
        case ChordQuality.Diminished7:
            return 9;   // bb7
        case ChordQuality.HalfDiminished:
        case ChordQuality.Minor7:
        case ChordQuality.Minor9:
        case ChordQuality.Minor11:
        case ChordQuality.Dominant7:
        case ChordQuality.Dominant9:
        case ChordQuality.Dominant11:
        case ChordQuality.Dominant13:
            return 10;  // minor 7th
        default:
            return 11;  // fallback major 7th
    }
}

/** 同 PC 取离 prevMidi 最近的八度,clamp 到 range */
function placeNearAnchor(pc: number, prevMidi: number, lo: number, hi: number): number {
    let best = pc;
    while (best < lo) best += 12;
    while (best > hi) best -= 12;
    if (best < lo) best = pc + 12 * Math.ceil((lo - pc) / 12);
    let bestDist = Math.abs(best - prevMidi);
    for (let m = best - 12; m >= lo; m -= 12) {
        const d = Math.abs(m - prevMidi);
        if (d < bestDist) { bestDist = d; best = m; }
    }
    for (let m = best + 12; m <= hi; m += 12) {
        const d = Math.abs(m - prevMidi);
        if (d < bestDist) { bestDist = d; best = m; }
    }
    if (best < lo) best = lo;
    if (best > hi) best = hi;
    return best;
}

/**
 * AF2 melody 生成:per chord 走 chord-tone cycle,voice-lead。
 *
 * @param chords        总谱 chord 进行
 * @param sections      段落骨架(role gate 用)
 * @param input         MusicianPlanInput(role gate context)
 * @param melodyLo      melody 主区下界(默认 60 = C4)
 * @param melodyHi      melody 主区上界(默认 86 = D6)
 */
export function generateAf2Melody(
    chords: ReadonlyArray<GeneratedChord>,
    sections: ReadonlyArray<SectionMetadata>,
    input: MusicianPlanInput,
    melodyLo: number = 60,
    melodyHi: number = 86,
): NoteData[] {
    const out: NoteData[] = [];
    let prevMidi = 72;  // C5 起步

    for (const chord of chords) {
        // section role gate
        const sectionIdx = findSectionIdxForBeat(chord.startBeat, sections);
        if (sectionIdx < 0) continue;
        const myRoles = getMyRolesInSection(input, sectionIdx);
        if (!myRoles.includes('melody')) continue;

        const chordBeats = chord.endBeat - chord.startBeat;
        if (chordBeats <= 0) continue;

        // chord-tone cycle:[root, 5, 3, 7]
        const root = chord.root;
        const cyclePcs = [
            root,
            (root + fifthInterval(chord.quality)) % 12,
            (root + thirdInterval(chord.quality)) % 12,
            (root + seventhInterval(chord.quality)) % 12,
        ];

        // numNotes ~ chordBeats(每拍 1 个),clamp [2, 8]
        const numNotes = Math.max(2, Math.min(8, Math.round(chordBeats)));
        const stepDur = chordBeats / numNotes;

        for (let i = 0; i < numNotes; i++) {
            const targetPc = cyclePcs[i % cyclePcs.length];
            const midi = placeNearAnchor(targetPc, prevMidi, melodyLo, melodyHi);
            out.push({
                pitch: midi,
                onset: chord.startBeat + i * stepDur,
                duration: stepDur * 0.95,  // 略短给点 articulation
                velocity: MELODY_DEFAULT_VELOCITY,
            });
            prevMidi = midi;
        }
    }
    return out;
}
