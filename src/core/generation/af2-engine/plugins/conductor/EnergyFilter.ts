// ============================================================
// EnergyFilter — energyLevel-driven role 密度档 INTERSECTION
// ============================================================
//
// 原 Conductor.applyMusicianGates 第 (2) 层(2026-05-25 拆 plugin)。
//
// 行为:
//   - apex 高能段例外 → bypass
//   - 否则:roles ∩ energyRoles(由 buildSectionContext 预算)
//     · energyLevel 1-2:仅 pad + bass + accomp
//     · energyLevel 3-4:+ melody(仍无 drums)
//     · energyLevel 5+ :全 5 roles 通过
// ============================================================

import type { RoleFilter } from './types';

export const EnergyFilter: RoleFilter = {
    name: 'EnergyFilter',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'EnergyLevel 密度档 role 集 INTERSECTION(apex 高能段例外)',

    apply(roles, ctx) {
        if (ctx.apexException) return [...roles];
        const energyRoles = ctx.sectionCtx.energyRoles;
        return roles.filter(r => energyRoles.has(r));
    },
};
