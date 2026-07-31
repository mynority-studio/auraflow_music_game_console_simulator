import { describe, expect, it } from 'vitest';
import {
  ACG_PIANO_CONTINUITY_MIN_KEY_DOWN_BEATS,
  ACG_PIANO_LEAD_EXPOSED_GAP_BEATS,
  ACG_PIANO_LEAD_MAX_ONSET_NUDGE_BEATS,
  ACG_PIANO_LEAD_REENTRY_GUARD_BEATS,
  ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS,
  resolveAcgPianoContinuityRule,
  resolveAcgPianoLeadContinuityProfile,
  resolveAcgPianoWrittenContinuity,
} from './acgPianoContinuityKnowledge';

describe('knowledge/acgPianoContinuityKnowledge', () => {
  it('recognizes a full-breath root as the written resonance carrier', () => {
    expect(resolveAcgPianoContinuityRule({
      role: 'bass',
      sentenceId: 'full-breath',
      gesture: 'tacet',
      voice: 'root',
      isTerminalCarrier: true,
      isSingleVoice: true,
    })).toEqual({
      reason: 'full-breath-root-carrier',
      target: 'release-boundary',
      minimumKeyDownBeats: ACG_PIANO_CONTINUITY_MIN_KEY_DOWN_BEATS,
      releaseGuardBeats: ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS,
    });

    expect(resolveAcgPianoContinuityRule({
      role: 'bass',
      sentenceId: 'full-breath',
      gesture: 'tacet',
      voice: 'root',
      isTerminalCarrier: false,
      isSingleVoice: true,
    })).toBeUndefined();
  });

  it('permits only a terminal one-note arrival to request a lyrical key hold', () => {
    expect(resolveAcgPianoContinuityRule({
      role: 'comp',
      sentenceId: 'ripple-eighths',
      gesture: 'arp-up',
      voice: 'high',
      eventRole: 'arrival',
      isTerminalCarrier: true,
      isSingleVoice: true,
    })).toMatchObject({
      reason: 'arrival-single-carrier',
      target: 'minimum-key-hold',
      minimumKeyDownBeats: 2,
    });

    expect(resolveAcgPianoContinuityRule({
      role: 'comp',
      sentenceId: 'ripple-eighths',
      gesture: 'arp-up',
      voice: 'high',
      eventRole: 'arrival',
      isTerminalCarrier: false,
      isSingleVoice: true,
    })).toBeUndefined();
  });

  it('preserves intentionally short pulse and dyad material', () => {
    expect(resolveAcgPianoContinuityRule({
      role: 'comp',
      sentenceId: 'hook-pulse',
      gesture: 'pulse',
      voice: 'high',
      eventRole: 'arrival',
      isTerminalCarrier: true,
      isSingleVoice: true,
    })).toBeUndefined();

    expect(resolveAcgPianoContinuityRule({
      role: 'comp',
      sentenceId: 'late-question',
      gesture: 'answer-dyad',
      voice: 'upper-dyad',
      eventRole: 'answer',
      isTerminalCarrier: true,
      isSingleVoice: false,
    })).toBeUndefined();
  });

  it('writes one arranger-owned cantabile rule for every ACG phrase rather than leaving the scheduler to infer it', () => {
    const profile = resolveAcgPianoLeadContinuityProfile({
      phase: 'coda',
      phraseGesture: 'release-coda',
      cadenceTarget: 'authentic',
      grammarSubset: 'cantabile-theme',
      hasPlannedLeadSilence: true,
    });
    expect(profile).toEqual({
      continuityClass: 'carrier',
      exposedGapBeats: ACG_PIANO_LEAD_EXPOSED_GAP_BEATS,
      minimumKeyDownBeats: ACG_PIANO_CONTINUITY_MIN_KEY_DOWN_BEATS,
      releaseGuardBeats: ACG_PIANO_CONTINUITY_RELEASE_GUARD_BEATS,
      reentryGuardBeats: ACG_PIANO_LEAD_REENTRY_GUARD_BEATS,
      maxOnsetNudgeBeats: ACG_PIANO_LEAD_MAX_ONSET_NUDGE_BEATS,
      allowedShortGestureClasses: ['ornament', 'pulse', 'suspension'],
      lowerHandPolicy: 'does-not-shorten-key',
      terminalTailPolicy: 'allow-song-end-carrier',
    });
  });

  it('never mistakes an isolated sixteenth before a rest for a fast-run exception', () => {
    expect(resolveAcgPianoWrittenContinuity({
      durationBeats: 0.25,
      restAfterKeyUpBeats: 1.75,
      fastRunAttackCount: 1,
    })).toMatchObject({
      continuityClass: 'exposed-carrier',
      damperPolicy: 'pedal-default',
      minimumKeyDownBeats: 2,
    });

    expect(resolveAcgPianoWrittenContinuity({
      durationBeats: 0.25,
      restAfterKeyUpBeats: 0,
      fastRunAttackCount: 4,
    })).toMatchObject({
      continuityClass: 'fast-run',
      damperPolicy: 'dry-allowed',
    });
  });
});
