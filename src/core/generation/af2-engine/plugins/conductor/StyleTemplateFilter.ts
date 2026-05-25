// ============================================================
// StyleTemplateFilter — per-mgStyle template role 集 INTERSECTION
// ============================================================
//
// 原 Conductor.applyMusicianGates 第 (1) 层(2026-05-25 拆 plugin)。
//
// 行为:
//   - apex 高能段例外 → bypass
//   - template[sectionType] 未注册 → bypass(全员 fallback)
//   - 否则:roles ∩ templateRoles
// ============================================================

import type { RoleFilter } from './types';

export const StyleTemplateFilter: RoleFilter = {
    name: 'StyleTemplateFilter',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'Per-section-type 风格模板 role 集 INTERSECTION(apex 高能段例外)',

    apply(roles, ctx) {
        if (ctx.apexException) return [...roles];
        const templateRoles = ctx.sectionCtx.templateRoles;
        if (!templateRoles) return [...roles];
        return roles.filter(r => templateRoles.has(r));
    },
};
