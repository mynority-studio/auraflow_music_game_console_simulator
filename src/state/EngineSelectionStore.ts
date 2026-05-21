// ============================================================
// EngineSelectionStore — 全局生成引擎选择存储(AF / MG 双引擎切换)
// ============================================================
//
// 设计动机:
//   Phase 0 起 auraflow 同时持有两套生成引擎 —
//     - 'AF' (auraflow):现有 Stage 1-5 + Conductor 完整管线
//     - 'MG' (melodygenerative):激进移植进来的钢琴 solo 引擎
//   Q+H(PipelineMonitor)顶部的 Engine Toggle 写本 store,
//   runPipeline 内部读 getEngine() 分流。
//
// 为什么是模块级 store(而不是 React Context / props 透传):
//   - AuraBar / AuraJam 各自的 triggerGeneration 也要读这个选择
//   - 跨 app 单一真理之源(参照 BandSelectionStore 同模式)
//   - 不做 React 订阅(切换时机由用户主动触发,无需自动 re-render
//     PipelineMonitor 内部 useState 镜像 store 状态即可)
//
// app_integration_rule §0 Single Pipeline 原则下的合法形态:
//   所有 app 仍通过 runPipeline() 唯一入口,只是 runPipeline 内部
//   基于本 store 路由到 AF / MG 不同子引擎。runPipeline 的调用契约
//   (PipelineRunOptions 字段 / 返回 { track, context })完全不变。
//
// 不要做的事:
//   - 不要把这个 store 暴露给 app 直接判断 "if engine === MG then ...";
//     app 端只调 runPipeline,引擎差异由 runPipeline 内部消化。
//   - 不要在这里做 musician / GM program 等 AF 专属状态(那是
//     BandSelectionStore 的职责)。
// ============================================================

export type EngineId = 'AF' | 'MG';

let _engine: EngineId = 'AF';

export const EngineSelectionStore = {
    /**
     * 取当前引擎选择。默认 'AF'(完整 auraflow 管线)。
     */
    getEngine(): EngineId {
        return _engine;
    },

    /**
     * 设置引擎(PipelineMonitor Engine Toggle 点击时调用)。
     * 切换立即生效,下一次 runPipeline 走新引擎。
     */
    setEngine(engine: EngineId): void {
        _engine = engine;
    },
};
