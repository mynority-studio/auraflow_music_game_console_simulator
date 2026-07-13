import { describe, expect, it } from 'vitest';
import {
  PLAYBACK_MASTER_LIFT_CALIBRATION,
  PLAYBACK_STYLE_MASTER_LIFT,
  playbackMasterLiftCalibrationForStyle,
  playbackMasterLiftForStyle,
  recommendedPlaybackMasterLiftForEstimatedLufs,
} from './masteringProfile';

describe('masteringProfile · Copych style master lift calibration', () => {
  it('keeps one calibrated lift table for Copych playback', () => {
    expect(playbackMasterLiftForStyle('pop')).toBe(PLAYBACK_STYLE_MASTER_LIFT.pop);
    expect(playbackMasterLiftForStyle('ACG')).toBe(PLAYBACK_STYLE_MASTER_LIFT.acg);
    expect(playbackMasterLiftForStyle(undefined)).toBe(1.5);
    for (const [style, calibration] of Object.entries(PLAYBACK_MASTER_LIFT_CALIBRATION)) {
      expect(calibration.lift).toBe(PLAYBACK_STYLE_MASTER_LIFT[style as keyof typeof PLAYBACK_STYLE_MASTER_LIFT]);
      expect(calibration.acceptablePlaybackLufs[0]).toBeLessThan(calibration.targetPlaybackIntegratedLufs);
      expect(calibration.acceptablePlaybackLufs[1]).toBeGreaterThan(calibration.targetPlaybackIntegratedLufs);
      expect(calibration.maxRecommendedLift).toBeGreaterThanOrEqual(calibration.lift);
    }
  });

  it('recommends more lift only when the estimated pre-master loudness is low', () => {
    expect(recommendedPlaybackMasterLiftForEstimatedLufs('pop', -15.2)).toBeCloseTo(1.22, 1);
    expect(recommendedPlaybackMasterLiftForEstimatedLufs('acg', -19.2)).toBeCloseTo(2.20, 1);
    expect(recommendedPlaybackMasterLiftForEstimatedLufs('acg', -30)).toBe(PLAYBACK_MASTER_LIFT_CALIBRATION.acg.maxRecommendedLift);
    expect(recommendedPlaybackMasterLiftForEstimatedLufs('pop', -8)).toBe(0.8);
  });

  it('fallback styles use conservative streaming-like calibration', () => {
    const c = playbackMasterLiftCalibrationForStyle('unknown');
    expect(c.lift).toBe(1.5);
    expect(c.targetPlaybackIntegratedLufs).toBe(-14);
    expect(recommendedPlaybackMasterLiftForEstimatedLufs('unknown', Number.NaN)).toBe(1.5);
  });
});
