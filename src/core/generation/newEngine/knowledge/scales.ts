// ============================================================
// newEngine · knowledge · ScaleLibrary(B-port 乐理事实)
// ------------------------------------------------------------
// 架构定稿 Part 4。音阶 = 度数→半音的集合(纯事实)。Slice 1 tonal:大调 + 自然小调。
// ============================================================

export type DiatonicMode = 'major' | 'minor';

export const MAJOR_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
export const NATURAL_MINOR: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

export function scaleSemitones(mode: DiatonicMode): number[] {
  return (mode === 'minor' ? NATURAL_MINOR : MAJOR_SCALE).slice();
}

/** 音阶度数(1..7)→ 相对主音的半音。 */
export function degreeToSemitone(degree: number, mode: DiatonicMode): number {
  if (!Number.isInteger(degree) || degree < 1 || degree > 7) {
    throw new RangeError(`degreeToSemitone(): degree 须 1..7,得到 ${degree}`);
  }
  return scaleSemitones(mode)[degree - 1];
}
