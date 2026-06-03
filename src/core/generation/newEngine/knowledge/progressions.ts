// ============================================================
// newEngine · knowledge · ProgressionLibrary(混:进行=事实 / 带权选取=new)
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3.3:per-section-role 级数模板 + diatonic 品质推导。
// Engine 按 seed(rng 子流)从候选里选,绑定到当前 song(铁律22-23)。
// Slice 1 tonal:大调/自然小调自然 7 和弦。
// ============================================================

import type { Rng } from '../foundation';
import type { ChordQuality } from './chords';
import type { DiatonicMode } from './scales';

const MAJOR_DIATONIC_QUALITY: Record<number, ChordQuality> = {
  1: 'maj7', 2: 'm7', 3: 'm7', 4: 'maj7', 5: '7', 6: 'm7', 7: 'm7b5',
};
const MINOR_DIATONIC_QUALITY: Record<number, ChordQuality> = {
  1: 'm7', 2: 'm7b5', 3: 'maj7', 4: 'm7', 5: 'm7', 6: 'maj7', 7: '7',
};

/** 度数 → 自然 7 和弦品质(按调式)。 */
export function diatonicQuality(degree: number, mode: DiatonicMode): ChordQuality {
  const map = mode === 'minor' ? MINOR_DIATONIC_QUALITY : MAJOR_DIATONIC_QUALITY;
  const q = map[degree];
  if (!q) throw new RangeError(`diatonicQuality(): degree 须 1..7,得到 ${degree}`);
  return q;
}

export type SectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';

// per-role 级数候选(degree 序列)
const ROLE_PROGRESSIONS: Record<SectionRole, readonly (readonly number[])[]> = {
  intro: [[1, 4]],
  verse: [[1, 6, 4, 5], [2, 5, 1, 6]],
  chorus: [[1, 5, 6, 4], [4, 5, 1, 1]],
  bridge: [[6, 4, 1, 5]],
  outro: [[4, 5, 1, 1]],
};

/** 按 rng 从该 role 的候选里选一条级数序列(确定性)。 */
export function pickProgressionDegrees(role: SectionRole, rng: Rng): number[] {
  const options = ROLE_PROGRESSIONS[role];
  if (!options) throw new RangeError(`pickProgressionDegrees(): 未知 role "${role}"`);
  return rng.pick(options).slice();
}
