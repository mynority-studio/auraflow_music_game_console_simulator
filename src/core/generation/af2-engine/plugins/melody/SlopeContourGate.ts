// ============================================================
// SlopeContourGate — per-sectionType 硬约束 contour 区间
// ============================================================
//
// Phase 4 of Impro-Visor 移植(2026-05-25)。
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/lickgen/LickGen.java`
//        chooseNote 的 slope constraint 处理(line 1982-2174)。
//
// 原 Impro-Visor 语法:
//   (slope MIN MAX terminal1 terminal2 ...)
//   每个 terminal 的 pitch 必须落在 [prevPitch + MIN, prevPitch + MAX] 闭区间。
//
// 与 PhraseContourShaper 的差异:
//   - PhraseContourShaper(已有):MIDI bias(±半音 soft adjust anchor)
//   - SlopeContourGate(新加):每步硬区间 clamp(超出强制 reposition)
//   两者互补 — bias 给方向倾向,gate 防止"明明 Bridge 段却往上跳 octave"。
//
// 算法:
//   slopeMin / slopeMax per SectionType — 给 melody 每步规定 pitch 增量区间
//   pc 不变,octave 调整(找在 [prev+min, prev+max] 内、pc 不变的最近 octave)
//
// AF2 集成(Phase 4 v0.1):
//   - clampToSlope() 独立可调用 — 任何 melody plugin 可消费
//   - Af2MelodyGen 主循环加 opt-in path(SLOPE_GATE_ENABLED const,默认 false)
//   - 启用时:每 slot placeNearAnchor 后调 clampToSlope 收紧到 [prev+min, prev+max]
//
// PRNG 协议:'zero'
// ============================================================

import { SectionType } from '../../../types';
import type { MelodyPluginMeta } from './types';

export interface SlopeSpec {
  /** per-step 增量下界(半音);典型 -7(下行 5 度内)~ -2(限制下行) */
  min: number;
  /** per-step 增量上界(半音);典型 2(限制上行)~ 7(上行 5 度内) */
  max: number;
}

/**
 * Per-sectionType 默认 slope 区间。
 *
 * 设计原则:
 *   - Verse / Default     [-5, +5] — 五度内自由
 *   - Chorus / BuildUp    [-2, +7] — 上行偏好(climax 倾向)
 *   - Bridge              [-7, +2] — 下行偏好(回收)
 *   - Outro / PreOutro    [-7, +1] — 持续下沉
 *   - Intro               [-3, +3] — 紧凑(刚开始,不远离)
 */
export const DEFAULT_SLOPE_BY_SECTION: Record<SectionType, SlopeSpec> = {
  [SectionType.Intro]:       { min: -3, max:  3 },
  [SectionType.Verse]:       { min: -5, max:  5 },
  [SectionType.PreChorus]:   { min: -4, max:  5 },
  [SectionType.Chorus]:      { min: -2, max:  7 },
  [SectionType.BuildUp]:     { min: -2, max:  7 },
  [SectionType.Drop]:        { min: -5, max:  5 },
  [SectionType.Break]:       { min: -3, max:  3 },
  [SectionType.Breakdown]:   { min: -5, max:  2 },
  [SectionType.Bridge]:      { min: -7, max:  2 },
  [SectionType.Solo_Bridge]: { min: -7, max:  7 }, // solo 自由
  [SectionType.PreOutro]:    { min: -7, max:  1 },
  [SectionType.Outro]:       { min: -7, max:  1 },
};

/**
 * 把 candidateMidi 收紧到 [prevMidi + slope.min, prevMidi + slope.max]
 * 区间内,pc 不变,找最近 octave。如所有 octave 全部超界 → clamp 到边界。
 */
export function clampToSlope(
  candidateMidi: number,
  prevMidi: number,
  slope: SlopeSpec,
  loBound: number,
  hiBound: number,
): number {
  const slopeLow = prevMidi + slope.min;
  const slopeHigh = prevMidi + slope.max;
  // 真实区间 = slope ∩ pitch range
  const effLow = Math.max(loBound, slopeLow);
  const effHigh = Math.min(hiBound, slopeHigh);

  // 已在区间 → 直接放行
  if (candidateMidi >= effLow && candidateMidi <= effHigh) return candidateMidi;
  if (effLow > effHigh) {
    // slope 与 pitch range 无交集 — fallback 到 prev 最近的 in-bound
    return Math.max(loBound, Math.min(hiBound, prevMidi));
  }

  const pc = ((candidateMidi % 12) + 12) % 12;
  // 找在 [effLow, effHigh] 内、pc 不变的最近 octave
  let bestMidi = -1;
  let bestDist = Infinity;
  for (let m = pc; m <= 127; m += 12) {
    if (m < effLow || m > effHigh) continue;
    const d = Math.abs(m - candidateMidi);
    if (d < bestDist) {
      bestDist = d;
      bestMidi = m;
    }
  }
  if (bestMidi >= 0) return bestMidi;

  // pc 在 [effLow, effHigh] 内一个 octave 都找不到 — 取区间中点的最近 pc octave
  const mid = Math.round((effLow + effHigh) / 2);
  let fallback = pc;
  while (fallback < effLow - 12) fallback += 12;
  while (fallback < effLow) fallback += 1; // 走半音,允许 pc 变换
  return Math.max(effLow, Math.min(effHigh, fallback));
}

export const SlopeContourGate: MelodyPluginMeta & {
  clamp(
    candidateMidi: number,
    prevMidi: number,
    slope: SlopeSpec,
    loBound: number,
    hiBound: number,
  ): number;
  forSection(sectionType: SectionType): SlopeSpec;
} = {
  name: 'SlopeContourGate',
  version: 'v0.1',
  prngConsumption: 'zero',
  description:
    'Phase 4 Impro-Visor 移植:per-sectionType 硬约束 contour 区间(防止越界跳 octave)',
  clamp: clampToSlope,
  forSection: (s) => DEFAULT_SLOPE_BY_SECTION[s] ?? DEFAULT_SLOPE_BY_SECTION[SectionType.Verse],
};
