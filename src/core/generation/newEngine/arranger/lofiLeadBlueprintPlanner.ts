import type { RandomContext } from '../foundation';
import {
  copyLofiLeadPhraseBlueprint,
  LOFI_LEAD_PHRASE_BLUEPRINTS,
  type LofiLeadPhraseBlueprint,
} from '../knowledge/lofiLeadPhraseBlueprints';
import type { LofiFoundationArchetypeId } from '../knowledge/lofiFoundationArchetypes';

function weightedPick(
  candidates: readonly LofiLeadPhraseBlueprint[],
  foundationArchetypeId: LofiFoundationArchetypeId,
  randomValue: number,
): LofiLeadPhraseBlueprint {
  const total = candidates.reduce(
    (sum, candidate) => sum + Math.max(0, candidate.weightsByFoundation[foundationArchetypeId]),
    0,
  );
  if (total <= 0) return candidates[0]!;
  let cursor = Math.min(0.999999999999, Math.max(0, randomValue)) * total;
  for (const candidate of candidates) {
    cursor -= Math.max(0, candidate.weightsByFoundation[foundationArchetypeId]);
    if (cursor < 0) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

/**
 * Select one song-level melodic sentence before Lead, Comp or texture choices.
 * The blueprint stays abstract here; Harmony later assigns concrete pitches.
 */
export function planLofiLeadBlueprint(args: {
  style: string;
  foundationArchetypeId?: LofiFoundationArchetypeId;
  rng?: RandomContext;
}): LofiLeadPhraseBlueprint | undefined {
  if (args.style.toLowerCase() !== 'lofi' || !args.foundationArchetypeId) return undefined;
  const randomValue = args.rng?.substream('lofiLeadBlueprint').next() ?? 0;
  return copyLofiLeadPhraseBlueprint(
    weightedPick(LOFI_LEAD_PHRASE_BLUEPRINTS, args.foundationArchetypeId, randomValue),
  );
}
