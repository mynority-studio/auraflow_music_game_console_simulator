// ============================================================
// motifSandbox · model · 进行选择器(directive §C)
// ------------------------------------------------------------
// selectProgressionForMotif:候选 → 打分 → 取 top band → seed 仅做 band 内确定性挑选。
//   退化进行(V-I-I-I 等)被重罚,几乎不会被选中。
// ============================================================

import { makeRng } from './rng';
import type { ScaleMode, SandboxStyle } from './types';
import type { UserMelodicBrick, MotifHarmonyIntent, SelectedMotifProgression } from './melodicBrickTypes';
import { getProgressionCandidatesForMotif } from './progressionCandidateProvider';
import { scoreProgressionAgainstMelodicBrick } from './melodyProgressionScorer';

export function selectProgressionForMotif(args: {
  brick: UserMelodicBrick;
  intent: MotifHarmonyIntent;
  style: SandboxStyle;
  mode: ScaleMode;
  keyPc: number;
  seed: number;
  targetBars?: number;
}): SelectedMotifProgression {
  const targetBars = args.targetBars ?? 16;
  const { candidates, modeName } = getProgressionCandidatesForMotif({ style: args.style, mode: args.mode, targetBars });

  const scored = candidates.map((c) => ({ c, ...scoreProgressionAgainstMelodicBrick(args.brick, args.intent, c, args.keyPc) }));
  scored.sort((a, b) => b.total - a.total);

  const top = scored[0].total;
  const band = scored.filter((s) => s.total >= top - 0.08); // top band(并列/接近)
  const rng = makeRng((args.seed ^ 0x1b873593) >>> 0);
  const pick = band[rng.int(band.length)];

  return {
    prototypeId: pick.c.prototype.id,
    style: pick.c.prototype.style,
    mode: modeName,
    slots: pick.c.fittedSlots,
    fittedBars: targetBars,
    cadence: pick.c.prototype.cadence ?? 'none',
    score: pick.total,
    scoreBreakdown: pick.breakdown,
    topCandidates: scored.slice(0, 5).map((s) => ({ prototypeId: s.c.prototype.id, score: s.total })),
  };
}
