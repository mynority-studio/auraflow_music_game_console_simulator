// ============================================================
// motifSandbox · model · 音阶工具(diatonic)
// ------------------------------------------------------------
// 大调 Ionian / 小调 Aeolian。pitch↔scaleDegree↔midi 互转、snap、diatonic 移位。
// 第一期非 jazz 一律 diatonic(chromaticRatio=0)。
// ============================================================

import type { ScaleMode } from './types';

export const SCALE_INTERVALS: Record<ScaleMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], // Ionian
  minor: [0, 2, 3, 5, 7, 8, 10], // Aeolian
};

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** 把任意 midi 吸附到当前 scale 最近的音(平手向下)。 */
export function snapMidiToScale(midiNote: number, keyPc: number, mode: ScaleMode): number {
  const intervals = SCALE_INTERVALS[mode];
  const rel = mod(midiNote - keyPc, 12);
  let best = intervals[0], bestDist = 99;
  for (const iv of intervals) {
    const d = Math.min(mod(rel - iv, 12), mod(iv - rel, 12));
    if (d < bestDist) { bestDist = d; best = iv; }
  }
  return midiNote - (rel - best); // 保持八度,只挪到最近 scale 度
}

/** midi → scaleDegree(1..7);非调内音吸到最近度。 */
export function midiToScaleDegree(midiNote: number, keyPc: number, mode: ScaleMode): number {
  const snapped = snapMidiToScale(midiNote, keyPc, mode);
  const rel = mod(snapped - keyPc, 12);
  const idx = SCALE_INTERVALS[mode].indexOf(rel);
  return (idx < 0 ? 0 : idx) + 1;
}

/** midi → 八度(以 keyPc 的 C-style 八度;只用于相对比较)。 */
export function midiToOctave(midiNote: number): number {
  return Math.floor(midiNote / 12) - 1;
}

/** (scaleDegree 1..7, octave) → midi。 */
export function degreeOctaveToMidi(degree: number, octave: number, keyPc: number, mode: ScaleMode): number {
  const idx = mod(degree - 1, 7);
  const interval = SCALE_INTERVALS[mode][idx];
  return (octave + 1) * 12 + keyPc + interval;
}

/**
 * diatonic 移位:把 midi 在 scale 内上下挪 steps 个【度】(保持调内)。
 *   先吸到 scale,定位其 degree+octave,再加 steps 度。
 */
export function transposeDiatonic(midiNote: number, steps: number, keyPc: number, mode: ScaleMode): number {
  const snapped = snapMidiToScale(midiNote, keyPc, mode);
  const rel = mod(snapped - keyPc, 12);
  const degIdx = SCALE_INTERVALS[mode].indexOf(rel);
  const baseOct = Math.floor((snapped - keyPc - rel) / 12);
  const total = degIdx + steps;
  const newIdx = mod(total, 7);
  const octShift = Math.floor(total / 7);
  return keyPc + (baseOct + octShift) * 12 + SCALE_INTERVALS[mode][newIdx];
}

/** 是否调内音(用于 chromaticRatio 审计)。 */
export function isInScale(midiNote: number, keyPc: number, mode: ScaleMode): boolean {
  return SCALE_INTERVALS[mode].includes(mod(midiNote - keyPc, 12));
}
