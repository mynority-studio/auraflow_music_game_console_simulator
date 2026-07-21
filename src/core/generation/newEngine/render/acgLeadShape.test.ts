import { describe, expect, it } from 'vitest';
import { midi, ticks } from '../foundation';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { TrackIR } from '../ir/MusicalIR';
import { repairAcgLeadGaps } from './acgLeadShape';

const PPQ = 480;
const lead: TrackIR = {
  role: 'lead',
  notes: [
    { pitch: midi(72), startTick: ticks(0), durationTicks: ticks(PPQ / 2), velocity: 86 },
    { pitch: midi(74), startTick: ticks(PPQ * 12), durationTicks: ticks(PPQ / 2), velocity: 86 },
  ],
};
const timeline = [{
  id: 'i', sectionId: 'intro', rootPc: 0, chordType: 'maj',
  startBeat: 0, durationBeats: 16,
}] as unknown as ChordSpan[];

describe('render/acgLeadShape · planned silence', () => {
  it('planned rest window blocks automatic ACG gap filling', () => {
    const protectedRest = { startTick: PPQ * 3, endTick: PPQ * 9 };
    const repaired = repairAcgLeadGaps(lead, timeline, PPQ, [protectedRest]);

    expect(repaired.notes.length).toBeGreaterThan(lead.notes.length);
    expect(repaired.notes.filter((note) => note !== lead.notes[0] && note !== lead.notes[1])
      .every((note) => {
        const start = note.startTick as number;
        const end = start + (note.durationTicks as number);
        return end <= protectedRest.startTick || start >= protectedRest.endTick;
      })).toBe(true);
  });
});
