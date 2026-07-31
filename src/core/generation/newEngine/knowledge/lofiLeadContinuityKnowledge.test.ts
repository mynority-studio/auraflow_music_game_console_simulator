import { describe, expect, it } from 'vitest';
import {
  LOFI_LEAD_EXPOSED_GAP_BEATS,
  lofiLeadMinimumWrittenDurationForTail,
  resolveLofiLeadContinuityProfile,
} from './lofiLeadContinuityKnowledge';

describe('knowledge/lofiLeadContinuityKnowledge', () => {
  it('keeps short crawls and chromatic approaches conditional on a real target', () => {
    const profile = resolveLofiLeadContinuityProfile({
      role: 'answer-riff',
      tailPolicy: 'electric-key-tail',
    });

    expect(profile).toMatchObject({
      role: 'answer-riff',
      exposedGapBeats: LOFI_LEAD_EXPOSED_GAP_BEATS,
      minimumWrittenDurationBeats: 2,
      allowedShortGestureClasses: ['answer-riff', 'connected-crawl', 'approach-target'],
      allowedGrammarTags: expect.arrayContaining(['lofi_parallel_answer', 'lofi_crawl_hold']),
    });
    expect(profile.allowedGrammarTags).not.toContain('lofi_short_crawl');
    expect(profile.allowedGrammarTags).not.toContain('lofi_chromatic_neighbor');
    expect(profile.conditionalGrammarTags).toEqual([
      { tag: 'lofi_short_crawl', gestureClass: 'connected-crawl', requiresResolvedTarget: true },
      { tag: 'lofi_chromatic_neighbor', gestureClass: 'approach-target', requiresResolvedTarget: true },
    ]);
  });

  it('makes rests an explicit R responsibility and gives returns a real carrier horizon', () => {
    const rest = resolveLofiLeadContinuityProfile({ role: 'rest' });
    const returning = resolveLofiLeadContinuityProfile({
      role: 'return-hold',
      tailPolicy: 'pluck-short',
    });

    expect(rest).toMatchObject({
      minimumWrittenDurationBeats: 0,
      allowedShortGestureClasses: [],
      allowedGrammarTags: ['lofi_rest_space'],
      conditionalGrammarTags: [],
    });
    expect(returning.minimumWrittenDurationBeats).toBe(2);
    expect(returning.allowedGrammarTags).toEqual(expect.arrayContaining(['lofi_soft_cadence', 'lofi_hold_answer']));
  });

  it('uses a voice-safe written duration without inventing a pedal policy', () => {
    expect(lofiLeadMinimumWrittenDurationForTail('pad-sustain')).toBe(2.5);
    expect(lofiLeadMinimumWrittenDurationForTail('keyboard-natural')).toBe(2);
    expect(lofiLeadMinimumWrittenDurationForTail('electric-key-tail')).toBe(2);
    expect(lofiLeadMinimumWrittenDurationForTail('pluck-short')).toBe(0.75);
  });
});
