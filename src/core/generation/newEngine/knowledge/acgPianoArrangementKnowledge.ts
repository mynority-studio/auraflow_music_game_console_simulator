// ============================================================
// newEngine · knowledge · ACG piano arrangement
// ------------------------------------------------------------
// This is score-writing knowledge, not a texture bank and not a NoteIR repair
// pass.  It tells the Arranger how one physical piano is represented by the
// existing bass / comp / lead tracks:
//   bass = low foundation, comp = middle harmony, lead = top melody.
// ============================================================

import type { AcgPianoSongGrammarSubset } from './melodyStyleGrammarProfiles';

export type AcgPianoKnowledgePhase =
  | 'opening'
  | 'statement'
  | 'development'
  | 'lift'
  | 'return'
  | 'coda';

export type AcgPianoCompSurfaceIntent =
  | 'tacet'
  | 'pedal-hold'
  | 'arp-up'
  | 'arp-down'
  | 'broken-wave'
  | 'rolled-block'
  | 'block'
  | 'answer-dyad'
  | 'pulse';

export type AcgPianoCompSurfaceFamily =
  | 'broken-motion'
  | 'vertical'
  | 'pulse'
  | 'air'
  | 'answer';

export type AcgPianoOpeningKnowledgeId =
  | 'direct-theme'
  | 'call-and-answer'
  | 'pedal-prelude'
  | 'wide-prelude'
  | 'falling-pickup';

export type AcgPianoOrchestrationSceneId =
  | 'opening-seed'
  | 'theme-underlay'
  | 'lead-breath-answer'
  | 'development-motion'
  | 'lift'
  | 'arrival'
  | 'coda-release';

export type AcgPianoKnowledgeBassMotion =
  | 'pedal'
  | 'ripple'
  | 'open-tenth'
  | 'stride'
  | 'root-anchor';

type AcgPianoKnowledgeLeadGrammar = Exclude<AcgPianoSongGrammarSubset, 'all'>;

export interface AcgPianoFormKnowledge {
  /** A normal ACG piano cue either enters directly or states its seed in four bars. */
  defaultIntroBars: number;
  maxIntroBars: number;
  /** Intro may never consume more than this share of a duration-aware cue. */
  maxIntroShare: number;
  /** The first theme must have started by this bar boundary. */
  themeEntryDeadlineBars: number;
  minThemeStatementBars: number;
  preferredThemeStatementBars: number;
  /** Extra duration becomes audible development, never more prelude. */
  maxDevelopmentBars: number;
  overflowPriority: readonly ('theme' | 'development' | 'lift')[];
}

export interface AcgPianoOpeningKnowledge {
  id: AcgPianoOpeningKnowledgeId;
  /** Existing COMP gestures, ordered as one middle-register opening sentence. */
  compSurfaceCycle: readonly AcgPianoCompSurfaceIntent[];
  leadEntryPolicy: 'immediate' | 'after-short-call';
}

/**
 * Shared-clock knowledge consumed by PianoScorePlan before any hand is
 * realized.  These are score-writing limits, not a final MIDI quantizer.
 */
export interface AcgPianoMetricKnowledge {
  subdivisionBeats: number;
  expressiveOffsetLimitBeats: number;
  compEntryLimitBeats: number;
  rollSpreadLimitBeats: number;
  structuralAccentBase: number;
  structuralAccentRange: number;
  flowAccentBase: number;
  flowAccentRange: number;
  answerAccentScale: number;
}

export interface AcgPianoPhraseOrchestrationRule {
  id: AcgPianoOrchestrationSceneId;
  phases: readonly AcgPianoKnowledgePhase[];
  bass: {
    lane: 'low';
    rootAnchorRequired: true;
    allowedMotion: readonly AcgPianoKnowledgeBassMotion[];
    continuity: 'span-carrier' | 'articulated-foundation';
  };
  comp: {
    lane: 'middle';
    allowedSurfaceFamilies: readonly AcgPianoCompSurfaceFamily[];
    whenLeadActive: 'middle-underlay' | 'lower-shell';
    whenLeadRest: 'answer-window' | 'continue-underlay' | 'shared-rest';
    /** Full-span silence is exceptional; pedal-hold is still an audible underlay. */
    maxFullTacetSpansPerPhrase: number;
    maxConsecutiveFullTacetSpans: number;
    fullTacetFallback: Exclude<AcgPianoCompSurfaceIntent, 'tacet'>;
  };
  lead: {
    lane: 'top';
    role: 'motif-preview' | 'cantabile-carrier' | 'lift-line' | 'cadential-return';
    allowedGrammarSubsets: readonly AcgPianoKnowledgeLeadGrammar[];
  };
}

export const ACG_PIANO_FORM_KNOWLEDGE: Readonly<AcgPianoFormKnowledge> = Object.freeze({
  defaultIntroBars: 4,
  maxIntroBars: 4,
  maxIntroShare: 0.25,
  themeEntryDeadlineBars: 4,
  minThemeStatementBars: 4,
  preferredThemeStatementBars: 8,
  maxDevelopmentBars: 8,
  overflowPriority: ['theme', 'development', 'lift'] as const,
});

export const ACG_PIANO_METRIC_KNOWLEDGE: Readonly<AcgPianoMetricKnowledge> = Object.freeze({
  // ACG lead/COMP may still write a 16th-note pickup or flowing arpeggio;
  // the important contract is that all three hands name the same slots.
  subdivisionBeats: 0.25,
  // About 30 ms at 80 BPM: genuine touch, not a second rhythmic pulse.
  expressiveOffsetLimitBeats: 0.04,
  // Root-led middle notes may follow the bass by one quiet 32nd-like breath.
  compEntryLimitBeats: 0.125,
  // Complete roll width. Four voices no longer multiply a per-voice allowance.
  rollSpreadLimitBeats: 0.15,
  structuralAccentBase: 0.98,
  structuralAccentRange: 0.06,
  flowAccentBase: 0.84,
  flowAccentRange: 0.18,
  answerAccentScale: 0.94,
});

export const ACG_PIANO_OPENING_KNOWLEDGE: Readonly<
  Record<AcgPianoOpeningKnowledgeId, AcgPianoOpeningKnowledge>
> = Object.freeze({
  'direct-theme': {
    id: 'direct-theme',
    compSurfaceCycle: ['pulse', 'broken-wave', 'rolled-block'],
    leadEntryPolicy: 'immediate',
  },
  'call-and-answer': {
    id: 'call-and-answer',
    compSurfaceCycle: ['pedal-hold', 'arp-down', 'rolled-block'],
    leadEntryPolicy: 'after-short-call',
  },
  'pedal-prelude': {
    id: 'pedal-prelude',
    compSurfaceCycle: ['pedal-hold', 'arp-up', 'broken-wave', 'rolled-block'],
    leadEntryPolicy: 'after-short-call',
  },
  'wide-prelude': {
    id: 'wide-prelude',
    compSurfaceCycle: ['rolled-block', 'arp-up', 'broken-wave', 'rolled-block'],
    leadEntryPolicy: 'after-short-call',
  },
  'falling-pickup': {
    id: 'falling-pickup',
    compSurfaceCycle: ['arp-down', 'pedal-hold', 'broken-wave', 'rolled-block'],
    leadEntryPolicy: 'after-short-call',
  },
});

const ROOT_FOUNDATION = {
  lane: 'low',
  rootAnchorRequired: true,
  allowedMotion: ['pedal', 'ripple', 'open-tenth', 'stride', 'root-anchor'],
  continuity: 'span-carrier',
} as const;

export const ACG_PIANO_PHRASE_ORCHESTRATION_KNOWLEDGE: readonly AcgPianoPhraseOrchestrationRule[] =
  Object.freeze([
    {
      id: 'opening-seed',
      phases: ['opening'],
      bass: ROOT_FOUNDATION,
      comp: {
        lane: 'middle',
        allowedSurfaceFamilies: ['air', 'broken-motion', 'vertical', 'pulse'],
        whenLeadActive: 'middle-underlay',
        whenLeadRest: 'continue-underlay',
        maxFullTacetSpansPerPhrase: 0,
        maxConsecutiveFullTacetSpans: 0,
        fullTacetFallback: 'pedal-hold',
      },
      lead: {
        lane: 'top',
        role: 'motif-preview',
        allowedGrammarSubsets: ['intro-breath', 'cantabile-theme'],
      },
    },
    {
      id: 'theme-underlay',
      phases: ['statement', 'return'],
      bass: ROOT_FOUNDATION,
      comp: {
        lane: 'middle',
        allowedSurfaceFamilies: ['broken-motion', 'vertical', 'air', 'pulse'],
        whenLeadActive: 'middle-underlay',
        whenLeadRest: 'answer-window',
        maxFullTacetSpansPerPhrase: 0,
        maxConsecutiveFullTacetSpans: 0,
        fullTacetFallback: 'pedal-hold',
      },
      lead: {
        lane: 'top',
        role: 'cantabile-carrier',
        allowedGrammarSubsets: [
          'intro-breath', 'cantabile-theme', 'modal-color', 'cadential-return',
        ],
      },
    },
    {
      id: 'lead-breath-answer',
      phases: ['statement', 'development', 'lift', 'return'],
      bass: ROOT_FOUNDATION,
      comp: {
        lane: 'middle',
        allowedSurfaceFamilies: ['answer', 'broken-motion', 'air', 'vertical'],
        whenLeadActive: 'lower-shell',
        whenLeadRest: 'answer-window',
        maxFullTacetSpansPerPhrase: 0,
        maxConsecutiveFullTacetSpans: 0,
        fullTacetFallback: 'pedal-hold',
      },
      lead: {
        lane: 'top',
        role: 'cantabile-carrier',
        allowedGrammarSubsets: [
          'intro-breath', 'cantabile-theme', 'modal-color', 'ascending-lift', 'cadential-return',
        ],
      },
    },
    {
      id: 'development-motion',
      phases: ['development'],
      bass: {
        ...ROOT_FOUNDATION,
        continuity: 'articulated-foundation',
      },
      comp: {
        lane: 'middle',
        allowedSurfaceFamilies: ['broken-motion', 'pulse', 'vertical', 'air'],
        whenLeadActive: 'middle-underlay',
        whenLeadRest: 'answer-window',
        maxFullTacetSpansPerPhrase: 0,
        maxConsecutiveFullTacetSpans: 0,
        fullTacetFallback: 'pedal-hold',
      },
      lead: {
        lane: 'top',
        role: 'cantabile-carrier',
        allowedGrammarSubsets: [
          'cantabile-theme', 'modal-color', 'ascending-lift', 'cadential-return',
        ],
      },
    },
    {
      id: 'lift',
      phases: ['lift'],
      bass: {
        ...ROOT_FOUNDATION,
        continuity: 'articulated-foundation',
      },
      comp: {
        lane: 'middle',
        allowedSurfaceFamilies: ['broken-motion', 'pulse', 'vertical', 'air'],
        whenLeadActive: 'middle-underlay',
        whenLeadRest: 'answer-window',
        maxFullTacetSpansPerPhrase: 0,
        maxConsecutiveFullTacetSpans: 0,
        fullTacetFallback: 'pedal-hold',
      },
      lead: {
        lane: 'top',
        role: 'lift-line',
        allowedGrammarSubsets: ['ascending-lift', 'modal-color', 'cadential-return'],
      },
    },
    {
      id: 'arrival',
      phases: ['return'],
      bass: ROOT_FOUNDATION,
      comp: {
        lane: 'middle',
        allowedSurfaceFamilies: ['vertical', 'broken-motion', 'air', 'answer'],
        whenLeadActive: 'middle-underlay',
        whenLeadRest: 'answer-window',
        maxFullTacetSpansPerPhrase: 0,
        maxConsecutiveFullTacetSpans: 0,
        fullTacetFallback: 'pedal-hold',
      },
      lead: {
        lane: 'top',
        role: 'cadential-return',
        allowedGrammarSubsets: ['cadential-return', 'cantabile-theme', 'modal-color'],
      },
    },
    {
      id: 'coda-release',
      phases: ['coda'],
      bass: ROOT_FOUNDATION,
      comp: {
        lane: 'middle',
        allowedSurfaceFamilies: ['air', 'vertical', 'broken-motion'],
        whenLeadActive: 'lower-shell',
        whenLeadRest: 'shared-rest',
        maxFullTacetSpansPerPhrase: 2,
        maxConsecutiveFullTacetSpans: 2,
        fullTacetFallback: 'pedal-hold',
      },
      lead: {
        lane: 'top',
        role: 'cadential-return',
        allowedGrammarSubsets: ['intro-breath', 'cadential-return'],
      },
    },
  ]);

export function acgPianoOpeningKnowledgeFor(
  id: AcgPianoOpeningKnowledgeId,
): AcgPianoOpeningKnowledge {
  return ACG_PIANO_OPENING_KNOWLEDGE[id];
}

export function resolveAcgPianoOrchestrationScene(args: {
  phase: AcgPianoKnowledgePhase;
  hasLeadRest: boolean;
  cadenceTarget?: string;
}): AcgPianoPhraseOrchestrationRule {
  const sceneId: AcgPianoOrchestrationSceneId = args.phase === 'opening'
    ? 'opening-seed'
    : args.phase === 'coda'
      ? 'coda-release'
      : args.phase === 'lift'
        ? 'lift'
        : args.phase === 'return' && args.cadenceTarget !== 'open'
          ? 'arrival'
          : args.hasLeadRest
            ? 'lead-breath-answer'
            : args.phase === 'development'
              ? 'development-motion'
              : 'theme-underlay';
  return ACG_PIANO_PHRASE_ORCHESTRATION_KNOWLEDGE.find((rule) => rule.id === sceneId)!;
}

export function acgPianoOrchestrationSceneForId(
  id: AcgPianoOrchestrationSceneId,
): AcgPianoPhraseOrchestrationRule {
  return ACG_PIANO_PHRASE_ORCHESTRATION_KNOWLEDGE.find((rule) => rule.id === id)!;
}
