// ============================================================
// newEngine · knowledge · KeyProfiles(K-K 调性张力 + 调内音级美学,B-port 乐理事实)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/musicTheory.ts(Krumhansl-Kessler 1982
//   probe-tone profiles + 调内音级 function/解决倾向)。纯乐理事实,无 orchestration。
// 用途:Auditor "调内框架"判据 —— 某音相对【局部调中心】的张力大小 + 是否导音 + 期望解决点。
//   与 tendencyTable(和弦框架)互补:和弦判 CT/T/A,调性判 leading/tension 与 key 引力。
// ============================================================

import { mod12, type PitchClass } from '../foundation';

// Krumhansl-Kessler 1982 探测音稳定度剖面(C..B);值越大越稳定。
const KK_STABILITY_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_STABILITY_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// 稳定度 → 张力:tension = 1 - (s - min) / (max - min)。最稳=0,最不稳=1。
function toTension(stability: readonly number[]): number[] {
  const min = Math.min(...stability);
  const max = Math.max(...stability);
  return stability.map((s) => (max === min ? 0 : 1 - (s - min) / (max - min)));
}

export const KK_TENSION_MAJOR: readonly number[] = toTension(KK_STABILITY_MAJOR);
export const KK_TENSION_MINOR: readonly number[] = toTension(KK_STABILITY_MINOR);

export type KeyMode = 'major' | 'minor';

/** 某 pc 相对调中心的 K-K 张力 [0,1]。pcFromKey = (notePc - keyRootPc) mod 12。 */
export function kkTension(pcFromKey: number, mode: KeyMode): number {
  const table = mode === 'minor' ? KK_TENSION_MINOR : KK_TENSION_MAJOR;
  return table[mod12(pcFromKey)];
}

// 调内音级美学:function + 期望解决点(semitone offsets,相对 KEY root)。
//   tensionAmount = kkTension(pc)(不重复存)。port 自 INTERVAL_AESTHETICS_*。
export type DegreeFunction = 'Home' | 'Anchor' | 'Color' | 'Active' | 'Leading' | 'Tension';

export interface IntervalAesthetic {
  function: DegreeFunction;
  expectedResolutions: readonly number[]; // pc offsets relative to KEY root
}

const INTERVAL_AESTHETICS_MAJOR: readonly IntervalAesthetic[] = [
  { function: 'Home', expectedResolutions: [] },        // 1
  { function: 'Tension', expectedResolutions: [0] },     // b2
  { function: 'Active', expectedResolutions: [0, 4] },   // 2
  { function: 'Color', expectedResolutions: [2, 0] },    // b3
  { function: 'Home', expectedResolutions: [] },         // 3
  { function: 'Active', expectedResolutions: [4, 0] },   // 4
  { function: 'Tension', expectedResolutions: [7, 5] },  // #4/b5
  { function: 'Anchor', expectedResolutions: [0] },      // 5
  { function: 'Active', expectedResolutions: [7] },      // b6
  { function: 'Active', expectedResolutions: [7, 4] },   // 6
  { function: 'Active', expectedResolutions: [9, 4, 0] },// b7
  { function: 'Leading', expectedResolutions: [0] },     // 7
];

const INTERVAL_AESTHETICS_MINOR: readonly IntervalAesthetic[] = [
  { function: 'Home', expectedResolutions: [] },        // 1
  { function: 'Tension', expectedResolutions: [0] },     // b2
  { function: 'Active', expectedResolutions: [0, 3] },   // 2
  { function: 'Home', expectedResolutions: [] },         // b3
  { function: 'Tension', expectedResolutions: [3] },     // 3
  { function: 'Active', expectedResolutions: [3, 0] },   // 4
  { function: 'Tension', expectedResolutions: [7] },     // #4/b5
  { function: 'Anchor', expectedResolutions: [0] },      // 5
  { function: 'Color', expectedResolutions: [7] },       // b6
  { function: 'Active', expectedResolutions: [7] },      // 6
  { function: 'Color', expectedResolutions: [0] },       // b7
  { function: 'Leading', expectedResolutions: [0] },     // 7
];

/** 调内音级美学:相对调中心的 function + 期望解决点。 */
export function intervalAesthetic(pcFromKey: number, mode: KeyMode): IntervalAesthetic {
  const table = mode === 'minor' ? INTERVAL_AESTHETICS_MINOR : INTERVAL_AESTHETICS_MAJOR;
  return table[mod12(pcFromKey)];
}

/** 期望解决点(绝对 pc):keyRoot + offset。 */
export function expectedResolutionPcs(notePc: PitchClass, keyRootPc: PitchClass, mode: KeyMode): PitchClass[] {
  const { expectedResolutions } = intervalAesthetic(mod12(notePc - keyRootPc), mode);
  return expectedResolutions.map((off) => mod12(keyRootPc + off));
}
