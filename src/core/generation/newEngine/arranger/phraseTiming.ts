// ============================================================
// newEngine · arranger · phraseTiming(共享时间工具)
// ------------------------------------------------------------
// 由 ArrangementPlan 推导每个 phrase 的绝对起拍。Instrumental / Prepass 共用,避免重复。
// ============================================================

import type { Meter } from '../foundation';
import type { ArrangementPlan, PhraseId } from './ArrangementPlan';

export function beatsPerBarOf(meter: Meter): number {
  return meter.numerator * (4 / meter.denominator);
}

export function phraseStartBeats(arrangement: ArrangementPlan): Record<PhraseId, number> {
  const bpb = beatsPerBarOf(arrangement.meter);
  const starts: Record<PhraseId, number> = {};
  let beat = 0;
  for (const section of arrangement.sections) {
    const phrases = arrangement.phrases
      .filter((p) => p.sectionId === section.id)
      .slice()
      .sort((a, b) => a.phraseSlot - b.phraseSlot);
    for (const p of phrases) {
      starts[p.id] = beat;
      beat += p.bars * bpb;
    }
  }
  return starts;
}
