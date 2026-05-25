// ============================================================
// MusicianPrefFilter — musician 卡 sectionRolePreference INTERSECTION
// ============================================================
//
// 原 Conductor.applyMusicianGates 第 (3) 层(2026-05-25 拆 plugin)。
//
// 行为(注意:apex 也尊重 user 意图,不 bypass):
//   - musician.af2Overrides.sectionRolePreference[sectionType] 未配 → bypass
//   - 否则:roles ∩ pref
//
// 用例:某 musician 卡明确"我不演这种段",即使 isApex 也照办。
// ============================================================

import type { RoleFilter } from './types';

export const MusicianPrefFilter: RoleFilter = {
    name: 'MusicianPrefFilter',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'musician.af2Overrides.sectionRolePreference[sectionType] INTERSECTION(apex 也尊重)',

    apply(roles, ctx) {
        const pref = ctx.musician?.af2Overrides?.sectionRolePreference?.[ctx.section.sectionType];
        if (pref === undefined) return [...roles];
        return roles.filter(r => pref.has(r));
    },
};
