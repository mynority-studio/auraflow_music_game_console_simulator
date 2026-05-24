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
import { SectionType, Tonality } from '../types';
import type { MusicianPlanInput } from './Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from './Conductor';
import { rankCandidatePcs } from './music-theory/note-evaluator';
import { thirdInterval, fifthInterval, seventhInterval } from './music-theory/chord-intervals';
import { placeNearAnchor } from './utils/voice-leading';
import type { MgStyle } from '../../../state/EngineSelectionStore';

const MELODY_DEFAULT_VELOCITY = 0.72;

// thirdInterval / fifthInterval / seventhInterval / placeNearAnchor
// 已抽取到 music-theory/chord-intervals.ts + utils/voice-leading.ts(2026-05-24)

// ============================================================
// Per-mgStyle rhythm patterns(B3,2026-05-24)
// ============================================================
//
// 每个池 4 个 pattern,index 语义跨风格一致:
//   idx 0 — 标准 baseline(直拍 / bebop 8th / 16th sync / shuffle)
//   idx 1 — 留白型(2 halfs)            ← persona.sparsityTendency 偏好
//   idx 2 — Dotted / anticipation       ← persona.syncopationAssault 偏好(h 偶数)
//   idx 3 — Sync / pocket               ← persona.syncopationAssault 偏好(h 奇数)
//
// QUANTIZED_DURATIONS 合法值:0.125 / 0.25 / 0.375 / 0.5 / 0.75 / 1.0
// sum 必须 = 1.0(占 chord 比例)
//
// POP   直拍 / dotted 经典      — radio 听感
// JAZZ  bebop 8th + comping 长留白 + anticipation — 摇摆律动
// RNB   16th syncopate / Dilla pocket / rest+flurry — neo-soul 神经质
// BLUES shuffle / call-response — 12-bar 律动
// ============================================================

const RHYTHM_PATTERNS_BY_STYLE: Record<MgStyle, ReadonlyArray<ReadonlyArray<number>>> = {
    POP: [
        Object.freeze([0.25, 0.25, 0.25, 0.25]),
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.375, 0.125, 0.5]),
        Object.freeze([0.25, 0.125, 0.125, 0.5]),
    ],
    JAZZ: [
        Object.freeze([0.125, 0.125, 0.25, 0.125, 0.125, 0.25]),
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.75, 0.25]),
        Object.freeze([0.125, 0.125, 0.25, 0.5]),
    ],
    RNB: [
        Object.freeze([0.125, 0.125, 0.25, 0.125, 0.125, 0.25]),
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.375, 0.125, 0.25, 0.25]),
        Object.freeze([0.25, 0.125, 0.125, 0.5]),
    ],
    BLUES: [
        Object.freeze([0.375, 0.125, 0.375, 0.125]),
        Object.freeze([0.5, 0.5]),
        Object.freeze([0.75, 0.25]),
        Object.freeze([0.25, 0.25, 0.5]),
    ],
};

/**
 * Pattern 选择 — 风格池 hash 均分;persona 加权偏好:
 *   - sparsityTendency 高 → 偏 idx 1(2 half,留白)
 *   - syncopationAssault 高 → 偏 idx 2/3(dotted / sync)
 *
 * 实现:基础 hash 抽 base index,再按 persona 概率"跳"到偏好 index。
 * mgStyle 选哪个池;未传时走 POP fallback。
 */
function pickRhythmPattern(
    sectionIdx: number,
    chordIdxInSection: number,
    mgStyle: MgStyle,
    sparsity: number = 0,
    syncopation: number = 0,
): ReadonlyArray<number> {
    const pool = RHYTHM_PATTERNS_BY_STYLE[mgStyle];
    const h = (sectionIdx * 7 + chordIdxInSection * 11) & 0xff;
    let idx = h % pool.length;
    // 二阶 hash 给"偏好跳转"概率
    const h2 = (h * 31 + 17) & 0xff;
    const p2 = h2 / 255;
    if (p2 < sparsity * 0.7) idx = 1;                                       // → Half
    else if (p2 < sparsity * 0.7 + syncopation * 0.7) idx = (h % 2 ? 3 : 2); // → Sync / Dotted
    return pool[idx];
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

/**
 * Evaluator-driven passing pc selection(v1.2 升级)。
 *
 * 候选集:prev 的 ±1 / ±2 半音邻(4 个)。用 note-evaluator 打分:
 *   - 最高分 = diatonic ScaleTone(0.85 = 0.70 + 0.15 direction bias)
 *   - 次高 = ChromaticPassing(0.65)
 *   - 末尾 = Avoid 类非调音
 *
 * 方向偏好(direction bias):候选 step 方向与 prev→next 一致时 +0.15 分,
 *   倾向"顺势"过渡。
 */
function pickBestPassingPc(
    prevPc: number,
    nextPc: number,
    chord: GeneratedChord,
    keyRootPc: number,
    isMinor: boolean,
): number {
    if (((nextPc - prevPc + 12) % 12) === 0) return prevPc;
    const candidates = [
        (prevPc + 1) % 12,
        (prevPc - 1 + 12) % 12,
        (prevPc + 2) % 12,
        (prevPc - 2 + 12) % 12,
    ];
    const ranked = rankCandidatePcs(
        candidates, chord.root, chord.quality, keyRootPc, isMinor,
        { prevPc, nextPc },
    );
    return ranked[0].pc;
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

    // Persona 消费(DNA → 算法行为)
    const persona = input.musician?.persona;
    const sparsity = persona?.sparsityTendency ?? 0;
    const syncopation = persona?.syncopationAssault ?? 0;
    const dynamicLo = (persona?.dynamicRange?.[0] ?? 72) / 127;
    const dynamicHi = (persona?.dynamicRange?.[1] ?? 110) / 127;
    const velocityBase = (dynamicLo + dynamicHi) / 2;

    // v1.2:Key 信息给 note-evaluator(passing tone 的 diatonic 偏好)
    //   keyOffset 是 RELATIVE(0-11),Composer 用同样的方式建 voicing
    //   tonality:Major=0 / Minor=1,其他模式 fallback 到 Major(MVP)
    const keyRootPc = ((input.score.keyOffset % 12) + 12) % 12;
    const isMinor = input.score.tonality === Tonality.Minor;

    // B3:mgStyle 决定 rhythm pattern 池;未传 → POP fallback
    const mgStyle: MgStyle = input.mgStyle ?? 'POP';

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
    // 再 assign chordIdxInSection + progress
    for (const chord of chords) {
        const si = findSectionIdxForBeat(chord.startBeat, sections);
        if (si < 0) continue;
        const chordIdxInSection = sectionChordIdx.get(si) ?? 0;
        sectionChordIdx.set(si, chordIdxInSection + 1);
        const totalInSection = sectionChordCounts.get(si) ?? 1;
        const progress = totalInSection > 1 ? chordIdxInSection / (totalInSection - 1) : 0.5;
        chordCtxs.push({
            chord, sectionIdx: si,
            sectionType: sections[si].sectionType,
            chordIdxInSection: chordIdxInSection, progress,
        });
    }

    for (const cc of chordCtxs) {
        const { chord, sectionIdx, sectionType, chordIdxInSection, progress } = cc;

        // section role gate
        const myRoles = getMyRolesInSection(input, sectionIdx);
        if (!myRoles.includes('melody')) continue;

        const chordBeats = chord.endBeat - chord.startBeat;
        if (chordBeats <= 0) continue;

        // Phrase ending:section 末 chord 改写为 "短 pickup + 长 tonic 收音"
        // 触发条件:progress >= 0.95(section 最后 chord)
        if (progress >= 0.95) {
            // 简化:emit 单个长音落在 chord.root,duration = 80% chord beats
            const targetPc = chord.root;
            // anchor 偏低(回归感)
            const endingAnchor = Math.floor((melodyLo + melodyHi) / 2) - 2;
            const midi = placeNearAnchor(targetPc, endingAnchor, melodyLo, melodyHi);
            const velH = ((sectionIdx * 19 + chordIdxInSection * 23) & 0xff) / 255;
            const vel = velocityBase + (velH - 0.5) * (dynamicHi - dynamicLo) * 0.3;
            out.push({
                pitch: midi,
                onset: chord.startBeat + chordBeats * 0.15,    // 短 pickup 间隔
                duration: chordBeats * 0.80,                    // 长收音
                velocity: Math.max(0.1, Math.min(1, vel)),
            });
            prevMidi = midi;
            continue;
        }

        // chord-tone cycle:[root, 5, 3, 7]
        const root = chord.root;
        const cyclePcs = [
            root,
            (root + fifthInterval(chord.quality)) % 12,
            (root + thirdInterval(chord.quality)) % 12,
            (root + seventhInterval(chord.quality)) % 12,
        ];

        // 节奏 pattern + slot 缩放到 chord beats(persona 加权 + mgStyle 选池)
        const pattern = pickRhythmPattern(sectionIdx, chordIdxInSection, mgStyle, sparsity, syncopation);
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
                // Passing tone(v1.2):evaluator-driven 选 diatonic-aware 邻音
                pc = pickBestPassingPc(prevPc, nextCyclePc, chord, keyRootPc, isMinor);
            } else {
                pc = nextCyclePc;
                cycleIdx++;
            }
            // anchor:contourMidi 与 prevMidi 平均(平滑 voice-leading)
            const anchor = Math.round((contourMidi + prevMidi) / 2);
            const midi = placeNearAnchor(pc, anchor, melodyLo, melodyHi);
            // Sparsity:per slot deterministic gate 删音(高 sparsity → 多空隙)
            const sparseH = ((sectionIdx * 41 + chordIdxInSection * 53 + s * 67) & 0xff) / 255;
            if (sparseH >= sparsity * 0.4) {
                // Velocity:dynamicRange 内 deterministic 浮动(±10% 自然感)
                const velH = ((sectionIdx * 19 + chordIdxInSection * 23 + s * 29) & 0xff) / 255;
                const vel = velocityBase + (velH - 0.5) * (dynamicHi - dynamicLo) * 0.5;
                out.push({
                    pitch: midi,
                    onset: chord.startBeat + beatCursor,
                    duration: slotDur * 0.95,
                    velocity: Math.max(0.1, Math.min(1, vel)),
                });
            }
            prevPc = pc;
            prevMidi = midi;
            beatCursor += slotDur;
        }
    }
    return out;
}
