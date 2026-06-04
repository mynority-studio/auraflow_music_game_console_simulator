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
import { renderBass } from './bassRenderer';
import { auditHarmony } from './readOnlyHarmonyAuditor';
import { runPrepass } from './motifAnchorPrepass';
import { renderMelody } from './melodyRenderer';
import { buildOccupationMap } from './OccupationMap';
import { resolveInteractions } from './interactionResolver';
import { renderDrums } from './drumRenderer';
import { renderPad } from './padRenderer';
import { applySwing } from './swing';
import { applyDynamics, type EnergyRange } from './dynamics';
import { humanizeVelocity, humanizeTiming } from './humanize';
import type { CandidateSwap } from './MotifStore';
import type { RenderOverlay } from './RenderOverlay';

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
  const bass = renderBass(plan, timebase, 'default');
  const accompaniment = renderAccompaniment(plan, timebase);
  // Slice 0:trivial 旋律占位,后续 slice 接 Prepass/MotifStore + MelodyRenderer
  const lead: TrackIR = { role: 'lead', notes: [] };
  const tracks = [bass, ...accompaniment, lead];

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
  overlay?: RenderOverlay,
): RenderResult {
  const { anchorPlan, motifStore } = runPrepass(band, arrangement, plan, rng);
  const candidateSwap = overlay?.candidateSwap;
  const voicingSaferSpans = overlay?.voicingSafer ? new Set(Object.keys(overlay.voicingSafer)) : undefined;

  // 让位上下文:active 织体段 + 主 hook 锚点拍(melody-aware accompaniment-first)
  const activeSectionIds = new Set<string>();
  for (const [sid, tex] of Object.entries(instrumentation.textureBySection)) {
    if (instrumentation.textureYieldPolicy[tex] === 'active') activeSectionIds.add(sid);
  }
  const anchorBeats = new Set<number>();
  for (const slot of instrumentation.melodyReservationPlan.hookAnchorSlots) {
    if (slot.anchorRequired) anchorBeats.add(slot.beatSlot);
  }

  // 段落转折 fill:每段(除末段)最后一小节
  const fillBars = new Set<number>();
  let barCursor = 0;
  for (let s = 0; s < arrangement.sections.length; s++) {
    barCursor += arrangement.sections[s].bars;
    if (s < arrangement.sections.length - 1) fillBars.add(barCursor - 1);
  }

  // 织体分流:active 段 comp / floating 段 pad(不重叠)
  const floatingSectionIds = new Set<string>();
  for (const s of arrangement.sections) if (!activeSectionIds.has(s.id)) floatingSectionIds.add(s.id);

  // ★ 只渲染 lineup 内的角色(编制可变 2–5;lead 必有)
  const inLineup = (r: string) => band.instrumentPool.includes(r as never);
  const tracks: TrackIR[] = [];
  if (inLineup('bass')) tracks.push(renderBass(plan, timebase, band.style));
  if (inLineup('comp')) tracks.push(...renderAccompaniment(plan, timebase, { style: band.style, anchorBeats, activeSectionIds, voicingSaferSpans, compProgram: band.roleProgram.comp }));
  if (inLineup('pad')) tracks.push(renderPad(plan, timebase, floatingSectionIds));
  if (inLineup('drum')) tracks.push(renderDrums(plan, timebase, beatsPerBarOf(arrangement.meter), { style: band.style, fillBars }));
  tracks.push(renderMelody(anchorPlan, motifStore, plan, arrangement, band, timebase, candidateSwap, overlay?.restatementOverride)); // lead 必有

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

  // dynamics:力度随段落能量(chorus 强 / intro 弱 / 高潮峰)
  const energyRanges: EnergyRange[] = [];
  let dynCursor = 0;
  const bpbDyn = beatsPerBarOf(arrangement.meter);
  for (const s of arrangement.sections) {
    energyRanges.push({ lo: dynCursor, hi: dynCursor + s.bars * bpbDyn, energy: arrangement.energyBySection[s.id] ?? 0.5 });
    dynCursor += s.bars * bpbDyn;
  }
  const dynamicTracks = applyDynamics(resolved.data.tracks, energyRanges, timebase.ppq);

  // 人性化(5.3):力度 metric accent + 微随机(鼓除外,保 groove)→ swing → 微时序抖动
  const bpbHuman = beatsPerBarOf(arrangement.meter);
  const humanRng = rng.substream('humanize');
  const accentedTracks = humanizeVelocity(dynamicTracks, timebase.ppq, bpbHuman, humanRng);

  // feel:swing 落地(全轨统一 onset warp;直则原样)
  const swungTracks = applySwing(accentedTracks, timebase.ppq, arrangement.feel.swingRatio);

  // ★ 和声审计在【微时序之前】:Auditor 判和声落点用乐句网格起音,微抖动属网格下层、
  //   不应被和声判定(±少量 tick 跨和弦边界会误暴露 avoid)。审计过后再施加抖动产出可听 IR。
  const auditedIR = freezeMusicalIR({ tracks: swungTracks, timebase, durationTicks: resolved.data.durationTicks });
  const audit = auditHarmony(auditedIR, plan, timebase, {
    keyRootPc: band.key,
    globalMode: band.mode,
    isModalContext: band.tonalityKind === 'modal',
    scaleName: band.modalModeName,
    tonalCharacter: band.tonalityKind === 'modal' ? 'modal' : 'tonal',
  });

  // 微时序抖动:swing/审计之后,人手不踩死网格(±少量 tick)→ 最终可听 IR
  const humanizedTracks = humanizeTiming(swungTracks, timebase.ppq, humanRng);
  // ★ 末步挂乐器(BandEngine 选的 program;各 pass 保 role,此处按 role 贴回)
  const finalTracks = humanizedTracks.map((t) => ({ ...t, program: band.roleProgram[t.role] }));
  const ir = freezeMusicalIR({ tracks: finalTracks, timebase, durationTicks: resolved.data.durationTicks });
  return { ir, audit };
}
