// ============================================================
// motifSandbox · model · Harmony Intent(directive §6.2)—— brick 功能 → 和声偏好
// ============================================================

import type { UserMelodicBrick, MotifHarmonyIntent } from './melodicBrickTypes';

const STABLE = new Set([1, 3, 5]);
const TENSION = new Set([2, 4, 7]);
const DEGENERATE = ['I-I-I-I', 'V-I-I-I', 'I-V-I-I'];

const stabilityOf = (deg: number): 'stable' | 'unstable' | 'ambiguous' =>
  STABLE.has(deg) ? 'stable' : TENSION.has(deg) ? 'unstable' : 'ambiguous';

/** brick → MotifHarmonyIntent。终止类要强收;开句类要开放/loop;趋近类要 S/D 进稳定。 */
export function inferHarmonyIntent(brick: UserMelodicBrick): MotifHarmonyIntent {
  const fn = brick.primaryFunction;
  const headDeg = brick.head?.scaleDegree ?? 1;
  const tailDeg = brick.tail?.scaleDegree ?? 1;

  let cadenceNeed: MotifHarmonyIntent['cadenceNeed'] = 'weak';
  let endingStability: MotifHarmonyIntent['endingStability'] = TENSION.has(tailDeg) ? 'open' : STABLE.has(tailDeg) ? 'stable' : 'open';
  let preferTemplateCadence: MotifHarmonyIntent['preferTemplateCadence'] = ['loop', 'weak'];

  switch (fn) {
    case 'cadence':
    case 'resolution':
      cadenceNeed = 'strong'; endingStability = 'stable'; preferTemplateCadence = ['soft_authentic', 'weak']; break;
    case 'approach':
      cadenceNeed = 'weak'; endingStability = 'open'; preferTemplateCadence = ['soft_authentic', 'weak', 'loop']; break;
    case 'opening':
    case 'launcher':
      cadenceNeed = 'none'; endingStability = 'open'; preferTemplateCadence = ['open', 'loop']; break;
    case 'answer':
      cadenceNeed = 'weak'; preferTemplateCadence = ['weak', 'loop', 'soft_authentic']; break;
    default:
      cadenceNeed = 'weak'; preferTemplateCadence = ['loop', 'open']; break;
  }

  return {
    targetFunctions: ['T', 'S', 'D'], // 偏好功能完整的进行(避免全 T 退化)
    cadenceNeed,
    startStability: stabilityOf(headDeg),
    endingStability,
    preferTemplateCadence,
    preferredStartDegrees: STABLE.has(headDeg) ? [headDeg, 1] : [1],
    preferredLandingDegrees: STABLE.has(tailDeg) ? [tailDeg, 1] : [1],
    avoidDegenerateProgressions: DEGENERATE,
  };
}
