// ============================================================
// hand-manager.ts — Impro-Visor HandManager 移植
// ============================================================
//
// 原型:`/Users/mynority/vibe_coding/Impro-Visor/src/imp/voicing/HandManager.java`
//
// 职责:per chord 决定 LH/RH 的:
//   - numLeftNotes / numRightNotes(deterministic from rng)
//   - 当前 LH 锚音(基于 prev LH + prefMotion bias)
//   - LH/RH 区间(锚 + spread cap)
//
// 输出供 VoicingGenerator 用 — 它会在指定区间内采样 numLH+numRH 个音。
//
// PRNG:用 AF2 Random class(D-5 deterministic,共识 2)。
// ============================================================

import type { Random } from '../../af2-engine/utils/Random';
import type { VoicingSettings } from '../data/fv-parser';

export interface HandLayout {
  numLeftNotes: number;
  numRightNotes: number;
  lhRangeLow: number;
  lhRangeHigh: number;
  rhRangeLow: number;
  rhRangeHigh: number;
}

/**
 * 决定本 chord 的 LH/RH layout。
 *
 * @param settings   VoicingSettings(from .fv preset)
 * @param prevLhLow  上一 chord LH 最低音(给 prefMotion bias 用;首 chord 传 settings.lhLowerLimit)
 * @param rng        AF2 Random(deterministic)
 */
export function planHands(
  settings: VoicingSettings,
  prevLhLow: number,
  rng: Random,
): HandLayout {
  // 1. 数量(在 [min, max] 内随机)
  const numLeft = settings.lhMinNotes
    + Math.floor(rng.next() * (settings.lhMaxNotes - settings.lhMinNotes + 1));
  const numRight = settings.rhMinNotes
    + Math.floor(rng.next() * (settings.rhMaxNotes - settings.rhMinNotes + 1));

  // 2. LH 锚音 — prev + prefMotion × random shift
  let lhAnchor = prevLhLow;
  if (settings.prefMotion !== 0) {
    const shift = Math.floor(rng.next() * (settings.prefMotionRange + 1));
    lhAnchor += settings.prefMotion * shift;
  }
  // clamp 到 [lhLowerLimit, lhUpperLimit - lhSpread]
  const lhAnchorMax = settings.lhUpperLimit - settings.lhSpread;
  if (lhAnchor < settings.lhLowerLimit) lhAnchor = settings.lhLowerLimit;
  if (lhAnchor > lhAnchorMax) lhAnchor = lhAnchorMax;

  // 3. LH 区间 = [anchor, anchor + spread] ∩ [lower, upper]
  const lhRangeLow = lhAnchor;
  const lhRangeHigh = Math.min(lhAnchor + settings.lhSpread, settings.lhUpperLimit);

  // 4. RH 区间 — 默认从 lhRangeHigh 上方开始,但若 .fv 显式定义 RH range 就用 .fv
  //    Impro-Visor 多数 preset 让 RH 重叠 LH 上半区(让 voicing 更密)— 我们也允许
  const rhRangeLow = settings.rhLowerLimit;
  const rhRangeHigh = settings.rhUpperLimit;

  return { numLeftNotes: numLeft, numRightNotes: numRight, lhRangeLow, lhRangeHigh, rhRangeLow, rhRangeHigh };
}
