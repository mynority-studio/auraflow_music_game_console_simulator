// ============================================================
// newEngine · knowledge · VoicingPlacement(八度落点搜索,B-port 纯规则)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/musicTheory.ts:
//   placeVoicingMidi(多目标暴力搜索)+ preferredRegisterFor + PIANO_LIL_THRESHOLDS。
// 输入 = assembleVoicing 的 pc[];输出 = 升序 MIDI[]。不写事件。
// 代价项:bass-底音 gap≈11 · 音区提示 · 声部进行(贴 prev)· 顶音连续 · 平行 5/8 ·
//   span≤24 · PIANO LIL(低区 m2/M2 浑浊)· bass 上方 m9 cluster。
// 钢琴 LIL(非 Piston 管弦):低区只罚 m2/M2,m3/M3/P4 是 stride/boogie 风格签名不罚。
// ============================================================

import { mod12 } from '../foundation';
import { getChordVoicingAesthetics, type RegisterHint } from './chordIntervalRoles';
import { minimumVoiceLeadingDistance } from '../instrumental/foundationVoiceLeading';

export const CHORD_RANGE = { LOW: 48, HIGH: 81 } as const;

const VOICING_BOTTOM_GAP_TARGET = 11;   // 理想 bass→底音(半音)
const VOICING_BOTTOM_GAP_MIN = 4;       // 硬下限:voicing 必须在 bass 上方
const VOICING_BOTTOM_GAP_MAX_SOFT = 17; // 超此 = "tenor gap" 罚
const VOICING_SPAN_MAX = 24;            // 顶底最大半音

interface PianoLILRule { semitones: number; minLowerMidi: number; penalty: number; reason: string; }
export const PIANO_LIL_THRESHOLDS: readonly PianoLILRule[] = [
  { semitones: 1, minLowerMidi: 64, penalty: 40, reason: 'm2 below E4: critical-band beating' },
  { semitones: 2, minLowerMidi: 55, penalty: 10, reason: 'M2 below G3: muddy in low/mid register' },
] as const;
const PIANO_LIL_HIGH_REGISTER_M2_PENALTY = 4; // m2 above E4 — 上层结构轻微摩擦

const REGISTER_PENALTY = {
  low: { abovePivot: 64, weight: 0.5 },
  high: { belowPivot: 62, weight: 0.5 },
} as const;

/** 某 pc 在和弦语境下的偏好音区(guide tone 偏低、color 偏高)。 */
export function preferredRegisterFor(pc: number, chordType: string, chordRootPc: number): RegisterHint {
  const table = getChordVoicingAesthetics(chordType);
  return table[mod12(pc - chordRootPc)]?.register ?? 'flex';
}

/**
 * 给定 pc[] + 前一组 voicing(声部进行)+ bass MIDI,暴力搜索最优八度落点。
 * 返回升序 MIDI[]。无可行解 → bass 上方朴素落点兜底。
 */
export function placeVoicingMidi(
  pcs: number[],
  prevVoicingMidi: number[],
  bassMidi: number,
  chordType: string,
  chordRootPc: number,
): number[] {
  if (pcs.length === 0) return [];

  const candidates: number[][] = pcs.map((pc) => {
    const pcMod: number = mod12(pc);
    const out: number[] = [];
    for (let m = pcMod; m <= 100; m += 12) {
      if (m < CHORD_RANGE.LOW || m > CHORD_RANGE.HIGH) continue;
      out.push(m);
    }
    if (out.length === 0) out.push(pcMod + 60);
    return out;
  });

  let best: { midi: number[]; cost: number } | null = null;
  const N = pcs.length;
  const current: number[] = new Array(N);

  function recurse(idx: number): void {
    if (idx === N) {
      const sorted = current.slice().sort((a, b) => a - b);
      const bottom = sorted[0];
      const top = sorted[sorted.length - 1];
      const gap = bottom - bassMidi;
      if (gap < VOICING_BOTTOM_GAP_MIN) return; // 硬约束:必须在 bass 上方

      let cost = 0;

      // 1. bass→底音 gap(甜点 11)
      cost += Math.abs(gap - VOICING_BOTTOM_GAP_TARGET) * 2;
      if (gap > VOICING_BOTTOM_GAP_MAX_SOFT) cost += (gap - VOICING_BOTTOM_GAP_MAX_SOFT) * 3;

      // 2. 偏好音区提示
      for (let i = 0; i < N; i++) {
        const reg = preferredRegisterFor(pcs[i], chordType, chordRootPc);
        const m = current[i];
        if (reg === 'low' && m > REGISTER_PENALTY.low.abovePivot) cost += (m - REGISTER_PENALTY.low.abovePivot) * REGISTER_PENALTY.low.weight;
        if (reg === 'high' && m < REGISTER_PENALTY.high.belowPivot) cost += (REGISTER_PENALTY.high.belowPivot - m) * REGISTER_PENALTY.high.weight;
      }

      // 3. 声部进行(贴 prev 最近,系数 1.2)+ 3a 顶音连续(超 P4 重罚)
      if (prevVoicingMidi.length > 0) {
        cost += minimumVoiceLeadingDistance(prevVoicingMidi, sorted) * 1.2;
        const currTop = sorted[sorted.length - 1];
        const prevTop = Math.max(...prevVoicingMidi);
        const topJump = Math.abs(currTop - prevTop);
        if (topJump > 5) cost += (topJump - 5) * 20;
      }

      // 3b. 平行 5/8(同向)软罚
      if (prevVoicingMidi.length >= 2 && sorted.length >= 2) {
        const prevSorted = [...prevVoicingMidi].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length - 1 && i < prevSorted.length - 1; i++) {
          const prevInterval = prevSorted[i + 1] - prevSorted[i];
          const currInterval = sorted[i + 1] - sorted[i];
          if (prevInterval !== currInterval) continue;
          if (prevInterval !== 7 && prevInterval !== 12) continue;
          const dirLower = Math.sign(sorted[i] - prevSorted[i]);
          const dirUpper = Math.sign(sorted[i + 1] - prevSorted[i + 1]);
          if (dirLower === 0 || dirUpper === 0) continue;
          if (dirLower !== dirUpper) continue;
          cost += prevInterval === 7 ? 25 : 30;
        }
      }

      // 4. span 罚
      const span = top - bottom;
      if (span > VOICING_SPAN_MAX) cost += (span - VOICING_SPAN_MAX) * 2;

      // 5. PIANO LIL(低区 cluster);重复 MIDI 禁止
      for (let i = 1; i < sorted.length; i++) {
        const dist = sorted[i] - sorted[i - 1];
        const lower = sorted[i - 1];
        if (dist < 1) { cost += 100; continue; }
        const rule = PIANO_LIL_THRESHOLDS.find((r) => r.semitones === dist);
        if (rule) cost += lower < rule.minLowerMidi ? rule.penalty : (dist === 1 ? PIANO_LIL_HIGH_REGISTER_M2_PENALTY : 0);
      }

      // 6. bass + 13/25 半音的 m9 cluster
      const b9Pc = mod12(mod12(bassMidi) + 1);
      for (const m of sorted) {
        if (mod12(m) !== b9Pc) continue;
        const intervalToBass = m - bassMidi;
        if (intervalToBass === 13) cost += 80;
        else if (intervalToBass === 25) cost += 20;
      }

      if (!best || cost < best.cost) best = { midi: sorted, cost };
      return;
    }
    for (const m of candidates[idx]) { current[idx] = m; recurse(idx + 1); }
  }
  recurse(0);

  if (!best) {
    return pcs.map((pc) => {
      const pcMod: number = mod12(pc);
      let m = pcMod;
      while (m < Math.max(CHORD_RANGE.LOW, bassMidi + VOICING_BOTTOM_GAP_MIN)) m += 12;
      return m;
    }).sort((a, b) => a - b);
  }
  return best.midi;
}
