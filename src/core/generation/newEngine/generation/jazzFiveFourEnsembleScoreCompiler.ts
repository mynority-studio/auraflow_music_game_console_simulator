// ============================================================
// newEngine · generation · Jazz 5/4 ensemble score compiler
// ------------------------------------------------------------
// Frozen Arranger bar/phrase directives -> product texture/Drum KB ->
// HarmonicPlan/InstrumentationPlan realization.  This module emits score
// events only: it never selects form/material, creates NoteIR, or repairs
// anything in Renderer.
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';
import { deepFreeze, type DeepReadonly } from '../foundation';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import {
  JAZZ_FIVE_FOUR_BASS_VARIANTS,
  JAZZ_FIVE_FOUR_COMP_VARIANTS,
  JAZZ_FIVE_FOUR_DRUM_VARIANTS,
  type JazzFiveFourEnsembleVariant,
} from '../knowledge/jazzFiveFourEnsembleVariationKnowledge';
import {
  JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS,
  jazzFiveFourDrumPhrasePattern,
} from '../knowledge/jazzFiveFourDrumPhraseKnowledge';
import {
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
  JAZZ_FIVE_FOUR_ROLE_BAR_TICKS,
  JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
} from '../knowledge/jazzFiveFourRoleKnowledge';
import {
  JAZZ_FIVE_FOUR_FOUNDATION_MODES,
  jazzFiveFourBassTextureCells,
  jazzFiveFourBassTextureVariant,
  jazzFiveFourPianoTextureCells,
  jazzFiveFourPianoTextureVariant,
  type JazzFiveFourTextureCell,
} from '../knowledge/jazzFiveFourTextureKnowledge';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import {
  jazzFiveFourBarRoleDirective,
  type JazzFiveFourEnsembleBarDirective,
  type JazzFiveFourEnsembleScore,
  type JazzFiveFourPerBarRoleDirective,
  type JazzFiveFourWholeDrumPhraseDirective,
} from '../arranger/jazzFiveFourEnsembleScore';
import {
  assertValidJazzFiveFourScorePlan,
  JAZZ_FIVE_FOUR_GROUP_BOUNDARY_TICKS,
  JAZZ_FIVE_FOUR_SCORE_SCHEMA_VERSION,
  type DrumBarScore,
  type InstrumentResolvedEvent,
  type JazzFiveFourScorePlan,
  type JazzFiveFourScorePlanData,
  type PerformedScoredEvent,
  type RoleBarScore,
  type ScoreEventProvenance,
  type SemanticScoredEvent,
  type TimingLink,
  type TimingResidualPolicy,
} from '../arranger/jazzFiveFourScorePlan';

const BAR_TICKS = JAZZ_FIVE_FOUR_ROLE_BAR_TICKS;
const PPQ = 480;
const ZERO_RESIDUAL_POLICY: TimingResidualPolicy = Object.freeze({
  mode: 'reference-zero',
  owner: 'performance',
  maxAbsTicks: 0,
  applyOnce: true,
  preserveMemberOffsets: true,
});

export interface CompileJazzFiveFourRhythmSectionArgs {
  readonly arrangement: ArrangementPlan;
  readonly harmonic: HarmonicPlan;
  readonly instrumentation: InstrumentationPlan;
}

/** Mergeable Bass/Comp/Drum portion of JazzFiveFourScorePlanData. */
export interface JazzFiveFourRhythmSectionCompilationData {
  semanticEvents: SemanticScoredEvent[];
  instrumentEvents: InstrumentResolvedEvent[];
  performanceEvents: PerformedScoredEvent[];
  roleBars: RoleBarScore[];
  drumBars: DrumBarScore[];
  timingLinks: TimingLink[];
  provenanceByEventId: Record<string, ScoreEventProvenance>;
}

export type JazzFiveFourRhythmSectionCompilation =
  DeepReadonly<JazzFiveFourRhythmSectionCompilationData>;

interface RegisterRange {
  readonly lowMidi: number;
  readonly highMidi: number;
}

interface MutableCompilation {
  semanticEvents: SemanticScoredEvent[];
  instrumentEvents: InstrumentResolvedEvent[];
  roleBars: RoleBarScore[];
  drumBars: DrumBarScore[];
  provenanceByEventId: Record<string, ScoreEventProvenance>;
}

interface CompVoiceState {
  previous?: readonly [number, number, number];
}

function clampMidiVelocity(value: number): number {
  return Math.max(1, Math.min(127, Math.round(value)));
}

function normalizedPc(value: number): number {
  return ((value % 12) + 12) % 12;
}

function roleInstrument(
  instrumentation: InstrumentationPlan,
  role: InstrumentRoleName,
  sectionId: string,
): { program: number; bank?: number } {
  const program = instrumentation.programByRoleSection?.[role]?.[sectionId]
    ?? instrumentation.roleProgram?.[role]
    ?? (role === 'bass' ? 32 : 0);
  const bank = instrumentation.bankByRoleSection?.[role]?.[sectionId]
    ?? instrumentation.roleBank?.[role];
  return bank === undefined ? { program } : { program, bank };
}

function roleRange(
  instrumentation: InstrumentationPlan,
  role: 'bass' | 'comp',
): RegisterRange {
  const fallback = role === 'bass'
    ? { lowMidi: 29, highMidi: 48 }
    : { lowMidi: 39, highMidi: 66 };
  const range = instrumentation.strictRegisterByRole?.[role]
    ?? instrumentation.registerByRole?.[role]
    ?? fallback;
  const result = { lowMidi: Number(range.lowMidi), highMidi: Number(range.highMidi) };
  if (!Number.isInteger(result.lowMidi) || !Number.isInteger(result.highMidi)
    || result.lowMidi < 0 || result.highMidi > 127 || result.lowMidi >= result.highMidi) {
    throw new RangeError(`Invalid Jazz 5/4 ${role} register ${result.lowMidi}..${result.highMidi}`);
  }
  return result;
}

function chordAtTick(harmonic: HarmonicPlan, tick: number): ChordSpan {
  const beat = tick / PPQ;
  const span = harmonic.chordTimeline.find((candidate) => {
    const start = Number(candidate.startBeat);
    return beat >= start - 1e-9 && beat < start + Number(candidate.durationBeats) - 1e-9;
  });
  if (!span) throw new RangeError(`Jazz 5/4 ensemble has no HarmonicPlan span at tick ${tick}`);
  return span as ChordSpan;
}

function nextChord(harmonic: HarmonicPlan, current: ChordSpan): ChordSpan | undefined {
  const index = harmonic.chordTimeline.findIndex((span) => span.id === current.id);
  return index < 0 ? undefined : harmonic.chordTimeline[index + 1] as ChordSpan | undefined;
}

function bassPc(span: ChordSpan): number {
  return normalizedPc(Number(span.bassPc ?? span.bassPedalPc ?? span.rootPc));
}

function sourceMidiForCell(cell: DeepReadonly<JazzFiveFourTextureCell>): number {
  const sourceId = cell.provenance.sourceCellId;
  const source = [
    ...JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
    ...JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
    ...JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
  ].find((candidate) => candidate.cellId === sourceId);
  if (source) return source.sourcePitch.midi;
  if (cell.harmonicToneIntent === 'approach-next-root') return 46;
  return cell.sublayer === 'upper' ? 58 : 39;
}

function fitGesturePitch(
  sourceMidi: number,
  pitchClass: number,
  range: RegisterRange,
  octaveShift: number,
): number {
  const target = sourceMidi + octaveShift * 12;
  const candidates: number[] = [];
  for (let pitch = range.lowMidi; pitch <= range.highMidi; pitch += 1) {
    if (normalizedPc(pitch) === normalizedPc(pitchClass)) candidates.push(pitch);
  }
  const chosen = candidates.sort((left, right) =>
    Math.abs(left - target) - Math.abs(right - target) || left - right)[0];
  if (chosen === undefined) {
    throw new RangeError(`Jazz 5/4 pitch class ${pitchClass} cannot fit ${range.lowMidi}..${range.highMidi}`);
  }
  return chosen;
}

function variantById(
  role: 'bass' | 'comp' | 'drum',
  id: string | undefined,
): DeepReadonly<JazzFiveFourEnsembleVariant> {
  if (!id) throw new RangeError(`Active Jazz 5/4 ${role} directive has no Arranger variationId`);
  const source = role === 'bass'
    ? JAZZ_FIVE_FOUR_BASS_VARIANTS
    : role === 'comp'
      ? JAZZ_FIVE_FOUR_COMP_VARIANTS
      : JAZZ_FIVE_FOUR_DRUM_VARIANTS;
  const found = source.find((variant) => variant.id === id);
  if (!found) throw new RangeError(`Unknown Arranger-selected Jazz 5/4 ${role} variation ${id}`);
  return found;
}

function assertVariationDirective(
  directive: DeepReadonly<JazzFiveFourPerBarRoleDirective>,
  variation: DeepReadonly<JazzFiveFourEnsembleVariant>,
): void {
  if (directive.variationMutationUnit !== variation.mutationUnit) {
    throw new RangeError(
      `Jazz 5/4 Arranger variation unit mismatch for ${variation.id}: `
      + `${String(directive.variationMutationUnit)} != ${variation.mutationUnit}`,
    );
  }
}

function selectedTextureCells(
  role: 'bass' | 'comp',
  directive: DeepReadonly<JazzFiveFourPerBarRoleDirective>,
  foundationMode: DeepReadonly<JazzFiveFourEnsembleBarDirective>['foundationMode'],
): {
  readonly cells: readonly DeepReadonly<JazzFiveFourTextureCell>[];
  readonly familyId: string;
  readonly textureRegisterShift: number;
  readonly variation: DeepReadonly<JazzFiveFourEnsembleVariant>;
} {
  if (!directive.textureVariantId) {
    throw new RangeError(`Active Jazz 5/4 ${role} directive has no textureVariantId`);
  }
  const variation = variantById(role, directive.variationId);
  assertVariationDirective(directive, variation);
  if (role === 'bass') {
    const variant = jazzFiveFourBassTextureVariant(directive.textureVariantId as never);
    const cells = jazzFiveFourBassTextureCells(variant.id);
    if (cells.length === 0) throw new RangeError(`Jazz 5/4 ${variation.id} emptied Bass texture ${variant.id}`);
    return { cells, familyId: variant.familyId, textureRegisterShift: variant.registerOctaveShift, variation };
  }

  const variant = jazzFiveFourPianoTextureVariant(directive.textureVariantId as never);
  const source = jazzFiveFourPianoTextureCells(variant.id);
  const policy = JAZZ_FIVE_FOUR_FOUNDATION_MODES[foundationMode];
  const foundation = source.filter((cell) => cell.sublayer === 'foundation');
  const upper = source.filter((cell) => cell.sublayer === 'upper');
  if (policy.compFoundationActive !== (foundation.length > 0)
    || policy.compUpperActive !== (upper.length > 0)) {
    throw new RangeError(
      `Jazz 5/4 Piano texture ${variant.id} conflicts with foundation mode ${foundationMode}`,
    );
  }
  const cells = [...foundation, ...upper].sort((left, right) =>
    left.phase.engineTicks - right.phase.engineTicks
    || left.sublayer.localeCompare(right.sublayer)
    || left.id.localeCompare(right.id));
  if (cells.length === 0) throw new RangeError(`Jazz 5/4 ${variation.id} emptied Piano texture ${variant.id}`);
  return { cells, familyId: variant.familyId, textureRegisterShift: 0, variation };
}

function rootlessPitchClasses(span: ChordSpan, harmonic: HarmonicPlan): readonly [number, number, number] {
  const root = normalizedPc(Number(span.rootPc));
  const minor = span.quality === 'min' || span.quality === 'm7'
    || span.quality === 'm7b5' || span.quality === 'dim7';
  const third = normalizedPc(root + (minor ? 3 : 4));
  const seventh = normalizedPc(root + (
    span.quality === 'maj7' ? 11 : span.quality === 'dim7' ? 9 : 10
  ));
  const avoid = new Set((harmonic.avoidNoteMap[span.id] ?? []).map(Number).map(normalizedPc));
  const candidates = [
    ...(harmonic.colorToneMap[span.id] ?? []),
    ...(harmonic.stableToneMap[span.id] ?? []),
    root + 2,
    root + 7,
    root + 6,
    root + 9,
  ].map(Number).map(normalizedPc);
  const extension = candidates.find((pc) =>
    pc !== root && pc !== third && pc !== seventh && !avoid.has(pc));
  if (extension === undefined) {
    throw new RangeError(`Jazz 5/4 cannot derive a rootless extension for HarmonicPlan span ${span.id}`);
  }
  return [third, seventh, extension];
}

function pitchesForPc(pc: number, range: RegisterRange): readonly number[] {
  const result: number[] = [];
  for (let pitch = range.lowMidi; pitch <= range.highMidi; pitch += 1) {
    if (normalizedPc(pitch) === normalizedPc(pc)) result.push(pitch);
  }
  return result;
}

/** Fixed semantic voices, no crossing; choose the globally smallest movement. */
function closestRootlessVoicing(
  pitchClasses: readonly [number, number, number],
  range: RegisterRange,
  previous?: readonly [number, number, number],
): readonly [number, number, number] {
  const target = previous ?? [54, 58, 63] as const;
  const candidates = pitchClasses.map((pc) => pitchesForPc(pc, range));
  let best: [number, number, number] | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const low of candidates[0]!) for (const middle of candidates[1]!) for (const high of candidates[2]!) {
    if (!(low < middle && middle < high)) continue;
    const cost = Math.abs(low - target[0]) + Math.abs(middle - target[1]) + Math.abs(high - target[2])
      + Math.max(0, 5 - (middle - low)) * 2
      + Math.max(0, 5 - (high - middle)) * 2;
    if (cost < bestCost || (cost === bestCost && (!best || high < best[2]))) {
      best = [low, middle, high];
      bestCost = cost;
    }
  }
  if (!best) {
    throw new RangeError(
      `Jazz 5/4 rootless voicing ${pitchClasses.join('/')} cannot fit ${range.lowMidi}..${range.highMidi}`,
    );
  }
  return best;
}

function addEvent(
  target: MutableCompilation,
  semantic: SemanticScoredEvent,
  resolution: { readonly pitch: number; readonly program: number; readonly bank?: number },
  provenance: Omit<ScoreEventProvenance, 'eventId' | 'role' | 'sectionId' | 'absoluteBar'>,
): void {
  if (target.provenanceByEventId[semantic.eventId]) {
    throw new RangeError(`Duplicate Jazz 5/4 ensemble event ${semantic.eventId}`);
  }
  target.semanticEvents.push(semantic);
  target.instrumentEvents.push({
    eventId: semantic.eventId,
    semanticEventId: semantic.eventId,
    role: semantic.role,
    sectionId: semantic.sectionId,
    barInSection: semantic.barInSection,
    absoluteBar: semantic.absoluteBar,
    nominalTick: semantic.nominalTick,
    phaseTick: semantic.phaseTick,
    durationTicks: semantic.durationTicks,
    velocity: semantic.velocity,
    pitch: resolution.pitch,
    program: resolution.program,
    ...(resolution.bank === undefined ? {} : { bank: resolution.bank }),
  });
  target.provenanceByEventId[semantic.eventId] = {
    eventId: semantic.eventId,
    role: semantic.role,
    sectionId: semantic.sectionId,
    absoluteBar: semantic.absoluteBar,
    ...provenance,
  };
}

function baseProvenance(
  score: JazzFiveFourEnsembleScore,
  bar: DeepReadonly<JazzFiveFourEnsembleBarDirective>,
  directive: DeepReadonly<JazzFiveFourPerBarRoleDirective>,
): Pick<ScoreEventProvenance,
  'variantId' | 'ensembleDirectiveId' | 'phraseId' | 'foundationMode'
  | 'foundationOwner' | 'interactionCueId' | 'textureVariantId'> {
  return {
    variantId: score.mode === 'canonical-reference' ? 'source-canonical' : 'seed-generated',
    ensembleDirectiveId: bar.id,
    phraseId: bar.phraseId,
    foundationMode: bar.foundationMode,
    foundationOwner: bar.foundationOwner,
    interactionCueId: bar.interactionCue.id,
    ...(directive.textureVariantId === undefined ? {} : { textureVariantId: directive.textureVariantId }),
  };
}

function compileBassBar(args: {
  score: JazzFiveFourEnsembleScore;
  bar: DeepReadonly<JazzFiveFourEnsembleBarDirective>;
  directive: DeepReadonly<JazzFiveFourPerBarRoleDirective>;
  harmonic: HarmonicPlan;
  instrumentation: InstrumentationPlan;
  target: MutableCompilation;
}): { eventIds: readonly string[]; familyId: string } {
  const { score, bar, directive, harmonic, instrumentation, target } = args;
  if (!directive.active) return { eventIds: [], familyId: 'silent' };
  if (directive.materialOwner !== 'bass-texture') {
    throw new RangeError(`Active Jazz 5/4 Bass bar ${bar.absoluteBar} is not owned by Bass texture KB`);
  }
  const selected = selectedTextureCells('bass', directive, bar.foundationMode);
  const instrument = roleInstrument(instrumentation, 'bass', bar.sectionId);
  const range = roleRange(instrumentation, 'bass');
  const eventIds: string[] = [];
  const velocityScale = selected.variation.budget.velocityScale;
  const octaveShift = selected.textureRegisterShift + selected.variation.budget.registerOctaveShift;
  for (const cell of selected.cells) {
    const phaseTick = cell.phase.engineTicks;
    const nominalTick = bar.absoluteBar * BAR_TICKS + phaseTick;
    const nominalSpan = chordAtTick(harmonic, nominalTick);
    const targetSpan = cell.harmonicToneIntent === 'approach-next-root'
      ? nextChord(harmonic, nominalSpan) ?? nominalSpan
      : nominalSpan;
    const pitchClass = cell.harmonicToneIntent === 'approach-next-root'
      ? normalizedPc(bassPc(targetSpan) - 1)
      : bassPc(targetSpan);
    const eventId = `j54-gen:${bar.absoluteBar}:bass:${cell.id}`;
    const velocity = clampMidiVelocity(cell.referenceVelocity * velocityScale);
    eventIds.push(eventId);
    addEvent(target, {
      eventId,
      role: 'bass',
      sectionId: bar.sectionId,
      barInSection: bar.barInSection,
      absoluteBar: bar.absoluteBar,
      nominalTick,
      phaseTick,
      durationTicks: cell.gate.engineTicks,
      velocity,
      pitchIntent: {
        kind: 'harmony-bass-anchor',
        chordSpanId: targetSpan.id,
        pitchClass,
        registerGesture: { kind: 'source-relative-octave', sourceMidi: sourceMidiForCell(cell) },
      },
    }, {
      pitch: fitGesturePitch(sourceMidiForCell(cell), pitchClass, range, octaveShift),
      ...instrument,
    }, {
      ...baseProvenance(score, bar, directive),
      familyId: selected.familyId,
      cellId: cell.id,
      ...(cell.provenance.sourceSha256 === undefined ? {} : { sourceSha256: cell.provenance.sourceSha256 }),
      harmonicSpanId: targetSpan.id,
      nominalChordSpanId: nominalSpan.id,
      authority: cell.provenance.authority,
      nominalTick,
      renderedTick: nominalTick,
    });
  }
  return { eventIds, familyId: selected.familyId };
}

function compileCompBar(args: {
  score: JazzFiveFourEnsembleScore;
  bar: DeepReadonly<JazzFiveFourEnsembleBarDirective>;
  directive: DeepReadonly<JazzFiveFourPerBarRoleDirective>;
  harmonic: HarmonicPlan;
  instrumentation: InstrumentationPlan;
  target: MutableCompilation;
  voiceState: CompVoiceState;
}): { eventIds: readonly string[]; familyId: string } {
  const { score, bar, directive, harmonic, instrumentation, target, voiceState } = args;
  if (!directive.active) return { eventIds: [], familyId: 'silent' };
  if (directive.materialOwner !== 'piano-texture') {
    throw new RangeError(`Active Jazz 5/4 Comp bar ${bar.absoluteBar} is not owned by Piano texture KB`);
  }
  const selected = selectedTextureCells('comp', directive, bar.foundationMode);
  const instrument = roleInstrument(instrumentation, 'comp', bar.sectionId);
  const range = roleRange(instrumentation, 'comp');
  const foundationRange = { lowMidi: range.lowMidi, highMidi: Math.min(range.highMidi, range.lowMidi + 12) };
  const velocityScale = selected.variation.budget.velocityScale;
  const eventIds: string[] = [];
  const upperByPhase = new Map<number, readonly [number, number, number]>();

  for (const phaseTick of [...new Set(selected.cells
    .filter((cell) => cell.sublayer === 'upper')
    .map((cell) => cell.phase.engineTicks))].sort((left, right) => left - right)) {
    const span = chordAtTick(harmonic, bar.absoluteBar * BAR_TICKS + phaseTick);
    const voicing = closestRootlessVoicing(rootlessPitchClasses(span, harmonic), range, voiceState.previous);
    upperByPhase.set(phaseTick, voicing);
    voiceState.previous = voicing;
  }

  for (const cell of selected.cells) {
    const phaseTick = cell.phase.engineTicks;
    const nominalTick = bar.absoluteBar * BAR_TICKS + phaseTick;
    const span = chordAtTick(harmonic, nominalTick);
    const velocity = clampMidiVelocity(cell.referenceVelocity * velocityScale);
    const sourceMidi = sourceMidiForCell(cell);
    const voiceIndex = cell.voiceIndex ?? 0;
    const pitchClasses = rootlessPitchClasses(span, harmonic);
    const pitchClass = cell.sublayer === 'foundation' ? bassPc(span) : pitchClasses[voiceIndex];
    const pitch = cell.sublayer === 'foundation'
      ? fitGesturePitch(sourceMidi, pitchClass, foundationRange, 0)
      : upperByPhase.get(phaseTick)?.[voiceIndex];
    if (pitch === undefined) throw new RangeError(`Jazz 5/4 Comp has no voicing at bar ${bar.absoluteBar}:${phaseTick}`);
    const eventId = `j54-gen:${bar.absoluteBar}:comp:${cell.id}`;
    eventIds.push(eventId);
    addEvent(target, {
      eventId,
      role: 'comp',
      sectionId: bar.sectionId,
      barInSection: bar.barInSection,
      absoluteBar: bar.absoluteBar,
      nominalTick,
      phaseTick,
      durationTicks: cell.gate.engineTicks,
      velocity,
      pitchIntent: cell.sublayer === 'foundation'
        ? {
            kind: 'harmony-bass-anchor', chordSpanId: span.id, pitchClass,
            registerGesture: { kind: 'source-relative-octave', sourceMidi },
          }
        : { kind: 'rootless-chord-tone', chordSpanId: span.id, pitchClass, voiceIndex },
    }, {
      pitch,
      ...instrument,
    }, {
      ...baseProvenance(score, bar, directive),
      familyId: selected.familyId,
      cellId: cell.id,
      ...(cell.provenance.sourceSha256 === undefined ? {} : { sourceSha256: cell.provenance.sourceSha256 }),
      harmonicSpanId: span.id,
      authority: cell.provenance.authority,
      nominalTick,
      renderedTick: nominalTick,
    });
  }
  return { eventIds, familyId: selected.familyId };
}

function drumPlacementById(
  score: JazzFiveFourEnsembleScore,
): ReadonlyMap<string, DeepReadonly<JazzFiveFourWholeDrumPhraseDirective>> {
  return new Map(score.drumPhraseDirectives.map((directive) => [directive.id, directive] as const));
}

function compileDrumBar(args: {
  score: JazzFiveFourEnsembleScore;
  placements: ReadonlyMap<string, DeepReadonly<JazzFiveFourWholeDrumPhraseDirective>>;
  bar: DeepReadonly<JazzFiveFourEnsembleBarDirective>;
  directive: DeepReadonly<JazzFiveFourPerBarRoleDirective>;
  instrumentation: InstrumentationPlan;
  target: MutableCompilation;
}): { eventIds: readonly string[]; familyId: string; distinctOnsetCount: number } {
  const { score, placements, bar, directive, instrumentation, target } = args;
  if (!directive.active) return { eventIds: [], familyId: 'silent', distinctOnsetCount: 0 };
  if (directive.materialOwner !== 'drum-phrase' || !directive.drumPhraseDirectiveId
    || !Number.isInteger(directive.drumPhraseBarOffset)) {
    throw new RangeError(`Active Jazz 5/4 Drum bar ${bar.absoluteBar} has no whole-phrase owner`);
  }
  const placement = placements.get(directive.drumPhraseDirectiveId);
  if (!placement) throw new RangeError(`Unknown Drum phrase directive ${directive.drumPhraseDirectiveId}`);
  const pattern = jazzFiveFourDrumPhrasePattern(placement.patternId);
  const barOffset = directive.drumPhraseBarOffset!;
  if (placement.mutationUnit !== pattern.mutationUnit || placement.spanBars !== pattern.spanBars
    || bar.absoluteBar !== placement.startBar + barOffset || barOffset < 0 || barOffset >= pattern.spanBars) {
    throw new RangeError(`Jazz 5/4 Drum phrase placement mismatch at bar ${bar.absoluteBar}`);
  }
  const variation = variantById('drum', directive.variationId);
  assertVariationDirective(directive, variation);
  const velocityScale = Math.max(
    pattern.mutationBudget.velocityScaleMin,
    Math.min(pattern.mutationBudget.velocityScaleMax, variation.budget.velocityScale),
  );
  const hits = pattern.hits.filter((hit) => hit.barOffset === barOffset);
  if (hits.length === 0) throw new RangeError(`Jazz 5/4 Drum phrase ${pattern.id} has an empty active bar ${barOffset}`);
  const instrument = roleInstrument(instrumentation, 'drum', bar.sectionId);
  const eventIds: string[] = [];
  for (const hit of hits) {
    const intent = JAZZ_FIVE_FOUR_PHRASE_DRUM_INTENTS[hit.kitIntentId];
    const phaseTick = hit.phaseTick;
    const nominalTick = bar.absoluteBar * BAR_TICKS + phaseTick;
    const eventId = `j54-gen:${bar.absoluteBar}:drum:${placement.id}:${hit.id}`;
    const velocity = clampMidiVelocity(hit.velocity * velocityScale);
    eventIds.push(eventId);
    addEvent(target, {
      eventId,
      role: 'drum',
      sectionId: bar.sectionId,
      barInSection: bar.barInSection,
      absoluteBar: bar.absoluteBar,
      nominalTick,
      phaseTick,
      durationTicks: hit.gateTicks,
      velocity,
      pitchIntent: {
        kind: 'drum-kit-intent',
        kitIntentId: hit.kitIntentId,
        semanticVoice: intent.semanticVoice,
      },
    }, {
      pitch: intent.preferredGmPitch,
      ...instrument,
    }, {
      ...baseProvenance(score, bar, directive),
      familyId: `kb.drum.jazz_5_4.${pattern.family}`,
      cellId: hit.id,
      sourceSha256: pattern.provenance.sourceSha256,
      authority: pattern.provenance.authority,
      drumPhraseDirectiveId: placement.id,
      drumPhrasePatternId: pattern.id,
      nominalTick,
      renderedTick: nominalTick,
    });
  }
  return {
    eventIds,
    familyId: `kb.drum.jazz_5_4.${pattern.family}`,
    distinctOnsetCount: new Set(hits.map((hit) => hit.phaseTick)).size,
  };
}

function buildTimingLinks(
  events: readonly InstrumentResolvedEvent[],
  score: JazzFiveFourEnsembleScore,
): { readonly links: TimingLink[]; readonly linkByEventId: Readonly<Record<string, string>> } {
  const links: TimingLink[] = [];
  const linkByEventId: Record<string, string> = {};
  const byBar = new Map<number, InstrumentResolvedEvent[]>();
  for (const event of events) {
    const list = byBar.get(event.absoluteBar) ?? [];
    list.push(event);
    byBar.set(event.absoluteBar, list);
  }
  for (const [absoluteBar, barEvents] of byBar) {
    const bar = score.barDirectives[absoluteBar];
    if (!bar) throw new RangeError(`Jazz 5/4 timing has no Arranger bar ${absoluteBar}`);
    const foundationRole = bar.foundationMode === 'keyboardBassOnly' ? 'bass'
      : JAZZ_FIVE_FOUR_FOUNDATION_MODES[bar.foundationMode].compFoundationActive ? 'comp' : undefined;
    if (foundationRole) {
      const foundation = barEvents.filter((event) => event.role === foundationRole && event.phaseTick === 785);
      const drum = barEvents.filter((event) => event.role === 'drum' && event.phaseTick === 800);
      if (foundation.length > 0 && drum.length > 0) {
        const id = `j54-gen:link:${absoluteBar}:flam-785-800`;
        const members = [...foundation, ...drum].map((event) => ({
          eventId: event.eventId,
          offsetTicks: event.phaseTick - 785,
        }));
        links.push({
          id,
          kind: 'flam',
          anchorNominalTick: absoluteBar * BAR_TICKS + 785,
          members,
          residualPolicy: ZERO_RESIDUAL_POLICY,
        });
        for (const member of members) linkByEventId[member.eventId] = id;
      }
    }
    const byTick = new Map<number, InstrumentResolvedEvent[]>();
    for (const event of barEvents) {
      if (linkByEventId[event.eventId]) continue;
      const members = byTick.get(event.nominalTick) ?? [];
      members.push(event);
      byTick.set(event.nominalTick, members);
    }
    for (const [tick, members] of byTick) {
      if (new Set(members.map((event) => event.role)).size < 2) continue;
      const id = `j54-gen:link:${absoluteBar}:exact-${tick % BAR_TICKS}`;
      links.push({
        id,
        kind: 'exact',
        anchorNominalTick: tick,
        members: members.map((event) => ({ eventId: event.eventId, offsetTicks: 0 })),
        residualPolicy: ZERO_RESIDUAL_POLICY,
      });
      for (const event of members) linkByEventId[event.eventId] = id;
    }
  }
  links.sort((left, right) => left.anchorNominalTick - right.anchorNominalTick || left.id.localeCompare(right.id));
  return { links, linkByEventId };
}

function assertInput(args: CompileJazzFiveFourRhythmSectionArgs): JazzFiveFourEnsembleScore {
  if (args.arrangement.meter.numerator !== 5 || args.arrangement.meter.denominator !== 4) {
    throw new RangeError('Jazz 5/4 ensemble ScoreCompiler requires ArrangementPlan meter 5/4');
  }
  const score = args.arrangement.jazzFiveFourEnsembleScore;
  if (!score) throw new RangeError('Jazz 5/4 ensemble ScoreCompiler requires an Arranger-frozen ensemble score');
  const totalBars = args.arrangement.sections.reduce((sum, section) => sum + section.bars, 0);
  if (score.totalBars !== totalBars || score.barDirectives.length !== totalBars) {
    throw new RangeError(`Jazz 5/4 ensemble score covers ${score.barDirectives.length}/${totalBars} Arrangement bars`);
  }
  for (const bar of score.barDirectives) {
    if (bar.absoluteBar < 0 || bar.absoluteBar >= totalBars
      || bar.absoluteBar * BAR_TICKS < 0
      || bar.activeRoles.join('|') !== bar.roleDirectives.filter((role) => role.active).map((role) => role.role).join('|')) {
      throw new RangeError(`Invalid Jazz 5/4 ensemble directive at absolute bar ${bar.absoluteBar}`);
    }
    const policy = JAZZ_FIVE_FOUR_FOUNDATION_MODES[bar.foundationMode];
    if (bar.foundationOwner !== policy.foundationOwner
      || !jazzFiveFourBarRoleDirective(bar, bar.foundationOwner).active) {
      throw new RangeError(`Jazz 5/4 ensemble foundation hole at absolute bar ${bar.absoluteBar}`);
    }
  }
  return score;
}

/**
 * Pure post-Arranger compiler.  Randomness is intentionally absent: every
 * material/form decision must already exist in jazzFiveFourEnsembleScore.
 */
export function compileJazzFiveFourRhythmSection(
  args: CompileJazzFiveFourRhythmSectionArgs,
): JazzFiveFourRhythmSectionCompilation {
  const score = assertInput(args);
  const target: MutableCompilation = {
    semanticEvents: [],
    instrumentEvents: [],
    roleBars: [],
    drumBars: [],
    provenanceByEventId: {},
  };
  const placements = drumPlacementById(score);
  const voiceState: CompVoiceState = {};

  for (const bar of score.barDirectives) {
    const barStartTick = bar.absoluteBar * BAR_TICKS;
    const bassDirective = jazzFiveFourBarRoleDirective(bar, 'bass');
    const compDirective = jazzFiveFourBarRoleDirective(bar, 'comp');
    const drumDirective = jazzFiveFourBarRoleDirective(bar, 'drum');
    const bass = compileBassBar({
      score, bar, directive: bassDirective, harmonic: args.harmonic,
      instrumentation: args.instrumentation, target,
    });
    const comp = compileCompBar({
      score, bar, directive: compDirective, harmonic: args.harmonic,
      instrumentation: args.instrumentation, target, voiceState,
    });
    const drum = compileDrumBar({
      score, placements, bar, directive: drumDirective,
      instrumentation: args.instrumentation, target,
    });
    const variantId = score.mode === 'canonical-reference' ? 'source-canonical' : 'seed-generated';
    target.roleBars.push({
      role: 'bass', sectionId: bar.sectionId, barInSection: bar.barInSection,
      absoluteBar: bar.absoluteBar, barStartTick, active: bassDirective.active,
      familyId: bass.familyId, variantId, eventIds: [...bass.eventIds],
    });
    target.roleBars.push({
      role: 'comp', sectionId: bar.sectionId, barInSection: bar.barInSection,
      absoluteBar: bar.absoluteBar, barStartTick, active: compDirective.active,
      familyId: comp.familyId, variantId, eventIds: [...comp.eventIds],
    });
    target.drumBars.push({
      role: 'drum', sectionId: bar.sectionId, barInSection: bar.barInSection,
      absoluteBar: bar.absoluteBar, barStartTick, active: drumDirective.active,
      familyId: drum.familyId, variantId, eventIds: [...drum.eventIds],
      hitCount: drum.eventIds.length, distinctOnsetCount: drum.distinctOnsetCount,
    });
  }

  const timing = buildTimingLinks(target.instrumentEvents, score);
  const semanticEvents = target.semanticEvents.map((event) => ({
    ...event,
    ...(timing.linkByEventId[event.eventId] === undefined
      ? {} : { timingLinkId: timing.linkByEventId[event.eventId] }),
  }));
  const instrumentEvents = target.instrumentEvents.map((event) => ({
    ...event,
    ...(timing.linkByEventId[event.eventId] === undefined
      ? {} : { timingLinkId: timing.linkByEventId[event.eventId] }),
  }));
  const performanceEvents: PerformedScoredEvent[] = instrumentEvents.map((event) => ({
    eventId: event.eventId,
    instrumentEventId: event.eventId,
    role: event.role,
    tick: event.nominalTick,
    durationTicks: event.durationTicks,
    velocity: event.velocity,
    pitch: event.pitch,
    program: event.program,
    ...(event.bank === undefined ? {} : { bank: event.bank }),
  }));

  return deepFreeze({
    semanticEvents,
    instrumentEvents,
    performanceEvents,
    roleBars: target.roleBars,
    drumBars: target.drumBars,
    timingLinks: timing.links,
    provenanceByEventId: target.provenanceByEventId,
  });
}

/** Direct integration entry: a complete, validation-clean score without Lead. */
export function compileJazzFiveFourEnsembleScore(
  args: CompileJazzFiveFourRhythmSectionArgs,
): JazzFiveFourScorePlan {
  const ensembleScore = assertInput(args);
  const rhythm = compileJazzFiveFourRhythmSection(args);
  const data: JazzFiveFourScorePlanData = {
    schemaVersion: JAZZ_FIVE_FOUR_SCORE_SCHEMA_VERSION,
    compilationMode: ensembleScore.mode,
    foundationMode: ensembleScore.mode === 'canonical-reference'
      ? 'acoustic-bass+full-piano'
      : 'arranger-per-bar',
    clock: {
      ppq: PPQ,
      meter: { numerator: 5, denominator: 4 },
      grouping: [3, 2],
      ticksPerBar: BAR_TICKS,
      groupBoundaryTick: JAZZ_FIVE_FOUR_GROUP_BOUNDARY_TICKS,
      barOriginPolicy: 'song-global',
      totalBars: ensembleScore.totalBars,
    },
    semanticEvents: rhythm.semanticEvents.map((event) => ({ ...event })),
    instrumentEvents: rhythm.instrumentEvents.map((event) => ({ ...event })),
    performance: {
      mode: 'reference-zero',
      events: rhythm.performanceEvents.map((event) => ({ ...event })),
    },
    roleBars: rhythm.roleBars.map((bar) => ({ ...bar, eventIds: [...bar.eventIds] })),
    drumBars: rhythm.drumBars.map((bar) => ({ ...bar, eventIds: [...bar.eventIds] })),
    timingLinks: rhythm.timingLinks.map((link) => ({
      ...link,
      members: link.members.map((member) => ({ ...member })),
      residualPolicy: { ...link.residualPolicy },
    })),
    provenanceByEventId: Object.fromEntries(
      Object.entries(rhythm.provenanceByEventId).map(([eventId, provenance]) => [eventId, { ...provenance }]),
    ),
  };
  assertValidJazzFiveFourScorePlan(data);
  return deepFreeze(data);
}
