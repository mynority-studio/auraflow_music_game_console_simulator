// ============================================================
// newEngine · knowledge · GuideTonePolicy(B-port)
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3.4 / 铁律14-15:连接/终止句的导音线。
// 导音 = 和弦 3 音 / 7 音(贴和弦、解决张力);voice-leading 取离上一音最近的;
// authentic 终止强制落 3 音(解决感)。全是 chord tone → Auditor safe。
// ============================================================

import { mod12 } from '../foundation';
import { chordToneIntervals, type ChordQuality } from './chords';
import { pcToMidiInRange } from './pitchPlacement';

export function guideTonePcs(rootPc: number, quality: ChordQuality): { third: number; seventh?: number } {
  const t = chordToneIntervals(quality);
  return { third: mod12(rootPc + t[1]), seventh: t.length >= 4 ? mod12(rootPc + t[3]) : undefined };
}

/** pc 在 [low,high] 内、离 target 最近的 midi(八度调整)。 */
function nearestMidi(pc: number, target: number, low: number, high: number): number {
  let m = pcToMidiInRange(pc, low, high) as number;
  while (m + 12 <= high && Math.abs(m + 12 - target) < Math.abs(m - target)) m += 12;
  while (m - 12 >= low && Math.abs(m - 12 - target) < Math.abs(m - target)) m -= 12;
  return m;
}

/** 单和弦导音:3/7 取离 prev 最近(voice-leading);forceThird 强制 3 音(终止解决)。返回 midi。 */
export function guideToneMidi(
  rootPc: number,
  quality: ChordQuality,
  prev: number,
  low: number,
  high: number,
  forceThird: boolean,
): number {
  const { third, seventh } = guideTonePcs(rootPc, quality);
  const cands = forceThird || seventh === undefined ? [third] : [third, seventh];
  let best = nearestMidi(cands[0], prev, low, high);
  let bestD = Math.abs(best - prev);
  for (const pc of cands) {
    const m = nearestMidi(pc, prev, low, high);
    if (Math.abs(m - prev) < bestD) {
      bestD = Math.abs(m - prev);
      best = m;
    }
  }
  return best;
}
