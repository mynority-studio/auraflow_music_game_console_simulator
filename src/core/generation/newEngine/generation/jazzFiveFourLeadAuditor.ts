// ============================================================
// newEngine · generation · Jazz 5/4 Lead Gate-L auditor
// ------------------------------------------------------------
// Read-only diagnostics over the resolved score. It neither repairs notes nor
// participates in product generation; all harmony/timing decisions have
// already been made by Arranger/Grammar/SlotBinder/ScoreCompiler.
// ============================================================

import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { materializeJazzFiveFourLeadRhythm } from '../knowledge/jazzFiveFourLeadRhythmKnowledge';
import type { JazzFiveFourScorePlan, ScoreEventProvenance } from '../arranger/jazzFiveFourScorePlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';

const BAR_TICKS = 2_400;
const CELL_TICKS = 80;

export interface JazzFiveFourLeadFamilyMetrics {
  readonly family: string;
  readonly directiveCount: number;
  readonly bars: number;
  readonly attacks: number;
  readonly attacksPerBar: number;
  readonly twoBeatSideRatio: number;
  readonly medianPitch: number | null;
  readonly pitchSpan: number;
  readonly stepwiseIntervalRatio: number;
  readonly threeToFourSemitoneRatio: number;
  readonly largeIntervalRatio: number;
  readonly ascendingDescendingRatio: number | null;
  readonly halfBeatRestRatio: number;
}

export interface JazzFiveFourLeadInteractionMetrics {
  readonly role: 'bass' | 'comp' | 'drum';
  readonly coactiveBars: number;
  /** Explicit score-grid comparison from InstrumentResolvedEvent.nominalTick. */
  readonly nominal: JazzFiveFourLeadDistinctOnsetMetrics;
  /** Explicit audible comparison from PerformedScoredEvent.tick. */
  readonly performed: JazzFiveFourLeadDistinctOnsetMetrics;
  /** @deprecated Nominal alias kept for report consumers written before Gate-L split the two clocks. */
  readonly leadDistinctOnsets: number;
  /** @deprecated Nominal alias; use nominal.roleDistinctOnsets. */
  readonly roleDistinctOnsets: number;
  /** @deprecated Nominal alias; use nominal.sharedDistinctOnsets. */
  readonly sharedDistinctOnsets: number;
  /** @deprecated Nominal directional collision alias; use nominal.collisionRate. */
  readonly collisionRate: number;
  /** @deprecated Nominal alias; use nominal.jaccard. */
  readonly jaccard: number;
}

export interface JazzFiveFourLeadDistinctOnsetMetrics {
  readonly leadDistinctOnsets: number;
  readonly roleDistinctOnsets: number;
  readonly sharedDistinctOnsets: number;
  /** collisionRate(Lead->Role), using distinct onsets in co-active bars. */
  readonly collisionRate: number;
  readonly jaccard: number;
}

export interface JazzFiveFourLeadAuditReport {
  readonly pass: boolean;
  readonly hardViolations: readonly string[];
  readonly descriptiveWarnings: readonly string[];
  readonly noteCount: number;
  readonly traceMissingCount: number;
  readonly outOfRangeCount: number;
  readonly offLatticeCount: number;
  readonly performanceResidualMaxAbsTicks: number;
  readonly nominalChordMismatchCount: number;
  readonly structuralArrivalCount: number;
  readonly structuralChordOrGuideRatio: number;
  readonly structuralStablePitchRatio: number;
  readonly avoidNoteArrivalCount: number;
  readonly families: readonly JazzFiveFourLeadFamilyMetrics[];
  readonly interactions: readonly JazzFiveFourLeadInteractionMetrics[];
  readonly eventSignature: string;
}

export interface JazzFiveFourLeadAuditArgs {
  readonly score: JazzFiveFourScorePlan;
  readonly arrangement: ArrangementPlan;
  readonly harmonic: HarmonicPlan;
}

interface LeadEvent {
  readonly eventId: string;
  readonly nominalTick: number;
  readonly durationTicks: number;
  readonly phaseTick: number;
  readonly pitch: number;
  readonly provenance: ScoreEventProvenance;
  readonly cadence: string;
}

function finiteRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[center - 1]! + sorted[center]!) / 2
    : sorted[center]!;
}

function stableHash(lines: readonly string[]): string {
  let hash = 2166136261;
  for (const character of lines.join('\n')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cadenceByEventKey(arrangement: ArrangementPlan): Map<string, string> {
  const result = new Map<string, string>();
  for (const directive of arrangement.jazzFiveFourLeadDirectives ?? []) {
    const brick = materializeJazzFiveFourLeadRhythm(directive.rhythmTemplateId, directive.startBar);
    for (const slot of brick.slots) result.set(`${directive.id}|${slot.slotId}`, slot.cadence);
  }
  return result;
}

function hasCompleteTrace(provenance: ScoreEventProvenance | undefined): provenance is ScoreEventProvenance {
  return Boolean(
    provenance
    && provenance.directiveId
    && provenance.phraseIds?.length
    && provenance.rhythmTemplateId
    && provenance.rhythmSlotId
    && provenance.grammarFamilyId
    && provenance.grammarRulePath?.length
    && provenance.grammarTokenId
    && provenance.grammarTokenKind
    && provenance.semanticAtom
    && Number.isSafeInteger(provenance.harmonicBrickIndex)
    && provenance.harmonicBrickName
    && provenance.harmonicBrickFamily
    && provenance.nominalChordSpanId
    && Number.isSafeInteger(provenance.nominalTick)
    && Number.isSafeInteger(provenance.renderedTick),
  );
}

function roleActiveBars(score: JazzFiveFourScorePlan, role: 'bass' | 'comp' | 'drum' | 'lead'): Set<number> {
  if (role === 'drum') {
    return new Set(score.drumBars.filter((bar) => bar.active).map((bar) => bar.absoluteBar));
  }
  return new Set(score.roleBars.filter((bar) => bar.role === role && bar.active).map((bar) => bar.absoluteBar));
}

function interaction(
  score: JazzFiveFourScorePlan,
  role: 'bass' | 'comp' | 'drum',
): JazzFiveFourLeadInteractionMetrics {
  const leadBars = roleActiveBars(score, 'lead');
  const otherBars = roleActiveBars(score, role);
  const coactive = new Set([...leadBars].filter((bar) => otherBars.has(bar)));
  const nominalLeadOnsets = new Set(score.instrumentEvents
    .filter((event) => event.role === 'lead' && coactive.has(event.absoluteBar))
    .map((event) => event.nominalTick));
  const nominalRoleOnsets = new Set(score.instrumentEvents
    .filter((event) => event.role === role && coactive.has(event.absoluteBar))
    .map((event) => event.nominalTick));

  // Co-activity is a score/Arranger ownership fact, not something inferred by
  // moving a performed onset into a neighbouring bar. The lookup therefore
  // keeps each performed event attached to its owning InstrumentResolvedEvent.
  const instrumentById = new Map(score.instrumentEvents.map((event) => [event.eventId, event] as const));
  const performedLeadOnsets = new Set(score.performance.events
    .filter((event) => {
      const instrument = instrumentById.get(event.instrumentEventId);
      return event.role === 'lead' && instrument?.role === 'lead' && coactive.has(instrument.absoluteBar);
    })
    .map((event) => event.tick));
  const performedRoleOnsets = new Set(score.performance.events
    .filter((event) => {
      const instrument = instrumentById.get(event.instrumentEventId);
      return event.role === role && instrument?.role === role && coactive.has(instrument.absoluteBar);
    })
    .map((event) => event.tick));

  const measure = (
    leadOnsets: ReadonlySet<number>,
    roleOnsets: ReadonlySet<number>,
  ): JazzFiveFourLeadDistinctOnsetMetrics => {
    const sharedDistinctOnsets = [...leadOnsets].filter((tick) => roleOnsets.has(tick)).length;
    const union = new Set([...leadOnsets, ...roleOnsets]).size;
    return Object.freeze({
      leadDistinctOnsets: leadOnsets.size,
      roleDistinctOnsets: roleOnsets.size,
      sharedDistinctOnsets,
      collisionRate: finiteRatio(sharedDistinctOnsets, leadOnsets.size),
      jaccard: finiteRatio(sharedDistinctOnsets, union),
    });
  };
  const nominal = measure(nominalLeadOnsets, nominalRoleOnsets);
  const performed = measure(performedLeadOnsets, performedRoleOnsets);
  return Object.freeze({
    role,
    coactiveBars: coactive.size,
    nominal,
    performed,
    leadDistinctOnsets: nominal.leadDistinctOnsets,
    roleDistinctOnsets: nominal.roleDistinctOnsets,
    sharedDistinctOnsets: nominal.sharedDistinctOnsets,
    collisionRate: nominal.collisionRate,
    jaccard: nominal.jaccard,
  });
}

function familyMetrics(
  arrangement: ArrangementPlan,
  events: readonly LeadEvent[],
): JazzFiveFourLeadFamilyMetrics[] {
  const directives = arrangement.jazzFiveFourLeadDirectives ?? [];
  const families = [...new Set(directives.map((directive) => directive.family))];
  return families.map((family) => {
    const familyDirectives = directives.filter((directive) => directive.family === family);
    const directiveIds = new Set(familyDirectives.map((directive) => directive.id));
    const notes = events.filter((event) => directiveIds.has(event.provenance.directiveId ?? ''));
    const intervals: number[] = [];
    let ascents = 0;
    let descents = 0;
    let halfBeatRests = 0;
    let gapCount = 0;
    for (const directive of familyDirectives) {
      const phrase = notes
        .filter((event) => event.provenance.directiveId === directive.id)
        .sort((left, right) => left.nominalTick - right.nominalTick || left.eventId.localeCompare(right.eventId));
      for (let index = 1; index < phrase.length; index++) {
        const previous = phrase[index - 1]!;
        const current = phrase[index]!;
        const delta = current.pitch - previous.pitch;
        intervals.push(delta);
        if (delta > 0) ascents += 1;
        else if (delta < 0) descents += 1;
        if (current.nominalTick - (previous.nominalTick + previous.durationTicks) >= 240) halfBeatRests += 1;
        gapCount += 1;
      }
    }
    const absIntervals = intervals.map(Math.abs);
    const pitches = notes.map((event) => event.pitch);
    return Object.freeze({
      family,
      directiveCount: familyDirectives.length,
      bars: familyDirectives.reduce((sum, directive) => sum + directive.barCount, 0),
      attacks: notes.length,
      attacksPerBar: finiteRatio(notes.length, familyDirectives.reduce((sum, directive) => sum + directive.barCount, 0)),
      twoBeatSideRatio: finiteRatio(notes.filter((event) => event.phaseTick >= 1_440).length, notes.length),
      medianPitch: median(pitches),
      pitchSpan: pitches.length === 0 ? 0 : Math.max(...pitches) - Math.min(...pitches),
      stepwiseIntervalRatio: finiteRatio(absIntervals.filter((value) => value <= 2).length, absIntervals.length),
      threeToFourSemitoneRatio: finiteRatio(absIntervals.filter((value) => value >= 3 && value <= 4).length, absIntervals.length),
      largeIntervalRatio: finiteRatio(absIntervals.filter((value) => value >= 5).length, absIntervals.length),
      ascendingDescendingRatio: descents === 0 ? (ascents === 0 ? null : Number.POSITIVE_INFINITY) : ascents / descents,
      halfBeatRestRatio: finiteRatio(halfBeatRests, gapCount),
    });
  });
}

function descriptiveWarnings(families: readonly JazzFiveFourLeadFamilyMetrics[]): string[] {
  const warnings: string[] = [];
  const headA = families.find((metrics) => metrics.family === 'headA');
  const headB = families.find((metrics) => metrics.family === 'headB');
  const solo = families.find((metrics) => metrics.family === 'solo');
  if (headA && (headA.attacksPerBar < 5.4 || headA.attacksPerBar > 6.6)) {
    warnings.push(`headA attacks/bar ${headA.attacksPerBar.toFixed(3)} is outside descriptive 5.4..6.6`);
  }
  if (headB && (headB.attacksPerBar < 6.8 || headB.attacksPerBar > 8.5)) {
    warnings.push(`headB attacks/bar ${headB.attacksPerBar.toFixed(3)} is outside descriptive 6.8..8.5`);
  }
  if (solo && (solo.attacksPerBar < 4.2 || solo.attacksPerBar > 5.8)) {
    warnings.push(`solo attacks/bar ${solo.attacksPerBar.toFixed(3)} is outside descriptive 4.2..5.8`);
  }
  return warnings;
}

export function auditJazzFiveFourLead(args: JazzFiveFourLeadAuditArgs): JazzFiveFourLeadAuditReport {
  const hardViolations: string[] = [];
  const cadence = cadenceByEventKey(args.arrangement);
  const performanceById = new Map(args.score.performance.events.map((event) => [event.eventId, event] as const));
  let traceMissingCount = 0;
  const leadEvents: LeadEvent[] = [];

  for (const event of args.score.instrumentEvents.filter((candidate) => candidate.role === 'lead')) {
    const provenance = args.score.provenanceByEventId[event.eventId];
    if (!hasCompleteTrace(provenance)) {
      traceMissingCount += 1;
      continue;
    }
    leadEvents.push({
      eventId: event.eventId,
      nominalTick: event.nominalTick,
      durationTicks: event.durationTicks,
      phaseTick: event.phaseTick,
      pitch: event.pitch,
      provenance,
      cadence: cadence.get(`${provenance.directiveId}|${provenance.rhythmSlotId}`) ?? 'unknown',
    });
  }
  leadEvents.sort((left, right) => left.nominalTick - right.nominalTick || left.eventId.localeCompare(right.eventId));
  if (leadEvents.length === 0) hardViolations.push('Lead score has no fully traceable audible events');
  if (traceMissingCount > 0) hardViolations.push(`${traceMissingCount} Lead events have incomplete provenance`);

  const outOfRangeCount = leadEvents.filter((event) => event.pitch < 54 || event.pitch > 78).length;
  const offLatticeCount = leadEvents.filter((event) => event.nominalTick % CELL_TICKS !== 0).length;
  if (outOfRangeCount > 0) hardViolations.push(`${outOfRangeCount} Lead events are outside MIDI 54..78`);
  if (offLatticeCount > 0) hardViolations.push(`${offLatticeCount} Lead events are outside the 80-tick nominal lattice`);

  let performanceResidualMaxAbsTicks = 0;
  let nominalChordMismatchCount = 0;
  for (const event of leadEvents) {
    const performed = performanceById.get(event.eventId);
    if (!performed) {
      hardViolations.push(`Lead event ${event.eventId} has no performed event`);
    } else {
      performanceResidualMaxAbsTicks = Math.max(
        performanceResidualMaxAbsTicks,
        Math.abs(performed.tick - event.nominalTick),
      );
    }
    const beat = event.nominalTick / 480;
    const span = args.harmonic.chordTimeline.find((candidate) =>
      beat >= Number(candidate.startBeat)
      && beat < Number(candidate.startBeat) + Number(candidate.durationBeats));
    if (!span || span.id !== event.provenance.nominalChordSpanId) nominalChordMismatchCount += 1;
  }
  if (performanceResidualMaxAbsTicks > 40) {
    hardViolations.push(`Lead performance residual ${performanceResidualMaxAbsTicks} exceeds 40 ticks`);
  }
  if (nominalChordMismatchCount > 0) {
    hardViolations.push(`${nominalChordMismatchCount} Lead events disagree with nominal HarmonicPlan lookup`);
  }

  const structural = leadEvents.filter((event) =>
    event.phaseTick === 0 || event.phaseTick === 1_440 || event.cadence === 'arrival');
  const structuralChordOrGuideRatio = finiteRatio(
    structural.filter((event) => event.provenance.semanticAtom === 'chord-tone' || event.provenance.semanticAtom === 'guide-tone').length,
    structural.length,
  );
  const structuralStablePitchRatio = finiteRatio(structural.filter((event) => {
    const stable = args.harmonic.stableToneMap[event.provenance.nominalChordSpanId ?? ''] ?? [];
    return stable.map(Number).includes(((event.pitch % 12) + 12) % 12);
  }).length, structural.length);
  if (structuralChordOrGuideRatio < 0.7) {
    hardViolations.push(`Structural chord/guide semantic ratio ${structuralChordOrGuideRatio.toFixed(3)} is below 0.7`);
  }

  const arrivals = leadEvents.filter((event) => event.cadence === 'arrival');
  const avoidNoteArrivalCount = arrivals.filter((event) => {
    const avoid = args.harmonic.avoidNoteMap[event.provenance.nominalChordSpanId ?? ''] ?? [];
    return avoid.map(Number).includes(((event.pitch % 12) + 12) % 12);
  }).length;
  if (avoidNoteArrivalCount > 0) hardViolations.push(`${avoidNoteArrivalCount} cadence arrivals use avoid notes`);

  const interactions = (['bass', 'comp', 'drum'] as const).map((role) => interaction(args.score, role));
  for (const metrics of interactions) {
    if (metrics.nominal.jaccard >= 0.35) {
      hardViolations.push(`Lead/${metrics.role} nominal Jaccard ${metrics.nominal.jaccard.toFixed(3)} must be below 0.35`);
    }
    if (metrics.role === 'comp'
      && (metrics.performed.collisionRate < 0.01 || metrics.performed.collisionRate > 0.08)) {
      hardViolations.push(
        `Lead/comp performed collision ${metrics.performed.collisionRate.toFixed(3)} must be within 0.01..0.08`,
      );
    }
    if (metrics.role === 'drum'
      && (metrics.performed.collisionRate < 0 || metrics.performed.collisionRate > 0.10)) {
      hardViolations.push(
        `Lead/drum performed collision ${metrics.performed.collisionRate.toFixed(3)} must be within 0..0.10`,
      );
    }
  }
  const families = familyMetrics(args.arrangement, leadEvents);
  const eventSignature = stableHash(leadEvents.map((event) => [
    event.nominalTick,
    event.durationTicks,
    event.pitch,
    event.provenance.semanticAtom,
    event.provenance.grammarTokenKind,
  ].join('|')));
  return Object.freeze({
    pass: hardViolations.length === 0,
    hardViolations: Object.freeze(hardViolations),
    descriptiveWarnings: Object.freeze(descriptiveWarnings(families)),
    noteCount: leadEvents.length,
    traceMissingCount,
    outOfRangeCount,
    offLatticeCount,
    performanceResidualMaxAbsTicks,
    nominalChordMismatchCount,
    structuralArrivalCount: structural.length,
    structuralChordOrGuideRatio,
    structuralStablePitchRatio,
    avoidNoteArrivalCount,
    families: Object.freeze(families),
    interactions: Object.freeze(interactions),
    eventSignature,
  });
}

// --------------------------------------------------------------------------
// Transposition-invariant anti-copy primitives. Source material is supplied by
// offline audit callers; this module contains no reference melody or file IO.
// --------------------------------------------------------------------------

export function jazzFiveFourDirectedIntervals(pitches: readonly number[]): readonly number[] {
  return Object.freeze(pitches.slice(1).map((pitch, index) => pitch - pitches[index]!));
}

function contour(interval: number): -1 | 0 | 1 {
  return interval === 0 ? 0 : interval > 0 ? 1 : -1;
}

export function jazzFiveFourContourNgrams(
  pitches: readonly number[],
  size = 3,
): ReadonlySet<string> {
  if (!Number.isSafeInteger(size) || size <= 0) throw new RangeError('Contour n-gram size must be positive');
  const values = jazzFiveFourDirectedIntervals(pitches).map(contour);
  const result = new Set<string>();
  for (let index = 0; index + size <= values.length; index++) {
    result.add(values.slice(index, index + size).join(','));
  }
  return result;
}

function normalizedLcs(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || right.length === 0) return left.length === right.length ? 1 : 0;
  let previous = new Uint32Array(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = new Uint32Array(right.length + 1);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? previous[rightIndex - 1]! + 1
        : Math.max(previous[rightIndex]!, current[rightIndex - 1]!);
    }
    previous = current;
  }
  return previous[right.length]! / Math.max(left.length, right.length);
}

function setJaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  const shared = [...left].filter((value) => right.has(value)).length;
  return shared / union.size;
}

export interface JazzFiveFourAntiCopySimilarity {
  readonly score: number;
  readonly intervalLcs: number;
  readonly contourNgramJaccard: number;
  readonly bestTransposedPitchLcs: number;
  readonly bestTransposeSemitones: number;
}

export function jazzFiveFourAntiCopySimilarity(
  source: readonly number[],
  candidate: readonly number[],
): JazzFiveFourAntiCopySimilarity {
  const intervalLcs = normalizedLcs(
    jazzFiveFourDirectedIntervals(source),
    jazzFiveFourDirectedIntervals(candidate),
  );
  const contourNgramJaccard = setJaccard(
    jazzFiveFourContourNgrams(source),
    jazzFiveFourContourNgrams(candidate),
  );
  let bestTransposedPitchLcs = 0;
  let bestTransposeSemitones = 0;
  for (let transpose = -24; transpose <= 24; transpose += 1) {
    const transposed = source.map((pitch) => pitch + transpose);
    const score = normalizedLcs(transposed, candidate);
    if (score > bestTransposedPitchLcs) {
      bestTransposedPitchLcs = score;
      bestTransposeSemitones = transpose;
    }
  }
  return Object.freeze({
    score: intervalLcs * 0.5 + contourNgramJaccard * 0.25 + bestTransposedPitchLcs * 0.25,
    intervalLcs,
    contourNgramJaccard,
    bestTransposedPitchLcs,
    bestTransposeSemitones,
  });
}

/** Nearest-rank 95th percentile of explicit negative controls. */
export function freezeJazzFiveFourAntiCopyThreshold(
  source: readonly number[],
  negativeControls: readonly (readonly number[])[],
): number {
  if (negativeControls.length < 3) throw new RangeError('At least three negative controls are required');
  const scores = negativeControls
    .map((candidate) => jazzFiveFourAntiCopySimilarity(source, candidate).score)
    .sort((left, right) => left - right);
  return scores[Math.max(0, Math.ceil(scores.length * 0.95) - 1)]!;
}
