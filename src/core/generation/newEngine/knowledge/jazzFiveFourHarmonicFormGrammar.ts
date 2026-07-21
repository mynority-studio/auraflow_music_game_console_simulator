// ============================================================
// newEngine · knowledge · Jazz 5/4 Harmonic Form Grammar
// ------------------------------------------------------------
// Transposition-invariant harmony/form vocabulary for the 5/4 jazz score
// compiler.  This module owns no absolute key, pitch name, RNG, Arrangement
// selection, or NoteIR.  Every slot is located by an exact rational span
// inside one 5/4 bar; the future Arranger may only choose whole templates.
// ============================================================

import { deepFreeze } from '../foundation/deepReadonly';

export const JAZZ_FIVE_FOUR_HARMONIC_FORM_SCHEMA_VERSION = 1 as const;

export type JazzFiveFourHarmonicFamily =
  | 'a-vamp'
  | 'b-bridge'
  | 'turnaround'
  | 'tag-coda';

export type JazzFiveFourHarmonicSectionRole =
  | 'intro'
  | 'vamp'
  | 'head'
  | 'bridge'
  | 'solo'
  | 'recap'
  | 'tag'
  | 'coda';

export type JazzFiveFourHarmonicPhraseRole =
  | 'base'
  | 'answer'
  | 'lift'
  | 'turnaround'
  | 'ending';

export type JazzFiveFourHarmonicFunction = 'T' | 'S' | 'D';
export type JazzFiveFourCadenceKind =
  | 'modal-loop'
  | 'open-bridge'
  | 'turnaround'
  | 'echo-tag'
  | 'closed-coda';

/** Exact beat value. Denominators are normalized and always positive. */
export interface JazzFiveFourRationalBeat {
  readonly numerator: number;
  readonly denominator: number;
}

export interface JazzFiveFourBeatSpan {
  readonly start: JazzFiveFourRationalBeat;
  readonly duration: JazzFiveFourRationalBeat;
}

/**
 * Harmonic identity is relative to the section tonic.  `rootOffset` is a
 * chromatic semitone offset in [0, 11], never an absolute pitch class.
 */
export interface JazzFiveFourHarmonicSlot {
  readonly id: string;
  readonly span: JazzFiveFourBeatSpan;
  readonly function: JazzFiveFourHarmonicFunction;
  readonly rootOffset: number;
  readonly roman: string;
  readonly chordType: string;
}

export interface JazzFiveFourHarmonicBar {
  readonly barIndex: number;
  readonly slots: readonly JazzFiveFourHarmonicSlot[];
}

export interface JazzFiveFourCadenceResolution {
  readonly targetFunction: 'T';
  readonly targetRootOffset: 0;
  readonly withinBars: 1;
}

export interface JazzFiveFourHarmonicCadence {
  readonly kind: JazzFiveFourCadenceKind;
  /** A turnaround owns the expectation, while the following template owns the arrival. */
  readonly resolution?: JazzFiveFourCadenceResolution;
  readonly terminal: boolean;
}

export interface JazzFiveFourHarmonicCompatibility {
  readonly mayStartForm: boolean;
  readonly allowedPreviousFamilies: readonly JazzFiveFourHarmonicFamily[];
  readonly allowedNextFamilies: readonly JazzFiveFourHarmonicFamily[];
}

export interface JazzFiveFourHarmonicTemplate {
  readonly id: string;
  readonly family: JazzFiveFourHarmonicFamily;
  readonly mode: 'Minor';
  readonly meter: {
    readonly numerator: 5;
    readonly denominator: 4;
    readonly beatGrouping: readonly [3, 2];
  };
  readonly sectionRoles: readonly JazzFiveFourHarmonicSectionRole[];
  readonly phraseRoles: readonly JazzFiveFourHarmonicPhraseRole[];
  readonly bars: readonly JazzFiveFourHarmonicBar[];
  readonly cadence: JazzFiveFourHarmonicCadence;
  readonly compatibility: JazzFiveFourHarmonicCompatibility;
}

export interface JazzFiveFourHarmonicFormGrammar {
  readonly schemaVersion: typeof JAZZ_FIVE_FOUR_HARMONIC_FORM_SCHEMA_VERSION;
  readonly meter: {
    readonly numerator: 5;
    readonly denominator: 4;
    readonly beatGrouping: readonly [3, 2];
    readonly beatsPerBar: JazzFiveFourRationalBeat;
  };
  readonly templates: readonly JazzFiveFourHarmonicTemplate[];
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}

export function jazzFiveFourRationalBeat(
  numerator: number,
  denominator = 1,
): JazzFiveFourRationalBeat {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError('Jazz 5/4 rational beats require safe integer terms');
  }
  if (denominator === 0) throw new RangeError('Jazz 5/4 rational beat denominator must not be zero');
  const sign = denominator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator);
  return Object.freeze({
    numerator: sign * numerator / divisor,
    denominator: sign * denominator / divisor,
  });
}

export function jazzFiveFourRationalBeatValue(value: JazzFiveFourRationalBeat): number {
  return value.numerator / value.denominator;
}

function equalRationalBeat(
  left: JazzFiveFourRationalBeat,
  right: JazzFiveFourRationalBeat,
): boolean {
  return left.numerator * right.denominator === right.numerator * left.denominator;
}

function addRationalBeat(
  left: JazzFiveFourRationalBeat,
  right: JazzFiveFourRationalBeat,
): JazzFiveFourRationalBeat {
  return jazzFiveFourRationalBeat(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

const R0 = jazzFiveFourRationalBeat(0);
const R2 = jazzFiveFourRationalBeat(2);
const R3 = jazzFiveFourRationalBeat(3);
const R5 = jazzFiveFourRationalBeat(5);
const METER: JazzFiveFourHarmonicTemplate['meter'] = Object.freeze({
  numerator: 5,
  denominator: 4,
  beatGrouping: Object.freeze([3, 2] as [3, 2]),
});

function harmonicSlot(
  id: string,
  start: JazzFiveFourRationalBeat,
  duration: JazzFiveFourRationalBeat,
  func: JazzFiveFourHarmonicFunction,
  rootOffset: number,
  roman: string,
  chordType: string,
): JazzFiveFourHarmonicSlot {
  if (!Number.isInteger(rootOffset) || rootOffset < 0 || rootOffset > 11) {
    throw new RangeError(`Jazz 5/4 harmonic rootOffset must be an integer in [0, 11]; received ${rootOffset}`);
  }
  return {
    id,
    span: { start, duration },
    function: func,
    rootOffset,
    roman,
    chordType,
  };
}

const wholeBar = (
  id: string,
  func: JazzFiveFourHarmonicFunction,
  rootOffset: number,
  roman: string,
  chordType: string,
): JazzFiveFourHarmonicSlot => harmonicSlot(id, R0, R5, func, rootOffset, roman, chordType);

const splitThreeTwo = (
  first: Omit<JazzFiveFourHarmonicSlot, 'span'>,
  second: Omit<JazzFiveFourHarmonicSlot, 'span'>,
): readonly JazzFiveFourHarmonicSlot[] => [
  harmonicSlot(first.id, R0, R3, first.function, first.rootOffset, first.roman, first.chordType),
  harmonicSlot(second.id, R3, R2, second.function, second.rootOffset, second.roman, second.chordType),
];

const chord = (
  id: string,
  func: JazzFiveFourHarmonicFunction,
  rootOffset: number,
  roman: string,
  chordType: string,
): Omit<JazzFiveFourHarmonicSlot, 'span'> => ({ id, function: func, rootOffset, roman, chordType });

const resolutionToTonic: JazzFiveFourCadenceResolution = {
  targetFunction: 'T',
  targetRootOffset: 0,
  withinBars: 1,
};

const templates: JazzFiveFourHarmonicTemplate[] = [
  {
    id: 'j54.harmony.a-vamp.minor-i-v.base.v1',
    family: 'a-vamp',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['intro', 'vamp', 'head', 'solo', 'recap'],
    phraseRoles: ['base'],
    bars: [{
      barIndex: 0,
      slots: splitThreeTwo(
        chord('a-base-tonic', 'T', 0, 'i', 'm9'),
        chord('a-base-response', 'D', 7, 'v', 'm7'),
      ),
    }],
    cadence: { kind: 'modal-loop', terminal: false },
    compatibility: {
      mayStartForm: true,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge', 'turnaround'],
      allowedNextFamilies: ['a-vamp', 'b-bridge', 'turnaround', 'tag-coda'],
    },
  },
  {
    id: 'j54.harmony.a-vamp.minor-i-v.answer.v1',
    family: 'a-vamp',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['vamp', 'head', 'solo', 'recap'],
    phraseRoles: ['answer'],
    bars: [{
      barIndex: 0,
      slots: splitThreeTwo(
        chord('a-answer-tonic', 'T', 0, 'i', 'm11'),
        chord('a-answer-response', 'D', 7, 'v', '9sus4'),
      ),
    }],
    cadence: { kind: 'modal-loop', terminal: false },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge', 'turnaround'],
      allowedNextFamilies: ['a-vamp', 'b-bridge', 'turnaround', 'tag-coda'],
    },
  },
  {
    id: 'j54.harmony.b-bridge.minor-cycle.body.v1',
    family: 'b-bridge',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['bridge', 'solo'],
    phraseRoles: ['answer', 'lift'],
    bars: [
      { barIndex: 0, slots: [wholeBar('b-cycle-iv', 'S', 5, 'iv', 'm9')] },
      { barIndex: 1, slots: [wholeBar('b-cycle-bVII', 'D', 10, 'bVII', '13')] },
      { barIndex: 2, slots: [wholeBar('b-cycle-bIII', 'T', 3, 'bIII', 'maj9')] },
      { barIndex: 3, slots: [wholeBar('b-cycle-bVI', 'S', 8, 'bVI', 'maj9')] },
    ],
    cadence: { kind: 'open-bridge', terminal: false },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge'],
      allowedNextFamilies: ['a-vamp', 'b-bridge', 'turnaround', 'tag-coda'],
    },
  },
  {
    id: 'j54.harmony.b-bridge.modern-reharm.body.v1',
    family: 'b-bridge',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['bridge', 'solo'],
    phraseRoles: ['lift'],
    bars: [
      { barIndex: 0, slots: [wholeBar('b-reharm-tonic', 'T', 0, 'i', 'm9')] },
      { barIndex: 1, slots: [wholeBar('b-reharm-subV-iv', 'D', 6, 'subV/iv', '7#11')] },
      { barIndex: 2, slots: [wholeBar('b-reharm-bVI', 'T', 8, 'bVI', 'maj7')] },
      { barIndex: 3, slots: [wholeBar('b-reharm-v', 'D', 7, 'v', 'm7')] },
      { barIndex: 4, slots: [wholeBar('b-reharm-V-iv', 'D', 0, 'V/iv', '7alt')] },
      { barIndex: 5, slots: [wholeBar('b-reharm-iv', 'S', 5, 'iv', 'm9')] },
    ],
    cadence: { kind: 'open-bridge', terminal: false },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge'],
      allowedNextFamilies: ['a-vamp', 'turnaround', 'tag-coda'],
    },
  },
  {
    id: 'j54.harmony.turnaround.minor-two-five.v1',
    family: 'turnaround',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['head', 'bridge', 'solo', 'recap', 'tag'],
    phraseRoles: ['turnaround'],
    bars: [{
      barIndex: 0,
      slots: splitThreeTwo(
        chord('turn-minor-ii', 'S', 2, 'ii', 'm7b5'),
        chord('turn-minor-V', 'D', 7, 'V', '7alt'),
      ),
    }],
    cadence: { kind: 'turnaround', resolution: resolutionToTonic, terminal: false },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge', 'tag-coda'],
      allowedNextFamilies: ['a-vamp', 'tag-coda'],
    },
  },
  {
    id: 'j54.harmony.turnaround.backdoor.v1',
    family: 'turnaround',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['head', 'bridge', 'solo', 'recap', 'tag'],
    phraseRoles: ['turnaround'],
    bars: [{
      barIndex: 0,
      slots: splitThreeTwo(
        chord('turn-backdoor-iv', 'S', 5, 'iv', 'm9'),
        chord('turn-backdoor-bVII', 'D', 10, 'bVII', '13'),
      ),
    }],
    cadence: { kind: 'turnaround', resolution: resolutionToTonic, terminal: false },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge', 'tag-coda'],
      allowedNextFamilies: ['a-vamp', 'tag-coda'],
    },
  },
  {
    id: 'j54.harmony.tag.echo-vamp.v1',
    family: 'tag-coda',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['tag'],
    phraseRoles: ['ending'],
    bars: [{
      barIndex: 0,
      slots: splitThreeTwo(
        chord('tag-echo-tonic', 'T', 0, 'i', 'm9'),
        chord('tag-echo-response', 'D', 7, 'v', 'm7'),
      ),
    }],
    cadence: { kind: 'echo-tag', terminal: false },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge', 'turnaround', 'tag-coda'],
      allowedNextFamilies: ['tag-coda', 'turnaround'],
    },
  },
  {
    id: 'j54.harmony.coda.minor-plagal-arrival.v1',
    family: 'tag-coda',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['coda'],
    phraseRoles: ['ending'],
    bars: [{
      barIndex: 0,
      slots: splitThreeTwo(
        chord('coda-plagal-iv', 'S', 5, 'iv', 'm9'),
        chord('coda-plagal-tonic', 'T', 0, 'i', 'm6/9'),
      ),
    }],
    cadence: { kind: 'closed-coda', terminal: true },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge', 'tag-coda'],
      allowedNextFamilies: [],
    },
  },
  {
    id: 'j54.harmony.coda.tonic-sustain.v1',
    family: 'tag-coda',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['coda'],
    phraseRoles: ['ending'],
    bars: [{ barIndex: 0, slots: [wholeBar('coda-tonic-sustain', 'T', 0, 'i', 'm6/9')] }],
    // Non-terminal tonic continuation.  It supports a score-owned long Lead
    // release without forcing that held pitch across an unrelated turnaround.
    cadence: { kind: 'echo-tag', terminal: false },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge', 'turnaround', 'tag-coda'],
      allowedNextFamilies: ['tag-coda'],
    },
  },
  {
    id: 'j54.harmony.coda.tonic-hold.v1',
    family: 'tag-coda',
    mode: 'Minor',
    meter: METER,
    sectionRoles: ['coda'],
    phraseRoles: ['ending'],
    bars: [{ barIndex: 0, slots: [wholeBar('coda-tonic-hold', 'T', 0, 'i', 'm6/9')] }],
    cadence: { kind: 'closed-coda', terminal: true },
    compatibility: {
      mayStartForm: false,
      allowedPreviousFamilies: ['a-vamp', 'b-bridge', 'turnaround', 'tag-coda'],
      allowedNextFamilies: [],
    },
  },
];

export const JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR = deepFreeze({
  schemaVersion: JAZZ_FIVE_FOUR_HARMONIC_FORM_SCHEMA_VERSION,
  meter: {
    ...METER,
    beatsPerBar: R5,
  },
  templates,
}) as unknown as JazzFiveFourHarmonicFormGrammar;

const TEMPLATE_BY_ID = new Map(
  JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR.templates.map((template) => [template.id, template] as const),
);

export interface JazzFiveFourHarmonicTemplateQuery {
  readonly family?: JazzFiveFourHarmonicFamily;
  readonly sectionRole?: JazzFiveFourHarmonicSectionRole;
  readonly phraseRole?: JazzFiveFourHarmonicPhraseRole;
  readonly previousTemplateId?: string;
  readonly terminal?: boolean;
}

/** Pure catalog lookup. Unknown ids are deliberately non-throwing for selector probes. */
export function jazzFiveFourHarmonicTemplate(
  id: string,
): JazzFiveFourHarmonicTemplate | undefined {
  return TEMPLATE_BY_ID.get(id);
}

function firstSlot(template: JazzFiveFourHarmonicTemplate): JazzFiveFourHarmonicSlot {
  return template.bars[0].slots[0];
}

function lastSlot(template: JazzFiveFourHarmonicTemplate): JazzFiveFourHarmonicSlot {
  const lastBar = template.bars[template.bars.length - 1];
  return lastBar.slots[lastBar.slots.length - 1];
}

/**
 * Checks bilateral family allowlists and any cadence-owned resolution target.
 * It does not select, mutate, or fit either template.
 */
export function areJazzFiveFourHarmonicTemplatesCompatible(
  previous: JazzFiveFourHarmonicTemplate,
  next: JazzFiveFourHarmonicTemplate,
): boolean {
  if (previous.cadence.terminal) return false;
  if (!previous.compatibility.allowedNextFamilies.includes(next.family)) return false;
  if (!next.compatibility.allowedPreviousFamilies.includes(previous.family)) return false;
  const expected = previous.cadence.resolution;
  if (!expected) return true;
  const arrival = firstSlot(next);
  return arrival.function === expected.targetFunction
    && arrival.rootOffset === expected.targetRootOffset;
}

/** Pure section/phrase candidate filter for the future Arranger. */
export function listJazzFiveFourHarmonicTemplateCandidates(
  query: JazzFiveFourHarmonicTemplateQuery = {},
): readonly JazzFiveFourHarmonicTemplate[] {
  const previous = query.previousTemplateId === undefined
    ? undefined
    : jazzFiveFourHarmonicTemplate(query.previousTemplateId);
  if (query.previousTemplateId !== undefined && !previous) return Object.freeze([]);

  return Object.freeze(JAZZ_FIVE_FOUR_HARMONIC_FORM_GRAMMAR.templates.filter((template) =>
    (query.family === undefined || template.family === query.family)
    && (query.sectionRole === undefined || template.sectionRoles.includes(query.sectionRole))
    && (query.phraseRole === undefined || template.phraseRoles.includes(query.phraseRole))
    && (query.terminal === undefined || template.cadence.terminal === query.terminal)
    && (previous === undefined
      ? true
      : areJazzFiveFourHarmonicTemplatesCompatible(previous, template)),
  ));
}

/** Stable semantic signature; it intentionally excludes any realized key/pitch class. */
export function jazzFiveFourHarmonicFunctionSignature(
  template: JazzFiveFourHarmonicTemplate,
): string {
  return template.bars.map((bar) => bar.slots.map((slot) => {
    const { start, duration } = slot.span;
    return `${slot.function}:${slot.rootOffset}@${start.numerator}/${start.denominator}+${duration.numerator}/${duration.denominator}`;
  }).join(',')).join('|');
}

export interface JazzFiveFourRealizedHarmonicRoot {
  readonly templateId: string;
  readonly barIndex: number;
  readonly slotId: string;
  readonly function: JazzFiveFourHarmonicFunction;
  readonly rootOffset: number;
  readonly rootPc: number;
  readonly span: JazzFiveFourBeatSpan;
}

/**
 * Minimal transposition projection for tests and the future Harmony compiler.
 * Absolute root pitch classes are computed here and never stored in the KB.
 */
export function realizeJazzFiveFourHarmonicRoots(
  template: JazzFiveFourHarmonicTemplate,
  sectionKeyPc: number,
): readonly JazzFiveFourRealizedHarmonicRoot[] {
  if (!Number.isInteger(sectionKeyPc)) {
    throw new RangeError(`Jazz 5/4 sectionKeyPc must be an integer; received ${sectionKeyPc}`);
  }
  const mod12 = (value: number): number => ((value % 12) + 12) % 12;
  return Object.freeze(template.bars.flatMap((bar) => bar.slots.map((slot) => Object.freeze({
    templateId: template.id,
    barIndex: bar.barIndex,
    slotId: slot.id,
    function: slot.function,
    rootOffset: slot.rootOffset,
    rootPc: mod12(sectionKeyPc + slot.rootOffset),
    span: slot.span,
  }))));
}

/** Executable catalog invariants used both by tests and integration guards. */
export function validateJazzFiveFourHarmonicTemplate(
  template: JazzFiveFourHarmonicTemplate,
): readonly string[] {
  const issues: string[] = [];
  if (template.bars.length === 0) issues.push('template must contain at least one bar');

  for (let barIndex = 0; barIndex < template.bars.length; barIndex += 1) {
    const bar = template.bars[barIndex];
    if (bar.barIndex !== barIndex) issues.push(`bar ${barIndex} has non-contiguous barIndex ${bar.barIndex}`);
    if (bar.slots.length === 0) {
      issues.push(`bar ${barIndex} has no harmonic slots`);
      continue;
    }
    let cursor = R0;
    for (const slot of bar.slots) {
      const duration = jazzFiveFourRationalBeatValue(slot.span.duration);
      if (!equalRationalBeat(slot.span.start, cursor)) {
        issues.push(
          `bar ${barIndex} slot ${slot.id} starts at ${jazzFiveFourRationalBeatValue(slot.span.start)}, expected ${jazzFiveFourRationalBeatValue(cursor)}`,
        );
      }
      if (!(duration > 0)) issues.push(`bar ${barIndex} slot ${slot.id} has non-positive duration`);
      if (!Number.isInteger(slot.rootOffset) || slot.rootOffset < 0 || slot.rootOffset > 11) {
        issues.push(`bar ${barIndex} slot ${slot.id} has invalid rootOffset ${slot.rootOffset}`);
      }
      cursor = addRationalBeat(slot.span.start, slot.span.duration);
    }
    if (!equalRationalBeat(cursor, R5)) {
      issues.push(`bar ${barIndex} spans ${jazzFiveFourRationalBeatValue(cursor)} beats instead of 5`);
    }
  }

  const finalSlot = template.bars.length > 0 ? lastSlot(template) : undefined;
  if (template.family === 'turnaround') {
    const resolution = template.cadence.resolution;
    if (template.cadence.kind !== 'turnaround') issues.push('turnaround family requires turnaround cadence');
    if (template.cadence.terminal) issues.push('turnaround must not be terminal');
    if (finalSlot?.function !== 'D') issues.push('turnaround must end on dominant function');
    if (resolution?.targetFunction !== 'T' || resolution.targetRootOffset !== 0 || resolution.withinBars !== 1) {
      issues.push('turnaround must resolve to tonic rootOffset 0 within one bar');
    }
  }

  if (template.cadence.kind === 'closed-coda') {
    if (!template.cadence.terminal) issues.push('closed coda must be terminal');
    if (template.compatibility.allowedNextFamilies.length > 0) issues.push('closed coda must not allow a successor');
    if (finalSlot?.function !== 'T' || finalSlot.rootOffset !== 0) {
      issues.push('closed coda must end on tonic rootOffset 0');
    }
  }
  if (template.cadence.terminal && template.cadence.kind !== 'closed-coda') {
    issues.push('only a closed coda may be terminal');
  }

  return Object.freeze(issues);
}
