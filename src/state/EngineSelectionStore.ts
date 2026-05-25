// ============================================================
// EngineSelectionStore — 引擎选择(2026-05-25 复活给 Impro 切换用)
// ============================================================
//
// 历史:
//   - 原承载 AF/MG/AF2 三引擎切换。2026-05-24 删 AF/MG 后 AF2 成唯一内核
//   - 2026-05-25 删 JAZZ/BLUES/RNB 后 POP 成唯一风格,本 store 退化为存根
//   - 2026-05-25(later)复活 — 加 'Impro' option,Q+H UI 切换 AF2/Impro 双引擎对比
//
// runPipeline 内部读 getEngine() 决定 dispatch:
//   'AF2'   → Af2EngineFacade.generate(options)
//   'Impro' → ImproEngineFacade.generate(options)
// ============================================================

export type EngineId = 'AF2' | 'Impro';

let _engine: EngineId = 'AF2';

export const EngineSelectionStore = {
    getEngine(): EngineId {
        return _engine;
    },
    setEngine(engine: EngineId): void {
        _engine = engine;
    },
};
