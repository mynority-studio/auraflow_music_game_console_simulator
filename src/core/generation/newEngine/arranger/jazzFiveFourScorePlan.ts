// ============================================================
// newEngine · arranger · Jazz 5/4 post-harmony score contract
// ------------------------------------------------------------
// This is the isolated seam between Arrangement/Harmony/Instrumentation and
// final rendering.  It deliberately does not produce NoteIR and does not know
// about GenerationController.  A renderer may only project the resolved and
// performed events supplied here.
// ============================================================

import { deepFreeze, type DeepReadonly } from '../foundation';
import type { InstrumentRoleName } from '../band/BandSpec';
import type { ArrangementPlan, SectionId } from './ArrangementPlan';
import type { ChordSpan, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import {
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS,
  JAZZ_FIVE_FOUR_ROLE_BAR_TICKS,
  JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ,
  JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS,
  JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
} from '../knowledge/jazzFiveFourRoleKnowledge';
import {
  JAZZ_FIVE_FOUR_CORE_KEEP_TIME,
  jazzFiveFourDrumKitIntent,
  jazzFiveFourDrumPhaseTicks,
} from '../knowledge/jazzFiveFourDrumKnowledge';

export const JAZZ_FIVE_FOUR_SCORE_SCHEMA_VERSION = 1 as const;
export const JAZZ_FIVE_FOUR_GROUP_BOUNDARY_TICKS =
  JAZZ_FIVE_FOUR_ROLE_GROUP_BOUNDARY_TICKS;

export type JazzFiveFourScoreRole = 'bass' | 'comp' | 'lead' | 'drum';
export type JazzFiveFourFoundationMode =
  | 'acoustic-bass+full-piano'
  | 'acoustic-bass'
  | 'keyboard-foundation';
export type JazzFiveFourPerformanceMode =
  | 'reference-zero'
  | 'reference-authored-lead'
  | 'score-budgeted';

export type SemanticPitchIntent =
  | {
      kind: 'harmony-bass-anchor';
      chordSpanId: string;
      pitchClass: number;
      registerGesture: {
        kind: 'source-relative-octave';
        sourceMidi: number;
      };
    }
  | {
      kind: 'rootless-chord-tone';
      chordSpanId: string;
      pitchClass: number;
      voiceIndex: 0 | 1 | 2;
    }
  | {
      kind: 'drum-kit-intent';
      kitIntentId: string;
      semanticVoice: 'kick' | 'snare' | 'ride' | 'tom';
    }
  | {
      kind: 'grammar-lead';
      chordSpanId: string;
      semanticAtom: string;
      grammarTokenKind: string;
    };

/** One authored musical action before a concrete instrument/register is attached. */
export interface SemanticScoredEvent {
  eventId: string;
  role: JazzFiveFourScoreRole;
  sectionId: SectionId;
  barInSection: number;
  absoluteBar: number;
  nominalTick: number;
  phaseTick: number;
  durationTicks: number;
  velocity: number;
  pitchIntent: SemanticPitchIntent;
  timingLinkId?: string;
}

/** One fully pitched/programmed event; performance has not moved it yet. */
export interface InstrumentResolvedEvent {
  eventId: string;
  semanticEventId: string;
  role: JazzFiveFourScoreRole;
  sectionId: SectionId;
  barInSection: number;
  absoluteBar: number;
  nominalTick: number;
  phaseTick: number;
  durationTicks: number;
  velocity: number;
  pitch: number;
  program: number;
  bank?: number;
  timingLinkId?: string;
}

export interface PerformedScoredEvent {
  eventId: string;
  instrumentEventId: string;
  role: JazzFiveFourScoreRole;
  tick: number;
  durationTicks: number;
  velocity: number;
  pitch: number;
  program: number;
  bank?: number;
}

export type TimingResidualPolicy =
  | {
      mode: 'reference-zero';
      owner: 'performance';
      maxAbsTicks: 0;
      applyOnce: true;
      preserveMemberOffsets: true;
    }
  | {
      mode: 'shared-bounded';
      owner: 'performance';
      maxAbsTicks: number;
      applyOnce: true;
      preserveMemberOffsets: true;
    };

export interface TimingLinkMember {
  eventId: string;
  /** Fixed offset from anchorNominalTick; Performance may not alter it. */
  offsetTicks: number;
}

/** Exact members share an onset; flam members retain authored relative offsets. */
export interface TimingLink {
  id: string;
  kind: 'exact' | 'flam';
  anchorNominalTick: number;
  members: readonly TimingLinkMember[];
  residualPolicy: TimingResidualPolicy;
}

export interface ScoreEventProvenance {
  eventId: string;
  role: JazzFiveFourScoreRole;
  sectionId: SectionId;
  absoluteBar: number;
  familyId: string;
  variantId: 'source-canonical' | 'seed-generated';
  cellId: string;
  /** Present for MIDI-derived material; honest generative extensions leave it absent. */
  sourceSha256?: string;
  harmonicSpanId?: string;
  authority: 'midi-derived-kb' | 'generative-extension' | 'arranger-grammar-score';
  /** Arranger total-score trace for Bass/Comp/Drum generative material. */
  ensembleDirectiveId?: string;
  phraseId?: string;
  foundationMode?: 'keyboardBassOnly' | 'compOwnsFoundation' | 'acousticBass+upperComp' | 'acousticBass+fullPiano';
  foundationOwner?: 'bass' | 'comp';
  interactionCueId?: string;
  textureVariantId?: string;
  drumPhraseDirectiveId?: string;
  drumPhrasePatternId?: string;
  /** Lead-only provenance. MIDI-derived rhythm roles leave these absent. */
  directiveId?: string;
  phraseIds?: readonly string[];
  rhythmTemplateId?: string;
  rhythmSlotId?: string;
  grammarFamilyId?: string;
  grammarRulePath?: readonly string[];
  grammarTokenId?: string;
  grammarTokenKind?: string;
  semanticAtom?: string;
  harmonicBrickIndex?: number;
  harmonicBrickName?: string;
  harmonicBrickFamily?: string;
  nominalChordSpanId?: string;
  nominalTick?: number;
  renderedTick?: number;
}

/** Sidecar trace: FinalIR stays small and does not absorb creative metadata. */
export type ScoreProvenanceMap = Readonly<Record<string, ScoreEventProvenance>>;

export interface RoleBarScore {
  role: Exclude<JazzFiveFourScoreRole, 'drum'>;
  sectionId: SectionId;
  barInSection: number;
  absoluteBar: number;
  barStartTick: number;
  active: boolean;
  familyId: string;
  variantId: 'source-canonical' | 'seed-generated';
  eventIds: readonly string[];
}

export interface DrumBarScore {
  role: 'drum';
  sectionId: SectionId;
  barInSection: number;
  absoluteBar: number;
  barStartTick: number;
  active: boolean;
  familyId: string;
  variantId: 'source-canonical' | 'seed-generated';
  eventIds: readonly string[];
  hitCount: number;
  distinctOnsetCount: number;
}

export interface JazzFiveFourScoreClock {
  ppq: typeof JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ;
  meter: { numerator: 5; denominator: 4 };
  grouping: readonly [3, 2];
  ticksPerBar: typeof JAZZ_FIVE_FOUR_ROLE_BAR_TICKS;
  groupBoundaryTick: typeof JAZZ_FIVE_FOUR_GROUP_BOUNDARY_TICKS;
  barOriginPolicy: 'song-global';
  totalBars: number;
}

export interface JazzFiveFourScorePlanData {
  schemaVersion: typeof JAZZ_FIVE_FOUR_SCORE_SCHEMA_VERSION;
  compilationMode: 'canonical-reference' | 'generative';
  /** Canonical Gate-G identity or an explicit marker that ownership varies per Arranger bar. */
  foundationMode: JazzFiveFourFoundationMode | 'arranger-per-bar';
  clock: JazzFiveFourScoreClock;
  semanticEvents: SemanticScoredEvent[];
  instrumentEvents: InstrumentResolvedEvent[];
  performance: {
    mode: JazzFiveFourPerformanceMode;
    events: PerformedScoredEvent[];
  };
  roleBars: RoleBarScore[];
  drumBars: DrumBarScore[];
  timingLinks: TimingLink[];
  provenanceByEventId: Record<string, ScoreEventProvenance>;
}

export type JazzFiveFourScorePlan = DeepReadonly<JazzFiveFourScorePlanData>;

export interface JazzFiveFourScoreValidationIssue {
  code:
    | 'clock'
    | 'duplicate-event-id'
    | 'event-position'
    | 'event-reference'
    | 'provenance'
    | 'bar-score'
    | 'timing-link'
    | 'reference-zero';
  path: string;
  message: string;
}

export interface BuildJazzFiveFourScorePlanOptions {
  /** Integration must opt in from an explicit archetype; meter alone is not a style switch. */
  enabled: boolean;
  mode: 'canonical-reference';
  performanceMode: 'reference-zero';
  foundationMode?: JazzFiveFourFoundationMode;
}

export interface BuildJazzFiveFourScorePlanArgs {
  arrangement: ArrangementPlan;
  harmonic: HarmonicPlan;
  instrumentation: InstrumentationPlan;
  options: BuildJazzFiveFourScorePlanOptions;
}

const REFERENCE_ZERO_POLICY: TimingResidualPolicy = Object.freeze({
  mode: 'reference-zero',
  owner: 'performance',
  maxAbsTicks: 0,
  applyOnce: true,
  preserveMemberOffsets: true,
});

const DEFAULT_REGISTERS: Record<'bass' | 'comp', { lowMidi: number; highMidi: number }> = {
  bass: { lowMidi: 34, highMidi: 52 },
  comp: { lowMidi: 52, highMidi: 76 },
};

function roleProgram(
  instrumentation: InstrumentationPlan,
  role: InstrumentRoleName,
  sectionId: string,
): { program: number; bank?: number } {
  return {
    program: instrumentation.programByRoleSection?.[role]?.[sectionId]
      ?? instrumentation.roleProgram?.[role]
      ?? (role === 'bass' ? 32 : 0),
    bank: instrumentation.bankByRoleSection?.[role]?.[sectionId]
      ?? instrumentation.roleBank?.[role],
  };
}

function registerFor(
  instrumentation: InstrumentationPlan,
  role: 'bass' | 'comp',
): { lowMidi: number; highMidi: number } {
  const range = instrumentation.strictRegisterByRole?.[role]
    ?? instrumentation.registerByRole?.[role]
    ?? DEFAULT_REGISTERS[role];
  return { lowMidi: Number(range.lowMidi), highMidi: Number(range.highMidi) };
}

function chordAtTick(harmonic: HarmonicPlan, tick: number): ChordSpan | undefined {
  const beat = tick / JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ;
  return harmonic.chordTimeline.find((span) => {
    const start = Number(span.startBeat);
    return beat >= start && beat < start + Number(span.durationBeats);
  }) as ChordSpan | undefined;
}

function bassPitchClass(span: ChordSpan): number {
  return Number(span.bassPc ?? span.bassPedalPc ?? span.rootPc);
}

function midiAtOrAbove(pitchClass: number, floor: number): number {
  const normalizedPc = ((pitchClass % 12) + 12) % 12;
  return floor + ((normalizedPc - (floor % 12) + 12) % 12);
}

/** Preserve the source cell's high/low octave gesture while transposing its root. */
function fitEvidenceGesturePitch(
  sourceMidi: number,
  targetPitchClass: number,
  range: { lowMidi: number; highMidi: number },
): number {
  const sourcePc = ((sourceMidi % 12) + 12) % 12;
  const delta = ((targetPitchClass - sourcePc + 18) % 12) - 6;
  let value = sourceMidi + delta;
  while (value < range.lowMidi) value += 12;
  while (value > range.highMidi) value -= 12;
  if (value < range.lowMidi || value > range.highMidi) {
    throw new RangeError(`Jazz 5/4 source register gesture ${sourceMidi} cannot fit ${range.lowMidi}..${range.highMidi}`);
  }
  return value;
}

function compPitchClasses(span: ChordSpan, harmonic: HarmonicPlan): readonly number[] {
  const root = Number(span.rootPc);
  const stable = [...new Set((harmonic.stableToneMap[span.id] ?? []).map(Number))];
  const rootless = stable.filter((pitchClass) => pitchClass !== root);
  const fallbackIntervals = span.quality === 'min' || span.quality === 'm7'
    ? [3, 7, 10]
    : span.quality === 'm7b5' || span.quality === 'dim7'
      ? [3, 6, 10]
      : [4, 7, 10];
  const fallback = fallbackIntervals.map((interval) => (root + interval) % 12);
  return [...new Set([...rootless, ...fallback])].slice(0, 3);
}

function fitAscendingChord(
  pitchClasses: readonly number[],
  range: { lowMidi: number; highMidi: number },
): readonly [number, number, number] {
  const result: number[] = [];
  let floor = range.lowMidi;
  for (const pitchClass of pitchClasses.slice(0, 3)) {
    const pitch = midiAtOrAbove(pitchClass, floor);
    result.push(pitch);
    floor = pitch + 1;
  }
  if (result.length !== 3 || result.some((pitch) => pitch > range.highMidi)) {
    throw new RangeError(`Jazz 5/4 comp shell cannot fit ${range.lowMidi}..${range.highMidi}`);
  }
  return result as [number, number, number];
}

function activeRole(
  instrumentation: InstrumentationPlan,
  sectionId: string,
  role: JazzFiveFourScoreRole,
): boolean {
  return (instrumentation.activeRolesBySection?.[sectionId] ?? []).includes(role);
}

interface MutableCompilation {
  semanticEvents: SemanticScoredEvent[];
  instrumentEvents: InstrumentResolvedEvent[];
  provenanceByEventId: Record<string, ScoreEventProvenance>;
}

function addEvent(
  target: MutableCompilation,
  semantic: SemanticScoredEvent,
  resolved: Omit<InstrumentResolvedEvent, 'eventId' | 'semanticEventId' | 'role' | 'sectionId' | 'barInSection' | 'absoluteBar' | 'nominalTick' | 'phaseTick' | 'durationTicks' | 'velocity'>,
  provenance: Omit<ScoreEventProvenance, 'eventId' | 'role' | 'sectionId' | 'absoluteBar'>,
): void {
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
    ...resolved,
  });
  target.provenanceByEventId[semantic.eventId] = {
    eventId: semantic.eventId,
    role: semantic.role,
    sectionId: semantic.sectionId,
    absoluteBar: semantic.absoluteBar,
    ...provenance,
  };
}

function buildTimingLinks(
  events: readonly InstrumentResolvedEvent[],
  foundationMode: JazzFiveFourFoundationMode,
): { links: TimingLink[]; linkIdByEventId: Record<string, string> } {
  const links: TimingLink[] = [];
  const linkIdByEventId: Record<string, string> = {};
  const byBar = new Map<number, InstrumentResolvedEvent[]>();
  for (const event of events) {
    const list = byBar.get(event.absoluteBar) ?? [];
    list.push(event);
    byBar.set(event.absoluteBar, list);
  }

  for (const [absoluteBar, barEvents] of byBar) {
    // Source keyboard foundation at 785 and snare at 800 are an authored
    // 15-tick flam. Acoustic bass does not participate in this relationship.
    if (foundationMode === 'keyboard-foundation' || foundationMode === 'acoustic-bass+full-piano') {
      const foundationRole = foundationMode === 'keyboard-foundation' ? 'bass' : 'comp';
      const foundation = barEvents.filter((event) => event.role === foundationRole && event.phaseTick === 785);
      const snare = barEvents.filter((event) => event.role === 'drum' && event.phaseTick === 800);
      if (foundation.length > 0 && snare.length > 0) {
        const members = [...foundation, ...snare].map((event) => ({
          eventId: event.eventId,
          offsetTicks: event.phaseTick - 785,
        }));
        const id = `j54:link:bar-${absoluteBar}:flam-785-800`;
        links.push({
          id,
          kind: 'flam',
          anchorNominalTick: absoluteBar * JAZZ_FIVE_FOUR_ROLE_BAR_TICKS + 785,
          members,
          residualPolicy: REFERENCE_ZERO_POLICY,
        });
        for (const member of members) linkIdByEventId[member.eventId] = id;
      }
    }

    const byTick = new Map<number, InstrumentResolvedEvent[]>();
    for (const event of barEvents) {
      if (linkIdByEventId[event.eventId]) continue;
      const list = byTick.get(event.nominalTick) ?? [];
      list.push(event);
      byTick.set(event.nominalTick, list);
    }
    for (const [tick, membersAtTick] of byTick) {
      if (new Set(membersAtTick.map((event) => event.role)).size < 2) continue;
      const id = `j54:link:bar-${absoluteBar}:exact-${tick % JAZZ_FIVE_FOUR_ROLE_BAR_TICKS}`;
      const members = membersAtTick.map((event) => ({ eventId: event.eventId, offsetTicks: 0 }));
      links.push({
        id,
        kind: 'exact',
        anchorNominalTick: tick,
        members,
        residualPolicy: REFERENCE_ZERO_POLICY,
      });
      for (const member of members) linkIdByEventId[member.eventId] = id;
    }
  }
  links.sort((left, right) => left.anchorNominalTick - right.anchorNominalTick || left.kind.localeCompare(right.kind));
  return { links, linkIdByEventId };
}

/**
 * Pure canonical compiler. Returning undefined when disabled makes archetype
 * selection an explicit caller decision rather than a hidden 5/4 style check.
 */
export function buildJazzFiveFourScorePlan(
  args: BuildJazzFiveFourScorePlanArgs,
): JazzFiveFourScorePlan | undefined {
  if (!args.options.enabled) return undefined;
  if (args.arrangement.meter.numerator !== 5 || args.arrangement.meter.denominator !== 4) {
    throw new RangeError('buildJazzFiveFourScorePlan requires an explicit 5/4 ArrangementPlan');
  }

  const foundationMode = args.options.foundationMode ?? 'acoustic-bass+full-piano';
  const compilation: MutableCompilation = {
    semanticEvents: [],
    instrumentEvents: [],
    provenanceByEventId: {},
  };
  const roleBars: RoleBarScore[] = [];
  const drumBars: DrumBarScore[] = [];
  let absoluteBar = 0;

  const bassCells = foundationMode === 'keyboard-foundation'
    ? JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS
    : JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS;
  const bassFamilyId = bassCells[0].family;
  const compCells = JAZZ_FIVE_FOUR_UPPER_COMP_CELLS;

  for (const section of args.arrangement.sections) {
    const bassActive = activeRole(args.instrumentation, section.id, 'bass');
    const compActive = activeRole(args.instrumentation, section.id, 'comp');
    const drumActive = activeRole(args.instrumentation, section.id, 'drum');
    const bassInstrument = roleProgram(args.instrumentation, 'bass', section.id);
    const compInstrument = roleProgram(args.instrumentation, 'comp', section.id);
    const drumInstrument = roleProgram(args.instrumentation, 'drum', section.id);
    const bassRange = registerFor(args.instrumentation, 'bass');
    const compRange = registerFor(args.instrumentation, 'comp');

    for (let barInSection = 0; barInSection < section.bars; barInSection++, absoluteBar++) {
      const barStartTick = absoluteBar * JAZZ_FIVE_FOUR_ROLE_BAR_TICKS;
      const bassEventIds: string[] = [];
      const compEventIds: string[] = [];
      const drumEventIds: string[] = [];

      if (bassActive) {
        for (const cell of bassCells) {
          const phaseTick = cell.phase.engineTicks;
          const nominalTick = barStartTick + phaseTick;
          const span = chordAtTick(args.harmonic, nominalTick);
          if (!span) throw new RangeError(`No HarmonicPlan span at Jazz 5/4 bass tick ${nominalTick}`);
          const pitchClass = bassPitchClass(span);
          const eventId = `j54:${section.id}:bar-${barInSection}:bass:${cell.cellId}`;
          bassEventIds.push(eventId);
          addEvent(compilation, {
            eventId,
            role: 'bass',
            sectionId: section.id,
            barInSection,
            absoluteBar,
            nominalTick,
            phaseTick,
            durationTicks: cell.duration.engineTicks,
            velocity: cell.velocity,
            pitchIntent: {
              kind: 'harmony-bass-anchor', chordSpanId: span.id, pitchClass,
              registerGesture: {
                kind: 'source-relative-octave',
                sourceMidi: cell.registerGesture.sourceMidi,
              },
            },
          }, {
            pitch: fitEvidenceGesturePitch(cell.registerGesture.sourceMidi, pitchClass, bassRange),
            ...bassInstrument,
          }, {
            familyId: cell.family,
            variantId: 'source-canonical',
            cellId: cell.cellId,
            sourceSha256: cell.sourceSha256,
            harmonicSpanId: span.id,
            authority: 'midi-derived-kb',
          });
        }
      }

      if (compActive) {
        if (foundationMode === 'acoustic-bass+full-piano') {
          for (const cell of JAZZ_FIVE_FOUR_PIANO_FOUNDATION_CELLS) {
            const phaseTick = cell.phase.engineTicks;
            const nominalTick = barStartTick + phaseTick;
            const span = chordAtTick(args.harmonic, nominalTick);
            if (!span) throw new RangeError(`No HarmonicPlan span at Jazz 5/4 piano-foundation tick ${nominalTick}`);
            const pitchClass = bassPitchClass(span);
            const eventId = `j54:${section.id}:bar-${barInSection}:comp-foundation:${cell.cellId}`;
            compEventIds.push(eventId);
            addEvent(compilation, {
              eventId,
              role: 'comp',
              sectionId: section.id,
              barInSection,
              absoluteBar,
              nominalTick,
              phaseTick,
              durationTicks: cell.duration.engineTicks,
              velocity: cell.velocity,
              pitchIntent: {
                kind: 'harmony-bass-anchor', chordSpanId: span.id, pitchClass,
                registerGesture: {
                  kind: 'source-relative-octave',
                  sourceMidi: cell.registerGesture.sourceMidi,
                },
              },
            }, {
              // Full-piano foundation shares the comp instrument but occupies
              // the low foundation register represented by the bass range.
              pitch: fitEvidenceGesturePitch(cell.registerGesture.sourceMidi, pitchClass, bassRange),
              ...compInstrument,
            }, {
              familyId: cell.family,
              variantId: 'source-canonical',
              cellId: cell.cellId,
              sourceSha256: cell.sourceSha256,
              harmonicSpanId: span.id,
              authority: 'midi-derived-kb',
            });
          }
        }
        for (const cell of compCells) {
          const phaseTick = cell.phase.engineTicks;
          const nominalTick = barStartTick + phaseTick;
          const span = chordAtTick(args.harmonic, nominalTick);
          if (!span) throw new RangeError(`No HarmonicPlan span at Jazz 5/4 comp tick ${nominalTick}`);
          const voiceIndex = cell.semanticAction.voiceIndex;
          const chordPcs = compPitchClasses(span, args.harmonic);
          const chordPitches = fitAscendingChord(chordPcs, compRange);
          const pitchClass = chordPcs[voiceIndex]!;
          const eventId = `j54:${section.id}:bar-${barInSection}:comp:${cell.cellId}`;
          compEventIds.push(eventId);
          addEvent(compilation, {
            eventId,
            role: 'comp',
            sectionId: section.id,
            barInSection,
            absoluteBar,
            nominalTick,
            phaseTick,
            durationTicks: cell.duration.engineTicks,
            velocity: cell.velocity,
            pitchIntent: { kind: 'rootless-chord-tone', chordSpanId: span.id, pitchClass, voiceIndex },
          }, {
            pitch: chordPitches[voiceIndex],
            ...compInstrument,
          }, {
            familyId: cell.family,
            variantId: 'source-canonical',
            cellId: cell.cellId,
            sourceSha256: cell.sourceSha256,
            harmonicSpanId: span.id,
            authority: 'midi-derived-kb',
          });
        }
      }

      if (drumActive) {
        for (const hit of JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits) {
          const phaseTick = jazzFiveFourDrumPhaseTicks(hit.phaseBeats);
          const nominalTick = barStartTick + phaseTick;
          const kitIntent = jazzFiveFourDrumKitIntent(hit.kitIntentId);
          const eventId = `j54:${section.id}:bar-${barInSection}:drum:${hit.id}`;
          drumEventIds.push(eventId);
          addEvent(compilation, {
            eventId,
            role: 'drum',
            sectionId: section.id,
            barInSection,
            absoluteBar,
            nominalTick,
            phaseTick,
            durationTicks: hit.gate.referenceTicks,
            velocity: hit.velocity,
            pitchIntent: {
              kind: 'drum-kit-intent',
              kitIntentId: hit.kitIntentId,
              semanticVoice: kitIntent.voice,
            },
          }, {
            pitch: kitIntent.preferredGmPitch,
            ...drumInstrument,
          }, {
            familyId: JAZZ_FIVE_FOUR_CORE_KEEP_TIME.id,
            variantId: 'source-canonical',
            cellId: hit.id,
            sourceSha256: JAZZ_FIVE_FOUR_CORE_KEEP_TIME.source.sha256,
            authority: 'midi-derived-kb',
          });
        }
      }

      roleBars.push({
        role: 'bass', sectionId: section.id, barInSection, absoluteBar, barStartTick,
        active: bassActive, familyId: bassFamilyId, variantId: 'source-canonical', eventIds: bassEventIds,
      });
      roleBars.push({
        role: 'comp', sectionId: section.id, barInSection, absoluteBar, barStartTick,
        active: compActive, familyId: compCells[0].family,
        variantId: 'source-canonical', eventIds: compEventIds,
      });
      drumBars.push({
        role: 'drum', sectionId: section.id, barInSection, absoluteBar, barStartTick,
        active: drumActive, familyId: JAZZ_FIVE_FOUR_CORE_KEEP_TIME.id,
        variantId: 'source-canonical', eventIds: drumEventIds,
        hitCount: drumEventIds.length,
        distinctOnsetCount: new Set(
          compilation.instrumentEvents
            .filter((event) => drumEventIds.includes(event.eventId))
            .map((event) => event.nominalTick),
        ).size,
      });
    }
  }

  const timing = buildTimingLinks(compilation.instrumentEvents, foundationMode);
  const semanticEvents = compilation.semanticEvents.map((event) => ({
    ...event,
    timingLinkId: timing.linkIdByEventId[event.eventId],
  }));
  const instrumentEvents = compilation.instrumentEvents.map((event) => ({
    ...event,
    timingLinkId: timing.linkIdByEventId[event.eventId],
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

  const data: JazzFiveFourScorePlanData = {
    schemaVersion: JAZZ_FIVE_FOUR_SCORE_SCHEMA_VERSION,
    compilationMode: 'canonical-reference',
    foundationMode,
    clock: {
      ppq: JAZZ_FIVE_FOUR_ROLE_ENGINE_PPQ,
      meter: { numerator: 5, denominator: 4 },
      grouping: [3, 2],
      ticksPerBar: JAZZ_FIVE_FOUR_ROLE_BAR_TICKS,
      groupBoundaryTick: JAZZ_FIVE_FOUR_GROUP_BOUNDARY_TICKS,
      barOriginPolicy: 'song-global',
      totalBars: absoluteBar,
    },
    semanticEvents,
    instrumentEvents,
    performance: { mode: args.options.performanceMode, events: performanceEvents },
    roleBars,
    drumBars,
    timingLinks: timing.links,
    provenanceByEventId: compilation.provenanceByEventId,
  };
  const issues = validateJazzFiveFourScorePlan(data);
  if (issues.length > 0) {
    throw new Error(`Invalid JazzFiveFourScorePlan:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n')}`);
  }
  return deepFreeze(data);
}

function issue(
  issues: JazzFiveFourScoreValidationIssue[],
  code: JazzFiveFourScoreValidationIssue['code'],
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

/** Pure fail-closed validation, also usable on serialized/debug score data. */
export function validateJazzFiveFourScorePlan(
  plan: JazzFiveFourScorePlanData | JazzFiveFourScorePlan,
): JazzFiveFourScoreValidationIssue[] {
  const issues: JazzFiveFourScoreValidationIssue[] = [];
  if (plan.compilationMode === 'generative' && plan.foundationMode !== 'arranger-per-bar') {
    issue(issues, 'bar-score', 'foundationMode', 'generative score requires explicit Arranger per-bar foundation ownership');
  }
  if (plan.compilationMode === 'canonical-reference' && plan.foundationMode === 'arranger-per-bar') {
    issue(issues, 'bar-score', 'foundationMode', 'canonical-reference score requires one canonical foundation identity');
  }
  if (
    plan.clock.ppq !== 480
    || plan.clock.meter.numerator !== 5
    || plan.clock.meter.denominator !== 4
    || plan.clock.ticksPerBar !== 2_400
    || plan.clock.groupBoundaryTick !== 1_440
    || plan.clock.grouping[0] !== 3
    || plan.clock.grouping[1] !== 2
    || plan.clock.barOriginPolicy !== 'song-global'
  ) issue(issues, 'clock', 'clock', 'Jazz 5/4 clock must be PPQ480, 2400 ticks/bar, 3+2 at tick 1440, song-global');

  const semanticById = new Map<string, SemanticScoredEvent>();
  for (const [index, event] of plan.semanticEvents.entries()) {
    if (semanticById.has(event.eventId)) {
      issue(issues, 'duplicate-event-id', `semanticEvents[${index}].eventId`, event.eventId);
    }
    semanticById.set(event.eventId, event as SemanticScoredEvent);
    if (
      !Number.isInteger(event.nominalTick)
      || event.nominalTick < 0
      || event.phaseTick !== event.nominalTick % 2_400
      || event.absoluteBar !== Math.floor(event.nominalTick / 2_400)
      || event.durationTicks <= 0
    ) issue(issues, 'event-position', `semanticEvents[${index}]`, 'event must use absolute PPQ480 song ticks and a matching bar phase');
  }

  const instrumentById = new Map<string, InstrumentResolvedEvent>();
  for (const [index, event] of plan.instrumentEvents.entries()) {
    if (instrumentById.has(event.eventId)) {
      issue(issues, 'duplicate-event-id', `instrumentEvents[${index}].eventId`, event.eventId);
    }
    instrumentById.set(event.eventId, event as InstrumentResolvedEvent);
    const semantic = semanticById.get(event.semanticEventId);
    if (!semantic) {
      issue(issues, 'event-reference', `instrumentEvents[${index}].semanticEventId`, event.semanticEventId);
    } else if (
      semantic.role !== event.role
      || semantic.nominalTick !== event.nominalTick
      || semantic.durationTicks !== event.durationTicks
      || semantic.velocity !== event.velocity
    ) issue(issues, 'event-reference', `instrumentEvents[${index}]`, 'instrument resolution changed score-owned timing/dynamics');
    if (!Number.isInteger(event.pitch) || event.pitch < 0 || event.pitch > 127) {
      issue(issues, 'event-reference', `instrumentEvents[${index}].pitch`, `${event.pitch}`);
    }
  }

  for (const eventId of semanticById.keys()) {
    if (!plan.provenanceByEventId[eventId]) issue(issues, 'provenance', `provenanceByEventId.${eventId}`, 'missing');
    if (!instrumentById.has(eventId)) issue(issues, 'event-reference', `instrumentEvents.${eventId}`, 'missing 1:1 resolution');
  }
  for (const [eventId, provenance] of Object.entries(plan.provenanceByEventId)) {
    if (!semanticById.has(eventId) || provenance.eventId !== eventId) {
      issue(issues, 'provenance', `provenanceByEventId.${eventId}`, 'orphan or mismatched provenance');
    }
    const semantic = semanticById.get(eventId);
    if (provenance.authority === 'midi-derived-kb'
      && (typeof provenance.sourceSha256 !== 'string' || provenance.sourceSha256.length === 0)) {
      issue(issues, 'provenance', `provenanceByEventId.${eventId}.sourceSha256`, 'MIDI-derived material requires a source hash');
    }
    if (semantic?.role === 'lead') {
      const requiredStrings = [
        provenance.directiveId,
        provenance.rhythmTemplateId,
        provenance.rhythmSlotId,
        provenance.grammarFamilyId,
        provenance.grammarTokenId,
        provenance.grammarTokenKind,
        provenance.semanticAtom,
        provenance.nominalChordSpanId,
      ];
      if (
        provenance.authority !== 'arranger-grammar-score'
        || provenance.variantId !== 'seed-generated'
        || requiredStrings.some((value) => typeof value !== 'string' || value.length === 0)
        || !provenance.phraseIds?.length
        || !provenance.grammarRulePath?.length
        || provenance.nominalTick !== semantic.nominalTick
        || !Number.isSafeInteger(provenance.renderedTick)
        || semantic.pitchIntent.kind !== 'grammar-lead'
        || semantic.pitchIntent.chordSpanId !== provenance.nominalChordSpanId
      ) {
        issue(issues, 'provenance', `provenanceByEventId.${eventId}`, 'incomplete Lead directive/rhythm/grammar/harmony/tick provenance');
      }
    } else if (semantic && plan.compilationMode === 'generative') {
      const requiredEnsembleStrings = [
        provenance.ensembleDirectiveId,
        provenance.phraseId,
        provenance.foundationMode,
        provenance.foundationOwner,
        provenance.interactionCueId,
      ];
      const missingRoleMaterial = (semantic.role === 'bass' || semantic.role === 'comp')
        ? typeof provenance.textureVariantId !== 'string' || provenance.textureVariantId.length === 0
        : semantic.role === 'drum'
          && (
            typeof provenance.drumPhraseDirectiveId !== 'string'
            || provenance.drumPhraseDirectiveId.length === 0
            || typeof provenance.drumPhrasePatternId !== 'string'
            || provenance.drumPhrasePatternId.length === 0
          );
      if (
        provenance.variantId !== 'seed-generated'
        || requiredEnsembleStrings.some((value) => typeof value !== 'string' || value.length === 0)
        || missingRoleMaterial
      ) {
        issue(
          issues,
          'provenance',
          `provenanceByEventId.${eventId}`,
          'incomplete generative Arranger ensemble/phrase/foundation/interaction/material provenance',
        );
      }
    }
  }

  const barReferenceCount = new Map<string, number>();
  for (const [index, bar] of [...plan.roleBars, ...plan.drumBars].entries()) {
    if (bar.barStartTick !== bar.absoluteBar * 2_400) {
      issue(issues, 'bar-score', `bars[${index}].barStartTick`, 'must use song-global absoluteBar * 2400');
    }
    if (bar.active !== (bar.eventIds.length > 0)) {
      issue(issues, 'bar-score', `bars[${index}].active`, 'active bars must own events; inactive bars must be empty');
    }
    for (const eventId of bar.eventIds) {
      const event = instrumentById.get(eventId);
      if (!event || event.absoluteBar !== bar.absoluteBar || event.sectionId !== bar.sectionId || event.role !== bar.role) {
        issue(issues, 'bar-score', `bars[${index}].eventIds`, `${eventId} does not belong to this role/bar`);
      }
      barReferenceCount.set(eventId, (barReferenceCount.get(eventId) ?? 0) + 1);
    }
  }
  for (const eventId of instrumentById.keys()) {
    if (barReferenceCount.get(eventId) !== 1) {
      issue(issues, 'bar-score', `event.${eventId}`, 'must belong to exactly one per-role bar score');
    }
  }

  const timingMembership = new Map<string, string>();
  for (const [index, link] of plan.timingLinks.entries()) {
    if (link.members.length < 2) issue(issues, 'timing-link', `timingLinks[${index}].members`, 'requires at least two members');
    const offsets = new Set<number>();
    for (const member of link.members) {
      const event = instrumentById.get(member.eventId);
      offsets.add(member.offsetTicks);
      if (!event || event.nominalTick !== link.anchorNominalTick + member.offsetTicks) {
        issue(issues, 'timing-link', `timingLinks[${index}].members.${member.eventId}`, 'anchor + offset must equal nominalTick');
      }
      if (timingMembership.has(member.eventId)) {
        issue(issues, 'timing-link', `timingLinks[${index}].members.${member.eventId}`, 'event may belong to only one timing link');
      }
      timingMembership.set(member.eventId, link.id);
      if (event?.timingLinkId !== link.id || semanticById.get(member.eventId)?.timingLinkId !== link.id) {
        issue(issues, 'timing-link', `timingLinks[${index}].members.${member.eventId}`, 'event/link back-reference mismatch');
      }
    }
    if (link.kind === 'exact' && (offsets.size !== 1 || !offsets.has(0))) {
      issue(issues, 'timing-link', `timingLinks[${index}]`, 'exact members require zero offsets');
    }
    if (link.kind === 'flam' && offsets.size < 2) {
      issue(issues, 'timing-link', `timingLinks[${index}]`, 'flam requires at least two authored offsets');
    }
    if (link.residualPolicy.maxAbsTicks < 0 || !link.residualPolicy.applyOnce || !link.residualPolicy.preserveMemberOffsets) {
      issue(issues, 'timing-link', `timingLinks[${index}].residualPolicy`, 'invalid residual ownership');
    }
    if (plan.performance.mode !== 'score-budgeted' && (
      link.residualPolicy.mode !== 'reference-zero' || link.residualPolicy.maxAbsTicks !== 0
    )) issue(issues, 'reference-zero', `timingLinks[${index}].residualPolicy`, 'reference mode requires zero shared residual');
  }

  const performedById = new Map<string, DeepReadonly<PerformedScoredEvent>>();
  for (const event of plan.performance.events) performedById.set(event.eventId, event);
  for (const [index, event] of plan.instrumentEvents.entries()) {
    const performed = performedById.get(event.eventId);
    if (!performed) {
      issue(issues, 'reference-zero', `performance.events.${event.eventId}`, 'missing');
      continue;
    }
    const allowedLeadResidual = plan.performance.mode === 'reference-authored-lead'
      && event.role === 'lead';
    if (plan.performance.mode !== 'score-budgeted' && (
      (!allowedLeadResidual && performed.tick !== event.nominalTick)
      || (allowedLeadResidual && Math.abs(performed.tick - event.nominalTick) > 40)
      || performed.durationTicks !== event.durationTicks
      || performed.velocity !== event.velocity
      || performed.pitch !== event.pitch
      || performed.program !== event.program
      || performed.bank !== event.bank
    )) issue(
      issues,
      'reference-zero',
      `performance.events[${index}]`,
      allowedLeadResidual
        ? 'reference Lead residual must stay within 40 ticks and preserve non-timing fields'
        : 'reference rhythm-section performance must be an identity projection',
    );
    const provenance = plan.provenanceByEventId[event.eventId];
    if (event.role === 'lead' && provenance?.renderedTick !== performed?.tick) {
      issue(issues, 'provenance', `provenanceByEventId.${event.eventId}.renderedTick`, 'must equal performed Lead tick');
    }
  }
  if (performedById.size !== plan.instrumentEvents.length) {
    issue(issues, 'reference-zero', 'performance.events', 'must be a 1:1 event multiset');
  }
  return issues;
}

export function assertValidJazzFiveFourScorePlan(
  plan: JazzFiveFourScorePlanData | JazzFiveFourScorePlan,
): void {
  const issues = validateJazzFiveFourScorePlan(plan);
  if (issues.length > 0) {
    throw new Error(issues.map((entry) => `${entry.code} ${entry.path}: ${entry.message}`).join('\n'));
  }
}
