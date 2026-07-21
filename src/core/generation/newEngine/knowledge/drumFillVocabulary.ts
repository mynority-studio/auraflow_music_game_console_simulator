// ============================================================
// newEngine · knowledge · Drum Fill Vocabulary
// ------------------------------------------------------------
// Jeff Randall's "60 Must-Know Drum Fills" organizes practical rock fills
// around three reusable 16th-note ideas: continuous, broken and syncopated.
// We keep that grammar instead of copying fixed licks: 15 rhythm cells x four
// kit orchestrations = 60 playable POP/Rock recipes.
// ============================================================

export const POP_ROCK_FILL_VOCABULARY_ID = 'pop-rock-60-v1' as const;

export type GrooveDrumFillVocabularyId = typeof POP_ROCK_FILL_VOCABULARY_ID;
export type GrooveDrumFillRhythmClass =
  | 'straight-sixteenth'
  | 'broken-sixteenth'
  | 'syncopated-sixteenth';
export type GrooveDrumFillOrchestration =
  | 'snare'
  | 'snare-tom-cascade'
  | 'descending-toms'
  | 'linear-hand-foot';
export type GrooveDrumFillFunction =
  | 'opening'
  | 'continuation'
  | 'setup'
  | 'lift'
  | 'climax'
  | 'release';
export type GrooveDrumFillVoice = 'kick' | 'snare' | 'tom-high' | 'tom-mid' | 'tom-low';

export interface GrooveDrumFillHitScore {
  /** Negative beat offset from the following bar's downbeat. */
  offsetBeatsFromEnd: number;
  voice: GrooveDrumFillVoice;
  velocity: number;
}

export interface GrooveDrumFillScore {
  vocabularyId: GrooveDrumFillVocabularyId;
  recipeId: string;
  function: GrooveDrumFillFunction;
  rhythmClass: GrooveDrumFillRhythmClass;
  orchestration: GrooveDrumFillOrchestration;
  hits: readonly GrooveDrumFillHitScore[];
}

interface RhythmCell {
  id: string;
  rhythmClass: GrooveDrumFillRhythmClass;
  /** Attacks on a two-beat 16th-note grid, 0..7. */
  steps: readonly number[];
  /** Per-grid-slot dynamic contour. */
  accents: readonly number[];
}

const ALL_STEPS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

const RHYTHM_CELLS: readonly RhythmCell[] = [
  { id: 'straight-primary', rhythmClass: 'straight-sixteenth', steps: ALL_STEPS, accents: [1, 0.72, 0.80, 0.72, 0.92, 0.74, 0.84, 1.08] },
  { id: 'straight-two-note', rhythmClass: 'straight-sixteenth', steps: ALL_STEPS, accents: [1, 0.68, 0.88, 0.70, 0.98, 0.70, 0.90, 1.06] },
  { id: 'straight-332', rhythmClass: 'straight-sixteenth', steps: ALL_STEPS, accents: [1, 0.70, 0.70, 0.96, 0.70, 0.70, 0.94, 1.08] },
  { id: 'straight-crescendo', rhythmClass: 'straight-sixteenth', steps: ALL_STEPS, accents: [0.80, 0.84, 0.88, 0.92, 0.96, 1, 1.05, 1.12] },
  { id: 'straight-backbeat', rhythmClass: 'straight-sixteenth', steps: ALL_STEPS, accents: [1.04, 0.76, 0.86, 0.76, 1, 0.80, 0.90, 1.08] },

  { id: 'broken-gap-four', rhythmClass: 'broken-sixteenth', steps: [0, 1, 2, 4, 5, 6, 7], accents: [1, 0.74, 0.84, 0.62, 0.94, 0.76, 0.88, 1.08] },
  { id: 'broken-gap-two-six', rhythmClass: 'broken-sixteenth', steps: [0, 2, 3, 4, 6, 7], accents: [1, 0.62, 0.86, 0.76, 0.96, 0.62, 0.90, 1.08] },
  { id: 'broken-answer', rhythmClass: 'broken-sixteenth', steps: [0, 1, 3, 4, 5, 7], accents: [1, 0.74, 0.62, 0.88, 0.96, 0.78, 0.62, 1.10] },
  { id: 'broken-space', rhythmClass: 'broken-sixteenth', steps: [0, 2, 4, 5, 6, 7], accents: [1, 0.62, 0.86, 0.62, 0.96, 0.78, 0.88, 1.08] },
  { id: 'broken-late-push', rhythmClass: 'broken-sixteenth', steps: [0, 1, 2, 4, 6, 7], accents: [0.96, 0.72, 0.82, 0.62, 0.92, 0.62, 0.94, 1.12] },

  { id: 'sync-e-and-a', rhythmClass: 'syncopated-sixteenth', steps: [1, 3, 4, 6, 7], accents: [0.62, 0.92, 0.62, 1, 0.86, 0.62, 0.96, 1.10] },
  { id: 'sync-and-a', rhythmClass: 'syncopated-sixteenth', steps: [0, 2, 3, 5, 6, 7], accents: [0.94, 0.62, 0.90, 1.02, 0.62, 0.92, 0.98, 1.10] },
  { id: 'sync-displaced-332', rhythmClass: 'syncopated-sixteenth', steps: [1, 2, 4, 5, 7], accents: [0.62, 0.94, 0.82, 0.62, 0.96, 0.88, 0.62, 1.12] },
  { id: 'sync-quarter-anticipation', rhythmClass: 'syncopated-sixteenth', steps: [0, 3, 4, 6, 7], accents: [0.96, 0.62, 0.62, 1, 0.90, 0.62, 0.96, 1.10] },
  { id: 'sync-late-chain', rhythmClass: 'syncopated-sixteenth', steps: [1, 3, 5, 6, 7], accents: [0.62, 0.90, 0.62, 0.96, 0.62, 0.92, 1, 1.12] },
] as const;

export const POP_ROCK_FILL_ORCHESTRATIONS = [
  'snare',
  'snare-tom-cascade',
  'descending-toms',
  'linear-hand-foot',
] as const satisfies readonly GrooveDrumFillOrchestration[];

export interface PopRockFillRecipeDescriptor {
  recipeId: string;
  rhythmClass: GrooveDrumFillRhythmClass;
  orchestration: GrooveDrumFillOrchestration;
}

export function popRockFillRecipeDescriptors(): PopRockFillRecipeDescriptor[] {
  return RHYTHM_CELLS.flatMap((cell) => POP_ROCK_FILL_ORCHESTRATIONS.map((orchestration) => ({
    recipeId: `${POP_ROCK_FILL_VOCABULARY_ID}:${cell.id}:${orchestration}`,
    rhythmClass: cell.rhythmClass,
    orchestration,
  })));
}

/** Canonical class for reporting/fallback; functional materialization may use a bounded alternate. */
export function popRockRhythmClassForFunction(fn: GrooveDrumFillFunction): GrooveDrumFillRhythmClass {
  if (fn === 'opening' || fn === 'setup') return 'straight-sixteenth';
  if (fn === 'climax') return 'syncopated-sixteenth';
  return 'broken-sixteenth';
}

interface PopRockFillCombination {
  rhythmClass: GrooveDrumFillRhythmClass;
  orchestration: GrooveDrumFillOrchestration;
}

const combinations = (
  rhythmClasses: readonly GrooveDrumFillRhythmClass[],
  orchestrations: readonly GrooveDrumFillOrchestration[],
): PopRockFillCombination[] => rhythmClasses.flatMap((rhythmClass) =>
  orchestrations.map((orchestration) => ({ rhythmClass, orchestration })));

/**
 * Function first, variation second. Opening keeps an audible tom pickup and a
 * climax keeps its linear hand/foot peak. Setup + continuation jointly expose
 * the complete 3 x 4 recipe surface without making those two signatures vague.
 */
export function popRockFillCombinationsForFunction(
  fn: GrooveDrumFillFunction,
): readonly PopRockFillCombination[] {
  if (fn === 'opening') {
    return combinations(['straight-sixteenth'], ['snare-tom-cascade', 'descending-toms']);
  }
  if (fn === 'setup') return combinations(['straight-sixteenth'], POP_ROCK_FILL_ORCHESTRATIONS);
  if (fn === 'lift') {
    return combinations(['straight-sixteenth', 'broken-sixteenth'], POP_ROCK_FILL_ORCHESTRATIONS);
  }
  if (fn === 'climax') return combinations(['syncopated-sixteenth'], ['linear-hand-foot']);
  if (fn === 'release') {
    return combinations(['broken-sixteenth'], ['snare', 'snare-tom-cascade']);
  }
  return combinations(['broken-sixteenth', 'syncopated-sixteenth'], POP_ROCK_FILL_ORCHESTRATIONS);
}

function clampVelocity(value: number): number {
  return Math.max(38, Math.min(118, Math.round(value)));
}

function voiceFor(
  orchestration: GrooveDrumFillOrchestration,
  index: number,
  total: number,
): GrooveDrumFillVoice {
  if (orchestration === 'snare') return 'snare';
  const progress = total <= 1 ? 1 : index / (total - 1);
  if (orchestration === 'snare-tom-cascade') {
    if (progress < 0.4) return 'snare';
    if (progress < 0.64) return 'tom-high';
    if (progress < 0.84) return 'tom-mid';
    return 'tom-low';
  }
  if (orchestration === 'descending-toms') {
    if (progress < 0.3) return 'tom-high';
    if (progress < 0.64) return 'tom-mid';
    return 'tom-low';
  }
  if (index === total - 1) return 'tom-low';
  if (index % 3 === 1) return 'kick';
  if (progress < 0.34) return 'snare';
  if (progress < 0.67) return 'tom-high';
  return 'tom-mid';
}

function functionContour(fn: GrooveDrumFillFunction, progress: number): number {
  if (fn === 'climax') return 0.86 + progress * 0.24;
  if (fn === 'lift' || fn === 'setup' || fn === 'opening') return 0.92 + progress * 0.16;
  if (fn === 'release') return 1 - progress * 0.08;
  return 0.92 + progress * 0.06;
}

export interface MaterializePopRockFillOptions {
  rhythmClass: GrooveDrumFillRhythmClass;
  orchestration: GrooveDrumFillOrchestration;
  function: GrooveDrumFillFunction;
  variant: number;
  durationBeats: number;
  intensity: 1 | 2 | 3;
}

export function materializePopRockFill(options: MaterializePopRockFillOptions): GrooveDrumFillScore {
  const cells = RHYTHM_CELLS.filter((cell) => cell.rhythmClass === options.rhythmClass);
  const cell = cells[((options.variant % cells.length) + cells.length) % cells.length];
  const slotCount = Math.max(2, Math.min(8, Math.round(options.durationBeats * 4)));
  const firstSlot = 8 - slotCount;
  const selected = cell.steps.filter((step) => step >= firstSlot);
  const baseVelocity = options.intensity === 3 ? 90 : options.intensity === 2 ? 78 : 66;
  const hits = selected.map((step, index): GrooveDrumFillHitScore => {
    const progress = selected.length <= 1 ? 1 : index / (selected.length - 1);
    return {
      offsetBeatsFromEnd: (step - 8) * 0.25,
      voice: voiceFor(options.orchestration, index, selected.length),
      velocity: clampVelocity(baseVelocity * (cell.accents[step] ?? 1) * functionContour(options.function, progress)),
    };
  });
  return {
    vocabularyId: POP_ROCK_FILL_VOCABULARY_ID,
    recipeId: `${POP_ROCK_FILL_VOCABULARY_ID}:${cell.id}:${options.orchestration}`,
    function: options.function,
    rhythmClass: options.rhythmClass,
    orchestration: options.orchestration,
    hits,
  };
}

export interface MaterializeFunctionalPopRockFillOptions {
  function: GrooveDrumFillFunction;
  variant: number;
  durationBeats: number;
  intensity: 1 | 2 | 3;
}

export function materializeFunctionalPopRockFill(
  options: MaterializeFunctionalPopRockFillOptions,
): GrooveDrumFillScore {
  const normalizedVariant = Math.abs(Math.trunc(options.variant));
  const candidates = popRockFillCombinationsForFunction(options.function);
  const selected = candidates[normalizedVariant % candidates.length];
  const cellVariant = Math.floor(normalizedVariant / candidates.length);
  return materializePopRockFill({
    rhythmClass: selected.rhythmClass,
    orchestration: selected.orchestration,
    function: options.function,
    variant: cellVariant,
    durationBeats: options.durationBeats,
    intensity: options.intensity,
  });
}
