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
    CHORD_TYPES, placeVoicingMidi, BASS_RANGE,
    KEYS, harmonicFunctionFromRoman, spellPcInKey, midiToNoteInKey, midiToNoteInChord,
    assembleVoicing,
    STYLE_FULL, STYLE_ROOTLESS, STYLE_CLUSTER, STYLE_BLUES,
    type VoicingStylePreference,
} from './music-theory';
import { Random } from './utils/Random';
import type { ChordDef } from './types/ChordDef';
import type { Af2AbstractStep } from './Af2Arranger';
import type { MgStyle } from '../../../state/EngineSelectionStore';
import {
    DYNAMIC_TSD_DICTIONARY,
    COLOR_LEVEL_PROBABILITIES,
    analyzeTargetQuality,
    type TSD_Func,
} from './DynamicHarmony';

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
// M 阶段:per-mgStyle 默认 compingVoicingMode
// ============================================================
//
//   POP   → STYLE_FULL     (5 voice,包 root,vocal-style 完整 voicing)
//   JAZZ  → STYLE_ROOTLESS (4 voice,无 root,Bill Evans A/B-position 自动加 9)
//   BLUES → STYLE_BLUES    (4 voice,包 root,boogie comping)
//   RNB   → STYLE_CLUSTER  (4 voice,无 root,Neo-soul/D'Angelo cluster + 9)
//
// 用 assembleVoicing(已带 clash detection + density priority drop)替换原
// 简陋的 `intervals.map(iv => (root + iv) % 12)`,听感:
//   - JAZZ 钢琴 comping 不再 doubles root,腾出 bass 频段
//   - RNB 自动密集 cluster + 9 — neo-soul 标志
//   - POP 完整 5 voice — vocal-style chord support
//   - BLUES 不加色 — boogie 干净 4 voice
// ============================================================

const DEFAULT_VOICING_MODE_BY_STYLE: Record<MgStyle, VoicingStylePreference> = {
    POP:   STYLE_FULL,
    JAZZ:  STYLE_ROOTLESS,
    BLUES: STYLE_BLUES,
    RNB:   STYLE_CLUSTER,
};

interface DecorateResult {
    type: string;
    rootOffsetOverride?: number;
    romanOverride?: string;
}

function decorateChordType(
    step: Af2AbstractStep,
    next: Af2AbstractStep,
    mgStyle: MgStyle,
    rng: Random,
): DecorateResult {
    // Locked slot — Planner(borrow/tonicize)已设 exact type。
    // 仍消耗 1 + 1 random 保持 stream 稳定(roll + pick)。
    if (step.lockType) {
        rng.next();
        rng.next();
        return { type: step.type };
    }

    // 1. Roll colorLevel
    const probs = COLOR_LEVEL_PROBABILITIES[mgStyle];
    const r = rng.next();
    let colorLevel: 0 | 1 | 2 = 0;
    if (r < probs.level0) colorLevel = 0;
    else if (r < probs.level0 + probs.level1) colorLevel = 1;
    else colorLevel = 2;

    // 2. Functional analysis(currFunc 优先用 Planner 标的 effectiveFunc)
    const currFunc: TSD_Func = step.effectiveFunc ?? harmonicFunctionFromRoman(step.roman);
    const nextFunc: TSD_Func = next.effectiveFunc ?? harmonicFunctionFromRoman(next.roman);
    const targetQuality = analyzeTargetQuality(currFunc, nextFunc, next.roman, next.type);

    // 3. Dynamic dictionary lookup
    const rules = DYNAMIC_TSD_DICTIONARY[mgStyle]?.[currFunc];
    let choices: string[] | undefined;
    let isTritoneSub = false;

    if (rules) {
        const rule = rules.find(rl => rl.target === targetQuality)
            ?? rules.find(rl => rl.target === 'Default');
        if (rule && rule.levels[colorLevel]) {
            choices = rule.levels[colorLevel];

            // 4. Tritone Substitution probability gate
            // Conditional random:只在 look-ahead AND tritoneProb 都存在 + D-function
            // AND non-deceptive 时 consume。determinism 只在 substitution-eligible 处 vary。
            if (rule.tritoneProb && currFunc === 'D' && targetQuality !== 'Deceptive') {
                const rootDelta = (((next.rootOffset - step.rootOffset) % 12) + 12) % 12;
                if (rootDelta === 5 && rng.next() < rule.tritoneProb) {
                    isTritoneSub = true;
                }
            }
        }
    }

    // 5. Pick(若无 choices,保留原 step.type;仍消耗 1 random 保持稳定)
    let finalType: string;
    if (choices && choices.length > 0) {
        finalType = rng.pick(choices);
    } else {
        rng.next();
        finalType = step.type;
    }

    // 6. Data-debt guard:dictionary 引用未注册的 chord type → 按 function downgrade
    if (!CHORD_TYPES[finalType]) {
        if (currFunc === 'D') finalType = '7';
        else if (currFunc === 'S') finalType = targetQuality === 'MinorTarget' ? 'm7' : 'maj7';
        else finalType = targetQuality === 'MinorTarget' ? 'min' : 'maj';
    }

    // 7. Sub-V override — Lydian Dominant family。静态 map colorLevel
    // 避免 '7#9#11' monster + 不消耗额外 random。
    if (isTritoneSub) {
        let subVType: string;
        if (colorLevel === 0) subVType = '7';
        else if (colorLevel === 1) subVType = '9';
        else subVType = targetQuality === 'MinorTarget' ? '7#11' : '13';

        return {
            type: subVType,
            rootOffsetOverride: ((step.rootOffset + 6) % 12 + 12) % 12,
            romanOverride: `subV/${next.roman.split('/')[0]}`,
        };
    }

    return { type: finalType };
}

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
        mgStyle?: MgStyle,
        rng?: Random,
    ): ChordDef[] {
        const keyIndex = Math.max(0, KEYS.indexOf(key));
        const out: ChordDef[] = [];
        let prevVoicing: number[] = [];

        for (let i = 0; i < abstractPath.length; i++) {
            const step = abstractPath[i];
            // M 阶段:Look-ahead next chord(最后 step 看自己,Default target)
            const next = abstractPath[i + 1] ?? step;

            // 1. M 阶段 decorate — Dynamic TSD 选 chord type + 可选 Sub-V override
            //    没传 mgStyle/rng 退化原 step.type
            let finalType: string = step.type;
            let finalRootOffset: number = step.rootOffset;
            let finalRoman: string = step.roman;
            if (mgStyle && rng) {
                const decorated = decorateChordType(step, next, mgStyle, rng);
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

            // 3 + 4. M 阶段:assembleVoicing 替代原"intervals.map + dedupe"。
            //   引入 per-mgStyle voicing mode(STYLE_FULL/ROOTLESS/CLUSTER/BLUES)
            //   走完整 pipeline:CHORD_TYPES → addColorOnTriad → clash detection →
            //   rootPolicy(omit/include)→ density cap with priority drop。
            //   未传 mgStyle 退化 STYLE_FULL(含 root,无 add-color,5 voice cap)。
            const voicingMode = mgStyle
                ? DEFAULT_VOICING_MODE_BY_STYLE[mgStyle]
                : STYLE_FULL;
            const voicingPcs = assembleVoicing(finalType, rootKeyIndex, voicingMode);

            // 5. Bass MIDI:root pc clamp 到 BASS_RANGE
            let bassMidi = rootKeyIndex + 36; // C2 区间起步
            while (bassMidi < BASS_RANGE.LOW) bassMidi += 12;
            while (bassMidi > BASS_RANGE.HIGH) bassMidi -= 12;
            if (bassMidi < BASS_RANGE.LOW) bassMidi = BASS_RANGE.LOW;
            if (bassMidi > BASS_RANGE.HIGH) bassMidi = BASS_RANGE.HIGH;

            // 6. Voice-leading placement(music-theory helper)
            const voicing = placeVoicingMidi(
                voicingPcs, prevVoicing, bassMidi, finalType, rootKeyIndex,
            );

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
            });

            prevVoicing = voicing;
        }
        return out;
    },
};
