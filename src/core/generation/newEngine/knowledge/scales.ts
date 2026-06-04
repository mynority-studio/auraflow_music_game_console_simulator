// ============================================================
// newEngine · knowledge · ScaleLibrary(B-port 乐理事实)
// ------------------------------------------------------------
// 架构定稿 Part 4 / KB 移植计划 §1。音阶 = 度数→半音的集合(纯事实)。
//   兼容层:大调 + 自然小调 + degreeToSemitone(原有调用不动)。
//   完整 ScaleLibrary:36 种音阶(port 自 melodygenerative SCALE_TYPES,逐值忠实),
//   按 family 分类,提供 getScaleType / listScaleTypes / getScalePitchClasses 查询。
// ============================================================

import { mod12, type PitchClass } from '../foundation';

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

// —— 完整 ScaleLibrary(KB 移植 §1)——

// 相对主音的半音集合。port 自 melodygenerative/src/lib/musicTheory.ts SCALE_TYPES,逐值忠实。
const SCALE_INTERVALS = {
  // 教会调式
  'Ionian': [0, 2, 4, 5, 7, 9, 11],
  'Dorian': [0, 2, 3, 5, 7, 9, 10],
  'Phrygian': [0, 1, 3, 5, 7, 8, 10],
  'Lydian': [0, 2, 4, 6, 7, 9, 11],
  'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
  'Aeolian': [0, 2, 3, 5, 7, 8, 10],
  'Locrian': [0, 1, 3, 5, 6, 8, 10],
  // 小调变体
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Melodic Minor': [0, 2, 3, 5, 7, 9, 11],
  // 五声 / 布鲁斯
  'Major Pentatonic': [0, 2, 4, 7, 9],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Major Blues': [0, 2, 3, 4, 7, 9],
  'Composite Blues': [0, 3, 4, 5, 6, 7, 10],
  'Country Blues': [0, 2, 3, 4, 7, 9, 10],
  'Mixolydian Pentatonic': [0, 4, 5, 7, 10],
  'Lydian Pentatonic': [0, 4, 6, 9, 11],
  'Locrian Pentatonic': [0, 3, 5, 6, 10],
  'Minor Six Pentatonic': [0, 3, 5, 7, 9],
  // 爵士 / 对称
  'Altered': [0, 1, 3, 4, 6, 8, 10],
  'Half-Whole Diminished': [0, 1, 3, 4, 6, 7, 9, 10],
  'Whole-Half Diminished': [0, 2, 3, 5, 6, 8, 9, 11],
  'Whole Tone': [0, 2, 4, 6, 8, 10],
  'Lydian Dominant': [0, 2, 4, 6, 7, 9, 10],
  'Augmented': [0, 3, 4, 7, 8, 11],
  // bebop(8 音,加半音经过音)
  'Bebop Dominant': [0, 2, 4, 5, 7, 9, 10, 11],
  'Bebop Major': [0, 2, 4, 5, 7, 8, 9, 11],
  'Bebop Dorian': [0, 2, 3, 4, 5, 7, 9, 10],
  'Bebop Melodic Minor': [0, 2, 3, 5, 7, 8, 9, 11],
  // 色彩 / 世界 / 调式互换
  'Phrygian Dominant': [0, 1, 4, 5, 7, 8, 10],
  'Mixolydian b6': [0, 2, 4, 5, 7, 8, 10],
  'Lydian #9': [0, 3, 4, 6, 7, 9, 11],
  'Harmonic Major': [0, 2, 4, 5, 7, 8, 11],
  'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'In-Sen': [0, 1, 5, 7, 10],
  'Double Harmonic Major': [0, 1, 4, 5, 7, 8, 11],
} satisfies Record<string, readonly number[]>;

export type ScaleTypeId = keyof typeof SCALE_INTERVALS;
export type ScaleFamily = 'diatonic-mode' | 'minor-variant' | 'pentatonic-blues' | 'jazz-symmetric' | 'bebop' | 'color-world';

const FAMILY_OF: Record<ScaleFamily, readonly ScaleTypeId[]> = {
  'diatonic-mode': ['Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian'],
  'minor-variant': ['Harmonic Minor', 'Melodic Minor'],
  'pentatonic-blues': ['Major Pentatonic', 'Minor Pentatonic', 'Blues', 'Major Blues', 'Composite Blues', 'Country Blues', 'Mixolydian Pentatonic', 'Lydian Pentatonic', 'Locrian Pentatonic', 'Minor Six Pentatonic'],
  'jazz-symmetric': ['Altered', 'Half-Whole Diminished', 'Whole-Half Diminished', 'Whole Tone', 'Lydian Dominant', 'Augmented'],
  'bebop': ['Bebop Dominant', 'Bebop Major', 'Bebop Dorian', 'Bebop Melodic Minor'],
  'color-world': ['Phrygian Dominant', 'Mixolydian b6', 'Lydian #9', 'Harmonic Major', 'Chromatic', 'In-Sen', 'Double Harmonic Major'],
};

const SCALE_FAMILY = (() => {
  const m = {} as Record<ScaleTypeId, ScaleFamily>;
  for (const fam of Object.keys(FAMILY_OF) as ScaleFamily[]) for (const id of FAMILY_OF[fam]) m[id] = fam;
  return m;
})();

// core = 调式 + 小调变体(引擎常用);其余 extended。
const CORE_FAMILIES: ReadonlySet<ScaleFamily> = new Set(['diatonic-mode', 'minor-variant']);

export interface ScaleTypeDefinition {
  id: ScaleTypeId;
  family: ScaleFamily;
  source: 'core' | 'extended';
  intervals: readonly number[]; // 相对主音半音
}

export function getScaleType(id: ScaleTypeId): ScaleTypeDefinition {
  const intervals = SCALE_INTERVALS[id];
  if (!intervals) throw new RangeError(`getScaleType(): 未知音阶 "${id}"`);
  const family = SCALE_FAMILY[id];
  return { id, family, source: CORE_FAMILIES.has(family) ? 'core' : 'extended', intervals };
}

export function listScaleTypes(filter?: { family?: ScaleFamily; source?: 'core' | 'extended' }): readonly ScaleTypeDefinition[] {
  return (Object.keys(SCALE_INTERVALS) as ScaleTypeId[])
    .map(getScaleType)
    .filter((d) => (!filter?.family || d.family === filter.family) && (!filter?.source || d.source === filter.source));
}

/** 某根音 + 音阶类型 → pc 集合(升序,scale-step 序起于根音)。 */
export function getScalePitchClasses(rootPc: PitchClass, scaleType: ScaleTypeId): readonly PitchClass[] {
  return SCALE_INTERVALS[scaleType].map((iv) => mod12(rootPc + iv));
}
