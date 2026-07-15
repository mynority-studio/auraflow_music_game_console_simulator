export const PLAYBACK_STYLE_MASTER_LIFT = {
  // Rebased against the final rendered-IR envelope: POP is already near its
  // playback target before the hardware amp, so the old 1.5x lift over-drove
  // dense choruses instead of merely compensating the device output stage.
  pop: 1.25,
  rnb: 1.5,
  jazz: 1.5,
  lofi: 1.65,
  // ACG remains intentionally quieter pre-master, but 2.4x crossed the
  // small-speaker peak margin on dense arrivals. 2.3x retains the macro lift
  // while keeping the calibrated seed envelope inside that protection margin.
  acg: 2.3,
} as const;

export type PlaybackMasterStyle = keyof typeof PLAYBACK_STYLE_MASTER_LIFT;

export interface PlaybackMasterLiftCalibration {
  lift: number;
  targetPlaybackIntegratedLufs: number;
  acceptablePlaybackLufs: readonly [number, number];
  maxRecommendedLift: number;
  note: string;
}

export const PLAYBACK_MASTER_LIFT_CALIBRATION: Record<PlaybackMasterStyle, PlaybackMasterLiftCalibration> = {
  pop: {
    lift: PLAYBACK_STYLE_MASTER_LIFT.pop,
    targetPlaybackIntegratedLufs: -13.5,
    acceptablePlaybackLufs: [-15.5, -10.5],
    maxRecommendedLift: 2.0,
    note: 'mainstream pop reference: close to -14 LUFS, with small-speaker headroom for dense chorus',
  },
  rnb: {
    lift: PLAYBACK_STYLE_MASTER_LIFT.rnb,
    targetPlaybackIntegratedLufs: -12.4,
    acceptablePlaybackLufs: [-14.4, -10.9],
    maxRecommendedLift: 2.0,
    note: 'RNB keeps lead/EP forward; allow slightly louder perceived playback than pop',
  },
  jazz: {
    lift: PLAYBACK_STYLE_MASTER_LIFT.jazz,
    targetPlaybackIntegratedLufs: -13.0,
    acceptablePlaybackLufs: [-14.5, -11.0],
    maxRecommendedLift: 2.0,
    note: 'jazz is dynamic but should not feel smaller than pop on the device speaker',
  },
  lofi: {
    lift: PLAYBACK_STYLE_MASTER_LIFT.lofi,
    targetPlaybackIntegratedLufs: -13.0,
    acceptablePlaybackLufs: [-15.5, -11.0],
    maxRecommendedLift: 2.2,
    note: 'lofi seeds vary widely; lift is higher but still leaves room for softclip transients',
  },
  acg: {
    lift: PLAYBACK_STYLE_MASTER_LIFT.acg,
    targetPlaybackIntegratedLufs: -12.4,
    acceptablePlaybackLufs: [-13.6, -11.2],
    maxRecommendedLift: 2.8,
    note: 'ACG arrangement has intentionally lower pre-master energy; master lift compensates macro loudness only',
  },
} as const;

export const PLAYBACK_MASTER_LIFT_MIN = 0.8;

export function playbackMasterLiftForStyle(style: string | undefined): number {
  const key = (style ?? '').toLowerCase() as PlaybackMasterStyle;
  return PLAYBACK_STYLE_MASTER_LIFT[key] ?? 1.5;
}

export function playbackMasterLiftCalibrationForStyle(style: string | undefined): PlaybackMasterLiftCalibration {
  const key = (style ?? '').toLowerCase() as PlaybackMasterStyle;
  return PLAYBACK_MASTER_LIFT_CALIBRATION[key] ?? {
    lift: 1.5,
    targetPlaybackIntegratedLufs: -14,
    acceptablePlaybackLufs: [-16, -12],
    maxRecommendedLift: 2.0,
    note: 'fallback style uses conservative streaming-like loudness',
  };
}

export function recommendedPlaybackMasterLiftForEstimatedLufs(style: string | undefined, estimatedIntegratedLufs: number): number {
  const calibration = playbackMasterLiftCalibrationForStyle(style);
  if (!Number.isFinite(estimatedIntegratedLufs)) return calibration.lift;
  const rawLift = Math.pow(10, (calibration.targetPlaybackIntegratedLufs - estimatedIntegratedLufs) / 20);
  return Math.max(PLAYBACK_MASTER_LIFT_MIN, Math.min(calibration.maxRecommendedLift, rawLift));
}
