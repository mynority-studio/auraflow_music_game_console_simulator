// ============================================================
// Hash helpers — 多 plugin 共享 deterministic hash 模式
// ============================================================
//
// 2026-05-25 抽取(原散落于 RhythmPatternPicker / Af2AccompGen / PadIdiom 3 处)。
//
// 各 plugin 用不同系数(7/11 / 19/23/29 / 41/53/67 etc)产生独立 hash 维度,
// 但**二次抖动公式**(h * 31 + 17)& 0xff 是公共 pattern,用于 persona 加权
// 偏好决策(sparsity / syncopation 概率筛选)。
// ============================================================

/**
 * 基础 hash → persona 二次抖动 → [0, 1) float。
 *
 * 公式:`((h * 31 + 17) & 0xff) / 255`
 * 用法:`if (hashApplyPersonaPass(baseHash) < sparsityProb) { ... }`
 *
 * 保 bit-exact:32 + 17 mod 256 / 255 — 同 baseHash 同输出。
 */
export function hashApplyPersonaPass(h: number): number {
    return ((h * 31 + 17) & 0xff) / 255;
}
