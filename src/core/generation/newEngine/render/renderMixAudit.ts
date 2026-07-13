import type { InstrumentRole, TrackIR, TrackMix } from '../ir/MusicalIR';
import { songSpaceProfile, songSpaceProfileById } from '../knowledge/gmMixProfile';
import type { TimbreWorld } from '../knowledge/instruments';
import {
  PLAYBACK_MASTER_LIFT_CALIBRATION,
  PLAYBACK_STYLE_MASTER_LIFT,
  playbackMasterLiftForStyle,
  playbackMasterLiftCalibrationForStyle,
  recommendedPlaybackMasterLiftForEstimatedLufs,
} from '../../../audio/masteringProfile';

export type MixAuditSeverity = 'info' | 'warning' | 'error';

export interface MixAuditFinding {
  severity: MixAuditSeverity;
  code: string;
  role?: InstrumentRole;
  detail: string;
}

export interface TrackMixMetrics {
  role: InstrumentRole;
  program?: number;
  noteCount: number;
  activeBeats: number;
  averageVelocity: number;
  peakVelocity: number;
  averageVolume: number;
  maxVolume: number;
  dryEnergyPerBeat: number;
  wetEnergyPerBeat: number;
  busShare: number;
  copychReverbInputEnergyPerBeat: number;
  copychReverbBusShare: number;
  pan: number;
  reverb: number;
  chorus: number;
}

export interface MixAuditContext {
  style: string;
  ppq: number;
  durationTicks: number;
  sectionTicks?: readonly number[];
  spaceProfile?: string;
  world?: string;
}

export interface MixAuditReport {
  status: 'pass' | 'warning' | 'error';
  standard: typeof MASTERING_AUDIT_STANDARD;
  style: string;
  durationBeats: number;
  estimatedIntegratedLufs: number;
  totalWetEnergyPerBeat: number;
  totalCopychReverbInputEnergyPerBeat: number;
  peakPreMasterLinear: number;
  playbackMasterLift: number;
  targetPlaybackIntegratedLufs: number;
  estimatedPlaybackIntegratedLufs: number;
  playbackLoudnessDeltaDb: number;
  recommendedPlaybackMasterLift: number;
  estimatedDeviceOutputPeakDbfs: number;
  trackMetrics: TrackMixMetrics[];
  findings: MixAuditFinding[];
}

export const HARDWARE_SPEAKER_PROFILE = {
  model: 'YD3411-H-YC16-8B',
  source: 'user hardware speaker datasheet PDF',
  enclosureCc: 4,
  sizeMm: [34, 11, 4.0] as const,
  impedanceOhm: 4,
  ratedPowerWRms: 2.0,
  maxShortTermPowerWRms: 2.5,
  resonanceHz: 630,
  sensitivityDbSpl: {
    at400Hz: 84,
    at2kHz: 93,
    distanceM: 0.1,
    inputW: 2,
  },
  loadTestBandHz: [100, 20000] as const,
  mixBandsHz: {
    lowCutProtection: 75,
    kickBody: [100, 400] as const,
    midBody: [630, 2000] as const,
    presenceAttack: [2000, 4000] as const,
    harshnessControl: [5000, 10000] as const,
  },
  guardrails: {
    bassReverbCcMax: 12,
    drumReverbCcMax: 18,
    roomDrumReverbCcMax: 24,
    drumTransientCcMax: 78,
    padSustainedBusShareMax: 0.16,
    padCopychReverbBusShareMax: 0.28,
    compCopychReverbBusShareMax: 0.72,
    foregroundBusShareMin: 0.55,
    bassSustainedBusShareMinDefault: 0.12,
    bassSustainedBusShareMinAcg: 0.16,
    bassSustainedBusShareMaxDefault: 0.38,
    bassSustainedBusShareMaxAcg: 0.42,
  },
} as const;

export const MASTERING_AUDIT_STANDARD = {
  measurementBasis: 'ITU-R BS.1770 / EBU R128 proxy, calibrated from final MIDI IR before SF2 rendering',
  streamingReferenceIntegratedLufs: -14,
  acceptableEstimatedLufs: [-20, -11] as const,
  truePeakCeilingDbtp: -1,
  esp32SamplePeakCeilingDbfs: -1.5,
  referenceWetEnergyForMinus14Lufs: 0.75,
  copychMaster: {
    route: 'copych synth+shared FX -> style master lift -> device_postchain -> output',
    devicePostChainDefault: 'enabled by default at every browser sample rate: style master lift -> calibration gain 1.8 -> Copych softclip -> mono fold -> 24 kHz EQ when rate matches -> final hard clip -> int16 grid',
    playbackStyleMasterLift: PLAYBACK_STYLE_MASTER_LIFT,
    playbackStyleMasterLiftCalibration: PLAYBACK_MASTER_LIFT_CALIBRATION,
    webCompressorAfterDevicePostChain: false,
  },
  esp32Port: {
    sampleRateHz: 24000,
    channels: 2,
    renderFormat: 'int16',
    sampleRateContract: 'Aura25 SF2 samples are locked to 24 kHz; official Copych/ESP32 playback requests 24 kHz. Non-24k postchain handling is defensive fallback only.',
    requiredPostTsfStage: 'copych shared FX -> style master lift -> device_postchain gain/softclip/mono/(24k EQ when valid)/int16 clamp',
  },
  hardwareSpeaker: HARDWARE_SPEAKER_PROFILE,
} as const;

interface StyleAuditWindow {
  wetEnergy: readonly [number, number];
  leadCompRatio: readonly [number, number];
  lufs: readonly [number, number];
}

const STYLE_WINDOWS: Record<string, StyleAuditWindow> = {
  pop: { wetEnergy: [0.38, 1.08], leadCompRatio: [0.65, 2.10], lufs: [-17.5, -11.0] },
  rnb: { wetEnergy: [0.44, 1.12], leadCompRatio: [0.60, 2.10], lufs: [-17.0, -10.8] },
  lofi: { wetEnergy: [0.28, 0.92], leadCompRatio: [0.55, 2.80], lufs: [-18.5, -11.8] },
  jazz: { wetEnergy: [0.34, 0.86], leadCompRatio: [0.80, 3.80], lufs: [-18.5, -12.0] },
  blues: { wetEnergy: [0.30, 0.84], leadCompRatio: [0.80, 2.20], lufs: [-19.0, -12.0] },
  acg: { wetEnergy: [0.18, 0.46], leadCompRatio: [0.95, 5.20], lufs: [-21.0, -14.0] },
};

const DEFAULT_WINDOW: StyleAuditWindow = {
  wetEnergy: [0.32, 1.05],
  leadCompRatio: [0.65, 2.10],
  lufs: MASTERING_AUDIT_STANDARD.acceptableEstimatedLufs,
};

export const COPYCH_SAFE_FX_SEND = {
  reverbScaleByRole: {
    lead: 0.88,
    comp: 0.48,
    pad: 0.24,
    bass: 0.58,
    drum: 0.52,
  },
  chorusScaleByRole: {
    lead: 0.85,
    comp: 0.55,
    pad: 0.45,
  },
  takeoverLead: {
    reverbScale: 0.55,
    chorusScale: 0.55,
    delayScale: 0.0,
  },
  delayLeadScale: 0.70,
  delayLeadCapCc: 18,
  takeoverLeadChannel: 15,
  dryDelayOffChannels: [2, 3, 4, 9] as const,
} as const;

const ROLE_PEAK_WEIGHT: Record<InstrumentRole, number> = {
  lead: 1.0,
  comp: 0.58,
  bass: 0.82,
  pad: 0.42,
  drum: 1.08,
};

const EPS = 1e-9;

function styleWindow(style: string): StyleAuditWindow {
  return STYLE_WINDOWS[(style ?? '').toLowerCase()] ?? DEFAULT_WINDOW;
}

function clampTick(tick: number, durationTicks: number): number {
  return Math.max(0, Math.min(durationTicks, Math.round(tick)));
}

function db(linear: number): number {
  return linear > EPS ? 20 * Math.log10(linear) : -120;
}

function estimateLufs(totalWetEnergyPerBeat: number): number {
  return MASTERING_AUDIT_STANDARD.streamingReferenceIntegratedLufs
    + 10 * Math.log10(Math.max(EPS, totalWetEnergyPerBeat) / MASTERING_AUDIT_STANDARD.referenceWetEnergyForMinus14Lufs);
}

function copychSafeReverbSend(role: InstrumentRole, send: number): number {
  switch (role) {
    case 'pad': return send * COPYCH_SAFE_FX_SEND.reverbScaleByRole.pad;
    case 'comp': return send * COPYCH_SAFE_FX_SEND.reverbScaleByRole.comp;
    case 'lead': return send * COPYCH_SAFE_FX_SEND.reverbScaleByRole.lead;
    case 'bass': return send * COPYCH_SAFE_FX_SEND.reverbScaleByRole.bass;
    case 'drum': return send * COPYCH_SAFE_FX_SEND.reverbScaleByRole.drum;
    default: return send;
  }
}

function copychSafeChorusSend(role: InstrumentRole, send: number): number {
  switch (role) {
    case 'pad': return send * COPYCH_SAFE_FX_SEND.chorusScaleByRole.pad;
    case 'comp': return send * COPYCH_SAFE_FX_SEND.chorusScaleByRole.comp;
    case 'lead': return send * COPYCH_SAFE_FX_SEND.chorusScaleByRole.lead;
    default: return send;
  }
}

function copychReverbInputEnergy(dryEnergy: number, mix: TrackMix, role: InstrumentRole, songReverbLevel: number): number {
  const volume = mix.volume / 127;
  const reverb = copychSafeReverbSend(role, mix.reverb / 127);
  const chorus = copychSafeChorusSend(role, mix.chorus / 127);
  const fxInputGain = reverb * songReverbLevel * (1 + chorus);
  return dryEnergy * volume * volume * fxInputGain * fxInputGain;
}

function mixAt(track: TrackIR, tick: number): TrackMix | undefined {
  let out = track.mix;
  for (const mc of track.mixChanges ?? []) {
    if ((mc.atTick as number) <= tick) out = mc.mix;
    else break;
  }
  return out;
}

function mixBoundaries(track: TrackIR, ctx: MixAuditContext): number[] {
  const set = new Set<number>([0, ctx.durationTicks]);
  for (const t of ctx.sectionTicks ?? []) set.add(clampTick(t, ctx.durationTicks));
  for (const mc of track.mixChanges ?? []) set.add(clampTick(mc.atTick as number, ctx.durationTicks));
  for (const pc of track.programChanges ?? []) set.add(clampTick(pc.atTick as number, ctx.durationTicks));
  return [...set].sort((a, b) => a - b);
}

function dryEnergyPerBeat(track: TrackIR, loTick: number, hiTick: number, ppq: number): number {
  const segBeats = Math.max(EPS, (hiTick - loTick) / ppq);
  let sum = 0;
  for (const n of track.notes) {
    const ns = n.startTick as number;
    const ne = ns + (n.durationTicks as number);
    const lo = Math.max(loTick, ns);
    const hi = Math.min(hiTick, ne);
    if (hi <= lo) continue;
    sum += Math.pow(n.velocity / 127, 2) * ((hi - lo) / ppq);
  }
  return sum / segBeats;
}

function trackMetrics(track: TrackIR, ctx: MixAuditContext, songReverbLevel: number): TrackMixMetrics {
  const bounds = mixBoundaries(track, ctx);
  let wetSum = 0;
  let drySum = 0;
  let copychReverbInputSum = 0;
  let volumeSum = 0;
  let beats = 0;
  let maxVolume = 0;

  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    if (hi <= lo) continue;
    const mix = mixAt(track, lo);
    if (!mix) continue;
    const segBeats = (hi - lo) / ctx.ppq;
    const dry = dryEnergyPerBeat(track, lo, hi, ctx.ppq);
    const vol = mix.volume / 127;
    drySum += dry * segBeats;
    wetSum += dry * vol * vol * segBeats;
    copychReverbInputSum += copychReverbInputEnergy(dry, mix, track.role, songReverbLevel) * segBeats;
    volumeSum += mix.volume * segBeats;
    maxVolume = Math.max(maxVolume, mix.volume);
    beats += segBeats;
  }

  let activeTicks = 0;
  let velocityWeighted = 0;
  let velocityBeats = 0;
  let peakVelocity = 0;
  for (const n of track.notes) {
    activeTicks += n.durationTicks as number;
    const durBeats = (n.durationTicks as number) / ctx.ppq;
    velocityWeighted += n.velocity * durBeats;
    velocityBeats += durBeats;
    peakVelocity = Math.max(peakVelocity, n.velocity);
  }

  const initialMix = mixAt(track, 0) ?? { volume: 0, pan: 64, reverb: 0, chorus: 0 };
  return {
    role: track.role,
    program: track.program,
    noteCount: track.notes.length,
    activeBeats: activeTicks / ctx.ppq,
    averageVelocity: velocityBeats > 0 ? velocityWeighted / velocityBeats : 0,
    peakVelocity,
    averageVolume: beats > 0 ? volumeSum / beats : initialMix.volume,
    maxVolume,
    dryEnergyPerBeat: beats > 0 ? drySum / beats : 0,
    wetEnergyPerBeat: beats > 0 ? wetSum / beats : 0,
    busShare: 0,
    copychReverbInputEnergyPerBeat: beats > 0 ? copychReverbInputSum / beats : 0,
    copychReverbBusShare: 0,
    pan: initialMix.pan,
    reverb: initialMix.reverb,
    chorus: initialMix.chorus,
  };
}

function peakPreMasterLinear(tracks: readonly TrackIR[], ctx: MixAuditContext): number {
  const binTicks = Math.max(1, Math.round(ctx.ppq / 4));
  let peakPower = 0;
  for (let lo = 0; lo < ctx.durationTicks; lo += binTicks) {
    const hi = Math.min(ctx.durationTicks, lo + binTicks);
    let power = 0;
    for (const track of tracks) {
      const mix = mixAt(track, lo);
      if (!mix) continue;
      const volume = mix.volume / 127;
      const roleWeight = ROLE_PEAK_WEIGHT[track.role] ?? 0.7;
      for (const n of track.notes) {
        const ns = n.startTick as number;
        const ne = ns + (n.durationTicks as number);
        if (ne <= lo || ns >= hi) continue;
        const overlap = (Math.min(hi, ne) - Math.max(lo, ns)) / binTicks;
        const amp = (n.velocity / 127) * volume * roleWeight;
        power += amp * amp * Math.max(0, Math.min(1, overlap));
      }
    }
    peakPower = Math.max(peakPower, power);
  }
  return Math.sqrt(peakPower);
}

function pushRangeFinding(
  findings: MixAuditFinding[],
  code: string,
  value: number,
  range: readonly [number, number],
  detail: (v: number) => string,
  severity: MixAuditSeverity = 'warning',
): void {
  if (value < range[0] || value > range[1]) findings.push({ severity, code, detail: detail(value) });
}

function validCc(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 127;
}

export function auditRenderedMix(tracks: readonly TrackIR[], ctx: MixAuditContext): MixAuditReport {
  const findings: MixAuditFinding[] = [];
  const hasPad = tracks.some((track) => track.role === 'pad' && track.notes.length > 0);
  const copychSongSpace = songSpaceProfileById(ctx.spaceProfile)
    ?? songSpaceProfile(ctx.style, ctx.world as TimbreWorld | undefined, hasPad);
  const metrics = tracks.map((track) => trackMetrics(track, ctx, copychSongSpace.reverbLevel));
  const totalWetEnergyPerBeat = metrics.reduce((sum, m) => sum + m.wetEnergyPerBeat, 0);
  const totalCopychReverbInputEnergyPerBeat = metrics.reduce((sum, m) => sum + m.copychReverbInputEnergyPerBeat, 0);
  const trackMetricsWithShare = metrics.map((m) => ({
    ...m,
    busShare: totalWetEnergyPerBeat > EPS ? m.wetEnergyPerBeat / totalWetEnergyPerBeat : 0,
    copychReverbBusShare: totalCopychReverbInputEnergyPerBeat > EPS ? m.copychReverbInputEnergyPerBeat / totalCopychReverbInputEnergyPerBeat : 0,
  }));
  const estimatedIntegratedLufs = estimateLufs(totalWetEnergyPerBeat);
  const masterCalibration = playbackMasterLiftCalibrationForStyle(ctx.style);
  const playbackMasterLift = playbackMasterLiftForStyle(ctx.style);
  const estimatedPlaybackIntegratedLufs = estimatedIntegratedLufs + db(playbackMasterLift);
  const playbackLoudnessDeltaDb = estimatedPlaybackIntegratedLufs - masterCalibration.targetPlaybackIntegratedLufs;
  const recommendedPlaybackMasterLift = recommendedPlaybackMasterLiftForEstimatedLufs(ctx.style, estimatedIntegratedLufs);
  const peakPreMaster = peakPreMasterLinear(tracks, ctx);
  const deviceOutputPeak = peakPreMaster * playbackMasterLift;
  const estimatedDeviceOutputPeakDbfs = db(deviceOutputPeak);
  const window = styleWindow(ctx.style);

  pushRangeFinding(
    findings,
    'mix.totalWetEnergy',
    totalWetEnergyPerBeat,
    window.wetEnergy,
    (v) => `total wet energy ${v.toFixed(3)} is outside ${window.wetEnergy[0]}..${window.wetEnergy[1]} for ${ctx.style}`,
  );
  pushRangeFinding(
    findings,
    'master.estimatedLufs',
    estimatedIntegratedLufs,
    window.lufs,
    (v) => `estimated integrated loudness ${v.toFixed(1)} LUFS is outside ${window.lufs[0]}..${window.lufs[1]} for ${ctx.style}`,
  );
  pushRangeFinding(
    findings,
    'master.playbackEstimatedLufs',
    estimatedPlaybackIntegratedLufs,
    masterCalibration.acceptablePlaybackLufs,
    (v) => `playback loudness after ${ctx.style} master lift ${v.toFixed(1)} LUFS is outside calibrated ${masterCalibration.acceptablePlaybackLufs[0]}..${masterCalibration.acceptablePlaybackLufs[1]}`,
  );

  if (estimatedDeviceOutputPeakDbfs > MASTERING_AUDIT_STANDARD.esp32SamplePeakCeilingDbfs + 6) {
    findings.push({
      severity: 'error',
      code: 'master.outputClipRisk',
      detail: `Copych postchain drive peak proxy ${estimatedDeviceOutputPeakDbfs.toFixed(1)} dBFS would overdrive the ESP32 postchain`,
    });
  } else if (estimatedDeviceOutputPeakDbfs > MASTERING_AUDIT_STANDARD.esp32SamplePeakCeilingDbfs) {
    findings.push({
      severity: 'info',
      code: 'master.limiterWillWork',
      detail: `Copych postchain drive peak proxy ${estimatedDeviceOutputPeakDbfs.toFixed(1)} dBFS should be caught by device softclip/final clamp`,
    });
  }

  const byRole = new Map(trackMetricsWithShare.map((m) => [m.role, m]));
  const lead = byRole.get('lead');
  const comp = byRole.get('comp');
  if (lead && comp && lead.wetEnergyPerBeat > EPS && comp.wetEnergyPerBeat > EPS) {
    const ratio = lead.wetEnergyPerBeat / comp.wetEnergyPerBeat;
    pushRangeFinding(
      findings,
      'mix.leadCompRatio',
      ratio,
      window.leadCompRatio,
      (v) => `lead/comp wet-energy ratio ${v.toFixed(2)} is outside ${window.leadCompRatio[0]}..${window.leadCompRatio[1]} for ${ctx.style}`,
    );
  }

  for (const track of tracks) {
    const allMixes = [track.mix, ...(track.mixChanges ?? []).map((mc) => mc.mix)].filter((m): m is TrackMix => !!m);
    if (!track.mix) {
      findings.push({ severity: 'error', code: 'mix.missingTrackMix', role: track.role, detail: `${track.role} has no tick-0 TrackMix` });
      continue;
    }
    for (const mix of allMixes) {
      for (const [field, value] of Object.entries(mix) as [keyof TrackMix, number][]) {
        if (field === 'expression' && value === undefined) continue;
        if (!validCc(value)) {
          findings.push({ severity: 'error', code: 'mix.ccOutOfRange', role: track.role, detail: `${track.role}.${field}=${value} is not an integer MIDI CC` });
        }
      }
    }
  }

  const bass = byRole.get('bass');
  const drum = byRole.get('drum');
  const pad = byRole.get('pad');
  const speakerGuard = HARDWARE_SPEAKER_PROFILE.guardrails;
  if (lead && comp && (lead.busShare + comp.busShare) < speakerGuard.foregroundBusShareMin) findings.push({ severity: 'warning', code: 'mix.foregroundTooSmall', detail: `lead+comp bus share ${((lead.busShare + comp.busShare) * 100).toFixed(1)}% should stay >= ${(speakerGuard.foregroundBusShareMin * 100).toFixed(0)}% on the mid-forward YD3411 target` });
  if (bass && bass.reverb > speakerGuard.bassReverbCcMax) findings.push({ severity: 'warning', code: 'space.bassTooWet', role: 'bass', detail: `bass reverb ${bass.reverb} should stay <= ${speakerGuard.bassReverbCcMax} for low-end headroom` });
  if (drum && drum.chorus !== 0) findings.push({ severity: 'warning', code: 'space.drumChorus', role: 'drum', detail: `drum chorus ${drum.chorus} should stay 0 on ESP32` });
  if (drum && drum.noteCount > 0) {
    const drumReverbMax = drum.program === 8 ? speakerGuard.roomDrumReverbCcMax : speakerGuard.drumReverbCcMax;
    if (drum.reverb > drumReverbMax) findings.push({ severity: 'warning', code: 'speaker.drumReverbTooWet', role: 'drum', detail: `drum reverb ${drum.reverb} should stay <= ${drumReverbMax} for ${HARDWARE_SPEAKER_PROFILE.model} transient clarity` });
  }
  if (drum && drum.noteCount > 0 && drum.maxVolume > speakerGuard.drumTransientCcMax) findings.push({ severity: 'warning', code: 'speaker.drumTransientTooForward', role: 'drum', detail: `drum max CC7 ${drum.maxVolume} should stay <= ${speakerGuard.drumTransientCcMax}; short hits read louder than their sustained bus share on ${HARDWARE_SPEAKER_PROFILE.model}` });
  if (pad && comp && pad.reverb < comp.reverb + 20) findings.push({ severity: 'warning', code: 'space.padBehindComp', role: 'pad', detail: `pad reverb ${pad.reverb} should be at least comp+20 (${comp.reverb + 20})` });
  if (pad && comp && Math.abs(pad.pan - comp.pan) < 22) findings.push({ severity: 'warning', code: 'space.compPadWidth', role: 'pad', detail: `comp/pad pan separation ${Math.abs(pad.pan - comp.pan)} is too narrow` });

  if (pad && pad.busShare > speakerGuard.padSustainedBusShareMax) findings.push({ severity: 'warning', code: 'mix.padTooDominant', role: 'pad', detail: `pad bus share ${(pad.busShare * 100).toFixed(1)}% can mask lead/comp on ${HARDWARE_SPEAKER_PROFILE.model}` });
  if (pad && pad.copychReverbBusShare > speakerGuard.padCopychReverbBusShareMax) findings.push({ severity: 'warning', code: 'mix.copychPadReverbDominant', role: 'pad', detail: `pad Copych reverb-input share ${(pad.copychReverbBusShare * 100).toFixed(1)}% can flood the shared room` });
  if (comp && comp.copychReverbBusShare > speakerGuard.compCopychReverbBusShareMax) findings.push({ severity: 'warning', code: 'mix.copychCompReverbDominant', role: 'comp', detail: `comp Copych reverb-input share ${(comp.copychReverbBusShare * 100).toFixed(1)}% can smear drum/piano transients` });
  if (pad && drum && drum.copychReverbInputEnergyPerBeat > EPS) {
    const ratio = pad.copychReverbInputEnergyPerBeat / drum.copychReverbInputEnergyPerBeat;
    if (pad.copychReverbBusShare > speakerGuard.padCopychReverbBusShareMax && ratio > 6) findings.push({ severity: 'warning', code: 'mix.copychPadDrumReverbRatio', role: 'pad', detail: `pad/drum Copych reverb-input ratio ${ratio.toFixed(2)}x is too high for a shared room` });
  }
  if (drum && drum.busShare > 0.34) findings.push({ severity: 'warning', code: 'mix.drumTooDominant', role: 'drum', detail: `drum bus share ${(drum.busShare * 100).toFixed(1)}% is high for the shared master` });
  const bassShareFloor = ctx.style.toLowerCase() === 'acg' ? speakerGuard.bassSustainedBusShareMinAcg : speakerGuard.bassSustainedBusShareMinDefault;
  if (bass && bass.noteCount > 0 && bass.busShare < bassShareFloor) findings.push({ severity: 'warning', code: 'mix.bassTooHidden', role: 'bass', detail: `bass bus share ${(bass.busShare * 100).toFixed(1)}% should stay >= ${(bassShareFloor * 100).toFixed(0)}% so it remains audible on ${HARDWARE_SPEAKER_PROFILE.model}` });
  const bassShareCeiling = ctx.style.toLowerCase() === 'acg' ? speakerGuard.bassSustainedBusShareMaxAcg : speakerGuard.bassSustainedBusShareMaxDefault;
  if (bass && bass.busShare > bassShareCeiling) findings.push({ severity: 'warning', code: 'mix.bassTooDominant', role: 'bass', detail: `bass bus share ${(bass.busShare * 100).toFixed(1)}% is high for small speakers` });

  const status = findings.some((f) => f.severity === 'error')
    ? 'error'
    : findings.some((f) => f.severity === 'warning')
      ? 'warning'
      : 'pass';
  return {
    status,
    standard: MASTERING_AUDIT_STANDARD,
    style: ctx.style,
    durationBeats: ctx.durationTicks / ctx.ppq,
    estimatedIntegratedLufs,
    playbackMasterLift,
    estimatedPlaybackIntegratedLufs,
    totalWetEnergyPerBeat,
    totalCopychReverbInputEnergyPerBeat,
    peakPreMasterLinear: peakPreMaster,
    estimatedDeviceOutputPeakDbfs,
    trackMetrics: trackMetricsWithShare,
    targetPlaybackIntegratedLufs: masterCalibration.targetPlaybackIntegratedLufs,
    playbackLoudnessDeltaDb,
    recommendedPlaybackMasterLift,
    findings,
  };
}
