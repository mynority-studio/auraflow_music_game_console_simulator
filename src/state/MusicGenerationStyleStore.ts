// ============================================================
// MusicGenerationStyleStore — Q+N 音乐生成风格(qn_main_engine_takeover §7.3)
// ------------------------------------------------------------
// PipelineMonitor 下拉写入 Q+N styleHint → service 读取。
// 模块级 singleton,跨组件持久。
// ============================================================

export type MusicGenStyle = 'POP' | 'JAZZ' | 'LOFI' | 'RNB' | 'ACG';

export const MUSIC_GEN_STYLE_OPTIONS: ReadonlyArray<MusicGenStyle> = ['POP', 'JAZZ', 'LOFI', 'RNB', 'ACG'];

/**
 * 用户界面名称与稳定的引擎 style ID 分离：ACG 仍是既有生成链的内部键，
 * 但对外明确它是钢琴抒情片段模式，而非泛 ACG 配乐分类。
 */
export function musicGenStyleLabel(style: MusicGenStyle): string {
    return style === 'ACG' ? 'ACG PIANOSONG' : style;
}

let _style: MusicGenStyle = 'POP';

export const MusicGenerationStyleStore = {
    getStyle(): MusicGenStyle { return _style; },
    setStyle(style: MusicGenStyle): void { _style = style; },
    /** Q+N styleHint(小写)。 */
    getStyleHint(): string { return _style.toLowerCase(); },
};
