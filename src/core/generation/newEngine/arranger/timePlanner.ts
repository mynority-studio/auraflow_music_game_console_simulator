// ============================================================
// newEngine · arranger · TimePlanner
// ------------------------------------------------------------
// 架构定稿 Part 3.2 / 铁律3:tempo / meter / feel / phraseBreathing 归 Arranger,
// 按风格要素决定(查 KB 的 TimeFeelLibrary,Slice 1 内联最小表)。
// ============================================================

import type { Meter } from '../foundation';
import type { Feel, PhraseBreathing } from './ArrangementPlan';

interface TimeFeel {
  tempoBpm: number;
  meter: Meter;
  feel: Feel;
}

const STYLE_TIME: Record<string, TimeFeel> = {
  lofi: { tempoBpm: 78, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  jazz: { tempoBpm: 132, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'swing', swingRatio: 0.66 } },
  pop: { tempoBpm: 120, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  default: { tempoBpm: 100, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
};

export interface TimePlan {
  tempoBpm: number;
  meter: Meter;
  feel: Feel;
  phraseBreathing: PhraseBreathing;
}

export function planTime(style: string): TimePlan {
  const t = STYLE_TIME[style] ?? STYLE_TIME.default;
  return {
    tempoBpm: t.tempoBpm,
    meter: { ...t.meter },
    feel: { ...t.feel },
    phraseBreathing: { phraseBars: 4, cadenceBreathBeats: 1 },
  };
}
