import { describe, expect, it } from 'vitest';

import {
  ACOUSTIC_INSTRUMENTATION_PROFILES,
  acousticInstrumentationIntentForStyle,
} from './acousticInstrumentationProfiles';

describe('arranger/acousticInstrumentationProfiles', () => {
  it('gives every supported macro style one explicit acoustic ensemble identity', () => {
    expect(acousticInstrumentationIntentForStyle('pop')?.id).toBe('pop-piano-strings');
    expect(acousticInstrumentationIntentForStyle('jazz')?.id).toBe('jazz-piano-trio');
    expect(acousticInstrumentationIntentForStyle('lofi')?.id).toBe('lofi-piano-small-group');
    expect(acousticInstrumentationIntentForStyle('rnb')?.id).toBe('rnb-piano-strings');
    expect(acousticInstrumentationIntentForStyle('acg')?.id).toBe('acg-piano-solo');
    expect(acousticInstrumentationIntentForStyle('modal')).toBeUndefined();
  });

  it('only the real one-piano templates share a physical piano pedal lane', () => {
    expect(ACOUSTIC_INSTRUMENTATION_PROFILES['jazz-piano-trio'].sharedPianoRoles).toEqual(['lead', 'comp']);
    expect(ACOUSTIC_INSTRUMENTATION_PROFILES['acg-piano-solo'].sharedPianoRoles).toEqual(['lead', 'comp', 'bass']);
    expect(ACOUSTIC_INSTRUMENTATION_PROFILES['pop-piano-strings'].sharedPianoRoles).toBeUndefined();
  });
});
