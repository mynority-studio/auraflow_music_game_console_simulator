// ============================================================
// newEngine · knowledge · ChordScales(B-port 乐理事实)
// ------------------------------------------------------------
// chord-scale theory:逐和弦的"真调式音阶"(取代 stable∪acceptable 占位)。
//   - 调内和弦 → 母调音阶(大调 Ionian / 自然小调 Aeolian 的 7 pc)。
//     ∵ 同一调内所有调式(Dorian/Phrygian/Lydian…)pc 集合相同 = 母调音阶,
//       逐和弦的调式只是起点不同 → pc 集合恒等于母调。
//   - 副属(V7/X) → 根音上 Mixolydian(引入离调导音,如 D7→F#)。
//   - 借和弦 iv(同名小调) → 根音上 Dorian(引入 Ab/Eb 等离调色彩)。
// 不变量:和弦音 ⊆ chord-scale(本模块保证)。纯乐理事实,确定性,无 rng。
// ============================================================

import { mod12, type PitchClass } from '../foundation';
import { MAJOR_SCALE, NATURAL_MINOR, type DiatonicMode } from './scales';

// 从根音起的调式半音程(仅副属/借和弦两类离调用到;调内走母调音阶)
const MIXOLYDIAN: readonly number[] = [0, 2, 4, 5, 7, 9, 10]; // 属和弦
const DORIAN: readonly number[] = [0, 2, 3, 5, 7, 9, 10]; // 小调 iv(借和弦)

export interface ChordScaleContext {
  /** 副属(secondaryTarget 已存)→ 根音 Mixolydian。 */
  isSecondaryDominant?: boolean;
  /** 借自同名小调(iv 等)→ 根音 Dorian。 */
  isBorrowed?: boolean;
}

/**
 * 真 chord-scale:返回该和弦的调式音阶(7 个 pc,升序去重)。
 * 调内 → 母调音阶(keyPc + keyMode);离调两类 → 根音上专属调式。
 */
export function realChordScale(
  rootPc: PitchClass,
  keyPc: PitchClass,
  keyMode: DiatonicMode,
  ctx: ChordScaleContext = {},
): PitchClass[] {
  let pattern: readonly number[];
  let anchor: PitchClass;
  if (ctx.isSecondaryDominant) {
    pattern = MIXOLYDIAN;
    anchor = rootPc;
  } else if (ctx.isBorrowed) {
    pattern = DORIAN;
    anchor = rootPc;
  } else {
    pattern = keyMode === 'minor' ? NATURAL_MINOR : MAJOR_SCALE;
    anchor = keyPc;
  }
  const pcs = new Set<number>(pattern.map((iv) => mod12(anchor + iv)));
  return [...pcs].sort((a, b) => a - b) as PitchClass[];
}
