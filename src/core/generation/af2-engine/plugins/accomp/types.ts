// ============================================================
// Accomp Plugin Protocol — layer-local convention
// ============================================================
//
// Af2AccompGen 内的 post-pass 链(orchestrator 主体生成 events 后顺序叠加):
//
//   1. MelodyDensityDucker  — melody-aware velocity ducking(T 阶段)
//   2. SwingApplier         — per-mgStyle 直拍 8th and swing(Z1b 阶段)
//   3. MicroTimingHumanizer — 同 onset cluster pitch-ascending strum(U 阶段)
//
// 共享元数据;各 plugin 形状不同(Ducker 需 melody peers / Swing 需 mgStyle /
// Micro 无额外 ctx),不强 apply 签名统一。
//
// 全部 zero PRNG 消耗(deterministic 改写),保 D-5 锁帧。
// 任一 plugin 拔掉听感劣化(less humanization / no dialog / no swing)但
// orchestrator 仍输出合法 accomp。
//
// 注意:plugins 返回**新数组**(不 in-place mutate),与 Reconciler 一致。
// ============================================================

export interface AccompPluginMeta {
    readonly name: string;
    readonly version: string;
    /** Accomp post-pass 全部 'zero'(deterministic 改写) */
    readonly prngConsumption: 'zero';
    readonly description: string;
}
