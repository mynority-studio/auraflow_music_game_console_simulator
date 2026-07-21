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
import { chordTypeIntervals, normalizeChordType } from '../../newEngine/knowledge/chords';
import type { UserMelodicBrick, MotifHarmonyIntent, SelectedMotifProgression } from './melodicBrickTypes';
import { getProgressionCandidatesForMotif, type ProgressionCandidate } from './progressionCandidateProvider';
import { scoreProgressionAgainstMelodicBrick } from './melodyProgressionScorer';

const SUPPORT_EPS = 1e-6;
const m12 = (n: number): number => ((n % 12) + 12) % 12;

function slotAtBeat(slots: readonly import('../../newEngine/knowledge/progressions').ProgressionSlot[], beat: number): import('../../newEngine/knowledge/progressions').ProgressionSlot {
  let acc = 0;
  for (const s of slots) {
    const b = s.beats ?? 4;
    if (beat >= acc - SUPPORT_EPS && beat < acc + b - SUPPORT_EPS) return s;
    acc += b;
  }
  return slots[slots.length - 1];
}

function slotRealPcs(slot: import('../../newEngine/knowledge/progressions').ProgressionSlot, keyPc: number): number[] {
  const rootPc = m12(keyPc + slot.rootOffset);
  return [...new Set(chordTypeIntervals(normalizeChordType(slot.type) ?? 'maj').map((iv) => m12(rootPc + iv)))];
}

export interface UnsupportedFirstPhraseTone {
  midi: number;
  onsetBeat: number;
  durationBeat: number;
  weight: number;
  slotRoman: string;
}

export interface ProductionPlacementEvaluation {
  score: number;
  viable: boolean;
}

/** 首句硬合同:用户 motif 的结构音(强拍/长音/高结构分)必须被其落点和弦真实 chord tones 支持。 */
export function findUnsupportedFirstPhraseTones(args: {
  brick: UserMelodicBrick;
  slots: readonly import('../../newEngine/knowledge/progressions').ProgressionSlot[];
  keyPc: number;
}): UnsupportedFirstPhraseTone[] {
  const out: UnsupportedFirstPhraseTone[] = [];
  for (const t of args.brick.structuralTones) {
    if (t.onsetBeat >= args.brick.quoteBeats - SUPPORT_EPS) continue;
    const slot = slotAtBeat(args.slots, t.onsetBeat);
    if (!slotRealPcs(slot, args.keyPc).includes(m12(t.midi))) {
      out.push({ midi: t.midi, onsetBeat: t.onsetBeat, durationBeat: t.durationBeat, weight: t.weight, slotRoman: slot.roman });
    }
  }
  return out;
}

export function selectProgressionForMotif(args: {
  brick: UserMelodicBrick;
  intent: MotifHarmonyIntent;
  style: SandboxStyle;
  mode: ScaleMode;
  keyPc: number;
  seed: number;
  targetBars?: number;
  sectionRole?: ProtoSectionRole; // form 主段落角色(软权重;默认 verse)
  inputTonality?: import('./sandboxScales').SandboxTonality; // ★ followup 2.4:布鲁斯 → 评分 blues-aware
  requireFirstPhraseSupport?: boolean; // 产品播放:第一句用户 motif 结构音必须被和声接住;无可用模板时外层可局部修和弦兜底
  /** Product Q+R: score the candidate at its real Functional RoadMap placement. */
  evaluateProductionPlacement?: (candidate: ProgressionCandidate) => ProductionPlacementEvaluation | undefined;
}): SelectedMotifProgression {
  const targetBars = args.targetBars ?? 16;
  const { candidates, modeName } = getProgressionCandidatesForMotif({ style: args.style, mode: args.mode, targetBars });

  const scored = candidates.map((c) => {
    const musical = scoreProgressionAgainstMelodicBrick(args.brick, args.intent, c, args.keyPc, { sectionRole: args.sectionRole, seed: args.seed, inputTonality: args.inputTonality });
    const placement = args.evaluateProductionPlacement?.(c);
    return {
      c,
      ...musical,
      placement,
      total: musical.total + (placement?.score ?? 0),
    };
  });
  // 评分降序 + id 稳定排序(确定性);轮换池据此索引。
  scored.sort((a, b) => b.total - a.total || a.c.prototype.id.localeCompare(b.c.prototype.id));

  // 轮换池:同调式非退化优先 → 空则全部非退化 → 再空则全部。跨 seed 全量可达。
  const nonDegen = scored.filter((s) => s.breakdown.degeneratePenalty === 0);
  const sameModeND = nonDegen.filter((s) => s.c.modeMatch);
  const pool = sameModeND.length ? sameModeND : nonDegen.length ? nonDegen : scored;
  const viablePlacements = pool.filter((candidate) => candidate.placement?.viable);
  const placementBest = viablePlacements[0]?.total;
  const placementPool = viablePlacements.length
    ? viablePlacements.filter((candidate) => placementBest === undefined || candidate.total >= placementBest - 10)
    : pool;
  const hardPool = args.requireFirstPhraseSupport
    ? placementPool.filter((s) => findUnsupportedFirstPhraseTones({ brick: args.brick, slots: s.c.fittedSlots, keyPc: args.keyPc }).length === 0)
    : placementPool;
  const pickPool = hardPool.length ? hardPool : placementPool;
  const pick = pickPool[((args.seed % pickPool.length) + pickPool.length) % pickPool.length]; // seed 轮换(全 pool 跨 seed 都被选到)

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
