// ============================================================
// motifSandbox · model · 输入置信度(motif development redesign 一期)
// ------------------------------------------------------------
// 判断用户输入是「演奏」还是「灵感草稿」→ 决定引擎干预力度(docs/motif-development-redesign-task.md §2)。
// 六维打分,每维带 informative 标记:无信息维度(如按位输入的音高维)从加权平均【剔除】而非记零分。
// 全局分定档(fidelity/refine/heal),逐音干预点交给二期锚点层。纯函数、确定性。
// ============================================================

import type { UserMotif, HealingMode } from './types';
import type { MotifTimingAnalysis } from './motifAnalysis';
import type { UserMelodicBrick } from './melodicBrickTypes';
import { metricalWeight, type GridCapturedNote } from '../capture/hiddenGridClock';

export type MotifInputSource = 'position' | 'pitch';
export type MotifInterventionTier = 'fidelity' | 'refine' | 'heal';
export type MotifConfidenceDimensionKey = 'timing' | 'pitch' | 'velocity' | 'fragmentation' | 'structure' | 'harmony';

export interface MotifConfidenceDimension {
  key: MotifConfidenceDimensionKey;
  label: string;
  score: number;        // 0..1(informative=false 时仅供调试,不进 overall)
  weight: number;       // 基础权重(informative 维度间重归一)
  informative: boolean;
  evidence: string[];
}

export interface MotifConfidenceProfile {
  overall: number;      // 0..1 加权平均(仅 informative 维度)
  tier: MotifInterventionTier;
  dimensions: MotifConfidenceDimension[];
  evidence: string[];   // 汇总(每个 informative 维度的首条证据)
}

export interface MotifConfidenceInput {
  motif: UserMotif;
  inputSource: MotifInputSource;
  timing?: MotifTimingAnalysis;             // 隐形网格路径才有;free 路径缺 → 时值维不参与
  gridNotes?: readonly GridCapturedNote[];  // 有则加测赶拍/拖拍漂移
  snapChanges?: number;                     // 音阶吸附改音数(hidden-grid 已统计)
  brick?: UserMelodicBrick;                 // 有则收尾稳定性用 cadence 分类
  harmonicSupportRatio?: number;            // 落位时的和声支持度(0..1);分析期缺 → 和声维不参与
  healingMode?: HealingMode;                // off = 破碎度维无信息(未扫描)
}

/** 干预档位阈值(可审计常量;docs §2)。 */
export const MOTIF_CONFIDENCE_FIDELITY_MIN = 0.75;
export const MOTIF_CONFIDENCE_REFINE_MIN = 0.45;

const BASE_WEIGHTS: Record<MotifConfidenceDimensionKey, number> = {
  timing: 0.30, pitch: 0.20, velocity: 0.10, fragmentation: 0.15, structure: 0.15, harmony: 0.10,
};
const DIMENSION_LABEL: Record<MotifConfidenceDimensionKey, string> = {
  timing: '时值控制', pitch: '音高把控', velocity: '力度意图', fragmentation: '破碎度', structure: '结构完形', harmony: '和声接洽',
};

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const beatInBar = (b: number): number => ((b % 4) + 4) % 4;

export function motifInterventionTier(overall: number): MotifInterventionTier {
  if (overall >= MOTIF_CONFIDENCE_FIDELITY_MIN) return 'fidelity';
  if (overall >= MOTIF_CONFIDENCE_REFINE_MIN) return 'refine';
  return 'heal';
}

export const MOTIF_TIER_LABEL: Record<MotifInterventionTier, string> = {
  fidelity: '保真', refine: '修饰', heal: '治愈',
};

function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const denom = Math.sqrt(sxx * syy);
  return denom < 1e-9 ? 0 : sxy / denom;
}

function timingDimension(timing: MotifTimingAnalysis | undefined, gridNotes: readonly GridCapturedNote[] | undefined): MotifConfidenceDimension {
  const dim: MotifConfidenceDimension = { key: 'timing', label: DIMENSION_LABEL.timing, score: 0, weight: BASE_WEIGHTS.timing, informative: false, evidence: [] };
  if (!timing) { dim.evidence.push('无网格时序数据(free 录制)→ 不参与'); return dim; }
  dim.informative = true;
  const meanScore = 1 - clamp01(timing.quantizeErrorMean / 0.125);       // 均值达半个 16 分(0.125 拍)= 失控
  const maxScore = 1 - clamp01((timing.quantizeErrorMax - 0.0625) / 0.25);
  dim.evidence.push(`量化误差均值 ${timing.quantizeErrorMean.toFixed(3)} 拍 · 峰值 ${timing.quantizeErrorMax.toFixed(3)} 拍`);
  if (gridNotes && gridNotes.length >= 6) {
    // 赶拍/拖拍漂移:前后半段 signed 误差均值差(演奏稳定 → 漂移小)
    const errs = gridNotes.map((n) => n.timingErrorBeat);
    const half = Math.floor(errs.length / 2);
    const mean = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const drift = Math.abs(mean(errs.slice(half)) - mean(errs.slice(0, half)));
    const driftScore = 1 - clamp01(drift / 0.25);
    dim.evidence.push(`节奏漂移 ${drift.toFixed(3)} 拍(前后半段)`);
    dim.score = clamp01(0.55 * meanScore + 0.25 * maxScore + 0.2 * driftScore);
  } else {
    dim.score = clamp01(0.7 * meanScore + 0.3 * maxScore);
  }
  return dim;
}

function pitchDimension(motif: UserMotif, inputSource: MotifInputSource, snapChanges: number | undefined): MotifConfidenceDimension {
  const dim: MotifConfidenceDimension = { key: 'pitch', label: DIMENSION_LABEL.pitch, score: 0, weight: BASE_WEIGHTS.pitch, informative: false, evidence: [] };
  if (inputSource === 'position') { dim.evidence.push('按位输入音高由映射保证 → 不参与'); return dim; }
  dim.informative = true;
  const notes = motif.notes;
  // 无消解大跳:>P5 的跳进后应反向级进回收(≤大三度);同向续跳/大幅反跳 ≈ 失误。末音跳进不罚(戏剧性收尾)。
  const intervals: number[] = [];
  for (let i = 1; i < notes.length; i++) intervals.push(notes[i].midi - notes[i - 1].midi);
  let leaps = 0, unresolved = 0;
  for (let i = 0; i < intervals.length; i++) {
    if (Math.abs(intervals[i]) <= 7) continue;
    leaps++;
    const next = intervals[i + 1];
    if (next === undefined) continue;
    if (Math.sign(next) === Math.sign(intervals[i]) || Math.abs(next) > 4) unresolved++;
  }
  const leapScore = leaps === 0 ? 1 : 1 - unresolved / leaps;
  if (leaps > 0) dim.evidence.push(`大跳 ${leaps} 处 · 未回收 ${unresolved} 处`);
  if (snapChanges !== undefined) {
    const snapRatio = snapChanges / Math.max(1, notes.length);
    const snapScore = 1 - clamp01(snapRatio / 0.4); // 四成音离调被吸 = 失控
    dim.evidence.push(`离调被吸附 ${snapChanges}/${notes.length} 音`);
    dim.score = clamp01(0.6 * snapScore + 0.4 * leapScore);
  } else {
    dim.score = clamp01(leapScore);
    if (leaps === 0) dim.evidence.push('无大跳,音程行进平顺');
  }
  return dim;
}

function velocityDimension(motif: UserMotif): MotifConfidenceDimension {
  const dim: MotifConfidenceDimension = { key: 'velocity', label: DIMENSION_LABEL.velocity, score: 0, weight: BASE_WEIGHTS.velocity, informative: false, evidence: [] };
  const vels = motif.notes.map((n) => n.velocity);
  const spread = Math.max(...vels) - Math.min(...vels);
  if (motif.notes.length < 4 || spread < 0.08) { dim.evidence.push('力度近恒定(pad/固定力度)→ 不参与'); return dim; }
  dim.informative = true;
  // 有意演奏:力度与节拍权重正相关(强拍给重音);负相关 = 随机拍打
  const weights = motif.notes.map((n) => metricalWeight(beatInBar(n.onsetBeat)));
  const corr = pearson(vels, weights);
  dim.score = clamp01(0.5 + corr * 0.9);
  dim.evidence.push(`力度×节拍权重相关 ${corr.toFixed(2)}(正 = 强拍有重音)`);
  return dim;
}

function fragmentationDimension(motif: UserMotif, healingMode: HealingMode): MotifConfidenceDimension {
  const dim: MotifConfidenceDimension = { key: 'fragmentation', label: DIMENSION_LABEL.fragmentation, score: 0, weight: BASE_WEIGHTS.fragmentation, informative: false, evidence: [] };
  if (healingMode === 'off') { dim.evidence.push('治愈关闭(未扫描)→ 不参与'); return dim; }
  dim.informative = true;
  const healed = motif.notes.filter((n) => n.healingTags?.includes('gap-healed-legato')).length;
  const ratio = healed / Math.max(1, motif.notes.length);
  dim.score = 1 - clamp01(ratio / 0.5); // 一半音被补连 = 高度破碎
  dim.evidence.push(healed === 0 ? '无被夹短的音,连贯' : `${healed}/${motif.notes.length} 音被夹短后补连`);
  return dim;
}

function structureDimension(motif: UserMotif, brick: UserMelodicBrick | undefined): MotifConfidenceDimension {
  const dim: MotifConfidenceDimension = { key: 'structure', label: DIMENSION_LABEL.structure, score: 0, weight: BASE_WEIGHTS.structure, informative: true, evidence: [] };
  const notes = motif.notes;
  const last = notes[notes.length - 1];
  // 收尾稳定:落 1/3/5 或 brick cadence 强度
  const stableEnd = last !== undefined && [1, 3, 5].includes(last.scaleDegree) ? 1 : 0.25;
  const cadence = brick?.cadenceMotion;
  const endScore = cadence && cadence.strength > 0 ? Math.max(stableEnd, clamp01(cadence.strength + 0.1)) : stableEnd;
  dim.evidence.push(cadence ? `收尾 ${cadence.fromDegree}→${cadence.toDegree}(${cadence.pattern},强度 ${cadence.strength.toFixed(2)})` : `尾音落 ${last?.scaleDegree ?? '?'} 级`);
  // 轮廓拱形:方向反转占比小 = 清晰线条;锯齿 = 噪声
  const dirs = motif.contour.filter((c) => c !== 0);
  let changes = 0;
  for (let i = 1; i < dirs.length; i++) if (dirs[i] !== dirs[i - 1]) changes++;
  const changeRatio = dirs.length > 1 ? changes / (dirs.length - 1) : 0;
  const arcScore = 1 - clamp01((changeRatio - 0.34) / 0.5);
  if (changeRatio > 0.6) dim.evidence.push(`轮廓锯齿(反转率 ${(changeRatio * 100).toFixed(0)}%)`);
  // 收边:末音结束位相对 motif 网格长度(远早于收边 = 半途而废)
  const lastEnd = Math.max(...notes.map((n) => n.onsetBeat + n.durationBeat), 0.25);
  const fill = lastEnd / Math.max(1, motif.lengthBeats);
  const fillScore = clamp01((fill - 0.45) / 0.4);
  if (fill < 0.7) dim.evidence.push(`旋律止于网格 ${(fill * 100).toFixed(0)}% 处,收边偏早`);
  dim.score = clamp01(0.4 * endScore + 0.3 * arcScore + 0.3 * fillScore);
  return dim;
}

function harmonyDimension(harmonicSupportRatio: number | undefined): MotifConfidenceDimension {
  const dim: MotifConfidenceDimension = { key: 'harmony', label: DIMENSION_LABEL.harmony, score: 0, weight: BASE_WEIGHTS.harmony, informative: false, evidence: [] };
  if (harmonicSupportRatio === undefined) { dim.evidence.push('落位前无和声数据 → 不参与'); return dim; }
  dim.informative = true;
  dim.score = clamp01((harmonicSupportRatio - 0.5) / 0.45);
  dim.evidence.push(`最佳落位和声支持度 ${(harmonicSupportRatio * 100).toFixed(0)}%`);
  return dim;
}

/** 六维输入置信度(纯函数)。overall 只由 informative 维度加权(权重重归一)。 */
export function buildMotifConfidenceProfile(input: MotifConfidenceInput): MotifConfidenceProfile {
  const dimensions: MotifConfidenceDimension[] = [
    timingDimension(input.timing, input.gridNotes),
    pitchDimension(input.motif, input.inputSource, input.snapChanges),
    velocityDimension(input.motif),
    fragmentationDimension(input.motif, input.healingMode ?? 'beginner'),
    structureDimension(input.motif, input.brick),
    harmonyDimension(input.harmonicSupportRatio),
  ];
  const informative = dimensions.filter((d) => d.informative);
  const totalWeight = informative.reduce((a, d) => a + d.weight, 0);
  const overall = totalWeight > 0
    ? clamp01(informative.reduce((a, d) => a + d.score * d.weight, 0) / totalWeight)
    : 0.5; // 全维无信息(理论不可达:结构维恒 informative)→ 中档兜底
  return {
    overall,
    tier: motifInterventionTier(overall),
    dimensions,
    evidence: informative.map((d) => `${d.label}:${d.evidence[0] ?? ''}`).slice(0, 6),
  };
}
