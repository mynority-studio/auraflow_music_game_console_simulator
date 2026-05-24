// ============================================================
// Af2MelodyGen v1.1 — AF2 自家 chord-tone melody 生成器
// ============================================================
//
// 8 层架构 #6 "乐手 idiom" 内的算法实现。当 musician 卡 af2Overrides.melodyAlgorithm
// = 'af2' 时,PianoIdiom.planMelody 调用本模块替代 mg.notes.melody pass-through。
//
// v1.0 → v1.1 演进(摆脱"机械"听感):
//   - **节奏 variation**:4 种 rhythm pattern(quarter / half / dotted / syncopated),
//     per chord 用 deterministic hash 选,不再固定每拍一击
//   - **passing tones**:slot duration < 1 拍 时 50% 概率换为 chromatic passing
//     tone(prev → next 之间的半音邻),不再纯 chord-tone cycle
//   - **phrase contour**:per sectionType bias 目标音区(Verse arch / Chorus 上行 /
//     Bridge 下行 / Outro 下行),通过调整 anchor MIDI 实现
//   - cycle 仍是 [root, 5, 3, 7](保留),但 slot 是否走 cycle 由 rhythm pattern 决定
//
// 算法 deterministic:用 hash(sectionIdx + chordIdxInSection)+ slot duration 判断,
// **零 PRNG 消耗**,保留 D-5 锁帧。
//
// Phase D+ 进阶:
//   - persona 消费(sparsity → 删音 / syncopation → 切分密度)
//   - phrase ending(段末归位 tonic / 持续音)
//   - 装饰音 / grace note / 邻音
// ============================================================

import type { NoteData, SectionMetadata } from '../types';
import type { GeneratedChord } from '../ir';
import { ChordQuality, SectionType } from '../types';
import type { MusicianPlanInput } from './Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from './Conductor';

const MELODY_DEFAULT_VELOCITY = 0.72;

// ============================================================
// 音程 helpers(按 chord quality 取 3rd / 5th / 7th)
// ============================================================

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
            return 11;
        case ChordQuality.Diminished7:
            return 9;
        case ChordQuality.HalfDiminished:
        case ChordQuality.Minor7:
        case ChordQuality.Minor9:
        case ChordQuality.Minor11:
        case ChordQuality.Dominant7:
        case ChordQuality.Dominant9:
        case ChordQuality.Dominant11:
        case ChordQuality.Dominant13:
            return 10;
        default:
            return 11;
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

// ============================================================
// Rhythm patterns(slot duration 数组,sum 必须 = 1.0,代表占 chord 比例)
// ============================================================
//
// 4 种节奏:
//   A. 4 quarter:[0.25, 0.25, 0.25, 0.25]  (v1.0 默认)
//   B. 2 half:   [0.5, 0.5]                (留白)
//   C. dotted:   [0.375, 0.125, 0.5]       (附点四分 + 8th + 半)
//   D. sync:     [0.25, 0.125, 0.125, 0.5] (切分 + 后半留白)
// ============================================================

const RHYTHM_PATTERNS: ReadonlyArray<ReadonlyArray<number>> = Object.freeze([
    Object.freeze([0.25, 0.25, 0.25, 0.25]),
    Object.freeze([0.5, 0.5]),
    Object.freeze([0.375, 0.125, 0.5]),
    Object.freeze([0.25, 0.125, 0.125, 0.5]),
]);

/**
 * Deterministic 节奏选择(零 PRNG)。
 * sectionIdx + chordIdxInSection → pattern index [0..3]
 */
function pickRhythmPattern(sectionIdx: number, chordIdxInSection: number): ReadonlyArray<number> {
    const h = (sectionIdx * 7 + chordIdxInSection * 11) & 0xff;
    return RHYTHM_PATTERNS[h % RHYTHM_PATTERNS.length];
}

// ============================================================
// Phrase contour(per sectionType 目标音区 bias)
// ============================================================
//
// progress ∈ [0, 1](chord 在 section 内的进度)→ MIDI bias(±半音)
//
//   Verse / Bridge       arch — sin 曲线峰值 +6
//   Chorus / BuildUp     upward — 线性 +0 → +10
//   Outro / PreOutro     downward — 线性 +6 → 0(逐渐下沉)
//   Intro                steady — 中性 0
//   Drop / Break / 等    arch 默认
// ============================================================

function phraseContourBias(sectionType: SectionType, progress: number): number {
    switch (sectionType) {
        case SectionType.Chorus:
        case SectionType.BuildUp:
            return progress * 10;           // 上行
        case SectionType.Bridge:
            return (1 - progress) * 6;      // 下行
        case SectionType.Outro:
        case SectionType.PreOutro:
            return (1 - progress) * 6;      // 下行
        case SectionType.Intro:
            return 0;                       // 中性
        case SectionType.Verse:
        case SectionType.PreChorus:
        default:
            return Math.sin(progress * Math.PI) * 6;   // arch
    }
}

// ============================================================
// Passing tone(slot duration < 1 beat 时 50% 概率换为 chromatic passing)
// ============================================================

function pickPassingPc(prevPc: number, nextPc: number): number {
    // chromatic step toward nextPc
    const fwdDist = ((nextPc - prevPc + 12) % 12);
    if (fwdDist === 0) return prevPc;  // same — no passing meaningful
    return fwdDist <= 6
        ? (prevPc + 1) % 12
        : (prevPc - 1 + 12) % 12;
}

/**
 * Deterministic passing-tone gate(hash on slot index + chord idx)。
 * @returns true → 用 passing tone / false → 用 chord-tone cycle
 */
function passingToneGate(sectionIdx: number, chordIdxInSection: number, slotIdx: number): boolean {
    const h = (sectionIdx * 13 + chordIdxInSection * 17 + slotIdx * 23) & 0xff;
    return (h % 100) < 50;  // 50%
}

// ============================================================
// 主入口
// ============================================================

/**
 * AF2 melody v1.1 生成。
 *
 * @param chords        总谱 chord 进行
 * @param sections      段落骨架
 * @param input         MusicianPlanInput
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
    const baseAnchor = Math.floor((melodyLo + melodyHi) / 2);   // 73 ≈ C#5
    let prevMidi = baseAnchor;

    // 预处理:每 chord 标注 sectionIdx + chordIdxInSection + section progress
    interface ChordCtx {
        chord: GeneratedChord;
        sectionIdx: number;
        sectionType: SectionType;
        chordIdxInSection: number;
        progress: number;        // chord 在 section 中位置 [0, 1]
    }
    const chordCtxs: ChordCtx[] = [];
    const sectionChordCounts = new Map<number, number>();
    const sectionChordIdx = new Map<number, number>();

    // 先 count per-section chords
    for (const chord of chords) {
        const si = findSectionIdxForBeat(chord.startBeat, sections);
        if (si < 0) continue;
        sectionChordCounts.set(si, (sectionChordCounts.get(si) ?? 0) + 1);
    }
    // 再 assign idxInSection + progress
    for (const chord of chords) {
        const si = findSectionIdxForBeat(chord.startBeat, sections);
        if (si < 0) continue;
        const idxInSection = sectionChordIdx.get(si) ?? 0;
        sectionChordIdx.set(si, idxInSection + 1);
        const totalInSection = sectionChordCounts.get(si) ?? 1;
        const progress = totalInSection > 1 ? idxInSection / (totalInSection - 1) : 0.5;
        chordCtxs.push({
            chord, sectionIdx: si,
            sectionType: sections[si].sectionType,
            chordIdxInSection: idxInSection, progress,
        });
    }

    for (const cc of chordCtxs) {
        const { chord, sectionIdx, sectionType, chordIdxInSection, progress } = cc;

        // section role gate
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

        // 节奏 pattern + slot 缩放到 chord beats
        const pattern = pickRhythmPattern(sectionIdx, chordIdxInSection);
        const slotDurs = pattern.map(p => p * chordBeats);

        // Phrase contour:bias anchor 用于本 chord 的所有 slots
        const contourMidi = baseAnchor + phraseContourBias(sectionType, progress);

        let cycleIdx = 0;
        let prevPc = -1;
        let beatCursor = 0;
        for (let s = 0; s < slotDurs.length; s++) {
            const slotDur = slotDurs[s];
            const isShortSlot = slotDur < 1.0;
            const nextCyclePc = cyclePcs[cycleIdx % cyclePcs.length];
            let pc: number;
            if (isShortSlot && prevPc >= 0 && passingToneGate(sectionIdx, chordIdxInSection, s)) {
                // Passing tone:不动 cycleIdx,prevPc → nextCyclePc 之间 chromatic 邻
                pc = pickPassingPc(prevPc, nextCyclePc);
            } else {
                pc = nextCyclePc;
                cycleIdx++;
            }
            // anchor:contourMidi 与 prevMidi 平均(平滑 voice-leading)
            const anchor = Math.round((contourMidi + prevMidi) / 2);
            const midi = placeNearAnchor(pc, anchor, melodyLo, melodyHi);
            out.push({
                pitch: midi,
                onset: chord.startBeat + beatCursor,
                duration: slotDur * 0.95,
                velocity: MELODY_DEFAULT_VELOCITY,
            });
            prevPc = pc;
            prevMidi = midi;
            beatCursor += slotDur;
        }
    }
    return out;
}
