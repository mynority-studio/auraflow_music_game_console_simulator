// ============================================================
// newEngine · render · ReadOnlyHarmonyAuditor(只读终检)
// ------------------------------------------------------------
// 架构定稿 Part 2.10 / 铁律19:只读、严格、只判和声/音程,不审密度、无豁免。
// Slice 0 规则:avoid note 长时值暴露(>=1 拍)→ error。
// 用共用的 plan.avoidNoteMap(= tensionModel 三分类)做判据(铁律21)。
// ============================================================

import { beats, mod12, type DeepReadonly, type Timebase } from '../foundation';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditFinding, AuditReport } from '../ir/AuditReport';

function findSpanAtTick(
  plan: HarmonicPlan,
  timebase: Timebase,
  tick: number,
): DeepReadonly<ChordSpan> | undefined {
  for (const span of plan.chordTimeline) {
    const start = timebase.beatToTick(span.startBeat);
    const end = start + timebase.beatToTick(span.durationBeats);
    if (tick >= start && tick < end) return span;
  }
  return undefined;
}

export function auditHarmony(ir: MusicalIR, plan: HarmonicPlan, timebase: Timebase): AuditReport {
  const findings: AuditFinding[] = [];
  const oneBeatTicks = timebase.beatToTick(beats(1));

  for (const track of ir.tracks) {
    for (const note of track.notes) {
      const span = findSpanAtTick(plan, timebase, note.startTick);
      if (!span) continue;
      const notePc = mod12(note.pitch);
      const avoid = plan.avoidNoteMap[span.id] ?? [];
      if (avoid.includes(notePc) && note.durationTicks >= oneBeatTicks) {
        findings.push({
          severity: 'error',
          location: { trackRole: track.role, startTick: note.startTick },
          ruleId: 'avoid-long-exposure',
          reason: `pc ${notePc} 是 ${span.id} 的 avoid note,长时值暴露(>=1 拍)`,
          suggestedReturnPoint: 'rewind-melody',
        });
      }
    }
  }

  return { findings };
}
