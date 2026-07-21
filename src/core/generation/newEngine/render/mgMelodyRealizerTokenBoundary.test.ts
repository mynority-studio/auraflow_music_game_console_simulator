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
});
