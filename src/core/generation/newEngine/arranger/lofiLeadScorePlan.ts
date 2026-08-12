// ============================================================
// newEngine · arranger · LOFI LeadScorePlan
// ------------------------------------------------------------
// Compiles the Arranger-authored LOFI Lead RoadMap after harmony is known.
// It resolves each preselected brick texture lane against Functional RoadMap
// evidence, then writes phrase-bar × harmonic-span notes before Render/NoteIR.
// ============================================================

import { deepFreeze, type DeepReadonly } from '../foundation';
import type {
  ArrangementPlan,
  LofiLeadPhraseRole,
  LofiLeadPresencePlan,
  LofiLeadSilenceWindow,
  LofiPhraseArcPhase,
  LofiPhraseInteractionPlan,
} from './ArrangementPlan';
import { beatsPerBarOf, phraseStartBeats } from './phraseTiming';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { TailPolicy } from '../instrumental/InstrumentationPlan';
import type { LofiGrammarTag } from '../knowledge/melodyLofiGrammarTags';
import {
  resolveLofiLeadContinuityProfile,
  type LofiLeadConditionalGrammarTag,
  type LofiLeadScoreRole,
  type LofiLeadShortGestureClass,
} from '../knowledge/lofiLeadContinuityKnowledge';
import type {
  LeadContinuityBoundaryBridge,
  LeadContinuitySlotCore,
  LeadScoreRoadMapBinding,
} from './leadScorePlan';
import type { RoadMap } from '../render/mgRoadMapParser';
import {
  lofiLeadEventsForRole,
  type LofiLeadRoleEvent,
  type LofiLeadMotifHarmonicRole,
  type LofiLeadScoreTransform,
} from '../knowledge/lofiLeadPhraseBlueprints';
import { LOFI_ENRICHED_GRAMMAR } from '../knowledge/melodyStyleGrammarProfiles';
import {
  selectLofiLeadGrammarRules,
} from '../knowledge/lofiLeadGrammarBank';
import {
  projectLofiLeadGrammarRule,
  type CompiledLofiLeadRoadMapBrick,
  type LofiLeadBrickTextureProjection,
  type LofiLeadRoadMapBrick,
  type LofiLeadRoadMapPlan,
} from '../knowledge/lofiLeadRoadMapKnowledge';
import type { GrammarRule } from '../knowledge/melodyGrammarTypes';

const EPSILON = 1e-4;
const LOFI_STABLE_ROLES = ['root', 'third', 'fifth', 'seventh'] as const;

/** One phrase-bar sentence, retained even when it is a deliberate rest. */
export interface LofiLeadScoreBar {
  readonly id: string;
  readonly sectionId: string;
  readonly absoluteBar: number;
  readonly phraseId: string;
  readonly motifId?: string;
  readonly phraseBarIndex: number;
  readonly arcPhase: LofiPhraseArcPhase;
  readonly phraseRole: LofiLeadPhraseRole;
  readonly role: LofiLeadScoreRole;
  readonly leadRoadMapBrickId?: string;
  readonly leadBrickKind?: CompiledLofiLeadRoadMapBrick['brickKind'];
  readonly leadTextureTag?: LofiGrammarTag;
  readonly startBeat: number;
  readonly endBeat: number;
  /** The existing off-downbeat answer entrance, when this bar is active. */
  readonly entryBeat?: number;
}

/**
 * One detailed LOFI lead contract. The generic continuity fields are the
 * cross-style core; the role/tag fields are LOFI's own grammar vocabulary.
 */
export interface LofiLeadContinuitySlot extends LeadContinuitySlotCore<LofiLeadShortGestureClass> {
  readonly barId: string;
  readonly sectionId: string;
  readonly absoluteBar: number;
  readonly phraseRole: LofiLeadPhraseRole;
  readonly role: LofiLeadScoreRole;
  readonly motifId?: string;
  readonly entryBeat?: number;
  readonly allowedGrammarTags: readonly LofiGrammarTag[];
  readonly conditionalGrammarTags: readonly LofiLeadConditionalGrammarTag[];
  readonly roadMapBinding: LeadScoreRoadMapBinding;
  readonly tailPolicy?: TailPolicy;
}

export interface LofiLeadScorePlanData {
  /** Arranger's creative Lead route, authored before Harmony. */
  readonly arrangerRoadMap?: LofiLeadRoadMapPlan;
  /** Harmony-compatible source-rule resolution for each Arranger brick. */
  readonly compiledRoadMapBricks: readonly CompiledLofiLeadRoadMapBrick[];
  /**
   * Runtime projection of the Arranger Lead route. This is not the Functional
   * Harmony RoadMap and is never allowed to select new notes in Render.
   */
  readonly roadMap?: RoadMap;
  /** Post-harmony evidence used only to prove local compatibility. */
  readonly harmonicRoadMap?: RoadMap;
  readonly leadTailPolicy?: TailPolicy;
  readonly phraseBars: number;
  /** Copied Arranger silence ownership, so render need not infer gaps later. */
  readonly silenceWindows: readonly LofiLeadSilenceWindow[];
  readonly entryBeats: readonly number[];
  readonly bars: readonly LofiLeadScoreBar[];
  readonly barById: Record<string, LofiLeadScoreBar>;
  readonly slots: readonly LofiLeadContinuitySlot[];
  readonly slotIdsByAbsoluteBar: Record<string, readonly string[]>;
  /** Concrete post-harmony notes authored before Grammar or Render runs. */
  readonly events: readonly LofiLeadScoreEvent[];
}

/** Frozen score passed from arranger to the LOFI lead scheduler. */
export type LofiLeadScorePlan = DeepReadonly<LofiLeadScorePlanData>;

export interface LofiLeadScoreEvent {
  readonly id: string;
  readonly barId: string;
  readonly slotId: string;
  readonly sectionId: string;
  readonly absoluteBar: number;
  readonly phraseId: string;
  readonly motifId: string;
  readonly phraseRole: Exclude<LofiLeadPhraseRole, 'rest'>;
  readonly sourceCellId: string;
  readonly leadRoadMapBrickId: string;
  readonly leadBrickKind: CompiledLofiLeadRoadMapBrick['brickKind'];
  readonly leadTextureTag: LofiGrammarTag;
  readonly leadTextureResolution: CompiledLofiLeadRoadMapBrick['sourceResolution'];
  readonly sourceGrammarRuleId?: string;
  readonly sourceGrammarBrickType?: string;
  readonly sourceEventIndex: number;
  readonly transform: LofiLeadScoreTransform;
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly pitchMidi: number;
  readonly pitchClass: number;
  readonly tokenKind: 'C' | 'S' | 'L';
  readonly harmonicRole: LofiLeadMotifHarmonicRole;
  readonly sourceSpanId: string;
  /** Every harmony span which explicitly admits this sounding duration. */
  readonly admittedSpanIds: readonly string[];
}

interface SlotDraft extends Omit<LofiLeadContinuitySlot, 'boundaryBridges'> {}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB - EPSILON && endA > startB + EPSILON;
}

function normalizePitchClasses(values: readonly number[]): number[] {
  return [...new Set(values.map((value) => ((Number(value) % 12) + 12) % 12))]
    .sort((left, right) => left - right);
}

function roadMapBinding(roadMap: RoadMap | undefined, startBeat: number, endBeat: number): LeadScoreRoadMapBinding {
  const matches = (roadMap?.bricks ?? [])
    .map((brick, brickIndex) => ({ brick, brickIndex }))
    .filter(({ brick }) => overlaps(startBeat, endBeat, brick.startBeat, brick.startBeat + brick.durationBeats));
  return {
    brickIndices: matches.map(({ brickIndex }) => brickIndex),
    brickFamilies: [...new Set(matches.map(({ brick }) => brick.family))],
    brickNames: [...new Set(matches.map(({ brick }) => brick.name))],
  };
}

function scoreRoleFor(
  phraseRole: LofiLeadPhraseRole,
  arrangerActive: boolean,
): LofiLeadScoreRole {
  if (!arrangerActive || phraseRole === 'rest') return 'rest';
  switch (phraseRole) {
    case 'statement': return 'statement-carrier';
    case 'variation': return 'answer-riff';
    case 'return': return 'return-hold';
  }
}

function copySilenceWindows(windows: readonly LofiLeadSilenceWindow[]): LofiLeadSilenceWindow[] {
  return windows.map((window) => ({ ...window }));
}

/** Keep the score snapshot immutable without freezing the caller's RoadMap. */
function copyRoadMap(roadMap: RoadMap): RoadMap {
  return {
    bricks: roadMap.bricks.map((brick) => ({ ...brick, chordIndices: [...brick.chordIndices] })),
    totalCost: roadMap.totalCost,
    segments: roadMap.segments.map((segment) => ({ ...segment })),
  };
}

function copyArrangerRoadMap(roadMap: Readonly<LofiLeadRoadMapPlan>): LofiLeadRoadMapPlan {
  return {
    cycleBars: roadMap.cycleBars,
    sourceTextureCorpus: roadMap.sourceTextureCorpus,
    bricks: roadMap.bricks.map((brick) => ({
      ...brick,
      textureTagPriority: [...brick.textureTagPriority],
    })),
    brickIdByAbsoluteBar: { ...roadMap.brickIdByAbsoluteBar },
  };
}

function grammarTags(rule: GrammarRule): readonly LofiGrammarTag[] {
  return (rule.metadata?.lofiTags ?? []) as LofiGrammarTag[];
}

function harmonicBrickIndicesFor(
  roadMap: RoadMap | undefined,
  directive: Readonly<LofiLeadRoadMapBrick>,
): number[] {
  return (roadMap?.bricks ?? [])
    .map((brick, index) => ({ brick, index }))
    .filter(({ brick }) => overlaps(
      directive.startBeat,
      directive.startBeat + directive.durationBeats,
      brick.startBeat,
      brick.startBeat + brick.durationBeats,
    ))
    .map(({ index }) => index);
}

function resolveLeadRoadMapBrick(
  directive: Readonly<LofiLeadRoadMapBrick>,
  harmonicRoadMap: RoadMap | undefined,
): CompiledLofiLeadRoadMapBrick {
  const harmonicBrickIndices = harmonicBrickIndicesFor(harmonicRoadMap, directive);
  const primaryHarmonicBrick = harmonicBrickIndices
    .map((index) => harmonicRoadMap?.bricks[index])
    .find((brick) => brick
      && directive.startBeat >= brick.startBeat - EPSILON
      && directive.startBeat < brick.startBeat + brick.durationBeats - EPSILON)
    ?? (harmonicBrickIndices[0] === undefined
      ? undefined
      : harmonicRoadMap?.bricks[harmonicBrickIndices[0]]);
  let resolvedTextureTag = directive.textureTagPriority[0] ?? 'lofi_rest_space';
  let candidates: readonly GrammarRule[] = [];
  let sourceResolution: CompiledLofiLeadRoadMapBrick['sourceResolution'] = 'explicit-rest';
  const contexts = directive.grammarRole === 'release'
    ? []
    : [
      ...(primaryHarmonicBrick ? [{
        resolution: 'exact-harmonic-brick' as const,
        context: {
          family: primaryHarmonicBrick.family,
          name: primaryHarmonicBrick.name,
          durationBeats: primaryHarmonicBrick.durationBeats,
        },
      }, {
        resolution: 'harmonic-family' as const,
        context: {
          family: primaryHarmonicBrick.family,
          durationBeats: primaryHarmonicBrick.durationBeats,
        },
      }] : []),
      {
        resolution: 'texture-projection' as const,
        context: undefined,
      },
    ];
  for (const candidateContext of contexts) {
    const selection = selectLofiLeadGrammarRules(
      directive.grammarRole,
      LOFI_ENRICHED_GRAMMAR,
      candidateContext.context,
    );
    for (const tag of directive.textureTagPriority) {
      const matching = selection.rules.filter((rule) => grammarTags(rule).includes(tag));
      if (matching.length === 0) continue;
      resolvedTextureTag = tag;
      candidates = matching;
      sourceResolution = candidateContext.resolution;
      break;
    }
    if (candidates.length > 0) break;
  }
  const sourceRule = candidates.length > 0
    ? candidates[directive.sourceRuleOrdinal % candidates.length]
    : undefined;
  return {
    arrangerBrickId: directive.id,
    sectionId: directive.sectionId,
    absoluteBar: directive.absoluteBar,
    phraseRole: directive.phraseRole,
    brickKind: directive.brickKind,
    grammarRole: directive.grammarRole,
    harmonicBrickIndices,
    resolvedTextureTag,
    sourceResolution,
    ...(sourceRule?.metadata?.sourceRuleId
      ? { sourceGrammarRuleId: sourceRule.metadata.sourceRuleId }
      : {}),
    ...(sourceRule?.metadata?.sourceBrickType
      ? { sourceGrammarBrickType: sourceRule.metadata.sourceBrickType }
      : {}),
    textureProjection: projectLofiLeadGrammarRule(sourceRule),
  };
}

function materializeArrangerLeadRoadMap(
  arrangerRoadMap: Readonly<LofiLeadRoadMapPlan>,
  compiled: readonly CompiledLofiLeadRoadMapBrick[],
  harmonicRoadMap: RoadMap | undefined,
): RoadMap {
  const directiveById = new Map(arrangerRoadMap.bricks.map((brick) => [brick.id, brick]));
  return {
    bricks: compiled.map((brick) => {
      const directive = directiveById.get(brick.arrangerBrickId)!;
      const chordIndices = [...new Set(brick.harmonicBrickIndices.flatMap(
        (index) => harmonicRoadMap?.bricks[index]?.chordIndices ?? [],
      ))];
      return {
        name: `${brick.brickKind}:${brick.resolvedTextureTag}`,
        // Generic RoadMap's family enum describes harmonic function. This
        // creative Lead brick is intentionally outside that taxonomy.
        family: 'Unknown',
        startBeat: directive.startBeat,
        durationBeats: directive.durationBeats,
        chordIndices,
        cost: 0,
      };
    }),
    totalCost: 0,
    segments: harmonicRoadMap
      ? harmonicRoadMap.segments.map((segment) => ({ ...segment }))
      : [],
  };
}

function applyBrickTextureProjection(
  roleEvents: readonly LofiLeadRoleEvent[],
  projection: Readonly<LofiLeadBrickTextureProjection>,
): LofiLeadRoleEvent[] {
  if (roleEvents.length === 0) return [];
  return roleEvents.map((roleEvent, index) => {
    const durationScale = projection.durationScaleByEvent[
      index % projection.durationScaleByEvent.length
    ] ?? 1;
    const harmonicKind = projection.harmonicKindByEvent[
      index % projection.harmonicKindByEvent.length
    ];
    const terminalScale = roleEvent.event.harmonicRole === 'terminal'
      ? projection.terminalHoldScale
      : 1;
    // A source-rule leading rest is consumed as a softer/shorter first
    // articulation. Moving the whole motif can accidentally place a passing
    // tone on beat 1/3 or on a mid-bar chord entrance, turning texture into
    // an unauthorized structural harmony decision.
    const leadingRestArticulationScale = index === 0
      ? 1 - Math.min(0.2, projection.leadingRestRatio)
      : 1;
    // Grammar color is an articulation clue here, not permission to replace
    // the Arranger motif's harmonic role. A new L/H pitch would need an
    // ensemble-level vertical-admission proof which this compiler does not
    // own. Keep the local role and express color as a short touch instead.
    const colorArticulationCap = harmonicKind === 'color'
      && roleEvent.event.harmonicRole !== 'anchor'
      && roleEvent.event.harmonicRole !== 'terminal'
      ? 0.5
      : Number.POSITIVE_INFINITY;
    return {
      ...roleEvent,
      event: {
        ...roleEvent.event,
        offsetBeat: roleEvent.event.offsetBeat,
        durationBeats: Math.max(
          0.25,
          Math.min(
            colorArticulationCap,
            roleEvent.event.durationBeats
              * durationScale
              * terminalScale
              * leadingRestArticulationScale,
          ),
        ),
        harmonicRole: roleEvent.event.harmonicRole,
      },
    };
  });
}

function pitchCandidates(
  pitchClasses: readonly number[],
  lowMidi: number,
  highMidi: number,
): number[] {
  const pcs = normalizePitchClasses(pitchClasses);
  const out: number[] = [];
  for (let midi = Math.max(0, Math.ceil(lowMidi)); midi <= Math.min(127, Math.floor(highMidi)); midi++) {
    if (pcs.includes(((midi % 12) + 12) % 12)) out.push(midi);
  }
  return out;
}

function admissionPcsForRole(
  harmonic: HarmonicPlan,
  spanId: string,
  role: LofiLeadMotifHarmonicRole,
): number[] {
  const avoid = new Set(normalizePitchClasses(harmonic.avoidNoteMap[spanId] ?? []));
  const stable = normalizePitchClasses(harmonic.stableToneMap[spanId] ?? [])
    .filter((pc) => !avoid.has(pc));
  const color = normalizePitchClasses(harmonic.colorToneMap[spanId] ?? [])
    .filter((pc) => !avoid.has(pc));
  const scale = normalizePitchClasses(harmonic.chordScaleMap[spanId] ?? [])
    .filter((pc) => !avoid.has(pc));
  if (role === 'anchor' || role === 'terminal') {
    const localStable = scale.length > 0 ? stable.filter((pc) => scale.includes(pc)) : stable;
    return localStable.length > 0 ? localStable : stable;
  }
  if (role === 'color') {
    const localColor = scale.length > 0 ? color.filter((pc) => scale.includes(pc)) : color;
    return localColor.length > 0 ? localColor : scale.length > 0 ? scale : stable;
  }
  const moving = scale.filter((pc) => !stable.includes(pc));
  return moving.length > 0 ? moving : scale.length > 0 ? scale : stable;
}

function chooseWrittenPitch(args: {
  candidates: readonly number[];
  desiredMidi: number;
  previousMidi?: number;
  registerCenter: number;
}): number | undefined {
  if (args.candidates.length === 0) return undefined;
  const nearby = args.previousMidi === undefined
    ? [...args.candidates]
    : args.candidates.filter((midi) => Math.abs(midi - args.previousMidi!) <= 12);
  const pool = nearby.length > 0 ? nearby : [...args.candidates];
  return [...pool].sort(
    (left, right) =>
      Math.abs(left - args.desiredMidi) - Math.abs(right - args.desiredMidi)
      || Math.abs(left - args.registerCenter) - Math.abs(right - args.registerCenter)
      || left - right,
  )[0];
}

function admittedDuration(args: {
  harmonic: HarmonicPlan;
  sourceSpanIndex: number;
  startBeat: number;
  requestedEndBeat: number;
  pitchClass: number;
  allowCommonTone: boolean;
}): { endBeat: number; spanIds: string[] } {
  const timeline = args.harmonic.chordTimeline;
  const source = timeline[args.sourceSpanIndex]!;
  let endBeat = Math.min(
    args.requestedEndBeat,
    (source.startBeat as number) + (source.durationBeats as number),
  );
  const spanIds = [source.id];
  if (!args.allowCommonTone) return { endBeat, spanIds };
  for (let index = args.sourceSpanIndex + 1; index < timeline.length; index++) {
    const span = timeline[index]!;
    const spanStart = span.startBeat as number;
    if (spanStart >= args.requestedEndBeat - EPSILON) break;
    const stable = normalizePitchClasses(args.harmonic.stableToneMap[span.id] ?? []);
    if (!stable.includes(args.pitchClass)) break;
    spanIds.push(span.id);
    endBeat = Math.min(
      args.requestedEndBeat,
      spanStart + (span.durationBeats as number),
    );
    if (endBeat >= args.requestedEndBeat - EPSILON) break;
  }
  return { endBeat, spanIds };
}

function tokenKindForRole(role: LofiLeadMotifHarmonicRole): 'C' | 'S' | 'L' {
  if (role === 'anchor' || role === 'terminal') return 'C';
  return role === 'color' ? 'L' : 'S';
}

/**
 * Build the detailed LOFI top-line score after the shared harmonic timeline
 * exists. The caller must pass the pre-existing Arranger presence and phrase
 * plans explicitly; this prevents a renderer fallback from silently inventing
 * a different phrase/rest syntax.
 */
export function buildLofiLeadScorePlan(args: {
  readonly arrangement: ArrangementPlan;
  readonly harmonic: HarmonicPlan;
  readonly leadPresencePlan: Readonly<LofiLeadPresencePlan>;
  readonly phraseInteractionPlan: Readonly<LofiPhraseInteractionPlan>;
  readonly roadMap?: RoadMap;
  /** Resolved by instrumentation, not guessed from the style. */
  readonly leadTailPolicy?: TailPolicy;
  readonly leadRegister?: { readonly lowMidi: number; readonly highMidi: number };
}): LofiLeadScorePlan {
  const beatsPerBar = beatsPerBarOf(args.arrangement.meter);
  const arrangerRoadMap = args.arrangement.lofiLeadRoadMapPlan;
  const compiledRoadMapBricks = (arrangerRoadMap?.bricks ?? [])
    .map((directive) => resolveLeadRoadMapBrick(directive, args.roadMap));
  const compiledBrickByAbsoluteBar = new Map(
    compiledRoadMapBricks.map((brick) => [brick.absoluteBar, brick]),
  );
  const directiveByAbsoluteBar = new Map(
    (arrangerRoadMap?.bricks ?? []).map((brick) => [brick.absoluteBar, brick]),
  );
  const phraseStarts = phraseStartBeats(args.arrangement);
  const phraseWindows = args.arrangement.phrases.map((phrase) => {
    const startBeat = phraseStarts[phrase.id] ?? 0;
    return {
      id: phrase.id,
      sectionId: phrase.sectionId,
      startBeat,
      endBeat: startBeat + phrase.bars * beatsPerBar,
    };
  });
  const entryBeats = [...args.leadPresencePlan.entryBeats].sort((left, right) => left - right);
  const bars: LofiLeadScoreBar[] = [];
  const barById: Record<string, LofiLeadScoreBar> = {};
  const orderedInteractions = [...args.phraseInteractionPlan.bars]
    .sort((left, right) => left.absoluteBar - right.absoluteBar || left.sectionId.localeCompare(right.sectionId));

  // ★ ending 重构:outro 首小节 + 过中点小节各一个 'return' 收束(此前 outro 全 rest = "撞线"根因之一;
  //   第二个收束落在 outro 后半 → fade 渐弱下形成真正的"回落"而非一响即无)。
  const functionTagBySectionId = new Map(args.arrangement.sections.map((section) => [section.id, section.functionTag]));
  const barsBySectionId = new Map(args.arrangement.sections.map((section) => [section.id, section.bars]));
  for (const interaction of orderedInteractions) {
    const startBeat = interaction.absoluteBar * beatsPerBar;
    const endBeat = startBeat + beatsPerBar;
    const phrase = phraseWindows.find((candidate) => candidate.sectionId === interaction.sectionId
      && overlaps(startBeat, endBeat, candidate.startBeat, candidate.endBeat));
    const active = (args.leadPresencePlan.activeBarsBySection[interaction.sectionId] ?? [])
      .includes(interaction.barInSection);
    const leadRoadMapDirective = directiveByAbsoluteBar.get(interaction.absoluteBar);
    const compiledLeadBrick = compiledBrickByAbsoluteBar.get(interaction.absoluteBar);
    const outroBars = barsBySectionId.get(interaction.sectionId) ?? 0;
    const isOutroClosingBar = functionTagBySectionId.get(interaction.sectionId) === 'outro'
      && (interaction.barInSection === 0
        || (outroBars >= 3 && interaction.barInSection === Math.ceil(outroBars / 2)));
    const phraseRole = isOutroClosingBar ? 'return' as const : (leadRoadMapDirective?.phraseRole ?? interaction.leadRole);
    const role = scoreRoleFor(phraseRole, active || isOutroClosingBar);
    const entryBeat = role === 'rest'
      ? undefined
      : entryBeats.find((entry) => entry >= startBeat - EPSILON && entry < endBeat - EPSILON);
    const phraseId = interaction.phraseId ?? phrase?.id ?? `${interaction.sectionId}:bar-${interaction.absoluteBar}`;
    const bar: LofiLeadScoreBar = {
      id: `${interaction.sectionId}:${interaction.absoluteBar}`,
      sectionId: interaction.sectionId,
      absoluteBar: interaction.absoluteBar,
      phraseId,
      ...(interaction.motifId ? { motifId: interaction.motifId } : {}),
      phraseBarIndex: interaction.phraseBarIndex,
      arcPhase: interaction.arcPhase,
      phraseRole,
      role,
      ...(leadRoadMapDirective ? { leadRoadMapBrickId: leadRoadMapDirective.id } : {}),
      ...(compiledLeadBrick ? {
        leadBrickKind: compiledLeadBrick.brickKind,
        leadTextureTag: compiledLeadBrick.resolvedTextureTag,
      } : {}),
      startBeat,
      endBeat,
      ...(entryBeat === undefined ? {} : { entryBeat }),
    };
    bars.push(bar);
    barById[bar.id] = bar;
  }

  const drafts: SlotDraft[] = [];
  for (const bar of bars) {
    const profile = resolveLofiLeadContinuityProfile({
      role: bar.role,
      tailPolicy: args.leadTailPolicy,
    });
    for (const span of args.harmonic.chordTimeline) {
      const spanStart = span.startBeat as number;
      const spanEnd = spanStart + (span.durationBeats as number);
      if (!overlaps(bar.startBeat, bar.endBeat, spanStart, spanEnd)) continue;
      const startBeat = Math.max(bar.startBeat, spanStart);
      const endBeat = Math.min(bar.endBeat, spanEnd);
      const draft: SlotDraft = {
        id: `${bar.id}:${span.id}:${startBeat.toFixed(4)}:${endBeat.toFixed(4)}`,
        phraseId: bar.phraseId,
        sourceSpanId: span.id,
        startBeat,
        endBeat,
        exposedGapBeats: profile.exposedGapBeats,
        minimumWrittenDurationBeats: profile.minimumWrittenDurationBeats,
        releaseGuardBeats: profile.releaseGuardBeats,
        reentryGuardBeats: profile.reentryGuardBeats,
        maxOnsetNudgeBeats: profile.maxOnsetNudgeBeats,
        allowedShortGestureClasses: profile.allowedShortGestureClasses,
        shortGestureMustResolve: true,
        harmonicScope: 'current-chord',
        stableRoles: LOFI_STABLE_ROLES,
        barId: bar.id,
        sectionId: bar.sectionId,
        absoluteBar: bar.absoluteBar,
        phraseRole: bar.phraseRole,
        role: bar.role,
        ...(bar.motifId ? { motifId: bar.motifId } : {}),
        ...(bar.entryBeat === undefined ? {} : { entryBeat: bar.entryBeat }),
        allowedGrammarTags: directiveByAbsoluteBar.get(bar.absoluteBar)?.textureTagPriority
          ?? profile.allowedGrammarTags,
        conditionalGrammarTags: profile.conditionalGrammarTags,
        roadMapBinding: roadMapBinding(args.roadMap, startBeat, endBeat),
        ...(args.leadTailPolicy === undefined ? {} : { tailPolicy: args.leadTailPolicy }),
      };
      drafts.push(draft);
    }
  }

  const spanIndexById = new Map(args.harmonic.chordTimeline.map((span, index) => [span.id, index]));
  const boundaryBridgesFor = (slot: SlotDraft): readonly LeadContinuityBoundaryBridge[] => {
    // Rest is an explicit R sentence; it never creates a held pitch.
    if (slot.role === 'rest') return [{ kind: 'release-at-boundary' }];
    const spanIndex = spanIndexById.get(slot.sourceSpanId);
    const source = spanIndex === undefined ? undefined : args.harmonic.chordTimeline[spanIndex];
    const sourceEnd = source
      ? (source.startBeat as number) + (source.durationBeats as number)
      : undefined;
    const next = spanIndex === undefined ? undefined : args.harmonic.chordTimeline[spanIndex + 1];
    if (!source || !next || sourceEnd === undefined || Math.abs(slot.endBeat - sourceEnd) > EPSILON) {
      return [{ kind: 'release-at-boundary' }];
    }
    const nextStart = next.startBeat as number;
    const target = drafts.find((candidate) => candidate.sourceSpanId === next.id
      && candidate.role !== 'rest'
      && candidate.startBeat <= nextStart + EPSILON
      && candidate.endBeat > nextStart + EPSILON);
    if (!target) return [{ kind: 'release-at-boundary' }];

    const sourceStable = normalizePitchClasses(args.harmonic.stableToneMap[source.id] ?? []);
    const targetStable = normalizePitchClasses(args.harmonic.stableToneMap[next.id] ?? []);
    const commonTones = sourceStable.filter((pitchClass) => targetStable.includes(pitchClass));
    return commonTones.length > 0
      ? [
        {
          kind: 'common-tone',
          targetSpanId: next.id,
          continuationPcs: commonTones,
        },
        { kind: 'release-at-boundary' },
      ]
      : [{ kind: 'release-at-boundary' }];
  };

  const slots: LofiLeadContinuitySlot[] = drafts.map((draft) => ({
    ...draft,
    boundaryBridges: boundaryBridgesFor(draft),
  }));
  const slotIdsByAbsoluteBar: Record<string, readonly string[]> = {};
  for (const slot of slots) {
    const key = String(slot.absoluteBar);
    slotIdsByAbsoluteBar[key] = [...(slotIdsByAbsoluteBar[key] ?? []), slot.id];
  }

  const events: LofiLeadScoreEvent[] = [];
  const blueprint = args.arrangement.lofiLeadBlueprintPlan;
  if (blueprint) {
    const registerLow = args.leadRegister?.lowMidi ?? 60;
    const registerHigh = args.leadRegister?.highMidi ?? 84;
    const registerCenter = (registerLow + registerHigh) / 2;
    const statementPitchByMotifEvent = new Map<string, number>();
    for (const bar of bars) {
      if (bar.role === 'rest' || bar.phraseRole === 'rest') continue;
      const compiledLeadBrick = compiledBrickByAbsoluteBar.get(bar.absoluteBar);
      if (!compiledLeadBrick || !bar.leadRoadMapBrickId) continue;
      const motifId = bar.motifId ?? `${bar.phraseId}:${blueprint.motifCell.id}`;
      const roleEvents = applyBrickTextureProjection(
        lofiLeadEventsForRole(blueprint, bar.phraseRole),
        compiledLeadBrick.textureProjection,
      );
      let previousMidi: number | undefined;
      for (let roleEventIndex = 0; roleEventIndex < roleEvents.length; roleEventIndex++) {
        const roleEvent = roleEvents[roleEventIndex]!;
        const startBeat = bar.startBeat + roleEvent.event.offsetBeat;
        if (startBeat >= bar.endBeat - EPSILON) continue;
        const slot = slots.find((candidate) =>
          candidate.barId === bar.id
          && candidate.role !== 'rest'
          && startBeat >= candidate.startBeat - EPSILON
          && startBeat < candidate.endBeat - EPSILON);
        if (!slot) continue;
        const spanIndex = args.harmonic.chordTimeline.findIndex((span) => span.id === slot.sourceSpanId);
        if (spanIndex < 0) continue;
        const motifEventKey = `${motifId}:${roleEvent.sourceEventIndex}`;
        const statementPitch = statementPitchByMotifEvent.get(motifEventKey);
        const exactRecall = bar.phraseRole === 'return'
          || roleEvent.transform === 'exact'
          || roleEvent.transform === 'terminal-hold'
          || roleEvent.transform === 'last-note-tag';
        const desiredMidi = exactRecall && statementPitch !== undefined
          ? statementPitch
          : previousMidi !== undefined
            ? previousMidi + roleEvent.event.diatonicStepFromPrevious * 2
            : statementPitch ?? registerCenter;
        const candidates = pitchCandidates(
          admissionPcsForRole(args.harmonic, slot.sourceSpanId, roleEvent.event.harmonicRole),
          registerLow,
          registerHigh,
        );
        const pitchMidi = chooseWrittenPitch({
          candidates,
          desiredMidi,
          previousMidi,
          registerCenter,
        });
        if (pitchMidi === undefined) continue;
        const pitchClass = ((pitchMidi % 12) + 12) % 12;
        const nextRoleEvent = roleEvents[roleEventIndex + 1];
        const nextStartBeat = nextRoleEvent
          ? bar.startBeat + nextRoleEvent.event.offsetBeat
          : Number.POSITIVE_INFINITY;
        const requestedEndBeat = Math.min(
          bar.endBeat,
          nextStartBeat,
          startBeat + roleEvent.event.durationBeats,
        );
        const duration = admittedDuration({
          harmonic: args.harmonic,
          sourceSpanIndex: spanIndex,
          startBeat,
          requestedEndBeat,
          pitchClass,
          allowCommonTone: roleEvent.event.sustainPolicy === 'common-tone',
        });
        if (duration.endBeat <= startBeat + EPSILON) continue;
        if (bar.phraseRole === 'statement') {
          statementPitchByMotifEvent.set(motifEventKey, pitchMidi);
        }
        events.push({
          id: `${bar.id}:${blueprint.motifCell.id}:${roleEvent.sourceEventIndex}:${startBeat.toFixed(4)}`,
          barId: bar.id,
          slotId: slot.id,
          sectionId: bar.sectionId,
          absoluteBar: bar.absoluteBar,
          phraseId: bar.phraseId,
          motifId,
          phraseRole: bar.phraseRole,
          sourceCellId: blueprint.motifCell.id,
          leadRoadMapBrickId: compiledLeadBrick.arrangerBrickId,
          leadBrickKind: compiledLeadBrick.brickKind,
          leadTextureTag: compiledLeadBrick.resolvedTextureTag,
          leadTextureResolution: compiledLeadBrick.sourceResolution,
          ...(compiledLeadBrick.sourceGrammarRuleId
            ? { sourceGrammarRuleId: compiledLeadBrick.sourceGrammarRuleId }
            // ★ ending 重构:outro 收束小节的 roadmap brick 原为 rest(无语法规则),素材真源 =
            //   blueprint.motifCell → 诚实溯源(此前非 rest 小节必有规则,兜底只命中 outro 收束)
            : { sourceGrammarRuleId: `outro-return:${blueprint.motifCell.id}` }),
          ...(compiledLeadBrick.sourceGrammarBrickType
            ? { sourceGrammarBrickType: compiledLeadBrick.sourceGrammarBrickType }
            : {}),
          sourceEventIndex: roleEvent.sourceEventIndex,
          transform: roleEvent.transform,
          startBeat,
          durationBeats: duration.endBeat - startBeat,
          pitchMidi,
          pitchClass,
          tokenKind: tokenKindForRole(roleEvent.event.harmonicRole),
          harmonicRole: roleEvent.event.harmonicRole,
          sourceSpanId: slot.sourceSpanId,
          admittedSpanIds: duration.spanIds,
        });
        previousMidi = pitchMidi;
      }
    }
  }

  const runtimeRoadMap = arrangerRoadMap
    ? materializeArrangerLeadRoadMap(arrangerRoadMap, compiledRoadMapBricks, args.roadMap)
    : args.roadMap ? copyRoadMap(args.roadMap) : undefined;
  return deepFreeze({
    ...(arrangerRoadMap ? { arrangerRoadMap: copyArrangerRoadMap(arrangerRoadMap) } : {}),
    compiledRoadMapBricks,
    ...(runtimeRoadMap ? { roadMap: runtimeRoadMap } : {}),
    ...(args.roadMap ? { harmonicRoadMap: copyRoadMap(args.roadMap) } : {}),
    ...(args.leadTailPolicy === undefined ? {} : { leadTailPolicy: args.leadTailPolicy }),
    phraseBars: args.phraseInteractionPlan.phraseBars,
    silenceWindows: copySilenceWindows(args.leadPresencePlan.silenceWindows),
    entryBeats,
    bars,
    barById,
    slots,
    slotIdsByAbsoluteBar,
    events,
  });
}
