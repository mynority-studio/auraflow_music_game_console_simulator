// ============================================================
// newEngine · arranger · LOFI Lead RoadMap planner
// ------------------------------------------------------------
// Writes the complete bar-by-bar Lead brick route before Harmony.  Each
// active brick chooses an ordered lane in the existing LOFI grammar texture
// pool; downstream compilation may only resolve compatibility.
// ============================================================

import type { RandomContext } from '../foundation';
import type { LofiPhraseInteractionPlan } from './ArrangementPlan';
import type { LofiLeadPhraseBlueprint } from '../knowledge/lofiLeadPhraseBlueprints';
import {
  lofiLeadGrammarRoleForPhraseRole,
  lofiLeadRoadMapBrickKindForPhraseRole,
  rotateLofiLeadTexturePriority,
  type LofiLeadRoadMapBrick,
  type LofiLeadRoadMapPlan,
} from '../knowledge/lofiLeadRoadMapKnowledge';

export function planLofiLeadRoadMap(args: {
  readonly style: string;
  readonly phraseInteraction?: Readonly<LofiPhraseInteractionPlan>;
  readonly leadBlueprint?: Readonly<LofiLeadPhraseBlueprint>;
  readonly beatsPerBar: number;
  readonly rng?: RandomContext;
}): LofiLeadRoadMapPlan | undefined {
  if (
    args.style.toLowerCase() !== 'lofi'
    || !args.phraseInteraction
    || !args.leadBlueprint
  ) return undefined;

  const random = args.rng?.substream('lofiLeadRoadMap');
  const choicesByCyclePosition = new Map<string, {
    priorityOffset: number;
    sourceRuleOrdinal: number;
  }>();
  const bricks: LofiLeadRoadMapBrick[] = [];
  const brickIdByAbsoluteBar: Record<string, string> = {};
  const beatsPerBar = Math.max(1, args.beatsPerBar);

  for (const interaction of [...args.phraseInteraction.bars]
    .sort((left, right) => left.absoluteBar - right.absoluteBar)) {
    const phraseRole = interaction.leadRole;
    const cyclePosition = interaction.barInSection % args.leadBlueprint.cycleBars;
    const choiceKey = `${cyclePosition}:${phraseRole}`;
    let choice = choicesByCyclePosition.get(choiceKey);
    if (!choice) {
      choice = {
        priorityOffset: random?.int(3) ?? 0,
        sourceRuleOrdinal: random?.int(0x7fffffff) ?? cyclePosition,
      };
      choicesByCyclePosition.set(choiceKey, choice);
    }
    const id = `lofi-lead-brick:${interaction.sectionId}:${interaction.barInSection}`;
    const brick: LofiLeadRoadMapBrick = {
      id,
      sectionId: interaction.sectionId,
      absoluteBar: interaction.absoluteBar,
      barInSection: interaction.barInSection,
      startBeat: interaction.absoluteBar * beatsPerBar,
      durationBeats: beatsPerBar,
      ...(interaction.phraseId ? { phraseId: interaction.phraseId } : {}),
      ...(interaction.motifId ? { motifId: interaction.motifId } : {}),
      phraseRole,
      brickKind: lofiLeadRoadMapBrickKindForPhraseRole(phraseRole),
      grammarRole: lofiLeadGrammarRoleForPhraseRole(phraseRole),
      textureTagPriority: rotateLofiLeadTexturePriority(phraseRole, choice.priorityOffset),
      sourceRuleOrdinal: choice.sourceRuleOrdinal,
    };
    bricks.push(brick);
    brickIdByAbsoluteBar[String(interaction.absoluteBar)] = id;
  }

  return {
    cycleBars: args.leadBlueprint.cycleBars,
    sourceTextureCorpus: 'LOFI_ENRICHED_GRAMMAR',
    bricks,
    brickIdByAbsoluteBar,
  };
}
