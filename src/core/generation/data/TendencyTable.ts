// ============================================================
// TendencyTable — Chord-context interval tendency 72 项表
// ============================================================
//
// 出处:melodygenerative TENDENCY_TABLE — Levine 1995 / Berklee 功能和声
// 课程派生。每条目说"在某 chord scenario 上,某 interval 是什么角色
// (CT/T/A),迫切度多高,该解决到哪"。
//
// 6 个 scenario × 12 interval = 72 entries。Batch 1 移植的核心数据。
//
// 关键设计:
//   - 索引 = ChordScenario(数值 enum)× interval(0-11)
//   - 每条目:state ∈ {ChordTone, Tension, Avoid},gravity ∈ [0, 1],
//     targets ∈ ReadonlyArray<number>(相对 chord root)
//
// 为什么需要这张表(vs auraflow 现有 CHORD_INTERVALS + CHORD_SCALE_INTERVALS):
//   - 现有表只告诉"和弦音 / scale 音"二分类
//   - TendencyTable 进一步细分"chord tone / tension / avoid",并给出
//     gravity(解决迫切度)+ 具体 targets(该往哪解决)
//   - 同一个 PC 在不同 scenario 上行为不同(Cmaj7 的 F = avoid,Dm7 的 F = chord tone)
//
// 与 IntervalAesthetics 的关系:
//   - IntervalAesthetics:key-relative,调内 12 PC 各自的牵引(粗粒度)
//   - TendencyTable:chord-relative,具体到当前和弦 + 功能(细粒度)
//   双层裁决,chord context 优先。
//
// 消费方(Batch 1 暂不接):
//   - Batch 2 HarmonicEvaluator(主消费,evaluateNoteInChordContext)
//   - Batch 7 sacred boundary magnetism(长音吸到 vacated extension)
//
// 零 PRNG。依赖 ChordQuality + CQ_IS_* bitmask。
//
// Cross-sync:跟 ChordQuality enum 数值绑定(分类函数 resolveChordScenario)。
// Cross-sync §1.4 已涵盖(ChordQuality 改顺序需同步本文件)。
// ============================================================

import { ChordQuality, CQ_IS_DOM, CQ_IS_MAJOR, CQ_IS_MINOR, CQ_IS_DIM } from '../types';

// ============================================================
// Enum
// ============================================================

/**
 * 6 个 chord scenario:
 *   M7T — Maj base at Tonic (Cmaj7 / Cmaj / Cmaj9 in I)
 *   M7S — Maj base at Subdominant (Fmaj7 in IV)
 *   m7S — Min base at Subdominant (Dm7 in ii;Dorian birthright)
 *   m7T — Min base at Tonic (Am7 in vi / i;Aeolian)
 *   Dom — Dom base anywhere (G7 / V/X / subV/X)
 *   Sus — Suspended (sus2 / sus4 / 7sus4 / 9sus)
 */
export enum ChordScenario {
    M7T = 0,
    M7S = 1,
    m7S = 2,
    m7T = 3,
    Dom = 4,
    Sus = 5,
}

export const ChordScenarioCount = 6;

export const ChordScenarioName: ReadonlyArray<string> = Object.freeze([
    'M7T', 'M7S', 'm7S', 'm7T', 'Dom', 'Sus',
]);

/** chord-context 下的音级角色 */
export enum TendencyState {
    /** Chord Tone — 协和音,无需解决 */
    ChordTone = 0,
    /** Tension — 张力音,可悬挂可解决,gravity 决定迫切度 */
    Tension   = 1,
    /** Avoid — 必须解决(否则破坏 chord identity) */
    Avoid     = 2,
}

/** 单条 tendency 条目 */
export interface TendencyEntry {
    state: TendencyState;
    /** [0, 1] 解决迫切度 */
    gravity: number;
    /** 解决目标 pcs(相对 chord root,空数组表示无具体方向) */
    targets: ReadonlyArray<number>;
}

// ============================================================
// 主表 — 72 entries(6 × 12)
// ============================================================
//
// 数据完整迁移自 melodygenerative,note 字段保留作为代码注释。
// 索引语义:TENDENCY_TABLE[scenario][interval]
//   interval = (notePc - chordRootPc + 12) % 12  ∈ [0, 11]
//
// 行格式:[state, gravity, targets[]]
// ============================================================

// 内联工具:简化 entry 构造
const CT = (g: number, t: ReadonlyArray<number> = []): TendencyEntry =>
    Object.freeze({ state: TendencyState.ChordTone, gravity: g, targets: Object.freeze(t) });
const T = (g: number, t: ReadonlyArray<number>): TendencyEntry =>
    Object.freeze({ state: TendencyState.Tension, gravity: g, targets: Object.freeze(t) });
const A = (g: number, t: ReadonlyArray<number>): TendencyEntry =>
    Object.freeze({ state: TendencyState.Avoid, gravity: g, targets: Object.freeze(t) });

/**
 * 6 × 12 表,索引:[scenario][interval]
 */
export const TENDENCY_TABLE: ReadonlyArray<ReadonlyArray<TendencyEntry>> = Object.freeze([
    // ----- M7T (Maj at Tonic, e.g. Cmaj7 at I) -----
    Object.freeze([
        CT(0.0),                          //  0 R
        A(1.0, [0]),                      //  1 b9   — m9 clash with root
        T(0.2, [0, 4]),                   //  2 9
        A(0.9, [4, 2]),                   //  3 #9   — m9 clash with M3
        CT(0.0),                          //  4 3
        A(0.95, [4]),                     //  5 11   — textbook fatal avoid
        T(0.5, [7, 4]),                   //  6 #11  — Lydian color
        CT(0.0),                          //  7 5
        A(0.9, [7]),                      //  8 b13  — m9 clash with 5
        T(0.3, [7, 11]),                  //  9 13
        A(0.9, [11]),                     // 10 b7   — destroys maj7 → reads as dom7
        CT(0.0),                          // 11 7
    ]),

    // ----- M7S (Maj at Subdominant, e.g. Fmaj7 at IV; Lydian birthright) -----
    Object.freeze([
        CT(0.0),                          //  0 R
        A(1.0, [0]),                      //  1 b9
        T(0.1, [0, 4]),                   //  2 9    — freer under Lydian
        A(0.9, [4, 2]),                   //  3 #9
        CT(0.0),                          //  4 3
        A(0.7, [4]),                      //  5 11   — IV tolerates 11 better than I
        T(0.2, [7, 4]),                   //  6 #11  — Lydian signature, IV birthright
        CT(0.0),                          //  7 5
        A(0.9, [7]),                      //  8 b13
        T(0.2, [7, 11]),                  //  9 13
        A(0.9, [11]),                     // 10 b7
        CT(0.0),                          // 11 7
    ]),

    // ----- m7S (Min at Subdominant, e.g. Dm7 at ii; Dorian) -----
    Object.freeze([
        CT(0.0),                          //  0 R
        A(0.95, [0]),                     //  1 b9   — m9 clash with root
        T(0.2, [0, 3]),                   //  2 9
        CT(0.0),                          //  3 #9   — enharmonic with m3 chord tone
        A(0.95, [3]),                     //  4 3    — destroys minor quality
        T(0.3, [3, 7]),                   //  5 11   — Dorian 11 / modern m11 birthright
        A(0.8, [7]),                      //  6 #11  — breaks Dorian (m7b5 leak)
        CT(0.0),                          //  7 5
        A(0.7, [7]),                      //  8 b13  — kills Dorian
        T(0.4, [7, 10]),                  //  9 13   — Dorian signature M6
        CT(0.0),                          // 10 b7
        A(0.85, [10]),                    // 11 7    — makes mMaj7, destroys Dorian
    ]),

    // ----- m7T (Min at Tonic, e.g. Am7 at vi/i; Aeolian) -----
    Object.freeze([
        CT(0.0),                          //  0 R
        A(1.0, [0]),                      //  1 b9
        T(0.3, [0, 3]),                   //  2 9    — Aeolian 9, slightly conservative
        CT(0.0),                          //  3 #9   — enharmonic with m3 chord tone
        A(0.95, [3]),                     //  4 3    — destroys minor quality
        A(0.8, [3]),                      //  5 11   — Aeolian 11 heavy / chord-busting
        A(0.8, [7]),                      //  6 #11
        CT(0.0),                          //  7 5
        CT(0.2, [7]),                     //  8 b13  — Aeolian b6 legal scale tone
        A(0.8, [7]),                      //  9 13   — M6 kills Aeolian → Dorian leak
        CT(0.0),                          // 10 b7
        A(0.85, [10]),                    // 11 7    — mMaj7, destroys Aeolian
    ]),

    // ----- Dom (G7 at V, V/X secondary, subV/X tritone sub) -----
    // Altered tensions (b9 / #9 / #11 / b13) are TENSION not AVOID — melodic minor
    // 5th mode (Altered scale) makes them legit dom7 vocabulary.
    Object.freeze([
        CT(0.0),                          //  0 R
        T(0.7, [0, 4]),                   //  1 b9   — altered tension, V7b9 standard
        T(0.2, [0, 4]),                   //  2 9
        T(0.75, [4]),                     //  3 #9   — Hendrix blues tension
        CT(0.0),                          //  4 3    — leading-tone, strong V→I draw
        A(0.9, [4]),                      //  5 11   — sus only, clashes with M3
        T(0.55, [7, 4]),                  //  6 #11  — Lydian dominant signature
        CT(0.0),                          //  7 5
        T(0.65, [7, 10]),                 //  8 b13  — V7b13 / altered #5
        T(0.3, [7, 10]),                  //  9 13
        CT(0.0),                          // 10 b7   — tritone partner with 3
        A(0.95, [10, 0]),                 // 11 7    — destroys dom function
    ]),

    // ----- Sus (sus2 / sus4 / 7sus4 / 9sus) -----
    // No 3rd → 4 (11) and 2 (9) are chord tones, M3 = avoid (cancels suspension).
    Object.freeze([
        CT(0.0),                          //  0 R
        A(0.95, [0]),                     //  1 b9
        CT(0.0),                          //  2 9    — sus2 chord tone
        T(0.5, [2, 5]),                   //  3 #9
        A(0.8, [5, 2]),                   //  4 3    — M3 cancels suspension
        CT(0.0),                          //  5 11   — sus4 chord tone, the soul of sus
        T(0.4, [7, 5]),                   //  6 #11
        CT(0.0),                          //  7 5
        T(0.5, [7]),                      //  8 b13
        T(0.3, [7, 0]),                   //  9 13
        CT(0.1),                          // 10 b7   — 7sus4 chord literal, softens tritone
        A(0.85, [10, 0]),                 // 11 7
    ]),
]);

// ============================================================
// 分类函数 — ChordQuality → ChordScenario
// ============================================================
//
// 注:auraflow 通过 ChordQuality enum 直接消费,不需要 melodygenerative 的
// detectChordBaseQuality 字符串分类。逻辑用 bitmask 一次性判定:
//   - Dom 家族:Dominant7 / Dominant7Sus4 / Dominant9 / Dominant13
//   - Sus 家族:Sus4 / Dominant7Sus4(注:Dom7Sus4 在 Dom 与 Sus 都计;以 Sus 优先,
//                因为 sus 行为压过 dom 功能)
//   - Maj 家族:Major / Major7 / Major9 / Add9
//   - Min 家族:Minor / Minor7 / Minor9 / Minor11
//   - Diminished / Augmented / HalfDiminished:返回 null(调用方走 fallback)

/** 效函:T=0 / S=1 / D=2(供 resolveChordScenario 参数,简单整数) */
export type EffectiveFunc = 0 | 1 | 2;
export const FUNC_T: EffectiveFunc = 0;
export const FUNC_S: EffectiveFunc = 1;
export const FUNC_D: EffectiveFunc = 2;

/**
 * 给定 (quality, effectiveFunc),返回对应 ChordScenario。
 * 不可分类(dim/aug/m7b5)返回 null。
 *
 * 优先级:
 *   1. Sus 家族(包括 Dominant7Sus4)→ Sus
 *   2. Dom 家族 → Dom
 *   3. Maj 家族 + S 位 → M7S;否则 → M7T
 *   4. Min 家族 + S 位 → m7S;否则 → m7T
 *   5. 其他(dim/aug/halfDim)→ null
 */
export function resolveChordScenario(
    quality: ChordQuality,
    effectiveFunc: EffectiveFunc,
): ChordScenario | null {
    const qBit = 1 << quality;

    // Sus 优先(Dom7Sus4 同时是 Dom,但 sus 行为更显)
    if (quality === ChordQuality.Sus4 || quality === ChordQuality.Dominant7Sus4) {
        return ChordScenario.Sus;
    }

    // Dom 家族
    if ((qBit & CQ_IS_DOM) !== 0) return ChordScenario.Dom;

    // Maj 家族
    if ((qBit & CQ_IS_MAJOR) !== 0 || quality === ChordQuality.Add9) {
        return effectiveFunc === FUNC_S ? ChordScenario.M7S : ChordScenario.M7T;
    }

    // Min 家族(纯 Minor / Minor7 / Minor9 / Minor11)
    if ((qBit & CQ_IS_MINOR) !== 0) {
        return effectiveFunc === FUNC_S ? ChordScenario.m7S : ChordScenario.m7T;
    }

    // Dim / Aug / HalfDiminished 无 scenario,调用方走 CHORD_INTERVALS fallback
    if ((qBit & CQ_IS_DIM) !== 0) return null;
    if (quality === ChordQuality.Augmented) return null;

    return null;
}

// ============================================================
// 查询函数 — 一站式 melody tendency lookup
// ============================================================

/**
 * 给定 melody PC + chord context,返回该音的 TendencyEntry。
 * 不可分类返回 null。
 *
 * @param melodyPc      [0, 11] 旋律音 PC
 * @param chordRootPc   [0, 11] 和弦根音 PC
 * @param quality       chord 类型
 * @param effectiveFunc T / S / D 功能
 */
export function getMelodyTendency(
    melodyPc: number,
    chordRootPc: number,
    quality: ChordQuality,
    effectiveFunc: EffectiveFunc,
): TendencyEntry | null {
    const scenario = resolveChordScenario(quality, effectiveFunc);
    if (scenario === null) return null;
    const interval = (((melodyPc - chordRootPc) % 12) + 12) % 12;
    return TENDENCY_TABLE[scenario][interval];
}
