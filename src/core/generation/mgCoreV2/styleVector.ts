// ============================================================
// styleVector.ts — V2 dimensional 风格切片(2026-05-28 Phase 4 重写)
// ============================================================
//
// 真正的 dimensional 方案:
//   - 6 轴连续值的"风格 DNA"向量,5 个 mg style 各占一点 anchor
//   - mutateVector 在 song 内做 phrase wave + song arc + noise 调制,
//     anchor 微动 → 每 bar vector 不同 → kernels 自己看 vector 触发
//     → 生成出的 LH/RH 织体在同一首歌内"千变万化"
//
// 跟 mg / Phase 3 enumeration 的本质区别:
//   - 不存在"POP 用哪些 kernel"的查表
//   - 不存在 STYLE_RECIPE_SETS
//   - kernel 的 fire 由 vector 自己决定(kernel.activate(v) 谓词)
// ============================================================

import type { StyleName } from '../mgEngine/styleDictionary';

export interface StyleVector {
    /** 击点密度 [0,1] — 影响每 bar 击点数(BlockChord strokes / ArpFill 触发) */
    density: number;
    /** 切分倾向 [0,1] — 0=正拍 / 1=极切分(Stab/Charleston 触发) */
    syncopation: number;
    /** 低音线性度 [0,1] — 0=pedal/根音 / 0.5=alberti 摆动 / 1=walking */
    bassLinearity: number;
    /** voicing 张开度 [0,1] — 0=close / 1=wide drop-2 over octave */
    voicingSpread: number;
    /** 音长比 [0,1] — 0=staccato / 1=legato(Stab/PedalSustained 触发) */
    articulation: number;
    /** 钢琴踏板使用率 [0,1] — 触发 PedalSustained,抑制 Stab/ArpFill */
    pedalUsage: number;
}

// ─────────────────────────────────────────────────────────────────
// 5 mg style 在 6D 空间的 anchor 坐标
// ─────────────────────────────────────────────────────────────────
//
// 根据 MMA stdlib 同风格文件人工标定 + 听感校准。后续可用 corpus PCA
// 自动校准。每个 style 必须在 6D 中区分够明显,否则 vector mutation 范围
// 会有重叠 → A/B 切换无区分。
//
// 关键差异:
//   POP   — 中密度 / 弱切分 / 低 bass 线性度 / 中踏板
//   LOFI  — 低密度 / 无切分 / 极低 bass 线性 / 极高踏板 / 极 legato
//   JAZZ  — 高密度 / 极切分 / 极高 bass 线性 / 低踏板(walking 需要清晰 attack)
//   BLUES — 中高密度 / 中切分 / 高 bass 线性(boogie alberti) / 低踏板
//   RNB   — 中密度 / 中切分 / 低 bass 线性 / 高踏板 / legato

export const STYLE_VECTORS: Record<StyleName, StyleVector> = {
    POP:   { density: 0.55, syncopation: 0.30, bassLinearity: 0.20, voicingSpread: 0.50, articulation: 0.55, pedalUsage: 0.40 },
    LOFI:  { density: 0.30, syncopation: 0.15, bassLinearity: 0.10, voicingSpread: 0.65, articulation: 0.90, pedalUsage: 0.85 },
    JAZZ:  { density: 0.65, syncopation: 0.80, bassLinearity: 0.90, voicingSpread: 0.45, articulation: 0.50, pedalUsage: 0.20 },
    BLUES: { density: 0.60, syncopation: 0.45, bassLinearity: 0.70, voicingSpread: 0.40, articulation: 0.55, pedalUsage: 0.25 },
    RNB:   { density: 0.45, syncopation: 0.50, bassLinearity: 0.30, voicingSpread: 0.55, articulation: 0.75, pedalUsage: 0.75 },
};

// ─────────────────────────────────────────────────────────────────
// Vector mutation —— 同首歌内"智能 mutant"
// ─────────────────────────────────────────────────────────────────

/**
 * 简单 LCG PRNG(deterministic,seed 一致输出一致)。用于 mutateVector 的
 * per-bar noise,保证同 seed song 两次跑出来 vector 序列完全一致。
 */
export function makePrng(seedStr: string): () => number {
    // djb2 hash → uint32 初始 state
    let state = 5381;
    for (let i = 0; i < seedStr.length; i++) {
        state = ((state << 5) - state + seedStr.charCodeAt(i)) >>> 0;
    }
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Seed-based anchor jitter — 每首歌入口对 anchor 6 轴做整体 offset。
 *
 * 目的:同 style 不同 seed 应该听感不同。光 mutateVector 的 per-bar noise 不够 —
 * phraseWave / songArc 是纯 barIdx 函数,跟 seed 无关。songAnchor 把 anchor 在
 * 6D 中"挪一挪",从此 mutateVector 的输出序列也跟着 seed 走。
 *
 * 偏移幅度 ±0.12 — 足以让阈值附近的 kernel 跨 activate(例如 syncopation
 * anchor 0.30 ± 0.12 = 0.18 ~ 0.42 → StabBackbeat (阈 0.25) 可触发 / 不触发)。
 * 但不大到改变 style 的 DNA(POP 仍是 POP,不会跨成 LOFI)。
 *
 * prng 内部消耗 6 次,跟 mutateVector 共用同一个 prng 让序列继续 deterministic。
 */
export function applySongJitter(
    anchor: StyleVector,
    prng: () => number,
): StyleVector {
    const j = (): number => (prng() - 0.5) * 0.24;  // ±0.12
    return {
        density:       clamp01(anchor.density       + j()),
        syncopation:   clamp01(anchor.syncopation   + j()),
        bassLinearity: clamp01(anchor.bassLinearity + j()),
        voicingSpread: clamp01(anchor.voicingSpread + j()),
        articulation:  clamp01(anchor.articulation  + j()),
        pedalUsage:    clamp01(anchor.pedalUsage    + j()),
    };
}

/**
 * 给定 song-jittered anchor + bar 位置,生成该 bar 的 mutated vector。
 *
 * 三种调制叠加:
 *   1. Phrase wave(4 bar 一周期 sinusoidal):density/syncopation 在 phrase
 *      中段拱起,phrase 头/末略低 → 起 settling 感
 *   2. Song arc(整曲一个穹顶):density/spread/bassLinearity 全曲中段稍高
 *      → 自然能量曲线(intro 收 → middle 展 → outro 收)
 *   3. Noise(±0.12):每轴随机扰动,跨 kernel 阈值
 *
 * Clamp 到 [0,1] 保证 kernel.activate 判定不爆界。
 */
export function mutateVector(
    anchor: StyleVector,
    barIdx: number,
    totalBars: number,
    prng: () => number,
): StyleVector {
    const phrasePos = barIdx % 4;
    const phraseWave = Math.sin((phrasePos / 4) * 2 * Math.PI);

    const progress = totalBars > 1 ? barIdx / (totalBars - 1) : 0.5;
    const songArc = Math.sin(progress * Math.PI);

    const noise = (): number => (prng() - 0.5) * 0.24;  // ±0.12

    return {
        density:       clamp01(anchor.density       + phraseWave * 0.10 + songArc * 0.08 + noise()),
        syncopation:   clamp01(anchor.syncopation   + phraseWave * 0.08 + noise()),
        bassLinearity: clamp01(anchor.bassLinearity + songArc    * 0.06 + noise()),
        voicingSpread: clamp01(anchor.voicingSpread + songArc    * 0.06 + noise()),
        articulation:  clamp01(anchor.articulation  - songArc    * 0.04 + noise()),
        pedalUsage:    clamp01(anchor.pedalUsage    + noise() * 0.5),  // 踏板半幅,更稳
    };
}

// ─────────────────────────────────────────────────────────────────
// Helpers — vector axis → 渲染参数
// ─────────────────────────────────────────────────────────────────

/** articulation [0,1] → noteOn 持续时间占 beat 比例 [0.15, 1.0] */
export function articulationToDurRatio(articulation: number): number {
    return 0.15 + articulation * 0.85;
}

/** 默认基线 velocity 80(MIDI mp tier),kernel 在此基础上做 ±10-30 调整 */
export const BASE_VELOCITY = 80;

/** voicingSpread [0,1] → 推荐 LH/RH 八度差(0=0 / 1=4 octaves) */
export function voicingSpreadToOctaveGap(spread: number): number {
    return Math.round(spread * 4);
}
