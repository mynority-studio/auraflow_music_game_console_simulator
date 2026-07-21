import { describe, expect, it } from 'vitest';
import {
  BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID,
  COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID,
  LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
  TAKE_FIVE_ROLE_RHYTHM_SOURCE_SHA256,
  bassRoleRhythmPattern,
  compRoleRhythmPattern,
  leadRoleRhythmPattern,
} from './roleRhythmPatterns';

describe('knowledge/roleRhythmPatterns', () => {
  it('registers the MIDI-derived 5/4 Bass vamp and Comp foundation handoff', () => {
    const bass = bassRoleRhythmPattern(BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID)!;
    const comp = compRoleRhythmPattern(COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID)!;
    const lead = leadRoleRhythmPattern(LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID)!;

    expect(bass.beatsPerBar).toBe(5);
    expect(bass.cells.map((cell) => cell.phaseBeats)).toEqual([0, 157 / 96, 3]);
    expect(bass.cells.map(({ durationBeats, velocity }) => ({ durationBeats, velocity }))).toEqual([
      { durationBeats: 86 / 192, velocity: 76 },
      { durationBeats: 60 / 192, velocity: 94 },
      { durationBeats: 278 / 192, velocity: 90 },
    ]);
    expect(comp.cells.map((cell) => cell.phaseBeats)).toEqual([0, 61 / 96, 157 / 96, 2, 3, 4]);
    expect(comp.cells.map(({ durationBeats, velocity }) => ({ durationBeats, velocity }))).toEqual([
      { durationBeats: 86 / 192, velocity: 76 },
      { durationBeats: 30 / 192, velocity: 81 },
      { durationBeats: 60 / 192, velocity: 94 },
      { durationBeats: 46 / 192, velocity: 81 },
      { durationBeats: 278 / 192, velocity: 90 },
      { durationBeats: 64 / 192, velocity: 85 },
    ]);
    expect(comp.cells.filter((cell) => cell.voiceAction === 'chord').map((cell) => cell.voiceDurationBeats))
      .toEqual([
        [30 / 192, 16 / 192, 32 / 192],
        [46 / 192, 22 / 192, 26 / 192],
        [64 / 192, 64 / 192, 66 / 192],
      ]);
    expect(comp.cells.map((cell) => cell.voiceAction)).toEqual([
      'foundation', 'chord', 'foundation', 'chord', 'foundation', 'chord',
    ]);
    expect(comp.cells.filter((cell) => cell.voiceAction === 'foundation').map((cell) => cell.phaseBeats))
      .toEqual(bass.cells.map((cell) => cell.phaseBeats));
    expect(comp.cells.map((cell) => cell.phaseBeats))
      .not.toEqual(bass.cells.map((cell) => cell.phaseBeats));

    expect(lead).toMatchObject({
      realization: 'grammar-marker',
      grammarMarker: LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID,
      beatsPerBar: 5,
    });
    expect('cells' in lead).toBe(false);
    expect([bass, comp, lead].every((pattern) =>
      pattern.source.sha256 === TAKE_FIVE_ROLE_RHYTHM_SOURCE_SHA256)).toBe(true);
  });

  it('does not accept a registered ID under the wrong role', () => {
    expect(bassRoleRhythmPattern(COMP_JAZZ_FIVE_FOUR_PIANO_INTERLOCK_PATTERN_ID)).toBeUndefined();
    expect(compRoleRhythmPattern(LEAD_JAZZ_FIVE_FOUR_PHRASE_PATTERN_ID)).toBeUndefined();
    expect(leadRoleRhythmPattern(BASS_JAZZ_FIVE_FOUR_OSTINATO_PATTERN_ID)).toBeUndefined();
  });
});
