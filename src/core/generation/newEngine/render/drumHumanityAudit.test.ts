import { describe, expect, it } from 'vitest';
import { midi, ticks } from '../foundation';
import type { GrooveScorePlan } from '../arranger/ArrangementPlan';
import type { GrooveContract } from '../knowledge/grooveContracts';
import { auditDrumHumanity } from './drumHumanityAudit';

const contract: GrooveContract = {
  id: 'audit-pop', name: 'audit', style: 'POP', weight: 1,
  grid: 'straight', density: 'medium', compSwingRatio: 0.5, melodySwingRatio: 0.5,
  bassPocketMs: [0, 0], chordPocketMs: [0, 0], melodyStrongPocketMs: [0, 0], melodyWeakPocketMs: [0, 0],
  velocityHumanize: 0, accentPattern: [1, 0.9, 1, 0.9], articulation: 'short',
};

const scorePlan: GrooveScorePlan = {
  grooveContractId: contract.id,
  bySection: {
    section: {
      sectionId: 'section', grooveContractId: contract.id,
      bars: [0, 1].map((absoluteBar) => ({
        sectionId: 'section', barInSection: absoluteBar, absoluteBar,
        phraseIndex: 0, phraseBarIndex: absoluteBar, role: absoluteBar ? 'answer' : 'base',
        beatStrength: [1, 0.9, 1, 0.9], subdivision: 'sixteenth',
        subdivisionAccent: [1, 0.7, 0.85, 0.65], phraseAccent: 1,
        drumInteraction: {
          kickFollow: 'pulse', snareFollow: 'backbeat', structuralKickBeats: [0],
          structuralSnareBeats: [1, 3], kickResponseLimit: 0, snareResponseLimit: 0,
        },
      })),
    },
  },
  boundaries: [],
};

const note = (pitch: number, beat: number, velocity: number) => ({
  pitch: midi(pitch), startTick: ticks(beat * 480), durationTicks: ticks(120), velocity,
});

describe('drum humanity audit', () => {
  it('distinguishes repeated flat bars from dynamic performance variation', () => {
    const flat = [
      note(36, 0, 100), note(38, 1, 96), note(42, 0, 56), note(42, 0.5, 56),
      note(36, 4, 100), note(38, 5, 96), note(42, 4, 56), note(42, 4.5, 56),
    ];
    const varied = flat.map((event, index) => ({
      ...event,
      startTick: ticks(Math.max(0, (event.startTick as number) + (index % 3) - 1)),
      velocity: event.velocity - index,
    }));
    const base = { ppq: 480, beatsPerBar: 4, tempoBpm: 120, scorePlan, contractBySection: { section: contract } };
    const flatAudit = auditDrumHumanity({ ...base, notes: flat });
    const variedAudit = auditDrumHumanity({ ...base, notes: varied });

    expect(flatAudit.repeatedPerformanceBarRatio).toBeGreaterThan(0);
    expect(flatAudit.voices.hat?.velocityStdDev).toBe(0);
    expect(variedAudit.performanceSignatureCount).toBeGreaterThan(flatAudit.performanceSignatureCount);
    expect(variedAudit.voices.hat?.velocityStdDev).toBeGreaterThan(0);
    expect(variedAudit.voices.snare?.exactGridRatio).toBeLessThan(1);
  });

  it('measures structural backbeat versus ghost-note separation', () => {
    const audit = auditDrumHumanity({
      notes: [note(38, 0.75, 38), note(38, 1, 104), note(38, 2.75, 42), note(38, 3, 108)],
      ppq: 480, beatsPerBar: 4, tempoBpm: 120, scorePlan,
      contractBySection: { section: contract },
    });
    expect(audit.snareAccentGhostSeparation).toBeGreaterThan(60);
  });
});
