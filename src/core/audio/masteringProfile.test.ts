import { describe, expect, it } from 'vitest';
import { midi, ticks } from '../generation/newEngine/foundation';
import type { TrackIR } from '../generation/newEngine/ir/MusicalIR';
import { DREAM5504_DEFAULT_MASTER_VOLUME, DREAM5504_MASTER_PEAK_CEILING, planDream5504Master } from './masteringProfile';

describe('masteringProfile · Dream 5504 default-master audit', () => {
  const plan = (tracks: TrackIR[]) => planDream5504Master({ tracks, ppq: 480, durationTicks: 960 });

  it('leaves sparse material at the documented board default', () => {
    const sparse: TrackIR[] = [{
      role: 'lead',
      mix: { volume: 100, pan: 64, reverb: 0, chorus: 0 },
      notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(960), velocity: 72 }],
    }];
    const master = plan(sparse);
    expect(master.volume).toBe(DREAM5504_DEFAULT_MASTER_VOLUME);
    expect(master.reason).toBe('unity');
  });

  it('reports dense overlap without attenuating the board Master', () => {
    const dense: TrackIR[] = [
      {
        role: 'lead', mix: { volume: 100, pan: 64, reverb: 0, chorus: 0 },
        notes: [{ pitch: midi(76), startTick: ticks(0), durationTicks: ticks(480), velocity: 122 }],
      },
      {
        role: 'comp', mix: { volume: 100, pan: 64, reverb: 0, chorus: 0 },
        notes: [60, 64, 67, 71].map((pitch) => ({ pitch: midi(pitch), startTick: ticks(0), durationTicks: ticks(480), velocity: 120 })),
      },
      {
        role: 'drum', mix: { volume: 100, pan: 64, reverb: 0, chorus: 0 },
        notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(120), velocity: 127 }],
      },
    ];
    const master = plan(dense);
    expect(master.volume).toBe(DREAM5504_DEFAULT_MASTER_VOLUME);
    expect(master.gain).toBe(1);
    expect(master.reason).toBe('unity');
    expect(master.peakPreMasterLinear).toBeGreaterThan(DREAM5504_MASTER_PEAK_CEILING);
  });
});
