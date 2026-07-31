import type { InstrumentRole, MusicalIR } from '../generation/newEngine/ir/MusicalIR';

/** DREAM GM2 firmware NRPN 3707h power-up/default General Master Volume. */
export const DREAM5504_DEFAULT_MASTER_VOLUME = 127;

/** Match the project's small-speaker output ceiling without adding a browser master stage. */
export const DREAM5504_MASTER_PEAK_CEILING = Math.pow(10, -1.5 / 20);

const DREAM5504_MASTER_ROLE_WEIGHT: Record<InstrumentRole, number> = {
  lead: 1.0,
  comp: 0.58,
  bass: 0.82,
  pad: 0.42,
  drum: 1.08,
};

export interface Dream5504MasterPlan {
  /** Official GM2 NRPN 3707h value, 1..127. */
  volume: number;
  /** Applied linear gain. Generated playback keeps the board at unity. */
  gain: number;
  peakPreMasterLinear: number;
  averagePreMasterLinear: number;
  peakCeilingLinear: number;
  reason: 'unity' | 'peak-protection';
}

export interface Dream5504MasterPlanInput {
  tracks: MusicalIR['tracks'];
  ppq: number;
  durationTicks: number;
}

function mixAtTick(track: MusicalIR['tracks'][number], tick: number) {
  let mix = track.mix;
  for (const change of track.mixChanges ?? []) {
    if ((change.atTick as number) <= tick) mix = change.mix;
    else break;
  }
  return mix;
}

/**
 * Measure the final five-track score while preserving the Firm5504 power-up
 * Master. Sixteenth-note windows keep the peak estimate useful to the audit,
 * but playback no longer converts that estimate into an NRPN attenuation.
 */
export function planDream5504Master(input: Dream5504MasterPlanInput): Dream5504MasterPlan {
  const ppq = Math.max(1, Math.round(input.ppq));
  const durationTicks = Math.max(1, Math.round(input.durationTicks));
  const binTicks = Math.max(1, Math.round(ppq / 4));
  let peakPower = 0;
  let totalPowerTicks = 0;

  for (let lo = 0; lo < durationTicks; lo += binTicks) {
    const hi = Math.min(durationTicks, lo + binTicks);
    const windowTicks = hi - lo;
    let power = 0;
    for (const track of input.tracks) {
      const mix = mixAtTick(track, lo);
      if (!mix) continue;
      const volume = Math.max(0, Math.min(127, mix.volume)) / 127;
      const roleWeight = DREAM5504_MASTER_ROLE_WEIGHT[track.role];
      for (const note of track.notes) {
        const noteStart = note.startTick as number;
        const noteEnd = noteStart + (note.durationTicks as number);
        if (noteEnd <= lo || noteStart >= hi) continue;
        const overlap = (Math.min(hi, noteEnd) - Math.max(lo, noteStart)) / windowTicks;
        const amplitude = (note.velocity / 127) * volume * roleWeight;
        power += amplitude * amplitude * Math.max(0, Math.min(1, overlap));
      }
    }
    peakPower = Math.max(peakPower, power);
    totalPowerTicks += power * windowTicks;
  }

  const peakPreMasterLinear = Math.sqrt(peakPower);
  const averagePreMasterLinear = Math.sqrt(totalPowerTicks / durationTicks);
  return {
    volume: DREAM5504_DEFAULT_MASTER_VOLUME,
    gain: 1,
    peakPreMasterLinear,
    averagePreMasterLinear,
    peakCeilingLinear: DREAM5504_MASTER_PEAK_CEILING,
    reason: 'unity',
  };
}
