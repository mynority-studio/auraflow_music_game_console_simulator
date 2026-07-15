import { describe, expect, it } from 'vitest';
import { beats, createTimebase, midi, pc, ticks } from '../foundation';
import { freezeHarmonicPlan } from '../harmony/HarmonicPlan';
import type { TrackIR } from '../ir/MusicalIR';
import { leadAvoidExposureResolver } from './renderCoordinator';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const keyContext = { keyRootPc: pc(0), globalMode: 'major' as const, isModalContext: false, tonalCharacter: 'tonal' as const };

function planFor(args: {
  root: number;
  quality: 'maj7' | '7';
  chordType: string;
  stable: number[];
  color?: number[];
  scale: number[];
  avoid?: number[];
}) {
  const span = {
    id: 'c1', roman: { degree: 1 as const, accidental: 'natural' as const, quality: args.quality },
    rootPc: pc(args.root), quality: args.quality, chordType: args.chordType,
    startBeat: beats(0), durationBeats: beats(4), sectionId: 's1',
  };
  return freezeHarmonicPlan({
    romanProgression: [span.roman], chordTimeline: [span], chordFunctionTimeline: ['T'],
    chordScaleMap: { c1: args.scale.map(pc) },
    tensionMap: { c1: { stable: args.stable.map(pc), acceptable: (args.color ?? []).map(pc), avoid: (args.avoid ?? []).map(pc) } },
    stableToneMap: { c1: args.stable.map(pc) }, colorToneMap: { c1: (args.color ?? []).map(pc) },
    avoidNoteMap: { c1: (args.avoid ?? []).map(pc) }, borrowedChordMap: {}, modulationMap: {},
  });
}

describe('leadAvoidExposureResolver · authoritative intersection', () => {
  it('does not rewrite a legal sus structural tone through a narrow-quality fallback', () => {
    const plan = planFor({ root: 10, quality: '7', chordType: '7sus4', stable: [10, 3, 5, 8], scale: [10, 0, 2, 3, 5, 7, 8] });
    const notes: TrackIR['notes'] = [{ pitch: midi(75), startTick: ticks(0), durationTicks: ticks(960), velocity: 90 }]; // D# over Bb7sus4
    const out = leadAvoidExposureResolver(notes, plan, timebase, () => 0, [], keyContext);
    expect(out[0].pitch).toBe(notes[0].pitch);
  });

  it('repairs a long hard avoid only into contract ∩ scale and is idempotent', () => {
    const plan = planFor({ root: 0, quality: 'maj7', chordType: 'maj7', stable: [0, 4, 7, 11], scale: [0, 2, 4, 5, 7, 9, 11], avoid: [5] });
    const notes: TrackIR['notes'] = [
      { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(240), velocity: 88 },
      { pitch: midi(65), startTick: ticks(240), durationTicks: ticks(480), velocity: 90 },
      { pitch: midi(67), startTick: ticks(720), durationTicks: ticks(240), velocity: 88 },
    ];
    const once = leadAvoidExposureResolver(notes, plan, timebase, () => 0, [], keyContext);
    const twice = leadAvoidExposureResolver(once, plan, timebase, () => 0, [], keyContext);
    expect([0, 4, 7, 11]).toContain((once[1].pitch as number) % 12);
    expect((once[1].pitch as number) % 12).not.toBe(5);
    expect(twice).toEqual(once);
  });

  it('repairs short strong-beat landings but preserves short weak passing tones', () => {
    const plan = planFor({ root: 0, quality: 'maj7', chordType: 'maj7', stable: [0, 4, 7, 11], scale: [0, 2, 4, 5, 7, 9, 11], avoid: [5] });
    const notes: TrackIR['notes'] = [
      { pitch: midi(62), startTick: ticks(0), durationTicks: ticks(120), velocity: 90 },
      { pitch: midi(62), startTick: ticks(240), durationTicks: ticks(120), velocity: 82 },
    ];
    const out = leadAvoidExposureResolver(notes, plan, timebase, () => 0, [], keyContext);
    expect([0, 4, 7, 11]).toContain((out[0].pitch as number) % 12);
    expect(out[1].pitch).toBe(notes[1].pitch);
  });

  it('splits and resolves a long sustain that becomes illegal in the next chord', () => {
    const c = { id: 'c1', roman: { degree: 1 as const, accidental: 'natural' as const, quality: 'maj7' as const }, rootPc: pc(0), quality: 'maj7' as const, chordType: 'maj7', startBeat: beats(0), durationBeats: beats(4), sectionId: 's1' };
    const g = { id: 'c2', roman: { degree: 5 as const, accidental: 'natural' as const, quality: '7' as const }, rootPc: pc(7), quality: '7' as const, chordType: '7', startBeat: beats(4), durationBeats: beats(4), sectionId: 's1' };
    const plan = freezeHarmonicPlan({
      romanProgression: [c.roman, g.roman], chordTimeline: [c, g], chordFunctionTimeline: ['T', 'D'],
      chordScaleMap: { c1: [0, 2, 4, 5, 7, 9, 11].map(pc), c2: [0, 2, 4, 5, 7, 9, 11].map(pc) },
      tensionMap: {
        c1: { stable: [0, 4, 7, 11].map(pc), acceptable: [], avoid: [5].map(pc) },
        c2: { stable: [7, 11, 2, 5].map(pc), acceptable: [], avoid: [0].map(pc) },
      },
      stableToneMap: { c1: [0, 4, 7, 11].map(pc), c2: [7, 11, 2, 5].map(pc) },
      colorToneMap: { c1: [], c2: [] }, avoidNoteMap: { c1: [5].map(pc), c2: [0].map(pc) },
      borrowedChordMap: {}, modulationMap: {},
    });
    const notes: TrackIR['notes'] = [{ pitch: midi(72), startTick: ticks(1440), durationTicks: ticks(1440), velocity: 90 }];
    const once = leadAvoidExposureResolver(notes, plan, timebase, () => 0, [], keyContext);
    const twice = leadAvoidExposureResolver(once, plan, timebase, () => 0, [], keyContext);
    expect(once).toHaveLength(2);
    expect(once[0].startTick).toBe(1440);
    expect(once[0].durationTicks).toBe(480);
    expect(once[1].startTick).toBe(1920);
    expect([7, 11, 2, 5]).toContain((once[1].pitch as number) % 12);
    expect(twice).toEqual(once);
  });
});
