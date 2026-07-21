// ============================================================
// newEngine · arranger · Jazz 5/4 Lead rhythm binding
// ------------------------------------------------------------
// This is an isolated score-owned clock seam. LeadRhythmBrick owns every
// onset, intentional rest, gate and accent. Semantic grammar tokens own no
// timing. Binding is one-to-one and fail-closed: this module never truncates,
// stretches, fills a gap or invents a fallback token.
// ============================================================

export const JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR = 30 as const;
export const JAZZ_FIVE_FOUR_LEAD_CELL_TICKS = 80 as const;
export const JAZZ_FIVE_FOUR_LEAD_BAR_TICKS = 2_400 as const;
export const JAZZ_FIVE_FOUR_LEAD_MAX_GRAMMAR_REDRAWS = 2 as const;

export type LeadRhythmSlotKind = 'attack' | 'rest';
export type LeadRhythmCadenceRole = 'none' | 'setup' | 'arrival' | 'release';

/**
 * A slot is purely rhythmic. In particular it has no pitch, scale degree,
 * chord-degree chain or grammar rule. `gateCells` is a duration for attacks
 * and the protected silence width for intentional rests.
 */
export interface LeadRhythmSlot {
  readonly slotId: string;
  readonly kind: LeadRhythmSlotKind;
  readonly barOffset: number;
  readonly cellInBar: number;
  readonly gateCells: number;
  readonly accent: number;
  readonly cadence: LeadRhythmCadenceRole;
  /**
   * Source-derived performance offset from the 80-tick nominal lattice.
   * Generic/generated slots omit it (zero); Performance may apply it once.
   */
  readonly referenceResidualTicks?: number;
}

/** Explicit budget for a future Arranger mutation pass; this binder mutates nothing. */
export interface LeadRhythmMutationBudget {
  readonly maxOnsetShiftCells: number;
  readonly maxGateDeltaCells: number;
  readonly maxAttackInsertions: number;
  readonly maxAttackDeletions: number;
  readonly preserveIntentionalRests: true;
  readonly preserveCadenceSlots: true;
}

/** One phrase-sized 5/4 clock, always expressed on the 30-cell bar grid. */
export interface LeadRhythmBrick {
  readonly id: string;
  readonly startBar: number;
  readonly barCount: number;
  readonly cellsPerBar: typeof JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR;
  readonly slots: readonly LeadRhythmSlot[];
  readonly mutationBudget: LeadRhythmMutationBudget;
}

/**
 * Reusable KB material has no absolute placement. Arranger supplies startBar
 * exactly once when it turns a template into a score-owned rhythm brick.
 */
export interface LeadRhythmTemplate {
  readonly id: string;
  readonly barCount: number;
  readonly cellsPerBar: typeof JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR;
  readonly slots: readonly LeadRhythmSlot[];
  readonly mutationBudget: LeadRhythmMutationBudget;
}

export type LeadSemanticAtom =
  | 'chord-tone'
  | 'guide-tone'
  | 'scale-tone'
  | 'approach-tone'
  | 'neighbor-tone'
  | 'enclosure-tone';

/**
 * One audible grammar result. It deliberately has no onset, duration, gate,
 * accent or rest token: rhythm is not a grammar-owned concern at this seam.
 */
export interface SemanticGrammarToken {
  readonly tokenId: string;
  readonly audible: true;
  readonly semanticAtom: LeadSemanticAtom;
  readonly rulePath: readonly string[];
  /**
   * Legacy callers may annotate a span, but the production Jazz 5/4 compiler
   * leaves this absent until SlotBinder has supplied a nominal tick and then
   * performs the authoritative HarmonicPlan lookup at that tick.
   */
  readonly chordSpanId?: string;
}

/** One semantic attack placed on the exact clock authored by its rhythm slot. */
export interface BoundLeadToken {
  readonly eventId: string;
  readonly slotId: string;
  readonly grammarTokenId: string;
  readonly absoluteCell: number;
  readonly nominalTick: number;
  readonly gateCells: number;
  readonly nominalDurationTicks: number;
  readonly referenceResidualTicks: number;
  readonly accent: number;
  readonly cadence: LeadRhythmCadenceRole;
  readonly semanticAtom: LeadSemanticAtom;
  readonly rulePath: readonly string[];
  readonly chordSpanId?: string;
}

export type JazzFiveFourLeadBindingErrorCode =
  | 'INVALID_RHYTHM_BRICK'
  | 'INVALID_GRAMMAR_TOKEN'
  | 'TOKEN_COUNT_MISMATCH';

export interface LeadGrammarRedrawRequest {
  readonly strategy: 'redraw-semantic-grammar';
  readonly expectedAudibleTokenCount: number;
  readonly receivedAudibleTokenCount: number;
  readonly maxAttempts: typeof JAZZ_FIVE_FOUR_LEAD_MAX_GRAMMAR_REDRAWS;
}

/**
 * An orchestration layer may catch this error and redraw grammar at most twice.
 * The binder itself never retries and never exposes a partial binding.
 */
export class JazzFiveFourLeadBindingError extends Error {
  readonly name = 'JazzFiveFourLeadBindingError';

  constructor(
    readonly code: JazzFiveFourLeadBindingErrorCode,
    message: string,
    readonly redrawRequest?: LeadGrammarRedrawRequest,
  ) {
    super(message);
  }
}

const CADENCE_ROLES = new Set<LeadRhythmCadenceRole>([
  'none',
  'setup',
  'arrival',
  'release',
]);

const SEMANTIC_ATOMS = new Set<LeadSemanticAtom>([
  'chord-tone',
  'guide-tone',
  'scale-tone',
  'approach-tone',
  'neighbor-tone',
  'enclosure-tone',
]);

const RHYTHM_FORBIDDEN_KEYS = new Set([
  'pitch',
  'midiPitch',
  'pitchClass',
  'degree',
  'degreeChain',
  'semanticAtom',
  'rulePath',
  'chordSpanId',
]);

const TEMPLATE_FORBIDDEN_KEYS = new Set([
  ...RHYTHM_FORBIDDEN_KEYS,
  'startBar',
  'sourceBar',
  'sourceBarIndex',
  'absoluteBar',
  'absoluteTick',
]);

const GRAMMAR_FORBIDDEN_KEYS = new Set([
  'slotId',
  'barOffset',
  'cellInBar',
  'absoluteCell',
  'nominalTick',
  'onset',
  'onsetBeat',
  'startBeat',
  'duration',
  'durationBeat',
  'durationTicks',
  'gate',
  'gateCells',
  'accent',
  'cadence',
  'rest',
]);

function fail(
  code: Exclude<JazzFiveFourLeadBindingErrorCode, 'TOKEN_COUNT_MISMATCH'>,
  message: string,
): never {
  throw new JazzFiveFourLeadBindingError(code, message);
}

function assertNonEmptyString(
  value: unknown,
  label: string,
  code: Exclude<JazzFiveFourLeadBindingErrorCode, 'TOKEN_COUNT_MISMATCH'>,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(code, `${label} must be a non-empty string`);
}

function assertNonNegativeInteger(
  value: unknown,
  label: string,
  code: Exclude<JazzFiveFourLeadBindingErrorCode, 'TOKEN_COUNT_MISMATCH'>,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(code, `${label} must be a non-negative safe integer`);
}

function assertNoForbiddenKeys(
  value: object,
  keys: ReadonlySet<string>,
  label: string,
  code: Exclude<JazzFiveFourLeadBindingErrorCode, 'TOKEN_COUNT_MISMATCH'>,
): void {
  const forbidden = Object.keys(value).find((key) => keys.has(key));
  if (forbidden) fail(code, `${label} must not own ${forbidden}`);
}

function validateMutationBudget(budget: LeadRhythmMutationBudget): void {
  if (!budget || typeof budget !== 'object') fail('INVALID_RHYTHM_BRICK', 'mutationBudget is required');
  for (const key of [
    'maxOnsetShiftCells',
    'maxGateDeltaCells',
    'maxAttackInsertions',
    'maxAttackDeletions',
  ] as const) {
    assertNonNegativeInteger(budget[key], `mutationBudget.${key}`, 'INVALID_RHYTHM_BRICK');
  }
  if (budget.preserveIntentionalRests !== true || budget.preserveCadenceSlots !== true) {
    fail('INVALID_RHYTHM_BRICK', 'mutationBudget must preserve intentional rests and cadence slots');
  }
}

function validateRhythmBrick(brick: LeadRhythmBrick): void {
  if (!brick || typeof brick !== 'object') fail('INVALID_RHYTHM_BRICK', 'LeadRhythmBrick is required');
  assertNoForbiddenKeys(brick, RHYTHM_FORBIDDEN_KEYS, 'LeadRhythmBrick', 'INVALID_RHYTHM_BRICK');
  assertNonEmptyString(brick.id, 'LeadRhythmBrick.id', 'INVALID_RHYTHM_BRICK');
  assertNonNegativeInteger(brick.startBar, 'LeadRhythmBrick.startBar', 'INVALID_RHYTHM_BRICK');
  assertNonNegativeInteger(brick.barCount, 'LeadRhythmBrick.barCount', 'INVALID_RHYTHM_BRICK');
  if (brick.barCount === 0) fail('INVALID_RHYTHM_BRICK', 'LeadRhythmBrick.barCount must be greater than zero');
  if (brick.cellsPerBar !== JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR) {
    fail('INVALID_RHYTHM_BRICK', `LeadRhythmBrick.cellsPerBar must equal ${JAZZ_FIVE_FOUR_LEAD_CELLS_PER_BAR}`);
  }
  if (!Array.isArray(brick.slots)) fail('INVALID_RHYTHM_BRICK', 'LeadRhythmBrick.slots must be an array');
  validateMutationBudget(brick.mutationBudget);

  const ids = new Set<string>();
  const occupiedOnsets = new Set<number>();
  const restWindows: Array<{ start: number; end: number; slotId: string }> = [];
  const attackCells: Array<{ cell: number; slotId: string }> = [];
  const brickCells = brick.barCount * brick.cellsPerBar;

  for (const [index, slot] of brick.slots.entries()) {
    if (!slot || typeof slot !== 'object') fail('INVALID_RHYTHM_BRICK', `slots[${index}] must be an object`);
    assertNoForbiddenKeys(slot, RHYTHM_FORBIDDEN_KEYS, `slots[${index}]`, 'INVALID_RHYTHM_BRICK');
    assertNonEmptyString(slot.slotId, `slots[${index}].slotId`, 'INVALID_RHYTHM_BRICK');
    if (ids.has(slot.slotId)) fail('INVALID_RHYTHM_BRICK', `duplicate slotId ${slot.slotId}`);
    ids.add(slot.slotId);
    if (slot.kind !== 'attack' && slot.kind !== 'rest') {
      fail('INVALID_RHYTHM_BRICK', `slots[${index}].kind must be attack or rest`);
    }
    assertNonNegativeInteger(slot.barOffset, `slots[${index}].barOffset`, 'INVALID_RHYTHM_BRICK');
    assertNonNegativeInteger(slot.cellInBar, `slots[${index}].cellInBar`, 'INVALID_RHYTHM_BRICK');
    if (slot.barOffset >= brick.barCount) fail('INVALID_RHYTHM_BRICK', `slot ${slot.slotId} is outside its brick`);
    if (slot.cellInBar >= brick.cellsPerBar) fail('INVALID_RHYTHM_BRICK', `slot ${slot.slotId} is outside its bar`);
    if (!Number.isSafeInteger(slot.gateCells) || slot.gateCells <= 0) {
      fail('INVALID_RHYTHM_BRICK', `slot ${slot.slotId} gateCells must be a positive safe integer`);
    }
    if (!Number.isFinite(slot.accent) || slot.accent < 0 || slot.accent > 1) {
      fail('INVALID_RHYTHM_BRICK', `slot ${slot.slotId} accent must be within 0..1`);
    }
    if (!CADENCE_ROLES.has(slot.cadence)) fail('INVALID_RHYTHM_BRICK', `slot ${slot.slotId} has an invalid cadence role`);
    if (
      slot.referenceResidualTicks !== undefined
      && (!Number.isSafeInteger(slot.referenceResidualTicks) || Math.abs(slot.referenceResidualTicks) > 40)
    ) {
      fail('INVALID_RHYTHM_BRICK', `slot ${slot.slotId} referenceResidualTicks must be an integer within -40..40`);
    }
    if (slot.kind === 'rest' && slot.accent !== 0) {
      fail('INVALID_RHYTHM_BRICK', `intentional rest ${slot.slotId} must have accent 0`);
    }

    const relativeCell = slot.barOffset * brick.cellsPerBar + slot.cellInBar;
    if (relativeCell + slot.gateCells > brickCells) {
      fail('INVALID_RHYTHM_BRICK', `slot ${slot.slotId} gate extends beyond its brick`);
    }
    if (occupiedOnsets.has(relativeCell)) fail('INVALID_RHYTHM_BRICK', `multiple slots begin at relative cell ${relativeCell}`);
    occupiedOnsets.add(relativeCell);
    if (slot.kind === 'rest') restWindows.push({ start: relativeCell, end: relativeCell + slot.gateCells, slotId: slot.slotId });
    else attackCells.push({ cell: relativeCell, slotId: slot.slotId });
  }

  for (const attack of attackCells) {
    const rest = restWindows.find((window) => attack.cell >= window.start && attack.cell < window.end);
    if (rest) fail('INVALID_RHYTHM_BRICK', `attack ${attack.slotId} enters intentional rest ${rest.slotId}`);
  }

  const maxAbsoluteCell = (brick.startBar + brick.barCount) * brick.cellsPerBar;
  if (!Number.isSafeInteger(maxAbsoluteCell * JAZZ_FIVE_FOUR_LEAD_CELL_TICKS)) {
    fail('INVALID_RHYTHM_BRICK', 'LeadRhythmBrick exceeds the safe integer tick range');
  }
}

function validateGrammarTokens(tokens: readonly SemanticGrammarToken[]): void {
  if (!Array.isArray(tokens)) fail('INVALID_GRAMMAR_TOKEN', 'grammarTokens must be an array');
  const ids = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    if (!token || typeof token !== 'object') fail('INVALID_GRAMMAR_TOKEN', `grammarTokens[${index}] must be an object`);
    assertNoForbiddenKeys(token, GRAMMAR_FORBIDDEN_KEYS, `grammarTokens[${index}]`, 'INVALID_GRAMMAR_TOKEN');
    assertNonEmptyString(token.tokenId, `grammarTokens[${index}].tokenId`, 'INVALID_GRAMMAR_TOKEN');
    if (ids.has(token.tokenId)) fail('INVALID_GRAMMAR_TOKEN', `duplicate grammar tokenId ${token.tokenId}`);
    ids.add(token.tokenId);
    if (token.audible !== true) fail('INVALID_GRAMMAR_TOKEN', `grammar token ${token.tokenId} must be an audible attack token`);
    if (!SEMANTIC_ATOMS.has(token.semanticAtom)) fail('INVALID_GRAMMAR_TOKEN', `grammar token ${token.tokenId} has an invalid semanticAtom`);
    if (!Array.isArray(token.rulePath) || token.rulePath.length === 0) {
      fail('INVALID_GRAMMAR_TOKEN', `grammar token ${token.tokenId} must carry a non-empty rulePath`);
    }
    for (const [pathIndex, path] of token.rulePath.entries()) {
      assertNonEmptyString(path, `grammarTokens[${index}].rulePath[${pathIndex}]`, 'INVALID_GRAMMAR_TOKEN');
    }
    if (token.chordSpanId !== undefined) {
      assertNonEmptyString(token.chordSpanId, `grammarTokens[${index}].chordSpanId`, 'INVALID_GRAMMAR_TOKEN');
    }
  }
}

function absoluteCellFor(brick: LeadRhythmBrick, slot: LeadRhythmSlot): number {
  return (brick.startBar + slot.barOffset) * brick.cellsPerBar + slot.cellInBar;
}

/**
 * Pure placement seam for rhythm KB templates. It clones and freezes the
 * reusable material, validates the resulting brick, and never reads harmony,
 * pitch, MIDI evidence or renderer state.
 */
export function materializeJazzFiveFourLeadRhythmTemplate(
  template: LeadRhythmTemplate,
  startBar: number,
): LeadRhythmBrick {
  if (!template || typeof template !== 'object') {
    fail('INVALID_RHYTHM_BRICK', 'LeadRhythmTemplate is required');
  }
  assertNoForbiddenKeys(
    template,
    TEMPLATE_FORBIDDEN_KEYS,
    'LeadRhythmTemplate',
    'INVALID_RHYTHM_BRICK',
  );
  assertNonNegativeInteger(startBar, 'LeadRhythmTemplate.startBar argument', 'INVALID_RHYTHM_BRICK');

  const brick: LeadRhythmBrick = Object.freeze({
    id: `${template.id}@bar-${startBar}`,
    startBar,
    barCount: template.barCount,
    cellsPerBar: template.cellsPerBar,
    slots: Object.freeze(template.slots.map((slot) => Object.freeze({ ...slot }))),
    mutationBudget: Object.freeze({ ...template.mutationBudget }),
  });
  validateRhythmBrick(brick);
  return brick;
}

/**
 * Binds grammar semantics to chronological attack slots. Intentional rests do
 * not consume tokens. Any cardinality/schema problem throws before producing
 * output, so callers cannot accidentally render a partial phrase.
 */
export function bindJazzFiveFourLeadSlots(
  brick: LeadRhythmBrick,
  grammarTokens: readonly SemanticGrammarToken[],
): readonly BoundLeadToken[] {
  validateRhythmBrick(brick);
  validateGrammarTokens(grammarTokens);

  const attacks = brick.slots
    .filter((slot): slot is LeadRhythmSlot & { kind: 'attack' } => slot.kind === 'attack')
    .map((slot) => ({ slot, absoluteCell: absoluteCellFor(brick, slot) }))
    .sort((left, right) => left.absoluteCell - right.absoluteCell || left.slot.slotId.localeCompare(right.slot.slotId));

  if (attacks.length !== grammarTokens.length) {
    throw new JazzFiveFourLeadBindingError(
      'TOKEN_COUNT_MISMATCH',
      `Lead rhythm ${brick.id} has ${attacks.length} attack slots but grammar supplied ${grammarTokens.length} audible tokens`,
      Object.freeze({
        strategy: 'redraw-semantic-grammar',
        expectedAudibleTokenCount: attacks.length,
        receivedAudibleTokenCount: grammarTokens.length,
        maxAttempts: JAZZ_FIVE_FOUR_LEAD_MAX_GRAMMAR_REDRAWS,
      }),
    );
  }

  return Object.freeze(attacks.map(({ slot, absoluteCell }, index) => {
    const token = grammarTokens[index]!;
    const nominalTick = absoluteCell * JAZZ_FIVE_FOUR_LEAD_CELL_TICKS;
    return Object.freeze({
      eventId: `j54-lead:${brick.id}:${slot.slotId}`,
      slotId: slot.slotId,
      grammarTokenId: token.tokenId,
      absoluteCell,
      nominalTick,
      gateCells: slot.gateCells,
      nominalDurationTicks: slot.gateCells * JAZZ_FIVE_FOUR_LEAD_CELL_TICKS,
      referenceResidualTicks: slot.referenceResidualTicks ?? 0,
      accent: slot.accent,
      cadence: slot.cadence,
      semanticAtom: token.semanticAtom,
      rulePath: Object.freeze([...token.rulePath]),
      chordSpanId: token.chordSpanId,
    });
  }));
}
