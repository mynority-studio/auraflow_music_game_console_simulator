// ============================================================
// ImproStyleStore — ImproEngine 当前选中 style(2026-05-25 加)
// ============================================================
//
// Q+H UI dropdown 写入 → ImproEngineFacade 读取。模块级 singleton,
// 跨组件持久(同 BandSelectionStore / EngineSelectionStore 模式)。
//
// 145 个 .sty 全 inline 到 bundle(见 improCore/data/loaded.ts),
// 这里只存当前选中名字字符串,真正 StyleData 在 ImproEngineFacade 内 query。
// ============================================================

let _styleName: string = 'ballad';

export const ImproStyleStore = {
    getStyleName(): string {
        return _styleName;
    },
    setStyleName(name: string): void {
        _styleName = name;
    },
};
