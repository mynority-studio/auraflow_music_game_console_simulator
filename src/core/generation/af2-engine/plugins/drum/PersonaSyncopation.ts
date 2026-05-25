// ============================================================
// PersonaSyncopation Modifier — off-beat 16th snare boost
// ============================================================
//
// 原 DrumIdiom.renderSection 内 syncopation snare boost(2026-05-25 拆 plugin)。
//
// 规则:syncopation > 0 + snareGateOpen + relStep ∈ {1, 3}(off-beat 16th)→
//   snareProbAdj += syncopation * 0.3(上限 0.90)
//
// 必须在 CrossTrack 之后跑(原顺序),让 chord-syncopate boost 后的 snare 仍
// 可被 persona syncopation 进一步推高,产生 neo-soul 神经质 ghost-flam 效果。
// ============================================================

import type { DrumModifier, DrumProbs, DrumModifierContext } from './types';

const SYNCOPATION_SNARE_BOOST = 0.3;
const SNARE_SYNC_CEIL = 0.90;

export const PersonaSyncopation: DrumModifier = {
    name: 'PersonaSyncopation',
    version: 'v1.0',
    prngConsumption: 'zero',
    description: 'Persona syncopationAssault — 16th off-beat(relStep 1/3)snare prob + sync*0.3(ceil 0.90)',

    apply(probs, ctx) {
        if (ctx.syncopation <= 0 || !ctx.snareGateOpen) return probs;
        const relStep = ctx.stepIdx % ctx.stepsPerBeat;
        if (relStep !== 1 && relStep !== 3) return probs;
        return {
            kickProbAdj: probs.kickProbAdj,
            snareProbAdj: Math.min(SNARE_SYNC_CEIL, probs.snareProbAdj + ctx.syncopation * SYNCOPATION_SNARE_BOOST),
            hihatProbAdj: probs.hihatProbAdj,
        };
    },
};
