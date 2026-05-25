// ==========================================
// PicardyPlanner — Picardy 3rd ending(K3 阶段)
// ==========================================
//
// Minor 调里把 phrase ending 的 minor i 替换为 major I —
// JS Bach 经典手法,巴洛克到 21 世纪一直在用:
//   Beatles "And I Love Her"(终结)
//   Coldplay "Fix You"(尾段 lift)
//   Adele 大量 ballads
//
// 听感效果:小调全程的"sad"在最后一刻 lift 到大调,产生"hope"感。
//
// 触发条件:
//   1. song mode 是 Minor(Major 调 short-circuit)
//   2. curr 是 minor tonic(rootOffset=0,type 是 min/m7/m9/m11/min 家族)
//   3. phraseRole === 'cadence' 或 'ending'(每 phrase 末或全曲末)
//   4. random.next() < per-mgStyle prob
//
// Per-mgStyle prob:
//   POP   0.30 — Coldplay / Beatles 风,常见
//   JAZZ  0.20 — bebop 不常用,ballad 偶尔
//   RNB   0.25 — soul ballad ending
//   BLUES 0.10 — blues 通常开放结尾,极少用
//
// 替换:i.type → maj 家族
//   min   → maj
//   m7    → maj7
//   m9    → maj9
//   m11   → maj9(11 跟 maj3 冲突,降级)
//
// lockType=true:Composer Divisi 不要再加 9/13 tension(避免 maj 突然出现
// 9/13 听感歪;Picardy 的核心是 triad 3 升)。
//
// PRNG:每 chord 1 roll(条件未满足时仍 consume 保 stream 稳定)。
// ==========================================

import type { Af2AbstractStep, BorrowedSource } from './Af2Arranger';
import type { Random } from './utils/Random';
import { classifyPhraseRole } from './utils/phrase-role';
import { MINOR_TO_MAJOR_TYPE } from './utils/minor-major-type';

// POP-only Picardy 概率(JAZZ/BLUES/RNB 已退役)
const PICARDY_PROB: number = 0.30;

/** 是否是 minor tonic chord(rootOffset=0 + minor 家族 type)*/
function isMinorTonic(step: Af2AbstractStep): boolean {
    if (((step.rootOffset % 12) + 12) % 12 !== 0) return false;
    return step.type in MINOR_TO_MAJOR_TYPE;
}

export interface PlanPicardyOptions {
    skeleton: Af2AbstractStep[];
    motifInterval: number;
    random: Random;
}

/**
 * 主入口。返回新 skeleton 数组(原数组不动)。
 * 只在 phraseRole=cadence/ending + minor tonic 时考虑替换。
 * lockType 标记的 slot 跳过(BorrowPlanner / TonicizationPlanner 已处理过)。
 */
export function planPicardyEndings(opts: PlanPicardyOptions): Af2AbstractStep[] {
    const { skeleton, motifInterval, random } = opts;
    const baseProb = PICARDY_PROB;
    if (baseProb === 0 || skeleton.length < 2) return skeleton.slice();

    const result: Af2AbstractStep[] = [];
    for (let i = 0; i < skeleton.length; i++) {
        const curr = skeleton[i];

        if (curr.lockType) {
            result.push(curr);
            continue;
        }

        const phraseRole = classifyPhraseRole(i, skeleton.length, motifInterval);
        const isCandidate = (phraseRole === 'cadence' || phraseRole === 'ending') && isMinorTonic(curr);

        if (!isCandidate) {
            result.push(curr);
            continue;
        }

        // Roll 决定是否 Picardy(roll consume 不影响主流)
        const roll = random.next();
        if (roll >= baseProb) {
            result.push(curr);
            continue;
        }

        // Picardy:i → I
        const newType = MINOR_TO_MAJOR_TYPE[curr.type] ?? 'maj';
        result.push({
            ...curr,
            roman: 'I',
            type: newType,
            borrowedFrom: 'I (Picardy 3rd)',
            borrowedSource: 'modal_interchange' as BorrowedSource,
            mustResolve: false,
            lockType: true,
        });
    }
    return result;
}
