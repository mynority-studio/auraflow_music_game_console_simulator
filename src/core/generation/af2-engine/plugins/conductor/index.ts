// ============================================================
// Conductor plugins — public API barrel
// ============================================================

import { WakeKGate } from './WakeKGate';
import { PeakKGate } from './PeakKGate';
import { StyleTemplateFilter } from './StyleTemplateFilter';
import { EnergyFilter } from './EnergyFilter';
import { MusicianPrefFilter } from './MusicianPrefFilter';
import type { RoleFilter } from './types';

export { WakeKGate, PeakKGate, StyleTemplateFilter, EnergyFilter, MusicianPrefFilter };
export type { RoleFilter, RoleFilterContext, RoleFilterMeta, SectionFilterContext } from './types';
export { CONTINUITY_K_MARGIN, buildSectionContext, buildRoleFilterContext } from './types';

/**
 * Conductor filter 链(顺序敏感,可拔可换):
 *   1. WakeKGate           — Z3 K-boundary gate(可能 short-circuit 出列)
 *   2. PeakKGate           — Z3 K-boundary gate(可能 short-circuit 出列)
 *   3. StyleTemplateFilter — per-mgStyle template INTERSECTION
 *   4. EnergyFilter        — per-section energy 密度档 INTERSECTION
 *   5. MusicianPrefFilter  — musician 卡 section preference INTERSECTION
 *
 * 改 filter 顺序 / 加新 filter / 禁某 filter 全是改本数组一行。
 */
export const DEFAULT_ROLE_FILTERS: ReadonlyArray<RoleFilter> = [
    WakeKGate,
    PeakKGate,
    StyleTemplateFilter,
    EnergyFilter,
    MusicianPrefFilter,
];
