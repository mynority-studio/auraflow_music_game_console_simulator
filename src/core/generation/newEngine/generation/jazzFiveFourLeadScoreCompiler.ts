// ============================================================
// newEngine · generation · Jazz 5/4 post-harmony Lead compiler
// ------------------------------------------------------------
// Arranger directive → product rhythm template → existing MG grammar runtime
// → SlotBinder → nominal HarmonicPlan lookup → existing MG pitch realizer →
// immutable JazzFiveFourScorePlan.  It emits no NoteIR and performs no final
// renderer repair.
// ============================================================

import type { BandSpec } from '../band/BandSpec';
import { deepFreeze } from '../foundation';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import type { HarmonicPlan, ChordSpan } from '../harmony/HarmonicPlan';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import {
  bindJazzFiveFourLeadSlots,
  JazzFiveFourLeadBindingError,
  type BoundLeadToken,
  type SemanticGrammarToken,
} from '../arranger/jazzFiveFourLeadRhythm';
import type { LeadPhraseDirective } from '../arranger/jazzFiveFourLeadScore';
import {
  assertValidJazzFiveFourScorePlan,
  type InstrumentResolvedEvent,
  type JazzFiveFourScorePlan,
  type JazzFiveFourScorePlanData,
  type PerformedScoredEvent,
  type RoleBarScore,
  type ScoreEventProvenance,
  type SemanticScoredEvent,
} from '../arranger/jazzFiveFourScorePlan';
import {
  JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_SHA256,
  materializeJazzFiveFourLeadRhythm,
  type JazzFiveFourLeadRhythmTemplateId,
} from '../knowledge/jazzFiveFourLeadRhythmKnowledge';
import {
  jazzFiveFourAbstractTokenSemanticAtom,
  jazzFiveFourLeadGrammar,
  type JazzFiveFourLeadGrammarFamily,
  type JazzFiveFourLeadGrammarProfile,
} from '../knowledge/jazzFiveFourLeadGrammar';
import { jazzFiveFourHarmonicTemplate } from '../knowledge/jazzFiveFourHarmonicFormGrammar';
import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';
import { harmonicPlanToMgChordDefs } from '../render/mgChordDefAdapter';
import { buildChordPart } from '../render/mgChordPart';
import { expandGrammarForBrick, type GrammarExpansionTraceEvent } from '../render/mgGrammarRuntime';
import { buildGuideTonePlan } from '../render/mgGuideTonePlanner';
import { realizeTokens } from '../render/mgMelodyRealizer';
import { makeSeededRng } from '../render/mgRng';
import type { ScheduledToken } from '../render/mgTokenScheduler';

const PPQ = 480;
const BAR_TICKS = 2_400;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export interface CompileJazzFiveFourLeadScoreArgs {
  readonly score: JazzFiveFourScorePlan;
  readonly arrangement: ArrangementPlan;
  readonly harmonic: HarmonicPlan;
  readonly instrumentation: InstrumentationPlan;
  readonly band: BandSpec;
  readonly seed: number;
}

interface ExpandedSemantics {
  readonly abstractTokens: readonly AbstractMelodyToken[];
  readonly semanticTokens: readonly SemanticGrammarToken[];
}

function leadProgram(
  instrumentation: InstrumentationPlan,
  sectionId: string,
): { program: number; bank?: number } {
  return {
    program: instrumentation.programByRoleSection?.lead?.[sectionId]
      ?? instrumentation.roleProgram?.lead
      ?? 65,
    bank: instrumentation.bankByRoleSection?.lead?.[sectionId]
      ?? instrumentation.roleBank?.lead,
  };
}

function chordAtNominalTick(harmonic: HarmonicPlan, nominalTick: number): ChordSpan {
  const beat = nominalTick / PPQ;
  const span = harmonic.chordTimeline.find((candidate) => {
    const start = Number(candidate.startBeat);
    return beat >= start - 1e-9 && beat < start + Number(candidate.durationBeats) - 1e-9;
  });
  if (!span) throw new RangeError(`Jazz 5/4 Lead has no HarmonicPlan span at nominal tick ${nominalTick}`);
  return span as ChordSpan;
}

/** Instrument-register resolution only; MG has already chosen the pitch class. */
function resolveLeadRegister(value: number, lowMidi: number, highMidi: number): number {
  const candidates: number[] = [];
  for (let octave = -8; octave <= 8; octave++) {
    const candidate = Math.round(value) + octave * 12;
    if (candidate >= lowMidi && candidate <= highMidi) candidates.push(candidate);
  }
  const selected = candidates.sort((left, right) =>
    Math.abs(left - value) - Math.abs(right - value) || left - right)[0];
  if (selected === undefined) {
    throw new RangeError(`MG Lead pitch ${value} cannot fit authored register ${lowMidi}..${highMidi}`);
  }
  return selected;
}

function attackCount(directive: LeadPhraseDirective): number {
  const brick = materializeJazzFiveFourLeadRhythm(
    directive.rhythmTemplateId as JazzFiveFourLeadRhythmTemplateId,
    directive.startBar,
  );
  return brick.slots.filter((slot) => slot.kind === 'attack').length;
}

function expandSemantics(
  directive: LeadPhraseDirective,
  seed: number,
  redraw: number,
  profile: JazzFiveFourLeadGrammarProfile,
): ExpandedSemantics {
  const count = attackCount(directive);
  const grammar = jazzFiveFourLeadGrammar(
    directive.grammarFamilyId as JazzFiveFourLeadGrammarFamily,
    count,
    profile,
  );
  const terminalTrace = new Map<number, Extract<GrammarExpansionTraceEvent, { type: 'terminal-emitted' }>>();
  const rng = makeSeededRng(`${seed}:j54-lead-grammar:${directive.id}:redraw-${redraw}`);
  const abstractTokens = expandGrammarForBrick(grammar, {
    brick: {
      name: directive.id,
      family: 'Unknown',
      startBeat: directive.startBar * 5,
      durationBeats: directive.barCount * 5,
      chordIndices: [],
      cost: 0,
    },
    rng,
    trace: (event) => {
      if (event.type === 'terminal-emitted') terminalTrace.set(event.outputIndex, event);
    },
  });
  const semanticTokens = abstractTokens.map((token, index): SemanticGrammarToken => {
    const semanticAtom = jazzFiveFourAbstractTokenSemanticAtom(token);
    const trace = terminalTrace.get(index);
    if (!semanticAtom || !trace) {
      throw new Error(`Jazz 5/4 Lead grammar emitted a non-audible/untraced token at ${directive.id}:${index}`);
    }
    return Object.freeze({
      tokenId: `${directive.id}:grammar-${index}`,
      audible: true as const,
      semanticAtom,
      rulePath: Object.freeze([...trace.rulePath]),
      // Deliberately no chordSpanId: nominal Harmony lookup happens only
      // after SlotBinder has supplied the exact score tick.
    });
  });
  return { abstractTokens: Object.freeze(abstractTokens), semanticTokens: Object.freeze(semanticTokens) };
}

function bindWithBoundedRedraw(
  directive: LeadPhraseDirective,
  seed: number,
  compilationMode: JazzFiveFourScorePlan['compilationMode'],
): { expanded: ExpandedSemantics; bound: readonly BoundLeadToken[] } {
  const brick = materializeJazzFiveFourLeadRhythm(
    directive.rhythmTemplateId as JazzFiveFourLeadRhythmTemplateId,
    directive.startBar,
  );
  let lastMismatch: JazzFiveFourLeadBindingError | undefined;
  for (let redraw = 0; redraw <= directive.transformBudget.maxGrammarRedraws; redraw++) {
    const profile: JazzFiveFourLeadGrammarProfile = compilationMode === 'generative'
      && redraw === directive.transformBudget.maxGrammarRedraws
      ? 'structural-anchor-fallback'
      : 'family-color';
    const expanded = expandSemantics(directive, seed, redraw, profile);
    try {
      const bound = bindJazzFiveFourLeadSlots(brick, expanded.semanticTokens);
      if (compilationMode !== 'generative') return { expanded, bound };

      // Gate-L's structural slots are an acceptance constraint on Grammar,
      // never a post-binding token rewrite.  Ordinary color expansions get
      // two deterministic chances; the final bounded Grammar profile is made
      // solely of chord/guide atoms and therefore fails closed without repair.
      const structural = bound.filter((event) => {
        const phaseTick = event.nominalTick % BAR_TICKS;
        return phaseTick === 0 || phaseTick === 1_440 || event.cadence === 'arrival';
      });
      const stableCount = structural.filter((event) =>
        event.semanticAtom === 'chord-tone' || event.semanticAtom === 'guide-tone').length;
      const ratio = structural.length === 0 ? 1 : stableCount / structural.length;
      if (ratio >= 0.7) return { expanded, bound };
    } catch (error) {
      if (!(error instanceof JazzFiveFourLeadBindingError) || error.code !== 'TOKEN_COUNT_MISMATCH') throw error;
      lastMismatch = error;
    }
  }
  throw lastMismatch ?? new Error(`Jazz 5/4 Lead grammar redraw failed for ${directive.id}`);
}

function noteVelocity(accent: number): number {
  return Math.max(1, Math.min(127, Math.round(54 + accent * 46)));
}

/**
 * Generative performance may not make a note sound as though it belongs to a
 * different chord than the nominal Harmony lookup. Reference transcription
 * keeps its authored residual exactly; product phrases neutralize only the
 * rare residual that would cross a chord-span boundary.
 */
function performedLeadTick(
  nominalTick: number,
  residualTicks: number,
  span: ChordSpan,
  compilationMode: JazzFiveFourScorePlan['compilationMode'],
): number {
  const candidate = nominalTick + residualTicks;
  if (compilationMode !== 'generative') return candidate;
  const spanStartTick = Math.round(Number(span.startBeat) * PPQ);
  const spanEndTick = Math.round(
    (Number(span.startBeat) + Number(span.durationBeats)) * PPQ,
  );
  return candidate < spanStartTick || candidate >= spanEndTick ? nominalTick : candidate;
}

interface MutableLeadCompilation {
  semanticEvents: SemanticScoredEvent[];
  instrumentEvents: InstrumentResolvedEvent[];
  performanceEvents: PerformedScoredEvent[];
  roleBars: RoleBarScore[];
  provenanceByEventId: Record<string, ScoreEventProvenance>;
}

function compileDirective(args: {
  directive: LeadPhraseDirective;
  arrangement: ArrangementPlan;
  harmonic: HarmonicPlan;
  instrumentation: InstrumentationPlan;
  band: BandSpec;
  score: JazzFiveFourScorePlan;
  chordPart: ReturnType<typeof buildChordPart>;
  seed: number;
  target: MutableLeadCompilation;
}): void {
  const { directive, harmonic, instrumentation, band, chordPart, target } = args;
  const { expanded, bound } = bindWithBoundedRedraw(
    directive,
    args.seed,
    args.score.compilationMode,
  );
  const spans = bound.map((event) => chordAtNominalTick(harmonic, event.nominalTick));
  const scheduled: ScheduledToken[] = bound.map((event, index) => ({
    token: {
      ...expanded.abstractTokens[index]!,
      duration: event.nominalDurationTicks / PPQ,
    } as AbstractMelodyToken,
    startBeat: event.nominalTick / PPQ,
    brickIndex: args.arrangement.sections.findIndex((section) => section.id === directive.sectionId),
    brickStartBeat: directive.startBar * 5,
    brickEndBeat: (directive.startBar + directive.barCount) * 5,
    brickName: directive.id,
    brickFamily: 'Unknown',
  }));
  const localScaleContext = {
    style: 'JAZZ' as const,
    key: NOTE_NAMES[((Number(band.key) % 12) + 12) % 12]!,
    mode: band.mode === 'minor' ? 'Aeolian' : 'Ionian',
  };
  const guideTonePlan = buildGuideTonePlan({
    chordPart,
    localScaleContext,
    registerCenter: Math.round((directive.register.lowMidi + directive.register.highMidi) / 2),
    lowMidi: directive.register.lowMidi,
    highMidi: directive.register.highMidi,
  });
  const pitchRng = makeSeededRng(`${args.seed}:j54-lead-pitch:${directive.id}`);
  const realized = realizeTokens({
    scheduledTokens: scheduled,
    chordPart,
    rng: pitchRng,
    guideTonePlan,
    registerCenter: Math.round((directive.register.lowMidi + directive.register.highMidi) / 2),
    localScaleContext,
    preserveTokenBoundaries: true,
  });
  if (realized.length !== bound.length) {
    throw new Error(
      `Jazz 5/4 Lead MG realization changed SlotBinder cardinality in ${directive.id}: ${bound.length} -> ${realized.length}`,
    );
  }

  const instrument = leadProgram(instrumentation, directive.sectionId);
  for (let index = 0; index < bound.length; index++) {
    const event = bound[index]!;
    const mgEvent = realized[index]!;
    const expectedBeat = event.nominalTick / PPQ;
    if (Math.abs(mgEvent.time - expectedBeat) > 1e-7) {
      throw new Error(`Jazz 5/4 Lead MG realization moved onset ${event.eventId}: ${expectedBeat} -> ${mgEvent.time}`);
    }
    const span = spans[index]!;
    const abstractToken = expanded.abstractTokens[index]!;
    const pitch = resolveLeadRegister(
      mgEvent.noteNumber,
      directive.register.lowMidi,
      directive.register.highMidi,
    );
    const absoluteBar = Math.floor(event.nominalTick / BAR_TICKS);
    const sectionStartBar = directive.startBar - directive.startBarInSection;
    const barInSection = absoluteBar - sectionStartBar;
    const harmonicBrickIndex = (args.arrangement.jazzFiveFourHarmonyDirectives ?? [])
      .findIndex((candidate) => candidate.sectionId === directive.sectionId
        && barInSection >= candidate.startBarInSection
        && barInSection < candidate.startBarInSection + candidate.barCount);
    const harmonicDirective = args.arrangement.jazzFiveFourHarmonyDirectives?.[harmonicBrickIndex];
    const harmonicTemplate = harmonicDirective
      ? jazzFiveFourHarmonicTemplate(harmonicDirective.templateId)
      : undefined;
    if (harmonicBrickIndex < 0 || !harmonicDirective || !harmonicTemplate) {
      throw new Error(`Jazz 5/4 Lead ${event.eventId} has no Arranger harmonic brick at ${directive.sectionId}:${barInSection}`);
    }
    const velocity = noteVelocity(event.accent);
    const renderedTick = performedLeadTick(
      event.nominalTick,
      event.referenceResidualTicks,
      span,
      args.score.compilationMode,
    );
    const semantic: SemanticScoredEvent = {
      eventId: event.eventId,
      role: 'lead',
      sectionId: directive.sectionId,
      barInSection,
      absoluteBar,
      nominalTick: event.nominalTick,
      phaseTick: event.nominalTick % BAR_TICKS,
      durationTicks: event.nominalDurationTicks,
      velocity,
      pitchIntent: {
        kind: 'grammar-lead',
        chordSpanId: span.id,
        semanticAtom: event.semanticAtom,
        grammarTokenKind: abstractToken.kind,
      },
    };
    const resolved: InstrumentResolvedEvent = {
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
      pitch,
      ...instrument,
    };
    const performed: PerformedScoredEvent = {
      eventId: event.eventId,
      instrumentEventId: event.eventId,
      role: 'lead',
      tick: renderedTick,
      durationTicks: event.nominalDurationTicks,
      velocity,
      pitch,
      ...instrument,
    };
    target.semanticEvents.push(semantic);
    target.instrumentEvents.push(resolved);
    target.performanceEvents.push(performed);
    target.provenanceByEventId[event.eventId] = {
      eventId: event.eventId,
      role: 'lead',
      sectionId: directive.sectionId,
      absoluteBar,
      familyId: directive.family,
      variantId: 'seed-generated',
      cellId: event.slotId,
      sourceSha256: JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_SHA256,
      harmonicSpanId: span.id,
      authority: 'arranger-grammar-score',
      directiveId: directive.id,
      phraseIds: Object.freeze([...directive.phraseIds]),
      rhythmTemplateId: directive.rhythmTemplateId,
      rhythmSlotId: event.slotId,
      grammarFamilyId: directive.grammarFamilyId,
      grammarRulePath: Object.freeze([...event.rulePath]),
      grammarTokenId: event.grammarTokenId,
      grammarTokenKind: abstractToken.kind,
      semanticAtom: event.semanticAtom,
      harmonicBrickIndex,
      harmonicBrickName: harmonicDirective.templateId,
      harmonicBrickFamily: harmonicTemplate.family,
      nominalChordSpanId: span.id,
      nominalTick: event.nominalTick,
      renderedTick,
    };
  }

  for (let offset = 0; offset < directive.barCount; offset++) {
    const absoluteBar = directive.startBar + offset;
    const eventIds = target.instrumentEvents
      .filter((event) => event.role === 'lead' && event.absoluteBar === absoluteBar)
      .map((event) => event.eventId);
    target.roleBars.push({
      role: 'lead',
      sectionId: directive.sectionId,
      barInSection: directive.startBarInSection + offset,
      absoluteBar,
      barStartTick: absoluteBar * BAR_TICKS,
      active: eventIds.length > 0,
      familyId: directive.rhythmTemplateId,
      variantId: 'seed-generated',
      eventIds,
    });
  }
}

/** Add score-owned Lead events to the already compiled Bass/Comp/Drum score. */
export function compileJazzFiveFourLeadScore(
  args: CompileJazzFiveFourLeadScoreArgs,
): JazzFiveFourScorePlan {
  const directives = args.arrangement.jazzFiveFourLeadDirectives;
  if (!directives) return args.score;
  if (args.score.performance.mode !== 'reference-zero') {
    throw new Error('Jazz 5/4 Lead first version requires reference-zero performance');
  }
  if (directives.length === 0) throw new Error('Jazz 5/4 Lead directives are enabled but empty');

  const chordPart = buildChordPart(
    harmonicPlanToMgChordDefs(args.harmonic),
    [args.arrangement.meter.numerator, args.arrangement.meter.denominator],
  );
  const lead: MutableLeadCompilation = {
    semanticEvents: [],
    instrumentEvents: [],
    performanceEvents: [],
    roleBars: [],
    provenanceByEventId: {},
  };
  for (const directive of directives) {
    compileDirective({ ...args, directive, chordPart, target: lead });
  }

  const data: JazzFiveFourScorePlanData = {
    schemaVersion: args.score.schemaVersion,
    compilationMode: args.score.compilationMode,
    foundationMode: args.score.foundationMode,
    clock: {
      ppq: args.score.clock.ppq,
      meter: { ...args.score.clock.meter },
      grouping: [...args.score.clock.grouping] as [3, 2],
      ticksPerBar: args.score.clock.ticksPerBar,
      groupBoundaryTick: args.score.clock.groupBoundaryTick,
      barOriginPolicy: args.score.clock.barOriginPolicy,
      totalBars: args.score.clock.totalBars,
    },
    semanticEvents: [...args.score.semanticEvents, ...lead.semanticEvents],
    instrumentEvents: [...args.score.instrumentEvents, ...lead.instrumentEvents],
    performance: {
      mode: 'reference-authored-lead',
      events: [...args.score.performance.events, ...lead.performanceEvents],
    },
    roleBars: [...args.score.roleBars, ...lead.roleBars],
    drumBars: args.score.drumBars.map((bar) => ({ ...bar, eventIds: [...bar.eventIds] })),
    timingLinks: args.score.timingLinks.map((link) => ({
      ...link,
      members: link.members.map((member) => ({ ...member })),
      residualPolicy: { ...link.residualPolicy },
    })),
    provenanceByEventId: { ...args.score.provenanceByEventId, ...lead.provenanceByEventId },
  };
  assertValidJazzFiveFourScorePlan(data);
  return deepFreeze(data);
}
