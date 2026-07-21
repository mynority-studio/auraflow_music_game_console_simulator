// ============================================================
// newEngine · render · ACG lead presence plan
// ------------------------------------------------------------
// ACG PIANOSONG 的“何时让最高声部开口”是总谱意图，不应先生成完整
// lead 再由末端 density gate 删除。这个纯计划把 Arranger/Instrumentation
// 的 in/out、opening delay 翻译成 scheduler 可消费的留白窗口。
// ============================================================

import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';

export type AcgLeadSilenceReason = 'inactive-section' | 'performance-dropout' | 'planned-entry-delay';

export interface AcgLeadSilenceWindow {
  startBeat: number;
  endBeat: number;
  reason: AcgLeadSilenceReason;
  sectionId: string;
}

/** Scheduler-only plan. It has no UI-facing style or random choice. */
export interface AcgLeadPresencePlan {
  silenceWindows: readonly AcgLeadSilenceWindow[];
  /** A long arranger-authored silence still gets a compact return response at its end. */
  returnRestCapBeats: number;
}

const DEFAULT_RETURN_REST_CAP_BEATS = 3;

function beatsPerBar(arrangement: ArrangementPlan): number {
  return arrangement.meter.numerator * (4 / arrangement.meter.denominator);
}

function mergeWindows(windows: readonly AcgLeadSilenceWindow[]): AcgLeadSilenceWindow[] {
  const sorted = windows
    .filter((window) => Number.isFinite(window.startBeat)
      && Number.isFinite(window.endBeat)
      && window.endBeat > window.startBeat + 1e-4)
    .map((window) => ({ ...window }))
    .sort((a, b) => a.startBeat - b.startBeat || a.endBeat - b.endBeat);
  const out: AcgLeadSilenceWindow[] = [];
  for (const window of sorted) {
    const previous = out[out.length - 1];
    if (previous && window.startBeat <= previous.endBeat + 1e-4) {
      previous.endBeat = Math.max(previous.endBeat, window.endBeat);
      continue;
    }
    out.push(window);
  }
  return out;
}

/**
 * Derive the ACG top-line entry/rest schedule directly from the same score
 * ownership that formerly fed `gateByDensity`. The renderer consumes this
 * before NoteIR exists; the later gate merely leaves the already-planned ACG
 * lead untouched.
 */
export function planAcgLeadPresence(
  arrangement: ArrangementPlan,
  instrumentation: Pick<InstrumentationPlan, 'activeRolesBySection'>,
): AcgLeadPresencePlan {
  const bpb = beatsPerBar(arrangement);
  const windows: AcgLeadSilenceWindow[] = [];
  let sectionStart = 0;

  arrangement.sections.forEach((section, index) => {
    const sectionEnd = sectionStart + section.bars * bpb;
    const active = instrumentation.activeRolesBySection[section.id] ?? [];
    const performance = arrangement.rolePerformanceBySection.lead?.[section.id];
    const isActive = active.includes('lead');
    const entryMode = performance?.entryMode;

    if (!isActive) {
      windows.push({ startBeat: sectionStart, endBeat: sectionEnd, reason: 'inactive-section', sectionId: section.id });
    } else if (entryMode === 'none' || entryMode === 'dropout') {
      windows.push({ startBeat: sectionStart, endBeat: sectionEnd, reason: 'performance-dropout', sectionId: section.id });
    } else {
      const openingDelay = index === 0 && arrangement.openingGesture.sectionId === section.id
        ? arrangement.openingGesture.roleDelayBars.lead
        : undefined;
      const delayedBars = openingDelay ?? (entryMode === 'delayed' ? 1 : 0);
      const delayEnd = Math.min(sectionEnd, sectionStart + Math.max(0, delayedBars) * bpb);
      if (delayEnd > sectionStart + 1e-4) {
        windows.push({ startBeat: sectionStart, endBeat: delayEnd, reason: 'planned-entry-delay', sectionId: section.id });
      }
    }
    sectionStart = sectionEnd;
  });

  return {
    silenceWindows: mergeWindows(windows),
    returnRestCapBeats: DEFAULT_RETURN_REST_CAP_BEATS,
  };
}

export function overlapsAcgLeadSilence(
  startBeat: number,
  endBeat: number,
  plan: AcgLeadPresencePlan | undefined,
): boolean {
  if (!plan || endBeat <= startBeat) return false;
  return plan.silenceWindows.some((window) => startBeat < window.endBeat - 1e-4 && endBeat > window.startBeat + 1e-4);
}

/** True when the first audible token after a long planned rest should get a compact return brick. */
export function isAcgLeadScheduledRelease(
  restStartBeat: number | null,
  entryBeat: number,
  plan: AcgLeadPresencePlan | undefined,
): boolean {
  if (!plan || restStartBeat === null) return false;
  return plan.silenceWindows.some((window) => restStartBeat < window.endBeat - 1e-4
    && entryBeat >= window.endBeat - 1e-4);
}
