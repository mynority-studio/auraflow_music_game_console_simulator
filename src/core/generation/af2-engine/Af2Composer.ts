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
    CHORD_TYPES, placeVoicingMidi, BASS_RANGE, CHORD_RANGE,
    KEYS, harmonicFunctionFromRoman, spellPcInKey, midiToNoteInKey, midiToNoteInChord,
    assembleVoicing,
    STYLE_FULL, STYLE_ROOTLESS, STYLE_CLUSTER, STYLE_BLUES, STYLE_SHELL,
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
import type { SubStyle } from './SubStyleTextures';

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

// P6 阶段:per-sub-style voicing mode override(15 个)
// mg 显式标的(Pop Ballad/Jazz Swing/Dominant Blues/Minor Blues/Neo Soul)按 mg;
// 其他按风格特征推断:
//   Bossa Nova → 'rootless'(bass 担 root,piano 不重复)
//   Jazz Chromatic Drop → 'rootless'(同 Jazz)
//   Modern Stadium Pop → 'full'(Coldplay vocal-style 完整)
//   Modern Trap → 'shell'(冰冷简洁,4 voice 含 root)
//   Gospel Neo-Soul → 'cluster'(同 Neo Soul)
//   Motown Soul → 'full'(motown 钢琴用根音 + 完整 chord,不 rootless)
const SUB_STYLE_VOICING_MODE: Partial<Record<SubStyle, VoicingStylePreference>> = {
    // POP
    PopBallad:         STYLE_FULL,      // mg 显式
    SynthPop:          STYLE_FULL,
    MaxMartinPop:      STYLE_FULL,
    AsianPopWalkdown:  STYLE_FULL,
    ModernStadiumPop:  STYLE_FULL,      // Coldplay vocal
    ModernTrap:        STYLE_SHELL,     // 简洁 4 voice 含 root
    // JAZZ
    JazzSwing:         STYLE_ROOTLESS,  // mg 显式 — Bill Evans
    JazzChromaticDrop: STYLE_ROOTLESS,
    BossaNova:         STYLE_ROOTLESS,  // bossa bass 担 root
    // BLUES
    DominantBlues:     STYLE_BLUES,     // mg 显式
    MinorBlues:        STYLE_BLUES,     // mg 显式
    BluesTurnaround:   STYLE_BLUES,
    // RNB
    NeoSoulRnB:        STYLE_CLUSTER,   // mg 显式 — D'Angelo
    GospelNeoSoul:     STYLE_CLUSTER,
    MotownSoul:        STYLE_FULL,      // motown 钢琴完整 voicing
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

// ============================================================
// R 阶段(2026-05-24):跨 chord voice leading 全局 smoother
// ============================================================
//
// Composer 主循环已有 placeVoicingMidi 局部 voice leading(基于 prev),
// 但只 forward-aware,不看 next。R 阶段加 post-pass smoother:
//   对每 chord(除首尾),试 4 个 inversion variants(整体 octave 移位):
//     - lift bottom +12 / +24    最低音上移八度
//     - drop top    -12 / -24    最高音下移八度
//   保 pc 集不变(只调 octave 不改音名)。
//   选 min cost = L1(prev, candidate) + L1(candidate, next)
//
// 工程影响:
//   - PRNG 消耗:0(deterministic hill-climbing)
//   - O(N × 5) 时间;N 通常 16-32 chord,跑一遍 < 1ms
//   - 不影响 bassMidi(独立由 chord.bassMidi 决定)
//   - 不重算 notes display(notesMidi 是 audio truth,notes 是 UI 标签)
// ============================================================

/**
 * 两个 voicing(已 sort)之间的 L1 距离 + 长度差异 penalty
 */
function voicingL1(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
    if (a.length === 0 || b.length === 0) return 0;
    let sum = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
    sum += Math.abs(a.length - b.length) * 4;  // 长度差 penalty
    return sum;
}

/**
 * 生成 voicing 的 inversion candidates(原 + 4 个 octave-shift 变体)。
 * 所有 candidate 保 pc 集不变,只调单音 octave。
 * 越界(CHORD_RANGE [48, 81])的 candidate 过滤。
 */
function generateInversionCandidates(voicing: ReadonlyArray<number>): number[][] {
    if (voicing.length === 0) return [voicing.slice()];
    const candidates: number[][] = [voicing.slice()];

    const lastIdx = voicing.length - 1;

    // Lift bottom +12 / +24
    for (const lift of [12, 24]) {
        const lifted = voicing.slice();
        lifted[0] += lift;
        if (lifted[0] <= CHORD_RANGE.HIGH) {
            lifted.sort((a, b) => a - b);
            candidates.push(lifted);
        }
    }
    // Drop top -12 / -24
    for (const drop of [12, 24]) {
        const dropped = voicing.slice();
        dropped[lastIdx] -= drop;
        if (dropped[lastIdx] >= CHORD_RANGE.LOW) {
            dropped.sort((a, b) => a - b);
            candidates.push(dropped);
        }
    }
    return candidates;
}

/**
 * Post-pass smoother:in-place 更新每 chord(除首尾)的 notesMidi 为最优 inversion。
 * 跑一遍,O(N × 5)。
 */
function smoothChordVoicings(out: ChordDef[]): void {
    if (out.length < 3) return;  // 无 prev+next 上下文,跳过
    for (let i = 1; i < out.length - 1; i++) {
        const prev = out[i - 1].notesMidi;
        const next = out[i + 1].notesMidi;
        const curr = out[i].notesMidi;
        const candidates = generateInversionCandidates(curr);

        let bestVoicing = curr;
        let bestCost = voicingL1(prev, curr) + voicingL1(curr, next);
        for (let c = 1; c < candidates.length; c++) {
            const cand = candidates[c];
            const cost = voicingL1(prev, cand) + voicingL1(cand, next);
            if (cost < bestCost) {
                bestVoicing = cand;
                bestCost = cost;
            }
        }

        if (bestVoicing !== curr) {
            // 替换 notesMidi(notes display 标签保持旧 octave — UI 用,不影响音频)
            out[i] = { ...out[i], notesMidi: bestVoicing };
        }
    }
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
        subStyle?: SubStyle,
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

            // 3 + 4. assembleVoicing:M 阶段 per-mgStyle voicing mode +
            //   P6 阶段 per-sub-style override(优先 sub-style 配置)。
            //   STYLE_FULL / ROOTLESS / CLUSTER / BLUES / SHELL — 5 mode
            //   走完整 pipeline:CHORD_TYPES → addColorOnTriad → clash detection →
            //   rootPolicy(omit/include)→ density cap with priority drop。
            //   未传 mgStyle 退化 STYLE_FULL。
            const voicingMode = (subStyle && SUB_STYLE_VOICING_MODE[subStyle])
                ?? (mgStyle ? DEFAULT_VOICING_MODE_BY_STYLE[mgStyle] : STYLE_FULL);
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

        // R 阶段:post-pass voice leading smoother(0 PRNG,deterministic)
        //   forward pass 完后,对每 chord 试 inversion variants,选 min
        //   L1(prev, candidate) + L1(candidate, next) — 消除跨 chord 大跳。
        smoothChordVoicings(out);

        return out;
    },
};
