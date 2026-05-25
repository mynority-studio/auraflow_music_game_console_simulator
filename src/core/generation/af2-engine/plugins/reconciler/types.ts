// ============================================================
// Reconciler Plugin Protocol — layer-local convention
// ============================================================
//
// Reconciler 层无 core,所有处理都是可叠加 plugin。每个 plugin:
//   - 自带元数据(name / version / prngConsumption / description)
//   - apply 签名按各自实际 I/O 自然定义(不强制统一 generic)
//   - 全部 zero PRNG 消耗(velocity 改写不应破坏 D-5 不变式)
//   - 纯函数:不 mutate 输入,返回新数组 + 新对象
//   - 只允许改 velocity;pitch / onset / duration / part / sectionIdx 不变
//
// 顺序:Facade 顺序叠加 EnergyHumanizer → CollisionDamper → DropBuildupDynamics
// 任一 plugin 拔掉听感劣化(less humanization)但不破坏正确性。
// ============================================================

export interface ReconcilerPluginMeta {
    readonly name: string;
    readonly version: string;
    /** Reconciler 层所有 plugin 必须为 'zero'(velocity-only 改写) */
    readonly prngConsumption: 'zero';
    /** 一句话描述 plugin 职责(用于 debug / 日志) */
    readonly description: string;
}
