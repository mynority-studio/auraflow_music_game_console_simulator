import { describe, expect, it } from 'vitest';
import { createRandomContext } from '../foundation';
import { lofiLeadPhraseBlueprintById } from '../knowledge/lofiLeadPhraseBlueprints';
import type { LofiPhraseInteractionPlan } from './ArrangementPlan';
import { planLofiLeadRoadMap } from './lofiLeadRoadMapPlanner';

function interaction(): LofiPhraseInteractionPlan {
  const roles = [
    'rest', 'rest', 'rest', 'rest', 'statement', 'variation', 'rest', 'return',
    'rest', 'rest', 'rest', 'rest', 'statement', 'variation', 'rest', 'return',
  ] as const;
  const bars = roles.map((leadRole, absoluteBar) => ({
    sectionId: 'loop',
    barInSection: absoluteBar,
    absoluteBar,
    phraseId: `p-${Math.floor(absoluteBar / 4)}`,
    ...(leadRole === 'rest' ? {} : { motifId: 'm-loop' }),
    phraseBarIndex: absoluteBar % 4,
    arcPhase: 'settle' as const,
    leadRole,
    compRole: leadRole === 'rest' ? 'bed' as const : 'support' as const,
    bassRole: leadRole === 'rest' ? 'anchor' as const : 'lock' as const,
    drumRole: 'core' as const,
    tensionIntent: leadRole === 'return' ? 'resolve' as const : 'stable' as const,
    velocityScaleByRole: { lead: 1, comp: 1, bass: 1, drum: 1 },
  }));
  return {
    phraseBars: 4,
    bars,
    bySection: { loop: bars },
    pocket: {
      kickAnchorMs: 0,
      kickOffbeatMs: -5,
      snareDragMs: 20,
      hatOnbeatMs: 1,
      hatOffbeatMs: 10,
    },
  };
}

describe('arranger/lofiLeadRoadMapPlanner', () => {
  it('authors every bar as an explicit Lead brick before Harmony', () => {
    const plan = planLofiLeadRoadMap({
      style: 'lofi',
      phraseInteraction: interaction(),
      leadBlueprint: lofiLeadPhraseBlueprintById('lofi-lead-late-answer-hook'),
      beatsPerBar: 4,
      rng: createRandomContext(41),
    });

    expect(plan).toBeDefined();
    expect(plan?.sourceTextureCorpus).toBe('LOFI_ENRICHED_GRAMMAR');
    expect(plan?.bricks).toHaveLength(16);
    expect(plan?.bricks[4]).toMatchObject({
      startBeat: 16,
      durationBeats: 4,
      phraseRole: 'statement',
      brickKind: 'motif-statement',
      grammarRole: 'statement-carrier',
    });
    expect(plan?.bricks[7]).toMatchObject({
      phraseRole: 'return',
      brickKind: 'motif-return',
      grammarRole: 'return-hold',
    });
    expect(plan?.bricks[0]).toMatchObject({
      phraseRole: 'rest',
      brickKind: 'silence-bed',
      grammarRole: 'release',
      textureTagPriority: ['lofi_rest_space'],
    });
  });

  it('keeps repeated cycle positions on the same Arranger texture decision', () => {
    const plan = planLofiLeadRoadMap({
      style: 'lofi',
      phraseInteraction: interaction(),
      leadBlueprint: lofiLeadPhraseBlueprintById('lofi-lead-late-answer-hook'),
      beatsPerBar: 4,
      rng: createRandomContext(99),
    })!;

    for (const position of [4, 5, 7]) {
      expect(plan.bricks[position + 8]!.textureTagPriority)
        .toEqual(plan.bricks[position]!.textureTagPriority);
      expect(plan.bricks[position + 8]!.sourceRuleOrdinal)
        .toBe(plan.bricks[position]!.sourceRuleOrdinal);
    }
  });
});
