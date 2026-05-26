// ============================================================
// improCore/index.ts — public API barrel
// ============================================================
//
// 2026-05-26 Step 6.4:ImproEngineFacade 已删(算法装进 AF2 framework 后无独立 Facade 角色)。
// 留下 data/loaded 共享 export 给 ImproStyleStore + adapter 用。

export { BALLAD_STYLE, SWING_STYLE, CLOSED_HIGH_VOICING_SETTINGS, selfTest } from './data/loaded';
