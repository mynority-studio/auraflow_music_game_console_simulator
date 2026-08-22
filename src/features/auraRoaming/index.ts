// ============================================================
// auraRoaming · 光律漫游唯一对外出口
// ------------------------------------------------------------
// 功能整体收在本目录,外部(App/devPanels)只从这里 import,
// 方便日后整体迁移到正式产品层。
// ============================================================

export { AuraRoamingPanel } from './ui/AuraRoamingPanel';
export { AuraStarHud } from './ui/AuraStarHud';
export { getAuraRoamingSnapshot, subscribeAuraRoaming } from './state/auraRoamingStore';
export { setAuraKeyOn, toggleAuraKey, isAuraKeyOn } from './runtime/auraKeyRuntime';
