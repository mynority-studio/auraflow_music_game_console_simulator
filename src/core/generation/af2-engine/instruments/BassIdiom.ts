// ============================================================
// BassIdiom — AF2 电贝斯 idiom
// ============================================================
//
// 当前职责(双路径):
//
//   1. **AF2 walking**(musician.persona.walkPatternId 已设)
//      读 score.chords + WALK_PATTERNS[walkPatternId].steps,per chord 按
//      字母语法序列(B/5/3/A/N/= 等)生成 NoteData。
//      完全 AF2 自家算法,**忽略 mg.notes.bass**。
//
//   2. **mg pass-through**(walkPatternId 未设)
//      退化为旧路径:per-section role gate → 直通 mg.bass。
//
// 算法选择由 musician 卡 persona 决定:
//   frank_bass  walkPatternId = 1 (HalfNote)    → AF2 自家 walking
//   maya_slap_bass walkPatternId = 4 (LatinTumbao) → AF2 自家 walking
//   其他 musician 未设 → mg pass-through
//
// 与 mg.generateArrangement 关系:
//   AF2 walking 路径完全独立 — mg 的 bass output 在 timeline.events 中仍存在,
//   但 SlotRouter 给 bass musician 的 notes.bass 被 plan() 忽略。
//   未来可在 mg 阶段跳过 bass 生成,节省 mg 计算。
//
// 物理约束:
//   - 音域 E1-G4(MIDI 28-67)
//   - 单声部
//   - eligibleSlots: [Bass]
// ============================================================

import type { NoteData } from '../../types';
import { BandRole, ChordQuality } from '../../types';
import type { GeneratedChord } from '../../ir';
import type { MusicianPlanInput } from '../Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from '../Conductor';
import { WALK_PATTERNS, WalkRule, WalkPatternId } from '../../data/BassWalkPatterns';

/** 电贝斯物理参数 */
export const BASS_INSTRUMENT_SPEC = {
    gmProgram: 34,           // GM 34 Electric Bass Finger
    rangeLo: 28,             // E1
    rangeHi: 67,             // G4
    eligibleSlots: [BandRole.Bass] as const,
} as const;

/** AF2 walking 默认参数 */
const BASS_DEFAULT_VELOCITY = 0.78;
const BASS_ANCHOR_MIDI = 40;          // E2 起步锚点

/** Quality → minor/major 3rd 判定 */
function thirdInterval(q: ChordQuality): number {
    switch (q) {
        case ChordQuality.Minor:
        case ChordQuality.Minor7:
        case ChordQuality.Minor9:
        case ChordQuality.Minor11:
        case ChordQuality.HalfDiminished:
        case ChordQuality.Diminished:
        case ChordQuality.Diminished7:
            return 3;     // minor 3rd
        default:
            return 4;     // major 3rd
    }
}

/** Quality → 5th 类型 */
function fifthInterval(q: ChordQuality): number {
    switch (q) {
        case ChordQuality.Diminished:
        case ChordQuality.Diminished7:
        case ChordQuality.HalfDiminished:
            return 6;     // diminished 5th
        case ChordQuality.Augmented:
            return 8;     // augmented 5th
        default:
            return 7;     // perfect 5th
    }
}

/** 同 PC 取离 prevMidi 最近的八度,clamp 到 range */
function placeBassNearAnchor(pc: number, prevMidi: number, rangeLo: number, rangeHi: number): number {
    let best = pc;
    while (best < rangeLo) best += 12;
    while (best > rangeHi) best -= 12;
    if (best < rangeLo) best = pc + 12 * Math.ceil((rangeLo - pc) / 12);
    let bestDist = Math.abs(best - prevMidi);
    for (let m = best - 12; m >= rangeLo; m -= 12) {
        const d = Math.abs(m - prevMidi);
        if (d < bestDist) { bestDist = d; best = m; }
    }
    for (let m = best + 12; m <= rangeHi; m += 12) {
        const d = Math.abs(m - prevMidi);
        if (d < bestDist) { bestDist = d; best = m; }
    }
    if (best < rangeLo) best = rangeLo;
    if (best > rangeHi) best = rangeHi;
    return best;
}

/**
 * Resolve WalkRule → 目标 PC(0-11)+ 是否要"用前一个 MIDI"标记。
 * Repeat 返回 -1 表示用 prevMidi(节奏复读)。
 */
function resolveRuleToPc(
    rule: WalkRule,
    chord: GeneratedChord,
    nextChord: GeneratedChord | undefined,
    prevPc: number,
): number {
    const root = chord.root;
    switch (rule) {
        case WalkRule.Root:     return root;
        case WalkRule.Third:    return (root + thirdInterval(chord.quality)) % 12;
        case WalkRule.Fifth:    return (root + fifthInterval(chord.quality)) % 12;
        case WalkRule.NextRoot: return nextChord ? nextChord.root : root;
        case WalkRule.Approach: return nextChord ? ((nextChord.root - 1 + 12) % 12) : root;
        case WalkRule.Repeat:   return -1;  // sentinel:用 prevMidi
        case WalkRule.ChordTone:
        case WalkRule.ScaleTone:
            // MVP:简化为 Root(将来可接 chord.voicing 派生)
            return root;
        default:
            return prevPc;
    }
}

/**
 * AF2 walking 渲染:per chord 按 walkPatternId 配方生成 NoteData[]。
 */
function renderAf2Walking(
    chords: ReadonlyArray<GeneratedChord>,
    walkPatternId: WalkPatternId,
    input: MusicianPlanInput,
): NoteData[] {
    const pattern = WALK_PATTERNS[walkPatternId];
    if (!pattern || pattern.steps.length === 0) return [];
    const { rangeLo, rangeHi } = BASS_INSTRUMENT_SPEC;
    const out: NoteData[] = [];
    let prevMidi = BASS_ANCHOR_MIDI;
    let prevPc = chords.length > 0 ? chords[0].root : 0;

    for (let ci = 0; ci < chords.length; ci++) {
        const chord = chords[ci];
        const nextChord = chords[ci + 1];
        // section role gate(在 chord 起始时刻判定一次)
        const sectionIdx = findSectionIdxForBeat(chord.startBeat, input.score.sections);
        if (sectionIdx < 0) continue;
        const myRoles = getMyRolesInSection(input, sectionIdx);
        if (!myRoles.includes('bass')) continue;

        // chord 占的总 beats,把 pattern 循环填满
        const chordBeats = chord.endBeat - chord.startBeat;
        let beatCursor = 0;
        let stepIdx = 0;
        while (beatCursor < chordBeats - 1e-6) {
            const step = pattern.steps[stepIdx % pattern.steps.length];
            const stepDuration = Math.min(step.durationBeats, chordBeats - beatCursor);
            const pcOrSentinel = resolveRuleToPc(step.rule, chord, nextChord, prevPc);
            let midi: number;
            if (pcOrSentinel < 0) {
                // Repeat:复用 prevMidi
                midi = prevMidi;
            } else {
                midi = placeBassNearAnchor(pcOrSentinel, prevMidi, rangeLo, rangeHi);
                prevPc = pcOrSentinel;
                prevMidi = midi;
            }
            out.push({
                pitch: midi,
                onset: chord.startBeat + beatCursor,
                duration: stepDuration,
                velocity: BASS_DEFAULT_VELOCITY,
            });
            beatCursor += step.durationBeats;
            stepIdx++;
        }
    }
    return out;
}

export const BassIdiom = {
    /**
     * Plan bass role。
     *   walkPatternId 已设 → AF2 自家 walking(score.chords + WALK_PATTERNS)
     *   walkPatternId 未设 → 退化 mg pass-through
     */
    plan(input: MusicianPlanInput): NoteData[] {
        const walkPatternId = input.musician?.persona?.walkPatternId;

        // AF2 自家 walking 路径
        if (walkPatternId !== undefined && walkPatternId !== null) {
            return renderAf2Walking(input.score.chords, walkPatternId as WalkPatternId, input);
        }

        // Mg pass-through 退化路径
        const raw = input.notes?.bass ?? [];
        if (raw.length === 0) return [];
        const out: NoteData[] = [];
        for (const n of raw) {
            const sectionIdx = findSectionIdxForBeat(n.onset, input.score.sections);
            if (sectionIdx < 0) continue;
            const myRoles = getMyRolesInSection(input, sectionIdx);
            if (!myRoles.includes('bass')) continue;
            out.push({ ...n });
        }
        return out;
    },

    getGmProgram(): number {
        return BASS_INSTRUMENT_SPEC.gmProgram;
    },
};
