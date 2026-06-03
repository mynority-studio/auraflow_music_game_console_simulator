// ============================================================
// newEngine · knowledge · pitchPlacement(pc ↔ register 工具)
// ------------------------------------------------------------
// 把 pitch class 落到指定 Midi 音区;pc 间最短环绕距离。Prepass / Melody 共用。
// ============================================================

import { midi, type Midi } from '../foundation';

/** pc → 落在 [low,high] 的 Midi(对齐到 low 所在八度上方最近;越界则回落)。 */
export function pcToMidiInRange(pc: number, low: number, high: number): Midi {
  let m = low - (low % 12) + pc;
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return midi(m);
}

/** 两个 pc 的最短环绕半音距离(0..6)。 */
export function pcDistance(a: number, b: number): number {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}
