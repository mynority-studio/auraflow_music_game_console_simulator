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

  it('同音色策略关闭时,lead/comp exact unison 可作为不同音色叠奏保留', () => {
    const draft: MusicalIRData = {
      tracks: [
        { role: 'lead', notes: [note(72)] },
        { role: 'comp', notes: [note(72), note(67)] },
      ],
      timebase,
      durationTicks: ticks(480),
    };
    const r = resolveInteractions(draft, occupation);
    const comp = r.data.tracks.find((t) => t.role === 'comp')!.notes.map((n) => n.pitch as number);
    expect(comp).toEqual([72, 67]);
    expect(r.adjustments).toBe(0);
  });

  it('同音色策略开启时,comp 不得与 lead 同 MIDI pitch 长时间重叠', () => {
    const draft: MusicalIRData = {
      tracks: [
        { role: 'lead', notes: [note(72)] },
        { role: 'comp', notes: [note(72), note(67)] },
      ],
      timebase,
      durationTicks: ticks(480),
    };
    const r = resolveInteractions(draft, occupation, {
      forbidLeadCompUnison: true,
      protectedCompFoundationKeys: new Set(['0:0']),
    });
    const comp = r.data.tracks.find((t) => t.role === 'comp')!.notes.map((n) => n.pitch as number);
    expect(comp).toEqual([67]);
    expect(r.adjustments).toBe(1);
  });

  it('可关闭 generic 小二度瘦身,但仍保留同音色 exact unison 禁止', () => {
    const draft: MusicalIRData = {
      tracks: [
        { role: 'lead', notes: [note(72)] },
        { role: 'comp', notes: [note(72), note(71)] },
      ],
      timebase,
      durationTicks: ticks(480),
    };
    const r = resolveInteractions(draft, occupation, {
      forbidLeadCompUnison: true,
      thinCompMelodyClashes: false,
    });
    const comp = r.data.tracks.find((t) => t.role === 'comp')!.notes.map((n) => n.pitch as number);
    expect(comp).toEqual([71]);
    expect(r.adjustments).toBe(1);
  });
});
