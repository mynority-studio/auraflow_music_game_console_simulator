// ============================================================
// Composer Plugin Protocol — layer-local convention
// ============================================================
//
// Af2Composer 的 chord-type decoration 阶段拆 plugin。Composer 主体保留
// orchestrator 职责(主循环 / voicing assembly / placeVoicingMidi / voice
// leading post-pass),decoration 移到 plugin。
//
// 当前 plugin:
//   - DynamicHarmonyDecorator — TSD dict + colorLevel + Sub-V + data-debt guard
//                                + lockType ceremony
//
// 元数据 prngConsumption:
//   'locked'  = 每 step 固定 2-3 consumes(lockType=2,normal=2 base + 0-1 SubV cond)
//   'zero'    = 不消耗 PRNG
//   'forked'  = 用 sub-stream(本层暂无)
// ============================================================

export interface ComposerPluginMeta {
    readonly name: string;
    readonly version: string;
    /** Composer 层 PRNG 模式 */
    readonly prngConsumption: 'locked' | 'zero' | 'forked';
    readonly description: string;
}

export interface DecorateResult {
    type: string;
    rootOffsetOverride?: number;
    romanOverride?: string;
}
