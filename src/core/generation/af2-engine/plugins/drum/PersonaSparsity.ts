// ============================================================
// PersonaSparsity Modifier — persona.sparsityTendency 减密
// ============================================================
//
// 原 DrumIdiom.renderSection 内 sparsityFactor 计算(2026-05-25 拆 plugin)。
//
// 公式:全 3 probs(kick / snare / hihat)× (1 - sparsity * 0.4)
// 即 sparsity=1 时最多减 40%,sparsity=0 时不变。
//
// 注:此 plugin 必须在 CrossTrack 之前跑(原顺序:sparsity 先 → 然后 bass/chord
// 提升;若 sparsity 后跑,bass-strong-near 提升后的 0.75 floor 会被 sparsity 再
// 砍,听感不符)。
// ============================================================

import type { DrumModifier, DrumProbs, DrumModifierContext } from './types';

const SPARSITY_FACTOR = 0.4;

export const PersonaSparsity: DrumModifier = {
    name: 'PersonaSparsity',
    version: 'v1.0',
    prngConsumption: 'zero',
    description: 'Persona sparsityTendency 全 probs ×(1 - sparsity * 0.4)',

    apply(probs, ctx) {
        const factor = 1 - ctx.sparsity * SPARSITY_FACTOR;
        return {
            kickProbAdj: probs.kickProbAdj * factor,
            snareProbAdj: probs.snareProbAdj * factor,
            hihatProbAdj: probs.hihatProbAdj * factor,
        };
    },
};
