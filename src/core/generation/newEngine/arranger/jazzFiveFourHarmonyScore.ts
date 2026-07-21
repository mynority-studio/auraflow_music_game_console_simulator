// ============================================================
// newEngine · arranger · Jazz 5/4 Harmonic Score Directives
// ------------------------------------------------------------
// Arranger is the sole template selector. It expands Section/Phrase form into
// whole, transposition-invariant KB-template directives before Harmony runs.
// Harmony may validate and compile this frozen score, but may not select or
// substitute a template.
// ============================================================

import type { Meter } from '../foundation';
import {
  areJazzFiveFourHarmonicTemplatesCompatible,
  jazzFiveFourHarmonicTemplate,
  validateJazzFiveFourHarmonicTemplate,
  type JazzFiveFourHarmonicTemplate,
} from '../knowledge/jazzFiveFourHarmonicFormGrammar';
import {
  HARMONY_POLICY_JAZZ_FIVE_FOUR_FORM_GRAMMAR,
  type ResolvedArrangementArchetypePlan,
} from './arrangementArchetypeContract';
import type { Phrase, Section } from './ArrangementPlan';

export const JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID = HARMONY_POLICY_JAZZ_FIVE_FOUR_FORM_GRAMMAR;

const A_BASE = 'j54.harmony.a-vamp.minor-i-v.base.v1';
const A_ANSWER = 'j54.harmony.a-vamp.minor-i-v.answer.v1';
const B_CYCLE = 'j54.harmony.b-bridge.minor-cycle.body.v1';
const B_REHARM = 'j54.harmony.b-bridge.modern-reharm.body.v1';
const TAG_ECHO = 'j54.harmony.tag.echo-vamp.v1';
const TONIC_CODA = 'j54.harmony.coda.tonic-hold.v1';
const TONIC_SUSTAIN = 'j54.harmony.coda.tonic-sustain.v1';

/** Explicit form decision. It contains only relative KB identity, never a key. */
export interface JazzFiveFourHarmonicDirective {
  readonly policyId: typeof JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID;
  readonly sectionId: string;
  /** Every Arranger phrase whose bar range this whole template intersects. */
  readonly phraseIds: readonly string[];
  readonly startBarInSection: number;
  readonly barCount: number;
  readonly templateId: string;
}

export interface PlanJazzFiveFourHarmonicDirectivesArgs {
  readonly meter: Meter;
  readonly sections: readonly Section[];
  readonly phrases: readonly Phrase[];
  readonly resolvedArchetype?: ResolvedArrangementArchetypePlan;
}

function templateOrThrow(id: string): JazzFiveFourHarmonicTemplate {
  const template = jazzFiveFourHarmonicTemplate(id);
  if (!template) throw new RangeError(`Jazz 5/4 Arranger references unknown harmonic template ${id}`);
  const issues = validateJazzFiveFourHarmonicTemplate(template);
  if (issues.length > 0) {
    throw new RangeError(`Jazz 5/4 harmonic template ${id} is invalid: ${issues.join('; ')}`);
  }
  return template;
}

function phrasesForSection(
  args: PlanJazzFiveFourHarmonicDirectivesArgs,
  section: Section,
): readonly Phrase[] {
  return args.phrases
    .filter((phrase) => phrase.sectionId === section.id)
    .sort((left, right) => left.phraseSlot - right.phraseSlot);
}

function intersectingPhraseIds(
  args: PlanJazzFiveFourHarmonicDirectivesArgs,
  section: Section,
  startBar: number,
  barCount: number,
): readonly string[] {
  const endBar = startBar + barCount;
  const ids = phrasesForSection(args, section)
    .filter((phrase) => {
      const phraseStart = phrase.phraseSlot * phrase.bars;
      const phraseEnd = Math.min(section.bars, phraseStart + phrase.bars);
      return phraseStart < endBar && phraseEnd > startBar;
    })
    .map((phrase) => phrase.id);
  if (ids.length === 0) {
    throw new RangeError(
      `Jazz 5/4 harmonic directive ${section.id}:${startBar}+${barCount} is not owned by an Arranger phrase`,
    );
  }
  return Object.freeze(ids);
}

function appendDirective(
  output: JazzFiveFourHarmonicDirective[],
  args: PlanJazzFiveFourHarmonicDirectivesArgs,
  section: Section,
  startBarInSection: number,
  templateId: string,
): number {
  const template = templateOrThrow(templateId);
  const barCount = template.bars.length;
  if (startBarInSection + barCount > section.bars) {
    throw new RangeError(
      `Jazz 5/4 harmonic template ${templateId} overruns ${section.id} at bar ${startBarInSection}`,
    );
  }
  output.push(Object.freeze({
    policyId: JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID,
    sectionId: section.id,
    phraseIds: intersectingPhraseIds(args, section, startBarInSection, barCount),
    startBarInSection,
    barCount,
    templateId,
  }));
  return startBarInSection + barCount;
}

function appendAVampSection(
  output: JazzFiveFourHarmonicDirective[],
  args: PlanJazzFiveFourHarmonicDirectivesArgs,
  section: Section,
): void {
  let bar = 0;
  while (bar < section.bars) {
    bar = appendDirective(output, args, section, bar, bar % 2 === 0 ? A_BASE : A_ANSWER);
  }
}

/**
 * Open with the six-bar modern reharm when possible, then pass through one A
 * arrival before any further B brick. The KB compatibility graph, not length
 * arithmetic, owns that transition.
 */
function appendBridgeSection(
  output: JazzFiveFourHarmonicDirective[],
  args: PlanJazzFiveFourHarmonicDirectivesArgs,
  section: Section,
): void {
  let bar = 0;
  if (section.bars >= 6) {
    bar = appendDirective(output, args, section, bar, B_REHARM);
    if (bar < section.bars) bar = appendDirective(output, args, section, bar, A_BASE);
  }
  while (section.bars - bar >= 4) {
    bar = appendDirective(output, args, section, bar, B_CYCLE);
  }
  while (bar < section.bars) {
    bar = appendDirective(output, args, section, bar, bar % 2 === 0 ? A_BASE : A_ANSWER);
  }
}

function appendEndingSection(
  output: JazzFiveFourHarmonicDirective[],
  args: PlanJazzFiveFourHarmonicDirectivesArgs,
  section: Section,
): void {
  let bar = 0;
  // Preserve a three-bar tonic field under the product Lead coda's authored
  // long release.  The final template remains the sole terminal cadence.
  while (section.bars - bar > 3) {
    bar = appendDirective(output, args, section, bar, TAG_ECHO);
  }
  while (section.bars - bar > 1) {
    bar = appendDirective(output, args, section, bar, TONIC_SUSTAIN);
  }
  if (section.bars - bar === 1) appendDirective(output, args, section, bar, TONIC_CODA);
}

function validateDirectiveSequence(
  args: PlanJazzFiveFourHarmonicDirectivesArgs,
  directives: readonly JazzFiveFourHarmonicDirective[],
): void {
  let previousTemplate: JazzFiveFourHarmonicTemplate | undefined;
  for (const section of args.sections) {
    const sectionDirectives = directives.filter((directive) => directive.sectionId === section.id);
    let cursor = 0;
    for (const directive of sectionDirectives) {
      if (directive.startBarInSection !== cursor) {
        throw new RangeError(
          `Jazz 5/4 harmony has a coverage gap/overlap in ${section.id}: expected bar ${cursor}, received ${directive.startBarInSection}`,
        );
      }
      const template = templateOrThrow(directive.templateId);
      if (previousTemplate && !areJazzFiveFourHarmonicTemplatesCompatible(previousTemplate, template)) {
        throw new RangeError(
          `Jazz 5/4 harmonic templates are incompatible: ${previousTemplate.id} -> ${template.id}`,
        );
      }
      previousTemplate = template;
      cursor += directive.barCount;
    }
    if (cursor !== section.bars) {
      throw new RangeError(`Jazz 5/4 harmony covers ${cursor}/${section.bars} bars in section ${section.id}`);
    }
    for (const phrase of phrasesForSection(args, section)) {
      if (!sectionDirectives.some((directive) => directive.phraseIds.includes(phrase.id))) {
        throw new RangeError(`Jazz 5/4 harmony leaves Arranger phrase ${phrase.id} uncovered`);
      }
    }
  }
  if (previousTemplate && !previousTemplate.cadence.terminal) {
    throw new RangeError(`Jazz 5/4 harmonic form must terminate with a coda; received ${previousTemplate.id}`);
  }
}

/**
 * Arranger-only whole-template selection. Undefined means the policy is not
 * enabled. Partial policy ownership fails closed instead of mixing authorities.
 */
export function planJazzFiveFourHarmonicDirectives(
  args: PlanJazzFiveFourHarmonicDirectivesArgs,
): readonly JazzFiveFourHarmonicDirective[] | undefined {
  const policies = args.sections.map((section) =>
    args.resolvedArchetype?.sectionPolicyById[section.id]?.harmonyPolicyId,
  );
  const enabledCount = policies.filter((policy) => policy === JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID).length;
  if (enabledCount === 0) return undefined;
  if (enabledCount !== args.sections.length) {
    throw new RangeError('Jazz 5/4 harmonic form grammar must own either every section or no section');
  }
  if (args.meter.numerator !== 5 || args.meter.denominator !== 4) {
    throw new RangeError('Jazz 5/4 harmonic form grammar requires an exact 5/4 Arrangement meter');
  }

  const directives: JazzFiveFourHarmonicDirective[] = [];
  for (const section of args.sections) {
    switch (section.harmonyRole) {
      case 'loop':
      case 'intro':
      case 'verse':
      case 'chorus':
        appendAVampSection(directives, args, section);
        break;
      case 'bridge':
        appendBridgeSection(directives, args, section);
        break;
      case 'ending':
        appendEndingSection(directives, args, section);
        break;
      default:
        throw new RangeError(`Jazz 5/4 Harmony has no form mapping for section ${section.id}`);
    }
  }
  validateDirectiveSequence(args, directives);
  return Object.freeze(directives);
}
