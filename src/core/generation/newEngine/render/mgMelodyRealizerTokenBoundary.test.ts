import { describe, expect, it } from 'vitest';
import { buildChordPart } from './mgChordPart';
import { buildGuideTonePlan } from './mgGuideTonePlanner';
import { realizeTokens } from './mgMelodyRealizer';
import type { ScheduledToken } from './mgTokenScheduler';

const part = buildChordPart([{
  root: 'C', rootMidi: 60, type: 'maj7', bassMidi: 48, duration: 4,
}], [4, 4]);
const guideTonePlan = buildGuideTonePlan({ chordPart: part, lowMidi: 54, highMidi: 78 });
const scheduled: ScheduledToken[] = [
  { token: { kind: 'G', duration: 1 }, startBeat: 0 },
  { token: { kind: 'G', duration: 1 }, startBeat: 1 },
];

describe('MG realizer · optional score token boundary preservation', () => {
  it('keeps the ordinary repeat-merging path unchanged when the option is omitted', () => {
    const omitted = realizeTokens({ scheduledTokens: scheduled, chordPart: part, guideTonePlan });
    const explicitLegacy = realizeTokens({
      scheduledTokens: scheduled,
      chordPart: part,
      guideTonePlan,
      preserveTokenBoundaries: false,
    });
    expect(omitted).toEqual(explicitLegacy);
    expect(omitted).toHaveLength(1);
  });

  it('lets a score compiler keep one realized event per SlotBinder attack', () => {
    const scoreOwned = realizeTokens({
      scheduledTokens: scheduled,
      chordPart: part,
      guideTonePlan,
      preserveTokenBoundaries: true,
    });
    expect(scoreOwned).toHaveLength(2);
    expect(scoreOwned.map((event) => [event.time, event.duration])).toEqual([[0, 1], [1, 1]]);
    expect(scoreOwned[0]?.noteNumber).toBe(scoreOwned[1]?.noteNumber);
  });

  it('does not merge repeated LOFI terminals across two local-harmony owners', () => {
    const lofiPart = buildChordPart([
      {
        root: 'C',
        rootMidi: 60,
        type: 'maj7',
        bassMidi: 48,
        duration: 4,
        spanId: 'first',
        stableTonePcs: [0, 4, 7, 11],
        colorTonePcs: [2, 9],
        avoidTonePcs: [5],
        chordScalePcs: [0, 2, 4, 5, 7, 9, 11],
      },
      {
        root: 'C',
        rootMidi: 60,
        type: 'maj7',
        bassMidi: 48,
        duration: 4,
        spanId: 'second',
        stableTonePcs: [0, 4, 7, 11],
        colorTonePcs: [2, 9],
        avoidTonePcs: [5],
        chordScalePcs: [0, 2, 4, 5, 7, 9, 11],
      },
    ], [4, 4]);
    const lofiGuide = buildGuideTonePlan({
      chordPart: lofiPart,
      lowMidi: 54,
      highMidi: 78,
      localScaleContext: { style: 'LOFI', key: 'C', mode: 'Ionian' },
    });
    const events = realizeTokens({
      scheduledTokens: [
        { token: { kind: 'B', duration: 1 }, startBeat: 3 },
        { token: { kind: 'B', duration: 1 }, startBeat: 4 },
      ],
      chordPart: lofiPart,
      guideTonePlan: lofiGuide,
      localScaleContext: { style: 'LOFI', key: 'C', mode: 'Ionian' },
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.localHarmonySpanId)).toEqual(['first', 'second']);
    expect(events[0]?.noteNumber).toBe(events[1]?.noteNumber);
  });

  it('chooses a connected LOFI color token octave against the live score voice', () => {
    const scorePart = buildChordPart([{
      root: 'C', rootMidi: 60, type: 'maj7', bassMidi: 48, duration: 4,
      spanId: 'score-c',
      stableTonePcs: [0, 4, 7, 11],
      colorTonePcs: [2, 9],
      avoidTonePcs: [5],
      chordScalePcs: [0, 2, 4, 5, 7, 9, 11],
    }], [4, 4]);
    const stableIntent = {
      slotId: 'score-slot',
      phraseId: 'score-phrase',
      sourceSpanId: 'score-c',
      role: 'answer-riff' as const,
      phraseRole: 'variation' as const,
      harmonicScope: 'current-chord' as const,
      stableRoles: ['root', 'third', 'fifth', 'seventh'] as const,
    };
    const events = realizeTokens({
      scheduledTokens: [
        { token: { kind: 'C', duration: 0.5 }, startBeat: 0, lofiScore: stableIntent },
        {
          token: { kind: 'L', duration: 0.5 },
          startBeat: 0.5,
          lofiScore: {
            ...stableIntent,
            shortGesture: {
              class: 'connected-crawl',
              targetStartBeat: 1,
              targetSlotId: 'score-slot',
            },
          },
        },
        { token: { kind: 'C', duration: 1 }, startBeat: 1, lofiScore: stableIntent },
      ],
      chordPart: scorePart,
      initialPrevMidi: 46,
      lofiScoreRegisterRange: { lowMidi: 42, highMidi: 84 },
      localScaleContext: { style: 'LOFI', key: 'C', mode: 'Ionian' },
      preserveTokenBoundaries: true,
    });

    expect(events).toHaveLength(3);
    expect(Math.abs((events[1]?.noteNumber ?? 0) - (events[0]?.noteNumber ?? 0)))
      .toBeLessThanOrEqual(6);
    expect(Math.abs((events[2]?.noteNumber ?? 0) - (events[1]?.noteNumber ?? 0)))
      .toBeLessThanOrEqual(6);
  });

  it('treats a short LOFI gesture on a structural attack as a stable-role landing', () => {
    const scorePart = buildChordPart([{
      root: 'C', rootMidi: 60, type: 'maj7', bassMidi: 48, duration: 4,
      spanId: 'score-c',
      stableTonePcs: [0, 4, 7, 11],
      colorTonePcs: [2, 9],
      avoidTonePcs: [5],
      chordScalePcs: [0, 2, 4, 5, 7, 9, 11],
    }], [4, 4]);
    const stableIntent = {
      slotId: 'score-slot',
      phraseId: 'score-phrase',
      sourceSpanId: 'score-c',
      role: 'answer-riff' as const,
      phraseRole: 'variation' as const,
      harmonicScope: 'current-chord' as const,
      stableRoles: ['root', 'third', 'fifth', 'seventh'] as const,
      shortGesture: {
        class: 'connected-crawl' as const,
        targetStartBeat: 0.5,
        targetSlotId: 'score-slot',
      },
    };
    const events = realizeTokens({
      scheduledTokens: [{ token: { kind: 'L', duration: 0.5 }, startBeat: 0, lofiScore: stableIntent }],
      chordPart: scorePart,
      initialPrevMidi: 60,
      lofiScoreRegisterRange: { lowMidi: 48, highMidi: 84 },
      localScaleContext: { style: 'LOFI', key: 'C', mode: 'Ionian' },
      preserveTokenBoundaries: true,
    });

    expect(events).toHaveLength(1);
    expect([0, 4, 7, 11]).toContain((events[0]?.noteNumber ?? 0) % 12);
    expect(events[0]?.localAdmissionPcs).toEqual([0, 4, 7, 11]);
  });

  it('fails closed for a score-owned approach with no certified target', () => {
    const scorePart = buildChordPart([{
      root: 'C', rootMidi: 60, type: 'maj7', bassMidi: 48, duration: 4,
      spanId: 'score-c',
      stableTonePcs: [0, 4, 7, 11],
      colorTonePcs: [2, 9],
      avoidTonePcs: [5],
      chordScalePcs: [0, 2, 4, 5, 7, 9, 11],
    }], [4, 4]);
    const events = realizeTokens({
      scheduledTokens: [{
        token: { kind: 'A', duration: 0.25 },
        startBeat: 0.25,
        lofiScore: {
          slotId: 'score-slot',
          phraseId: 'score-phrase',
          sourceSpanId: 'score-c',
          role: 'answer-riff',
          phraseRole: 'variation',
          harmonicScope: 'current-chord',
          stableRoles: ['root', 'third', 'fifth', 'seventh'],
        },
      }],
      chordPart: scorePart,
      initialPrevMidi: 60,
      lofiScoreRegisterRange: { lowMidi: 48, highMidi: 84 },
      localScaleContext: { style: 'LOFI', key: 'C', mode: 'Ionian' },
      preserveTokenBoundaries: true,
    });

    expect(events).toEqual([]);
  });

  it('keeps a score-owned approach atomic when its certified target crosses a slope marker', () => {
    const scorePart = buildChordPart([{
      root: 'C', rootMidi: 60, type: 'maj7', bassMidi: 48, duration: 4,
      spanId: 'score-c',
      stableTonePcs: [0, 4, 7, 11],
      colorTonePcs: [2, 9],
      avoidTonePcs: [5],
      chordScalePcs: [0, 2, 4, 5, 7, 9, 11],
    }], [4, 4]);
    const stableIntent = {
      slotId: 'score-slot',
      phraseId: 'score-phrase',
      sourceSpanId: 'score-c',
      role: 'answer-riff' as const,
      phraseRole: 'variation' as const,
      harmonicScope: 'current-chord' as const,
      stableRoles: ['root', 'third', 'fifth', 'seventh'] as const,
    };
    const events = realizeTokens({
      scheduledTokens: [
        {
          token: { kind: 'A', duration: 0.25 },
          startBeat: 0.25,
          lofiScore: {
            ...stableIntent,
            shortGesture: {
              class: 'approach-target',
              targetStartBeat: 0.5,
              targetSlotId: 'score-slot',
            },
          },
        },
        { token: { kind: 'SlopeEnter', duration: 0, dirMin: -2, dirMax: -1 }, startBeat: 0.5 },
        { token: { kind: 'C', duration: 0.5 }, startBeat: 0.5, lofiScore: stableIntent },
      ],
      chordPart: scorePart,
      initialPrevMidi: 60,
      lofiScoreRegisterRange: { lowMidi: 48, highMidi: 84 },
      localScaleContext: { style: 'LOFI', key: 'C', mode: 'Ionian' },
      preserveTokenBoundaries: true,
    });

    expect(events.map((event) => event.time)).toEqual([0.25, 0.5]);
    expect(Math.abs((events[1]?.noteNumber ?? 0) - (events[0]?.noteNumber ?? 0))).toBe(1);
  });
});
