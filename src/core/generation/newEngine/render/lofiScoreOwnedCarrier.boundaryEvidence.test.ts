import { describe, expect, it } from 'vitest';
import { beats, createTimebase, midi, pc, ticks } from '../foundation';
import { freezeHarmonicPlan, type ChordSpan } from '../harmony/HarmonicPlan';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { leadAvoidExposureResolver } from './renderCoordinator';
import { applyRepeatGroupReplay } from './repeatGroupReplay';

/**
 * Boundary evidence for the LOFI score-ownership migration.
 *
 * These tests intentionally document the correct legacy behaviour of the two
 * generic final-IR transforms: they trim/rewrite ordinary generated lead
 * notes. A future `LofiLeadScorePlan` must therefore route its score-owned
 * lead around these transforms; changing either helper globally would break
 * their valid POP/RNB/Jazz responsibilities.
 */
const timebase = createTimebase({
  meter: { numerator: 4, denominator: 4 },
  tempoMap: [{ atBeat: beats(0), bpm: 84 }],
});

function span(id: string, sectionId: string, startBeat: number, durationBeats: number, root: number, quality: 'maj7' | '7'): ChordSpan {
  return {
    id,
    sectionId,
    roman: { degree: quality === '7' ? 5 : 1, accidental: 'natural', quality },
    rootPc: pc(root),
    quality,
    chordType: quality,
    startBeat: beats(startBeat),
    durationBeats: beats(durationBeats),
  };
}

function note(pitch: number, startBeat: number, durationBeats: number): NoteIR {
  return {
    pitch: midi(pitch),
    startTick: timebase.beatToTick(beats(startBeat)),
    durationTicks: timebase.beatToTick(beats(durationBeats)),
    velocity: 88,
  };
}

describe('LOFI score-owned carrier — final-IR ownership boundary evidence', () => {
  it('shows that generic repeat replay clips a carrier when its source onset is inside the replay prefix', () => {
    const arrangement = {
      meter: { numerator: 4, denominator: 4 },
      sections: [
        { id: 'verse-a', role: 'verse', bars: 1, repeatGroup: 'verse' },
        { id: 'verse-b', role: 'verse', bars: 1, repeatGroup: 'verse' },
      ],
    } as unknown as ArrangementPlan;
    // The first two beats match, but the last two form each section's link.
    // A carrier begun at beat 1.5 lasts through the source link, so replay
    // copies only its prefix fragment to beat 5.5.
    const chordTimeline = [
      span('a-body', 'verse-a', 0, 2, 0, 'maj7'),
      span('a-link', 'verse-a', 2, 2, 7, '7'),
      span('b-body', 'verse-b', 4, 2, 0, 'maj7'),
      span('b-link', 'verse-b', 6, 2, 5, '7'),
    ];
    const scoreAuthoredCarrier = note(72, 1.5, 2);
    const lead: TrackIR = { role: 'lead', notes: [scoreAuthoredCarrier] };

    const out = applyRepeatGroupReplay([lead], arrangement, chordTimeline, timebase)[0];
    const copiedCarrier = out.notes.find((event) =>
      (event.startTick as number) === (timebase.beatToTick(beats(5.5)) as number));

    expect(copiedCarrier).toMatchObject({
      pitch: midi(72),
      durationTicks: ticks(0.5 * timebase.ppq),
    });
    // The input object is not changed; the cut is introduced by replay.
    expect(scoreAuthoredCarrier.durationTicks).toBe(timebase.beatToTick(beats(2)));
  });

  it('shows that generic exposure resolution splits and re-pitches a carrier crossing an illegal harmony', () => {
    const c = span('c', 'verse', 0, 4, 0, 'maj7');
    const g = span('g', 'verse', 4, 4, 7, '7');
    const plan = freezeHarmonicPlan({
      romanProgression: [c.roman, g.roman],
      chordTimeline: [c, g],
      chordFunctionTimeline: ['T', 'D'],
      chordScaleMap: {
        c: [0, 2, 4, 5, 7, 9, 11].map(pc),
        g: [0, 2, 4, 5, 7, 9, 11].map(pc),
      },
      tensionMap: {
        c: { stable: [0, 4, 7, 11].map(pc), acceptable: [], avoid: [5].map(pc) },
        g: { stable: [7, 11, 2, 5].map(pc), acceptable: [], avoid: [0].map(pc) },
      },
      stableToneMap: {
        c: [0, 4, 7, 11].map(pc),
        g: [7, 11, 2, 5].map(pc),
      },
      colorToneMap: { c: [], g: [] },
      avoidNoteMap: { c: [5].map(pc), g: [0].map(pc) },
      borrowedChordMap: {},
      modulationMap: {},
    });
    // C is a legal Cmaj7 carrier. It becomes an explicit avoid over G7.
    const scoreAuthoredCarrier = note(72, 3, 3);

    const out = leadAvoidExposureResolver(
      [scoreAuthoredCarrier],
      plan,
      timebase,
      () => 0,
      [],
      { keyRootPc: pc(0), globalMode: 'major', isModalContext: false, tonalCharacter: 'tonal' },
    );

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      startTick: timebase.beatToTick(beats(3)),
      durationTicks: ticks(timebase.ppq),
      pitch: midi(72),
    });
    expect(out[1].startTick).toBe(timebase.beatToTick(beats(4)));
    expect([7, 11, 2, 5]).toContain((out[1].pitch as number) % 12);
    expect(scoreAuthoredCarrier.durationTicks).toBe(timebase.beatToTick(beats(3)));
  });
});
