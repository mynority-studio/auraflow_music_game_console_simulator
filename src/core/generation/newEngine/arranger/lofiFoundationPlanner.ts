// ============================================================
// newEngine · arranger · LOFI Foundation Planner
// ------------------------------------------------------------
// Selects one immutable, compatible foundation identity for the whole song.
// Section planners may project layer presence from it; they may not re-pick a
// different LOFI family.
// ============================================================

import type { RandomContext } from '../foundation';
import {
  LOFI_FOUNDATION_ARCHETYPES,
  type LofiFoundationArchetype,
  type LofiFoundationArchetypeId,
  type LofiPadFamily,
  type LofiVoicingFamily,
} from '../knowledge/lofiFoundationArchetypes';
import {
  lofiAuxiliaryTopLoops,
  lofiDrumPhrasesForFamily,
} from '../knowledge/grooves';

export interface LofiFoundationPlan {
  id: string;
  archetypeId: LofiFoundationArchetypeId;
  grooveContractId: string;
  drumPhraseId: string;
  topLoopId?: string;
  /**
   * Traceability only. Harmony remains owned by HarmonyEngine and is selected
   * from the complete mode-aware LOFI progression pool per repeat group.
   */
  harmonyPoolId: `lofi-progression-pool:${'major' | 'minor'}`;
  bassPatternId: string;
  mutationBudget: {
    cycleBars: 16;
    barOffsets: readonly number[];
    maxMutatedBars: 0 | 1 | 2;
    allowedFunctions: readonly ('answer' | 'dropout' | 'pickup')[];
  };
  voicingIntent: {
    family: LofiVoicingFamily;
    register: readonly [number, number];
    maxVoicesWithBass: number;
  };
  compIntent: {
    brokenChordTechnique: LofiFoundationArchetype['comp']['brokenChordTechnique'];
    anchorRetriggerBeats: 2;
    fingerOverlapBeats: number;
    harmonicReleaseBeats: number;
    chordGateRatioByContinuity: Readonly<{
      continuous: number;
      semiContinuous: number;
      sparse: number;
      delayedEntry: number;
    }>;
    commonToneBridgeMaxBeats: number;
    damperPolicy: 'when-documented';
    unsupportedDamperFallback: 'finger-legato';
  };
  padIntent: {
    family: LofiPadFamily;
    anticipationProbability: number;
  };
  leadSpace: {
    activeBarTarget: readonly [number, number];
    minimumContiguousRestBars: number;
  };
}

function weightedArchetype(rng: RandomContext | undefined): LofiFoundationArchetype {
  if (!rng) return LOFI_FOUNDATION_ARCHETYPES[0];
  const total = LOFI_FOUNDATION_ARCHETYPES.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng.substream('lofiFoundationArchetype').next() * total;
  for (const archetype of LOFI_FOUNDATION_ARCHETYPES) {
    roll -= archetype.weight;
    if (roll <= 0) return archetype;
  }
  return LOFI_FOUNDATION_ARCHETYPES[LOFI_FOUNDATION_ARCHETYPES.length - 1];
}

function mutationOffsets(
  archetype: LofiFoundationArchetype,
  rng: RandomContext | undefined,
): number[] {
  if (archetype.maxMutatedBars === 0 || !rng) return [];
  const mutationRng = rng.substream('lofiFoundationMutation');
  if (mutationRng.next() >= archetype.mutationProbability) return [];
  // Bar offsets 6/14 are the planned Lead-rest answers in each eight-bar
  // half. Do not place a drum mutation on offsets 7/15 where Lead returns.
  if (archetype.maxMutatedBars === 1) return [mutationRng.next() < 0.5 ? 6 : 14];
  return [6, 14];
}

export function planLofiFoundation(args: {
  style: string;
  mode: 'major' | 'minor';
  rng?: RandomContext;
}): LofiFoundationPlan | undefined {
  if (args.style.toLowerCase() !== 'lofi') return undefined;
  const archetype = weightedArchetype(args.rng);
  const phrasePool = lofiDrumPhrasesForFamily(archetype.drumPhraseFamily);
  if (phrasePool.length === 0) {
    throw new Error(`LOFI foundation ${archetype.id} has no drum phrase vocabulary`);
  }
  const phraseRng = args.rng?.substream('lofiFoundationDrum');
  const phrase = phraseRng ? phrasePool[phraseRng.int(phrasePool.length)] : phrasePool[0];
  const harmonyPoolId = `lofi-progression-pool:${args.mode}` as const;
  const topLoops = lofiAuxiliaryTopLoops();
  const topRng = args.rng?.substream('lofiFoundationTop');
  const topLoopId = topRng && topLoops.length > 0 && topRng.next() < archetype.topLoopProbability
    ? topLoops[topRng.int(topLoops.length)].id
    : undefined;
  const barOffsets = mutationOffsets(archetype, args.rng);

  return {
    id: `lofi-foundation:${archetype.id}:${phrase.id}:${harmonyPoolId}:${topLoopId ?? 'no-top'}`,
    archetypeId: archetype.id,
    grooveContractId: archetype.grooveContractId,
    drumPhraseId: phrase.id,
    topLoopId,
    harmonyPoolId,
    bassPatternId: archetype.bassPatternId,
    mutationBudget: {
      cycleBars: archetype.mutationCycleBars,
      barOffsets,
      maxMutatedBars: archetype.maxMutatedBars,
      allowedFunctions: ['answer', 'dropout', 'pickup'],
    },
    voicingIntent: {
      ...archetype.voicing,
      register: [archetype.voicing.register[0], archetype.voicing.register[1]],
    },
    compIntent: {
      ...archetype.comp,
      chordGateRatioByContinuity: { ...archetype.comp.chordGateRatioByContinuity },
    },
    padIntent: { ...archetype.pad },
    leadSpace: {
      activeBarTarget: [
        archetype.leadSpace.activeBarTarget[0],
        archetype.leadSpace.activeBarTarget[1],
      ],
      minimumContiguousRestBars: archetype.leadSpace.minimumContiguousRestBars,
    },
  };
}
