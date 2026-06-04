// ============================================================
// newEngine · knowledge · VoicingLibrary / slimming(B-port)
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3.6:
//   guideToneShell — 让位瘦身保底(3+7);丢弃序 5→根→7,永不丢 3。
//   voiceComp      — 真 voicing:jazz rootless / spread,顶音 voice-leading(贴上一和弦顶音)。
// 取代 close 48+pc 簇。输出 midi[](全 chord tone → Auditor safe)。
// ============================================================

import { chordToneIntervals, type ChordQuality } from './chords';

export const SLIMMING_DROP_ORDER = ['fifth', 'root', 'seventh'] as const;

/** guide-tone shell:3 音 + 7 音相对根音的半音(三和弦无 7 → 只留 3 音)。 */
export function guideToneShell(quality: ChordQuality): number[] {
  const t = chordToneIntervals(quality);
  const third = t[1];
  const seventh = t.length >= 4 ? t[3] : undefined;
  return seventh !== undefined ? [third, seventh] : [third];
}

const COMP_TOP_LOW = 60; // 顶音区下限(C4)
const COMP_TOP_HIGH = 76; // 顶音区上限(E5)
const COMP_FLOOR = 52; // comp 最低音(避免与 bass 撞)

/** 离 target 最近、且 pitch class = pc 的 midi。 */
function nearestMidiOfPc(pc: number, target: number): number {
  const below = target - ((((target - pc) % 12) + 12) % 12);
  const above = below + 12;
  return target - below <= above - target ? below : above;
}

/**
 * 真 comp voicing:
 *  - jazz 且 ≥4 音 → rootless(去根)。
 *  - 顶音 = 离 prevTop 最近的 chord tone(顶音 voice-leading)。
 *  - 其余音从顶音向下 spread 叠放(非簇);全部落 [COMP_FLOOR, COMP_TOP_HIGH]。
 * 返回升序 midi[](皆 chord tone)。
 */
export function voiceComp(tonePcs: number[], style: string, prevTop?: number): number[] {
  const tones = style === 'jazz' && tonePcs.length >= 4 ? tonePcs.slice(1) : tonePcs.slice();
  if (tones.length === 0) return [];

  const target = prevTop ?? 67; // 默认顶音 ~G4
  let topPc = tones[0];
  let topMidi = nearestMidiOfPc(tones[0], target);
  let best = Math.abs(topMidi - target);
  for (const pc of tones) {
    const m = nearestMidiOfPc(pc, target);
    if (Math.abs(m - target) < best) {
      best = Math.abs(m - target);
      topPc = pc;
      topMidi = m;
    }
  }
  while (topMidi > COMP_TOP_HIGH) topMidi -= 12;
  while (topMidi < COMP_TOP_LOW) topMidi += 12;

  const voiced = [topMidi];
  let ceil = topMidi;
  for (const pc of tones) {
    if (pc === topPc) continue;
    let m = ceil - 1;
    m = m - ((((m - pc) % 12) + 12) % 12); // 对齐到 ≤ m 的 pc
    while (m >= ceil) m -= 12;
    while (m < COMP_FLOOR) m += 12; // 不低于地板
    voiced.push(m);
    ceil = Math.min(ceil, m);
  }
  return [...new Set(voiced)].sort((a, b) => a - b);
}
