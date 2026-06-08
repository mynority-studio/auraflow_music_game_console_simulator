// ============================================================
// newEngine · arranger · TimePlanner
// ------------------------------------------------------------
// 架构定稿 Part 3.2 / 铁律3:tempo / meter / feel / phraseBreathing 归 Arranger,
// 按风格要素决定(查 KB 的 TimeFeelLibrary,Slice 1 内联最小表)。
// ============================================================

import type { Meter, Rng } from '../foundation';
import type { Feel, PhraseBreathing } from './ArrangementPlan';

interface TimeFeel {
  tempoBpm: number;     // 风格中心速度
  tempoRange: number;   // 随 seed 浮动 ±范围(bpm)
  meter: Meter;
  feel: Feel;
}

const STYLE_TIME: Record<string, TimeFeel> = {
  lofi: { tempoBpm: 78, tempoRange: 7, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  jazz: { tempoBpm: 132, tempoRange: 14, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'swing', swingRatio: 0.66 } },
  pop: { tempoBpm: 118, tempoRange: 12, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  // ★ Loop B(2026-06-08):RNB 独立 TimeFeel(原落 default=100bpm)。laidback 不靠 global swing,
  //   而由 groove pattern(groovePlanner=laidback)+ texture pocket + velocity/timing micro-feel 表达。
  rnb: { tempoBpm: 96, tempoRange: 10, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  modal: { tempoBpm: 96, tempoRange: 12, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  default: { tempoBpm: 100, tempoRange: 10, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
};

export interface TimePlan {
  tempoBpm: number;
  meter: Meter;
  feel: Feel;
  phraseBreathing: PhraseBreathing;
}

/** tempo/meter/feel。给 rng → tempo 在风格区间 [中心±range] 内随 seed 浮动(否则取中心)。 */
export function planTime(style: string, rng?: Rng): TimePlan {
  const t = STYLE_TIME[style] ?? STYLE_TIME.default;
  const jitter = rng ? Math.round((rng.next() * 2 - 1) * t.tempoRange) : 0;
  const tempoBpm = Math.max(40, Math.min(220, t.tempoBpm + jitter));
  return {
    tempoBpm,
    meter: { ...t.meter },
    feel: { ...t.feel },
    phraseBreathing: { phraseBars: 4, cadenceBreathBeats: 1 },
  };
}
