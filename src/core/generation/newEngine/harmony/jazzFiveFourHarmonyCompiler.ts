// ============================================================
// newEngine · harmony · Jazz 5/4 Harmonic Directive Compiler
// ------------------------------------------------------------
// Harmony has no template-selection authority here. It only validates the
// frozen whole-template score already written by Arranger, projects relative
// roots through the existing section-key decision, and emits ResolvedChord[]
// for HarmonyEngine.assemble(). No MIDI evidence and no render path enter.
// ============================================================

import { mod12, type PitchClass } from '../foundation';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import {
  JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID,
  type JazzFiveFourHarmonicDirective,
} from '../arranger/jazzFiveFourHarmonyScore';
import {
  areJazzFiveFourHarmonicTemplatesCompatible,
  jazzFiveFourHarmonicTemplate,
  jazzFiveFourRationalBeatValue,
  validateJazzFiveFourHarmonicTemplate,
  type JazzFiveFourHarmonicSlot,
  type JazzFiveFourHarmonicTemplate,
} from '../knowledge/jazzFiveFourHarmonicFormGrammar';
import { narrowQuality } from './progressionRealizer';
import type { HarmonicFunction, RomanChord } from './HarmonicPlan';
import type { ResolvedChord } from './harmonyEngine';

function templateOrThrow(id: string): JazzFiveFourHarmonicTemplate {
  const template = jazzFiveFourHarmonicTemplate(id);
  if (!template) throw new RangeError(`Jazz 5/4 Harmony received unknown Arranger template ${id}`);
  const issues = validateJazzFiveFourHarmonicTemplate(template);
  if (issues.length > 0) {
    throw new RangeError(`Jazz 5/4 Harmony template ${id} is invalid: ${issues.join('; ')}`);
  }
  return template;
}
function directivesOrThrow(arrangement: ArrangementPlan): readonly JazzFiveFourHarmonicDirective[] | undefined {
  const policyCount = arrangement.sections.filter((section) =>
    arrangement.resolvedArchetype?.sectionPolicyById[section.id]?.harmonyPolicyId
      === JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID,
  ).length;
  const directives = arrangement.jazzFiveFourHarmonyDirectives;
  if (policyCount === 0) {
    if (directives !== undefined) {
      throw new RangeError('Jazz 5/4 harmonic directives exist without the Arranger policy');
    }
    return undefined;
  }
  if (policyCount !== arrangement.sections.length) {
    throw new RangeError('Jazz 5/4 harmonic policy must own either every section or no section');
  }
  if (!directives || directives.length === 0) {
    throw new RangeError('Jazz 5/4 harmonic policy is enabled but Arranger emitted no directives');
  }
  return directives;
}

/** Validation is fail-closed only; it never picks or substitutes a template. */
function validateArrangerScore(
  arrangement: ArrangementPlan,
  directives: readonly JazzFiveFourHarmonicDirective[],
): void {
  let previousTemplate: JazzFiveFourHarmonicTemplate | undefined;
  for (const section of arrangement.sections) {
    const sectionDirectives = directives.filter((directive) => directive.sectionId === section.id);
    let cursor = 0;
    for (const directive of sectionDirectives) {
      const template = templateOrThrow(directive.templateId);
      if (directive.policyId !== JAZZ_FIVE_FOUR_HARMONIC_POLICY_ID) {
        throw new RangeError(`Jazz 5/4 Harmony received foreign policy ${directive.policyId}`);
      }
      if (directive.startBarInSection !== cursor || directive.barCount !== template.bars.length) {
        throw new RangeError(`Jazz 5/4 Harmony received invalid bar coverage at ${section.id}:${cursor}`);
      }
      if (directive.phraseIds.length === 0 || directive.phraseIds.some((phraseId) =>
        !arrangement.phrases.some((phrase) => phrase.id === phraseId && phrase.sectionId === section.id))) {
        throw new RangeError(`Jazz 5/4 Harmony received invalid phrase ownership in ${section.id}`);
      }
      if (previousTemplate && !areJazzFiveFourHarmonicTemplatesCompatible(previousTemplate, template)) {
        throw new RangeError(`Jazz 5/4 Harmony received incompatible directives ${previousTemplate.id} -> ${template.id}`);
      }
      previousTemplate = template;
      cursor += directive.barCount;
    }
    if (cursor !== section.bars) {
      throw new RangeError(`Jazz 5/4 Harmony directives cover ${cursor}/${section.bars} bars in ${section.id}`);
    }
  }
  if (!previousTemplate?.cadence.terminal) {
    throw new RangeError('Jazz 5/4 Harmony directives do not end in a terminal coda');
  }
}

const ROOT_ROMAN_BY_OFFSET: readonly Pick<RomanChord, 'degree' | 'accidental'>[] = [
  { degree: 1, accidental: 'natural' },
  { degree: 2, accidental: 'b' },
  { degree: 2, accidental: 'natural' },
  { degree: 3, accidental: 'b' },
  { degree: 3, accidental: 'natural' },
  { degree: 4, accidental: 'natural' },
  { degree: 5, accidental: 'b' },
  { degree: 5, accidental: 'natural' },
  { degree: 6, accidental: 'b' },
  { degree: 6, accidental: 'natural' },
  { degree: 7, accidental: 'b' },
  { degree: 7, accidental: 'natural' },
];

function secondaryTarget(slot: JazzFiveFourHarmonicSlot): RomanChord | undefined {
  const target = slot.roman.split('/')[1];
  if (!target) return undefined;
  const normalized = target.replace(/[^IViv]/g, '').toLowerCase();
  const degreeByRoman: Record<string, RomanChord['degree']> = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7,
  };
  const degree = degreeByRoman[normalized];
  if (!degree) throw new RangeError(`Jazz 5/4 Harmony cannot parse applied target ${slot.roman}`);
  return {
    degree,
    accidental: target.startsWith('b') ? 'b' : target.startsWith('#') ? '#' : 'natural',
    quality: target === target.toLowerCase() ? 'm7' : 'maj7',
  };
}

function realizedRoman(slot: JazzFiveFourHarmonicSlot): RomanChord {
  return {
    ...ROOT_ROMAN_BY_OFFSET[slot.rootOffset],
    quality: narrowQuality(slot.chordType),
    secondaryTarget: secondaryTarget(slot),
  };
}

function compileSlot(args: {
  slot: JazzFiveFourHarmonicSlot;
  template: JazzFiveFourHarmonicTemplate;
  sectionId: string;
  sectionKey: PitchClass;
  songKey: PitchClass;
}): ResolvedChord {
  const { slot, template, sectionId, sectionKey, songKey } = args;
  const target = secondaryTarget(slot);
  const targetRootOffset = target
    ? ({ 1: 0, 2: 2, 3: 3, 4: 5, 5: 7, 6: 8, 7: 10 } as const)[target.degree]
    : undefined;
  return {
    roman: realizedRoman(slot),
    rootPc: mod12(sectionKey + slot.rootOffset),
    quality: narrowQuality(slot.chordType),
    durationBeats: jazzFiveFourRationalBeatValue(slot.span.duration),
    sectionId,
    func: slot.function as HarmonicFunction,
    chordType: slot.chordType,
    borrowedSource: slot.roman.startsWith('subV')
      ? 'chromatic_color'
      : target ? 'secondary_dominant' : undefined,
    mustResolve: template.cadence.kind === 'turnaround' && slot.function === 'D'
      ? true
      : undefined,
    localTonalCenterPc: targetRootOffset === undefined
      ? undefined
      : mod12(sectionKey + targetRootOffset),
    preserveType: true,
    analysisKeyPc: sectionKey,
    localRoman: slot.roman,
    sectionKeyPc: sectionKey === songKey ? undefined : sectionKey,
  };
}

export interface CompileJazzFiveFourHarmonyArgs {
  readonly band: BandSpec;
  readonly arrangement: ArrangementPlan;
  readonly sectionKeyOf: (sectionId: string) => PitchClass;
}

/** Compile Arranger directives into the existing HarmonyEngine input. */
export function compileJazzFiveFourHarmonicDirectives(
  args: CompileJazzFiveFourHarmonyArgs,
): ResolvedChord[] | undefined {
  const directives = directivesOrThrow(args.arrangement);
  if (!directives) return undefined;
  if (args.band.mode !== 'minor') {
    throw new RangeError('Jazz 5/4 harmonic form grammar currently supports minor mode only');
  }
  validateArrangerScore(args.arrangement, directives);

  const resolved: ResolvedChord[] = [];
  for (const directive of directives) {
    const template = templateOrThrow(directive.templateId);
    const sectionKey = args.sectionKeyOf(directive.sectionId);
    for (const bar of template.bars) {
      for (const slot of bar.slots) {
        resolved.push(compileSlot({
          slot,
          template,
          sectionId: directive.sectionId,
          sectionKey,
          songKey: args.band.key,
        }));
      }
    }
  }
  return resolved;
}
