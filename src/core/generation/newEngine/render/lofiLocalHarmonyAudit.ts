// ============================================================
// newEngine · render · LOFI Local Harmony Audit (read-only)
// ------------------------------------------------------------
// Audits two score-time authors without changing either:
//   1. final score-time melody-grammar terminals before NoteIR;
//   2. final Comp/Pad texture notes against the chord span that authored them.
// The audit distinguishes legal passing motion from structural chord tones,
// and ignores only sub-eighth boundary leakage caused by human timing.
// ============================================================

import { mod12, ticks, type DeepReadonly, type Timebase } from '../foundation';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { MusicalIR } from '../ir/MusicalIR';
import type { TokenKind } from '../knowledge/melodyGrammarTypes';
import { chordTypeIntervals } from '../knowledge/chords';
import type { MgNoteEvent } from './mgMelodyRealizer';

export type LofiLocalHarmonyFindingKind =
  | 'grammar-structural-outside-contract'
  | 'grammar-fill-outside-local-scale'
  | 'grammar-approach-unresolved'
  | 'grammar-long-cross-chord-exposure'
  | 'texture-attack-outside-local-chord'
  | 'texture-long-cross-chord-exposure';

export interface LofiLocalHarmonyFinding {
  kind: LofiLocalHarmonyFindingKind;
  role: 'grammar' | 'comp' | 'pad';
  beat: number;
  durationBeats: number;
  pitch: number;
  pitchClass: number;
  chordSpanId: string;
  chordRootPc: number;
  chordType: string;
  allowedPitchClasses: number[];
  realizerAdmissionPitchClasses?: number[];
  sourcePrototypeId?: string;
  tokenKind?: TokenKind;
  reason: string;
}

export interface GrammarLocalHarmonyMetrics {
  totalEvents: number;
  conformingOnsets: number;
  onsetConformanceRate: number;
  structuralEvents: number;
  structuralConformanceRate: number;
  fillEvents: number;
  fillConformanceRate: number;
  approachEvents: number;
  resolvedApproaches: number;
  localFallbackApproaches: number;
  approachConformanceRate: number;
  longCrossChordExposureCount: number;
  findings: LofiLocalHarmonyFinding[];
}

export interface TextureRoleHarmonyMetrics {
  role: 'comp' | 'pad';
  totalNotes: number;
  conformingAttacks: number;
  attackConformanceRate: number;
  longCrossChordExposureCount: number;
  findings: LofiLocalHarmonyFinding[];
}

const EPSILON = 1e-6;
const APPROACH_PAIR_TOLERANCE_BEATS = 0.04;
const HUMANIZED_BOUNDARY_TOLERANCE_BEATS = 0.16;
const LONG_EXPOSURE_BEATS = 0.5;
const STRUCTURAL_TOKENS = new Set<TokenKind>(['C', 'G', 'B', 'Triadic']);
const FILL_TOKENS = new Set<TokenKind>(['S', 'L', 'H', 'X', 'Slope']);

function asNumberSet(values: readonly number[] | undefined): Set<number> {
  return new Set((values ?? []).map((value) => mod12(value) as number));
}

function localSets(plan: HarmonicPlan, span: DeepReadonly<ChordSpan>): {
  scale: Set<number>;
  avoid: Set<number>;
  structural: Set<number>;
} {
  const stable = asNumberSet(plan.stableToneMap[span.id]);
  const color = asNumberSet(plan.colorToneMap[span.id]);
  const scale = asNumberSet(plan.chordScaleMap[span.id]);
  const avoid = asNumberSet(plan.avoidNoteMap[span.id]);
  const contract = new Set<number>([...stable, ...color]);
  const admitted = [...contract].filter((pitchClass) =>
    !avoid.has(pitchClass) && (scale.size === 0 || scale.has(pitchClass)));
  return {
    scale,
    avoid,
    structural: new Set(admitted.length > 0
      ? admitted
      : [...contract].filter((pitchClass) => !avoid.has(pitchClass))),
  };
}

function spanAtBeat(
  plan: HarmonicPlan,
  beat: number,
): DeepReadonly<ChordSpan> | undefined {
  return plan.chordTimeline.find((span) =>
    beat >= (span.startBeat as number) - EPSILON
    && beat < (span.startBeat as number) + (span.durationBeats as number) - EPSILON)
    ?? plan.chordTimeline[plan.chordTimeline.length - 1];
}

function grammarOnsetIsLegal(
  plan: HarmonicPlan,
  event: MgNoteEvent,
  span: DeepReadonly<ChordSpan>,
): boolean {
  const pitchClass = mod12(event.noteNumber) as number;
  const { scale, avoid, structural } = localSets(plan, span);
  const kind = event.grammarTokenKind;
  if (!kind) return false;
  if (kind === 'B') {
    const explicitBass = span.bassRole === 'pedal' ? span.bassPedalPc : span.bassPc;
    return structural.has(pitchClass)
      || (explicitBass !== undefined && mod12(explicitBass) === pitchClass);
  }
  if (STRUCTURAL_TOKENS.has(kind)) {
    return structural.has(pitchClass);
  }
  if (FILL_TOKENS.has(kind) || kind === 'A') {
    return !avoid.has(pitchClass) && (scale.size === 0 || scale.has(pitchClass));
  }
  return true;
}

function laterLongIllegalExposure(
  plan: HarmonicPlan,
  startBeat: number,
  endBeat: number,
  pitchClass: number,
  onsetSpanId: string,
): DeepReadonly<ChordSpan> | undefined {
  return plan.chordTimeline.find((span) => {
    if (span.id === onsetSpanId) return false;
    const spanStart = span.startBeat as number;
    const spanEnd = spanStart + (span.durationBeats as number);
    const overlap = Math.min(endBeat, spanEnd) - Math.max(startBeat, spanStart);
    if (overlap < LONG_EXPOSURE_BEATS) return false;
    const { scale, avoid } = localSets(plan, span);
    return avoid.has(pitchClass) || (scale.size > 0 && !scale.has(pitchClass));
  });
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 1;
}

/**
 * Audit realized LOFI grammar events at their score-time layer. An A terminal
 * is accepted either as a literal semitone approach into an admitted target,
 * or as the Realizer's documented scale-tone fallback when it had no pair.
 */
export function auditLofiGrammarLocalHarmony(
  events: readonly MgNoteEvent[],
  plan: HarmonicPlan,
): GrammarLocalHarmonyMetrics {
  const melody = events
    .filter((event) => event.part === 'melody' && event.duration > 0 && event.grammarTokenKind)
    .slice()
    .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
  const findings: LofiLocalHarmonyFinding[] = [];
  let conformingOnsets = 0;
  let structuralEvents = 0;
  let structuralConforming = 0;
  let fillEvents = 0;
  let fillConforming = 0;
  let approachEvents = 0;
  let resolvedApproaches = 0;
  let localFallbackApproaches = 0;
  let longCrossChordExposureCount = 0;

  melody.forEach((event, index) => {
    const span = spanAtBeat(plan, event.time);
    if (!span) return;
    const kind = event.grammarTokenKind!;
    const pitchClass = mod12(event.noteNumber) as number;
    const basicLegal = grammarOnsetIsLegal(plan, event, span);
    let onsetLegal = basicLegal;

    if (STRUCTURAL_TOKENS.has(kind)) {
      structuralEvents += 1;
      if (basicLegal) structuralConforming += 1;
      else {
        findings.push({
          kind: 'grammar-structural-outside-contract',
          role: 'grammar',
          beat: event.time,
          durationBeats: event.duration,
          pitch: event.noteNumber,
          pitchClass,
          chordSpanId: span.id,
          chordRootPc: span.rootPc as number,
          chordType: span.chordType ?? String(span.quality),
          allowedPitchClasses: [...localSets(plan, span).structural].sort((a, b) => a - b),
          realizerAdmissionPitchClasses: event.localAdmissionPcs,
          sourcePrototypeId: span.sourcePrototypeId,
          tokenKind: kind,
          reason: `${kind} terminal is outside stable/color ∩ local scale`,
        });
      }
    } else if (kind === 'A') {
      approachEvents += 1;
      const next = melody[index + 1];
      const pairIsContiguous = !!next
        && Math.abs(next.time - (event.time + event.duration)) <= APPROACH_PAIR_TOLERANCE_BEATS;
      const nextSpan = next ? spanAtBeat(plan, next.time) : undefined;
      const nextTargetLegal = !!next && !!nextSpan && grammarOnsetIsLegal(plan, next, nextSpan);
      const resolvesBySemitone = !!next && Math.abs(next.noteNumber - event.noteNumber) === 1;
      const pairedResolution = pairIsContiguous && nextTargetLegal && resolvesBySemitone;
      if (pairedResolution) {
        resolvedApproaches += 1;
        onsetLegal = true;
      } else if (basicLegal) {
        localFallbackApproaches += 1;
      } else {
        onsetLegal = false;
        findings.push({
          kind: 'grammar-approach-unresolved',
          role: 'grammar',
          beat: event.time,
          durationBeats: event.duration,
          pitch: event.noteNumber,
          pitchClass,
          chordSpanId: span.id,
          chordRootPc: span.rootPc as number,
          chordType: span.chordType ?? String(span.quality),
          allowedPitchClasses: [...localSets(plan, span).structural].sort((a, b) => a - b),
          realizerAdmissionPitchClasses: event.localAdmissionPcs,
          sourcePrototypeId: span.sourcePrototypeId,
          tokenKind: kind,
          reason: `chromatic A terminal does not resolve by semitone into a locally admitted target; next=${next
            ? `${next.noteNumber}@${next.time}+${next.duration}/${next.grammarTokenKind ?? 'unknown'}`
            : 'none'}, contiguous=${pairIsContiguous}, targetLegal=${nextTargetLegal}, semitone=${resolvesBySemitone}`,
        });
      }
    } else if (FILL_TOKENS.has(kind)) {
      fillEvents += 1;
      if (basicLegal) fillConforming += 1;
      else {
        findings.push({
          kind: 'grammar-fill-outside-local-scale',
          role: 'grammar',
          beat: event.time,
          durationBeats: event.duration,
          pitch: event.noteNumber,
          pitchClass,
          chordSpanId: span.id,
          chordRootPc: span.rootPc as number,
          chordType: span.chordType ?? String(span.quality),
          allowedPitchClasses: [...localSets(plan, span).structural].sort((a, b) => a - b),
          realizerAdmissionPitchClasses: event.localAdmissionPcs,
          sourcePrototypeId: span.sourcePrototypeId,
          tokenKind: kind,
          reason: `${kind} fill terminal is outside the resolved local scale or lands on an avoid note`,
        });
      }
    }

    if (onsetLegal) conformingOnsets += 1;
    const later = laterLongIllegalExposure(
      plan,
      event.time,
      event.time + event.duration,
      pitchClass,
      span.id,
    );
    if (later) {
      longCrossChordExposureCount += 1;
      findings.push({
        kind: 'grammar-long-cross-chord-exposure',
        role: 'grammar',
        beat: event.time,
        durationBeats: event.duration,
        pitch: event.noteNumber,
        pitchClass,
        chordSpanId: later.id,
        chordRootPc: later.rootPc as number,
        chordType: later.chordType ?? String(later.quality),
        allowedPitchClasses: [...localSets(plan, later).scale].sort((a, b) => a - b),
        realizerAdmissionPitchClasses: event.localAdmissionPcs,
        sourcePrototypeId: later.sourcePrototypeId,
        tokenKind: kind,
        reason: 'grammar note sustains at least half a beat outside the following chord local scale',
      });
    }
  });

  return {
    totalEvents: melody.length,
    conformingOnsets,
    onsetConformanceRate: rate(conformingOnsets, melody.length),
    structuralEvents,
    structuralConformanceRate: rate(structuralConforming, structuralEvents),
    fillEvents,
    fillConformanceRate: rate(fillConforming, fillEvents),
    approachEvents,
    resolvedApproaches,
    localFallbackApproaches,
    approachConformanceRate: rate(
      resolvedApproaches + localFallbackApproaches,
      approachEvents,
    ),
    longCrossChordExposureCount,
    findings,
  };
}

function literalChordPcs(span: DeepReadonly<ChordSpan>): Set<number> {
  const values = chordTypeIntervals(span.chordType ?? String(span.quality))
    .map((interval) => mod12((span.rootPc as number) + interval) as number);
  if (span.bassPc !== undefined) values.push(mod12(span.bassPc) as number);
  return new Set(values);
}

function textureAllowedPcs(
  plan: HarmonicPlan,
  span: DeepReadonly<ChordSpan>,
  _role: 'comp' | 'pad',
): Set<number> {
  // The chord's literal spelling is always locally legal. The plan contract
  // then adds admitted 9/11/13 colors used by Comp/Pad texture vocabulary.
  return new Set([
    ...literalChordPcs(span),
    ...localSets(plan, span).structural,
  ]);
}

function spansNearHumanizedOnset(
  plan: HarmonicPlan,
  beat: number,
): DeepReadonly<ChordSpan>[] {
  const candidates = plan.chordTimeline.filter((span) => {
    const start = span.startBeat as number;
    const end = start + (span.durationBeats as number);
    return beat >= start - HUMANIZED_BOUNDARY_TOLERANCE_BEATS
      && beat < end + HUMANIZED_BOUNDARY_TOLERANCE_BEATS;
  });
  return candidates.length > 0 ? candidates : [spanAtBeat(plan, beat)].filter(
    (span): span is DeepReadonly<ChordSpan> => !!span,
  );
}

/** Audit Comp or Pad notes after rendering while discounting tiny timing jitter. */
export function auditLofiTextureLocalHarmony(
  ir: MusicalIR,
  plan: HarmonicPlan,
  timebase: Timebase,
  role: 'comp' | 'pad',
): TextureRoleHarmonyMetrics {
  const notes = ir.tracks.find((track) => track.role === role)?.notes ?? [];
  const findings: LofiLocalHarmonyFinding[] = [];
  let conformingAttacks = 0;
  let longCrossChordExposureCount = 0;

  for (const note of notes) {
    const beat = timebase.tickToBeat(note.startTick) as number;
    const durationBeats = (timebase.tickToBeat(note.durationTicks) as number);
    const endBeat = beat + durationBeats;
    const pitch = note.pitch as number;
    const pitchClass = mod12(pitch) as number;
    const temporalSpan = spanAtBeat(plan, beat);
    const futureJitterSpan = spansNearHumanizedOnset(plan, beat).find((span) =>
      (span.startBeat as number) > beat + EPSILON
      && (span.startBeat as number) - beat <= HUMANIZED_BOUNDARY_TOLERANCE_BEATS
      && textureAllowedPcs(plan, span, role).has(pitchClass));
    const authoredSpan = temporalSpan
      && textureAllowedPcs(plan, temporalSpan, role).has(pitchClass)
      ? temporalSpan
      : futureJitterSpan ?? temporalSpan;
    if (!authoredSpan) continue;
    const attackLegal = textureAllowedPcs(plan, authoredSpan, role).has(pitchClass);
    if (attackLegal) conformingAttacks += 1;
    else {
      findings.push({
        kind: 'texture-attack-outside-local-chord',
        role,
        beat,
        durationBeats,
        pitch,
        pitchClass,
        chordSpanId: authoredSpan.id,
        chordRootPc: authoredSpan.rootPc as number,
        chordType: authoredSpan.chordType ?? String(authoredSpan.quality),
        allowedPitchClasses: [...textureAllowedPcs(plan, authoredSpan, role)].sort((a, b) => a - b),
        sourcePrototypeId: authoredSpan.sourcePrototypeId,
        reason: `${role} attack is outside the local ${role === 'comp' ? 'literal chord spelling' : 'stable/color contract'}`,
      });
    }

    const illegalExposure = plan.chordTimeline.find((span) => {
      if (span.id === authoredSpan.id) return false;
      const start = span.startBeat as number;
      const end = start + (span.durationBeats as number);
      const overlap = Math.min(endBeat, end) - Math.max(beat, start);
      return overlap >= LONG_EXPOSURE_BEATS
        && !textureAllowedPcs(plan, span, role).has(pitchClass);
    });
    if (illegalExposure) {
      longCrossChordExposureCount += 1;
      findings.push({
        kind: 'texture-long-cross-chord-exposure',
        role,
        beat,
        durationBeats,
        pitch,
        pitchClass,
        chordSpanId: illegalExposure.id,
        chordRootPc: illegalExposure.rootPc as number,
        chordType: illegalExposure.chordType ?? String(illegalExposure.quality),
        allowedPitchClasses: [...textureAllowedPcs(plan, illegalExposure, role)].sort((a, b) => a - b),
        sourcePrototypeId: illegalExposure.sourcePrototypeId,
        reason: `${role} note sustains at least half a beat outside the following local chord contract`,
      });
    }
  }

  return {
    role,
    totalNotes: notes.length,
    conformingAttacks,
    attackConformanceRate: rate(conformingAttacks, notes.length),
    longCrossChordExposureCount,
    findings,
  };
}

/** Convenient combined texture audit for the production LOFI foundation. */
export function auditLofiTextureRolesLocalHarmony(
  ir: MusicalIR,
  plan: HarmonicPlan,
  timebase: Timebase,
): TextureRoleHarmonyMetrics[] {
  // Touch Timebase's branded conversion at least once here so callers cannot
  // accidentally pass a raw PPQ-shaped object.
  timebase.tickToBeat(ticks(0));
  return [
    auditLofiTextureLocalHarmony(ir, plan, timebase, 'comp'),
    auditLofiTextureLocalHarmony(ir, plan, timebase, 'pad'),
  ];
}
