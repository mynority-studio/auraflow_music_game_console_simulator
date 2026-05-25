// ============================================================
// Af2Composer — AF2 自有作曲家(用户 8 层架构 #4)
// ============================================================
//
// 替代 mg.realizeProgression — AF2 自家把 Arranger 输出的 abstractPath
// (Roman + type + rootOffset)实化为完整 ChordDef[](含 voicing / bassMidi /
// chordSymbol / effectiveFunc)。
//
// 与 mg.realizeProgression 的差异:
//   - **简化**:跳过 Divisi 2.0(tensionState / virtualExtensions)、mode
//     borrowing detection、bassline rules / walking patterns、cadential 64
//     intercept 等 mg 高级功能
//   - **保留**:music-theory.placeVoicingMidi 做 voice-leading + CHORD_TYPES
//     interval 查表 + spell pc 等基础能力
//   - **风险**:mg.generateArrangement 用 ChordDef 做 melody/bass/accomp 决策,
//     AF2 Composer 输出的 ChordDef 字段简化后,melody 行为可能微变(可接受 — AF2 ≠ MG bit-exact)
//
// 算法流(per chord step):
//   1. rootKeyIndex = (keyIndex + step.rootOffset) % 12
//   2. intervals = CHORD_TYPES[step.type]
//   3. voicingPcs = intervals.map(iv => (rootKeyIndex + iv) % 12)
//   4. bassMidi = root in BASS_RANGE [A1=33, G3=55]
//   5. voicing = placeVoicingMidi(voicingPcs, prevVoicing, bassMidi, ...)
//      → 自动 voice-leading + chord region [C3, A5] placement
//   6. chordSymbol = "C" / "Cmaj7" / "Dm9" 等(简易拼接)
//   7. effectiveFunc = harmonicFunctionFromRoman(roman)
// ============================================================

import {
    placeVoicingMidi, BASS_RANGE,
    KEYS, harmonicFunctionFromRoman, spellPcInKey, midiToNoteInKey, midiToNoteInChord,
    assembleVoicing,
    STYLE_FULL, STYLE_SHELL,
    type VoicingStylePreference,
} from './music-theory';
import { Random } from './utils/Random';
import type { ChordDef } from './types/ChordDef';
import type { Af2AbstractStep } from './Af2Arranger';
import type { SubStyle } from './SubStyleTextures';
import { DynamicHarmonyDecorator, VoicingSmoother, partitionHands, mergeHands, DEFAULT_HAND_CONFIG } from './plugins/composer';

// ============================================================
// M 阶段(2026-05-24):Dynamic TSD chord-type decoration
// ============================================================
//
// 替换原 EXTENSION_PROB / addExtensionPcs(简化 9/13 加色)→ 接 mg 移植的
// Look-ahead Dynamic TSD dictionary:
//
//   Per step decorateChordType:
//     1. step.lockType=true → 保留 step.type(Planner 已锁,跳过 random 消耗保持流稳定)
//     2. Roll colorLevel(0/1/2)from COLOR_LEVEL_PROBABILITIES[mgStyle]
//     3. analyzeTargetQuality(currFunc, nextFunc, next.roman, next.type)
//     4. DYNAMIC_TSD_DICTIONARY[mgStyle][currFunc].find(target) → levels[colorLevel]
//     5. Sub-V activation(D-function only):perfect-fifth-down + tritoneProb gate
//     6. Data-debt guard:!CHORD_TYPES[finalType] → 按 currFunc downgrade
//     7. Sub-V override:rootOffset +6 + romanOverride 'subV/X'
//
// PRNG 消耗:每 step 1(colorLevel roll)+ 1(pick)+ 0-1(Sub-V activation)
// = 2-3 per step,deterministic per seed。
// ============================================================

// ============================================================
// POP-only:默认 compingVoicingMode = STYLE_FULL(5 voice,vocal-style 完整 voicing)
// ============================================================
//
// 历史(非 POP 退役):
//   JAZZ → STYLE_ROOTLESS / BLUES → STYLE_BLUES / RNB → STYLE_CLUSTER
//
// 用 assembleVoicing(已带 clash detection + density priority drop)替换原
// 简陋的 `intervals.map(iv => (root + iv) % 12)`。POP 完整 5 voice — vocal-style chord support。
// ============================================================

const DEFAULT_VOICING_MODE: VoicingStylePreference = STYLE_FULL;

// ============================================================
// Phase 2(Impro-Visor HandManager 移植,2026-05-25):钢琴 LH/RH 双手分手
// ============================================================
//
// Per sub-style 启停 hand partition。默认全 false — 不破坏现有听感。
// 启用 sub-style 时:Composer 主循环走 partitionHands path,填 ChordDef.lhMidi/rhMidi
// + notesMidi 同步合并 LH+RH 升序。
//
// 开放给后续 phase 调音 — 验证 sub-style 启用后听感稳定再批量打开。
// ============================================================
const HAND_PARTITION_BY_SUB_STYLE: Partial<Record<SubStyle, boolean>> = {
    // 全部默认 false。后续验证 sub-style 听感 ready 时开启。
};

// POP sub-style voicing mode override(6 sub-style)
// ModernTrap 用 STYLE_SHELL(简洁 4 voice 含 root),其余 STYLE_FULL
const SUB_STYLE_VOICING_MODE: Partial<Record<SubStyle, VoicingStylePreference>> = {
    PopBallad:         STYLE_FULL,
    SynthPop:          STYLE_FULL,
    MaxMartinPop:      STYLE_FULL,
    AsianPopWalkdown:  STYLE_FULL,
    ModernStadiumPop:  STYLE_FULL,
    ModernTrap:        STYLE_SHELL,    // 简洁 4 voice 含 root
};

// decorateChordType 已拆 plugin → plugins/composer/DynamicHarmonyDecorator.ts(2026-05-25)
// Composer 主循环直接调 DynamicHarmonyDecorator.apply(step, next, mgStyle, rng)

// smoothChordVoicings 已拆 plugin → plugins/composer/VoicingSmoother.ts(2026-05-25)
// 配套 helpers(voicingL1 / expectedArcShift / topVoice / generateInversionCandidates)
// + 常量(PHRASE_CHORD_COUNT_SMOOTHER / ARC_AMPLITUDE / ARC_WEIGHT)一并移入 plugin。

export const Af2Composer = {
    /**
     * 把 Af2AbstractStep[] 实化为 ChordDef[](Composer 入口)。
     *
     * @param abstractPath  Arranger 输出的进行骨架
     * @param key           调号字符串(如 'C')
     * @param isMinorKey    调式 minor 否(默认 false = major)
     */
    compose(
        abstractPath: Af2AbstractStep[],
        key: string,
        isMinorKey: boolean = false,
        rng?: Random,
        subStyle?: SubStyle,
    ): ChordDef[] {
        const keyIndex = Math.max(0, KEYS.indexOf(key));
        const out: ChordDef[] = [];
        let prevVoicing: number[] = [];
        // Phase 2:hand partition 启用时维持 prev LH/RH(独立 voice leading)
        const handPartitionEnabled = subStyle ? !!HAND_PARTITION_BY_SUB_STYLE[subStyle] : false;
        let prevLhMidi: number[] = [];
        let prevRhMidi: number[] = [];

        for (let i = 0; i < abstractPath.length; i++) {
            const step = abstractPath[i];
            // M 阶段:Look-ahead next chord(最后 step 看自己,Default target)
            const next = abstractPath[i + 1] ?? step;

            // 1. M 阶段 decorate — Dynamic TSD 选 chord type + 可选 Sub-V override
            //    没传 rng 退化原 step.type
            let finalType: string = step.type;
            let finalRootOffset: number = step.rootOffset;
            let finalRoman: string = step.roman;
            if (rng) {
                const decorated = DynamicHarmonyDecorator.apply(step, next, rng);
                finalType = decorated.type;
                if (decorated.rootOffsetOverride !== undefined) {
                    finalRootOffset = decorated.rootOffsetOverride;
                }
                if (decorated.romanOverride !== undefined) {
                    finalRoman = decorated.romanOverride;
                }
            }

            // 2. rootKeyIndex(在调内 pc 0-11)
            const rootKeyIndex = ((keyIndex + finalRootOffset) % 12 + 12) % 12;

            // 3 + 4. assembleVoicing:M 阶段 per-mgStyle voicing mode +
            //   P6 阶段 per-sub-style override(优先 sub-style 配置)。
            //   STYLE_FULL / ROOTLESS / CLUSTER / BLUES / SHELL — 5 mode
            //   走完整 pipeline:CHORD_TYPES → addColorOnTriad → clash detection →
            //   rootPolicy(omit/include)→ density cap with priority drop。
            //   未传 mgStyle 退化 STYLE_FULL。
            const voicingMode = (subStyle && SUB_STYLE_VOICING_MODE[subStyle])
                ?? DEFAULT_VOICING_MODE;
            const voicingPcs = assembleVoicing(finalType, rootKeyIndex, voicingMode);

            // 5. Bass MIDI:root pc clamp 到 BASS_RANGE
            let bassMidi = rootKeyIndex + 36; // C2 区间起步
            while (bassMidi < BASS_RANGE.LOW) bassMidi += 12;
            while (bassMidi > BASS_RANGE.HIGH) bassMidi -= 12;
            if (bassMidi < BASS_RANGE.LOW) bassMidi = BASS_RANGE.LOW;
            if (bassMidi > BASS_RANGE.HIGH) bassMidi = BASS_RANGE.HIGH;

            // 6. Voice-leading placement(music-theory helper)
            //    Phase 2 opt-in:若 hand partition 启用 → 走 partitionHands 双手 path,
            //    notesMidi = LH ∪ RH 升序;否则走原单簇 placeVoicingMidi。
            let voicing: number[];
            let lhMidi: number[] | undefined;
            let rhMidi: number[] | undefined;
            if (handPartitionEnabled) {
                // deterministic hash:i + finalRootOffset(zero PRNG)
                const seedHash = (i * 31 + finalRootOffset * 7 + keyIndex) >>> 0;
                const hands = partitionHands(
                    voicingPcs, finalType, rootKeyIndex, bassMidi,
                    prevLhMidi, prevRhMidi, seedHash, DEFAULT_HAND_CONFIG,
                );
                if (hands) {
                    lhMidi = hands.lhMidi;
                    rhMidi = hands.rhMidi;
                    voicing = mergeHands(hands.lhMidi, hands.rhMidi);
                } else {
                    // pcs 太少回退单簇
                    voicing = placeVoicingMidi(voicingPcs, prevVoicing, bassMidi, finalType, rootKeyIndex);
                }
            } else {
                voicing = placeVoicingMidi(voicingPcs, prevVoicing, bassMidi, finalType, rootKeyIndex);
            }

            // 7. Chord symbol display(简易:type === 'maj' 时省略后缀)
            const rootName = spellPcInKey(rootKeyIndex, keyIndex, isMinorKey);
            const chordSymbol = `${rootName}${finalType === 'maj' ? '' : finalType}`;

            // 8. Notes(display,chord-root-relative spelling 让 altered tensions 拼写正确)
            const notes = voicing.map(m =>
                midiToNoteInChord(m, rootKeyIndex, keyIndex, isMinorKey, finalType)
            );

            const duration = step.beats ?? 4;

            out.push({
                root: rootName,
                rootMidi: rootKeyIndex + 48,  // C3 octave
                type: finalType,
                roman: finalRoman,
                bass: midiToNoteInKey(bassMidi, keyIndex, isMinorKey),
                bassMidi,
                notes,
                notesMidi: voicing.slice(),
                duration,
                // M 阶段:Sub-V 后用 final roman 重算;Planner 强制 effectiveFunc 优先
                effectiveFunc: step.effectiveFunc ?? harmonicFunctionFromRoman(finalRoman),
                chordSymbol,
                lhMidi,
                rhMidi,
            });

            prevVoicing = voicing;
            if (lhMidi) prevLhMidi = lhMidi;
            if (rhMidi) prevRhMidi = rhMidi;
        }

        // Post-pass plugin:VoicingSmoother(R + S2 阶段,2026-05-25 拆 plugin)
        //   inversion candidates + phrase-arc bonus,zero PRNG。
        return VoicingSmoother.apply(out);
    },
};
