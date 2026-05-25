// ============================================================
// Conductor RoleFilter Protocol — layer-local convention
// ============================================================
//
// Conductor 的 "core" = buildDefaultByMusician(全员上岗 1:1 默认映射)。
// 所有 5 层 filter 是叠加 plugin,顺序敏感:
//
//   1. WakeKGate          — K < wakeK 时 sleeping
//   2. PeakKGate          — K > peakK 时退出
//   3. StyleTemplateFilter — per-mgStyle template INTERSECTION
//   4. EnergyFilter       — energy 密度档 INTERSECTION
//   5. MusicianPrefFilter — musician 卡 sectionRolePreference INTERSECTION
//
// 共享元数据 + 统一 apply 签名(不同于 Reconciler 三 plugin 三签名)。
// 全部 zero PRNG 消耗。
//
// apex 例外:musician.persona.isApex && section.energyLevel >= 7 → 前 4 filter
// bypass(MusicianPrefFilter 不 bypass,尊重 user 意图)。
//
// Z3 continuity:musician 一旦上岗,后续 section 边界轻微超出 wakeK/peakK 仍可继续
// (避免单段闪现 / 突然退场)— 但只在 ±CONTINUITY_K_MARGIN 容差内。
// ============================================================

import type { Musician, SectionMetadata } from '../../../types';
import type { ConductorRole, ConductorTemplate } from '../../Conductor';

/** Section 级 filter 上下文(per-section 算 1 次,所有 musician 共享) */
export interface SectionFilterContext {
    readonly templateRoles: ReadonlySet<ConductorRole> | undefined;
    readonly energyRoles: ReadonlySet<ConductorRole>;
    readonly sectionK: number;
    readonly isHighEnergy: boolean;
}

/** Per-musician filter 上下文(per-section per-musician 算 1 次,filter 链共享) */
export interface RoleFilterContext {
    readonly section: SectionMetadata;
    readonly sectionCtx: SectionFilterContext;
    readonly musician: Musician | undefined;
    readonly prevRoles: ReadonlyArray<ConductorRole> | undefined;
    readonly isApex: boolean;
    /** isApex && sectionCtx.isHighEnergy:WakeK / PeakK / Template / Energy filter bypass */
    readonly apexException: boolean;
    /** prevRoles !== undefined && prevRoles.length > 0 — Z3 continuity 检测 */
    readonly prevActive: boolean;
}

export interface RoleFilterMeta {
    readonly name: string;
    readonly version: string;
    /** Conductor 层所有 filter 必须为 'zero' */
    readonly prngConsumption: 'zero';
    readonly description: string;
}

export interface RoleFilter extends RoleFilterMeta {
    apply(roles: ReadonlyArray<ConductorRole>, ctx: RoleFilterContext): ConductorRole[];
}

/** Z3 阶段:wake/peak K 边界 continuity margin(prev 上岗时容差) */
export const CONTINUITY_K_MARGIN = 0.15;

// ============================================================
// Context factory helpers
// ============================================================

/**
 * Energy-driven role 修正:section.energyLevel 1-10 → "密度档":
 *   1-2(极低):仅 pad + bass + accomp(Intro 渐入 / Outro 渐弱)
 *   3-4(低)  :允许 +melody,无 drums
 *   5-10(中高):允许所有 roles(走 template)
 */
function energyConstrainedRoles(energyLevel: number): ReadonlySet<ConductorRole> {
    if (energyLevel <= 2) return new Set<ConductorRole>(['pad', 'bass', 'accomp']);
    if (energyLevel <= 4) return new Set<ConductorRole>(['pad', 'bass', 'accomp', 'melody']);
    return new Set<ConductorRole>(['pad', 'bass', 'accomp', 'melody', 'drums']);
}

/** Section.energyLevel(1-10)→ K(归一化 0-1,与 musician.persona.wakeK/peakK 比较用) */
function energyLevelToK(energyLevel: number): number {
    const k = (energyLevel - 1) / 9;
    return k < 0 ? 0 : k > 1 ? 1 : k;
}

export function buildSectionContext(
    section: SectionMetadata,
    template: ConductorTemplate,
): SectionFilterContext {
    const energyLevel = section.energyLevel ?? 5;
    return {
        templateRoles: template[section.sectionType],
        energyRoles: energyConstrainedRoles(energyLevel),
        sectionK: energyLevelToK(energyLevel),
        isHighEnergy: energyLevel >= 7,
    };
}

export function buildRoleFilterContext(
    section: SectionMetadata,
    sectionCtx: SectionFilterContext,
    musician: Musician | undefined,
    prevRoles: ReadonlyArray<ConductorRole> | undefined,
): RoleFilterContext {
    const isApex = musician?.persona?.isApex === true;
    const apexException = isApex && sectionCtx.isHighEnergy;
    const prevActive = prevRoles !== undefined && prevRoles.length > 0;
    return { section, sectionCtx, musician, prevRoles, isApex, apexException, prevActive };
}
