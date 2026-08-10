// ============================================================
// newEngine · render · RenderCoordinator(Slice 0)
// ------------------------------------------------------------
// 架构定稿 Part 8 / 铁律4-5:accompaniment-first 编排。
// Slice 0 只走"伴奏 → IR → 只读 Auditor"前半;Motif/Anchor Prepass、Occupation、
// Melody、Resolver 后续 slice 接入。lead 轨先留空占位。
// ============================================================

import { beats, midi, pc as pitchClass, ticks, type RandomContext, type Timebase, type Ticks } from '../foundation';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import { freezeMusicalIR, type MusicalIR, type MusicalIRData, type NoteIR, type TrackIR, type TrackMix } from '../ir/MusicalIR';
import type { RoleMix } from '../knowledge/gmMixProfile';
import type { AuditReport } from '../ir/AuditReport';
import { renderAccompaniment } from './accompanimentRenderer';
import { renderBass } from './bassRenderer';
import { applyBassPatternSchedule } from './bassPatternSchedule';
import { deriveMusicIntentPlan, summarizeMusicIntent } from '../arranger/deriveMusicIntentPlan';
import {
  activeAcgPianoSectionIds,
  buildAcgPianoScorePlan,
  type AcgPianoScorePlan,
} from '../arranger/acgPianoScorePlan';
import { compileAcgPianoPedalScore } from '../arranger/acgPianoPedalScore';
import type { LofiLeadScorePlan } from '../arranger/lofiLeadScorePlan';
import type { JazzFiveFourScorePlan } from '../arranger/jazzFiveFourScorePlan';
import type { MusicIntentPlan } from '../intent/MusicIntentPlan';
import { buildTextureSchedule, deriveAcgBarFamilies } from './textureSchedule';
import { auditHarmony, type AuditKeyContext } from './readOnlyHarmonyAuditor';
import { auditMusicality } from './musicalityAuditor';
import { applyMgLofiDenseMelodyComping, denseMelodySpanRanges } from './mgPostMixShaper';
import {
  buildMgLeadRoadMap,
  renderMgMelodyWithAcgPerformancePlan,
  type MgLeadDebugCapture,
} from './mgLeadRenderer';
import { planAcgLeadPresence } from './acgLeadPresencePlan';
import {
  assembleAuthoredUserMotifLead,
  authoredLeadSpans,
  authoredMotifSectionInfos,
  planAuthoredUserMotifBrick,
  type AuthoredUserMotifBrickPlan,
  type UserMotifBrick,
} from './userMotifBrick';
import { materializeAuthoredUserMotifDevelopment, withMotifDevelopment } from './motifDevelopmentPlan';
import { buildOccupationMap, type OccupationMap } from './OccupationMap';
import { resolveInteractions } from './interactionResolver';
import { applyFinalDrumFollow, renderDrums } from './drumRenderer';
import { realizeDrumPerformanceTrack } from './drumPerformanceRealizer';
import { renderPad } from './padRenderer';
import { decidePadComp, type PadCompDecision } from './padCompPolicy';
import { applySwingBySection } from './swing';
import { applyDynamics, type EnergyRange } from './dynamics';
import { applyEnding, applyLeadIns } from './ending';
import { humanizeVelocity, humanizeTiming } from './humanize';
import { applyGroovePocketBySection, pocketedRolesForContracts } from './groovePocket';
import { applyMotifBindingReplay, applyRepeatGroupReplay } from './repeatGroupReplay';
import { fillLeadBarGaps } from './leadGapFill';
import { applyGestureExpressionToTrack } from '../instrumental/gestureExpression';
import { connectFastLeadNoteIR, fastLeadLegatoOptionsForStyle } from './leadArticulation';
import { sanitizeLeadNoteIR } from './leadSanitizer';
import { normalizeAcgDynamics } from './acgDynamics';
import type { RenderOverlay } from './RenderOverlay';
import { applyRenderMixBalance } from './renderMixBalance';
import { fitMidiToProgramRange } from '../knowledge/instruments';
import { evaluateNoteInChordContext } from '../knowledge/melodyChordSemantics';
import { MOTIF_POLICY_REPEAT_GROUP } from '../arranger/arrangementArchetypeContract';
import { applyGrooveScoreProjection } from './grooveScoreProjection';
import { assertJazzFiveFourProjectionIdentity, projectJazzFiveFourScoreTracks } from './jazzFiveFourScoreProjector';
import { assertJazzFiveFourGrooveMatch } from './jazzFiveFourGrooveMatcher';

export interface RenderResult {
  ir: MusicalIR;
  audit: AuditReport;
}

// ★ ESP32 混音:两段 mix 是否一致(决定段边界是否落 mixChanges;省 CC 流量,只在变化时刷新)。
function sameMix(a: RoleMix, b: RoleMix): boolean {
  return a.volume === b.volume && a.pan === b.pan && a.reverb === b.reverb && a.chorus === b.chorus
    && (a.expression ?? -1) === (b.expression ?? -1);
}

function totalDurationTicks(plan: HarmonicPlan, timebase: Timebase): number {
  let maxEnd = 0;
  for (const span of plan.chordTimeline) {
    const end = timebase.beatToTick(span.startBeat) + timebase.beatToTick(span.durationBeats);
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

/**
 * The ACG phrase score owns its written rests.  Feed those exact beat ranges
 * to the read-only continuity auditor so it diagnoses unplanned dropouts, not
 * the arranger's intentional piano air.
 */
function scoreOwnedAcgCompSilenceRanges(
  score: AcgPianoScorePlan | undefined,
  plan: HarmonicPlan,
  timebase: Timebase,
): { lo: number; hi: number }[] {
  if (!score) return [];
  const spanById = new Map(plan.chordTimeline.map((span) => [span.id, span]));
  return Object.entries(score.spanById).flatMap(([spanId, directive]) => {
    const harmonic = spanById.get(spanId);
    if (!harmonic) return [];
    const spanStartBeat = harmonic.startBeat as number;
    return directive.comp.silenceWindows.map((window) => ({
      lo: timebase.beatToTick(beats(spanStartBeat + window.startBeat)) as number,
      hi: timebase.beatToTick(beats(spanStartBeat + window.endBeat)) as number,
    })).filter((range) => range.hi > range.lo);
  });
}

// CC64 capability comes from Instrumentation. ACG timing comes from the
// pre-NoteIR shared PianoPedalScore; legacy styles keep pedalPlanByRole.
// Render only projects the selected beat score to TrackIR ticks.
// Legacy styles choose the pad anchor here. LOFI receives an upstream
// FoundationPlan, so its pad family is not re-selected during rendering.
const PAD_PEDAL_ANCHOR_PROB = 0.4;

/**
 * Place the Arranger-required LOFI response entry on an offbeat that the
 * already-rendered Bass/Comp/Pad foundation actually leaves open.  This runs
 * before melody tokens are scheduled; it never deletes or shifts finished
 * NoteIR.  A bar with no completely open candidate keeps the authored entry.
 */
function lofiLeadEntriesInFoundationSpace(
  authoredEntries: readonly number[],
  occupation: OccupationMap,
  ppq: number,
  beatsPerBar: number,
): number[] {
  const busyBeats = occupation.onsetTicks.map((tick) => tick / ppq);
  const offsets = beatsPerBar >= 4 ? [0.5, 1.5, 2.5, 3.5] : [0.5, 1.5];
  return authoredEntries.map((entry) => {
    const barStart = Math.floor(entry / beatsPerBar) * beatsPerBar;
    const candidates = offsets
      .map((offset) => barStart + offset)
      .filter((candidate) => candidate < barStart + beatsPerBar - 1e-6);
    return candidates.find((candidate) =>
      busyBeats.every((busy) => Math.abs(busy - candidate) > 0.12)) ?? entry;
  });
}

/** 伴奏 ducking:comp 撞旋律(lead)时 ×factor(让旋律清晰;旋律留白处 comp 不动=满响)。 */
export function duckUnderLead(tracks: TrackIR[], factor: number): TrackIR[] {
  const lead = tracks.find((t) => t.role === 'lead');
  if (!lead || lead.notes.length === 0) return tracks;
  const iv = lead.notes
    .map((n) => [n.startTick as number, (n.startTick as number) + (n.durationTicks as number)] as const)
    .sort((a, b) => a[0] - b[0]);
  const hits = (s: number, e: number) => iv.some(([ls, le]) => s < le && e > ls);
  return tracks.map((t) => {
    if (t.role !== 'comp') return t;
    return {
      ...t,
      notes: t.notes.map((n) => {
        const s = n.startTick as number;
        return hits(s, s + (n.durationTicks as number)) ? { ...n, velocity: Math.max(1, Math.round(n.velocity * factor)) } : n;
      }),
    };
  });
}

export function leadAvoidExposureResolver(
  notes: TrackIR['notes'],
  plan: HarmonicPlan,
  timebase: Timebase,
  programForSection: (sectionId: string) => number | undefined,
  compNotes: readonly TrackIR['notes'][number][] = [],
  keyCtx?: AuditKeyContext,
): TrackIR['notes'] {
  const oneBeatTicks = timebase.beatToTick(beats(1)) as number;
  const twoBeatTicks = oneBeatTicks * 2;
  const structuralTicks = Math.round(timebase.ppq * 0.75);
  const beatsPerBar = timebase.meter.numerator * (4 / timebase.meter.denominator);
  const metricTolerance = timebase.ppq * 0.08;
  const minClashOverlap = timebase.ppq / 2;
  const spans = plan.chordTimeline.map((span) => {
    const start = timebase.beatToTick(span.startBeat) as number;
    const end = start + (timebase.beatToTick(span.durationBeats) as number);
    return { span, start, end };
  });
  const funcBySpan: Record<string, (typeof plan.chordFunctionTimeline)[number]> = {};
  const idxBySpan: Record<string, number> = {};
  plan.chordTimeline.forEach((span, i) => { funcBySpan[span.id] = plan.chordFunctionTimeline[i]; idxBySpan[span.id] = i; });
  const spanAt = (tick: number) => spans.find((s) => tick >= s.start && tick < s.end);
  const nearestProgramPitch = (targetPc: number, ref: number, program: number): number => {
    const refPc = ((ref % 12) + 12) % 12;
    const up = ((targetPc - refPc) % 12 + 12) % 12;
    const signed = up > 6 ? up - 12 : up;
    return fitMidiToProgramRange(ref + signed, 'lead', program);
  };
  const intervalPenalty = (from: number | undefined, to: number): number => {
    if (from === undefined) return 0;
    const distance = Math.abs(to - from);
    const intervalClass = distance % 12;
    return distance > 12 ? 120 + distance
      : distance > 7 ? 30 + distance
      : intervalClass === 1 || intervalClass === 6 ? 18
      : distance;
  };
  const clashesComp = (candidatePitch: number, note: TrackIR['notes'][number]): boolean => {
    const ns = note.startTick as number;
    const ne = ns + (note.durationTicks as number);
    return compNotes.some((cn) => {
      const cs = cn.startTick as number;
      const ce = cs + (cn.durationTicks as number);
      const overlap = Math.min(ne, ce) - Math.max(ns, cs);
      if (overlap < minClashOverlap) return false;
      const distance = Math.abs((cn.pitch as number) - candidatePitch);
      return distance === 1 || distance === 13;
    });
  };
  const harmonicSets = (span: HarmonicPlan['chordTimeline'][number]) => {
    const avoid = new Set<number>(plan.avoidNoteMap[span.id] ?? []);
    const scale = new Set<number>(plan.chordScaleMap[span.id] ?? []);
    const contract = new Set<number>([...(plan.stableToneMap[span.id] ?? []), ...(plan.colorToneMap[span.id] ?? [])]);
    const legal = [...contract].filter((pc) => !avoid.has(pc) && scale.has(pc));
    return { avoid, scale, contract, legal };
  };
  const chooseLegalPitch = (args: {
    legalPcs: readonly number[];
    referencePitch: number;
    program: number;
    note: TrackIR['notes'][number];
    prevPitch?: number;
    nextPitch?: number;
    targetHintPcs?: readonly number[];
  }): number | null => {
    const hints = new Set((args.targetHintPcs ?? []).map((pc) => ((pc % 12) + 12) % 12));
    const referencePitches = [
      args.referencePitch,
      ...(args.prevPitch === undefined ? [] : [args.prevPitch]),
      ...(args.nextPitch === undefined ? [] : [args.nextPitch]),
    ];
    const candidates = [...new Set(args.legalPcs
      .flatMap((targetPc) => referencePitches.map((reference) => nearestProgramPitch(targetPc, reference, args.program))))]
      .sort((a, b) => {
        const score = (candidate: number) => Math.abs(candidate - args.referencePitch) * 2
          + intervalPenalty(args.prevPitch, candidate)
          + intervalPenalty(args.nextPitch, candidate)
          + (hints.has(((candidate % 12) + 12) % 12) ? -6 : 0);
        return score(a) - score(b) || Math.abs(a - args.referencePitch) - Math.abs(b - args.referencePitch);
      });
    return candidates.find((candidate) => !clashesComp(candidate, args.note)) ?? candidates[0] ?? null;
  };
  const foldUnexpectedOctaveLeaps = (input: TrackIR['notes']): TrackIR['notes'] => {
    const ordered = [...input].sort((a, b) => (a.startTick as number) - (b.startTick as number));
    let previousPitch: number | null = null;
    return ordered.map((note) => {
      const original = note.pitch as number;
      let pitch = original;
      if (previousPitch !== null && Math.abs(original - previousPitch) > 12) {
        const sectionId = spanAt(note.startTick as number)?.span.sectionId;
        const program = sectionId === undefined ? undefined : programForSection(sectionId);
        const candidates = [-24, -12, 0, 12, 24]
          .map((offset) => original + offset)
          .filter((candidate) => candidate >= 0 && candidate <= 127)
          .filter((candidate) => program === undefined || fitMidiToProgramRange(candidate, 'lead', program) === candidate)
          .sort((a, b) => Math.abs(a - previousPitch!) - Math.abs(b - previousPitch!)
            || Math.abs(a - original) - Math.abs(b - original));
        if (candidates[0] !== undefined && Math.abs(candidates[0] - previousPitch) <= 12) pitch = candidates[0];
      }
      previousPitch = pitch;
      return pitch === original ? note : { ...note, pitch: midi(pitch) };
    });
  };
  let changed = false;
  const fixed = notes.map((note, noteIndex) => {
    const noteStart = note.startTick as number;
    const exposure = spanAt(noteStart);
    if (!exposure) return note;
    const span = exposure.span;
    const pitch = note.pitch as number;
    const notePc = ((pitch % 12) + 12) % 12;
    const currentPc = pitchClass(notePc);
    const { avoid, scale, contract, legal: structuralLegal } = harmonicSets(span);
    const beat = timebase.tickToBeat(ticks(noteStart)) as number;
    const phase = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const strongBeat = Math.min(Math.abs(phase), Math.abs(phase - beatsPerBar), Math.abs(phase - beatsPerBar / 2)) * timebase.ppq <= metricTolerance;
    const chordEntrance = Math.abs(noteStart - exposure.start) <= metricTolerance;
    const structural = strongBeat || chordEntrance || (note.durationTicks as number) >= structuralTicks;
    let targetHintPcs: readonly number[] = [];
    const hardAvoid = structural && avoid.has(currentPc);
    const structuralIllegal = structural && !structuralLegal.includes(currentPc);
    if (!hardAvoid && keyCtx && (note.durationTicks as number) >= twoBeatTicks) {
      const idx = idxBySpan[span.id];
      const next = plan.chordTimeline[idx + 1];
      const modKey = plan.modulationMap[span.sectionId]?.toKey;
      const localScalePcs = new Set((plan.chordScaleMap[span.id] ?? []).map((pc) => Number(pc)));
      const assessment = evaluateNoteInChordContext({
        notePc: pitchClass(notePc),
        chordType: span.chordType ?? String(span.quality),
        chordRootPc: span.rootPc,
        effectiveFunc: funcBySpan[span.id] ?? 'T',
        nextChordType: next ? (next.chordType ?? String(next.quality)) : null,
        nextChordRootPc: next ? next.rootPc : null,
        keyRootPc: keyCtx.keyRootPc,
        globalMode: keyCtx.globalMode,
        isModalContext: keyCtx.isModalContext,
        scaleNameForBar: keyCtx.scaleName,
        localScalePcs,
        tonalCharacter: keyCtx.tonalCharacter,
        localTonalCenterPc: span.localTonalCenterPc ?? modKey,
      });
      if (assessment.consonance === 'avoid' && assessment.urgency >= 0.9) targetHintPcs = assessment.resolutionTargets;
    }
    if (!hardAvoid && !structuralIllegal && targetHintPcs.length === 0) return note;
    const program = programForSection(span.sectionId) ?? 0;
    // A structural note that already satisfies the authoritative intersection must not be
    // reinterpreted by a narrower semantic fallback (for example 7sus4 treated as plain 7).
    if (!hardAvoid && structuralLegal.includes(currentPc)) return note;
    const targetPcs = [
      ...targetHintPcs.map((targetPc) => pitchClass(targetPc)),
      ...structuralLegal,
    ].filter((pc, idx, arr) => !avoid.has(pc)
      && (hardAvoid || pc !== currentPc)
      && contract.has(pc)
      && scale.has(pc)
      && arr.indexOf(pc) === idx);
    if (targetPcs.length === 0) return note; // fail closed; final audit reports the unresolved note
    const prevPitch = noteIndex > 0 ? notes[noteIndex - 1].pitch as number : undefined;
    const nextPitch = noteIndex + 1 < notes.length ? notes[noteIndex + 1].pitch as number : undefined;
    const resolved = chooseLegalPitch({
      legalPcs: targetPcs,
      referencePitch: pitch,
      program,
      note,
      prevPitch,
      nextPitch,
      targetHintPcs,
    }) ?? pitch;
    if (resolved === pitch) return note;
    changed = true;
    return { ...note, pitch: midi(resolved) };
  });
  // A note may have been legal at its onset but sustain as a long structural tension into a
  // later chord. Split only those illegal long exposures at the boundary and resolve by the
  // same neighbour-aware intersection chooser; common tones remain tied unchanged.
  let splitChanged = false;
  const splitNotes: TrackIR['notes'][number][] = [];
  for (let noteIndex = 0; noteIndex < fixed.length; noteIndex++) {
    const note = fixed[noteIndex];
    const originalStart = note.startTick as number;
    const originalEnd = originalStart + (note.durationTicks as number);
    let segmentStart = originalStart;
    let segmentPitch = note.pitch as number;
    const boundaries = spans.filter((entry) => entry.start > originalStart && entry.start < originalEnd);
    for (const entry of boundaries) {
      const overlapEnd = Math.min(originalEnd, entry.end);
      const exposureTicks = overlapEnd - entry.start;
      const { avoid, legal } = harmonicSets(entry.span);
      const segmentPc = ((segmentPitch % 12) + 12) % 12;
      const illegalLongExposure = !legal.includes(segmentPc)
        && (exposureTicks >= structuralTicks || (avoid.has(segmentPc) && exposureTicks >= oneBeatTicks));
      if (!illegalLongExposure || legal.length === 0) continue;
      if (entry.start > segmentStart) {
        splitNotes.push({ ...note, pitch: midi(segmentPitch), startTick: ticks(segmentStart), durationTicks: ticks(entry.start - segmentStart) });
      }
      const targetNote = { ...note, startTick: ticks(entry.start), durationTicks: ticks(Math.max(1, overlapEnd - entry.start)) };
      const nextPitch = noteIndex + 1 < fixed.length ? fixed[noteIndex + 1].pitch as number : undefined;
      const resolved = chooseLegalPitch({
        legalPcs: legal,
        referencePitch: segmentPitch,
        program: programForSection(entry.span.sectionId) ?? 0,
        note: targetNote,
        prevPitch: segmentPitch,
        nextPitch,
      });
      if (resolved === null) continue;
      segmentStart = entry.start;
      segmentPitch = resolved;
      splitChanged = true;
    }
    splitNotes.push({ ...note, pitch: midi(segmentPitch), startTick: ticks(segmentStart), durationTicks: ticks(originalEnd - segmentStart) });
  }
  if (!splitChanged) return foldUnexpectedOctaveLeaps(changed ? fixed : notes);
  return foldUnexpectedOctaveLeaps(splitNotes);
}

function fitLeadTrackToInstrumentSections(
  track: TrackIR,
  arrangement: ArrangementPlan,
  instrumentation: InstrumentationPlan,
  timebase: Timebase,
): TrackIR {
  const beatsPerBar = beatsPerBarOf(arrangement.meter);
  const sections: { id: string; loBeat: number; hiBeat: number }[] = [];
  let cursor = 0;
  for (const section of arrangement.sections) {
    const loBeat = cursor;
    cursor += section.bars * beatsPerBar;
    sections.push({ id: section.id, loBeat, hiBeat: cursor });
  }
  const fallback = instrumentation.roleProgram.lead;
  const programAtTick = (tick: number): number => {
    const beat = timebase.tickToBeat(ticks(tick)) as number;
    const section = sections.find((s) => beat >= s.loBeat - 1e-6 && beat < s.hiBeat - 1e-6) ?? sections[sections.length - 1];
    return (section ? instrumentation.programByRoleSection.lead?.[section.id] : undefined) ?? fallback;
  };

  let changed = false;
  const notes = track.notes.map((note) => {
    const pitch = note.pitch as number;
    const fitted = fitMidiToProgramRange(pitch, 'lead', programAtTick(note.startTick as number));
    if (fitted === pitch) return note;
    changed = true;
    return { ...note, pitch: midi(fitted) };
  });
  return changed ? { ...track, notes } : track;
}

/** 按八度折入 Arranger/Instrumentation 明确写死的职责音区，尽量保持 pitch class。 */
function fitMidiToStrictRegister(value: number, range: { lowMidi: number; highMidi: number }): number {
  const lo = Math.max(0, Math.min(127, Math.round(range.lowMidi)));
  const hi = Math.max(lo, Math.min(127, Math.round(range.highMidi)));
  let fitted = Math.max(0, Math.min(127, Math.round(value)));
  while (fitted > hi) fitted -= 12;
  while (fitted < lo) fitted += 12;
  if (fitted >= lo && fitted <= hi) return fitted;
  return Math.abs(fitted - lo) <= Math.abs(fitted - hi) ? lo : hi;
}

/** ★ comp 去拖拍(2026-06-23,用户):把 comp 落在【拍内弱 16 分 .25/.75(拖在八分 groove 后)】的 onset 吸回
 *  【前一个八分】(去拖拍,锁鼓/bass);.0(beat)/.5(and)等有意切分位不动。同 onset 的和弦音一起移(保 voicing),
 *  时值补回 delta 保末点。只对 comp 调用;swung 风格不调(loose 是 feel)。 */
function snapCompLaidback(track: TrackIR, ppq: number): TrackIR {
  const eighth = ppq / 2, tol = ppq * 0.06;
  const isWeak16 = (tick: number): boolean => {
    const ph = ((tick % ppq) + ppq) % ppq; // 拍内相位
    return Math.abs(ph - ppq * 0.25) < tol || Math.abs(ph - ppq * 0.75) < tol;
  };
  return {
    ...track,
    notes: track.notes.map((n) => {
      const tick = n.startTick as number;
      if (!isWeak16(tick)) return n;
      const snapped = Math.floor(tick / eighth) * eighth; // 吸回前一个八分(去拖拍,不向后挪)
      const delta = tick - snapped;
      return { ...n, startTick: ticks(snapped), durationTicks: ticks(Math.max(1, (n.durationTicks as number) + delta)) };
    }),
  };
}

export interface DensityGateOptions {
  pickupWindows?: { lo: number; hi: number; roles: ReadonlySet<string> }[];
  rolePerformanceBySection?: ArrangementPlan['rolePerformanceBySection'];
  openingGesture?: ArrangementPlan['openingGesture'];
  /** Roles whose first-section entry must start on bar 1 even when the generic opening gesture delays them. */
  forceImmediateOpeningRoles?: ReadonlySet<TrackIR['role']>;
  /** User-authored override lead keeps its own timing, while still obeying presence/silence gates. */
  preserveLeadTiming?: boolean;
  /**
   * ACG's generated top line has already consumed its arrangement presence
   * plan in the token scheduler. Do not re-decide its rests after NoteIR
   * exists; this remains deliberately unavailable to override/user-motif lead.
   */
  preserveLeadPresence?: boolean;
  /** Timed role cells own their section entrance; generic delayed entry cannot shift their phase. */
  patternOwnedRoleSections?: ReadonlySet<string>;
}

/**
 * 编曲在场/入场/密度的单一 gate。activeRolesBySection 是所有角色(含 lead)的实际在场真源；
 * RolePerformance 叠加 none/dropout/delayed 与 bass/comp 温和密度上限；OpeningGesture 只管首段延迟。
 * pickup 授权窗口优先于上述 gate。整个过程只运行一次，发生在 occupation/auditor 之前。
 */
export function gateByDensity(
  tracks: TrackIR[],
  plan: HarmonicPlan,
  timebase: Timebase,
  activeRolesBySection: Record<string, readonly string[]>,
  options: DensityGateOptions = {},
): TrackIR[] {
  const pickupWindows = options.pickupWindows ?? [];
  const rolePerformanceBySection = options.rolePerformanceBySection;
  const openingGesture = options.openingGesture;
  const forceImmediateOpeningRoles = options.forceImmediateOpeningRoles ?? new Set<TrackIR['role']>();
  const patternOwnedRoleSections = options.patternOwnedRoleSections ?? new Set<string>();
  const beatsPerBar = timebase.meter.numerator * (4 / timebase.meter.denominator);
  const barTicks = beatsPerBar * timebase.ppq;
  const byId = new Map<string, { start: number; end: number }>();
  for (const span of plan.chordTimeline) {
    const s = timebase.beatToTick(span.startBeat) as number;
    const e = s + (timebase.beatToTick(span.durationBeats) as number);
    const r = byId.get(span.sectionId);
    if (!r) byId.set(span.sectionId, { start: s, end: e });
    else { r.start = Math.min(r.start, s); r.end = Math.max(r.end, e); }
  }
  const ranges = [...byId.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => a.start - b.start);
  const firstSectionId = ranges[0]?.id;
  const sectionAt = (tick: number) => ranges.find((r) => tick >= r.start && tick < r.end);
  const isPickup = (tick: number, role: string) => pickupWindows.some((w) => tick >= w.lo && tick < w.hi && w.roles.has(role));

  const entryThreshold = (section: { id: string; start: number }, role: TrackIR['role']): number => {
    if (patternOwnedRoleSections.has(`${section.id}:${role}`)) return section.start;
    // ACG PIANOSONG treats the low piano/root voice as the harmonic ground. It may be sparse,
    // but it must not disappear merely because a generic opening gesture delays the bass.
    if (section.id === firstSectionId && forceImmediateOpeningRoles.has(role)) return section.start;
    const performance = rolePerformanceBySection?.[role]?.[section.id];
    const hasOpeningDelay = section.id === firstSectionId
      && openingGesture?.sectionId === section.id
      && Object.prototype.hasOwnProperty.call(openingGesture.roleDelayBars, role);
    const openingDelay = hasOpeningDelay ? openingGesture!.roleDelayBars[role] : undefined;
    const delayBars = openingDelay !== undefined
      ? Math.max(0, openingDelay)
      : performance?.entryMode === 'delayed' ? 1 : 0;
    return section.start + delayBars * barTicks;
  };

  const metricPriority = (tick: number, sectionStart: number): number => {
    const beat = (((tick - sectionStart) / timebase.ppq) % beatsPerBar + beatsPerBar) % beatsPerBar;
    const nearestInteger = Math.abs(beat - Math.round(beat));
    if (beat < 0.08 || beatsPerBar - beat < 0.08) return 0;
    if (Math.abs(beat - beatsPerBar / 2) < 0.08) return 1;
    if (nearestInteger < 0.08) return 2;
    if (Math.abs((beat % 1) - 0.5) < 0.08) return 3;
    return 4;
  };

  const capOnsetGroups = (notes: TrackIR['notes'], role: TrackIR['role']): TrackIR['notes'] => {
    if (role !== 'bass' && role !== 'comp') return notes;
    const groupsByBar = new Map<string, { sectionId: string; sectionStart: number; ticks: Map<number, TrackIR['notes']> }>();
    const outsideSection: TrackIR['notes'] = [];
    for (const note of notes) {
      const tick = note.startTick as number;
      const section = sectionAt(tick);
      if (!section) { outsideSection.push(note); continue; }
      const bar = Math.max(0, Math.floor((tick - section.start) / barTicks));
      const key = `${section.id}:${bar}`;
      const row = groupsByBar.get(key) ?? { sectionId: section.id, sectionStart: section.start, ticks: new Map() };
      const onset = row.ticks.get(tick) ?? [];
      onset.push(note);
      row.ticks.set(tick, onset);
      groupsByBar.set(key, row);
    }

    const kept: TrackIR['notes'] = [...outsideSection];
    const minimumGroups = Math.max(2, Math.round(beatsPerBar * 2));
    const referenceSlots = Math.max(minimumGroups, Math.round(beatsPerBar * 4));
    for (const row of groupsByBar.values()) {
      const performance = rolePerformanceBySection?.[role]?.[row.sectionId];
      if (!performance || !Number.isFinite(performance.densityBudget)) {
        for (const group of row.ticks.values()) kept.push(...group);
        continue;
      }
      const budget = Math.max(0, Math.min(1, performance.densityBudget));
      // A "gentle" ceiling keeps a normal eighth-note groove intact even at budget 0 and only
      // thins unusually dense (near-sixteenth) onset streams. This avoids manufacturing holes in
      // an already-authored comp/bass pattern while still enforcing a real per-bar upper bound.
      const maxGroups = Math.max(minimumGroups, Math.min(referenceSlots,
        Math.ceil(minimumGroups + budget * (referenceSlots - minimumGroups))));
      const rankedTicks = [...row.ticks.keys()]
        .sort((a, b) => metricPriority(a, row.sectionStart) - metricPriority(b, row.sectionStart) || a - b);
      // Authorized pickups outrank the density ceiling as well as presence/entry gates. They do
      // count toward the budget when possible; if there are more pickups than slots, keep them all.
      const selectedTicks = new Set(rankedTicks.filter((tick) => isPickup(tick, role)));
      for (const tick of rankedTicks) {
        if (selectedTicks.size >= maxGroups) break;
        selectedTicks.add(tick);
      }
      for (const [tick, group] of row.ticks) if (selectedTicks.has(tick)) kept.push(...group);
    }
    return kept.sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number));
  };

  return tracks.map((t) => {
    const onsetGroups = new Map<number, TrackIR['notes']>();
    for (const note of t.notes) {
      const tick = note.startTick as number;
      const group = onsetGroups.get(tick) ?? [];
      group.push(note);
      onsetGroups.set(tick, group);
    }
    const admitted: TrackIR['notes'] = [];
    for (const [tick, group] of onsetGroups) {
      if (isPickup(tick, t.role)) { admitted.push(...group); continue; }
      if (t.role === 'lead' && options.preserveLeadPresence) {
        admitted.push(...group);
        continue;
      }
      const section = sectionAt(tick);
      if (!section) { admitted.push(...group); continue; }
      if (!(activeRolesBySection[section.id] ?? []).includes(t.role)) continue;
      const performance = rolePerformanceBySection?.[t.role]?.[section.id];
      if (performance?.entryMode === 'none' || performance?.entryMode === 'dropout') continue;

      const threshold = t.role === 'lead' && options.preserveLeadTiming
        ? section.start
        : entryThreshold(section, t.role);
      if (tick >= threshold) { admitted.push(...group); continue; }
      if (t.role !== 'bass' && t.role !== 'comp' && t.role !== 'pad') continue;

      // 延迟阈值前已经起音、但整个 onset group 都跨过阈值的长织体，统一把起点裁到阈值；
      // lead brick 不做此类侵入式裁切，阈值前的自然音直接丢弃。
      if (!group.every((note) => tick + (note.durationTicks as number) > threshold)) continue;
      admitted.push(...group.map((note) => ({
        ...note,
        startTick: ticks(threshold),
        durationTicks: ticks(tick + (note.durationTicks as number) - threshold),
      })));
    }
    const notes = capOnsetGroups(admitted, t.role);
    return {
      ...t,
      notes,
    };
  });
}

/**
 * @deprecated ★【LEGACY / 仅测试用,产线/UI 绝不调用】(P2,musicgenerative_remaining_strict_migration_gaps.md)。
 *   这是 Slice 0 早期占位:lead 恒空(无 MG 旋律链),bass/comp 走 default。产品路径是 `renderSongFull`
 *   (band/arrangement/instrumentation/MG lead 全链)。保留仅为 renderCoordinator.test 的最小冒烟;
 *   缺 BandSpec/ArrangementPlan/InstrumentationPlan,【不要】把它接进任何 MG 链或产线生成。
 *   产线唯一入口 = GenerationController.generateSong → renderSongFull。
 */
export function renderSong(plan: HarmonicPlan, timebase: Timebase): RenderResult {
  const bass = renderBass(plan, timebase, 'default');
  const accompaniment = renderAccompaniment(plan, timebase);
  // ★ LEGACY 占位:lead 恒空(产品 lead 走 renderSongFull 的 MG 链 renderMgMelody)。
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
  overrideLeadTrack?: TrackIR, // ★ 走 A:Q+R sandbox 权威 lead 注入 → 跳过 renderMgMelody(默认 undefined = 不变)
  intentPlan?: MusicIntentPlan, // ★ Phase 2:上游(controller)派生的 intent(bass enforce);缺省(测试)→ 内联纯派生(不抽 RNG)
  userMotifBrick?: UserMotifBrick, // ★ Q+R 收口:用户 motif 作为 Q+N lead 内的 brick quote,其余续写仍由 MG/Q+N 生成
  /** Production supplies this immutable arranger score from SongBundle. Direct renderer tests may omit it. */
  suppliedAcgPianoScorePlan?: AcgPianoScorePlan,
  /** Explicit MIDI-reference quartet score; absent keeps every legacy path unchanged. */
  suppliedJazzFiveFourScorePlan?: JazzFiveFourScorePlan,
  /** Read-only test/audit capture; omitted in normal generation. */
  leadDebugCapture?: MgLeadDebugCapture,
  /** LOFI only: immutable post-harmony lead score supplied by SongBundle. */
  suppliedLofiLeadScorePlan?: LofiLeadScorePlan,
): RenderResult {
  const isAcg = band.style.toLowerCase() === 'acg';
  const isLofi = band.style.toLowerCase() === 'lofi';
  // ACG PIANOSONG is one scored piano trio.  Once its scheduler/score-plan
  // has authored a note, late generic piano transforms must not reinterpret
  // that note as an interchangeable comp or bass event.
  const acgPianoRoles = new Set<TrackIR['role']>(['lead', 'comp', 'bass']);
  const isAcgPianoRole = (role: TrackIR['role']): boolean => isAcg && acgPianoRoles.has(role);
  // An injected lead is deliberately outside the generated PianoScorePlan.
    // It must keep the legacy arrangement gate (and its own authored velocity),
    // while the rendered piano hands remain protected from generic NoteIR
    // rewrites. A planned motif no longer makes the generated ACG lead external:
    // its owned span is reserved before realization and assembled only at the end.
  const isScoreOwnedAcgPianoRole = (role: TrackIR['role']): boolean => {
    if (!isAcgPianoRole(role)) return false;
      return role !== 'lead' || !overrideLeadTrack;
  };
  // LOFI owns only its generated top line. Its rhythm, harmony and motif
  // recall are authored in LofiLeadScorePlan before NoteIR; lower tracks keep
  // the normal arranger/render chain.
  const isScoreOwnedLofiLead = isLofi
    && suppliedLofiLeadScorePlan !== undefined
    && !overrideLeadTrack;
  const isScoreOwnedLeadRole = (role: TrackIR['role']): boolean =>
    isScoreOwnedAcgPianoRole(role) || (isScoreOwnedLofiLead && role === 'lead');
  const scoreOwnedAcgPianoRoles = new Set<TrackIR['role']>(
    [...acgPianoRoles].filter((role) => isScoreOwnedAcgPianoRole(role)),
  );
  /**
   * Score-owned ACG hands are arranger-authored, not generic tracks waiting
   * for density or edge correction. Keep structural NoteIR transforms away
   * from those hands only; explicit external lead overrides still use the
   * ordinary arrangement contract.
   */
  const transformScoreUnownedTracks = (
    source: TrackIR[],
    transform: (tracks: TrackIR[]) => TrackIR[],
  ): TrackIR[] => {
    if (!isAcg && !isScoreOwnedLofiLead) return transform(source);
    return source.map((track) => isScoreOwnedLeadRole(track.role)
      ? track
      : (transform([track])[0] ?? track));
  };
  // ★ 2026-06-07 退役 Motif 旋律子系统(backlog D-1/c):旋律走 MG 链,不再跑 Prepass/MotifStore/
  //   candidateSwap。撞音消解只剩 voicingSafer(comp 瘦身)+ 兜底重掷(advance melody 子流)。
  const voicingSaferSpans = overlay?.voicingSafer ? new Set(Object.keys(overlay.voicingSafer)) : undefined;

  // 让位上下文:active 织体段 + 主 hook 锚点拍(melody-aware accompaniment-first)
  // ★ comp 渲染段 = active 织体段 ∪【器配授权 comp 托底的 floating 段】(Loop D 已把 comp 写进 activeRolesBySection)。
  //   即:floating 段(pad/sustained-block)里若 comp active 且 pad 不在场 → comp 在此渲染和声(authority 来自器配,非 render 偷渲染)。
  const resolvedArchetype = arrangement.resolvedArchetype;
  const hasResolvedRoleLayout = resolvedArchetype !== undefined;
  const bassPatternIdBySection: Record<string, string> = Object.fromEntries(
    Object.values(arrangement.grooveScorePlan?.bySection ?? {}).flatMap((sectionScore) =>
      sectionScore.bassPatternId
        ? [[sectionScore.sectionId, sectionScore.bassPatternId] as const]
        : []),
  );
  const foundationRoleBySection = Object.fromEntries(
    Object.entries(resolvedArchetype?.sectionPolicyById ?? {})
      .map(([sectionId, policy]) => [sectionId, policy.foundationOwner]),
  );
  const activeSectionsForRole = (role: TrackIR['role']): Set<string> => new Set(
    arrangement.sections
      .filter((section) => (instrumentation.activeRolesBySection[section.id] ?? []).includes(role))
      .map((section) => section.id),
  );
  const bassActiveSectionIds = activeSectionsForRole('bass');
  const compActiveSectionIds = activeSectionsForRole('comp');
  const padActiveSectionIds = activeSectionsForRole('pad');
  const drumActiveSectionIds = activeSectionsForRole('drum');
  const leadActiveSectionIds = activeSectionsForRole('lead');
  const activeSectionIds = hasResolvedRoleLayout
    ? compActiveSectionIds
    : activeAcgPianoSectionIds(instrumentation);
  const timedRoleSections = new Set<string>();
  const timedRoleNames = new Set<string>();
  let preserveArrangerLeadRests = arrangement.lofiLeadPresencePlan !== undefined;
  for (const sectionScore of Object.values(arrangement.grooveScorePlan.bySection)) {
    for (const role of ['bass', 'comp'] as const) {
      const pattern = sectionScore.roleRhythmByRole?.[role];
      if (!pattern || pattern.realization !== 'timed-cells') continue;
      timedRoleSections.add(`${sectionScore.sectionId}:${role}`);
      timedRoleNames.add(role);
    }
    if (sectionScore.roleRhythmByRole?.lead?.preserveIntentionalRests) {
      preserveArrangerLeadRests = true;
    }
  }
  const anchorBeats = new Set<number>();
  for (const slot of instrumentation.melodyReservationPlan.hookAnchorSlots) {
    if (slot.anchorRequired) anchorBeats.add(slot.beatSlot);
  }

  // 段落转折:Arranger 的 DrumPerformanceContract 决定鼓是否 fill / fill 多大;
  // lead-inBars 仍用于非鼓声部的边界 crescendo/pickup 保护,不再等同于鼓必 fill。
  const drumFillBars = new Set<number>();
  const drumBigFillBars = new Set<number>();
  const leadInBars = new Set<number>(); // 跃升段【前一段末小节】绝对序号(衔接推进)
  let barCursor = 0;
  for (let s = 0; s < arrangement.sections.length; s++) {
    const section = arrangement.sections[s];
    barCursor += section.bars;
    const next = arrangement.sections[s + 1];
    if (next) {
      const perf = arrangement.drumPerformanceBySection?.[section.id];
      const fillPolicy = perf?.fillPolicy ?? 'turnaround';
      if (fillPolicy !== 'none') {
        drumFillBars.add(barCursor - 1);
        if (fillPolicy === 'big') drumBigFillBars.add(barCursor - 1);
      }
      if (arrangement.entryBySection[next.id] === 'lead-in') leadInBars.add(barCursor - 1);
    }
  }

  // ★ pad 改为独立常驻轨(全段落铺底,见 padRenderer);不再与 comp 二选一(去掉 floating XOR)。

  // ★ 多声部节奏【中央下发】:纹理 schedule 一次性建好,bass/comp/drum 共享同一 textureCase →
  //   同一时钟对拍/复调(纹理全权,忠实 mg)。需 harmony(dominant-chain)→ 在此协调层算。
  const sectionRoleById = Object.fromEntries(arrangement.sections.map((s) => [s.id, s.role]));
  // ★ Phase 3A(intent enforce):ACG 逐-bar family intent(drive/sparse)在此派生(有 active sections),下发给 texture 选择消费。
  //   byte-identical:deriveAcgBarFamilies = 原 ACG 分支内联逻辑的抽取;texture 分支读它不再内联算。非 ACG=undefined(不影响)。
  const acgBarFamilyBySpan = band.style.toLowerCase() === 'acg' ? deriveAcgBarFamilies(plan, activeSectionIds, sectionRoleById) : undefined;
  // ACG 先写内部 PianoScorePlan，再把它投影为共享 texture schedule。它只在系统内部
  // 识别 arrangement subset；UI 仍只有 ACG PIANOSONG 一个风格入口。
  const directAcgLeadPresencePlan = isAcg ? planAcgLeadPresence(arrangement, instrumentation) : undefined;
  const acgPianoScorePlan = isAcg
    ? suppliedAcgPianoScorePlan ?? buildAcgPianoScorePlan({
      seed: rng.seed,
      arrangement,
      harmonic: plan,
      activeSectionIds,
      grooveContract: arrangement.songGrooveContract,
      leadPresencePlan: directAcgLeadPresencePlan,
      })
    : undefined;
  const totalBeatsForLead = arrangement.sections.reduce(
    (total, section) => total + section.bars * beatsPerBarOf(arrangement.meter),
    0,
  );
  const motifRoadMap = userMotifBrick && !overrideLeadTrack
    ? buildMgLeadRoadMap(plan, band, timebase, acgPianoScorePlan, suppliedLofiLeadScorePlan)
    : undefined;
  const motifSectionInfos = userMotifBrick && motifRoadMap
    ? authoredMotifSectionInfos(arrangement.sections, beatsPerBarOf(arrangement.meter))
    : undefined;
  const authoredUserMotifPlan: AuthoredUserMotifBrickPlan | undefined = userMotifBrick && motifRoadMap
    ? withMotifDevelopment(
      planAuthoredUserMotifBrick({
        brick: userMotifBrick,
        roadMap: motifRoadMap,
        harmonicPlan: plan,
        totalBeats: totalBeatsForLead,
        // 段落角色进落位打分(redesign 一期):hook 型 motif 亲和副歌/hook 段,theme 型亲和段落头
        sections: motifSectionInfos,
      }),
      // 发展弧线(redesign 二期):陈述之外规划 develop/return occurrence;置信档决定修饰力度
      {
        roadMap: motifRoadMap,
        harmonicPlan: plan,
        totalBeats: totalBeatsForLead,
        sections: motifSectionInfos,
        confidenceTier: userMotifBrick.confidenceTier,
        style: band.style, // 按风格融入合同(motifStyleIntegration)
      },
    )
    : undefined;
  const authoredUserMotifNotes = materializeAuthoredUserMotifDevelopment(authoredUserMotifPlan, timebase, {
    swingRatio: arrangement.songGrooveContract.melodySwingRatio,
    beatsPerBar: beatsPerBarOf(arrangement.meter),
    grooveContract: arrangement.songGrooveContract,
    tempoBpm: arrangement.tempoBpm,
    sustainFill: true, // 四期(用户裁决 §0.5):motif 时值允许合理 sustain/连贯
    harmonicPlan: plan, // sustain 和声感知:延展不得制造 avoid-note 长时值暴露
  });
  const withAuthoredLeadContext = (source: TrackIR[]): TrackIR[] => source.map((track) =>
    track.role === 'lead'
      ? assembleAuthoredUserMotifLead(track, authoredUserMotifPlan, authoredUserMotifNotes, timebase)
      : track);
  const restoreGeneratedLead = (context: TrackIR[], generated: TrackIR[]): TrackIR[] => {
    const generatedLead = generated.find((track) => track.role === 'lead');
    return context.map((track) => track.role === 'lead' && generatedLead ? generatedLead : track);
  };
  const lofiCompRoleByAbsoluteBar = arrangement.lofiPhraseInteractionPlan
    ? Object.fromEntries(arrangement.lofiPhraseInteractionPlan.bars.map((bar) => [bar.absoluteBar, bar.compRole]))
    : undefined;
  const baseTextureSchedule = buildTextureSchedule({
    plan,
    style: band.style,
    sectionRoleById,
    activeSectionIds,
    textureRng: rng.substream('compTexture'),
    richTextureBySection: instrumentation.richTextureBySection,
    richTextureSwitchBySection: instrumentation.richTextureSwitchBySection,
    grooveContract: arrangement.songGrooveContract,
    grooveContractBySection: arrangement.grooveContractBySection,
    acgBarFamilyBySpan,
    lofiCompRoleByAbsoluteBar,
    beatsPerBar: beatsPerBarOf(arrangement.meter),
  });
  const textureSchedule = acgPianoScorePlan
    ? { ...baseTextureSchedule, ...acgPianoScorePlan.textureBySpan }
    : baseTextureSchedule;

  // ★ 只渲染 lineup 内的角色(编制可变 2–5;lead 必有)
  const inLineup = (r: string) => band.instrumentPool.includes(r as never);

  // ★ pad-comp 分工(docs/pad_comp_interaction_directive.md):每段算 PadCompDecision。
  //   默认 Pad 写当前和弦并做平滑声部连接；comp active 段用薄 chord-bed，pad-only 才 full-support。
  //   render 顺序:bass → pad → comp(comp 拿 pad 占用音高避同绝对音)→ drum → lead。lead > bass > comp > pad。
  const reservedReg = instrumentation.melodyReservationPlan.reservedRegister;
  const baseCompCeilingMidi = instrumentation.registerByRole.comp
    ? ((instrumentation.registerByRole.comp.highMidi as number) + 1)
    : (reservedReg.lowMidi as number);
  // Sax lead 用真实宽音域后,comp 不能再顶到同一中音区;否则 lead 62 / comp 63 会形成贴音。
  const compCeilingMidi = instrumentation.roleProgram.lead === 67
    ? Math.min(baseCompCeilingMidi, 61)
    : baseCompCeilingMidi;
  const activeRoles = instrumentation.activeRolesBySection;
  const roleInArr = (sid: string, role: string) => ((activeRoles[sid] as readonly string[] | undefined)?.includes(role) ?? true);
  const padDecisionBySection: Record<string, PadCompDecision> = {};
  for (const s of arrangement.sections) {
    padDecisionBySection[s.id] = decidePadComp({
      style: band.style,
      sectionId: s.id,
      sectionRole: s.role,
      padDensity: band.styleProfile.padDensity,
      padActive: inLineup('pad') && roleInArr(s.id, 'pad'),
      compActive: inLineup('comp') && activeSectionIds.has(s.id) && roleInArr(s.id, 'comp'),
      bassActive: inLineup('bass') && roleInArr(s.id, 'bass'),
      leadReservedLow: reservedReg.lowMidi as number,
      leadReservedHigh: reservedReg.highMidi,
      lofiPadFamily: arrangement.lofiFoundationPlan?.padIntent.family,
    });
  }

  // pad 先于 comp【渲染】:收每 span 占用绝对音高 → comp 据此让位(避 unison)。
  //   但【输出轨序】仍为 bass/comp/pad/drum/lead(顺序仅装饰,通道按 role 分配)。
  const padOccupiedPitchesBySpan: Record<string, number[]> = {};
  let padTrack: TrackIR | undefined;
  if (inLineup('pad') && (!hasResolvedRoleLayout || padActiveSectionIds.size > 0)) {
    // ★ pad 铺法二选一(一首一掷,确定性):~40% 走 pedal anchor(整段共同音/主音长 pedal + 动声部),
    //   ~60% 现有逐和弦选音。padStyle 子流独立 → 不扰其它决策。
    const pedalAnchor = arrangement.lofiFoundationPlan
      ? arrangement.lofiFoundationPlan.padIntent.family === 'common-tone'
      : rng.substream('padStyle').next() < PAD_PEDAL_ANCHOR_PROB;
    padTrack = renderPad(plan, timebase, {
      padDensity: band.styleProfile.padDensity,
      decisionBySection: padDecisionBySection,
      leadReservedLow: reservedReg.lowMidi as number,
      padRegister: {
        lowMidi: instrumentation.registerByRole.pad.lowMidi as number,
        highMidi: instrumentation.registerByRole.pad.highMidi as number,
      },
      pedalAnchor,
      tonicPc: band.key as number,
      continuityGroupBySection: Object.fromEntries(
        arrangement.sections.map((section) => [section.id, section.repeatGroup ?? section.id]),
      ),
    });
    // ★ comp 避同绝对音高:只针对 pad 的【逐和弦音】(覆盖正好 1 span,会随和弦重新起音 → 可能与 comp hit 撞 unison)。
    //   一切【持续音】(tie 共同音 / pedal anchor,覆盖 ≥2 span)不让 comp 避——软持续 pad 上叠 comp 是加厚不是
    //   mud,且强行避会让 comp 整段/稀疏段丢掉该音高 = 过稀(实测 intro pedal 掏空 comp)。
    const spanRanges = plan.chordTimeline.map((span) => {
      const lo = timebase.beatToTick(span.startBeat) as number;
      return { id: span.id, lo, hi: lo + (timebase.beatToTick(span.durationBeats) as number) };
    });
    for (const n of padTrack.notes) {
      const ns = n.startTick as number;
      const ne = ns + (n.durationTicks as number);
      const covered = spanRanges.filter((r) => ns < r.hi && ne > r.lo);
      if (covered.length === 1) (padOccupiedPitchesBySpan[covered[0].id] ??= []).push(n.pitch as number); // 仅逐和弦音
    }
  }

  // ★ Phase 2(intent 迁移,enforce):bass 地板拍位来源从 finalEventProfile 迁到 arranger 派生的 BassPatternSchedule。
  //   优先用上游(controller)传入的 intentPlan;缺省(测试直调)→ 内联纯派生(deriveMusicIntentPlan 无 RNG,确定性)。
  //   applyBassPatternSchedule 与旧 enforceBassDensityFloor 逐字节等价(bassPatternScheduleEquivalence.test 锁)→ 输出不变。
  const intent = { ...(intentPlan ?? deriveMusicIntentPlan(band.style, arrangement)), ...(acgBarFamilyBySpan ? { acgBarFamilyBySpan } : {}) };
  const tracks: TrackIR[] = [];
  if (inLineup('bass') && (!hasResolvedRoleLayout || bassActiveSectionIds.size > 0)) {
    // 非 ACG 纹理 bass 过稀 → 主体段强拍补 root anchor(intent BassPatternSchedule 驱动);
    // ACG 的根音/支撑预算已由 PianoScorePlan 在 renderBass 内直接实化。通用
    // intent floor 若在此再加 NoteIR，会突破 score 的 maxNotesPerSpan / 留白合同。
    const rawBass = renderBass(
      plan,
      timebase,
      band.style,
      textureSchedule,
      acgPianoScorePlan,
      bassPatternIdBySection,
      instrumentation.strictRegisterByRole?.bass,
    );
    const patternOwnedSectionIndexes = new Set(arrangement.sections
      .map((section, index) => bassPatternIdBySection[section.id] ? index : -1)
      .filter((index) => index >= 0));
    tracks.push(acgPianoScorePlan
      ? rawBass
      : applyBassPatternSchedule(rawBass, plan, arrangement.sections, intent, beatsPerBarOf(arrangement.meter), timebase.ppq, patternOwnedSectionIndexes));
  }
  const lofiVoicingIntent = arrangement.lofiFoundationPlan
    ? {
      family: arrangement.lofiFoundationPlan.voicingIntent.family,
      register: [
        arrangement.lofiFoundationPlan.voicingIntent.register[0],
        arrangement.lofiFoundationPlan.voicingIntent.register[1],
      ] as const,
      maxVoicesWithBass: arrangement.lofiFoundationPlan.voicingIntent.maxVoicesWithBass,
    }
    : undefined;
  const compPedalActiveSectionIds = new Set(
    (instrumentation.pedalPlanByRole.comp?.events ?? [])
      .filter((event) => event.down)
      .map((event) => event.sectionId),
  );
  if (inLineup('comp') && (!hasResolvedRoleLayout || compActiveSectionIds.size > 0)) tracks.push(...renderAccompaniment(plan, timebase, { style: band.style, anchorBeats, activeSectionIds, foundationRoleBySection, voicingSaferSpans, compProgram: instrumentation.roleProgram.comp, compRegister: instrumentation.strictRegisterByRole?.comp, sectionRoleById, voicingRng: rng.substream('accompaniment'), textureSchedule, melodyFloorMidi: compCeilingMidi, padCompDecisionBySection: padDecisionBySection, padOccupiedPitchesBySpan, needsDownbeatCompAnchorBySection: instrumentation.needsDownbeatCompAnchorBySection, pianoScorePlan: acgPianoScorePlan, grooveScorePlan: arrangement.grooveScorePlan, lofiVoicingIntent, compPerformanceIntent: arrangement.lofiFoundationPlan?.compIntent, compPedalActiveSectionIds }));
  if (padTrack) tracks.push(padTrack);
  // Drum realization waits until the lead exists so every declared follow
  // source can be consumed. It is inserted at this index to preserve the
  // canonical bass/comp/pad/drum/lead track order.
  const drumTrackInsertIndex = tracks.length;
  // ★ lead 主链 = MG 旋律链(decision C/B/1);读冻结 HarmonicPlan,走独立 'melody' 子流(确定性)。
  //   多轨层(gateByDensity/ducking/CC7)原样包住。
  // lead 必有:默认走 MG 链;legacy lead override 才跳过 MG。用户 motif 已在生产 RoadMap
  //   声明 authored ownership，scheduler 不会在其区间生成另一条 lead。
  //   ★ ACG 的落点/趋近/呼吸已由 RoadMap → scheduler → realizer 一次生成；这里不再
  //   对成品 lead 做 tuck 或补音，避免跨和弦后的末端改写。
  // ACG owns lead presence at the score/token level. The same arrangement
  // information that formerly drove the final density gate is translated
  // before melody realization, so a breathing window is a real R token rather
  // than a deleted NoteIR event. A user motif only reserves one authored span;
  // the remaining ACG lead stays score-owned and consumes the same presence plan.
  const acgLeadPresencePlan = isAcg && !overrideLeadTrack
    ? acgPianoScorePlan?.leadPresencePlan ?? directAcgLeadPresencePlan
    : undefined;
  const reserved = {
    lowMidi: instrumentation.melodyReservationPlan.reservedRegister.lowMidi,
    highMidi: instrumentation.melodyReservationPlan.reservedRegister.highMidi,
  };
  // A score-owned LOFI lead has already written its legal entrances into the
  // post-harmony score. Foundation occupancy remains useful for the legacy
  // LOFI path only; it must not silently re-time a score token here.
  const preLeadFoundationOccupation = !isScoreOwnedLofiLead && arrangement.lofiFoundationPlan
    ? buildOccupationMap(tracks, reserved)
    : undefined;
  const lofiLeadEntryBeats = isScoreOwnedLofiLead
    ? suppliedLofiLeadScorePlan?.entryBeats
    : preLeadFoundationOccupation
      ? lofiLeadEntriesInFoundationSpace(
        arrangement.lofiLeadPresencePlan?.entryBeats ?? [],
        preLeadFoundationOccupation,
        timebase.ppq,
        beatsPerBarOf(arrangement.meter),
      )
      : arrangement.lofiLeadPresencePlan?.entryBeats;
  // A scored LOFI lead must receive the arranger/instrumentation writing
  // register even when that register is not marked as a hard ensemble
  // constraint. Falling back to a GM program's physical range would make a
  // low but technically playable note look legal to the score realizer.
  const leadWritingRegister = isScoreOwnedLofiLead
    ? instrumentation.registerByRole.lead
    : instrumentation.strictRegisterByRole?.lead;
  const generatedLeadPerformance = overrideLeadTrack
    ? {
      track: { ...overrideLeadTrack, role: 'lead' as const, program: instrumentation.roleProgram.lead },
      // An external NoteIR lead has no legal pre-NoteIR attack contract. The
      // lower two written hands still receive the Arranger's pedal score; we
      // never inspect the finished override notes to invent controller data.
      acgPianoPedalScore: isAcg && acgPianoScorePlan
        ? compileAcgPianoPedalScore({ harmonic: plan, pianoScorePlan: acgPianoScorePlan })
        : undefined,
    }
    : renderMgMelodyWithAcgPerformancePlan(
      plan,
      band,
      timebase,
      rng.seed,
      instrumentation.roleProgram.lead,
      arrangement.songGrooveContract,
      acgLeadPresencePlan,
        acgPianoScorePlan,
        arrangement.grooveContractBySection,
        leadWritingRegister,
        motifRoadMap,
        authoredUserMotifPlan,
        arrangement.tempoBpm,
        arrangement.lofiLeadPresencePlan?.silenceWindows,
        lofiLeadEntryBeats,
        leadDebugCapture,
        arrangement.lofiPhraseInteractionPlan,
        suppliedLofiLeadScorePlan,
      ); // MG seed=song seed · lead program=器配生效值 · ★ Phase D:lead feel 真源 = 选中 GrooveContract(全 MG-backed 风格)
  const leadTrack = generatedLeadPerformance.track;
  const generatedAcgPianoPedalScore = generatedLeadPerformance.acgPianoPedalScore;
  // LOFI's score realizer has already consumed the concrete lead range before
  // NoteIR. Do not silently octave-fold a score-owned melodic contour here.
  const fittedLeadTrack = isScoreOwnedLofiLead
    ? leadTrack
    : fitLeadTrackToInstrumentSections(leadTrack, arrangement, instrumentation, timebase);
  tracks.push(fittedLeadTrack);
  if (inLineup('drum') && (!hasResolvedRoleLayout || drumActiveSectionIds.size > 0)) {
    tracks.splice(drumTrackInsertIndex, 0, renderDrums(plan, timebase, beatsPerBarOf(arrangement.meter), {
      style: band.style,
      tempoBpm: arrangement.tempoBpm,
      fillBars: drumFillBars,
      bigFillBars: drumBigFillBars,
      textureSchedule,
      patternBySection: instrumentation.drumPatternBySection,
      patternBySectionBar: instrumentation.drumPatternBySectionBar,
      performanceBySection: arrangement.drumPerformanceBySection,
      grooveScorePlan: arrangement.grooveScorePlan,
      deferPerformanceRealization: true,
    }));
  }

  // ★ Loop 5:LOFI dense melody comping(MG post-mix shaper)—— 旋律密集的和弦区间删 comp、bass 减到 1 个让路。
  //   只改 comp/bass(strict parity:lead 绝不碰)。在分轨生成后、gate/audit 前。
  const postMixTracks = band.style.toLowerCase() === 'lofi' && !arrangement.lofiFoundationPlan
    ? applyMgLofiDenseMelodyComping(tracks, plan, timebase)
    : tracks;

  // 先修复源段 lead 空拍、再复用 repeat body；此时尚未施加首段 opening gate，避免
  // “开场延迟/缺席”被当作 motif body 复制到后续 verse/chorus。replay 仍在 dynamics 之前。
  const gapFilledTracks = isAcg || isScoreOwnedLofiLead || preserveArrangerLeadRests
    ? postMixTracks
    : fillLeadBarGaps(postMixTracks, plan.chordTimeline, timebase, beatsPerBarOf(arrangement.meter));
  const motifReplayedTracks = resolvedArchetype?.motifPolicyId === MOTIF_POLICY_REPEAT_GROUP
    ? isScoreOwnedLofiLead
      ? transformScoreUnownedTracks(gapFilledTracks, (tracks) => applyMotifBindingReplay(tracks, arrangement, plan.chordTimeline, timebase))
      : applyMotifBindingReplay(gapFilledTracks, arrangement, plan.chordTimeline, timebase)
    : gapFilledTracks;
  // ACG 的主旋律已按整曲 RoadMap + 当下和声一次实化；把旧 phrase NoteIR 复制到
  // 新和弦上会绕过 stable/scale contract，随后只能依赖末端修音。ACG 因此不再 replay
  // 成品 lead，重复感由上游 RoadMap / grammar 的同一结构而非 NoteIR 后拷贝承担。
  const replayedBaseTracks = isAcg
    ? motifReplayedTracks
    : isScoreOwnedLofiLead
      ? transformScoreUnownedTracks(motifReplayedTracks, (tracks) => applyRepeatGroupReplay(tracks, arrangement, plan.chordTimeline, timebase))
      : applyRepeatGroupReplay(motifReplayedTracks, arrangement, plan.chordTimeline, timebase);
  const replayedTracks = replayedBaseTracks;

  // ★ A2 编曲密度弧:activeRolesBySection 是所有角色(含 lead)的真实在场真源，
  //   replay 后只 gate 一次，让每个目标段按自己的 active/opening/performance 合同重投影。
  // ★ Loop E:transitionPlan 的 lead-in pickup → prepBar 内授权角色保护窗口(不被上一段 gate 删除)。
  const barTicksGate = beatsPerBarOf(arrangement.meter) * timebase.ppq;
  const pickupWindows = instrumentation.transitionPlan.boundaries
    .filter((b) => b.protectPickupFromGate && b.pickupRoles.length > 0)
    .map((b) => ({ lo: b.prepBar * barTicksGate, hi: (b.prepBar + 1) * barTicksGate, roles: new Set<string>(b.pickupRoles as readonly string[]) }));
  const gatedTracks = transformScoreUnownedTracks(replayedTracks, (tracks) => gateByDensity(tracks, plan, timebase, instrumentation.activeRolesBySection, {
    pickupWindows,
    rolePerformanceBySection: arrangement.rolePerformanceBySection,
    openingGesture: arrangement.openingGesture,
    forceImmediateOpeningRoles: isAcg ? new Set<TrackIR['role']>(['bass']) : undefined,
    preserveLeadTiming: !!overrideLeadTrack,
    preserveLeadPresence: !!acgLeadPresencePlan || isScoreOwnedLofiLead,
    patternOwnedRoleSections: timedRoleSections,
  }));
  const grooveProjectedTracks = transformScoreUnownedTracks(
    gatedTracks,
    (tracks) => applyGrooveScoreProjection(
      tracks,
      arrangement.grooveScorePlan,
      timebase.ppq,
      beatsPerBarOf(arrangement.meter),
      // MG owns final lead touch. Its section GrooveContract is consumed while
      // melody events still exist; a second NoteIR velocity pass breaks replay parity.
      // Timed role cells already carry their source accent hierarchy. The bar
      // score still owns their placement, but must not reinterpret those
      // authored velocities through a second generic metric curve.
      new Set(['lead', ...timedRoleNames]),
    ),
  );

  // Accompaniment → OccupationMap → Resolver(best-effort)→ 单点 freeze → Auditor
  // Accompaniment collision/ducking sees the authored motif as occupancy, but
  // the user notes themselves stay outside every generic lead transform.
  const interactionContextTracks = authoredUserMotifPlan
    ? withAuthoredLeadContext(grooveProjectedTracks)
    : grooveProjectedTracks;
  const occupation = buildOccupationMap(interactionContextTracks, reserved);
  const draft: MusicalIRData = {
    tracks: interactionContextTracks,
    timebase,
    durationTicks: ticks(totalDurationTicks(plan, timebase)),
  };
  const protectedCompFoundationKeys = new Set(plan.chordTimeline
    .filter((span) => foundationRoleBySection[span.sectionId] === 'comp')
    .map((span) => {
      const startTick = timebase.beatToTick(span.startBeat) as number;
      const foundationPc = ((span.bassPc ?? span.rootPc) as number) % 12;
      return `${startTick}:${(foundationPc + 12) % 12}`;
    }));
  const leadCompSameProgram = instrumentation.roleProgram.lead === instrumentation.roleProgram.comp
    || !!instrumentation.sameInstrumentPairs?.some((pair) =>
      ((pair.a === 'lead' && pair.b === 'comp') || (pair.a === 'comp' && pair.b === 'lead')));
  const forbidLeadCompUnison = arrangement.leadCompCollisionPolicy === 'no-unison-when-same-program'
    && leadCompSameProgram;
  // ACG has already placed the lead above a pre-voiced middle register in
  // PianoScorePlan, so it must not run generic m2/m9 comp thinning. Exact
  // same-program unison is still a role-collision contract and remains active.
  const contextResolved = resolveInteractions(draft, occupation, {
    protectedCompFoundationKeys,
    forbidLeadCompUnison,
    thinCompMelodyClashes: !isAcg && !arrangement.lofiFoundationPlan,
  });
  const resolved = authoredUserMotifPlan
    ? {
      ...contextResolved,
      data: {
        ...contextResolved.data,
        tracks: restoreGeneratedLead(contextResolved.data.tracks, grooveProjectedTracks),
      },
    }
    : contextResolved;

  // dynamics:力度随段落能量(chorus 强 / intro 弱 / 高潮峰)
  const energyRanges: EnergyRange[] = [];
  let dynCursor = 0;
  const bpbDyn = beatsPerBarOf(arrangement.meter);
  const climaxIntensityBySection = new Map<string, number>();
  for (const climax of arrangement.climaxMap) {
    const current = climaxIntensityBySection.get(climax.sectionId) ?? 0;
    climaxIntensityBySection.set(climax.sectionId, Math.max(current, Math.max(0, Math.min(1, climax.intensity))));
  }
  for (const s of arrangement.sections) {
    const baseEnergy = arrangement.energyBySection[s.id] ?? 0.5;
    const climaxIntensity = climaxIntensityBySection.get(s.id) ?? 0;
    const energy = Math.min(1, baseEnergy + climaxIntensity * 0.12);
    energyRanges.push({ lo: dynCursor, hi: dynCursor + s.bars * bpbDyn, energy });
    dynCursor += s.bars * bpbDyn;
  }
  // ★ 伴奏 ducking:comp 撞旋律时【极轻压 ×0.9】(只给旋律一点空间,不把 comp 压下去)。
  //   用户要 lead/伴奏均衡 → ducking 放轻(重压会和'均衡'相反);均衡主要靠 CC7 推子压平。
  // ACG comp dynamics are authored at score time and normalized by the
  // dedicated ACG dynamics pass below.  Do not add a second, lead-dependent
  // velocity carve after the piano score has been written.
  const duckingContextTracks = authoredUserMotifPlan
    ? withAuthoredLeadContext(resolved.data.tracks)
    : resolved.data.tracks;
  const duckedContextTracks = isAcg
    ? duckingContextTracks
    : duckUnderLead(duckingContextTracks, 0.9);
  const duckedTracks = authoredUserMotifPlan
    ? restoreGeneratedLead(duckedContextTracks, resolved.data.tracks)
    : duckedContextTracks;
  // ACG phrase energy is an output-touch concern owned by its dedicated piano
  // normalizer below.  Do not first apply the generic section-energy rewrite
  // to its scored hands and then attempt to compensate afterwards.
  const dynamicTracks = transformScoreUnownedTracks(
    duckedTracks,
    (tracks) => applyDynamics(tracks, energyRanges, timebase.ppq),
  );

  // ★ 段落边界手势(Arranger 下发 → 器配 endingPlan / entryBySection 投影):
  //   收尾 cold button / fade 渐弱+错退 / tag 末和弦延留;lead-in 跃升段前末小节 crescendo 推进下拍。
  const bpbEdge = beatsPerBarOf(arrangement.meter);
  const endedTracks = transformScoreUnownedTracks(
    dynamicTracks,
    (tracks) => applyEnding(tracks, arrangement, instrumentation.endingPlan, timebase.ppq, bpbEdge),
  );
  const ledTracks = transformScoreUnownedTracks(
    endedTracks,
    (tracks) => applyLeadIns(tracks, leadInBars, timebase.ppq, bpbEdge),
  );

  // ★ comp 去拖拍(2026-06-23,用户:632219 verse comp 比 bass/drum 八分 groove 滞后):直拍风格下,把 comp 落在
  //   【拍内弱 16 分 .25/.75(拖在八分后)】的 onset 吸回前一个八分(去拖拍,锁鼓/bass 强弱);.0(beat)/.5(and)
  //   等【有意切分】不动。只 comp;swung 风格(jazz/blues)整轨跳过(loose 是 feel)。
  const straightFeel = arrangement.feel.swingRatio <= 0.5 + 1e-6;
  // ACG comp timing is already authored by PianoScorePlan → texture renderer
  // (including rolls, answers and suspended arrivals).  The generic straight
  // feel snap is a legacy correction for non-ACG laid-back comping; applying
  // it here would rewrite those planned piano gestures after NoteIR exists.
  const grooveTracks = straightFeel && !isAcg
    ? ledTracks.map((t) => (t.role === 'comp' ? snapCompLaidback(t, timebase.ppq) : t))
    : ledTracks;

  // 人性化(5.3):力度 metric accent + 微随机(鼓除外,保 groove)→ swing → 微时序抖动
  const bpbHuman = beatsPerBarOf(arrangement.meter);
  const humanRng = rng.substream('humanize');
  const velocityHumanizeByBar = new Map<number, number>();
  for (const sectionScore of Object.values(arrangement.grooveScorePlan.bySection)) {
    const rawAmount = arrangement.grooveContractBySection[sectionScore.sectionId]?.velocityHumanize
      ?? arrangement.songGrooveContract.velocityHumanize;
    // In LOFI, the phrase score is the audible dynamic backbone. Per-note
    // variation remains a quiet residual and cannot rival the 4-bar arc.
    const amount = band.style.toLowerCase() === 'lofi'
      ? Math.min(rawAmount, 0.035)
      : rawAmount;
    for (const bar of sectionScore.bars) velocityHumanizeByBar.set(bar.absoluteBar, amount);
  }
  const velocityHumanizeForTick = (tick: number): number =>
    velocityHumanizeByBar.get(Math.max(0, Math.floor(tick / (timebase.ppq * bpbHuman))))
    ?? arrangement.songGrooveContract.velocityHumanize;
  // ACG's three piano hands share score-authored touch.  Its dedicated
  // normalizer below is the only allowed post-score velocity pass; generic
  // humanize would otherwise perturb a planned dyad/roll independently.
  const accentedTracks = isAcg
    ? grooveTracks.map((track) => {
      if (isScoreOwnedAcgPianoRole(track.role)) return track;
      return humanizeVelocity([track], timebase.ppq, bpbHuman, humanRng, arrangement.songGrooveContract.beatGrouping, velocityHumanizeForTick)[0]!;
    })
    : isScoreOwnedLofiLead
      ? (() => {
        const unowned = humanizeVelocity(
          grooveTracks.filter((track) => track.role !== 'lead'),
          timebase.ppq,
          bpbHuman,
          humanRng,
          arrangement.songGrooveContract.beatGrouping,
          velocityHumanizeForTick,
        );
        let index = 0;
        return grooveTracks.map((track) => track.role === 'lead' ? track : unowned[index++]!);
      })()
    : timedRoleNames.size === 0
      ? humanizeVelocity(grooveTracks, timebase.ppq, bpbHuman, humanRng, arrangement.songGrooveContract.beatGrouping, velocityHumanizeForTick)
      : grooveTracks.map((track) => timedRoleNames.has(track.role)
        ? track
        : humanizeVelocity([track], timebase.ppq, bpbHuman, humanRng, arrangement.songGrooveContract.beatGrouping, velocityHumanizeForTick)[0]!);

  // feel:swing 落地。GrooveContract 同时声明 rhythm source grid：
  // straight-eighths / straight-sixteenths 才 warp；authored triplet 不二次摆动。
  // ACG score onsets (including off-grid dyad replies and arpeggio steps) are
  // absolute score positions.  Its scheduler/score owns any feel choice;
  // never apply a second whole-track swing warp after realization.
  const swungTracks = transformScoreUnownedTracks(
    accentedTracks,
    (tracks) => applySwingBySection(
      tracks,
      timebase.ppq,
      bpbHuman,
      arrangement.songGrooveContract,
      arrangement.grooveContractBySection,
      arrangement.grooveScorePlan,
      arrangement.tempoBpm,
    ),
  );
  const auditKeyCtx: AuditKeyContext = {
    keyRootPc: band.key,
    globalMode: band.mode,
    isModalContext: band.tonalityKind === 'modal',
    scaleName: band.modalModeName,
    tonalCharacter: band.tonalityKind === 'modal' ? 'modal' : 'tonal',
  };
  // Pitch/duration owners continue below; the single authoritative lead contract resolver runs
  // after gesture shaping and user-motif restoration, immediately before final mix/audit.
  const harmonySafeTracks = swungTracks;

  // ★ Loop F 结构锚点:段落起始 tick + 曲首 0 + 末主音下拍(末和弦起) → humanizeTiming 对这些 tick 不做负向 jitter。
  const anchorTicks = new Set<number>([0]);
  let anchorCursor = 0;
  for (const s of arrangement.sections) {
    anchorTicks.add(timebase.beatToTick(beats(anchorCursor)) as number);
    anchorCursor += s.bars * bpbHuman;
  }
  if (plan.chordTimeline.length) anchorTicks.add(timebase.beatToTick(plan.chordTimeline[plan.chordTimeline.length - 1].startBeat) as number);

  // 微时序抖动:swing/审计之后,人手不踩死网格(±少量 tick)→ 最终可听 IR
  // ★ 槽位共享 + metric 缩放:同 tick 跨声部同偏移(对拍不散)、下拍近锚定(重心稳)。结构锚点不负偏(Loop F)。
  // ★ §7.4:GrooveContract 有 ms pocket → pocket-handled 角色(bass;lead 本就跳 humanizeTiming)改由
  //   applyGroovePocket 拥有时序(不双重)。Phase D 起全 MG-backed 风格 contract 有真 pocket;legacy(BLUES/无 rng)pocket=0 → pocketSkip 空 → 不变。
  const pocketContracts = [arrangement.songGrooveContract, ...Object.values(arrangement.grooveContractBySection)];
  const pocketSkip = pocketedRolesForContracts(pocketContracts);
  // PianoScorePlan owns all ACG comp/bass onset placement (including roll
  // offsets and root anchors); lead timing is owned by the token scheduler.
  // Skip the trio as a unit rather than letting generic micro-jitter move two
  // hands after the score has already coordinated them.
  const timingSkip = isAcg
    ? new Set<string>([...pocketSkip, ...scoreOwnedAcgPianoRoles, ...timedRoleNames, 'drum'])
    : isScoreOwnedLofiLead
      ? new Set<string>([...pocketSkip, ...timedRoleNames, 'drum', 'lead'])
    : new Set<string>([...pocketSkip, ...timedRoleNames, 'drum']);
  const humanizedRaw = humanizeTiming(harmonySafeTracks, timebase.ppq, bpbHuman, humanRng, undefined, anchorTicks, timingSkip, arrangement.songGrooveContract.beatGrouping);
  // ★ MG full-parity Phase D:band 的 melody-pocket 只施给 MG 生成的 lead;走 A(motif sandbox override)lead 自带
  //   权威 hand-played timing(directive §2.1:无 micro-IOI),不被 band groove pocket 覆盖 → excludeRoles 含 'lead'。
  // ACG 已在 scheduler 固定“休止结束 / arrival”的绝对拍位；不再把整条 lead
  // 交给末端 pocket 平移，避免跨进相邻和弦后再靠 resolver 修音。
  const pocketExclude = isAcg
    ? new Set<string>(acgPianoRoles)
    : isScoreOwnedLofiLead
      ? new Set<string>(['lead'])
    : overrideLeadTrack ? new Set(['lead']) : undefined;
  const humanizedTracks = applyGroovePocketBySection(
    humanizedRaw,
    arrangement.songGrooveContract,
    arrangement.grooveContractBySection,
    arrangement.grooveScorePlan,
    arrangement.tempoBpm,
    timebase.ppq,
    bpbHuman,
    pocketExclude,
  );
  // ★ Lead 最终安全闸(CODEX directive q_n_final_lead_sanitizer 2026-06-23):humanizeTiming/fillLeadBarGaps/swing/
  //   repeatReplay 这些末端变换会把上游已清洗的 lead 重新撞出【同 pitch overlap / 同 tick 重触发】→ 导出 MIDI 时
  //   旧 noteOff 提前关掉后一个同 pitch note(听感=motif/旋律突然断音或消失)。此前只有 jazz/blues 的 legato 分支顺带
  //   保护了,pop/lofi/rnb 完全跳过(实测 default pop 6/7 seed 有 overlap、走 A pop/lofi/rnb 也中招)。
  //   三步:① 全风格先 sanitize(给 legato 干净输入)② jazz/blues 接快速连音 legato ③ 全风格再 sanitize 作真正最终闸。
  //   sanitize 只裁【同 pitch】collision(不同 pitch overlap / legato 连奏保留),不改 pitch/start/数量(同 tick 同 pitch
  //   duplicate 合并除外)。对【所有 lead 轨】生效,不分来源(MG lead / 走 A override lead / 未来注入 lead)。
  const SANITIZE_OPTS = { gapTicks: 1, minDurTicks: 1 };
  const leadNoteSignature = (notes: readonly NoteIR[]): string[] => notes
    .map((note) => `${note.pitch as number}:${note.startTick as number}:${note.durationTicks as number}:${note.velocity}`)
    .sort();
  const sanitizeLead = (tracks: TrackIR[]): TrackIR[] => tracks.map((t) => {
    if (t.role !== 'lead') return t;
    const sanitized = sanitizeLeadNoteIR(t.notes, SANITIZE_OPTS);
    // A score-owned LOFI lead is already token-time monophonic. Sanitizing it
    // must be a pure identity check: silently shortening a carrier here would
    // recreate the very renderer-side repair the score architecture removes.
    if (isScoreOwnedLofiLead) {
      if (leadNoteSignature(sanitized).join('|') !== leadNoteSignature(t.notes).join('|')) {
        throw new Error('LofiLeadScorePlan emitted colliding NoteIR; refusing a late sanitizer rewrite');
      }
      return t;
    }
    return { ...t, notes: sanitized };
  });
  const preSanitized = sanitizeLead(humanizedTracks);
  const legatoOpts = isAcg || isScoreOwnedLofiLead
    ? { ...fastLeadLegatoOptionsForStyle(band.style, timebase.ppq), enabled: false }
    : fastLeadLegatoOptionsForStyle(band.style, timebase.ppq);
  const legatoTracks = legatoOpts.enabled
    ? preSanitized.map((t) => (t.role === 'lead' ? { ...t, notes: connectFastLeadNoteIR(t.notes, legatoOpts) } : t))
    : preSanitized;
  const articulatedTracks = sanitizeLead(legatoTracks); // 最终安全闸(legato/任何末端处理后都不留同 pitch collision)
  // ★ ACG PIANOSONG：lead 的“呼吸→回归”已在 RoadMap → scheduler → realizer 一次生成。
  // comp/bass 的中部手区、roll、根音与支撑预算也已经由 PianoScorePlan 在 NoteIR
  // 生成前下发；此处不再读取成品 lead 后 carve/删音/挪时值，避免形成第二条后处理链。
  const acgBarTicks = beatsPerBarOf(arrangement.meter) * timebase.ppq;
  // A user-supplied lead remains subject to the ordinary presence gate, but
  // that late gate must not feed back into the score-owned comp's touch curve.
  // Capture its original bar presence before gating; generated ACG lead keeps
  // the normal score-owned NoteIR-derived path below.
  const externalLeadPresenceBars = isAcg && !isScoreOwnedAcgPianoRole('lead')
    ? new Set((replayedTracks.find((track) => track.role === 'lead')?.notes ?? [])
      .map((note) => Math.floor((note.startTick as number) / acgBarTicks)))
    : undefined;
  const plannedTracks = articulatedTracks;
  const balancedTracksPreSanitize = isAcg
    ? (() => {
      const normalized = normalizeAcgDynamics(
        plannedTracks,
        acgBarTicks,
        arrangement.phraseBreathing.phraseBars,
        externalLeadPresenceBars,
      );
      return normalized.map((track, index) => isScoreOwnedAcgPianoRole(track.role) ? track : plannedTracks[index]!);
    })()
    : plannedTracks;
  // ACG lead 的时值和起音由 RoadMap → scheduler → realizer 独占。即使未来 legato
  // 配置被调整，也不能在这里把短趋近/稳定到达拖进下一和弦；只保留无创的同音碰撞安全闸。
  const balancedTracksLegato = isAcg || isScoreOwnedLofiLead
    ? balancedTracksPreSanitize
    : balancedTracksPreSanitize.map((t) => (
        t.role === 'lead' ? { ...t, notes: connectFastLeadNoteIR(t.notes, legatoOpts) } : t
      ));
  const balancedTracks = sanitizeLead(balancedTracksLegato);
  // ★ 末步挂乐器音色:按器配的 programByRoleSection 落 program(初始)+ programChanges(段落切换)。
  //   段落起始 tick(累加 bars),变化点才发 programChange(同 channel = 同一乐手换声音)。
  const bpbProg = beatsPerBarOf(arrangement.meter);
  const sectionTicks: { id: string; tick: number }[] = [];
  let secBeatCursor = 0;
  for (const s of arrangement.sections) {
    sectionTicks.push({ id: s.id, tick: timebase.beatToTick(beats(secBeatCursor)) as number });
    secBeatCursor += s.bars * bpbProg;
  }
  const acgSharedPianoPedalCapable = (['bass', 'comp', 'lead'] as const).every((pianoRole) => {
    const pedal = instrumentation.pedalPlanByRole?.[pianoRole];
    return pedal?.playerGroup === 'shared-piano'
      && pedal.timingOwner === 'arranger-piano-score'
      && arrangement.sections.every((section) => pedal.authorizedSectionIds?.includes(section.id))
      && Object.keys(pedal.disabledBySection).length === 0;
  });
  const pedalEventsForRole = (role: TrackIR['role']): { atTick: Ticks; down: boolean }[] | undefined => {
    const plannedEvents = instrumentation.pedalPlanByRole?.[role]?.events ?? [];
    // ACG's Instrumentation plan is only the verified hardware-capability
    // gate. Musical timing comes from the pre-NoteIR three-hand score.
    if (isAcgPianoRole(role)) {
      if (!acgSharedPianoPedalCapable || !generatedAcgPianoPedalScore) return undefined;
      return generatedAcgPianoPedalScore.events.map((event) => ({
        atTick: ticks(timebase.beatToTick(beats(event.atBeat)) as number),
        down: event.down,
      }));
    }
    if (plannedEvents.length === 0) return undefined;
    return plannedEvents.map((event) => ({
      atTick: ticks(timebase.beatToTick(beats(event.atBeat)) as number),
      down: event.down,
    }));
  };
  const controllerEventsForRole = (role: TrackIR['role']): { atTick: Ticks; controller: number; value: number }[] | undefined => {
    const plannedEvents = instrumentation.controllerPlanByRole?.[role]?.events ?? [];
    if (plannedEvents.length === 0) return undefined;
    return plannedEvents.map((event) => ({
      atTick: ticks(timebase.beatToTick(beats(event.atBeat)) as number),
      controller: event.controller,
      value: event.value,
    }));
  };
  const mixAttachedTracks = balancedTracks.map((t) => {
    const bySection = instrumentation.programByRoleSection[t.role];
    const bankBySection = instrumentation.bankByRoleSection?.[t.role];
    const mixBySection = instrumentation.mixByRoleSection?.[t.role];
    const fallback = instrumentation.roleProgram[t.role] ?? band.roleProgram[t.role]; // ★ 单一真源:器配生效 program
    const fallbackBank = instrumentation.roleBank?.[t.role];
    const pedalEvents = pedalEventsForRole(t.role);
    const plannedControllerEvents = controllerEventsForRole(t.role);
    // ★ program + 混音【单遍】投影(段边界):程序变 → 必带 CC 刷新(directive:每个 programChange 边界发匹配 CC);
    //   或混音本身变(关系型护栏 per-section 差异)→ 也刷新。二者同 tick 耦合 → irToMidi 只读 IR。
    let initialProgram = fallback;
    let initialBank: number | undefined = undefined;
    let initialMix: TrackMix | undefined;
    let prevProgram: number | undefined;
    let prevBank: number | undefined;
    let prevMix: RoleMix | undefined;
    const programChanges: { atTick: Ticks; program: number; bank?: number }[] = [];
    const mixChanges: { atTick: Ticks; mix: TrackMix }[] = [];
    for (const { id, tick } of sectionTicks) {
      const prog = bySection?.[id] ?? fallback;
      const bank = t.role === 'drum' ? undefined : (bankBySection?.[id] ?? fallbackBank);
      const m = mixBySection?.[id];
      if (prevProgram === undefined) {
        initialProgram = prog; prevProgram = prog;
        initialBank = bank; prevBank = bank;
        initialMix = m; prevMix = m;
        continue;
      }
      const progChanged = prog !== prevProgram;
      const bankChanged = bank !== prevBank;
      const mixChanged = !!m && (!prevMix || !sameMix(m, prevMix));
      if (progChanged || bankChanged) {
        programChanges.push({ atTick: ticks(tick), program: prog, bank: bankChanged || (bank !== undefined && bank !== 0) ? bank : undefined });
        prevProgram = prog;
        prevBank = bank;
      }
      if (m && (progChanged || bankChanged || mixChanged)) { mixChanges.push({ atTick: ticks(tick), mix: m }); prevMix = m; }
    }
    const programForSection = (sectionId: string) => bySection?.[sectionId] ?? fallback;
    const sectionIdForTick = (tick: number): string => {
      let current = sectionTicks[0]?.id ?? arrangement.sections[0]?.id ?? '';
      for (const section of sectionTicks) {
        if (tick < section.tick) break;
        current = section.id;
      }
      return current;
    };
    const rangeFittedNotes = t.role === 'drum' || (isScoreOwnedLofiLead && t.role === 'lead')
      ? t.notes
      : t.notes.map((note) => {
          const program = programForSection(sectionIdForTick(note.startTick as number));
          const programFitted = fitMidiToProgramRange(note.pitch as number, t.role, program);
          const strictRange = instrumentation.strictRegisterByRole?.[t.role];
          const fitted = strictRange ? fitMidiToStrictRegister(programFitted, strictRange) : programFitted;
          return fitted === note.pitch ? note : { ...note, pitch: midi(fitted) };
        });
    const notesForGesture = rangeFittedNotes;
    // ★ 手势表情层:器配层据最终音色下发 sax/pipe-wind 等 gesture plan;render 只执行计划。
    // ACG PIANOSONG's lead, comp and bass are three hands of the same scored
    // piano.  Bypass gesture NoteIR shaping for all of them: keyboard gates,
    // electric-key tails and bass techniques would otherwise alter a planned
    // duration/velocity after PianoScorePlan.  The score-owned pedal plan is
    // attached below, so this keeps the needed MIDI expression intact.
    const gestureTrack = {
      ...t,
      notes: notesForGesture,
      program: initialProgram,
      programChanges: programChanges.length ? programChanges : undefined,
    };
    // A timed role pattern owns onset, release and reference touch as one
    // authored gesture. Generic instrument gates (Jazz Comp = 0.72, keyboard
    // Bass = 0.96) would otherwise silently rewrite the MIDI-derived cell
    // after every phase test had already passed.
    const gesture = t.role === 'drum' || isAcgPianoRole(t.role)
      || (isScoreOwnedLofiLead && t.role === 'lead') || timedRoleNames.has(t.role)
      ? { notes: notesForGesture }
      : applyGestureExpressionToTrack(gestureTrack, instrumentation.gestureExpressionByRole?.[t.role], timebase);
    // CC72/74 等 Sound Controller 未经板端标定仍不可写。这里仅合并器配层已按
    // 完整 CC0+Program 能力下发的原声钢琴 CC11 计划与既有手势事件。
    const rawCcEvents = [...(gesture.ccEvents ?? []), ...(plannedControllerEvents ?? [])]
      .sort((a, b) => (a.atTick as number) - (b.atTick as number) || a.controller - b.controller);
    const ccEvents: typeof rawCcEvents = [];
    for (const event of rawCcEvents) {
      const previous = ccEvents[ccEvents.length - 1];
      if (previous && previous.atTick === event.atTick && previous.controller === event.controller) ccEvents[ccEvents.length - 1] = event;
      else ccEvents.push(event);
    }
    const pitchBendEvents = gesture.pitchBendEvents?.length ? gesture.pitchBendEvents : undefined;
    return {
      ...t,
      notes: gesture.notes,
      program: initialProgram,
      bank: initialBank,
      programChanges: programChanges.length ? programChanges : undefined,
      pedalEvents,
      mix: initialMix,
      mixChanges: mixChanges.length ? mixChanges : undefined,
      ccEvents: ccEvents.length ? ccEvents : undefined,
      pitchBendEvents,
    };
  });
  const finalCompNotes = mixAttachedTracks.find((t) => t.role === 'comp')?.notes ?? [];
  const finalLeadProgramForSection = (sectionId: string): number | undefined =>
    instrumentation.programByRoleSection.lead?.[sectionId]
    ?? instrumentation.roleProgram.lead
    ?? band.roleProgram.lead;
  const contractResolvedGeneratedTracks = mixAttachedTracks.map((track) => {
    if (track.role !== 'lead') return track;
    // ACG 的 harmonic arrival 已在主链锁定；这里只保留 collision sanitizer，
    // 不让末端 resolver 再改写已计划的 targetPc / approach。
    const resolvedNotes = isAcg || isScoreOwnedLofiLead ? track.notes : leadAvoidExposureResolver(
      track.notes,
      plan,
      timebase,
      finalLeadProgramForSection,
      finalCompNotes,
      auditKeyCtx,
    );
    // The harmony resolver may split notes or converge neighbours onto one pitch after the
    // earlier safety pass. Reuse the authoritative sanitizer once more before final audit/MIDI.
    return { ...track, notes: sanitizeLeadNoteIR(resolvedNotes, SANITIZE_OPTS) };
  });
  // The authored motif enters the audible lead exactly once, after all generic
  // pitch/range/gesture transforms and before Drum follow/audit/MIDI export.
  const contractResolvedTracks = authoredUserMotifPlan
    ? withAuthoredLeadContext(contractResolvedGeneratedTracks)
    : contractResolvedGeneratedTracks;
  const followedTracks = applyFinalDrumFollow(contractResolvedTracks, {
    beatsPerBar: beatsPerBarOf(arrangement.meter),
    ppq: timebase.ppq,
    grooveScorePlan: arrangement.grooveScorePlan,
    performanceBySection: arrangement.drumPerformanceBySection,
    activeDrumSectionIds: drumActiveSectionIds,
    followSources: {
      bass: {
        notes: contractResolvedTracks.find((track) => track.role === 'bass')?.notes ?? [],
        activeSectionIds: bassActiveSectionIds,
      },
      comp: {
        notes: contractResolvedTracks.find((track) => track.role === 'comp')?.notes ?? [],
        activeSectionIds: compActiveSectionIds,
      },
      lead: {
        notes: contractResolvedTracks.find((track) => track.role === 'lead')?.notes ?? [],
        activeSectionIds: leadActiveSectionIds,
      },
    },
  });
  // The Jazz 5/4 compiler owns every Bass/Comp/Drum musical event. Replace the
  // legacy provisional tracks at one explicit seam, then make Drum performance
  // transparent. No later stage may change the score event multiset.
  const scoreProjectedTracks = projectJazzFiveFourScoreTracks(followedTracks, suppliedJazzFiveFourScorePlan);
  const drumRealizedTracks = scoreProjectedTracks.map((track) => realizeDrumPerformanceTrack(track, {
    timebase,
    beatsPerBar: beatsPerBarOf(arrangement.meter),
    tempoBpm: arrangement.tempoBpm,
    grooveScorePlan: arrangement.grooveScorePlan,
    performanceBySection: arrangement.drumPerformanceBySection,
    performanceMode: suppliedJazzFiveFourScorePlan ? 'reference-zero' : 'profiled',
  }));
  const finalTracks = applyRenderMixBalance(drumRealizedTracks, {
    style: band.style,
    ppq: timebase.ppq,
    durationTicks: resolved.data.durationTicks as number,
    sectionTicks: sectionTicks.map((s) => s.tick),
  });
  if (suppliedJazzFiveFourScorePlan) {
    assertJazzFiveFourProjectionIdentity(finalTracks, suppliedJazzFiveFourScorePlan);
  }
  const ir = freezeMusicalIR({ tracks: finalTracks, timebase, durationTicks: resolved.data.durationTicks });
  // Reference-quartet production is fail-closed at the final boundary.  The
  // full Gate G checks clock/tempo, canonical phase+gate+velocity, timing
  // links, bar drift and Score -> FinalIR identity; it never repairs output.
  if (suppliedJazzFiveFourScorePlan) {
    assertJazzFiveFourGrooveMatch(suppliedJazzFiveFourScorePlan, ir);
  }
  // ★ ACG comp 硬合同(acg_comp_track_hard_contract §5.2,fail-closed):ACG 必须有独立 lead + comp(有音符)
  //   两条轨,即便同用 GM0 也不能塌成 lead-only。band 层 hardRequiredRolesForStyle 已保证 comp 入 lineup;
  //   此处是最后防线 —— 若 ACG 到 render 仍缺 comp,抛不变量(宁失败也不静默降级)。
  if (band.style.toLowerCase() === 'acg') {
    const compT = ir.tracks.find((t) => t.role === 'comp');
    const leadT = ir.tracks.find((t) => t.role === 'lead');
    if (!leadT || !compT || compT.notes.length === 0) {
      throw new Error(`ACG comp hard-contract violated: lead=${!!leadT} comp=${!!compT} compNotes=${compT?.notes.length ?? 0}`);
    }
  }
  // 最终和声审计必须覆盖所有 pitch/onset/duration 变换，以及最后恢复的 user motif quote。
  // Auditor 自己使用结构网格容差处理微时序；这里不再审一个随后会被改写的中间 IR。
  const harmonyAudit = auditHarmony(ir, plan, timebase, auditKeyCtx, authoredLeadSpans(authoredUserMotifPlan));
  // ★ Loop H:音乐性审计(只读 warning)追加进 audit。GenerationController 仅 error/fatal 重跑 → warning 接受不重跑。
  // dense 区间用【pre-shaper tracks】算(post-shaper comp 已删→comp-path 检不到);comp-continuity 审计据此排除。
  // ★ repeatGroup 重放后:dense-melody 排除区也要按【重放后】的 lead 位置算(重复段 lead=首段 → dense 区随之搬到首段位置;
  //   否则用原始 through-composed lead 的旧 dense 区会与重放后的 comp 删除区错位 → 误报 comp 突发洞)。
  const denseExclude = band.style.toLowerCase() === 'lofi'
    ? denseMelodySpanRanges(gatedTracks, plan, timebase)
    : [];
  const scoreOwnedCompSilence = isAcg
    ? scoreOwnedAcgCompSilenceRanges(acgPianoScorePlan, plan, timebase)
    : [];
  const musicality = auditMusicality(
    ir,
    arrangement,
    instrumentation,
    timebase,
    band.style,
    denseExclude,
    scoreOwnedCompSilence,
    !!acgPianoScorePlan,
  );
  // ★ Phase 7:render 把【自己消费的完整 intent】(含 ACG acgBarFamilyBySpan enforce)挂 report → 服务层不再重派生(消双源 + 修 audit gap)。
  return { ir, audit: { findings: [...harmonyAudit.findings, ...musicality.findings], textureCases: [...new Set(Object.values(textureSchedule))], texturePerBar: plan.chordTimeline.map((s) => textureSchedule[s.id] ?? '—'), intent: summarizeMusicIntent(intent) } };
}
