/**
 * MomentumStage — 物理动量与阻尼系统
 *
 * 完整设计契约见 docs/momentum_stage_design.md。
 *
 * 用途：给 melody 的非 anchor 过渡音注入"运动学惯性"，让上行/下行符合
 * 人类潜意识的物理重力预期，弥补 V3.5 在 anchor 之间过渡音"无状态"的盲区。
 *
 * Pipeline 位置：MelodyEngine 内部，cleanMelodyPostProcessing() 之后、
 *               AnchorDecisionStage.annotate() 之前。
 *
 * Pitch Space: RELATIVE — 输入/输出 NoteData.pitch 都是相对空间。
 * PRNG 消耗: 零（纯确定性算法）。
 * ACVE 影响: stateC/D 不需要重新录制（无 PRNG 消耗）。
 *
 * 阶段 A 实装：无张力耦合，无 StyleConfig 开关，未集成到 MelodyEngine。
 */

import type { NoteData, GeneratedChord } from '../types';
import { Tonality, SCALE_INTERVALS } from '../types';
import { HarmonyCore } from './HarmonyCore';
import type { TensionEnvelope } from './PhraseContourPlanner';

// ═══ 常数（见设计文档 §4.3）═══════════════════════════════════════════════
const MAX_ADJUSTMENT_SEMITONES = 4;   // 单音最大调整幅度（≈ 2 diatonic step）
const LEAP_THRESHOLD = 5;             // 大跳阈值（半音）
const LEAP_DAMPING_DEBT = 2;          // 大跳后强制反向音数
const LEAP_MOMENTUM_MAGNITUDE = 2;    // 大跳后初始动量值
const MOMENTUM_DECAY = 0.7;           // 每音衰减系数
const MOMENTUM_MAX = 3;               // 动量值上限
const MOMENTUM_THRESHOLD = 0.5;       // 触发调整的最小动量（避免微动)
const STREAK_BOOST = 1.5;             // 同向 3 步加速倍数
const STREAK_BUFFER_LEN = 3;          // 同向检测窗口长度
const EPSILON = 1e-6;                 // 浮点比较容差

// 张力耦合（设计文档 §5 Q1 决策 a）
// strength = TENSION_STRENGTH_BASE + TENSION_STRENGTH_GAIN × tension
//   tension=0 (Verse 平稳) → strength 0.5
//   tension=1 (Chorus 顶峰) → strength 1.0
const TENSION_STRENGTH_BASE = 0.5;
const TENSION_STRENGTH_GAIN = 0.5;

// ═══ 内部状态（C 移植友好：无嵌套对象，TypedArray ring buffer）═══════════
interface MomentumState {
    /** 累积动量：signed diatonic step，范围 [-MOMENTUM_MAX, +MOMENTUM_MAX] */
    M: number;
    /** 大跳后必须用 N 个反向级进消耗的债务 */
    dampingDebt: number;
    /** 历史步长 ring buffer（最近 STREAK_BUFFER_LEN 步符号） */
    recentSteps: Int8Array;
    /** ring buffer 写指针 */
    recentIdx: number;
}

export interface MomentumStageContext {
    /** 已清洁的 melody（RELATIVE pitch，原地修改）*/
    notes: NoteData[];
    /** 当前和弦时间轴（RELATIVE）*/
    chords: GeneratedChord[];
    /** 调式 */
    tonality: Tonality;
    /** 张力曲线（可选；缺省时按 strength=1 处理）*/
    tensionEnvelope?: TensionEnvelope;
}

export class MomentumStage {
    /**
     * 主入口：原地修改 ctx.notes 的 pitch（仅对非 anchor 非 grace 的过渡音生效）。
     *
     * 算法概览（详见设计文档 §4）：
     *   1. 遍历相邻音对，计算 chroma step 和 diatonic step
     *   2. 更新动量状态（衰减累积 + 大跳阻尼 + 同向加速）
     *   3. 用动量预测下一音的"应该方向"
     *   4. 把当前音 snap 到 chord-safe scale 上离预测方向最近的合法音
     *   5. 调整幅度 ≤ MAX_ADJUSTMENT_SEMITONES，否则跳过保留原音
     *
     * @param ctx 上下文（注意：notes 会被原地修改）
     * @returns 修改后的 notes 引用（便于链式调用）
     */
    public static smooth(ctx: MomentumStageContext): NoteData[] {
        const { notes, chords, tonality, tensionEnvelope } = ctx;
        if (notes.length < 2 || chords.length === 0) return notes;

        const scaleIntervals = SCALE_INTERVALS[tonality] !== undefined
            ? SCALE_INTERVALS[tonality]
            : SCALE_INTERVALS[Tonality.Major];

        // 预分配状态（C 移植友好，禁热路径 alloc）
        const state: MomentumState = {
            M: 0,
            dampingDebt: 0,
            recentSteps: new Int8Array(STREAK_BUFFER_LEN),
            recentIdx: 0,
        };

        // 缓存当前 chord 的 safeScale（chord 切换才重算）
        let cachedChordIdx = -1;
        let cachedScalePcs: number[] = [];

        for (let i = 1; i < notes.length; i++) {
            const prev = notes[i - 1];
            const curr = notes[i];

            // ─ 跳过保护：anchor 和 grace 不动 ──────────────────
            if (curr.isPreBuiltAnchor === true) {
                MomentumStage.resetMomentum(state);
                continue;
            }
            if (curr.isGraceNote === true) continue;

            // ─ 1. 步长 ────────────────────────────────────────
            const chromaStep = curr.pitch - prev.pitch;
            const diaStep = MomentumStage.chromaToDiatonicStep(chromaStep, scaleIntervals);

            // ─ 2. 更新动量 ────────────────────────────────────
            MomentumStage.updateMomentum(state, diaStep, chromaStep);

            // ─ 3. 计算预测方向 ────────────────────────────────
            const mSign = state.M > EPSILON ? 1 : (state.M < -EPSILON ? -1 : 0);
            const mAbs = Math.abs(state.M);

            // 动量太弱且无阻尼债务 → 跳过（避免微调噪声）
            if (mAbs < MOMENTUM_THRESHOLD && state.dampingDebt === 0) continue;

            // ─ 4. 找当前 chord 的 safeScale（缓存）─────────────
            const chordIdx = MomentumStage.findChordIdx(chords, curr.onset);
            if (chordIdx < 0) continue;
            if (chordIdx !== cachedChordIdx) {
                cachedScalePcs = HarmonyCore.getSafeScalePitches(chords[chordIdx], tonality);
                cachedChordIdx = chordIdx;
            }
            if (cachedScalePcs.length === 0) continue;

            // ─ 5. 计算 strength（张力耦合）─────────────────────
            // 高张力（Chorus）→ 动量效应满；低张力（Verse）→ 半效应
            // 用 sectionLevel(beat) 即可，不需要 phrase 上下文
            const tension = tensionEnvelope !== undefined
                ? MomentumStage.clip(tensionEnvelope.sectionLevel(curr.onset), 0, 1)
                : 1.0;
            const strength = TENSION_STRENGTH_BASE + TENSION_STRENGTH_GAIN * tension;

            // ─ 6. 计算目标 pitch ──────────────────────────────
            let targetPitch: number;
            if (state.dampingDebt > 0 && mSign !== 0) {
                // 阻尼债务：强制反 mSign 方向 1 diatonic step（不受 strength 影响 — 阻尼是硬性的）
                targetPitch = HarmonyCore.shiftDiatonic(curr.pitch, cachedScalePcs, -mSign);
            } else {
                // 软推动：偏移量按 strength 缩放
                const seedPitch = Math.round(curr.pitch - mSign * strength);
                targetPitch = HarmonyCore.snapToScale(seedPitch, cachedScalePcs);
            }

            // ─ 7. 限制调整幅度 ────────────────────────────────
            const adjustment = Math.abs(targetPitch - curr.pitch);
            if (adjustment < EPSILON) continue;  // 没变
            if (adjustment > MAX_ADJUSTMENT_SEMITONES) continue;  // 太激进

            // ─ 8. 应用 ────────────────────────────────────────
            curr.pitch = targetPitch;
            if (state.dampingDebt > 0) state.dampingDebt -= 1;
        }

        return notes;
    }

    // ═══ 内部辅助方法 ════════════════════════════════════════════════════

    private static resetMomentum(state: MomentumState): void {
        state.M = 0;
        state.dampingDebt = 0;
        for (let i = 0; i < STREAK_BUFFER_LEN; i++) state.recentSteps[i] = 0;
        state.recentIdx = 0;
    }

    private static updateMomentum(state: MomentumState, diaStep: number, chromaStep: number): void {
        // 大跳触发阻尼债务（覆盖累积动量）
        if (Math.abs(chromaStep) >= LEAP_THRESHOLD) {
            const sign = chromaStep > 0 ? 1 : -1;
            state.M = -sign * LEAP_MOMENTUM_MAGNITUDE;
            state.dampingDebt = LEAP_DAMPING_DEBT;
            // 大跳后清空 streak buffer
            for (let i = 0; i < STREAK_BUFFER_LEN; i++) state.recentSteps[i] = 0;
            state.recentIdx = 0;
            return;
        }

        // 衰减 + 累积
        state.M = MomentumStage.clip(
            state.M * MOMENTUM_DECAY + diaStep,
            -MOMENTUM_MAX,
            MOMENTUM_MAX,
        );

        // 同向连续 STREAK_BUFFER_LEN 步检测 → 加速
        const stepSign = diaStep > 0 ? 1 : (diaStep < 0 ? -1 : 0);
        state.recentSteps[state.recentIdx] = stepSign;
        state.recentIdx = (state.recentIdx + 1) % STREAK_BUFFER_LEN;

        if (stepSign !== 0) {
            let allSame = true;
            for (let i = 0; i < STREAK_BUFFER_LEN; i++) {
                if (state.recentSteps[i] !== stepSign) { allSame = false; break; }
            }
            if (allSame) {
                state.M = MomentumStage.clip(
                    state.M * STREAK_BOOST,
                    -MOMENTUM_MAX,
                    MOMENTUM_MAX,
                );
            }
        }
    }

    /**
     * 半音 step → 音阶级 step（带符号）。
     * 仅在 |chromaStep| < LEAP_THRESHOLD 时调用，超出 LEAP_THRESHOLD 走 leap 分支。
     */
    private static chromaToDiatonicStep(chromaStep: number, scaleIntervals: number[]): number {
        if (chromaStep === 0) return 0;
        const sign = chromaStep > 0 ? 1 : -1;
        const abs = Math.abs(chromaStep);

        // 在 scaleIntervals 中找首个 >= abs 的索引（音阶级数）
        // SCALE_INTERVALS[Major] = [0, 2, 4, 5, 7, 9, 11]
        // chromaStep 1 → degree 1（chromatic 半音视作 1 度，不严格但够用）
        // chromaStep 2 → degree 1
        // chromaStep 4 → degree 2
        for (let d = 1; d < scaleIntervals.length; d++) {
            if (scaleIntervals[d] >= abs) return sign * d;
        }
        // 罕见兜底（leap 分支已挡 |chromaStep| >= LEAP_THRESHOLD）
        return sign * scaleIntervals.length;
    }

    /**
     * 找包含 beat 的 chord 索引（线性扫描，N 通常 < 32）。
     * 边界规则：startBeat 包含、endBeat 排除。
     */
    private static findChordIdx(chords: GeneratedChord[], beat: number): number {
        for (let i = 0; i < chords.length; i++) {
            const c = chords[i];
            if (beat >= c.startBeat - EPSILON && beat < c.endBeat - EPSILON) return i;
        }
        return -1;
    }

    private static clip(v: number, lo: number, hi: number): number {
        if (v < lo) return lo;
        if (v > hi) return hi;
        return v;
    }
}
