// ============================================================
// Af2MelodyGen — chord-tone melody orchestrator(core)
// ============================================================
//
// 8 层架构 #6 "乐手 idiom" 内的算法实现。当 musician 卡 af2Overrides.melodyAlgorithm
// = 'af2' 时,PianoIdiom.planMelody 调用本模块。
//
// 2026-05-25 拆 plugin:本文件保留 core orchestrator + chord-tone cycle [root, 5, 3, 7]
// + placeNearAnchor + 主循环 / 边界保证。6 plugin 移到 plugins/melody/:
//
//   RhythmPatternPicker  — per-mgStyle rhythm 池 + persona 加权
//   PhraseContourShaper  — per-sectionType MIDI bias
//   PassingToneSelector  — chromatic passing gate + diatonic-aware 选音
//   PhraseEndingDecider  — section 末 chord 短 pickup + 长 tonic
//   SparsityGate         — per-slot 删音
//   VelocityHumanizer    — per-slot velocity 浮动
//
// 全 deterministic hash gate,**零 PRNG 消耗**,保留 D-5 锁帧。
// 任一 plugin 拔掉听感劣化(less variation)但 orchestrator 仍输出合法 melody。
// ============================================================

import type { NoteData, SectionMetadata } from '../types';
import type { GeneratedChord } from '../ir';
import { SectionType, Tonality } from '../types';
import type { MusicianPlanInput } from './Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from './Conductor';
import { thirdInterval, fifthInterval, seventhInterval } from './music-theory/chord-intervals';
import { placeNearAnchor } from './utils/voice-leading';
import {
    RhythmPatternPicker,
    PhraseContourShaper,
    PassingToneSelector,
    PhraseEndingDecider,
    SparsityGate,
    VelocityHumanizer,
    pickByExpectancy,
    clampToSlope,
    DEFAULT_SLOPE_BY_SECTION,
    approachPitch,
    shouldApproach,
} from './plugins/melody';

// ============================================================
// Phase 3(Impro-Visor Margulis 移植,2026-05-25):melodic expectation
// ============================================================
//
// placeNearAnchor 给一个 nearest-octave MIDI;启用时用 Margulis score 在
// [midi-12, midi, midi+12] 三 octave 候选中选最优。默认 OFF — 听感 review
// 后逐步开启(per-mgStyle / global gate)。
// ============================================================
const MARGULIS_RERANK_ENABLED = false;

// ============================================================
// Phase 4(Impro-Visor Slope + Approach,2026-05-25):melody 硬约束
// ============================================================
//
// SLOPE_GATE_ENABLED:每 slot 把 midi clamp 到 [prev + slope.min, prev + slope.max]
//   (per-sectionType 区间 — 防止 PhraseContour bias 被 placeNearAnchor 八度跳穿)
// APPROACH_TONE_ENABLED:chord 末尾 30% slots(且有 next chord)→ 强 ±1 半音
//   进入下一 chord root(jazz leading tone)
//
// 默认全 OFF — 听感 review 后再 mgStyle / sub-style 启用。
// ============================================================
const SLOPE_GATE_ENABLED = false;
const APPROACH_TONE_ENABLED = false;

/**
 * AF2 melody 生成(core orchestrator)。
 *
 * @param chords        总谱 chord 进行
 * @param sections      段落骨架
 * @param input         MusicianPlanInput(消费 musician.persona DNA + score key + mgStyle)
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

    // Persona DNA → 算法行为
    const persona = input.musician?.persona;
    const sparsity = persona?.sparsityTendency ?? 0;
    const syncopation = persona?.syncopationAssault ?? 0;
    const dynamicLo = (persona?.dynamicRange?.[0] ?? 72) / 127;
    const dynamicHi = (persona?.dynamicRange?.[1] ?? 110) / 127;
    const velocityBase = (dynamicLo + dynamicHi) / 2;

    // Key 信息给 PassingToneSelector(diatonic 偏好)
    const keyRootPc = ((input.score.keyOffset % 12) + 12) % 12;
    const isMinor = input.score.tonality === Tonality.Minor;

    // 预处理:每 chord 标注 sectionIdx + chordIdxInSection + section progress
    interface ChordCtx {
        chord: GeneratedChord;
        sectionIdx: number;
        sectionType: SectionType;
        chordIdxInSection: number;
        progress: number;
    }
    const chordCtxs: ChordCtx[] = [];
    const sectionChordCounts = new Map<number, number>();
    const sectionChordIdx = new Map<number, number>();

    for (const chord of chords) {
        const si = findSectionIdxForBeat(chord.startBeat, sections);
        if (si < 0) continue;
        sectionChordCounts.set(si, (sectionChordCounts.get(si) ?? 0) + 1);
    }
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
            chordIdxInSection, progress,
        });
    }

    for (let ccIdx = 0; ccIdx < chordCtxs.length; ccIdx++) {
        const cc = chordCtxs[ccIdx]!;
        const { chord, sectionIdx, sectionType, chordIdxInSection, progress } = cc;
        const nextCc = chordCtxs[ccIdx + 1]; // Phase 4 ApproachToneTargeter 用

        // Core:section role gate
        const myRoles = getMyRolesInSection(input, sectionIdx);
        if (!myRoles.includes('melody')) continue;

        const chordBeats = chord.endBeat - chord.startBeat;
        if (chordBeats <= 0) continue;

        // Plugin:PhraseEndingDecider — section 末 chord 短路本 chord 余下逻辑
        if (PhraseEndingDecider.shouldApply(progress)) {
            const endingNote = PhraseEndingDecider.generate(
                chord, melodyLo, melodyHi,
                sectionIdx, chordIdxInSection,
                velocityBase, dynamicLo, dynamicHi,
            );
            out.push(endingNote);
            prevMidi = endingNote.pitch;
            continue;
        }

        // Core:chord-tone cycle [root, 5, 3, 7]
        const root = chord.root;
        const cyclePcs = [
            root,
            (root + fifthInterval(chord.quality)) % 12,
            (root + thirdInterval(chord.quality)) % 12,
            (root + seventhInterval(chord.quality)) % 12,
        ];

        // Plugin:RhythmPatternPicker(persona 加权 + mgStyle 选池)
        const pattern = RhythmPatternPicker.pick(sectionIdx, chordIdxInSection, sparsity, syncopation);
        const slotDurs = pattern.map(p => p * chordBeats);

        // Plugin:PhraseContourShaper — bias anchor 用于本 chord 的所有 slots
        const contourMidi = baseAnchor + PhraseContourShaper.bias(sectionType, progress);

        let cycleIdx = 0;
        let prevPc = -1;
        let prevPrevMidi = -1;
        let beatCursor = 0;
        for (let s = 0; s < slotDurs.length; s++) {
            const slotDur = slotDurs[s];
            const isShortSlot = slotDur < 1.0;
            const nextCyclePc = cyclePcs[cycleIdx % cyclePcs.length];

            // Phase 4 opt-in:ApproachToneTargeter — chord 末 30% slots + 有 next chord
            //   → 强 ±1 半音进入下一 chord root(jazz leading tone)
            const slotProgressInChord = slotDurs.length > 1 ? s / (slotDurs.length - 1) : 0;
            let midi: number;
            let pc: number;
            if (
                APPROACH_TONE_ENABLED
                && nextCc
                && shouldApproach(slotProgressInChord, true)
                && prevMidi !== baseAnchor
            ) {
                midi = approachPitch(nextCc.chord, prevMidi, 0, melodyLo, melodyHi);
                pc = ((midi % 12) + 12) % 12;
                cycleIdx++;
            } else {
                // Plugin:PassingToneSelector(短 slot + prevPc 可用时 50% 概率替换)
                if (isShortSlot && prevPc >= 0 && PassingToneSelector.gate(sectionIdx, chordIdxInSection, s)) {
                    pc = PassingToneSelector.pick(prevPc, nextCyclePc, chord, keyRootPc, isMinor);
                } else {
                    pc = nextCyclePc;
                    cycleIdx++;
                }

                // Core:placeNearAnchor(contourMidi + prevMidi 平均,平滑 voice-leading)
                const anchor = Math.round((contourMidi + prevMidi) / 2);
                midi = placeNearAnchor(pc, anchor, melodyLo, melodyHi);

                // Phase 3 opt-in:Margulis octave rerank(默认 OFF — 不破坏既有 melody)
                if (MARGULIS_RERANK_ENABLED && prevMidi !== baseAnchor) {
                    const octaveCandidates = [midi - 12, midi, midi + 12];
                    midi = pickByExpectancy(
                        octaveCandidates, prevMidi, prevPrevMidi, chord, melodyLo, melodyHi,
                    );
                }

                // Phase 4 opt-in:SlopeContourGate — clamp 到 [prev + slope.min, prev + slope.max]
                if (SLOPE_GATE_ENABLED && prevMidi !== baseAnchor) {
                    const slope = DEFAULT_SLOPE_BY_SECTION[sectionType] ?? DEFAULT_SLOPE_BY_SECTION[SectionType.Verse];
                    midi = clampToSlope(midi, prevMidi, slope, melodyLo, melodyHi);
                }
            }

            // Plugin:SparsityGate + VelocityHumanizer
            if (SparsityGate.shouldEmit(sectionIdx, chordIdxInSection, s, sparsity)) {
                const vel = VelocityHumanizer.compute(
                    sectionIdx, chordIdxInSection, s,
                    velocityBase, dynamicLo, dynamicHi,
                );
                out.push({
                    pitch: midi,
                    onset: chord.startBeat + beatCursor,
                    duration: slotDur * 0.95,
                    velocity: vel,
                });
            }

            // prevPc / prevMidi / prevPrevMidi / beatCursor 照常推进
            // (空隙不影响后续 voice-leading;prevPrevMidi 用于 Phase 3 Margulis direction)
            prevPc = pc;
            prevPrevMidi = prevMidi;
            prevMidi = midi;
            beatCursor += slotDur;
        }
    }
    return out;
}
