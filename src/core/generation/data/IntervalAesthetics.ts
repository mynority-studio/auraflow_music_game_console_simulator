// ============================================================
// IntervalAesthetics — 调内音程的 key-relative 紧张/解决表
// ============================================================
//
// 出处:Krumhansl & Kessler 1982 "Tracing the dynamic changes in
// perceived tonal organization in a spatial representation of musical
// keys"。基于 probe-tone 实验得到的 12 个 pitch class 在大/小调下的
// "感知稳定度"分布。tensionAmount 字段是 K-K 实验值的归一化(0..1)。
//
// 与 TendencyTable 的关系:
//   - TendencyTable:chord-relative,每和弦上某 interval 的紧张度(更精细)
//   - IntervalAesthetics:key-relative,调内 12 个 PC 各自对主音的牵引
//   两者是"双层裁决":chord context 优先,但调内 leading-tone 等关键 PC
//   会做交叉校验(如 G7 上的 B 是 chord 3rd / 调内 leading tone)。
//
// Major / Minor 两套独立表:
//   - Major: pc 4 (M3) Home / pc 3 (b3) Color
//   - Minor: pc 4 (M3) Tension(mMaj 入侵)/ pc 3 (b3) Home
//
// 消费方(Batch 1 暂不接):
//   - Batch 2 HarmonicEvaluator(chord-context 之外的次级裁决)
//   - Batch 7 CadenceResolver Tier C(问号 cadence 用 expectedResolutions)
//
// 零 PRNG。仅依赖 Tonality。
//
// Cross-sync:暂无独立条目(数据稳定,不与 enum 强耦合)。
// ============================================================

import { Tonality } from '../types';

/** 音级在调内的功能分类 */
export enum IntervalFunction {
    /** 主音 / 调骨架(1 / 3 / 5 / 1 in min) — 极稳定 */
    Home    = 0,
    /** 属音锚定(5) — 稳定但有"回家"弱牵引 */
    Anchor  = 1,
    /** 调式色彩音(b6 / b7 Aeolian / b3 Major) — 稳定但带情绪 */
    Color   = 2,
    /** 活跃音(2 / 4 / 6) — 中等紧张,可经过可悬挂 */
    Active  = 3,
    /** 紧张音(b2 / #4 / b5) — 强解决期望 */
    Tension = 4,
    /** 导音(7 in Major / Harmonic Minor) — 极强半音上行牵引 */
    Leading = 5,
}

/** 单条 interval 规则 */
export interface IntervalRule {
    /** 半音数 [0, 11](数组索引,本字段冗余但便于调试) */
    semitones: number;
    /** 紧张度 [0, 1](K-K probe-tone 归一化值) */
    tensionAmount: number;
    /** 功能分类 */
    function: IntervalFunction;
    /** 期望解决目标 pcs(相对 keyRoot,空数组表示无强解决方向) */
    expectedResolutions: ReadonlyArray<number>;
}

// ============================================================
// MAJOR profile — K-K 1982 major probe-tone 派生
// ============================================================
//
// 关键校准:
//   pc 0 (1):  tensionAmount=0    Home    无解决
//   pc 1 (b2): tensionAmount=0.95 Tension → 0
//   pc 2 (2):  tensionAmount=0.4  Active  → 0
//   pc 3 (b3): tensionAmount=0.85 Color   → 4 / 2(蓝调弯音色)
//   pc 4 (3):  tensionAmount=0    Home    无解决
//   pc 5 (4):  tensionAmount=0.5  Active  → 4
//   pc 6 (#4): tensionAmount=0.9  Tension → 7
//   pc 7 (5):  tensionAmount=0.1  Anchor  → 0
//   pc 8 (b6): tensionAmount=0.85 Tension → 7(暗淡)
//   pc 9 (6):  tensionAmount=0.4  Active  → 7 / 0
//   pc 10 (b7):tensionAmount=0.85 Tension → 0 / 7
//   pc 11 (7): tensionAmount=0.95 Leading → 0(半音强迫上解)
//
export const INTERVAL_AESTHETICS_MAJOR: ReadonlyArray<IntervalRule> = Object.freeze([
    Object.freeze({ semitones: 0,  tensionAmount: 0.0,  function: IntervalFunction.Home,    expectedResolutions: Object.freeze([]) }),
    Object.freeze({ semitones: 1,  tensionAmount: 0.95, function: IntervalFunction.Tension, expectedResolutions: Object.freeze([0]) }),
    Object.freeze({ semitones: 2,  tensionAmount: 0.4,  function: IntervalFunction.Active,  expectedResolutions: Object.freeze([0]) }),
    Object.freeze({ semitones: 3,  tensionAmount: 0.85, function: IntervalFunction.Color,   expectedResolutions: Object.freeze([4, 2]) }),
    Object.freeze({ semitones: 4,  tensionAmount: 0.0,  function: IntervalFunction.Home,    expectedResolutions: Object.freeze([]) }),
    Object.freeze({ semitones: 5,  tensionAmount: 0.5,  function: IntervalFunction.Active,  expectedResolutions: Object.freeze([4]) }),
    Object.freeze({ semitones: 6,  tensionAmount: 0.9,  function: IntervalFunction.Tension, expectedResolutions: Object.freeze([7]) }),
    Object.freeze({ semitones: 7,  tensionAmount: 0.1,  function: IntervalFunction.Anchor,  expectedResolutions: Object.freeze([0]) }),
    Object.freeze({ semitones: 8,  tensionAmount: 0.85, function: IntervalFunction.Tension, expectedResolutions: Object.freeze([7]) }),
    Object.freeze({ semitones: 9,  tensionAmount: 0.4,  function: IntervalFunction.Active,  expectedResolutions: Object.freeze([7, 0]) }),
    Object.freeze({ semitones: 10, tensionAmount: 0.85, function: IntervalFunction.Tension, expectedResolutions: Object.freeze([0, 7]) }),
    Object.freeze({ semitones: 11, tensionAmount: 0.95, function: IntervalFunction.Leading, expectedResolutions: Object.freeze([0]) }),
]);

// ============================================================
// MINOR profile — K-K 1982 minor probe-tone 派生
// ============================================================
//
// 与 major 的关键区别:
//   pc 3 (b3): Home(从 Color → 自然小调主和弦 3 音)
//   pc 4 (M3): Tension(从 Home → mMaj 入侵,破坏小调质感)
//   pc 8 (b6): Color(从 Tension → Aeolian 自然 b6,可悬挂)
//   pc 10 (b7):Color(从 Tension → Aeolian 自然 b7)
//
export const INTERVAL_AESTHETICS_MINOR: ReadonlyArray<IntervalRule> = Object.freeze([
    Object.freeze({ semitones: 0,  tensionAmount: 0.0,  function: IntervalFunction.Home,    expectedResolutions: Object.freeze([]) }),
    Object.freeze({ semitones: 1,  tensionAmount: 0.95, function: IntervalFunction.Tension, expectedResolutions: Object.freeze([0]) }),
    Object.freeze({ semitones: 2,  tensionAmount: 0.5,  function: IntervalFunction.Active,  expectedResolutions: Object.freeze([0, 3]) }),
    Object.freeze({ semitones: 3,  tensionAmount: 0.1,  function: IntervalFunction.Home,    expectedResolutions: Object.freeze([]) }),
    Object.freeze({ semitones: 4,  tensionAmount: 0.9,  function: IntervalFunction.Tension, expectedResolutions: Object.freeze([3]) }),
    Object.freeze({ semitones: 5,  tensionAmount: 0.5,  function: IntervalFunction.Active,  expectedResolutions: Object.freeze([3, 0]) }),
    Object.freeze({ semitones: 6,  tensionAmount: 0.9,  function: IntervalFunction.Tension, expectedResolutions: Object.freeze([7]) }),
    Object.freeze({ semitones: 7,  tensionAmount: 0.15, function: IntervalFunction.Anchor,  expectedResolutions: Object.freeze([0]) }),
    Object.freeze({ semitones: 8,  tensionAmount: 0.5,  function: IntervalFunction.Color,   expectedResolutions: Object.freeze([7]) }),
    Object.freeze({ semitones: 9,  tensionAmount: 0.7,  function: IntervalFunction.Active,  expectedResolutions: Object.freeze([7]) }),
    Object.freeze({ semitones: 10, tensionAmount: 0.5,  function: IntervalFunction.Color,   expectedResolutions: Object.freeze([0]) }),
    Object.freeze({ semitones: 11, tensionAmount: 0.85, function: IntervalFunction.Leading, expectedResolutions: Object.freeze([0]) }),
]);

// ============================================================
// 派发:Tonality → major / minor profile
// ============================================================
//
// 用 bitmask 一次性分流(C 移植直接复制):
//   MAJOR-family:Major / Major_Pentatonic / Lydian / Mixolydian
//   MINOR-family:其他(Minor / Minor_Pentatonic / Blues / Dorian /
//                       Melodic_Minor / Harmonic_Minor / Phrygian)
//
const TONALITY_MAJOR_LIKE_MASK =
    (1 << Tonality.Major) |
    (1 << Tonality.Major_Pentatonic) |
    (1 << Tonality.Lydian) |
    (1 << Tonality.Mixolydian);

/** 判定 tonality 是否走 major profile */
export function isMajorLikeTonality(tonality: Tonality): boolean {
    return (TONALITY_MAJOR_LIKE_MASK & (1 << tonality)) !== 0;
}

/**
 * 按 tonality 派发到 major / minor profile。
 *
 * @example
 *   selectIntervalAesthetics(Tonality.Major) → INTERVAL_AESTHETICS_MAJOR
 *   selectIntervalAesthetics(Tonality.Dorian) → INTERVAL_AESTHETICS_MINOR(Dorian 走 minor)
 */
export function selectIntervalAesthetics(tonality: Tonality): ReadonlyArray<IntervalRule> {
    return isMajorLikeTonality(tonality) ? INTERVAL_AESTHETICS_MAJOR : INTERVAL_AESTHETICS_MINOR;
}

/**
 * 单点查询 — 给定 (tonality, melodyPc, keyRootPc),返回该 PC 在调内的 IntervalRule。
 * 自动 mod-12 归一化输入。
 */
export function getIntervalAesthetics(
    tonality: Tonality,
    melodyPc: number,
    keyRootPc: number,
): IntervalRule {
    const interval = (((melodyPc - keyRootPc) % 12) + 12) % 12;
    return selectIntervalAesthetics(tonality)[interval];
}
