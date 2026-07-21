// ============================================================
// newEngine · arranger · TimePlanner
// ------------------------------------------------------------
// 架构定稿 Part 3.2 / 铁律3:tempo / meter / feel / phraseBreathing 归 Arranger,
// 按风格要素决定(查 KB 的 TimeFeelLibrary,Slice 1 内联最小表)。
// ============================================================

import type { Meter, Rng } from '../foundation';
import type { GrooveContract } from '../knowledge/grooveContracts';
import type { Feel, PhraseBreathing } from './ArrangementPlan';

interface TimeFeel {
  tempoBpm: number;     // 风格中心速度
  tempoRange: number;   // 随 seed 浮动 ±范围(bpm)
  meter: Meter;
  feel: Feel;
}

const STYLE_TIME: Record<string, TimeFeel> = {
  lofi: { tempoBpm: 78, tempoRange: 7, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  // 无 archetype 的 JAZZ 回退 4/4；产品链会先选 archetype，再由 contract 覆盖 meter/tempo/feel。
  jazz: { tempoBpm: 132, tempoRange: 56, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'swing', swingRatio: 0.66 } },
  pop: { tempoBpm: 118, tempoRange: 44, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  // ★ Loop B(2026-06-08):RNB 独立 TimeFeel(原落 default=100bpm)。laidback 不靠 global swing,
  //   而由 groove pattern(groovePlanner=laidback)+ texture pocket + velocity/timing micro-feel 表达。
  rnb: { tempoBpm: 96, tempoRange: 10, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  // ACG PIANOSONG 的短篇呼吸：保持慢速抒情；targetDuration 由 arranger 用实际 tempo 反推曲式小节数。
  acg: { tempoBpm: 80, tempoRange: 6, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  modal: { tempoBpm: 96, tempoRange: 12, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
  default: { tempoBpm: 100, tempoRange: 10, meter: { numerator: 4, denominator: 4 }, feel: { kind: 'straight', swingRatio: 0.5 } },
};

const POP_LYRICAL_TIME: TimeFeel = {
  tempoBpm: 82,
  tempoRange: 18,
  meter: { numerator: 4, denominator: 4 },
  feel: { kind: 'straight', swingRatio: 0.5 },
};

function isLyricalMood(mood?: string): boolean {
  if (!mood) return false;
  const s = mood.toLowerCase();
  if (/\b(drive|hype|hard|dance|edm|fast|upbeat|energetic)\b/.test(s)) return false;
  return /\b(ballad|lyric|calm|soft|sad|melanchol|emotional|emo|gentle|warm|tender|slow|smooth|chill|dream|romantic)\b/.test(s);
}

export interface TimePlan {
  tempoBpm: number;
  meter: Meter;
  feel: Feel;
  phraseBreathing: PhraseBreathing;
}

function feelForContract(contract: GrooveContract, fallback: Feel): Feel {
  const kind: Feel['kind'] = contract.grid === 'swing'
    ? 'swing'
    : contract.grid === 'shuffle'
      ? 'shuffle'
      : 'straight';
  return { kind, swingRatio: contract.compSwingRatio ?? fallback.swingRatio };
}

/** tempo/meter/feel。Jazz 产品链先选 archetype/contract，再由这里读取其明确时间身份。 */
export function planTime(style: string, rng?: Rng, mood?: string, grooveContract?: GrooveContract): TimePlan {
  const styleKey = style.toLowerCase();
  const base = styleKey === 'pop' && isLyricalMood(mood) ? POP_LYRICAL_TIME : (STYLE_TIME[styleKey] ?? STYLE_TIME.default);
  const t: TimeFeel = grooveContract
    ? {
      tempoBpm: grooveContract.tempoBpm ?? base.tempoBpm,
      tempoRange: grooveContract.tempoRange ?? base.tempoRange,
      meter: grooveContract.meter ?? base.meter,
      feel: feelForContract(grooveContract, base.feel),
    }
    : base;
  const jitter = rng ? Math.round((rng.next() * 2 - 1) * t.tempoRange) : 0;
  const tempoBpm = Math.max(40, Math.min(220, t.tempoBpm + jitter));
  return {
    tempoBpm,
    meter: { ...t.meter },
    feel: { ...t.feel },
    phraseBreathing: { phraseBars: 4, cadenceBreathBeats: 1 },
  };
}
