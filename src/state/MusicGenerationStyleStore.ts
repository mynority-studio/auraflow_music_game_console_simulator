// ============================================================
// MusicGenerationStyleStore — Q+N 音乐生成风格(qn_main_engine_takeover §7.3)
// ------------------------------------------------------------
// 取代旧 MgStyleStore(语义改为 Q+N styleHint)。PipelineMonitor 下拉写入 → service 读取。
// 模块级 singleton,跨组件持久。
// ============================================================

export type MusicGenStyle = 'POP' | 'JAZZ' | 'LOFI' | 'RNB' | 'ACG';

export const MUSIC_GEN_STYLE_OPTIONS: ReadonlyArray<MusicGenStyle> = ['POP', 'JAZZ', 'LOFI', 'RNB', 'ACG'];

let _style: MusicGenStyle = 'POP';

export const MusicGenerationStyleStore = {
    getStyle(): MusicGenStyle { return _style; },
    setStyle(style: MusicGenStyle): void { _style = style; },
    /** Q+N styleHint(小写)。 */
    getStyleHint(): string { return _style.toLowerCase(); },
};
