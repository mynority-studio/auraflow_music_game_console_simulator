import { describe, it, expect } from 'vitest';
import { buildOccupationMap } from './OccupationMap';
import type { TrackIR } from '../ir/MusicalIR';
import { midi, ticks } from '../foundation';

const note = (pitch: number, tick: number): TrackIR['notes'][number] => ({
  pitch: midi(pitch),
  startTick: ticks(tick),
  durationTicks: ticks(480),
  velocity: 80,
});

describe('render/OccupationMap', () => {
  const tracks: TrackIR[] = [
    { role: 'bass', notes: [note(36, 0), note(43, 480)] },
    { role: 'comp', notes: [note(48, 0), note(59, 0)] },
    { role: 'lead', notes: [note(72, 0)] },
  ];
  const occ = buildOccupationMap(tracks, { lowMidi: 67, highMidi: 84 });

  it('每非 lead 轨记音域;lead 不入 occupiedRegisters', () => {
    const roles = occ.occupiedRegisters.map((o) => o.role);
    expect(roles).toEqual(['bass', 'comp']);
    const bass = occ.occupiedRegisters.find((o) => o.role === 'bass')!;
    expect(bass.lowMidi).toBe(36);
    expect(bass.highMidi).toBe(43);
  });

  it('起音 tick 升序去重', () => {
    expect(occ.onsetTicks).toEqual([0, 480]);
  });

  it('携带 lead 预留区', () => {
    expect(occ.reservedMelodyRegister).toEqual({ lowMidi: 67, highMidi: 84 });
  });
});
