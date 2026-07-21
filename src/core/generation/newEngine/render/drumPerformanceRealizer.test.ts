import { describe, expect, it } from 'vitest';
import { createTimebase, midi, ticks } from '../foundation';
import type { DrumPerformanceContract, GrooveScorePlan } from '../arranger/ArrangementPlan';
import { DRUM } from '../knowledge/grooves';
import { realizeDrumPerformanceTrack } from './drumPerformanceRealizer';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: 0 as never, bpm: 100 }] });
const sid = 'verse';
const score: GrooveScorePlan = {
  grooveContractId: 'rnb_dilla_pocket',
  bySection: {
    [sid]: {
      sectionId: sid, grooveContractId: 'rnb_dilla_pocket',
      bars: [0, 1, 2, 3].map((absoluteBar) => ({
        sectionId: sid, absoluteBar, barInSection: absoluteBar,
        phraseIndex: 0, phraseBarIndex: absoluteBar,
        role: absoluteBar === 3 ? 'turnaround' : absoluteBar === 1 ? 'answer' : 'base',
        beatStrength: [1, 0.9, 1, 0.88], subdivision: 'sixteenth',
        subdivisionAccent: [1, 0.62, 0.82, 0.58], phraseAccent: 1,
        drumInteraction: {
          kickFollow: 'bass', snareFollow: 'backbeat', structuralKickBeats: [0],
          structuralSnareBeats: [1, 3], kickResponseLimit: 2, snareResponseLimit: 0,
        },
      })),
    },
  },
  boundaries: [],
};
const performance: DrumPerformanceContract = {
  id: 'test', sectionId: sid, grooveContractId: 'rnb_dilla_pocket', feelProfileId: 'rnb-dilla-voices',
  role: 'timekeeper', kitProgram: 25, patternFamily: 'tr808-dilla-pocket', complexity: 3, intensity: 2,
  densityCeiling: 1, entryMode: 'full', fillPolicy: 'none', fillAmount: 0, fillComplexity: 0,
  phraseVariation: 3, timingProfile: 'dilla-late', maxMoveTicks: 40, humanizeAmount: 3,
  feelOffsetMs: 12, velocityProfile: 'ghosted', kickPolicy: 'syncopated', snarePolicy: 'ghost-before-backbeat',
  hatPolicy: 'sixteenths', cymbalPolicy: 'none', tomPolicy: 'none', foregroundGuard: 'normal',
};
const note = (pitch: number, beat: number, velocity = 80) => ({
  pitch: midi(pitch), startTick: ticks(Math.round(beat * timebase.ppq)), durationTicks: ticks(120), velocity,
});
const realize = (notes: ReturnType<typeof note>[]) => realizeDrumPerformanceTrack({ role: 'drum', notes }, {
  timebase, beatsPerBar: 4, tempoBpm: 100, grooveScorePlan: score, performanceBySection: { [sid]: performance },
});

describe('drum performance realizer', () => {
  it('is a bit-transparent boundary for a compiled reference-zero score', () => {
    const reference = {
      role: 'drum' as const,
      notes: [
        { pitch: midi(35), startTick: ticks(0), durationTicks: ticks(10), velocity: 94 },
        { pitch: midi(51), startTick: ticks(0), durationTicks: ticks(10), velocity: 92 },
        { pitch: midi(51), startTick: ticks(480), durationTicks: ticks(10), velocity: 92 },
      ],
    };
    const out = realizeDrumPerformanceTrack(reference, {
      timebase,
      beatsPerBar: 5,
      tempoBpm: 167,
      grooveScorePlan: score,
      performanceBySection: { [sid]: performance },
      performanceMode: 'reference-zero',
    });
    expect(out).toBe(reference);
    expect(out.notes).toEqual(reference.notes);
  });

  it('turns equal raw velocities into accent/ghost hierarchy and voice-specific pocket', () => {
    const out = realize([
      note(DRUM.KICK, 0), note(DRUM.KICK, 0.75),
      note(DRUM.SNARE, 0.75), note(DRUM.SNARE, 1),
      note(DRUM.CHAT, 0), note(DRUM.CHAT, 0.5),
    ]);
    const at = (pitch: number, approximateBeat: number) => out.notes.find((event) =>
      (event.pitch as number) === pitch
      && Math.abs((event.startTick as number) / timebase.ppq - approximateBeat) < 0.15)!;
    expect(at(DRUM.SNARE, 1).velocity - at(DRUM.SNARE, 0.75).velocity).toBeGreaterThan(35);
    expect(at(DRUM.CHAT, 0).velocity).toBeGreaterThan(at(DRUM.CHAT, 0.5).velocity);
    expect(at(DRUM.SNARE, 1).startTick as number).toBeGreaterThan(timebase.ppq);
    expect(at(DRUM.KICK, 0).startTick as number).toBe(0);
  });

  it('enforces two hand surfaces and lets crash replace the timekeeper hand', () => {
    const out = realize([
      note(DRUM.KICK, 0), note(DRUM.SNARE, 0), note(DRUM.TOM_HI, 0),
      note(DRUM.CHAT, 0), note(DRUM.CRASH, 0), note(DRUM.CLAP, 0),
    ]);
    const pitches = out.notes.map((event) => event.pitch as number);
    expect(pitches).toContain(DRUM.KICK);
    expect(pitches).toContain(DRUM.CRASH);
    expect(pitches).not.toContain(DRUM.CHAT);
    expect(pitches.filter((pitch) => [DRUM.SNARE, DRUM.TOM_HI, DRUM.CRASH].includes(pitch as never)).length)
      .toBeLessThanOrEqual(2);
  });

  it('treats millisecond-close follow hits as one physical two-hand stroke', () => {
    const close = (pitch: number, startTick: number) => ({ ...note(pitch, 0), startTick: ticks(startTick) });
    const out = realize([
      close(DRUM.CRASH, 0), close(DRUM.SNARE, 3), close(DRUM.TOM_HI, 5), close(DRUM.KICK, 0),
    ]);
    const hands = out.notes.filter((event) =>
      [DRUM.CRASH, DRUM.SNARE, DRUM.TOM_HI].includes(event.pitch as never));
    expect(hands).toHaveLength(2);
    expect(out.notes.some((event) => (event.pitch as number) === DRUM.KICK)).toBe(true);
  });

  it('applies an explicit alternating-hand pulse to driving sixteenths', () => {
    const out = realizeDrumPerformanceTrack({
      role: 'drum', notes: [note(DRUM.CHAT, 0.25, 60), note(DRUM.CHAT, 0.5, 60)],
    }, {
      timebase, beatsPerBar: 4, tempoBpm: 100, grooveScorePlan: score,
      performanceBySection: {
        [sid]: { ...performance, feelProfileId: 'pop-driving-rock' },
      },
    });
    const hats = [...out.notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
    expect(hats[1].velocity).toBeGreaterThan(hats[0].velocity);
  });

  it('is deterministic and lets a following closed hat choke an open hat', () => {
    const input = [note(DRUM.OHAT, 2.5, 50), note(DRUM.CHAT, 3, 50)];
    const a = realize(input);
    const b = realize(input);
    expect(a).toEqual(b);
    const open = a.notes.find((event) => (event.pitch as number) === DRUM.OHAT)!;
    const closed = a.notes.find((event) => (event.pitch as number) === DRUM.CHAT)!;
    expect((open.startTick as number) + (open.durationTicks as number)).toBeLessThan(closed.startTick as number);
  });

  it('consumes kit capability projection for native Brush articulations', () => {
    const out = realizeDrumPerformanceTrack({ role: 'drum', notes: [note(DRUM.SIDESTICK, 1)] }, {
      timebase, beatsPerBar: 4, tempoBpm: 100, grooveScorePlan: score,
      performanceBySection: {
        [sid]: { ...performance, kitProgram: 40, feelProfileId: 'jazz-brush-ballad' },
      },
    });
    expect(out.notes[0].pitch as number).toBe(DRUM.CLAP);
  });
});
