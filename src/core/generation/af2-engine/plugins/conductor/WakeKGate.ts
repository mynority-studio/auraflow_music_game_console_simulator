// ============================================================
// WakeKGate — K < musician.persona.wakeK 时 sleeping
// ============================================================
//
// 原 Conductor.applyMusicianGates 第 (0) 层(2026-05-25 拆 plugin)。
//
// 行为:
//   - apex 高能段例外(apexException = true)→ bypass(原样返回)
//   - musician 无 wakeK persona → bypass
//   - sectionK >= wakeK(达到唤醒阈值)→ bypass
//   - sectionK < wakeK:
//     · prev 未上岗 OR 差距 > CONTINUITY_K_MARGIN → 返回 [](该段 silent)
//     · prev 已上岗且差距 <= CONTINUITY_K_MARGIN → Z3 continuity 给"惯性"继续
// ============================================================

import { CONTINUITY_K_MARGIN } from './types';
import type { RoleFilter } from './types';

export const WakeKGate: RoleFilter = {
    name: 'WakeKGate',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'K < wakeK 时 sleeping(apex 高能段例外;Z3 continuity ±0.15 容差)',

    apply(roles, ctx) {
        if (ctx.apexException) return [...roles];
        const wakeK = ctx.musician?.persona?.wakeK;
        if (wakeK === undefined) return [...roles];
        const deficit = wakeK - ctx.sectionCtx.sectionK;
        if (deficit <= 0) return [...roles];
        if (!ctx.prevActive || deficit > CONTINUITY_K_MARGIN) return [];
        return [...roles];
    },
};
