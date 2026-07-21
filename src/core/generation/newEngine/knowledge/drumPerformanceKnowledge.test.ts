import { describe, expect, it } from 'vitest';
import { GROOVE_CONTRACT_POOL } from './grooveContracts';
import {
  DRUM_FEEL_PROFILES,
  DRUM_KNOWLEDGE_SOURCES,
  drumFeelProfileIdForContract,
  tempoAwareJazzSwingRatio,
} from './drumPerformanceKnowledge';

describe('drum performance knowledge', () => {
  it('grounds every profile in registered evidence and keeps ghost/accent bands separated', () => {
    const sourceIds = new Set(DRUM_KNOWLEDGE_SOURCES.map((source) => source.id));
    for (const profile of Object.values(DRUM_FEEL_PROFILES)) {
      expect(profile.evidence.length, profile.id).toBeGreaterThan(1);
      expect(profile.evidence.every((source) => sourceIds.has(source)), profile.id).toBe(true);
      expect(profile.velocity.snareAccent.min, profile.id).toBeGreaterThan(profile.velocity.snareGhost.max);
      expect(profile.velocity.timekeeperAccent.min, profile.id).toBeGreaterThan(profile.velocity.timekeeperTap.min);
      expect(profile.physical.maxHandsAtOnce).toBe(2);
      expect(Math.max(...profile.timing.phraseDriftMs.map(Math.abs)), profile.id)
        .toBeLessThanOrEqual(profile.timing.maxAbsoluteMs);
    }
  });

  it('resolves every production GrooveContract through the same contract authority', () => {
    for (const contract of GROOVE_CONTRACT_POOL) {
      expect(DRUM_FEEL_PROFILES[drumFeelProfileIdForContract(contract)], contract.id).toBeDefined();
    }
  });

  it('makes Jazz eighths progressively straighter as tempo rises', () => {
    const slow = tempoAwareJazzSwingRatio(0.66, 84);
    const medium = tempoAwareJazzSwingRatio(0.66, 132);
    const fast = tempoAwareJazzSwingRatio(0.66, 188);
    expect(slow).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(fast);
    expect(fast).toBeGreaterThanOrEqual(0.54);
  });
});
