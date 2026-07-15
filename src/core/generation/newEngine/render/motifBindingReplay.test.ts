import { describe, expect, it } from 'vitest';
import { beats, createTimebase, midi, pc, ticks } from '../foundation';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { TrackIR } from '../ir/MusicalIR';
import { applyMotifBindingReplay, planMotifBindingReplays } from './repeatGroupReplay';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 80 }] });

const arrangement = {
  meter: { numerator: 4, denominator: 4 },
  sections: [
    { id: 'themeA', role: 'verse', bars: 4, repeatGroup: 'A', hookPolicy: 'light' },
    { id: 'themeA2', role: 'verse', bars: 4, repeatGroup: 'A', hookPolicy: 'light' },
  ],
  phrases: [
    { id: 'themeA-p0', sectionId: 'themeA', bars: 4, phraseSlot: 0, role: 'cadence', cadenceTarget: 'authentic', repeatGroup: 'A', skeletonRole: 'hook' },
    { id: 'themeA2-p0', sectionId: 'themeA2', bars: 4, phraseSlot: 0, role: 'cadence', cadenceTarget: 'authentic', repeatGroup: 'A', skeletonRole: 'hook' },
  ],
  motifBindings: [
    { id: 'themeA-p0-b', motifId: 'm-A-h', phraseId: 'themeA-p0', repeatGroup: 'A', requestedRestatementStrength: 0.5 },
    { id: 'themeA2-p0-b', motifId: 'm-A-h', phraseId: 'themeA2-p0', repeatGroup: 'A', requestedRestatementStrength: 0.5 },
  ],
} as unknown as ArrangementPlan;

const span = (id: string, sectionId: string, start: number): ChordSpan => ({
  id,
  sectionId,
  roman: { degree: 1, accidental: 'natural', quality: 'maj' },
  rootPc: pc(0),
  quality: 'maj',
  startBeat: beats(start),
  durationBeats: beats(16),
});

const chordTimeline = [span('a', 'themeA', 0), span('a2', 'themeA2', 16)];
const note = (pitch: number, beat: number): TrackIR['notes'][number] => ({
  pitch: midi(pitch), startTick: timebase.beatToTick(beats(beat)), durationTicks: ticks(360), velocity: 80,
});

describe('render/motifBindingReplay', () => {
  it('同 motif 的主题 body 重放，目标句最后一小节保留为 A′ 回答', () => {
    const plans = planMotifBindingReplays(arrangement, chordTimeline, timebase);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ sourcePhraseId: 'themeA-p0', targetPhraseId: 'themeA2-p0', prefixTicks: 12 * timebase.ppq });

    const lead: TrackIR = {
      role: 'lead',
      notes: [note(60, 0), note(62, 4), note(64, 12), note(70, 16), note(71, 20), note(75, 28)],
    };
    const out = applyMotifBindingReplay([lead], arrangement, chordTimeline, timebase)[0];
    const pitchAt = (beat: number) => out.notes.find((event) => (event.startTick as number) === (timebase.beatToTick(beats(beat)) as number))?.pitch;
    expect(pitchAt(16)).toBe(60);
    expect(pitchAt(20)).toBe(62);
    expect(pitchAt(28)).toBe(75);
  });
});
