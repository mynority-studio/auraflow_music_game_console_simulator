// ============================================================
// newEngine · knowledge · Jazz 5/4 ensemble phrase variants
// ------------------------------------------------------------
// Reusable product vocabulary for Bass/Comp/Drum variation.  A variant owns
// a complete attack mask (cell/bar/phrase mutation unit); consumers are never
// allowed to probabilistically drop individual events. The reference variant remains
// an immutable control for Gate G.
// ============================================================

import { deepFreeze, type DeepReadonly } from '../foundation';
import {
  JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS,
  JAZZ_FIVE_FOUR_UPPER_COMP_CELLS,
  jazzFiveFourRoleBeatToEngineTicks,
  type JazzFiveFourRationalBeat,
  type JazzFiveFourRoleCell,
} from './jazzFiveFourRoleKnowledge';
import {
  JAZZ_FIVE_FOUR_CORE_KEEP_TIME,
  jazzFiveFourDrumPhaseTicks,
} from './jazzFiveFourDrumKnowledge';

export type JazzFiveFourEnsembleRole = 'bass' | 'comp' | 'drum';
export type JazzFiveFourPhraseFunction =
  | 'pickup'
  | 'head-a'
  | 'head-b'
  | 'solo'
  | 'recap'
  | 'coda';
export type JazzFiveFourPhrasePosition =
  | 'opening'
  | 'continuation'
  | 'answer'
  | 'breakdown'
  | 'turnaround'
  | 'ending';
export type JazzFiveFourVariantDensity = 'sparse' | 'medium' | 'full';
export type JazzFiveFourInteractionIntent =
  | 'canonical-interlock'
  | 'foundation-space'
  | 'lead-space'
  | 'middle-answer'
  | 'metric-clarity'
  | 'phrase-lift'
  | 'turnaround-release';
export type JazzFiveFourMutationUnit = 'whole-cell' | 'whole-bar' | 'whole-phrase';

export interface JazzFiveFourAttackGroup {
  /** Bar-local rational phase. No source-global/section-local origin is stored. */
  readonly phase: JazzFiveFourRationalBeat;
  /** IDs are semantic source-cell references, never concrete pitches. */
  readonly sourceCellIds: readonly string[];
}

export interface JazzFiveFourVariantApplicability {
  readonly phraseFunctions: readonly JazzFiveFourPhraseFunction[];
  readonly phrasePositions: readonly JazzFiveFourPhrasePosition[];
  readonly minIntensity: number;
  readonly maxIntensity: number;
}

export interface JazzFiveFourVariantBudget {
  readonly timingResidualMaxTicks: 0;
  readonly velocityScale: number;
  readonly registerOctaveShift: -1 | 0 | 1;
  readonly mayChangeAttackMask: boolean;
}

export interface JazzFiveFourEnsembleVariant {
  readonly id: string;
  readonly role: JazzFiveFourEnsembleRole;
  readonly familyId: string;
  readonly referenceCanonical: boolean;
  readonly generativeEligible: boolean;
  readonly mutationUnit: JazzFiveFourMutationUnit;
  readonly density: JazzFiveFourVariantDensity;
  readonly interactionIntent: JazzFiveFourInteractionIntent;
  readonly cadenceRole: 'none' | 'setup' | 'arrival';
  readonly selectionWeight: number;
  readonly applicability: JazzFiveFourVariantApplicability;
  readonly budget: JazzFiveFourVariantBudget;
  readonly attackGroups: readonly JazzFiveFourAttackGroup[];
}

export interface JazzFiveFourVariantSelectionContext {
  readonly seed: number;
  readonly sectionId: string;
  readonly phraseOrdinal: number;
  readonly barInPhrase: number;
  readonly phraseFunction: JazzFiveFourPhraseFunction;
  readonly phrasePosition: JazzFiveFourPhrasePosition;
  readonly intensity: number;
  readonly mode: 'canonical-reference' | 'generative';
}

export interface JazzFiveFourEnsembleVariantSelection {
  readonly bass: DeepReadonly<JazzFiveFourEnsembleVariant>;
  readonly comp: DeepReadonly<JazzFiveFourEnsembleVariant>;
  readonly drum: DeepReadonly<JazzFiveFourEnsembleVariant>;
  readonly selectionKey: string;
}

const ALL_FUNCTIONS = Object.freeze([
  'pickup', 'head-a', 'head-b', 'solo', 'recap', 'coda',
] as const satisfies readonly JazzFiveFourPhraseFunction[]);
const ALL_POSITIONS = Object.freeze([
  'opening', 'continuation', 'answer', 'breakdown', 'turnaround', 'ending',
] as const satisfies readonly JazzFiveFourPhrasePosition[]);

function exactBeat(beat: JazzFiveFourRationalBeat): JazzFiveFourRationalBeat {
  return Object.freeze({ numerator: beat.numerator, denominator: beat.denominator });
}

function roleAttackGroups(cells: readonly DeepReadonly<JazzFiveFourRoleCell>[]): JazzFiveFourAttackGroup[] {
  const byPhase = new Map<number, { phase: JazzFiveFourRationalBeat; ids: string[] }>();
  for (const cell of cells) {
    const phaseTick = jazzFiveFourRoleBeatToEngineTicks(cell.phase.beats);
    const group = byPhase.get(phaseTick) ?? { phase: exactBeat(cell.phase.beats), ids: [] };
    group.ids.push(cell.cellId);
    byPhase.set(phaseTick, group);
  }
  return [...byPhase.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, group]) => Object.freeze({
      phase: group.phase,
      sourceCellIds: Object.freeze([...group.ids].sort()),
    }));
}

function drumAttackGroups(): JazzFiveFourAttackGroup[] {
  const byPhase = new Map<number, { phase: JazzFiveFourRationalBeat; ids: string[] }>();
  for (const hit of JAZZ_FIVE_FOUR_CORE_KEEP_TIME.hits) {
    const phaseTick = jazzFiveFourDrumPhaseTicks(hit.phaseBeats);
    const group = byPhase.get(phaseTick) ?? { phase: exactBeat(hit.phaseBeats), ids: [] };
    group.ids.push(hit.id);
    byPhase.set(phaseTick, group);
  }
  return [...byPhase.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, group]) => Object.freeze({
      phase: group.phase,
      sourceCellIds: Object.freeze([...group.ids].sort()),
    }));
}

const BASS_BASE = Object.freeze(roleAttackGroups(JAZZ_FIVE_FOUR_ACOUSTIC_BASS_CELLS));
const COMP_BASE = Object.freeze(roleAttackGroups(JAZZ_FIVE_FOUR_UPPER_COMP_CELLS));
const DRUM_BASE = Object.freeze(drumAttackGroups());

function phases(groups: readonly JazzFiveFourAttackGroup[]): readonly number[] {
  return groups.map((group) => jazzFiveFourRoleBeatToEngineTicks(group.phase));
}

function retainPhases(
  groups: readonly JazzFiveFourAttackGroup[],
  retainedTicks: readonly number[],
): readonly JazzFiveFourAttackGroup[] {
  const retained = new Set(retainedTicks);
  const result = groups.filter((group) => retained.has(jazzFiveFourRoleBeatToEngineTicks(group.phase)));
  if (result.length !== retained.size) {
    throw new Error(`Jazz 5/4 variant references an unavailable attack phase: ${retainedTicks.join(',')}`);
  }
  return Object.freeze(result);
}

function applicability(
  phraseFunctions: readonly JazzFiveFourPhraseFunction[] = ALL_FUNCTIONS,
  phrasePositions: readonly JazzFiveFourPhrasePosition[] = ALL_POSITIONS,
  minIntensity = 0,
  maxIntensity = 1,
): JazzFiveFourVariantApplicability {
  return deepFreeze({ phraseFunctions, phrasePositions, minIntensity, maxIntensity });
}

function budget(
  velocityScale: number,
  registerOctaveShift: -1 | 0 | 1,
  mayChangeAttackMask: boolean,
): JazzFiveFourVariantBudget {
  return Object.freeze({
    timingResidualMaxTicks: 0 as const,
    velocityScale,
    registerOctaveShift,
    mayChangeAttackMask,
  });
}

function variant(
  value: JazzFiveFourEnsembleVariant,
): DeepReadonly<JazzFiveFourEnsembleVariant> {
  if (value.attackGroups.length === 0) throw new Error(`Jazz 5/4 variant ${value.id} has no attack groups`);
  const ticks = phases(value.attackGroups);
  if (new Set(ticks).size !== ticks.length || ticks.some((tick) => tick < 0 || tick >= 2_400)) {
    throw new Error(`Jazz 5/4 variant ${value.id} has an invalid bar-local attack mask`);
  }
  return deepFreeze(value);
}

export const JAZZ_FIVE_FOUR_BASS_VARIANTS = deepFreeze([
  variant({
    id: 'bass.a.source-canonical', role: 'bass', familyId: 'bass.a-ostinato',
    referenceCanonical: true, generativeEligible: true, mutationUnit: 'whole-phrase',
    density: 'full', interactionIntent: 'canonical-interlock', cadenceRole: 'none', selectionWeight: 2,
    applicability: applicability(), budget: budget(1, 0, false), attackGroups: BASS_BASE,
  }),
  variant({
    id: 'bass.a.breakdown', role: 'bass', familyId: 'bass.a-ostinato',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-phrase',
    density: 'medium', interactionIntent: 'lead-space', cadenceRole: 'none', selectionWeight: 2,
    applicability: applicability(['head-a', 'solo', 'recap'], ['breakdown'], 0, 0.7),
    budget: budget(0.7, 0, false), attackGroups: BASS_BASE,
  }),
  variant({
    id: 'bass.a.release-beat-five', role: 'bass', familyId: 'bass.a-ostinato',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-bar',
    density: 'sparse', interactionIntent: 'middle-answer', cadenceRole: 'setup', selectionWeight: 3,
    applicability: applicability(['head-a', 'head-b', 'solo', 'recap'], ['answer', 'turnaround'], 0.2, 1),
    budget: budget(0.9, 0, true), attackGroups: retainPhases(BASS_BASE, [0, 1_440]),
  }),
  variant({
    id: 'bass.a.octave-lift-ending', role: 'bass', familyId: 'bass.a-ostinato',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-phrase',
    density: 'full', interactionIntent: 'phrase-lift', cadenceRole: 'arrival', selectionWeight: 4,
    applicability: applicability(['recap', 'coda'], ['ending'], 0.45, 1),
    budget: budget(1, 1, false), attackGroups: BASS_BASE,
  }),
] as const);

export const JAZZ_FIVE_FOUR_COMP_VARIANTS = deepFreeze([
  variant({
    id: 'comp.a.source-canonical', role: 'comp', familyId: 'comp.a-upper-answer',
    referenceCanonical: true, generativeEligible: true, mutationUnit: 'whole-phrase',
    density: 'full', interactionIntent: 'canonical-interlock', cadenceRole: 'none', selectionWeight: 2,
    applicability: applicability(), budget: budget(1, 0, false), attackGroups: COMP_BASE,
  }),
  variant({
    id: 'comp.b.bridge-air', role: 'comp', familyId: 'comp.b-bridge-air',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-phrase',
    density: 'sparse', interactionIntent: 'lead-space', cadenceRole: 'none', selectionWeight: 5,
    applicability: applicability(['head-b', 'solo'], ['opening', 'continuation', 'answer'], 0, 0.9),
    budget: budget(0.92, 0, true), attackGroups: retainPhases(COMP_BASE, [305, 1_920]),
  }),
  variant({
    id: 'comp.b.turnaround-release', role: 'comp', familyId: 'comp.b-bridge-air',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-bar',
    density: 'sparse', interactionIntent: 'turnaround-release', cadenceRole: 'setup', selectionWeight: 5,
    applicability: applicability(['head-b', 'solo', 'recap', 'coda'], ['turnaround', 'ending'], 0.25, 1),
    budget: budget(1, 0, true), attackGroups: retainPhases(COMP_BASE, [305, 960]),
  }),
  variant({
    id: 'comp.a.breakdown', role: 'comp', familyId: 'comp.a-upper-answer',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-phrase',
    density: 'medium', interactionIntent: 'foundation-space', cadenceRole: 'none', selectionWeight: 3,
    applicability: applicability(['head-a', 'solo', 'recap'], ['breakdown'], 0, 0.7),
    budget: budget(0.72, 0, false), attackGroups: COMP_BASE,
  }),
] as const);

export const JAZZ_FIVE_FOUR_DRUM_VARIANTS = deepFreeze([
  variant({
    id: 'drum.core.source-canonical', role: 'drum', familyId: 'drum.core-keep-time',
    referenceCanonical: true, generativeEligible: true, mutationUnit: 'whole-phrase',
    density: 'full', interactionIntent: 'canonical-interlock', cadenceRole: 'none', selectionWeight: 3,
    applicability: applicability(), budget: budget(1, 0, false), attackGroups: DRUM_BASE,
  }),
  variant({
    id: 'drum.core.metric-skeleton', role: 'drum', familyId: 'drum.core-keep-time',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-bar',
    density: 'sparse', interactionIntent: 'metric-clarity', cadenceRole: 'none', selectionWeight: 2,
    applicability: applicability(['pickup', 'head-a', 'head-b', 'recap'], ['opening', 'breakdown'], 0, 0.65),
    budget: budget(0.82, 0, true), attackGroups: retainPhases(DRUM_BASE, [0, 480, 960, 1_440, 1_920]),
  }),
  variant({
    id: 'drum.core.ride-development', role: 'drum', familyId: 'drum.ride-development',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-phrase',
    density: 'medium', interactionIntent: 'lead-space', cadenceRole: 'none', selectionWeight: 5,
    applicability: applicability(['head-b', 'solo'], ['continuation', 'answer'], 0.35, 1),
    budget: budget(0.9, 0, true),
    attackGroups: retainPhases(DRUM_BASE, [0, 480, 960, 1_280, 1_440, 1_760, 1_920]),
  }),
  variant({
    id: 'drum.core.dialogue-answer', role: 'drum', familyId: 'drum.dialogue-answer',
    referenceCanonical: false, generativeEligible: true, mutationUnit: 'whole-bar',
    density: 'medium', interactionIntent: 'middle-answer', cadenceRole: 'setup', selectionWeight: 4,
    applicability: applicability(['head-a', 'head-b', 'solo', 'recap', 'coda'], ['answer', 'turnaround', 'ending'], 0.25, 1),
    budget: budget(0.96, 0, true),
    attackGroups: retainPhases(DRUM_BASE, [0, 480, 800, 960, 1_440, 1_920, 2_080, 2_240]),
  }),
] as const);

export const JAZZ_FIVE_FOUR_ENSEMBLE_VARIATION_KB = deepFreeze({
  schemaVersion: 1 as const,
  meter: { numerator: 5 as const, denominator: 4 as const, grouping: [3, 2] as const },
  clock: { ppq: 480 as const, ticksPerBar: 2_400 as const, barOriginPolicy: 'song-global' as const },
  randomizationOwner: 'arranger' as const,
  performanceTimingOwner: 'performance-once' as const,
  variantsByRole: {
    bass: JAZZ_FIVE_FOUR_BASS_VARIANTS,
    comp: JAZZ_FIVE_FOUR_COMP_VARIANTS,
    drum: JAZZ_FIVE_FOUR_DRUM_VARIANTS,
  },
});

export function jazzFiveFourVariantAttackTicks(
  value: DeepReadonly<JazzFiveFourEnsembleVariant>,
): readonly number[] {
  return Object.freeze(phases(value.attackGroups));
}

function matches(
  value: DeepReadonly<JazzFiveFourEnsembleVariant>,
  context: JazzFiveFourVariantSelectionContext,
): boolean {
  const rule = value.applicability;
  return value.generativeEligible
    && rule.phraseFunctions.includes(context.phraseFunction)
    && rule.phrasePositions.includes(context.phrasePosition)
    && context.intensity >= rule.minIntensity
    && context.intensity <= rule.maxIntensity;
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sameMask(
  left: DeepReadonly<JazzFiveFourEnsembleVariant>,
  right: DeepReadonly<JazzFiveFourEnsembleVariant>,
): boolean {
  const a = jazzFiveFourVariantAttackTicks(left);
  const b = jazzFiveFourVariantAttackTicks(right);
  return a.length === b.length && a.every((tick, index) => tick === b[index]);
}

/** A structural check: role identities may interlock, but never share an entire attack mask. */
export function jazzFiveFourVariantMasksAreIndependent(
  selection: Pick<JazzFiveFourEnsembleVariantSelection, 'bass' | 'comp' | 'drum'>,
): boolean {
  return !sameMask(selection.bass, selection.comp)
    && !sameMask(selection.bass, selection.drum)
    && !sameMask(selection.comp, selection.drum);
}

function canonical(role: JazzFiveFourEnsembleRole): DeepReadonly<JazzFiveFourEnsembleVariant> {
  const variants = JAZZ_FIVE_FOUR_ENSEMBLE_VARIATION_KB.variantsByRole[role];
  const result = variants.find((entry) => entry.referenceCanonical);
  if (!result) throw new Error(`Jazz 5/4 ${role} has no canonical reference variant`);
  return result;
}

/**
 * Pure deterministic whole-score choice. The seed selects one compatible
 * Bass/Comp/Drum combination; it never enters an individual event loop.
 */
export function selectJazzFiveFourEnsembleVariants(
  context: JazzFiveFourVariantSelectionContext,
): JazzFiveFourEnsembleVariantSelection {
  const selectionKey = [
    context.seed,
    context.sectionId,
    context.phraseOrdinal,
    context.barInPhrase,
    context.phraseFunction,
    context.phrasePosition,
    context.intensity.toFixed(4),
    context.mode,
  ].join(':');

  if (context.mode === 'canonical-reference') {
    const result = deepFreeze({
      bass: canonical('bass'), comp: canonical('comp'), drum: canonical('drum'), selectionKey,
    });
    if (!jazzFiveFourVariantMasksAreIndependent(result)) {
      throw new Error('Jazz 5/4 canonical role masks unexpectedly collapsed to homorhythm');
    }
    return result;
  }

  const byRole = JAZZ_FIVE_FOUR_ENSEMBLE_VARIATION_KB.variantsByRole;
  const bassCandidates = byRole.bass.filter((value) => matches(value, context));
  const compCandidates = byRole.comp.filter((value) => matches(value, context));
  const drumCandidates = byRole.drum.filter((value) => matches(value, context));
  const combinations: Array<Pick<JazzFiveFourEnsembleVariantSelection, 'bass' | 'comp' | 'drum'>> = [];
  for (const bass of bassCandidates) {
    for (const comp of compCandidates) {
      for (const drum of drumCandidates) {
        const candidate = { bass, comp, drum };
        if (!jazzFiveFourVariantMasksAreIndependent(candidate)) continue;
        const weight = Math.max(1, Math.round(bass.selectionWeight * comp.selectionWeight * drum.selectionWeight));
        for (let index = 0; index < weight; index += 1) combinations.push(candidate);
      }
    }
  }
  if (combinations.length === 0) {
    throw new Error(`No compatible Jazz 5/4 ensemble variants for ${selectionKey}`);
  }
  const chosen = combinations[stableHash(selectionKey) % combinations.length]!;
  return deepFreeze({ ...chosen, selectionKey });
}
