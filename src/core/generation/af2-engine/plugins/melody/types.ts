// ============================================================
// Melody Plugin Protocol — layer-local convention
// ============================================================
//
// Af2MelodyGen 是 chord-tone melody 的 core orchestrator + 6 plugin 链。
// Orchestrator 保证正确性(role gate / chord-tone cycle / placeNearAnchor /
// 边界 clamp),plugin 负责"丰富度增强"(rhythm / contour / passing tone /
// phrase ending / sparsity / velocity 人性化)。
//
// 各 plugin 形状不同(rhythm 返回 number[];velocity 返回 number;passing
// tone 两 method;...),不强求统一 apply 签名 — 共享元数据接口即可。
// 全部 zero PRNG 消耗(用 deterministic hash gate)。
//
// 拔掉某 plugin 听感劣化(less variation)但 orchestrator 仍输出合法 melody。
// ============================================================

export interface MelodyPluginMeta {
    readonly name: string;
    readonly version: string;
    /** Melody 层所有 plugin 必须为 'zero'(deterministic hash,保 D-5 锁帧) */
    readonly prngConsumption: 'zero';
    readonly description: string;
}
