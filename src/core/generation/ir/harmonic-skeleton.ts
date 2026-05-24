// ============================================================
// CONSTITUTION CHAPTER I — HarmonicSkeleton(Phase 3a 新增)
// ============================================================
//
// "乐器无关"的和声骨架。Phase 3a 仅定义类型,暂无生产者/消费者——
// 留给后续 Phase(PianoRealizer 接入 + 嵌入式 C 端对接)真正落地。
//
// 设计动机:
//   - 当前 HarmonyCore 输出 GeneratedChord[],其中 voicing 字段属于"已具象化"
//     的声部排列,与乐器物理耦合(钢琴 SATB 排列 vs 吉他 Drop2 排列完全不同)。
//   - HarmonicSkeleton 是"和弦功能层"的纯描述:root / quality / function / tensions,
//     不包含 voicing。任何 InstrumentRealizer 拿到 HarmonicSkeleton 后自行 voicing。
//
// Pitch Space: RELATIVE — root ∈ [0, 11],未加 keyOffset。
//
// 与 GeneratedChord 的关系(过渡期):
//   - Phase 3a:并存。HarmonyCore 仍产 GeneratedChord(含 voicing),
//     新代码可选择消费 HarmonicSkeleton 视图(从 GeneratedChord 投影)。
//   - Phase 4+:HarmonyCore 产 HarmonicSkeleton,VoicingProcessor 作为下游
//     独立步骤产 voicing,GeneratedChord 被弃用。
// ============================================================

import type { ChordQuality } from '../types';

/** 功能和声三态(T-S-D)— 从原 pipeline/MacroProgressionEngine 内联 */
export enum HarmonicFunction {
    Tonic       = 0,
    Subdominant = 1,
    Dominant    = 2,
}

/**
 * 张力延伸音建议(色彩音,**非和弦音**)。
 *
 * 数值含义:
 *   9   = 大九度(+14 半音,即根上方 2 PC)
 *   #9  = 增九度(+15 半音)
 *   11  = 完全十一度(+17 半音,即根上方 5 PC,sus 风味)
 *   #11 = 升十一度(+18 半音,Lydian 风味 / Dom 家族常用)
 *   13  = 大十三度(+21 半音,即根上方 9 PC)
 *   b13 = 小十三度(+20 半音,Phrygian Dom 风味)
 *
 * 数值是"音乐符号常量",不是半音数。半音数转换由 Realizer 内部处理。
 */
export type TensionTone = 9 | -9 /* b9 */ | 1009 /* #9, 编码避免与 9 冲突 */
    | 11 | 1011 /* #11 */
    | 13 | -13 /* b13 */;

/**
 * 乐器无关的和弦描述(和声层骨架)。
 *
 * 关键不同于 GeneratedChord:
 *   - **没有 voicing 字段** — voicing 是乐器具象化的产物,由 Realizer 内部计算
 *   - **没有 extensions: string[]** — 改用 strongly-typed tensions
 *   - 新增 function 字段(T/S/D)— 让下游可以根据功能而不是 numeral 做决策
 */
export interface HarmonicChord {
    /** 起始拍(全局) */
    startBeat: number;
    /** 结束拍(全局),exclusive */
    endBeat: number;
    /** Root pitch class ∈ [0, 11],RELATIVE(未加 keyOffset) */
    root: number;
    /** 和弦质量(maj7 / m7 / dom7 / dim / sus...) */
    quality: ChordQuality;
    /** 功能角色(T-S-D 三态)— 由 MacroProgressionEngine 推演时决定 */
    function: HarmonicFunction;
    /** 色彩音建议 — Realizer 自行决定是否采用(可能因物理约束如管乐单声部而忽略) */
    tensions: TensionTone[];
    /** Bass override — 转位和弦(Slash chord)如 C/E,bassOverride=4(E 的 PC) */
    bassOverride?: number;
    /** 罗马数字标签(诊断用,非渲染必需) */
    numeral?: string;
}

/**
 * 终止点 — Cadence 的明确标注(供 Realizer 在终止位置做特殊处理:
 * Realizer 可以在 cadence 处加重 voice leading、放慢节奏、引入装饰音等)。
 */
export interface CadencePoint {
    /** 终止式落点和弦在 chords[] 中的索引 */
    chordIndex: number;
    /** 终止式类型 */
    kind: 'authentic' | 'half' | 'plagal' | 'deceptive';
}

/**
 * 全曲乐器无关的和声骨架。
 *
 * 元数据:
 *   - context.keyOffsetIsAbsolute === false 表示 root 仍在 RELATIVE 空间,
 *     由 Conductor / AbsoluteTransposer 在最后阶段加 keyOffset 转 ABSOLUTE。
 *     当前 Phase 恒为 false;预留字段是为了将来支持"已 absolute 的骨架"
 *     (例如从 MIDI 反推时直接给绝对 root)。
 */
export interface HarmonicSkeleton {
    chords: HarmonicChord[];
    cadences: CadencePoint[];
    context: {
        keyOffsetIsAbsolute: false;
    };
}
