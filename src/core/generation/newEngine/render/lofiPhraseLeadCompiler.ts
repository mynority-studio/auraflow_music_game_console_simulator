// ============================================================
// newEngine · render · LOFI Phrase Lead Compiler
// ------------------------------------------------------------
// Compiles Arranger-authored motif roles while notes are still MG score
// events. It never reads or repairs finished NoteIR. Replayed pitches are
// projected through the target HarmonicPlan's local admission contract.
// ============================================================

import { mod12 } from '../foundation';
import type {
  LofiPhraseBarInteraction,
  LofiPhraseInteractionPlan,
} from '../arranger/ArrangementPlan';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { MgNoteEvent } from './mgMelodyRealizer';

const EPSILON = 1e-6;
const STRUCTURAL_TOKENS = new Set(['C', 'G', 'B', 'Triadic']);
const FILL_TOKENS = new Set(['S', 'L', 'H', 'X', 'Slope']);

function spanAtBeat(plan: HarmonicPlan, beat: number): ChordSpan | undefined {
  return plan.chordTimeline.find((span) =>
    beat >= (span.startBeat as number) - EPSILON
    && beat < (span.startBeat as number) + (span.durationBeats as number) - EPSILON);
}

function admittedPcs(
  plan: HarmonicPlan,
  span: ChordSpan,
  stableOnly: boolean,
): number[] {
  const stable = (plan.stableToneMap[span.id] ?? []).map(Number);
  const color = (plan.colorToneMap[span.id] ?? []).map(Number);
  const scale = new Set((plan.chordScaleMap[span.id] ?? []).map(Number));
  const avoid = new Set((plan.avoidNoteMap[span.id] ?? []).map(Number));
  const structural = [...stable, ...color]
    .map((pc) => mod12(pc) as number)
    .filter((pc) => !avoid.has(pc) && (scale.size === 0 || scale.has(pc)));
  if (stableOnly) return [...new Set(structural.length > 0 ? structural : stable.map(Number))];
  const local = [...scale].filter((pc) => !avoid.has(pc));
  return [...new Set(local.length > 0 ? local : structural)];
}

function nearestPitchForPcs(reference: number, pcs: readonly number[]): number {
  if (pcs.length === 0) return Math.max(48, Math.min(88, Math.round(reference)));
  const candidates: number[] = [];
  for (let midi = 48; midi <= 88; midi++) {
    if (pcs.includes(mod12(midi) as number)) candidates.push(midi);
  }
  return candidates.sort((a, b) =>
    Math.abs(a - reference) - Math.abs(b - reference)
    || Math.abs(a - 68) - Math.abs(b - 68))[0] ?? Math.round(reference);
}

function cueEvents(
  events: readonly MgNoteEvent[],
  cue: Readonly<LofiPhraseBarInteraction>,
  beatsPerBar: number,
): MgNoteEvent[] {
  const start = cue.absoluteBar * beatsPerBar;
  const end = start + beatsPerBar;
  return events
    .filter((event) => event.part === 'melody'
      && event.time >= start - EPSILON
      && event.time < end - EPSILON)
    .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
}

function compileTargetMotif(args: {
  source: readonly MgNoteEvent[];
  cue: Readonly<LofiPhraseBarInteraction>;
  plan: HarmonicPlan;
  beatsPerBar: number;
}): MgNoteEvent[] {
  const { source, cue, plan, beatsPerBar } = args;
  const targetStart = cue.absoluteBar * beatsPerBar;
  const sourceBarStart = Math.floor(source[0]!.time / beatsPerBar) * beatsPerBar;
  const isVariation = cue.leadRole === 'variation';
  const isReturn = cue.leadRole === 'return';
  return source.map((event, index) => {
    const last = index === source.length - 1;
    const variationShift = isVariation && last ? 0.25 : 0;
    const relative = event.time - sourceBarStart;
    const time = Math.min(targetStart + beatsPerBar - 0.18, targetStart + relative + variationShift);
    const span = spanAtBeat(plan, time) ?? plan.chordTimeline[plan.chordTimeline.length - 1];
    if (!span) return { ...event, time };
    const forceStable = isReturn && last;
    const pcs = admittedPcs(plan, span, forceStable);
    const noteNumber = nearestPitchForPcs(event.noteNumber, pcs);
    const spanEnd = (span.startBeat as number) + (span.durationBeats as number);
    const duration = Math.max(0.08, Math.min(event.duration, spanEnd - time - 0.02, targetStart + beatsPerBar - time - 0.02));
    return {
      ...event,
      noteNumber,
      time,
      duration,
      velocity: event.velocity,
      origin: isReturn ? 'return' : isVariation ? 'develop' : 'motif',
      grammarTokenKind: forceStable ? 'C' : 'L',
      localAdmissionPcs: [...pcs],
      localHarmonySpanId: span.id,
    };
  });
}

function enforceScoreLocalHarmony(
  events: readonly MgNoteEvent[],
  plan: HarmonicPlan,
): MgNoteEvent[] {
  const ordered = [...events].sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
  return ordered.map((event, index) => {
    const kind = event.grammarTokenKind;
    const span = kind ? spanAtBeat(plan, event.time) : undefined;
    if (!kind || !span) return event;
    const next = ordered[index + 1];
    const pairedApproach = kind === 'A'
      && !!next
      && Math.abs(next.time - (event.time + event.duration)) <= 0.04
      && Math.abs(next.noteNumber - event.noteNumber) === 1;
    const stableOnly = STRUCTURAL_TOKENS.has(kind);
    const pcs = admittedPcs(plan, span, stableOnly);
    let noteNumber = event.noteNumber;
    if (!pairedApproach
        && (stableOnly || FILL_TOKENS.has(kind) || kind === 'A')
        && !pcs.includes(mod12(noteNumber) as number)) {
      noteNumber = nearestPitchForPcs(noteNumber, pcs);
    }

    let duration = event.duration;
    const pitchClass = mod12(noteNumber) as number;
    const eventEnd = event.time + duration;
    for (const later of plan.chordTimeline) {
      const laterStart = later.startBeat as number;
      if (later.id === span.id || laterStart <= event.time + EPSILON || laterStart >= eventEnd - EPSILON) continue;
      const laterEnd = laterStart + (later.durationBeats as number);
      const overlap = Math.min(eventEnd, laterEnd) - laterStart;
      if (overlap < 0.5) continue;
      if (!admittedPcs(plan, later, false).includes(pitchClass)) {
        duration = Math.max(0.08, laterStart - event.time - 0.02);
        break;
      }
    }
    return {
      ...event,
      noteNumber,
      duration,
      localAdmissionPcs: [...pcs],
      localHarmonySpanId: span.id,
    };
  });
}

/**
 * One song-level motif identity is established by the first statement. Later
 * statement/variation/return bars reuse its 3–5-note rhythm fingerprint while
 * target harmony determines legal pitch spelling. Phrase velocity is applied
 * after StyleFeel, so micro-variation remains subordinate to the arc.
 */
export function compileLofiPhraseLead(
  events: readonly MgNoteEvent[],
  plan: HarmonicPlan,
  interactionPlan: Readonly<LofiPhraseInteractionPlan> | undefined,
  beatsPerBar: number,
): MgNoteEvent[] {
  if (!interactionPlan || events.length === 0) return [...events];
  let out = [...events];
  const sourceByMotif = new Map<string, MgNoteEvent[]>();
  const cues = [...interactionPlan.bars].sort((a, b) => a.absoluteBar - b.absoluteBar);

  for (const cue of cues) {
    if (!cue.motifId || cue.leadRole === 'rest') continue;
    const current = cueEvents(out, cue, beatsPerBar);
    const source = sourceByMotif.get(cue.motifId);
    if (!source && cue.leadRole === 'statement') {
      const identity = current.slice(0, 5);
      if (identity.length >= 3) sourceByMotif.set(cue.motifId, identity.map((event) => ({ ...event })));
      continue;
    }
    if (!source || source.length < 3) continue;
    const replacement = compileTargetMotif({ source, cue, plan, beatsPerBar });
    const start = cue.absoluteBar * beatsPerBar;
    const end = start + beatsPerBar;
    out = out
      .filter((event) => event.part !== 'melody' || event.time < start - EPSILON || event.time >= end - EPSILON)
      .concat(replacement)
      .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
  }

  const harmonyCompiled = enforceScoreLocalHarmony(out, plan);
  return harmonyCompiled.map((event) => {
    const absoluteBar = Math.max(0, Math.floor(event.time / beatsPerBar));
    const cue = interactionPlan.bars.find((candidate) => candidate.absoluteBar === absoluteBar);
    if (!cue || cue.leadRole === 'rest') return event;
    const velocity = Math.max(1, Math.min(127,
      Math.round(event.velocity * cue.velocityScaleByRole.lead)));
    return velocity === event.velocity ? event : { ...event, velocity };
  });
}
