// ============================================================
// newEngine · knowledge · LOFI Lead RoadMap / brick texture law
// ------------------------------------------------------------
// Arranger-authored Lead bricks select a texture lane from the existing
// LOFI_ENRICHED_GRAMMAR corpus before Harmony exists.  Harmony may later
// resolve that lane to one compatible source rule, but may not substitute a
// different phrase role or invent a renderer-owned lick.
// ============================================================

import type { AbstractMelodyToken, GrammarRule } from './melodyGrammarTypes';
import type { LofiGrammarTag } from './melodyLofiGrammarTags';
import type { LofiLeadGrammarRole } from './lofiLeadGrammarBank';
import type { LofiLeadPhraseRole } from './lofiLeadPhraseBlueprints';

export type LofiLeadRoadMapBrickKind =
  | 'silence-bed'
  | 'motif-statement'
  | 'motif-variation'
  | 'motif-return';

export interface LofiLeadRoadMapBrick {
  readonly id: string;
  readonly sectionId: string;
  readonly absoluteBar: number;
  readonly barInSection: number;
  readonly startBeat: number;
  readonly durationBeats: number;
  readonly phraseId?: string;
  readonly motifId?: string;
  readonly phraseRole: LofiLeadPhraseRole;
  readonly brickKind: LofiLeadRoadMapBrickKind;
  readonly grammarRole: LofiLeadGrammarRole;
  /**
   * Ordered by Arranger.  The post-harmony compiler takes the first lane with
   * a source rule compatible with the actual harmonic brick.
   */
  readonly textureTagPriority: readonly LofiGrammarTag[];
  /**
   * Arranger-owned deterministic choice within the compatible source-rule
   * set.  The compiler uses modulo; it never opens a new RNG stream.
   */
  readonly sourceRuleOrdinal: number;
}

export interface LofiLeadRoadMapPlan {
  readonly cycleBars: number;
  readonly sourceTextureCorpus: 'LOFI_ENRICHED_GRAMMAR';
  readonly bricks: readonly LofiLeadRoadMapBrick[];
  readonly brickIdByAbsoluteBar: Readonly<Record<string, string>>;
}

export interface LofiLeadBrickTextureProjection {
  readonly leadingRestRatio: number;
  readonly durationScaleByEvent: readonly number[];
  readonly harmonicKindByEvent: readonly ('stable' | 'moving' | 'color')[];
  readonly terminalHoldScale: number;
}

export interface CompiledLofiLeadRoadMapBrick {
  readonly arrangerBrickId: string;
  readonly sectionId: string;
  readonly absoluteBar: number;
  readonly phraseRole: LofiLeadPhraseRole;
  readonly brickKind: LofiLeadRoadMapBrickKind;
  readonly grammarRole: LofiLeadGrammarRole;
  readonly harmonicBrickIndices: readonly number[];
  readonly resolvedTextureTag: LofiGrammarTag;
  readonly sourceResolution:
    | 'explicit-rest'
    | 'exact-harmonic-brick'
    | 'harmonic-family'
    | 'texture-projection';
  readonly sourceGrammarRuleId?: string;
  readonly sourceGrammarBrickType?: string;
  readonly textureProjection: LofiLeadBrickTextureProjection;
}

export const LOFI_LEAD_TEXTURE_TAGS_BY_PHRASE_ROLE: Readonly<
  Record<LofiLeadPhraseRole, readonly LofiGrammarTag[]>
> = {
  rest: ['lofi_rest_space'],
  statement: ['lofi_hold_answer', 'lofi_color_hold', 'lofi_crawl_hold'],
  variation: ['lofi_parallel_answer', 'lofi_crawl_hold', 'lofi_hold_answer'],
  return: ['lofi_soft_cadence', 'lofi_hold_answer', 'lofi_color_hold'],
};

export function lofiLeadGrammarRoleForPhraseRole(
  role: LofiLeadPhraseRole,
): LofiLeadGrammarRole {
  switch (role) {
    case 'rest': return 'release';
    case 'statement': return 'statement-carrier';
    case 'variation': return 'answer-riff';
    case 'return': return 'return-hold';
  }
}

export function lofiLeadRoadMapBrickKindForPhraseRole(
  role: LofiLeadPhraseRole,
): LofiLeadRoadMapBrickKind {
  switch (role) {
    case 'rest': return 'silence-bed';
    case 'statement': return 'motif-statement';
    case 'variation': return 'motif-variation';
    case 'return': return 'motif-return';
  }
}

/**
 * Rotate, rather than shuffle, the semantic priority list.  This varies the
 * exact LOFI surface while preserving role meaning and deterministic fallback.
 */
export function rotateLofiLeadTexturePriority(
  role: LofiLeadPhraseRole,
  offset: number,
): readonly LofiGrammarTag[] {
  const source = LOFI_LEAD_TEXTURE_TAGS_BY_PHRASE_ROLE[role];
  if (source.length < 2) return [...source];
  const normalized = ((Math.trunc(offset) % source.length) + source.length) % source.length;
  return [...source.slice(normalized), ...source.slice(0, normalized)];
}

/**
 * Extract the part of an existing grammar rule that the motif compiler can
 * safely consume without copying the rule as a fixed lick.  Rhythm ratios,
 * color/stable motion and terminal sustain all come from the selected corpus
 * rule; motif identity and concrete pitch remain Arranger/Harmony-owned.
 */
export function projectLofiLeadGrammarRule(
  rule: GrammarRule | undefined,
): LofiLeadBrickTextureProjection {
  if (!rule) {
    return {
      leadingRestRatio: 0,
      durationScaleByEvent: [1],
      harmonicKindByEvent: ['stable'],
      terminalHoldScale: 1,
    };
  }

  const tokens = rule.rhs.filter(
    (item): item is AbstractMelodyToken => typeof item !== 'string' && item.duration > 0,
  );
  const totalDuration = tokens.reduce((sum, token) => sum + token.duration, 0);
  let leadingRestDuration = 0;
  for (const token of tokens) {
    if (token.kind !== 'R') break;
    leadingRestDuration += token.duration;
  }
  const audible = tokens.filter((token) => token.kind !== 'R');
  const meanDuration = audible.length > 0
    ? audible.reduce((sum, token) => sum + token.duration, 0) / audible.length
    : 1;
  const durationScaleByEvent = audible.length > 0
    ? audible.map((token) => clamp(token.duration / Math.max(0.01, meanDuration), 0.72, 1.35))
    : [1];
  const harmonicKindByEvent = audible.length > 0
    ? audible.map((token): 'stable' | 'moving' | 'color' => {
      if (token.kind === 'L' || token.kind === 'H') return 'color';
      if (token.kind === 'C' || token.kind === 'G' || token.kind === 'B') return 'stable';
      return 'moving';
    })
    : ['stable' as const];
  const lastAudibleDuration = audible[audible.length - 1]?.duration ?? meanDuration;

  return {
    leadingRestRatio: totalDuration > 0
      ? clamp(leadingRestDuration / totalDuration, 0, 0.375)
      : 0,
    durationScaleByEvent,
    harmonicKindByEvent,
    terminalHoldScale: clamp(lastAudibleDuration / Math.max(0.01, meanDuration), 1, 1.5),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
