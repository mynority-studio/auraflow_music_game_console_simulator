// ============================================================
// newEngine · render · motifLineage(墨盒任务书 P1:谱系 + 形式功能 + 距离带)
// ------------------------------------------------------------
// 用户裁决(2026-08-11):锚点节点(presentation/return)逐音保真;发展节点
// (continuation/development)允许保轮廓换音高 —— 倒影解禁,逆行维持禁用。
// 三个核心机制(治"呆板"):
//   1. parent-child 谱系:发展节点从上一变体生长,不再每次重置回 root;
//      return = root 保真 + 继承一个发展引入的时值特征(双亲合成)。
//   2. 形式功能:段落位置 → presentation/continuation/development/return,
//      操作按功能选(continuation 片段化/模进;development 倒影/深模进;
//      return 前 liquidation 收束)。
//   3. 双向相似度带:每个功能有 [min,max] 目标区间 —— 太远丢身份,
//      太近(非锚点原样照抄)判过近,自动加深操作。
// 全部确定性;重定的音高一律吸到 chord-scale 准入集,保序由构造保证。
// ============================================================

import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import {
  admittedPcsAtBeat,
  type UserMotifBrickNote,
} from './userMotifBrick';
import { buildMelodyRhythmShapeProfile, melodyRhythmShapeSimilarity } from './mgRhythmShapeMatcher';

export type MotifFormalFunction = 'presentation' | 'continuation' | 'development' | 'return';
export type MotifPitchPolicy = 'exact' | 'contour';
export type MotifLineageOp =
  | 'fragment-head' | 'fragment-tail' | 'delay-tail' | 'terminal-hold' | 'omit-middle' // 音高保真组
  | 'diatonic-sequence' | 'inversion' | 'contour-repitch' | 'rhythmic-displacement' | 'liquidation'; // 保轮廓换音高组

/** 双向相似度带(vs root;0..1 综合 = 0.5 节奏形状 + 0.5 轮廓符号)。 */
export const FUNCTION_SIMILARITY_BAND: Record<MotifFormalFunction, { min: number; max: number }> = {
  presentation: { min: 0.85, max: 1.01 },
  continuation: { min: 0.5, max: 0.93 },   // max<1:连续原样照抄判"过近"
  development: { min: 0.3, max: 0.82 },
  return: { min: 0.72, max: 1.01 },
};

const mod12 = (v: number): number => ((v % 12) + 12) % 12;
const clone = (notes: readonly UserMotifBrickNote[]): UserMotifBrickNote[] => notes.map((n) => ({ ...n }));

/** 段落在全曲中的位置比例 → 形式功能(陈述段之后的段落调用)。 */
export function formalFunctionForPosition(sectionStartRatio: number, isLastSection: boolean): MotifFormalFunction {
  if (isLastSection) return 'return';
  if (sectionStartRatio < 0.55) return 'continuation';
  return 'development';
}

/** 功能 + 链深度 → 操作(确定性;深度递进 = 单位缩短/操作加深的 continuation 逻辑)。 */
export function lineageOpFor(fn: MotifFormalFunction, depth: number): MotifLineageOp {
  if (fn === 'continuation') {
    const ladder: MotifLineageOp[] = ['fragment-head', 'diatonic-sequence', 'rhythmic-displacement'];
    return ladder[Math.min(depth, ladder.length - 1)];
  }
  if (fn === 'development') {
    const ladder: MotifLineageOp[] = ['inversion', 'diatonic-sequence', 'contour-repitch', 'liquidation'];
    return ladder[Math.min(depth, ladder.length - 1)];
  }
  return 'terminal-hold'; // return 锚点的时值收束由 inherit 处理,此处为兜底
}

export function pitchPolicyForOp(op: MotifLineageOp): MotifPitchPolicy {
  return op === 'diatonic-sequence' || op === 'inversion' || op === 'contour-repitch' || op === 'liquidation'
    ? 'contour' : 'exact';
}

/** 目标拍上按 chord-scale 准入集吸附,并强制与前一输出音的方向一致(保轮廓)。 */
function snapToScaleWithDirection(
  target: number,
  beat: number,
  plan: HarmonicPlan,
  prevOut: number | null,
  direction: number,
): number {
  const admitted = admittedPcsAtBeat(plan, beat);
  if (admitted.length === 0) return target;
  const clamp = (p: number): number => Math.max(48, Math.min(84, p));
  let best: number | null = null;
  for (let d = 0; d <= 6; d++) {
    for (const cand of d === 0 ? [target] : [target - d, target + d]) {
      const p = clamp(cand);
      if (!admitted.includes(mod12(p))) continue;
      if (prevOut !== null && direction !== 0 && Math.sign(p - prevOut) !== direction) continue;
      if (prevOut !== null && direction === 0 && p !== prevOut) continue;
      best = p;
      break;
    }
    if (best !== null) break;
  }
  if (best !== null) return best;
  // 方向约束找不到 → 放弃方向,只保准入(极端和声下轮廓让位于合法性)
  for (let d = 0; d <= 6; d++) {
    for (const cand of d === 0 ? [target] : [target - d, target + d]) {
      const p = clamp(cand);
      if (admitted.includes(mod12(p))) return p;
    }
  }
  return clamp(target);
}

export interface LineageOpResult {
  notes: UserMotifBrickNote[];
  pitchPolicy: MotifPitchPolicy;
  introduced: string[]; // 本节点引入的新特征(供 return 继承 + provenance)
}

/** 对【已落位(绝对拍)】的父代素材施加谱系操作。保序:输出 onset 单调;
 *  contour 组的音高由 chord-scale 重定但方向序列与父代一致(inversion 为镜像方向)。 */
export function applyLineageOp(
  op: MotifLineageOp,
  parent: readonly UserMotifBrickNote[],
  plan: HarmonicPlan,
  windowEndBeat: number,
): LineageOpResult | null {
  const src = [...parent].sort((a, b) => a.onsetBeat - b.onsetBeat);
  const n = src.length;
  if (n < 2) return null;
  const half = Math.max(2, Math.ceil(n / 2));
  const exact = (notes: UserMotifBrickNote[], introduced: string[]): LineageOpResult =>
    ({ notes, pitchPolicy: 'exact', introduced });

  switch (op) {
    case 'fragment-head':
      return n >= 3 ? exact(clone(src.slice(0, half)), ['head-cell']) : null;
    case 'fragment-tail': {
      if (n < 3) return null;
      const tail = clone(src.slice(n - half));
      const shift = tail[0].onsetBeat - src[0].onsetBeat;
      return exact(tail.map((x) => ({ ...x, onsetBeat: x.onsetBeat - shift })), ['tail-cell']);
    }
    case 'delay-tail': {
      const out = clone(src);
      const last = out[n - 1];
      if (last.onsetBeat + 0.5 + 0.25 > windowEndBeat) return null;
      last.onsetBeat += 0.5;
      last.durationBeat = Math.max(0.25, last.durationBeat - 0.5);
      return exact(out, ['delayed-tail']);
    }
    case 'terminal-hold': {
      const out = clone(src);
      out[n - 1].durationBeat = Math.max(out[n - 1].durationBeat, windowEndBeat - out[n - 1].onsetBeat);
      return exact(out, ['terminal-hold']);
    }
    case 'omit-middle': {
      if (n < 4) return null;
      const interior = src.slice(1, n - 1)
        .map((x, i) => ({ index: i + 1, score: x.structuralToneScore ?? 0.5 }))
        .sort((a, b) => a.score - b.score);
      const drop = new Set(interior.slice(0, Math.max(1, Math.floor((n - 2) / 3))).map((x) => x.index));
      return exact(clone(src.filter((_, i) => !drop.has(i))), ['thinned-middle']);
    }
    case 'rhythmic-displacement': {
      const out = clone(src).map((x) => ({ ...x, onsetBeat: x.onsetBeat + 0.5 }));
      if (out[out.length - 1].onsetBeat + 0.25 > windowEndBeat) return null;
      return exact(out, ['displacement']);
    }
    case 'diatonic-sequence':
    case 'inversion':
    case 'contour-repitch':
    case 'liquidation': {
      let material = src;
      const introduced: string[] = [];
      if (op === 'liquidation') { // 先剥离:只留结构骨架(首/尾/最重),再重定音高
        const keep = new Set<number>([0, n - 1]);
        const byWeight = src.map((x, i) => ({ i, w: x.structuralToneScore ?? 0.5 }))
          .sort((a, b) => b.w - a.w);
        for (const { i } of byWeight) { if (keep.size >= Math.max(2, Math.ceil(n / 2) - 1)) break; keep.add(i); }
        material = src.filter((_, i) => keep.has(i));
        introduced.push('liquidation');
      }
      const shift = op === 'diatonic-sequence' ? 2 : 0; // 模进基准位移(吸附后成为调内模进)
      const pivot = material[0].pitch;
      const out: UserMotifBrickNote[] = [];
      let prevSrc: number | null = null;
      let prevOut: number | null = null;
      for (const x of material) {
        const mirrored = op === 'inversion' ? pivot - (x.pitch - pivot) : x.pitch;
        const target = mirrored + shift;
        const direction = prevSrc === null ? 0
          : op === 'inversion' ? -Math.sign(x.pitch - prevSrc)
          : Math.sign(x.pitch - prevSrc);
        const pitch = prevOut === null
          ? snapToScaleWithDirection(target, x.onsetBeat, plan, null, 0)
          : snapToScaleWithDirection(target, x.onsetBeat, plan, prevOut, direction);
        out.push({ ...x, pitch });
        prevSrc = x.pitch;
        prevOut = pitch;
      }
      if (op === 'inversion') introduced.push('inverted-contour');
      if (op === 'diatonic-sequence') introduced.push('sequence-shift');
      if (op === 'contour-repitch') introduced.push('repitched-contour');
      // 音区重锚(P2.2,治"越拓展越高"):链式模进 +2 会累积上浮,吸附方向约束又偏上行。
      // 输出均值漂离父代均值 >5 半音 → 整体按八度拉回(保轮廓/保音阶/保方向序列)。
      const mean = (xs: readonly UserMotifBrickNote[]): number => xs.reduce((s, x) => s + x.pitch, 0) / xs.length;
      const parentMean = mean(material);
      let recentered = out;
      for (let guard = 0; guard < 4 && Math.abs(mean(recentered) - parentMean) > 5; guard++) {
        const dir = mean(recentered) > parentMean ? -12 : 12;
        const shifted = recentered.map((x) => ({ ...x, pitch: x.pitch + dir }));
        if (shifted.some((x) => x.pitch < 48 || x.pitch > 84)) break;
        recentered = shifted;
      }
      return { notes: recentered, pitchPolicy: 'contour', introduced };
    }
    default:
      return null;
  }
}

/** vs root 的综合相似度:0.5 节奏形状 + 0.5 轮廓符号匹配率。 */
export function lineageSimilarityToRoot(
  rootRel: readonly UserMotifBrickNote[],
  candidateRel: readonly UserMotifBrickNote[],
  rootSpan: number,
  candidateSpan: number,
): number {
  const rhythm = melodyRhythmShapeSimilarity(
    buildMelodyRhythmShapeProfile(rootRel, 0, Math.max(1, rootSpan)),
    buildMelodyRhythmShapeProfile(candidateRel, 0, Math.max(1, candidateSpan)),
  );
  const signs = (xs: readonly UserMotifBrickNote[]): number[] => {
    const s = [...xs].sort((a, b) => a.onsetBeat - b.onsetBeat);
    return s.slice(1).map((x, i) => Math.sign(x.pitch - s[i].pitch));
  };
  const a = signs(rootRel), b = signs(candidateRel);
  const len = Math.min(a.length, b.length);
  const contour = len === 0 ? 1 : a.slice(0, len).filter((v, i) => v === b[i]).length / len;
  return 0.5 * rhythm + 0.5 * contour;
}

/** 距离带判定:in-band | too-close | too-far。 */
export function similarityBandVerdict(fn: MotifFormalFunction, similarity: number): 'in-band' | 'too-close' | 'too-far' {
  const band = FUNCTION_SIMILARITY_BAND[fn];
  if (similarity > band.max) return 'too-close';
  if (similarity < band.min) return 'too-far';
  return 'in-band';
}
