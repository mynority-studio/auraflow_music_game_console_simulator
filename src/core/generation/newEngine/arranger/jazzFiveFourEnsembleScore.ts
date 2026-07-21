// ============================================================
// newEngine · arranger · Jazz 5/4 ensemble score directives
// ------------------------------------------------------------
// Arranger freezes the complete role relationship before any score compiler
// chooses pitches.  Texture/variation IDs address product KB materials;
// complete Drum phrases are placed as indivisible, pattern-relative spans.
// ============================================================

import { deepFreeze, type DeepReadonly, type Meter } from '../foundation';
import {
  selectJazzFiveFourEnsembleVariants,
  type JazzFiveFourEnsembleVariantSelection,
  type JazzFiveFourInteractionIntent,
  type JazzFiveFourMutationUnit,
  type JazzFiveFourPhraseFunction,
  type JazzFiveFourPhrasePosition,
} from '../knowledge/jazzFiveFourEnsembleVariationKnowledge';
import {
  jazzFiveFourDrumPhrasePattern,
  type JazzFiveFourDrumPhrasePattern,
  type JazzFiveFourDrumPhrasePatternId,
} from '../knowledge/jazzFiveFourDrumPhraseKnowledge';
import {
  JAZZ_FIVE_FOUR_FOUNDATION_MODES,
  type JazzFiveFourBassTextureVariantId,
  type JazzFiveFourFoundationMode,
  type JazzFiveFourPianoTextureVariantId,
} from '../knowledge/jazzFiveFourTextureKnowledge';
import type { Phrase, Section } from './ArrangementPlan';

export type JazzFiveFourEnsembleScoreMode = 'canonical-reference' | 'generative';
export type JazzFiveFourEnsembleScoreRole = 'bass' | 'comp' | 'lead' | 'drum';
export type JazzFiveFourCodaReturnMode = 'full-ensemble-return' | 'continue-comp-foundation';
export type JazzFiveFourRoleMaterialOwner =
  | 'silent'
  | 'bass-texture'
  | 'piano-texture'
  | 'lead-score'
  | 'drum-phrase';

export interface JazzFiveFourCodaEnsembleDirective {
  readonly returnMode: JazzFiveFourCodaReturnMode;
}

/** One role's complete, pitchless decision for one score bar. */
export interface JazzFiveFourPerBarRoleDirective {
  readonly role: JazzFiveFourEnsembleScoreRole;
  readonly active: boolean;
  readonly materialOwner: JazzFiveFourRoleMaterialOwner;
  /** Whole-bar/whole-phrase attack-mask choice from the ensemble variation KB. */
  readonly variationId?: string;
  readonly variationMutationUnit?: JazzFiveFourMutationUnit;
  /** Bass or Piano semantic material. Concrete notes remain post-harmony. */
  readonly textureVariantId?: JazzFiveFourBassTextureVariantId | JazzFiveFourPianoTextureVariantId;
  /** Drum bars point to one indivisible phrase placement and its source-relative bar. */
  readonly drumPhraseDirectiveId?: string;
  readonly drumPhraseBarOffset?: number;
}

export interface JazzFiveFourEnsembleInteractionCue {
  readonly id: string;
  readonly foundationSource: 'bass' | 'comp';
  readonly responseRoles: readonly JazzFiveFourEnsembleScoreRole[];
  readonly ensembleIntent: JazzFiveFourInteractionIntent;
  readonly drumVariationIntent: JazzFiveFourInteractionIntent;
  readonly drumPhraseIntent: JazzFiveFourDrumPhrasePattern['interactionIntent'];
  /** All bars in one Arranger selection scope retain the same KB variation choice. */
  readonly selectionScopeId: string;
  readonly selectionKey: string;
}

export interface JazzFiveFourEnsembleBarDirective {
  readonly id: string;
  /** Song-global, zero-based bar. */
  readonly absoluteBar: number;
  readonly sectionId: string;
  readonly barInSection: number;
  readonly phraseId: string;
  readonly phraseOrdinal: number;
  readonly phraseFunction: JazzFiveFourPhraseFunction;
  readonly phrasePosition: JazzFiveFourPhrasePosition;
  readonly activeRoles: readonly JazzFiveFourEnsembleScoreRole[];
  readonly foundationMode: JazzFiveFourFoundationMode;
  readonly foundationOwner: 'bass' | 'comp';
  readonly roleDirectives: readonly JazzFiveFourPerBarRoleDirective[];
  readonly interactionCue: JazzFiveFourEnsembleInteractionCue;
}

/** Placement of one complete Drum KB pattern; no event-level selection exists here. */
export interface JazzFiveFourWholeDrumPhraseDirective {
  readonly id: string;
  readonly sectionId: string;
  readonly phraseId: string;
  readonly selectionScopeId: string;
  readonly startBar: number;
  readonly startBarInSection: number;
  readonly spanBars: number;
  readonly patternId: JazzFiveFourDrumPhrasePatternId;
  readonly mutationUnit: JazzFiveFourDrumPhrasePattern['mutationUnit'];
  readonly barOffsetPolicy: 'pattern-relative';
  readonly interactionIntent: JazzFiveFourDrumPhrasePattern['interactionIntent'];
}

export interface JazzFiveFourEnsembleScoreData {
  readonly schemaVersion: 1;
  readonly mode: JazzFiveFourEnsembleScoreMode;
  readonly totalBars: 33;
  readonly codaDirective: JazzFiveFourCodaEnsembleDirective;
  readonly barDirectives: readonly JazzFiveFourEnsembleBarDirective[];
  readonly drumPhraseDirectives: readonly JazzFiveFourWholeDrumPhraseDirective[];
}

export type JazzFiveFourEnsembleScore = DeepReadonly<JazzFiveFourEnsembleScoreData>;

interface BasePlannerArgs {
  readonly meter: Meter;
  readonly sections: readonly Section[];
  readonly phrases: readonly Phrase[];
}

export interface PlanJazzFiveFourReferenceEnsembleScoreArgs extends BasePlannerArgs {
  readonly mode: 'canonical-reference';
}

export interface PlanJazzFiveFourGenerativeEnsembleScoreArgs extends BasePlannerArgs {
  readonly mode: 'generative';
  readonly seed: number;
  /** Required by design: Coda participation can never be inferred downstream. */
  readonly codaDirective: JazzFiveFourCodaEnsembleDirective;
}

export type PlanJazzFiveFourEnsembleScoreArgs =
  | PlanJazzFiveFourReferenceEnsembleScoreArgs
  | PlanJazzFiveFourGenerativeEnsembleScoreArgs;

const ROLE_ORDER = Object.freeze(['bass', 'comp', 'lead', 'drum'] as const);
const REFERENCE_SECTIONS = Object.freeze([
  Object.freeze({ id: 'pickup', bars: 1 }),
  Object.freeze({ id: 'headA', bars: 8 }),
  Object.freeze({ id: 'headB', bars: 8 }),
  Object.freeze({ id: 'headOut', bars: 8 }),
  Object.freeze({ id: 'coda', bars: 8 }),
] as const);

const CANONICAL_CODA_DIRECTIVE: JazzFiveFourCodaEnsembleDirective = Object.freeze({
  returnMode: 'full-ensemble-return',
});

interface PhraseSelectionSpan {
  readonly section: Section;
  readonly sectionStartBar: number;
  readonly phrase: Phrase;
  readonly phraseOrdinal: number;
  readonly startBarInSection: number;
  readonly spanBars: number;
  readonly phraseFunction: JazzFiveFourPhraseFunction;
  readonly phrasePosition: JazzFiveFourPhrasePosition;
  readonly selectionScopeId: string;
  readonly selection: JazzFiveFourEnsembleVariantSelection;
}

interface DrumBarAssignment {
  readonly directive: JazzFiveFourWholeDrumPhraseDirective;
  readonly barOffset: number;
  readonly pattern: DeepReadonly<JazzFiveFourDrumPhrasePattern>;
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assertReferenceForm(args: BasePlannerArgs): void {
  if (args.meter.numerator !== 5 || args.meter.denominator !== 4) {
    throw new RangeError('Jazz 5/4 ensemble score requires an exact 5/4 meter');
  }
  if (args.sections.length !== REFERENCE_SECTIONS.length) {
    throw new RangeError(`Jazz 5/4 ensemble score requires ${REFERENCE_SECTIONS.length} whole sections`);
  }
  let totalBars = 0;
  for (let index = 0; index < REFERENCE_SECTIONS.length; index += 1) {
    const expected = REFERENCE_SECTIONS[index]!;
    const actual = args.sections[index]!;
    if (actual.id !== expected.id || actual.bars !== expected.bars) {
      throw new RangeError(
        `Jazz 5/4 ensemble form expected ${expected.id}:${expected.bars}, received ${actual.id}:${actual.bars}`,
      );
    }
    totalBars += actual.bars;
  }
  if (totalBars !== 33) throw new RangeError(`Jazz 5/4 ensemble score requires 33 bars, received ${totalBars}`);
}

function phraseFunction(sectionId: string): JazzFiveFourPhraseFunction {
  switch (sectionId) {
    case 'pickup': return 'pickup';
    case 'headA': return 'head-a';
    case 'headB': return 'head-b';
    case 'headOut': return 'recap';
    case 'coda': return 'coda';
    default: throw new RangeError(`No Jazz 5/4 ensemble function for section ${sectionId}`);
  }
}

function phrasePosition(
  sectionId: string,
  phraseIndex: number,
  phraseCount: number,
): JazzFiveFourPhrasePosition {
  if (sectionId === 'pickup') return 'opening';
  if (sectionId === 'coda' && phraseIndex === phraseCount - 1) return 'ending';
  if (phraseIndex === 0) return 'opening';
  if (phraseIndex === phraseCount - 1) return sectionId === 'headB' ? 'turnaround' : 'answer';
  return phraseIndex % 2 === 0 ? 'continuation' : 'answer';
}

function sectionIntensity(sectionId: string): number {
  switch (sectionId) {
    case 'pickup': return 0.4;
    case 'headA': return 0.58;
    case 'headB': return 0.74;
    case 'headOut': return 0.78;
    case 'coda': return 0.86;
    default: return 0.6;
  }
}

function buildSelectionSpans(args: PlanJazzFiveFourEnsembleScoreArgs): readonly PhraseSelectionSpan[] {
  const spans: PhraseSelectionSpan[] = [];
  let sectionStartBar = 0;
  let phraseOrdinal = 0;
  for (const section of args.sections) {
    const sectionPhrases = args.phrases
      .filter((phrase) => phrase.sectionId === section.id)
      .sort((left, right) => left.phraseSlot - right.phraseSlot);
    if (sectionPhrases.length === 0) {
      throw new RangeError(`Jazz 5/4 ensemble section ${section.id} has no Arranger phrase owner`);
    }
    let cursor = 0;
    for (let index = 0; index < sectionPhrases.length; index += 1) {
      const phrase = sectionPhrases[index]!;
      const startBarInSection = phrase.phraseSlot * phrase.bars;
      const nextStart = index + 1 < sectionPhrases.length
        ? sectionPhrases[index + 1]!.phraseSlot * sectionPhrases[index + 1]!.bars
        : section.bars;
      const endBarInSection = Math.min(section.bars, nextStart);
      if (startBarInSection !== cursor || endBarInSection <= startBarInSection) {
        throw new RangeError(`Jazz 5/4 ensemble phrase coverage gap/overlap in ${section.id} at bar ${cursor}`);
      }
      const functionId = phraseFunction(section.id);
      const position = phrasePosition(section.id, index, sectionPhrases.length);
      const selectionScopeId = `j54-ensemble:${section.id}:${phrase.id}`;
      const selection = selectJazzFiveFourEnsembleVariants({
        seed: args.mode === 'canonical-reference' ? 0 : args.seed,
        sectionId: section.id,
        phraseOrdinal,
        barInPhrase: 0,
        phraseFunction: functionId,
        phrasePosition: position,
        intensity: sectionIntensity(section.id),
        mode: args.mode,
      });
      spans.push({
        section,
        sectionStartBar,
        phrase,
        phraseOrdinal,
        startBarInSection,
        spanBars: endBarInSection - startBarInSection,
        phraseFunction: functionId,
        phrasePosition: position,
        selectionScopeId,
        selection,
      });
      cursor = endBarInSection;
      phraseOrdinal += 1;
    }
    if (cursor !== section.bars) {
      throw new RangeError(`Jazz 5/4 ensemble phrases cover ${cursor}/${section.bars} bars in ${section.id}`);
    }
    sectionStartBar += section.bars;
  }
  return Object.freeze(spans);
}

function generativeDrumCandidates(
  span: PhraseSelectionSpan,
): readonly JazzFiveFourDrumPhrasePatternId[] {
  switch (span.selection.drum.id) {
    case 'drum.core.metric-skeleton':
      return ['downbeatBomb', 'coreKeepTime'];
    case 'drum.core.ride-development':
      return span.phraseFunction === 'head-b'
        ? ['freeSoloPhrase', 'tomOstinato2Bar', 'rideDevelopmentOverlay']
        : ['rideDevelopmentOverlay'];
    case 'drum.core.dialogue-answer':
      if (span.phraseFunction === 'coda') {
        return ['lateEndingHit', 'returnFill', 'rollBombCallResponse2Bar', 'downbeatBomb'];
      }
      if (span.phraseFunction === 'recap') {
        return ['returnFill', 'rollBombCallResponse2Bar', 'snareCrescendo3Beat', 'downbeatBomb'];
      }
      return ['rollBombCallResponse2Bar', 'snareCrescendo3Beat', 'downbeatBomb'];
    default:
      return ['coreKeepTime'];
  }
}

function selectDrumPattern(
  args: PlanJazzFiveFourEnsembleScoreArgs,
  span: PhraseSelectionSpan,
  cursor: number,
  remainingBars: number,
): DeepReadonly<JazzFiveFourDrumPhrasePattern> {
  if (args.mode === 'canonical-reference') return jazzFiveFourDrumPhrasePattern('coreKeepTime');
  const ids = generativeDrumCandidates(span).filter((id) =>
    jazzFiveFourDrumPhrasePattern(id).spanBars <= remainingBars);
  const eligible = ids.length > 0 ? ids : ['coreKeepTime' as const];
  const key = `${args.seed}:${span.selection.selectionKey}:drum-phrase:${cursor}:${remainingBars}`;
  return jazzFiveFourDrumPhrasePattern(eligible[stableHash(key) % eligible.length]!);
}

function buildDrumPhraseDirectives(
  args: PlanJazzFiveFourEnsembleScoreArgs,
  spans: readonly PhraseSelectionSpan[],
): {
  readonly directives: readonly JazzFiveFourWholeDrumPhraseDirective[];
  readonly byAbsoluteBar: ReadonlyMap<number, DrumBarAssignment>;
} {
  const directives: JazzFiveFourWholeDrumPhraseDirective[] = [];
  const byAbsoluteBar = new Map<number, DrumBarAssignment>();
  for (const span of spans) {
    let cursor = 0;
    while (cursor < span.spanBars) {
      const pattern = selectDrumPattern(args, span, cursor, span.spanBars - cursor);
      const startBarInSection = span.startBarInSection + cursor;
      const startBar = span.sectionStartBar + startBarInSection;
      const directive: JazzFiveFourWholeDrumPhraseDirective = Object.freeze({
        id: `j54-drum-phrase:${directives.length}:${span.section.id}@${startBar}:${pattern.id}`,
        sectionId: span.section.id,
        phraseId: span.phrase.id,
        selectionScopeId: span.selectionScopeId,
        startBar,
        startBarInSection,
        spanBars: pattern.spanBars,
        patternId: pattern.id,
        mutationUnit: pattern.mutationUnit,
        barOffsetPolicy: 'pattern-relative' as const,
        interactionIntent: pattern.interactionIntent,
      });
      directives.push(directive);
      for (let barOffset = 0; barOffset < pattern.spanBars; barOffset += 1) {
        const absoluteBar = startBar + barOffset;
        if (byAbsoluteBar.has(absoluteBar)) {
          throw new RangeError(`Jazz 5/4 Drum phrase overlap at absolute bar ${absoluteBar}`);
        }
        byAbsoluteBar.set(absoluteBar, Object.freeze({ directive, barOffset, pattern }));
      }
      cursor += pattern.spanBars;
    }
  }
  if (byAbsoluteBar.size !== 33) {
    throw new RangeError(`Jazz 5/4 Drum phrases cover ${byAbsoluteBar.size}/33 bars`);
  }
  return { directives: Object.freeze(directives), byAbsoluteBar };
}

function foundationModeFor(
  args: PlanJazzFiveFourEnsembleScoreArgs,
  sectionId: string,
): JazzFiveFourFoundationMode {
  if (args.mode === 'canonical-reference') return 'acousticBass+fullPiano';
  if (sectionId === 'pickup' || sectionId === 'headA') return 'keyboardBassOnly';
  if (sectionId === 'coda' && args.codaDirective.returnMode === 'full-ensemble-return') {
    return 'acousticBass+fullPiano';
  }
  return 'compOwnsFoundation';
}

function bassTextureFor(
  args: PlanJazzFiveFourEnsembleScoreArgs,
  sectionId: string,
  barInSection: number,
  sectionBars: number,
): JazzFiveFourBassTextureVariantId | undefined {
  if (args.mode === 'canonical-reference') return 'acoustic.a';
  if (sectionId === 'pickup' || sectionId === 'headA') return 'keyboardFoundation.a';
  if (sectionId !== 'coda' || args.codaDirective.returnMode !== 'full-ensemble-return') return undefined;
  return barInSection === sectionBars - 1 ? 'ending.hold' : 'ending.lift';
}

function pianoTextureFor(
  args: PlanJazzFiveFourEnsembleScoreArgs,
  sectionId: string,
  barInSection: number,
  sectionBars: number,
): JazzFiveFourPianoTextureVariantId | undefined {
  if (args.mode === 'canonical-reference') return 'a.full';
  if (sectionId === 'pickup' || sectionId === 'headA') return undefined;
  if (sectionId === 'headB') {
    return barInSection === sectionBars - 1 ? 'b.turnaround.full' : 'b.body.full';
  }
  if (sectionId === 'headOut') return barInSection === sectionBars - 1 ? 'a.fill' : 'a.full';
  if (sectionId === 'coda') return barInSection === sectionBars - 1 ? 'ending.hold' : 'a.full';
  throw new RangeError(`No Jazz 5/4 Piano texture mapping for ${sectionId}`);
}

function activeRolesForMode(mode: JazzFiveFourFoundationMode): readonly JazzFiveFourEnsembleScoreRole[] {
  const policy = JAZZ_FIVE_FOUR_FOUNDATION_MODES[mode];
  return Object.freeze(ROLE_ORDER.filter((role) => {
    if (role === 'bass') return policy.bassActive;
    if (role === 'comp') return policy.compFoundationActive || policy.compUpperActive;
    return true;
  }));
}

function variationForRole(
  selection: JazzFiveFourEnsembleVariantSelection,
  role: 'bass' | 'comp' | 'drum',
): JazzFiveFourEnsembleVariantSelection[typeof role] {
  return selection[role];
}

function buildRoleDirectives(input: {
  readonly span: PhraseSelectionSpan;
  readonly foundationMode: JazzFiveFourFoundationMode;
  readonly bassTextureId?: JazzFiveFourBassTextureVariantId;
  readonly pianoTextureId?: JazzFiveFourPianoTextureVariantId;
  readonly drumAssignment: DrumBarAssignment;
}): readonly JazzFiveFourPerBarRoleDirective[] {
  const active = new Set(activeRolesForMode(input.foundationMode));
  const bassVariation = variationForRole(input.span.selection, 'bass');
  const compVariation = variationForRole(input.span.selection, 'comp');
  const drumVariation = variationForRole(input.span.selection, 'drum');
  return Object.freeze([
    Object.freeze(active.has('bass') ? {
      role: 'bass' as const,
      active: true,
      materialOwner: 'bass-texture' as const,
      variationId: bassVariation.id,
      variationMutationUnit: bassVariation.mutationUnit,
      textureVariantId: input.bassTextureId,
    } : {
      role: 'bass' as const, active: false, materialOwner: 'silent' as const,
    }),
    Object.freeze(active.has('comp') ? {
      role: 'comp' as const,
      active: true,
      materialOwner: 'piano-texture' as const,
      variationId: compVariation.id,
      variationMutationUnit: compVariation.mutationUnit,
      textureVariantId: input.pianoTextureId,
    } : {
      role: 'comp' as const, active: false, materialOwner: 'silent' as const,
    }),
    Object.freeze({
      role: 'lead' as const, active: true, materialOwner: 'lead-score' as const,
    }),
    Object.freeze({
      role: 'drum' as const,
      active: true,
      materialOwner: 'drum-phrase' as const,
      variationId: drumVariation.id,
      variationMutationUnit: drumVariation.mutationUnit,
      drumPhraseDirectiveId: input.drumAssignment.directive.id,
      drumPhraseBarOffset: input.drumAssignment.barOffset,
    }),
  ]);
}

function assertCompleteScore(score: JazzFiveFourEnsembleScoreData): void {
  if (score.barDirectives.length !== 33) {
    throw new RangeError(`Jazz 5/4 ensemble score covers ${score.barDirectives.length}/33 bars`);
  }
  for (let absoluteBar = 0; absoluteBar < score.barDirectives.length; absoluteBar += 1) {
    const bar = score.barDirectives[absoluteBar]!;
    if (bar.absoluteBar !== absoluteBar) {
      throw new RangeError(`Jazz 5/4 ensemble score gap/overlap at absolute bar ${absoluteBar}`);
    }
    if (bar.roleDirectives.length !== ROLE_ORDER.length
      || bar.roleDirectives.some((role, index) => role.role !== ROLE_ORDER[index])) {
      throw new RangeError(`Jazz 5/4 ensemble role coverage is incomplete at bar ${absoluteBar}`);
    }
    const active = bar.roleDirectives.filter((role) => role.active).map((role) => role.role);
    if (active.join('|') !== bar.activeRoles.join('|')) {
      throw new RangeError(`Jazz 5/4 ensemble active-role projection differs at bar ${absoluteBar}`);
    }
    const policy = JAZZ_FIVE_FOUR_FOUNDATION_MODES[bar.foundationMode];
    if (policy.foundationOwner !== bar.foundationOwner
      || !bar.roleDirectives.find((role) => role.role === bar.foundationOwner)?.active) {
      throw new RangeError(`Jazz 5/4 ensemble foundation hole at bar ${absoluteBar}`);
    }
    const drum = bar.roleDirectives.find((role) => role.role === 'drum');
    if (!drum?.drumPhraseDirectiveId || !Number.isInteger(drum.drumPhraseBarOffset)) {
      throw new RangeError(`Jazz 5/4 ensemble Drum phrase ownership is missing at bar ${absoluteBar}`);
    }
  }
  if (score.mode === 'canonical-reference') {
    for (const bar of score.barDirectives) {
      const bass = bar.roleDirectives[0]!;
      const comp = bar.roleDirectives[1]!;
      const drum = bar.roleDirectives[3]!;
      if (bar.foundationMode !== 'acousticBass+fullPiano'
        || bar.foundationOwner !== 'bass'
        || bar.activeRoles.join('|') !== 'bass|comp|lead|drum'
        || bass.variationId !== 'bass.a.source-canonical'
        || bass.textureVariantId !== 'acoustic.a'
        || comp.variationId !== 'comp.a.source-canonical'
        || comp.textureVariantId !== 'a.full'
        || drum.variationId !== 'drum.core.source-canonical') {
        throw new RangeError(`Jazz 5/4 canonical Gate-G material changed at bar ${bar.absoluteBar}`);
      }
    }
    if (score.drumPhraseDirectives.some((directive) => directive.patternId !== 'coreKeepTime')) {
      throw new RangeError('Jazz 5/4 canonical Gate-G Drum phrase changed');
    }
  }
}

/**
 * Freeze the 33-bar ensemble score. Reference mode is the immutable Gate-G
 * control. Generative mode is an explicit API only; no current product ID
 * selects it until its downstream compiler and listening gate are approved.
 */
export function planJazzFiveFourEnsembleScore(
  args: PlanJazzFiveFourEnsembleScoreArgs,
): JazzFiveFourEnsembleScore {
  assertReferenceForm(args);
  if (args.mode === 'generative' && (!Number.isSafeInteger(args.seed) || !args.codaDirective)) {
    throw new RangeError('Jazz 5/4 generative ensemble score requires an integer seed and explicit Coda directive');
  }
  if (args.mode === 'generative'
    && args.codaDirective.returnMode !== 'full-ensemble-return'
    && args.codaDirective.returnMode !== 'continue-comp-foundation') {
    throw new RangeError(`Unknown Jazz 5/4 Coda return mode: ${String(args.codaDirective.returnMode)}`);
  }
  const spans = buildSelectionSpans(args);
  const drumScore = buildDrumPhraseDirectives(args, spans);
  const barDirectives: JazzFiveFourEnsembleBarDirective[] = [];

  for (const span of spans) {
    for (let barOffset = 0; barOffset < span.spanBars; barOffset += 1) {
      const barInSection = span.startBarInSection + barOffset;
      const absoluteBar = span.sectionStartBar + barInSection;
      const drumAssignment = drumScore.byAbsoluteBar.get(absoluteBar);
      if (!drumAssignment) throw new RangeError(`Jazz 5/4 Drum phrase gap at absolute bar ${absoluteBar}`);
      const foundationMode = foundationModeFor(args, span.section.id);
      const policy = JAZZ_FIVE_FOUR_FOUNDATION_MODES[foundationMode];
      const activeRoles = activeRolesForMode(foundationMode);
      const bassTextureId = bassTextureFor(args, span.section.id, barInSection, span.section.bars);
      const pianoTextureId = pianoTextureFor(args, span.section.id, barInSection, span.section.bars);
      const roleDirectives = buildRoleDirectives({
        span,
        foundationMode,
        bassTextureId,
        pianoTextureId,
        drumAssignment,
      });
      const foundationVariation = policy.foundationOwner === 'bass'
        ? span.selection.bass
        : span.selection.comp;
      barDirectives.push(Object.freeze({
        id: `j54-ensemble-bar:${absoluteBar}:${span.section.id}:${barInSection}`,
        absoluteBar,
        sectionId: span.section.id,
        barInSection,
        phraseId: span.phrase.id,
        phraseOrdinal: span.phraseOrdinal,
        phraseFunction: span.phraseFunction,
        phrasePosition: span.phrasePosition,
        activeRoles,
        foundationMode,
        foundationOwner: policy.foundationOwner,
        roleDirectives,
        interactionCue: Object.freeze({
          id: `j54-interaction:${absoluteBar}:${span.selectionScopeId}`,
          foundationSource: policy.foundationOwner,
          responseRoles: Object.freeze(activeRoles.filter((role) => role !== policy.foundationOwner)),
          ensembleIntent: foundationVariation.interactionIntent,
          drumVariationIntent: span.selection.drum.interactionIntent,
          drumPhraseIntent: drumAssignment.pattern.interactionIntent,
          selectionScopeId: span.selectionScopeId,
          selectionKey: span.selection.selectionKey,
        }),
      }));
    }
  }

  const score: JazzFiveFourEnsembleScoreData = {
    schemaVersion: 1,
    mode: args.mode,
    totalBars: 33,
    codaDirective: args.mode === 'canonical-reference'
      ? CANONICAL_CODA_DIRECTIVE
      : Object.freeze({ ...args.codaDirective }),
    barDirectives,
    drumPhraseDirectives: drumScore.directives,
  };
  assertCompleteScore(score);
  return deepFreeze(score);
}

export function jazzFiveFourBarRoleDirective(
  bar: DeepReadonly<JazzFiveFourEnsembleBarDirective>,
  role: JazzFiveFourEnsembleScoreRole,
): DeepReadonly<JazzFiveFourPerBarRoleDirective> {
  const found = bar.roleDirectives.find((directive) => directive.role === role);
  if (!found) throw new RangeError(`Jazz 5/4 ensemble bar ${bar.absoluteBar} has no ${role} directive`);
  return found;
}
