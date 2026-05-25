// ============================================================
// PeakKGate — K > musician.persona.peakK 时退出
// ============================================================
//
// 原 Conductor.applyMusicianGates 第 (0b) 层(2026-05-25 拆 plugin)。
//
// 行为:对称于 WakeKGate,只是方向反过来。
//   - apex 高能段例外 → bypass
//   - musician 无 peakK persona → bypass
//   - sectionK <= peakK(未超阈值)→ bypass
//   - sectionK > peakK:
//     · prev 未上岗 OR 差距 > CONTINUITY_K_MARGIN → 返回 [](该段 silent,
//       musician "受不了"高能段退出)
//     · prev 已上岗且差距 <= CONTINUITY_K_MARGIN → Z3 continuity 给"惯性"继续
// ============================================================

import { CONTINUITY_K_MARGIN } from './types';
import type { RoleFilter } from './types';

export const PeakKGate: RoleFilter = {
    name: 'PeakKGate',
    version: '1.0',
    prngConsumption: 'zero',
    description: 'K > peakK 时退出(apex 高能段例外;Z3 continuity ±0.15 容差)',

    apply(roles, ctx) {
        if (ctx.apexException) return [...roles];
        const peakK = ctx.musician?.persona?.peakK;
        if (peakK === undefined) return [...roles];
        const excess = ctx.sectionCtx.sectionK - peakK;
        if (excess <= 0) return [...roles];
        if (!ctx.prevActive || excess > CONTINUITY_K_MARGIN) return [];
        return [...roles];
    },
};
