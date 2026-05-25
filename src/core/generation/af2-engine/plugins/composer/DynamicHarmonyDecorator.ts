// ============================================================
// DynamicHarmonyDecorator — chord-type decoration plugin
// ============================================================
//
// 原 Af2Composer.decorateChordType(M 阶段 2026-05-24,2026-05-25 拆 plugin)。
//
// Per step 决策流(deterministic per seed):
//   0. step.lockType=true → 保留 step.type(Planner 已锁,跳 2 PRNG ceremony 保流稳)
//   1. Roll colorLevel(0/1/2)from COLOR_LEVEL_PROBABILITIES[mgStyle]
//   2. analyzeTargetQuality(currFunc, nextFunc, next.roman, next.type)
//   3. DYNAMIC_TSD_DICTIONARY[mgStyle][currFunc].find(target) → levels[colorLevel] = choices
//   4. Sub-V activation 条件门(D-function only):
//      perfect-fifth-down(rootDelta=5)+ non-Deceptive + tritoneProb roll
//   5. Pick from choices(或 fallback step.type)— 总消耗 1 PRNG
//   6. Data-debt guard:!CHORD_TYPES[finalType] → 按 currFunc downgrade
//   7. Sub-V override:colorLevel-keyed Lydian Dominant family
//      ('7' / '9' / '13' / '7#11')+ rootOffset +6 + romanOverride 'subV/X'
//
// PRNG 消耗:
//   - lockType:2(ceremony,保流稳)
//   - normal: 2 base(colorLevel + pick) + 0-1(Sub-V gate conditional)
// ============================================================

import type { Af2AbstractStep } from '../../Af2Arranger';
import type { Random } from '../../utils/Random';
import {
    DYNAMIC_TSD_DICTIONARY,
    COLOR_LEVEL_PROBABILITIES,
    analyzeTargetQuality,
    type TSD_Func,
} from '../../DynamicHarmony';
import { harmonicFunctionFromRoman } from '../../music-theory';
import { CHORD_TYPES } from '../../music-theory/chord-types';
import type { ComposerPluginMeta, DecorateResult } from './types';

export const DynamicHarmonyDecorator: ComposerPluginMeta & {
    apply(
        step: Af2AbstractStep,
        next: Af2AbstractStep,
        rng: Random,
    ): DecorateResult;
} = {
    name: 'DynamicHarmonyDecorator',
    version: 'v1.0 (M phase)',
    prngConsumption: 'locked',
    description: 'TSD dict + colorLevel roll + Sub-V tritone substitution + lockType ceremony + data-debt guard',

    apply(step, next, rng) {
        // Locked slot — Planner(borrow/tonicize)已设 exact type
        // 仍消耗 1 + 1 random 保持 stream 稳定(roll + pick)
        if (step.lockType) {
            rng.next();
            rng.next();
            return { type: step.type };
        }

        // 1. Roll colorLevel
        const probs = COLOR_LEVEL_PROBABILITIES;
        const r = rng.next();
        let colorLevel: 0 | 1 | 2 = 0;
        if (r < probs.level0) colorLevel = 0;
        else if (r < probs.level0 + probs.level1) colorLevel = 1;
        else colorLevel = 2;

        // 2. Functional analysis(currFunc 优先用 Planner 标的 effectiveFunc)
        const currFunc: TSD_Func = step.effectiveFunc ?? harmonicFunctionFromRoman(step.roman);
        const nextFunc: TSD_Func = next.effectiveFunc ?? harmonicFunctionFromRoman(next.roman);
        const targetQuality = analyzeTargetQuality(currFunc, nextFunc, next.roman, next.type);

        // 3. Dynamic dictionary lookup
        const rules = DYNAMIC_TSD_DICTIONARY?.[currFunc];
        let choices: string[] | undefined;
        let isTritoneSub = false;

        if (rules) {
            const rule = rules.find(rl => rl.target === targetQuality)
                ?? rules.find(rl => rl.target === 'Default');
            if (rule && rule.levels[colorLevel]) {
                choices = rule.levels[colorLevel];

                // 4. Tritone Substitution probability gate
                // Conditional random:只在 look-ahead AND tritoneProb 都存在 + D-function
                // AND non-deceptive 时 consume。determinism 只在 substitution-eligible 处 vary。
                if (rule.tritoneProb && currFunc === 'D' && targetQuality !== 'Deceptive') {
                    const rootDelta = (((next.rootOffset - step.rootOffset) % 12) + 12) % 12;
                    if (rootDelta === 5 && rng.next() < rule.tritoneProb) {
                        isTritoneSub = true;
                    }
                }
            }
        }

        // 5. Pick(若无 choices,保留原 step.type;仍消耗 1 random 保持稳定)
        let finalType: string;
        if (choices && choices.length > 0) {
            finalType = rng.pick(choices);
        } else {
            rng.next();
            finalType = step.type;
        }

        // 6. Data-debt guard:dictionary 引用未注册的 chord type → 按 function downgrade
        if (!CHORD_TYPES[finalType]) {
            if (currFunc === 'D') finalType = '7';
            else if (currFunc === 'S') finalType = targetQuality === 'MinorTarget' ? 'm7' : 'maj7';
            else finalType = targetQuality === 'MinorTarget' ? 'min' : 'maj';
        }

        // 7. Sub-V override — Lydian Dominant family。静态 map colorLevel
        // 避免 '7#9#11' monster + 不消耗额外 random。
        if (isTritoneSub) {
            let subVType: string;
            if (colorLevel === 0) subVType = '7';
            else if (colorLevel === 1) subVType = '9';
            else subVType = targetQuality === 'MinorTarget' ? '7#11' : '13';

            return {
                type: subVType,
                rootOffsetOverride: ((step.rootOffset + 6) % 12 + 12) % 12,
                romanOverride: `subV/${next.roman.split('/')[0]}`,
            };
        }

        return { type: finalType };
    },
};
