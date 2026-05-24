// ============================================================
// EngineSelectionStore — MG style 全局存储(2026-05-24 删 AF/MG 后退化)
// ============================================================
//
// 历史:本 store 原承载 AF/MG/AF2 三引擎切换。2026-05-24 删 AF/MG 后,AF2 成为
//        唯一内核,此处仅保留 MgStyle 选择(AF2 内部 Conductor / Arranger /
//        Composer 仍按 mgStyle 路由不同进行池 / 模板 variant)。
//
// 留作 backwards-compat:EngineId / getEngine / setEngine 保持 API 但只 return
// 'AF2',让旧 import 不破坏。
// ============================================================

export type EngineId = 'AF2';   // 保留 type alias 兼容旧 import
export type MgStyle = 'POP' | 'JAZZ' | 'BLUES' | 'RNB';

let _mgStyle: MgStyle = 'POP';

export const EngineSelectionStore = {
    /** Deprecated:始终返回 'AF2'。保留兼容性。 */
    getEngine(): EngineId {
        return 'AF2';
    },
    /** Deprecated:no-op。保留兼容性。 */
    setEngine(_engine: EngineId): void {
        void _engine;
    },
    getMgStyle(): MgStyle {
        return _mgStyle;
    },
    setMgStyle(style: MgStyle): void {
        _mgStyle = style;
    },
};
