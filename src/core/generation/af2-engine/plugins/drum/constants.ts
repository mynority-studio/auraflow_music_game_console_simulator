// ============================================================
// GM Drum Map 物理键位常量 — Drum plugin / orchestrator 共享
// ============================================================
//
// K-8 第三空间(GM Drum Map):pitch 是物理键位,不参与 keyOffset transposition。
// AbsoluteTransposer 检测 drums 轨跳过 +keyOffset(由 MidiConverter 路由 Channel 9)。
//
// 2026-05-25 抽取:原散落于 DrumIdiom.ts + 4 plugin override 文件,避免改一处漏一处。
// ============================================================

export const DRUM_KICK         = 36;
export const DRUM_SNARE        = 38;
export const DRUM_CLOSED_HIHAT = 42;
export const DRUM_OPEN_HIHAT   = 46;
export const DRUM_TOM_LO       = 45;
export const DRUM_TOM_MID      = 47;
export const DRUM_TOM_HI       = 50;
export const DRUM_CRASH        = 49;
export const DRUM_RIDE         = 51;
