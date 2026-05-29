// ============================================================
// styleBaseTexture.ts — 每 style 一个 base texture(Layer 1 archetype)
// ============================================================
//
// 设计理念(对齐用户的"每首歌一个 base texture"约束):
//   - 每 style 固定一个 base texture(lh + rh archetype + 概率参数)
//   - 同一 style 所有 seed 共享同一 base(只是 mg 进行 / Viterbi voicing 不同)
//   - section-mutation(P4 phase 实现)在 base 上加 scaling,不换 archetype
//
// 参数维度:
//   archetype  — LH/RH 的"演奏方式"标签,跟 patterns.ts 里的 pattern 函数对应
//   gridDensity — base grid 整体强度 multiplier(0.3=稀疏 / 1.0=满)
//   fillProb   — 弱拍 / 16 分位概率填(P4 实现)
//   syncShiftProb — 概率 shift 强拍击点到前一个 16 分位(P4 实现)
//   restProb   — 概率休止(P4 实现)
//   velocityScale — 全局 velocity scale(P1 已用,小幅听感差异验证装配)
//
// P1 阶段:patterns 只读 velocityScale。其余参数 P2+ 启用。
// ============================================================

import type { StyleName } from '../mgEngine/styleDictionary';

/** LH(左手)演奏 archetype */
export type LHArchetype =
    | 'sustained'      // 长按根音
    | 'walking'        // 4 拍 walking bass
    | 'alberti'        // 阿尔贝蒂分解
    | 'octave';        // 根+八度

/** RH(右手)演奏 archetype */
export type RHArchetype =
    | 'pad'            // 长按和弦(legato)
    | 'comping'        // 节奏化 stab + rest
    | 'arp'            // 琶音流动
    | 'block';         // 简单 block(1+3 拍)

export interface StyleBaseTexture {
    lh: LHArchetype;
    rh: RHArchetype;

    // ── 后续 layer 用的概率参数(P1 阶段只读 velocityScale) ──
    gridDensity: number;       // 0-1
    fillProb: number;          // 0-1, 弱拍 / 16 分位补音概率
    syncShiftProb: number;     // 0-1, 切分 shift 概率
    restProb: number;          // 0-1, 强拍跳过概率
    velocityScale: number;     // 0-1, 全局 velocity 乘数(P1 已生效)
}

/**
 * 5 个 mg style 的 base texture。
 *
 * 设计依据:MMA stdlib 同风格族文件 + 听感校准。
 *   POP   :walking + comping = 标准流行钢琴(steady walk + 节奏化 stab)
 *   LOFI  :sustained + pad   = 梦境感(长按 / 高 restProb)
 *   JAZZ  :walking + comping = 爵士钢琴(walk + Charleston-like comping)
 *   BLUES :alberti + arp     = boogie / blues piano(8 分摆动)
 *   RNB   :sustained + comping = soft pad + 切分 stab
 *
 * 注:archetype 仅作 ID,实际 pattern 函数映射在 patterns.ts(P2 会用 grid 决策位置)。
 */
export const STYLE_BASE_TEXTURES: Record<StyleName, StyleBaseTexture> = {
    POP: {
        lh: 'walking',
        rh: 'comping',
        gridDensity:   0.7,
        fillProb:      0.50,
        syncShiftProb: 0.15,
        restProb:      0.15,
        velocityScale: 0.85,
    },
    LOFI: {
        lh: 'sustained',
        rh: 'pad',
        gridDensity:   0.3,
        fillProb:      0.25,
        syncShiftProb: 0.0,
        restProb:      0.40,
        velocityScale: 0.65,
    },
    JAZZ: {
        lh: 'walking',
        rh: 'comping',
        gridDensity:   0.85,
        fillProb:      0.70,
        syncShiftProb: 0.30,
        restProb:      0.10,
        velocityScale: 0.85,
    },
    BLUES: {
        lh: 'alberti',
        rh: 'arp',
        gridDensity:   0.8,
        fillProb:      0.60,
        syncShiftProb: 0.20,
        restProb:      0.10,
        velocityScale: 0.85,
    },
    RNB: {
        lh: 'sustained',
        rh: 'comping',
        gridDensity:   0.5,
        fillProb:      0.45,
        syncShiftProb: 0.25,
        restProb:      0.30,
        velocityScale: 0.75,
    },
};
