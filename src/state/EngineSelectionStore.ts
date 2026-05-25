// ============================================================
// EngineSelectionStore — 引擎选择(2026-05-25 POP-only 大瘦身后退化)
// ============================================================
//
// 历史:
//   - 原承载 AF/MG/AF2 三引擎切换。2026-05-24 删 AF/MG 后 AF2 成唯一内核
//   - 2026-05-25 删 JAZZ/BLUES/RNB 后 POP 成唯一风格,MgStyle 类型删除
//
// 留作 backwards-compat:EngineId / getEngine / setEngine 保持 API 但只 return
// 'AF2',让旧 import 不破坏。
// ============================================================

export type EngineId = 'AF2';   // 保留 type alias 兼容旧 import

export const EngineSelectionStore = {
    /** Deprecated:始终返回 'AF2'。保留兼容性。 */
    getEngine(): EngineId {
        return 'AF2';
    },
    /** Deprecated:no-op。保留兼容性。 */
    setEngine(_engine: EngineId): void {
        void _engine;
    },
};
