// ============================================================
// MgStyleStore — mgEngine 当前风格(2026-05-27)
// ============================================================
//
// PipelineMonitor 下拉写入 → runPipeline 读取后传给 mgEngine adapter。
// 模块级 singleton,跨组件持久(同 BandSelectionStore 模式)。
// ============================================================

import type { StyleName as MgStyle } from '../core/generation/mgEngine/styleDictionary';

export type { MgStyle };

export const MG_STYLE_OPTIONS: ReadonlyArray<MgStyle> = ['POP', 'JAZZ', 'BLUES', 'RNB', 'LOFI'];

let _style: MgStyle = 'POP';

export const MgStyleStore = {
    getStyle(): MgStyle {
        return _style;
    },
    setStyle(style: MgStyle): void {
        _style = style;
    },
};
