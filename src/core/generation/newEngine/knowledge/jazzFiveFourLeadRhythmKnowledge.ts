// ============================================================
// newEngine · knowledge · Jazz 5/4 Lead rhythm vocabulary
// ------------------------------------------------------------
// Rhythm-only product KB derived from the reference Alto Sax performance.
// Templates own relative 30-cell placement, gate, accent, cadence and a
// mutation budget. Pitch and grammar semantics belong to later binders.
// ============================================================

import {
  JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR,
  materializeJazzFiveFourLeadRhythmTemplate,
  type LeadRhythmBrick,
  type LeadRhythmCadenceRole,
  type LeadRhythmMutationBudget,
  type LeadRhythmSlot,
  type LeadRhythmTemplate,
} from '../arranger/jazzFiveFourLeadRhythm';

export const JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_SHA256 =
  '2af0225ca50206087922b71ca81382f37f349e79259859c4b2b7911b673473d1' as const;
export const JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_PPQ = 192 as const;
export const JAZZ_FIVE_FOUR_LEAD_RHYTHM_SOURCE_CELL_TICKS = 32 as const;
export const JAZZ_FIVE_FOUR_LEAD_RHYTHM_ENGINE_CELL_TICKS = 80 as const;

export const JAZZ_FIVE_FOUR_LEAD_PICKUP_ID = 'lead.j54.pickup.source-derived.v1' as const;
export const JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID = 'lead.j54.head-a.source-derived.v1' as const;
export const JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID = 'lead.j54.head-b.source-derived.v1' as const;
export const JAZZ_FIVE_FOUR_LEAD_SOLO_ID = 'lead.j54.solo.source-derived.v1' as const;
export const JAZZ_FIVE_FOUR_LEAD_CODA_ID = 'lead.j54.coda.source-derived.v1' as const;
export const JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID = 'lead.j54.intentional-rest.v1' as const;

/**
 * Finite whole-phrase bank. IDs address complete eight-bar skeletons; no
 * event-level probability or renderer-side deletion is part of this KB.
 */
export const JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS = Object.freeze([
  'lead.j54.head-a.generative-00.v1',
  'lead.j54.head-a.generative-01.v1',
  'lead.j54.head-a.generative-02.v1',
  'lead.j54.head-a.generative-03.v1',
  'lead.j54.head-a.generative-04.v1',
  'lead.j54.head-a.generative-05.v1',
  'lead.j54.head-a.generative-06.v1',
  'lead.j54.head-a.generative-07.v1',
  'lead.j54.head-a.generative-08.v1',
  'lead.j54.head-a.generative-09.v1',
  'lead.j54.head-a.generative-10.v1',
  'lead.j54.head-a.generative-11.v1',
  'lead.j54.head-a.generative-12.v1',
  'lead.j54.head-a.generative-13.v1',
  'lead.j54.head-a.generative-14.v1',
  'lead.j54.head-a.generative-15.v1',
] as const);

export type JazzFiveFourLeadHeadAGenerativeTemplateId =
  typeof JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS[number];

export type JazzFiveFourLeadRhythmTemplateId =
  | typeof JAZZ_FIVE_FOUR_LEAD_PICKUP_ID
  | typeof JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID
  | typeof JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID
  | typeof JAZZ_FIVE_FOUR_LEAD_SOLO_ID
  | typeof JAZZ_FIVE_FOUR_LEAD_CODA_ID
  | typeof JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID
  | JazzFiveFourLeadHeadAGenerativeTemplateId;

type AttackRow = readonly [
  barOffset: number,
  cellInBar: number,
  gateCells: number,
  accent: number,
  cadence?: LeadRhythmCadenceRole,
];

function mutationBudget(input: {
  onsetShift: number;
  gateDelta: number;
  insertions: number;
  deletions: number;
}): LeadRhythmMutationBudget {
  return Object.freeze({
    maxOnsetShiftCells: input.onsetShift,
    maxGateDeltaCells: input.gateDelta,
    maxAttackInsertions: input.insertions,
    maxAttackDeletions: input.deletions,
    preserveIntentionalRests: true,
    preserveCadenceSlots: true,
  });
}

function attackSlots(
  prefix: string,
  rows: readonly AttackRow[],
  referenceResidualTicks: readonly number[],
): readonly LeadRhythmSlot[] {
  if (rows.length !== referenceResidualTicks.length) {
    throw new RangeError(`Jazz 5/4 Lead ${prefix} residual cardinality mismatch`);
  }
  return Object.freeze(rows.map(([barOffset, cellInBar, gateCells, accent, cadence = 'none'], index) =>
    Object.freeze({
      slotId: `${prefix}-${String(index).padStart(3, '0')}`,
      kind: 'attack' as const,
      barOffset,
      cellInBar,
      gateCells,
      accent,
      cadence,
      referenceResidualTicks: referenceResidualTicks[index]!,
    })));
}

function rhythmTemplate(input: {
  id: JazzFiveFourLeadRhythmTemplateId;
  barCount: number;
  slots: readonly LeadRhythmSlot[];
  mutationBudget: LeadRhythmMutationBudget;
}): LeadRhythmTemplate {
  return Object.freeze({
    id: input.id,
    barCount: input.barCount,
    cellsPerBar: JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR,
    slots: input.slots,
    mutationBudget: input.mutationBudget,
  });
}

const PICKUP_ROWS: readonly AttackRow[] = Object.freeze([
  [0, 18, 1, 0.598],
  [0, 22, 1, 0.567],
  [0, 24, 2, 0.772],
  [0, 27, 2, 0.850, 'setup'],
]);

const HEAD_A_ROWS: readonly AttackRow[] = Object.freeze([
  [0, 0, 2, 0.945], [0, 3, 2, 0.772], [0, 7, 1, 0.630],
  [0, 10, 2, 0.803], [0, 13, 3, 0.850], [0, 18, 5, 0.535],
  [0, 23, 2, 0.559], [0, 24, 1, 0.520], [0, 25, 2, 0.772, 'setup'],
  [1, 1, 17, 0.709, 'arrival'], [1, 18, 2, 0.803], [1, 21, 1, 0.520],
  [1, 22, 1, 0.520], [1, 23, 1, 0.740], [1, 24, 6, 0.630],
  [2, 0, 17, 0.598], [2, 18, 2, 0.709], [2, 21, 1, 0.465],
  [2, 22, 1, 0.520], [2, 23, 2, 0.740], [2, 24, 6, 0.598],
  [3, 0, 15, 0.677], [3, 18, 2, 0.520], [3, 22, 2, 0.535],
  [3, 24, 2, 0.709], [3, 27, 2, 0.850, 'setup'],
  [4, 0, 2, 0.945, 'arrival'], [4, 3, 2, 0.772], [4, 7, 1, 0.630],
  [4, 10, 2, 0.803], [4, 13, 3, 0.850], [4, 18, 5, 0.535],
  [4, 23, 2, 0.559], [4, 24, 1, 0.520], [4, 25, 2, 0.772],
  [5, 1, 17, 0.709], [5, 18, 2, 0.661], [5, 21, 1, 0.520],
  [5, 22, 1, 0.520], [5, 23, 1, 0.740], [5, 24, 6, 0.630],
  [6, 1, 17, 0.709], [6, 18, 2, 0.661], [6, 21, 1, 0.520],
  [6, 22, 1, 0.520], [6, 23, 1, 0.740], [6, 24, 6, 0.630],
  [7, 1, 10, 0.520, 'release'],
]);

const HEAD_B_ROWS: readonly AttackRow[] = Object.freeze([
  [0, 1, 3, 0.898], [0, 5, 2, 0.898], [0, 10, 2, 0.992], [0, 13, 3, 0.898],
  [0, 19, 2, 0.535], [0, 21, 2, 0.598], [0, 24, 3, 0.709], [0, 27, 2, 0.709],
  [1, 1, 3, 0.945], [1, 5, 2, 0.898], [1, 10, 2, 0.992], [1, 13, 4, 0.803],
  [1, 19, 3, 0.402], [1, 22, 2, 0.520], [1, 25, 2, 0.677], [1, 27, 2, 0.677],
  [2, 1, 3, 0.850], [2, 5, 2, 0.898], [2, 10, 3, 0.945], [2, 13, 3, 0.740],
  [2, 19, 2, 0.504], [2, 22, 2, 0.535], [2, 25, 2, 0.465], [2, 28, 2, 0.709],
  [3, 0, 3, 0.850], [3, 4, 2, 0.433], [3, 7, 2, 0.559], [3, 10, 2, 0.535],
  [3, 13, 3, 0.898], [3, 19, 3, 0.898], [3, 22, 2, 0.535], [3, 26, 2, 0.488],
  [3, 28, 2, 0.677, 'setup'],
  [4, 1, 3, 0.898, 'arrival'], [4, 5, 2, 0.898], [4, 10, 2, 0.992], [4, 13, 3, 0.898],
  [4, 19, 2, 0.535], [4, 21, 2, 0.598], [4, 24, 3, 0.709], [4, 27, 2, 0.709],
  [5, 1, 3, 0.945], [5, 5, 2, 0.898], [5, 10, 2, 0.992], [5, 13, 4, 0.803],
  [5, 19, 3, 0.402], [5, 22, 2, 0.520], [5, 25, 2, 0.677], [5, 27, 2, 0.677],
  [6, 1, 3, 0.898], [6, 5, 2, 0.850], [6, 10, 2, 0.898], [6, 13, 3, 0.709],
  [6, 19, 2, 0.433], [6, 22, 2, 0.567], [6, 25, 2, 0.803], [6, 28, 2, 0.677],
  [7, 1, 15, 0.567, 'arrival'], [7, 22, 1, 0.465], [7, 24, 2, 0.740],
  [7, 27, 2, 0.850, 'setup'],
]);

const SOLO_ROWS: readonly AttackRow[] = Object.freeze([
  [0, 0, 1, 0.709], [0, 1, 15, 0.709], [0, 16, 2, 0.488], [0, 17, 2, 0.417], [0, 18, 2, 0.433],
  [1, 0, 10, 0.598], [1, 10, 2, 0.709], [1, 13, 3, 0.520],
  [2, 0, 3, 0.819], [2, 4, 2, 0.740], [2, 7, 3, 0.520], [2, 10, 2, 0.520],
  [2, 12, 3, 0.709], [2, 15, 8, 0.567], [2, 24, 1, 0.803],
  [3, 1, 9, 0.677], [3, 10, 2, 0.488], [3, 13, 3, 0.535], [3, 16, 2, 0.677],
  [4, 0, 10, 0.567], [4, 11, 5, 0.559], [4, 16, 2, 0.488], [4, 18, 5, 0.567], [4, 24, 2, 0.803],
  [5, 1, 9, 0.630], [5, 10, 6, 0.520], [5, 16, 2, 0.488], [5, 19, 2, 0.772],
  [5, 22, 2, 0.677], [5, 25, 2, 0.520], [5, 28, 2, 0.567],
  [6, 1, 9, 0.567], [6, 10, 6, 0.535], [6, 16, 2, 0.449], [6, 19, 4, 0.535], [6, 24, 2, 0.803],
  [7, 0, 9, 0.598], [7, 10, 6, 0.535], [7, 16, 2, 0.520], [7, 18, 3, 0.535],
  [7, 22, 2, 0.803, 'release'],
]);

const CODA_ROWS: readonly AttackRow[] = Object.freeze([
  [0, 18, 2, 0.661], [0, 21, 1, 0.520], [0, 22, 1, 0.520], [0, 23, 1, 0.740], [0, 24, 6, 0.630],
  [1, 1, 17, 0.709],
  [2, 18, 2, 0.661], [2, 21, 1, 0.520], [2, 22, 1, 0.520], [2, 23, 1, 0.740], [2, 24, 6, 0.630],
  [3, 1, 17, 0.709],
  [4, 18, 2, 0.661], [4, 21, 1, 0.520], [4, 22, 1, 0.520], [4, 23, 1, 0.740],
  [4, 24, 6, 0.630, 'setup'],
  [5, 1, 81, 0.504, 'arrival'],
]);

/**
 * Exact engine-tick differences between source onsets and the nearest 80-tick
 * nominal cell. They are authored performance evidence, not a second swing.
 */
const PICKUP_REFERENCE_RESIDUALS = Object.freeze([35, -15, 20, 35] as const);
const HEAD_A_REFERENCE_RESIDUALS = Object.freeze([
  35, 35, 5, 15, -30, 20, -20, 0, -40, -35, 5, -20, -10, -15, 10, 30,
  10, 25, -30, -15, 15, 0, 35, -15, 25, 35, 35, 35, 5, 15, -30, 20,
  -20, 0, -40, -35, 5, -20, -10, -15, 10, -35, 5, -20, -10, -15, 10, -20,
] as const);
const HEAD_B_REFERENCE_RESIDUALS = Object.freeze([
  -25, -35, -20, -25, -35, 35, 30, 35, -35, 10, 10, 30, 25, 20, -20, 35,
  -15, -25, -5, 10, -35, -5, -15, -10, 35, -5, -30, -5, -10, 5, 35, -35,
  10, -25, -35, -20, -25, -35, 35, 30, 35, -35, 10, 10, 30, 25, 20, -20,
  35, -25, -10, 0, 15, -15, -5, -30, 5, 25, -30, 20, 20,
] as const);
const SOLO_REFERENCE_RESIDUALS = Object.freeze([
  30, 20, -15, 10, 20, 20, 15, 20, 10, -5, -40, -10, 15, 10, 35, -40,
  -10, -35, 5, 35, -30, -10, 10, 0, -30, 0, 0, -40, 0, -5, -20, -35,
  10, 25, -30, -5, 35, 0, -10, 35, 5,
] as const);
const CODA_REFERENCE_RESIDUALS = Object.freeze([
  5, -20, -10, -15, 10, -35, 5, -20, -10, -15, 10, -35, 5, -20, -10, -15, 10, -30,
] as const);

export const JAZZ_FIVE_FOUR_LEAD_PICKUP = rhythmTemplate({
  id: JAZZ_FIVE_FOUR_LEAD_PICKUP_ID,
  barCount: 1,
  slots: attackSlots('pickup', PICKUP_ROWS, PICKUP_REFERENCE_RESIDUALS),
  mutationBudget: mutationBudget({ onsetShift: 1, gateDelta: 1, insertions: 0, deletions: 0 }),
});

export const JAZZ_FIVE_FOUR_LEAD_HEAD_A = rhythmTemplate({
  id: JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID,
  barCount: 8,
  slots: attackSlots('head-a', HEAD_A_ROWS, HEAD_A_REFERENCE_RESIDUALS),
  mutationBudget: mutationBudget({ onsetShift: 1, gateDelta: 1, insertions: 0, deletions: 0 }),
});

export const JAZZ_FIVE_FOUR_LEAD_HEAD_B = rhythmTemplate({
  id: JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID,
  barCount: 8,
  slots: attackSlots('head-b', HEAD_B_ROWS, HEAD_B_REFERENCE_RESIDUALS),
  mutationBudget: mutationBudget({ onsetShift: 1, gateDelta: 1, insertions: 0, deletions: 0 }),
});

export const JAZZ_FIVE_FOUR_LEAD_SOLO = rhythmTemplate({
  id: JAZZ_FIVE_FOUR_LEAD_SOLO_ID,
  barCount: 8,
  slots: attackSlots('solo', SOLO_ROWS, SOLO_REFERENCE_RESIDUALS),
  mutationBudget: mutationBudget({ onsetShift: 1, gateDelta: 2, insertions: 2, deletions: 2 }),
});

/** The final arrival sustains through the two-bar tail, hence eight bars total. */
export const JAZZ_FIVE_FOUR_LEAD_CODA = rhythmTemplate({
  id: JAZZ_FIVE_FOUR_LEAD_CODA_ID,
  barCount: 8,
  slots: attackSlots('coda', CODA_ROWS, CODA_REFERENCE_RESIDUALS),
  mutationBudget: mutationBudget({ onsetShift: 1, gateDelta: 1, insertions: 0, deletions: 0 }),
});

export const JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST = rhythmTemplate({
  id: JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID,
  barCount: 1,
  slots: Object.freeze([
    Object.freeze({
      slotId: 'intentional-rest-000',
      kind: 'rest' as const,
      barOffset: 0,
      cellInBar: 0,
      gateCells: JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR,
      accent: 0,
      cadence: 'release' as const,
      referenceResidualTicks: 0,
    }),
  ]),
  mutationBudget: mutationBudget({ onsetShift: 0, gateDelta: 0, insertions: 0, deletions: 0 }),
});

export interface JazzFiveFourLeadHeadAWholePhraseVariantSpec {
  readonly id: JazzFiveFourLeadHeadAGenerativeTemplateId;
  readonly sourceTemplateId: typeof JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID;
  readonly selectionUnit: 'whole-eight-bar-phrase';
  readonly identityFloor: 0.7;
  /** Repeated answer tail note in bars 1/5 moves as one two-note phrase operation. */
  readonly echoTailLate: boolean;
  /** Bar 7 response tail moves as one four-attack motif group. */
  readonly responseTailEarly: boolean;
  /** Three long arrivals shorten together; no event-level random choice exists. */
  readonly longArrivalsTight: boolean;
  /** The final release may anticipate by one cell, as observed in A variants. */
  readonly endingEarly: boolean;
}

export const JAZZ_FIVE_FOUR_LEAD_HEAD_A_WHOLE_PHRASE_SPECS: readonly JazzFiveFourLeadHeadAWholePhraseVariantSpec[] =
  Object.freeze(JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_IDS.map((id, index) => Object.freeze({
    id,
    sourceTemplateId: JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID,
    selectionUnit: 'whole-eight-bar-phrase' as const,
    identityFloor: 0.7 as const,
    echoTailLate: (index & 1) !== 0,
    responseTailEarly: (index & 2) !== 0,
    longArrivalsTight: (index & 4) !== 0,
    endingEarly: (index & 8) !== 0,
  })));

function materializeHeadAWholePhraseVariant(
  spec: JazzFiveFourLeadHeadAWholePhraseVariantSpec,
): LeadRhythmTemplate {
  const slots = JAZZ_FIVE_FOUR_LEAD_HEAD_A.slots.map((slot) => {
    let cellInBar = slot.cellInBar;
    let gateCells = slot.gateCells;

    // Each branch is a named phrase-level operation selected before this map;
    // none is an independent note probability/drop decision.
    if (
      spec.echoTailLate
      && (slot.barOffset === 0 || slot.barOffset === 4)
      && slot.cellInBar === 25
    ) cellInBar += 1;
    if (
      spec.responseTailEarly
      && slot.barOffset === 6
      && slot.cellInBar >= 21
      && slot.cellInBar <= 24
    ) cellInBar -= 1;
    if (
      spec.longArrivalsTight
      && (slot.barOffset === 1 || slot.barOffset === 5 || slot.barOffset === 6)
      && slot.cellInBar === 1
      && slot.gateCells === 17
    ) gateCells -= 1;
    if (spec.endingEarly && slot.barOffset === 7 && slot.cellInBar === 1) cellInBar -= 1;

    return Object.freeze({
      ...slot,
      cellInBar,
      gateCells,
      // The whole-phrase transform changes only nominal structure. Preserve
      // the source-derived pocket profile so Performance applies it once at
      // the transformed slot; Renderer must not swing or humanize it again.
      referenceResidualTicks: slot.referenceResidualTicks,
    });
  });
  return rhythmTemplate({
    id: spec.id,
    barCount: 8,
    slots: Object.freeze(slots),
    mutationBudget: JAZZ_FIVE_FOUR_LEAD_HEAD_A.mutationBudget,
  });
}

export const JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_TEMPLATES: readonly LeadRhythmTemplate[] =
  Object.freeze(JAZZ_FIVE_FOUR_LEAD_HEAD_A_WHOLE_PHRASE_SPECS.map(materializeHeadAWholePhraseVariant));

const HEAD_A_GENERATIVE_TEMPLATE_MAP = Object.fromEntries(
  JAZZ_FIVE_FOUR_LEAD_HEAD_A_GENERATIVE_TEMPLATES.map((template) => [template.id, template]),
) as Record<JazzFiveFourLeadHeadAGenerativeTemplateId, LeadRhythmTemplate>;

export const JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES: Readonly<
  Record<JazzFiveFourLeadRhythmTemplateId, LeadRhythmTemplate>
> = Object.freeze({
  [JAZZ_FIVE_FOUR_LEAD_PICKUP_ID]: JAZZ_FIVE_FOUR_LEAD_PICKUP,
  [JAZZ_FIVE_FOUR_LEAD_HEAD_A_ID]: JAZZ_FIVE_FOUR_LEAD_HEAD_A,
  [JAZZ_FIVE_FOUR_LEAD_HEAD_B_ID]: JAZZ_FIVE_FOUR_LEAD_HEAD_B,
  [JAZZ_FIVE_FOUR_LEAD_SOLO_ID]: JAZZ_FIVE_FOUR_LEAD_SOLO,
  [JAZZ_FIVE_FOUR_LEAD_CODA_ID]: JAZZ_FIVE_FOUR_LEAD_CODA,
  [JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST_ID]: JAZZ_FIVE_FOUR_LEAD_INTENTIONAL_REST,
  ...HEAD_A_GENERATIVE_TEMPLATE_MAP,
});

/** Stable pitchless identity used by Arranger when pairing Head A and recap. */
export function jazzFiveFourLeadRhythmSkeletonIdentity(
  leftId: JazzFiveFourLeadRhythmTemplateId,
  rightId: JazzFiveFourLeadRhythmTemplateId,
): number {
  const left = JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES[leftId].slots
    .filter((slot) => slot.kind === 'attack');
  const right = JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES[rightId].slots
    .filter((slot) => slot.kind === 'attack');
  const rightBySlotId = new Map(right.map((slot) => [slot.slotId, slot] as const));
  const matching = left.filter((slot) => {
    const candidate = rightBySlotId.get(slot.slotId);
    return candidate !== undefined
      && candidate.barOffset === slot.barOffset
      && candidate.cellInBar === slot.cellInBar
      && candidate.gateCells === slot.gateCells
      && candidate.cadence === slot.cadence;
  }).length;
  return matching / Math.max(1, left.length, right.length);
}

export function jazzFiveFourLeadRhythmSkeletonSignature(
  id: JazzFiveFourLeadRhythmTemplateId,
): string {
  return JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES[id].slots
    .map((slot) => [
      slot.kind,
      slot.barOffset,
      slot.cellInBar,
      slot.gateCells,
      slot.cadence,
    ].join(':'))
    .join('|');
}

export function jazzFiveFourLeadRhythmTemplate(
  id: string | undefined,
): LeadRhythmTemplate | undefined {
  return id && Object.prototype.hasOwnProperty.call(JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES, id)
    ? JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES[id as JazzFiveFourLeadRhythmTemplateId]
    : undefined;
}

/** Pure KB lookup + Arranger placement; it does not bind or invent grammar. */
export function materializeJazzFiveFourLeadRhythm(
  id: JazzFiveFourLeadRhythmTemplateId,
  startBar: number,
): LeadRhythmBrick {
  return materializeJazzFiveFourLeadRhythmTemplate(
    JAZZ_FIVE_FOUR_LEAD_RHYTHM_TEMPLATES[id],
    startBar,
  );
}
