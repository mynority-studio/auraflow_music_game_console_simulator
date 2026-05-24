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
//   未来 slap musician 用 walkPatternId = 4 (LatinTumbao) → AF2 自家 walking
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
import { thirdInterval, fifthInterval } from '../music-theory/chord-intervals';
import { placeNearAnchor as placeBassNearAnchor } from '../utils/voice-leading';

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

// ============================================================
// v1.1:swing feel + dynamic accents
// ============================================================
//
// swing:per-step durationBeats === 0.5(8th note)时,偶数 step(off-beat)
//   onset 推后 swing 量,offset = step.durationBeats * (swingRatio - 0.5)
//   - swingRatio 0.5  → straight 8th(无 swing)
//   - swingRatio 0.6  → 轻 swing(Pop/Funk)
//   - swingRatio 0.66 → 标准 jazz triplet swing
//
// accents:downbeat(beatCursor 整数)velocity 加 +0.08;off-beat 减 -0.06
//
// Pattern → swing 配置:
//   HalfNote(1)     0.50(无 swing,Pop sub-bass 直白)
//   Stride(2)       0.50
//   Pedal(3)        0.50
//   JazzQuarter(0)  0.50(quarter notes 不 swing,但留接口)
//   LatinTumbao(4)  0.55(轻 latin lift,8th 律动)
//   QuarterHalf(5)  0.55
//   BebopWalk(6)    0.66(jazz swing 标准)
//   ScaleClimb(7)   0.66
// ============================================================

const SWING_RATIO_BY_PATTERN: Record<WalkPatternId, number> = {
    [WalkPatternId.JazzQuarter]: 0.50,
    [WalkPatternId.HalfNote]:    0.50,
    [WalkPatternId.Stride]:      0.50,
    [WalkPatternId.Pedal]:       0.50,
    [WalkPatternId.LatinTumbao]: 0.55,
    [WalkPatternId.QuarterHalf]: 0.55,
    [WalkPatternId.BebopWalk]:   0.66,
    [WalkPatternId.ScaleClimb]:  0.66,
};

const ACCENT_DOWN = 0.08;
const ACCENT_OFF = -0.06;

// thirdInterval / fifthInterval / placeBassNearAnchor 已抽取到
//   music-theory/chord-intervals.ts + utils/voice-leading.ts(2026-05-24)

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

    // v1.1:swing + accents 配置
    const swingRatio = SWING_RATIO_BY_PATTERN[walkPatternId] ?? 0.50;
    // velocity 接 persona.dynamicRange(若有)
    const persona = input.musician?.persona;
    const dynamicLo = (persona?.dynamicRange?.[0] ?? 75) / 127;
    const dynamicHi = (persona?.dynamicRange?.[1] ?? 110) / 127;
    const velMid = (dynamicLo + dynamicHi) / 2;

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
                midi = prevMidi;
            } else {
                midi = placeBassNearAnchor(pcOrSentinel, prevMidi, rangeLo, rangeHi);
                prevPc = pcOrSentinel;
                prevMidi = midi;
            }
            // v1.1:swing onset offset(8th notes only,off-beat 推后)
            let onsetOffset = 0;
            if (Math.abs(step.durationBeats - 0.5) < 1e-3 && swingRatio !== 0.5) {
                // 判定是否 off-beat(beatCursor 落在 0.5 整数倍但非整 beat)
                const fracBeat = beatCursor - Math.floor(beatCursor);
                if (Math.abs(fracBeat - 0.5) < 1e-3) {
                    onsetOffset = (swingRatio - 0.5) * step.durationBeats;
                }
            }
            // v1.1:dynamic accent(downbeat 整数 beat 加重,其他减轻)
            const fracBeat = beatCursor - Math.floor(beatCursor);
            const isDownbeat = fracBeat < 1e-3;
            const accentDelta = isDownbeat ? ACCENT_DOWN : ACCENT_OFF;
            // velocity 微浮动(deterministic hash)
            const velH = ((ci * 13 + stepIdx * 17) & 0xff) / 255;
            const velJitter = (velH - 0.5) * (dynamicHi - dynamicLo) * 0.3;
            const vel = Math.max(0.1, Math.min(1, velMid + accentDelta + velJitter));
            out.push({
                pitch: midi,
                onset: chord.startBeat + beatCursor + onsetOffset,
                duration: stepDuration,
                velocity: vel,
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
