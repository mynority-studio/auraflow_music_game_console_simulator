import { describe, expect, it } from 'vitest';
import type {
  ArrangementPlan,
  LofiLeadPresencePlan,
  LofiPhraseInteractionPlan,
} from './ArrangementPlan';
import { buildLofiLeadScorePlan } from './lofiLeadScorePlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { RoadMap } from '../render/mgRoadMapParser';

function fixtureArrangement(): ArrangementPlan {
  return {
    meter: { numerator: 4, denominator: 4 },
    sections: [{ id: 'loop', role: 'verse', functionTag: 'loop', bars: 5, hookPolicy: 'none' }],
    phrases: [{
      id: 'p-loop', sectionId: 'loop', bars: 5, phraseSlot: 0,
      role: 'consequent', cadenceTarget: 'open', skeletonRole: 'connector',
    }],
  } as unknown as ArrangementPlan;
}

function fixtureHarmony(): HarmonicPlan {
  const spec = [
    { id: 'h0', startBeat: 0, stable: [0, 4, 7] },
    { id: 'h1', startBeat: 4, stable: [0, 4, 7] },
    { id: 'h2', startBeat: 8, stable: [0, 5, 9] },
    { id: 'h3', startBeat: 12, stable: [2, 5, 9] },
    { id: 'h4', startBeat: 16, stable: [0, 4, 7] },
  ];
  return {
    chordTimeline: spec.map((span) => ({
      id: span.id,
      startBeat: span.startBeat,
      durationBeats: 4,
      sectionId: 'loop',
      rootPc: span.stable[0],
      roman: { degree: 1, accidental: 'natural', quality: 'maj' },
      quality: 'maj',
    })),
    chordFunctionTimeline: ['T', 'S', 'D', 'T', 'T'],
    stableToneMap: Object.fromEntries(spec.map((span) => [span.id, span.stable])),
  } as unknown as HarmonicPlan;
}

function fixturePresence(): LofiLeadPresencePlan {
  return {
    activeBarsBySection: { loop: [1, 2, 3] },
    silenceWindows: [
      { sectionId: 'loop', startBarInSection: 0, endBarInSection: 1, startBeat: 0, endBeat: 4 },
      { sectionId: 'loop', startBarInSection: 4, endBarInSection: 5, startBeat: 16, endBeat: 20 },
    ],
    entryBeats: [4.5, 8.5, 12.5],
  };
}

function fixtureInteraction(): LofiPhraseInteractionPlan {
  const roles = ['rest', 'statement', 'variation', 'return', 'rest'] as const;
  const bars = roles.map((leadRole, absoluteBar) => ({
    sectionId: 'loop',
    barInSection: absoluteBar,
    absoluteBar,
    phraseId: 'p-loop',
    ...(leadRole === 'rest' ? {} : { motifId: 'm-loop-lofi-answer' }),
    phraseBarIndex: absoluteBar,
    arcPhase: absoluteBar === 3 ? 'release' as const : 'settle' as const,
    leadRole,
    compRole: leadRole === 'rest' ? 'bed' as const : 'support' as const,
    bassRole: leadRole === 'rest' ? 'anchor' as const : 'lock' as const,
    drumRole: 'core' as const,
    tensionIntent: leadRole === 'return' ? 'resolve' as const : 'stable' as const,
    velocityScaleByRole: { lead: 1, comp: 1, bass: 1, drum: 1 },
  }));
  return {
    phraseBars: 5,
    bars,
    bySection: { loop: bars },
    pocket: { kickAnchorMs: 0, kickOffbeatMs: -5, snareDragMs: 20, hatOnbeatMs: 1, hatOffbeatMs: 10 },
  };
}

const ROAD_MAP: RoadMap = {
  bricks: [
    { name: 'Opening', family: 'Major-On', startBeat: 0, durationBeats: 8, chordIndices: [0, 1], cost: 0 },
    { name: 'Answer', family: 'Cadence', startBeat: 8, durationBeats: 4, chordIndices: [2], cost: 0 },
    { name: 'Return', family: 'Turnaround', startBeat: 12, durationBeats: 8, chordIndices: [3, 4], cost: 0 },
  ],
  totalCost: 0,
  segments: [{ startBeat: 0, endBeat: 20, keyRootPc: 0, mode: 'Major' }],
};

function score() {
  return buildLofiLeadScorePlan({
    arrangement: fixtureArrangement(),
    harmonic: fixtureHarmony(),
    leadPresencePlan: fixturePresence(),
    phraseInteractionPlan: fixtureInteraction(),
    roadMap: ROAD_MAP,
    leadTailPolicy: 'electric-key-tail',
  });
}

describe('arranger/lofiLeadScorePlan', () => {
  it('compiles every phrase-bar × harmonic segment before grammar expansion', () => {
    const plan = score();
    expect(plan.bars).toHaveLength(5);
    expect(plan.slots).toHaveLength(5);
    expect(plan.leadTailPolicy).toBe('electric-key-tail');
    expect(plan.entryBeats).toEqual([4.5, 8.5, 12.5]);
    expect(plan.silenceWindows).toEqual(fixturePresence().silenceWindows);

    expect(plan.slots.map((slot) => [slot.absoluteBar, slot.sourceSpanId, slot.role])).toEqual([
      [0, 'h0', 'rest'],
      [1, 'h1', 'statement-carrier'],
      [2, 'h2', 'answer-riff'],
      [3, 'h3', 'return-hold'],
      [4, 'h4', 'rest'],
    ]);
    for (const slot of plan.slots) {
      expect(slot.phraseId).toBe('p-loop');
      expect(slot.harmonicScope).toBe('current-chord');
      expect(slot.stableRoles).toEqual(['root', 'third', 'fifth', 'seventh']);
      expect(slot.shortGestureMustResolve).toBe(true);
      expect(slot.startBeat).toBeLessThan(slot.endBeat);
    }
    expect(plan.slots[2]!.allowedGrammarTags).toEqual(expect.arrayContaining(['lofi_parallel_answer', 'lofi_crawl_hold']));
    expect(plan.slots[2]!.conditionalGrammarTags).toEqual(expect.arrayContaining([
      { tag: 'lofi_short_crawl', gestureClass: 'connected-crawl', requiresResolvedTarget: true },
    ]));
    expect(plan.slots[0]!.allowedGrammarTags).toEqual(['lofi_rest_space']);
    expect(plan.slots[0]!.allowedShortGestureClasses).toEqual([]);
  });

  it('pre-proves exact common-tone bridges and releases into an arranger rest', () => {
    const plan = score();
    const statement = plan.slots.find((slot) => slot.sourceSpanId === 'h1')!;
    const returnSlot = plan.slots.find((slot) => slot.sourceSpanId === 'h3')!;

    expect(statement.boundaryBridges).toEqual([
      { kind: 'common-tone', targetSpanId: 'h2', continuationPcs: [0] },
      { kind: 'release-at-boundary' },
    ]);
    // h4 happens to have common tones with h3, but it is a score-owned rest.
    expect(returnSlot.boundaryBridges).toEqual([{ kind: 'release-at-boundary' }]);
    expect(plan.slots.find((slot) => slot.sourceSpanId === 'h0')!.boundaryBridges)
      .toEqual([{ kind: 'release-at-boundary' }]);
  });

  it('retains RoadMap provenance and freezes only a detached score snapshot', () => {
    const plan = score();
    expect(plan.slots[1]!.roadMapBinding).toEqual({
      brickIndices: [0],
      brickFamilies: ['Major-On'],
      brickNames: ['Opening'],
    });
    expect(plan.slots[3]!.roadMapBinding).toEqual({
      brickIndices: [2],
      brickFamilies: ['Turnaround'],
      brickNames: ['Return'],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.slots)).toBe(true);
    expect(Object.isFrozen(plan.roadMap)).toBe(true);
    expect(Object.isFrozen(ROAD_MAP)).toBe(false);
  });
});
