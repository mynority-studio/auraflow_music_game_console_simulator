// ============================================================
// motifSandbox · model · 进行选择器(directive §6/§C)
// ------------------------------------------------------------
// selectProgressionForMotif:候选 → 打分 → 【seed 轮换非退化模板池】。
//   ★ 不再只锁 top band 一个(那样固定 motif 跨 seed 只选到 1-2 个模板)→ 改成跨 seed 轮换【全量
//     同调式非退化模板】,让所有 Q+R 风格模板【真的被生成链消费】(directive: reachable across seeds)。
//   退化进行(V-I-I-I 等)被排除;同调式优先(opposite-mode 仅在同调式池空时作回退)。
//   评分顺序仍按贴合度排(index 0 = 最佳),轮换从评分序里取 → 既全量可达、又确定性、又非退化。
// ============================================================

import type { ScaleMode, SandboxStyle } from './types';
import type { ProtoSectionRole } from '../../newEngine/knowledge/progressions';
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
  sectionRole?: ProtoSectionRole; // form 主段落角色(软权重;默认 verse)
}): SelectedMotifProgression {
  const targetBars = args.targetBars ?? 16;
  const { candidates, modeName } = getProgressionCandidatesForMotif({ style: args.style, mode: args.mode, targetBars });

  const scored = candidates.map((c) => ({ c, ...scoreProgressionAgainstMelodicBrick(args.brick, args.intent, c, args.keyPc, { sectionRole: args.sectionRole, seed: args.seed }) }));
  // 评分降序 + id 稳定排序(确定性);轮换池据此索引。
  scored.sort((a, b) => b.total - a.total || a.c.prototype.id.localeCompare(b.c.prototype.id));

  // 轮换池:同调式非退化优先 → 空则全部非退化 → 再空则全部。跨 seed 全量可达。
  const nonDegen = scored.filter((s) => s.breakdown.degeneratePenalty === 0);
  const sameModeND = nonDegen.filter((s) => s.c.modeMatch);
  const pool = sameModeND.length ? sameModeND : nonDegen.length ? nonDegen : scored;
  const pick = pool[((args.seed % pool.length) + pool.length) % pool.length]; // seed 轮换(全 pool 跨 seed 都被选到)

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
