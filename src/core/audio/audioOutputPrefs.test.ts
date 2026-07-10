import { describe, expect, it } from 'vitest';
import { getSampleRatePref, SAMPLE_RATE_OPTIONS, setSampleRatePref } from './audioOutputPrefs';

describe('audioOutputPrefs — SF2 native sample-rate lock', () => {
    it('exposes only the 24 kHz SF2-native playback rate', () => {
        expect(SAMPLE_RATE_OPTIONS).toEqual([24000]);
        expect(getSampleRatePref()).toBe(24000);
    });

    it('normalizes stale non-24k sample-rate values back to 24 kHz', () => {
        setSampleRatePref(48000 as never);
        expect(getSampleRatePref()).toBe(24000);
    });
});
