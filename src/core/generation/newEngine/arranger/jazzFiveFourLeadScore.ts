// ============================================================
// newEngine · arranger · Jazz 5/4 Lead score directives
// ------------------------------------------------------------
// Arranger chooses complete phrase material before Harmony/Render.  These
// directives own absolute placement, phrase/section ownership, rhythm and
// grammar families, register and mutation budgets; they contain no pitches.
// ============================================================

import type { Meter } from '../foundation';
import {
  JAZZ_FIVE_FOUR_LEAD_CODA_ID,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID,
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS,
  JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID,
  JAZZ_FIVE_FOUR_LEAD_PICKUP_ID,
  jazzFiveFourLeadRhythmTemplate,
  type JazzFiveFourLeadRhythmTemplateId,
} from '../knowledge/jazzFiveFourLeadRhythmKnowledge';
import type { LeadRhythmMutationBudget } from './jazzFiveFourLeadRhythm';
import type { Phrase, Section } from './ArrangementPlan';

export type JazzFiveFourLeadPhraseFamily =
  | 'pickup'
  | 'headA'
  | 'headB'
  | 'solo'
  | 'coda'
  | 'intentionalRest';

export interface JazzFiveFourLeadTransformBudget {
  readonly maxGrammarRedraws: 2;
  readonly maxPitchLeapSemitones: 12;
  readonly preserveRhythmMask: true;
  readonly preserveNominalHarmony: true;
  readonly allowSemanticVariation: true;
}

export interface LeadPhraseDirective {
  readonly id: string;
  readonly sectionId: string;
  readonly phraseIds: readonly string[];
  /** Song-global, zero-based bar. This is the only absolute placement. */
  readonly startBar: number;
  readonly startBarInSection: number;
  readonly barCount: number;
  readonly family: JazzFiveFourLeadPhraseFamily;
  readonly rhythmTemplateId: JazzFiveFourLeadRhythmTemplateId;
  readonly grammarFamilyId: JazzFiveFourLeadPhraseFamily;
  readonly register: { readonly lowMidi: 54; readonly highMidi: 78 };
  readonly mutationBudget: LeadRhythmMutationBudget;
  readonly transformBudget: JazzFiveFourLeadTransformBudget;
}

interface PlanJazzFiveFourLeadDirectivesBaseArgs {
  readonly enabled: boolean;
  readonly meter: Meter;
  readonly sections: readonly Section[];
  readonly phrases: readonly Phrase[];
}

export type JazzFiveFourLeadScoreMode = 'canonical-reference' | 'generative';

export type PlanJazzFiveFourLeadDirectivesArgs = PlanJazzFiveFourLeadDirectivesBaseArgs & (
  | {
      /** Omitted preserves the first-stage exact reference behavior. */
      readonly mode?: 'canonical-reference';
      readonly seed?: never;
    }
  | {
      readonly mode: 'generative';
      readonly seed: number;
    }
);

interface PhraseTemplateAssignment {
  readonly sectionId: 'pickup' | 'headA' | 'headB' | 'headOut' | 'coda';
  readonly barCount: 1 | 8;
  readonly family: 'pickup' | 'headA' | 'headB' | 'coda';
  readonly rhythmTemplateId: JazzFiveFourLeadRhythmTemplateId;
}

/** Whole templates only: changing duration must select another future form, never slice one. */
const REFERENCE_FORM: readonly PhraseTemplateAssignment[] = Object.freeze([
  Object.freeze({ sectionId: 'pickup', barCount: 1, family: 'pickup', rhythmTemplateId: JAZZ_FIVE_FOUR_LEAD_PICKUP_ID }),
  Object.freeze({ sectionId: 'headA', barCount: 8, family: 'headA', rhythmTemplateId: JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID }),
  Object.freeze({ sectionId: 'headB', barCount: 8, family: 'headB', rhythmTemplateId: JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID }),
  // The recapitulation deliberately reuses the A rhythm mask. Grammar/pitch
  // realization can vary with seed while the arranger-level identity remains A.
  Object.freeze({ sectionId: 'headOut', barCount: 8, family: 'headA', rhythmTemplateId: JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID }),
  Object.freeze({ sectionId: 'coda', barCount: 8, family: 'coda', rhythmTemplateId: JAZZ_FIVE_FOUR_LEAD_CODA_ID }),
]);

const TRANSFORM_BUDGET: JazzFiveFourLeadTransformBudget = Object.freeze({
  maxGrammarRedraws: 2,
  maxPitchLeapSemitones: 12,
  preserveRhythmMask: true,
  preserveNominalHarmony: true,
  allowSemanticVariation: true,
});

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function generativeHeadTemplateIds(seed: number): Readonly<{
  headA: JazzFiveFourLeadRhythmTemplateId;
  headOut: JazzFiveFourLeadRhythmTemplateId;
}> {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`Jazz 5/4 generative Lead seed must be a safe integer, received ${seed}`);
  }
  const index = stableHash(`${seed}:j54-lead:head-a-whole-phrase`)
    % JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS.length;
  const mutateEnding = stableHash(`${seed}:j54-lead:head-out-ending`) % 3 === 0;
  // Bit 3 is the whole-phrase spec's one-cell ending operation. Toggling only
  // that bit gives the recap either 100% or 47/48 structural identity.
  const headOutIndex = mutateEnding ? index ^ 8 : index;
  return Object.freeze({
    headA: JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS[index]!,
    headOut: JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS[headOutIndex]!,
  });
}

function phraseIdsForRange(
  phrases: readonly Phrase[],
  section: Section,
  startBarInSection: number,
  barCount: number,
): readonly string[] {
  const endBar = startBarInSection + barCount;
  const ids = phrases
    .filter((phrase) => phrase.sectionId === section.id)
    .filter((phrase) => {
      const start = phrase.phraseSlot * phrase.bars;
      const end = Math.min(section.bars, start + phrase.bars);
      return start < endBar && end > startBarInSection;
    })
    .sort((left, right) => left.phraseSlot - right.phraseSlot)
    .map((phrase) => phrase.id);
  if (ids.length === 0) {
    throw new RangeError(`Jazz 5/4 Lead directive ${section.id} has no Arranger phrase owner`);
  }
  return Object.freeze(ids);
}

/**
 * Freeze the complete 33-bar Lead score at the Arranger boundary. Undefined is
 * the ordinary 4/4/legacy-5/4 path; no downstream meter/style inference exists.
 */
export function planJazzFiveFourLeadDirectives(
  args: PlanJazzFiveFourLeadDirectivesArgs,
): readonly LeadPhraseDirective[] | undefined {
  if (!args.enabled) return undefined;
  if (args.meter.numerator !== 5 || args.meter.denominator !== 4) {
    throw new RangeError('Jazz 5/4 Lead directives require an exact 5/4 meter');
  }
  if (args.sections.length !== REFERENCE_FORM.length) {
    throw new RangeError(`Jazz 5/4 Lead reference form requires ${REFERENCE_FORM.length} whole sections`);
  }

  const mode = args.mode ?? 'canonical-reference';
  const generativeHeads = mode === 'generative'
    ? generativeHeadTemplateIds(args.seed)
    : undefined;

  const directives: LeadPhraseDirective[] = [];
  let absoluteBar = 0;
  for (let index = 0; index < REFERENCE_FORM.length; index++) {
    const assignment = REFERENCE_FORM[index]!;
    const section = args.sections[index]!;
    if (section.id !== assignment.sectionId || section.bars !== assignment.barCount) {
      throw new RangeError(
        `Jazz 5/4 Lead reference form expected ${assignment.sectionId}:${assignment.barCount}, received ${section.id}:${section.bars}`,
      );
    }
    const rhythmTemplateId = assignment.sectionId === 'headA' && generativeHeads
      ? generativeHeads.headA
      : assignment.sectionId === 'headOut' && generativeHeads
        ? generativeHeads.headOut
        : assignment.rhythmTemplateId;
    const template = jazzFiveFourLeadRhythmTemplate(rhythmTemplateId);
    if (!template || template.barCount !== assignment.barCount) {
      throw new RangeError(`Jazz 5/4 Lead rhythm template ${rhythmTemplateId} is missing or sliced`);
    }
    directives.push(Object.freeze({
      id: `j54-lead:${section.id}@bar-${absoluteBar}`,
      sectionId: section.id,
      phraseIds: phraseIdsForRange(args.phrases, section, 0, section.bars),
      startBar: absoluteBar,
      startBarInSection: 0,
      barCount: section.bars,
      family: assignment.family,
      rhythmTemplateId,
      grammarFamilyId: assignment.family,
      register: Object.freeze({ lowMidi: 54 as const, highMidi: 78 as const }),
      mutationBudget: Object.freeze({ ...template.mutationBudget }),
      transformBudget: TRANSFORM_BUDGET,
    }));
    absoluteBar += section.bars;
  }
  if (absoluteBar !== 33) throw new RangeError(`Jazz 5/4 Lead reference form must total 33 bars, received ${absoluteBar}`);
  return Object.freeze(directives);
}
