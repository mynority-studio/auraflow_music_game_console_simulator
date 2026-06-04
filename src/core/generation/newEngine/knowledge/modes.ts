// ============================================================
// newEngine · knowledge · Modes(教会调式 + modal vamp,B-port 乐理事实)
// ------------------------------------------------------------
// modal regime 用:primaryScale(全局主约束)+ 静态 vamp(和声宽松,1-2 和弦循环)。
//   - modalScale:某调式从根音起的 pc(scale-step 序,根音在前)。
//   - modalVamp:[modal 主和弦, 特征和弦] —— 特征和弦点出该调式与大/小调的区别。
//   - nearestInScale:把任意 pc 收进 primaryScale(旋律"逐和弦约束松"=只约束在主音阶内)。
// 纯函数 · 确定性 · 无 rng。
// ============================================================

import { mod12, type PitchClass } from '../foundation';
import type { ChordQuality } from './chords';

export type ChurchMode = 'ionian' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'aeolian' | 'locrian';

const MODE_INTERVALS: Record<ChurchMode, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

/** 调式音阶(scale-step 序,根音在前)。 */
export function modalScale(rootPc: PitchClass, mode: ChurchMode): PitchClass[] {
  return MODE_INTERVALS[mode].map((iv) => mod12(rootPc + iv));
}

// 调式主和弦品质(由三音/七音决定)
const TONIC_QUALITY: Record<ChurchMode, ChordQuality> = {
  ionian: 'maj7', dorian: 'm7', phrygian: 'm7', lydian: 'maj7',
  mixolydian: '7', aeolian: 'm7', locrian: 'm7b5',
};

// 特征和弦:落在哪个 scale degree(idx)+ 品质 + roman(label/degree/accidental)
interface CharSpec { idx: number; quality: ChordQuality; label: string; degree: 1 | 2 | 3 | 4 | 5 | 6 | 7; accidental: 'b' | 'natural'; }
const CHARACTERISTIC: Record<ChurchMode, CharSpec> = {
  dorian: { idx: 3, quality: 'maj', label: 'IV', degree: 4, accidental: 'natural' }, // 自然 6 → 大 IV
  mixolydian: { idx: 6, quality: 'maj', label: 'bVII', degree: 7, accidental: 'b' }, // 降 7 → bVII
  aeolian: { idx: 5, quality: 'maj', label: 'bVI', degree: 6, accidental: 'b' }, // bVI
  phrygian: { idx: 1, quality: 'maj', label: 'bII', degree: 2, accidental: 'b' }, // bII 特征
  lydian: { idx: 1, quality: 'maj', label: 'II', degree: 2, accidental: 'natural' }, // #4 → 大 II
  ionian: { idx: 4, quality: '7', label: 'V', degree: 5, accidental: 'natural' },
  locrian: { idx: 4, quality: 'maj', label: 'bV', degree: 5, accidental: 'b' },
};

export interface VampChord {
  rootPc: PitchClass;
  quality: ChordQuality;
  label: string;
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  accidental: 'b' | 'natural';
}

/** modal vamp:[主和弦 i, 特征和弦]。静态循环 → 和声不走功能。 */
export function modalVamp(rootPc: PitchClass, mode: ChurchMode): VampChord[] {
  const scale = modalScale(rootPc, mode);
  const tonic: VampChord = { rootPc, quality: TONIC_QUALITY[mode], label: 'i', degree: 1, accidental: 'natural' };
  const c = CHARACTERISTIC[mode];
  const characteristic: VampChord = { rootPc: scale[c.idx], quality: c.quality, label: c.label, degree: c.degree, accidental: c.accidental };
  return [tonic, characteristic];
}

/** 把 pc 收进 scale:就近(环形距离最小)取 scale 内音。scale 空则原样。 */
export function nearestInScale(pc: PitchClass, scale: readonly PitchClass[]): PitchClass {
  if (scale.length === 0) return pc;
  if (scale.includes(pc)) return pc;
  const dist = (a: number, b: number) => {
    const d = Math.abs(a - b) % 12;
    return Math.min(d, 12 - d);
  };
  return [...scale].sort((a, b) => dist(a, pc) - dist(b, pc))[0];
}
