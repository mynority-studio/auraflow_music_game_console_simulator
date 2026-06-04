// ============================================================
// newEngine · render · RenderCoordinator(Slice 0)
// ------------------------------------------------------------
// 架构定稿 Part 8 / 铁律4-5:accompaniment-first 编排。
// Slice 0 只走"伴奏 → IR → 只读 Auditor"前半;Motif/Anchor Prepass、Occupation、
// Melody、Resolver 后续 slice 接入。lead 轨先留空占位。
// ============================================================

import { ticks, type RandomContext, type Timebase } from '../foundation';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import { freezeMusicalIR, type MusicalIR, type MusicalIRData, type TrackIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';
import { renderAccompaniment } from './accompanimentRenderer';
import { auditHarmony } from './readOnlyHarmonyAuditor';
import { runPrepass } from './motifAnchorPrepass';
import { renderMelody } from './melodyRenderer';
import { buildOccupationMap } from './OccupationMap';
import { resolveInteractions } from './interactionResolver';
import { renderDrums } from './drumRenderer';
import type { CandidateSwap } from './MotifStore';

export interface RenderResult {
  ir: MusicalIR;
  audit: AuditReport;
}

function totalDurationTicks(plan: HarmonicPlan, timebase: Timebase): number {
  let maxEnd = 0;
  for (const span of plan.chordTimeline) {
    const end = timebase.beatToTick(span.startBeat) + timebase.beatToTick(span.durationBeats);
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

export function renderSong(plan: HarmonicPlan, timebase: Timebase): RenderResult {
  const accompaniment = renderAccompaniment(plan, timebase);
  // Slice 0:trivial 旋律占位,后续 slice 接 Prepass/MotifStore + MelodyRenderer
  const lead: TrackIR = { role: 'lead', notes: [] };
  const tracks = [...accompaniment, lead];

  const ir = freezeMusicalIR({
    tracks,
    timebase,
    durationTicks: ticks(totalDurationTicks(plan, timebase)),
  });

  const audit = auditHarmony(ir, plan, timebase);
  return { ir, audit };
}

/**
 * 完整 accompaniment-first 渲染:Prepass → 伴奏 → 旋律 → IR → 只读 Auditor。
 * (顶层 Request→FinalIR + retry 由 GenerationController 编排,后续接入。)
 */
export function renderSongFull(
  band: BandSpec,
  arrangement: ArrangementPlan,
  plan: HarmonicPlan,
  instrumentation: InstrumentationPlan,
  timebase: Timebase,
  rng: RandomContext,
  candidateSwap?: CandidateSwap,
): RenderResult {
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, plan, rng);

  // 让位上下文:active 织体段 + 主 hook 锚点拍(melody-aware accompaniment-first)
  const activeSectionIds = new Set<string>();
  for (const [sid, tex] of Object.entries(instrumentation.textureBySection)) {
    if (instrumentation.textureYieldPolicy[tex] === 'active') activeSectionIds.add(sid);
  }
  const anchorBeats = new Set<number>();
  for (const slot of instrumentation.melodyReservationPlan.hookAnchorSlots) {
    if (slot.anchorRequired) anchorBeats.add(slot.beatSlot);
  }

  const accompaniment = renderAccompaniment(plan, timebase, { style: band.style, anchorBeats, activeSectionIds });
  const drums = renderDrums(plan, timebase, beatsPerBarOf(arrangement.meter));
  const lead = renderMelody(anchorPlan, motifStore, plan, arrangement, band, timebase, candidateSwap);
  const tracks: TrackIR[] = [...accompaniment, drums, lead];

  // Accompaniment → OccupationMap → Resolver(best-effort)→ 单点 freeze → Auditor
  const reserved = {
    lowMidi: instrumentation.melodyReservationPlan.reservedRegister.lowMidi,
    highMidi: instrumentation.melodyReservationPlan.reservedRegister.highMidi,
  };
  const occupation = buildOccupationMap(tracks, reserved);
  const draft: MusicalIRData = {
    tracks,
    timebase,
    durationTicks: ticks(totalDurationTicks(plan, timebase)),
  };
  const resolved = resolveInteractions(draft, occupation);

  const ir = freezeMusicalIR(resolved.data);
  const audit = auditHarmony(ir, plan, timebase);
  return { ir, audit };
}
