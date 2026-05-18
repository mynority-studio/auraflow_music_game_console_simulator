/**
 * PassingChordEngine — 经过和弦插入式生成器（V3.1）
 *
 * 与 MacroProgressionEngine 的 4 道变异门职责互补：
 *   - MacroProgression（Stage 3）："替换" — 把当前和弦改成 V7/next 等
 *   - PassingChord（Stage 3.5）："插入" — 在 phrase boundary 之间切出过渡和弦
 *
 * 设计哲学（移植自 SampleDEMO.md PassingChordPlugin）：
 *   1. **乐句感知**：仅在 4-bar / 2-bar phrase 末端触发，phrase 中间几乎不动（5%）
 *   2. **时长变化**：1.0 / 2.0 / 0.5 拍三选一（最后那个是切分前置 push）
 *   3. **目标导向**：从下个和弦（target）反推过渡，不是从当前和弦正向推
 *   4. **5 大技法路由**：bass walkdown / 顺阶 7th / V7/next / SubV7 平行滑移 / viio7/next
 *   5. **Micro ii-V Enclosure**：25% 概率把单经过位裂成 ii-V 双经过（pro 爵士）
 *
 * Pitch Space: PC (0-11)
 *
 * PRNG 消耗：变长 — 每和弦最多 ~6 次（触发判定 + 时长 + 技法路由 + 转位选择 + ii-V 裂变）
 *   触发率低于 20%，期望消耗约 1.5 次/和弦
 *
 * 约束遵从：
 *   D-1: PRNG 来自 PRNGManager
 *   D-3: 不排序（caller 按 startBeat 自然时序）
 *   P-1: 输出 flat array
 *   S-3: 全同步纯函数
 *   T-3: 无 any
 *
 * @author AuraFlow Tap! BandEngine V3.1
 */

import {
    GeneratedChord, ChordQuality, Tonality,
} from '../types';
import { PRNGManager } from '../../utils/PRNG';
import { getScalePCsFromRoot, snapToPool } from '../data/ScaleHelpers';

const EPSILON = 1e-6;
const TWO_BAR_BEATS = 8;
const FOUR_BAR_BEATS = 16;
const PHRASE_END_BASE_PROB_SCALE = 0.05;
const PHRASE_END_4BAR_SCALE = 0.9;
const PHRASE_END_2BAR_SCALE = 0.4;
const MICRO_II_V_PROB = 0.25;

// ============================================================
// 公开 API
// ============================================================

export interface PassingChordEngineInput {
    /** Stage 3 HarmonyCore 输出的和弦序列（已带 voicing；passing chord 输出时 voicing 留空，由下游 voicer 补） */
    chords: GeneratedChord[];
    /** 调式 — 决定顺阶 7th 各级 quality 映射（Major: I/IV→Maj7, V→Dom7, vii→HalfDim, 余 Min7） */
    tonality: Tonality;
    /** 全曲 keyOffset（透传到新 chord） */
    keyOffset: number;
    /** 经过和弦总概率（来自 StyleConfig.passingChordProb，默认 0.3） */
    passingChordProb: number;
    /** 离调比例（D/E 派系），默认 0.4 */
    chromaticPassingProb: number;
}

export class PassingChordEngine {
    /**
     * 在 chords 之间插入经过和弦，返回新数组（可能长度 > chords.length）。
     *
     * 实际逻辑：
     *   每和弦扫描 → phrase boundary 检测 → 触发概率掷骰 → 时长决定 → 切分原和弦 → 选技法路由 → 输出
     *
     * 例：原 chords = [Cmaj7(0-4), Fmaj7(4-8)]
     *     若触发 V7/next：[Cmaj7(0-3), C7(3-4, V7/F), Fmaj7(4-8)]
     */
    public static insert(input: PassingChordEngineInput): GeneratedChord[] {
        const {
            chords, tonality, keyOffset,
            passingChordProb, chromaticPassingProb,
        } = input;

        if (passingChordProb <= EPSILON || chords.length === 0) return chords.slice();

        const result: GeneratedChord[] = [];

        for (let i = 0; i < chords.length; i++) {
            const bc = chords[i];
            const nextBc = i + 1 < chords.length ? chords[i + 1] : null;
            const duration = bc.endBeat - bc.startBeat;

            // 仅当：① 有下个和弦 ② 不同 root ③ 当前 ≥ 2 拍才有空间切
            if (nextBc !== null && bc.root !== nextBc.root && duration >= 2 - EPSILON) {

                // ---- Phrase 边界检测（仅在 4-bar / 2-bar 末端高概率触发） ----
                const isEndOf4BarPhrase = Math.abs(bc.endBeat % FOUR_BAR_BEATS) < EPSILON;
                const isEndOf2BarPhrase = !isEndOf4BarPhrase
                    && Math.abs(bc.endBeat % TWO_BAR_BEATS) < EPSILON;

                let prob = passingChordProb * PHRASE_END_BASE_PROB_SCALE;
                if (isEndOf4BarPhrase) prob = passingChordProb * PHRASE_END_4BAR_SCALE;
                else if (isEndOf2BarPhrase) prob = passingChordProb * PHRASE_END_2BAR_SCALE;

                if (PRNGManager.next() < prob) {
                    // ---- 时长决定（1.0 / 2.0 / 0.5） ----
                    const durRoll = PRNGManager.next();
                    let passingDur = 1.0;
                    if (duration >= 4 - EPSILON && durRoll > 0.8) passingDur = 2.0;
                    else if (durRoll < 0.3) passingDur = 0.5;

                    const splitPoint = bc.endBeat - passingDur;

                    // 切原和弦
                    result.push({ ...bc, endBeat: splitPoint });

                    // ---- Micro ii-V Enclosure 优先判定 ----
                    const allowChromatic = PRNGManager.next() < chromaticPassingProb;
                    if (passingDur >= 1.0 - EPSILON && allowChromatic && PRNGManager.next() < MICRO_II_V_PROB) {
                        PassingChordEngine.emitMicroIIV(result, splitPoint, bc.endBeat, passingDur, nextBc, keyOffset);
                        continue;
                    }

                    // ---- 5 大技法路由 ----
                    // 用一个 PRNG 调用决定 pType
                    let pType = PRNGManager.next();
                    if (!allowChromatic) {
                        // 禁离调时强制走顺阶 / slash 派系（A + B）
                        pType *= 0.4;
                    }

                    const passing = PassingChordEngine.routePassingChord(
                        pType, bc, nextBc, tonality, splitPoint, keyOffset,
                    );
                    result.push(passing);
                    continue;
                }
            }

            result.push(bc);
        }

        return result;
    }

    // ============================================================
    // 5 大技法 + Micro ii-V
    // ============================================================

    private static routePassingChord(
        pType: number,
        bc: GeneratedChord,
        nextBc: GeneratedChord,
        tonality: Tonality,
        splitPoint: number,
        keyOffset: number,
    ): GeneratedChord {
        if (pType < 0.2) {
            return PassingChordEngine.bassWalkdown(bc, nextBc, tonality, splitPoint, keyOffset);
        }
        if (pType < 0.4) {
            return PassingChordEngine.diatonicSeventh(nextBc, tonality, splitPoint, bc.endBeat, keyOffset);
        }
        if (pType < 0.65) {
            return PassingChordEngine.secondaryDominant(nextBc, splitPoint, bc.endBeat, keyOffset);
        }
        if (pType < 0.85) {
            // D 派系内部二分（平行滑移 vs SubV7）
            return PRNGManager.next() > 0.5
                ? PassingChordEngine.parallelPlaning(nextBc, splitPoint, bc.endBeat, keyOffset)
                : PassingChordEngine.subDominant(nextBc, splitPoint, bc.endBeat, keyOffset);
        }
        return PassingChordEngine.diminishedApproach(nextBc, splitPoint, bc.endBeat, keyOffset);
    }

    /**
     * 技法 A — Pop Bass Walkdown (Slash Chord)：保持当前和弦不变，只移 bass voice。
     * 例：C → C/E → F（四度上行强进行 = 第一转位 bass = root + maj 3rd）
     */
    private static bassWalkdown(
        bc: GeneratedChord,
        nextBc: GeneratedChord,
        tonality: Tonality,
        splitPoint: number,
        keyOffset: number,
    ): GeneratedChord {
        let diff = nextBc.root - bc.root;
        if (diff < -6) diff += 12;
        if (diff > 6) diff -= 12;

        let bassOverride: number;
        if (diff === 5 || diff === -7) {
            // 四度上行强进行 → 第一转位 (root + maj 3rd)
            bassOverride = (bc.root + 4) % 12;
        } else {
            const stepDir = diff >= 0 ? 1 : -1;
            const stepPc = (bc.root + stepDir * 2 + 12) % 12;
            const scalePcs = getScalePCsFromRoot(0, tonality);  // 调内 PC（C 大调相对）
            bassOverride = ((snapToPool(stepPc, scalePcs) % 12) + 12) % 12;
        }

        return {
            numeral: 'slash/walk',
            root: bc.root,
            quality: bc.quality,
            startBeat: splitPoint,
            endBeat: bc.endBeat,
            keyOffset,
            bassOverride,
        };
    }

    /**
     * 技法 B — 目标导向顺阶 7 和弦：从 next chord 反推台阶（上/下一级），按调内 scale degree 选 quality。
     */
    private static diatonicSeventh(
        nextBc: GeneratedChord,
        tonality: Tonality,
        splitPoint: number,
        endBeat: number,
        keyOffset: number,
    ): GeneratedChord {
        const approachDir = PRNGManager.next() > 0.5 ? 1 : -1;
        const scalePcs = getScalePCsFromRoot(0, tonality);
        const targetIdx = scalePcs.indexOf(((nextBc.root % 12) + 12) % 12);

        let passingRoot: number;
        let passingQuality: ChordQuality;

        if (targetIdx !== -1) {
            const passIdx = (targetIdx + approachDir + scalePcs.length) % scalePcs.length;
            passingRoot = scalePcs[passIdx];

            // 按调式 + scale degree 选 quality
            if (tonality === Tonality.Major) {
                if (passIdx === 0 || passIdx === 3) passingQuality = ChordQuality.Major7;
                else if (passIdx === 4) passingQuality = ChordQuality.Dominant7;
                else if (passIdx === 6) passingQuality = ChordQuality.HalfDiminished;
                else passingQuality = ChordQuality.Minor7;
            } else {
                if (passIdx === 2 || passIdx === 5) passingQuality = ChordQuality.Major7;
                else if (passIdx === 4) passingQuality = ChordQuality.Minor7;
                else if (passIdx === 1) passingQuality = ChordQuality.HalfDiminished;
                else passingQuality = ChordQuality.Minor7;
            }
        } else {
            passingRoot = ((nextBc.root + approachDir * 2 + 12) % 12 + 12) % 12;
            passingQuality = ChordQuality.Minor7;
        }

        return {
            numeral: 'pass(diat7)',
            root: passingRoot,
            quality: passingQuality,
            startBeat: splitPoint,
            endBeat,
            keyOffset,
        };
    }

    /**
     * 技法 C — 副属和弦 V7/next：目标上方纯五度的 Dom7。40% 概率第一转位（bass 半音上行）。
     */
    private static secondaryDominant(
        nextBc: GeneratedChord,
        splitPoint: number,
        endBeat: number,
        keyOffset: number,
    ): GeneratedChord {
        const passingRoot = (nextBc.root + 7) % 12;
        const passingQuality = PRNGManager.next() > 0.5 ? ChordQuality.Dominant9 : ChordQuality.Dominant7;
        const useInversion = PRNGManager.next() > 0.6;

        return {
            numeral: 'V7/next',
            root: passingRoot,
            quality: passingQuality,
            startBeat: splitPoint,
            endBeat,
            keyOffset,
            ...(useInversion ? { bassOverride: (passingRoot + 4) % 12 } : {}),
        };
    }

    /**
     * 技法 D-1 — 平行滑移 (Parallel Planing)：复制 next chord 的 quality，root 半音邻（Neo-Soul 绝技）。
     */
    private static parallelPlaning(
        nextBc: GeneratedChord,
        splitPoint: number,
        endBeat: number,
        keyOffset: number,
    ): GeneratedChord {
        const dir = PRNGManager.next() > 0.5 ? 1 : -1;
        const passingRoot = ((nextBc.root + dir + 12) % 12);

        return {
            numeral: 'planing',
            root: passingRoot,
            quality: nextBc.quality,
            startBeat: splitPoint,
            endBeat,
            keyOffset,
        };
    }

    /**
     * 技法 D-2 — SubV7：目标上方小二度的 Dom7（三全音替代）。
     */
    private static subDominant(
        nextBc: GeneratedChord,
        splitPoint: number,
        endBeat: number,
        keyOffset: number,
    ): GeneratedChord {
        const passingRoot = (nextBc.root + 1) % 12;
        return {
            numeral: 'subV7/next',
            root: passingRoot,
            quality: ChordQuality.Dominant7,
            startBeat: splitPoint,
            endBeat,
            keyOffset,
        };
    }

    /**
     * 技法 E — 减七度导音逼近 (viio7/next)：目标下方半音的 Dim7。
     */
    private static diminishedApproach(
        nextBc: GeneratedChord,
        splitPoint: number,
        endBeat: number,
        keyOffset: number,
    ): GeneratedChord {
        const passingRoot = ((nextBc.root - 1 + 12) % 12);
        const useInv = PRNGManager.next() > 0.5;
        return {
            numeral: 'viio7/next',
            root: passingRoot,
            quality: ChordQuality.Diminished7,
            startBeat: splitPoint,
            endBeat,
            keyOffset,
            ...(useInv ? { bassOverride: passingRoot } : {}),
        };
    }

    /**
     * Micro ii-V Enclosure — 把一个经过位裂成 ii-V 双经过（25% 概率触发）。
     *   ii  = nextBc.root + 2（major: Min7, target minor: HalfDim）
     *   V/SubV = nextBc.root + 7（70% 概率） / nextBc.root + 1（30% SubV7）
     */
    private static emitMicroIIV(
        result: GeneratedChord[],
        splitPoint: number,
        endBeat: number,
        passingDur: number,
        nextBc: GeneratedChord,
        keyOffset: number,
    ): void {
        const halfDur = passingDur / 2;
        const isTargetMinor = nextBc.quality === ChordQuality.Minor
            || nextBc.quality === ChordQuality.Minor7
            || nextBc.quality === ChordQuality.Minor9
            || nextBc.quality === ChordQuality.HalfDiminished;

        // 裂变一：ii of next
        result.push({
            numeral: isTargetMinor ? 'iiø/next' : 'ii7/next',
            root: (nextBc.root + 2) % 12,
            quality: isTargetMinor ? ChordQuality.HalfDiminished : ChordQuality.Minor7,
            startBeat: splitPoint,
            endBeat: splitPoint + halfDur,
            keyOffset,
        });

        // 裂变二：V7 of next (70%) or SubV7 (30%)
        const useSubV = PRNGManager.next() > 0.7;
        result.push({
            numeral: useSubV ? 'subV7/next' : 'V7/next',
            root: useSubV ? (nextBc.root + 1) % 12 : (nextBc.root + 7) % 12,
            quality: ChordQuality.Dominant7,
            startBeat: splitPoint + halfDur,
            endBeat,
            keyOffset,
        });
    }
}

// ============================================================
// Error
// ============================================================

export class PassingChordEngineError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'PassingChordEngineError';
        this.context = context;
    }
}
