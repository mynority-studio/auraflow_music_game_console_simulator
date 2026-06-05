import { describe, it, expect } from 'vitest';
import { resolveInteractions } from './interactionResolver';
import type { MusicalIRData, TrackIR } from '../ir/MusicalIR';
import type { OccupationMap } from './OccupationMap';
import { createTimebase, midi, ticks } from '../foundation';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const note = (pitch: number): TrackIR['notes'][number] => ({ pitch: midi(pitch), startTick: ticks(0), durationTicks: ticks(480), velocity: 80 });

const occupation: OccupationMap = {
  occupiedRegisters: [
    { role: 'bass', lowMidi: 36, highMidi: 47 },
    { role: 'comp', lowMidi: 48, highMidi: 59 },
  ],
  onsetTicks: [0],
  reservedMelodyRegister: { lowMidi: 67, highMidi: 84 },
};

describe('render/interactionResolver', () => {
  it('无 collision(lead 在预留区)→ 不改,adjustments=0', () => {
    const draft: MusicalIRData = { tracks: [{ role: 'lead', notes: [note(72)] }], timebase, durationTicks: ticks(480) };
    const r = resolveInteractions(draft, occupation);
    expect(r.adjustments).toBe(0);
    expect(r.data.tracks[0].notes[0].pitch).toBe(72);
  });

  it('★ Loop 9:lead 落进 comp 音域 → 不上移(MG 旋律权威,resolver 保留;碰撞改由 comp 让位)', () => {
    const draft: MusicalIRData = { tracks: [{ role: 'lead', notes: [note(55)] }], timebase, durationTicks: ticks(480) };
    const r = resolveInteractions(draft, occupation);
    expect(r.adjustments).toBe(0);
    expect(r.data.tracks[0].notes[0].pitch).toBe(55); // lead 原样保留(不再上移八度)
  });

  it('非 lead 轨不动', () => {
    const bass: TrackIR = { role: 'bass', notes: [note(40)] };
    const draft: MusicalIRData = { tracks: [bass], timebase, durationTicks: ticks(480) };
    const r = resolveInteractions(draft, occupation);
    expect(r.adjustments).toBe(0);
    expect(r.data.tracks[0].notes[0].pitch).toBe(40);
  });
});
