// ============================================================
// newEngine · knowledge · LOFI Lead Phrase Blueprints
// ------------------------------------------------------------
// Song-level LOFI melodic syntax. These are abstract phrase grammars, not
// reference-track transcriptions: each blueprint binds ensemble ownership,
// an eight-bar presence sentence and one compact interval/rhythm cell.
// Harmony and register are deliberately unresolved here.
// ============================================================

import type { LofiFoundationArchetypeId } from './lofiFoundationArchetypes';

export type LofiMelodicCarrier =
  | 'comp-top-voice'
  | 'dedicated-lead'
  | 'shared-call-response';

export type LofiLeadMode =
  | 'silent'
  | 'hook'
  | 'counter'
  | 'phrase-tag'
  | 'floating-hold';

export type LofiLeadPhraseRole = 'rest' | 'statement' | 'variation' | 'return';

export type LofiLeadMotifHarmonicRole =
  | 'anchor'
  | 'neighbor'
  | 'passing'
  | 'color'
  | 'terminal';

export type LofiLeadVariationTransform =
  | 'delay-tail'
  | 'omit-middle'
  | 'neighbor-tail';

export type LofiLeadReturnTransform =
  | 'exact'
  | 'terminal-hold'
  | 'last-note-tag';

export type LofiLeadScoreTransform =
  | 'statement'
  | LofiLeadVariationTransform
  | LofiLeadReturnTransform;

export interface LofiLeadMotifCellEvent {
  /** Relative to the owning bar in quarter-note beats. */
  readonly offsetBeat: number;
  readonly durationBeats: number;
  /**
   * Diatonic direction from the preceding cell event. The first event uses
   * zero and receives its concrete anchor from the post-harmony score writer.
   */
  readonly diatonicStepFromPrevious: number;
  readonly harmonicRole: LofiLeadMotifHarmonicRole;
  /** Authorizes a stable common tone to remain held into the next span. */
  readonly sustainPolicy?: 'current-span' | 'common-tone';
}

export interface LofiLeadMotifCell {
  readonly id: string;
  readonly events: readonly LofiLeadMotifCellEvent[];
  readonly variationTransform: LofiLeadVariationTransform;
  readonly returnTransform: LofiLeadReturnTransform;
}

export interface LofiLeadPhraseBlueprint {
  readonly id:
    | 'lofi-lead-late-answer-hook'
    | 'lofi-lead-two-bar-pocket'
    | 'lofi-lead-punctuation-tags'
    | 'lofi-lead-floating-hold';
  readonly cycleBars: 8;
  readonly primaryCarrier: LofiMelodicCarrier;
  readonly leadMode: LofiLeadMode;
  /**
   * Requested Comp space. Instrumentation consumes this before choosing an
   * exact texture so Lead and Comp cannot independently claim the melody.
   */
  readonly requiredCompMelodySpace: 'high' | 'medium' | 'any';
  readonly roleByCycleBar: readonly LofiLeadPhraseRole[];
  readonly motifCell: LofiLeadMotifCell;
  readonly weightsByFoundation: Readonly<Record<LofiFoundationArchetypeId, number>>;
}

export interface LofiLeadRoleEvent {
  readonly sourceEventIndex: number;
  readonly event: LofiLeadMotifCellEvent;
  readonly transform: LofiLeadScoreTransform;
}

const allFoundationWeights = (
  slowSoul: number,
  dustyDilla: number,
  halftime: number,
  ambient: number,
): Readonly<Record<LofiFoundationArchetypeId, number>> => ({
  'slow-soul-boombap': slowSoul,
  'dusty-dilla-boombap': dustyDilla,
  'slow-soul-halftime': halftime,
  'ambient-study-boombap': ambient,
});

const SOUL_SIGH_CELL: LofiLeadMotifCell = {
  id: 'lofi-motif-soul-sigh-3',
  events: [
    { offsetBeat: 0.5, durationBeats: 0.5, diatonicStepFromPrevious: 0, harmonicRole: 'anchor' },
    { offsetBeat: 1.25, durationBeats: 0.5, diatonicStepFromPrevious: 1, harmonicRole: 'neighbor' },
    { offsetBeat: 2, durationBeats: 1.5, diatonicStepFromPrevious: -1, harmonicRole: 'terminal' },
  ],
  variationTransform: 'delay-tail',
  returnTransform: 'terminal-hold',
};

const POCKET_REPLY_CELL: LofiLeadMotifCell = {
  id: 'lofi-motif-pocket-reply-3',
  events: [
    { offsetBeat: 1, durationBeats: 0.5, diatonicStepFromPrevious: 0, harmonicRole: 'anchor' },
    { offsetBeat: 1.75, durationBeats: 0.5, diatonicStepFromPrevious: -1, harmonicRole: 'passing' },
    { offsetBeat: 2.5, durationBeats: 1, diatonicStepFromPrevious: 1, harmonicRole: 'terminal' },
  ],
  variationTransform: 'neighbor-tail',
  returnTransform: 'exact',
};

const TWO_NOTE_TAG_CELL: LofiLeadMotifCell = {
  id: 'lofi-motif-two-note-tag',
  events: [
    { offsetBeat: 1.5, durationBeats: 0.5, diatonicStepFromPrevious: 0, harmonicRole: 'anchor' },
    { offsetBeat: 2.25, durationBeats: 1.25, diatonicStepFromPrevious: -1, harmonicRole: 'terminal' },
  ],
  variationTransform: 'delay-tail',
  returnTransform: 'last-note-tag',
};

const FLOATING_COMMON_TONE_CELL: LofiLeadMotifCell = {
  id: 'lofi-motif-floating-common-tone',
  events: [
    {
      offsetBeat: 0.5,
      durationBeats: 2,
      diatonicStepFromPrevious: 0,
      harmonicRole: 'anchor',
      sustainPolicy: 'common-tone',
    },
    { offsetBeat: 2.75, durationBeats: 0.75, diatonicStepFromPrevious: -1, harmonicRole: 'terminal' },
  ],
  variationTransform: 'neighbor-tail',
  returnTransform: 'terminal-hold',
};

export const LOFI_LEAD_PHRASE_BLUEPRINTS: readonly LofiLeadPhraseBlueprint[] = [
  {
    id: 'lofi-lead-late-answer-hook',
    cycleBars: 8,
    primaryCarrier: 'dedicated-lead',
    leadMode: 'hook',
    requiredCompMelodySpace: 'high',
    roleByCycleBar: ['rest', 'rest', 'rest', 'rest', 'statement', 'variation', 'rest', 'return'],
    motifCell: SOUL_SIGH_CELL,
    weightsByFoundation: allFoundationWeights(4, 2, 2, 1),
  },
  {
    id: 'lofi-lead-two-bar-pocket',
    cycleBars: 8,
    primaryCarrier: 'dedicated-lead',
    leadMode: 'hook',
    requiredCompMelodySpace: 'high',
    roleByCycleBar: ['rest', 'rest', 'rest', 'rest', 'statement', 'rest', 'variation', 'return'],
    motifCell: POCKET_REPLY_CELL,
    weightsByFoundation: allFoundationWeights(3, 4, 1, 1),
  },
  {
    id: 'lofi-lead-punctuation-tags',
    cycleBars: 8,
    primaryCarrier: 'shared-call-response',
    leadMode: 'phrase-tag',
    requiredCompMelodySpace: 'medium',
    roleByCycleBar: ['rest', 'rest', 'rest', 'rest', 'statement', 'rest', 'variation', 'return'],
    motifCell: TWO_NOTE_TAG_CELL,
    weightsByFoundation: allFoundationWeights(2, 3, 2, 3),
  },
  {
    id: 'lofi-lead-floating-hold',
    cycleBars: 8,
    primaryCarrier: 'shared-call-response',
    leadMode: 'floating-hold',
    requiredCompMelodySpace: 'any',
    roleByCycleBar: ['rest', 'rest', 'rest', 'rest', 'statement', 'rest', 'variation', 'return'],
    motifCell: FLOATING_COMMON_TONE_CELL,
    weightsByFoundation: allFoundationWeights(1, 1, 4, 4),
  },
] as const;

export function lofiLeadPhraseBlueprintById(
  id: LofiLeadPhraseBlueprint['id'],
): LofiLeadPhraseBlueprint {
  const blueprint = LOFI_LEAD_PHRASE_BLUEPRINTS.find((candidate) => candidate.id === id);
  if (!blueprint) throw new Error(`Unknown LOFI lead phrase blueprint: ${id}`);
  return blueprint;
}

function copyEvent(event: LofiLeadMotifCellEvent): LofiLeadMotifCellEvent {
  return { ...event };
}

/** Return one detached, serializable blueprint snapshot for ArrangementPlan. */
export function copyLofiLeadPhraseBlueprint(
  source: LofiLeadPhraseBlueprint,
): LofiLeadPhraseBlueprint {
  return {
    ...source,
    roleByCycleBar: [...source.roleByCycleBar],
    motifCell: {
      ...source.motifCell,
      events: source.motifCell.events.map(copyEvent),
    },
    weightsByFoundation: { ...source.weightsByFoundation },
  };
}

/**
 * Project the song-level motif cell into one phrase role. Only one dimension
 * changes at a time, keeping the source-event identity visible to audits.
 */
export function lofiLeadEventsForRole(
  blueprint: LofiLeadPhraseBlueprint,
  role: Exclude<LofiLeadPhraseRole, 'rest'>,
): LofiLeadRoleEvent[] {
  const source = blueprint.motifCell.events;
  if (role === 'statement') {
    return source.map((event, sourceEventIndex) => ({
      sourceEventIndex,
      event: copyEvent(event),
      transform: 'statement',
    }));
  }

  if (role === 'variation') {
    const transform = blueprint.motifCell.variationTransform;
    if (transform === 'omit-middle' && source.length > 2) {
      const middle = Math.floor(source.length / 2);
      return source
        .filter((_, index) => index !== middle)
        .map((event, filteredIndex) => {
          const sourceEventIndex = filteredIndex >= middle ? filteredIndex + 1 : filteredIndex;
          return { sourceEventIndex, event: copyEvent(event), transform };
        });
    }
    return source.map((event, sourceEventIndex) => {
      if (sourceEventIndex !== source.length - 1) {
        return { sourceEventIndex, event: copyEvent(event), transform };
      }
      if (transform === 'delay-tail') {
        return {
          sourceEventIndex,
          event: { ...event, offsetBeat: event.offsetBeat + 0.25 },
          transform,
        };
      }
      return {
        sourceEventIndex,
        event: {
          ...event,
          diatonicStepFromPrevious: event.diatonicStepFromPrevious === 0
            ? -1
            : -event.diatonicStepFromPrevious,
        },
        transform,
      };
    });
  }

  const transform = blueprint.motifCell.returnTransform;
  if (transform === 'exact') {
    return source.map((event, sourceEventIndex) => ({
      sourceEventIndex,
      event: copyEvent(event),
      transform,
    }));
  }
  if (transform === 'last-note-tag') {
    const sourceEventIndex = source.length - 1;
    const event = source[sourceEventIndex]!;
    return [{
      sourceEventIndex,
      event: { ...event, durationBeats: Math.max(1.5, event.durationBeats) },
      transform,
    }];
  }
  const firstIndex = 0;
  const lastIndex = source.length - 1;
  return [...new Set([firstIndex, lastIndex])].map((sourceEventIndex) => {
    const event = source[sourceEventIndex]!;
    return {
      sourceEventIndex,
      event: sourceEventIndex === lastIndex
        ? { ...event, durationBeats: Math.max(2, event.durationBeats) }
        : copyEvent(event),
      transform,
    };
  });
}
