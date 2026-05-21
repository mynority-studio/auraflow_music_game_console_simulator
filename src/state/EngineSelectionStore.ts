// ============================================================
// EngineSelectionStore — 全局生成引擎选择存储(AF / MG / AF2 三引擎切换)
// ============================================================
//
// 设计动机:
//   auraflow 当前同时持有三套生成引擎 —
//     - 'AF'  (auraflow):现有 Stage 1-5 + Conductor 完整管线
//     - 'MG'  (melodygenerative):激进移植进来的钢琴 solo 引擎
//     - 'AF2' (auraflow v2 fusion):融合引擎(Phase 0 stub,待实装)
//       AF + MG 的融合产物 —— MG 强项是全局和声 / 段落和声编配,
//       AF 强项是乐手 / 段落骨架 / 5 维气象 / Reconciler,AF2 取两者。
//       稳定后 AF2 将取代 AF / MG 成为唯一引擎。
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

export type EngineId = 'AF' | 'MG' | 'AF2';
/**
 * MG 引擎的 style 选择(对应 mg-engine/styleDictionary 中的 StyleName)。
 * 与 auraflow StyleId 完全独立 — MG 是钢琴 solo 引擎,有自己的 4 风格分类。
 */
export type MgStyle = 'POP' | 'JAZZ' | 'BLUES' | 'RNB';

let _engine: EngineId = 'AF';
let _mgStyle: MgStyle = 'POP';

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

    /**
     * 取当前 MG style(仅 MG 模式生效;AF 模式下本字段被忽略)。
     */
    getMgStyle(): MgStyle {
        return _mgStyle;
    },

    /**
     * 设置 MG style。
     */
    setMgStyle(style: MgStyle): void {
        _mgStyle = style;
    },
};
