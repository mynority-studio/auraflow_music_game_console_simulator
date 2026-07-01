import { describe, expect, it } from 'vitest';
import { buildTakeoverPadMap, findChordAtBeat } from './harmonicNoteMap';
import { takeoverPadCoord, takeoverPadIndex } from './padLayout';
import type { TakeoverMusicSnapshot } from './types';

const snapshot: TakeoverMusicSnapshot = {
  styleHint: 'jazz',
  key: 'C',
  tonality: 'major',
  bpm: 120,
  timeSignature: [4, 4],
  chords: [
    { rootPc: 2, quality: 'm7', roman: 'ii', startBeat: 0, durationBeats: 4, sectionId: 'A' },
    { rootPc: 7, quality: '7', roman: 'V', startBeat: 4, durationBeats: 4, sectionId: 'A' },
    { rootPc: 0, quality: 'maj7', roman: 'I', startBeat: 8, durationBeats: 4, sectionId: 'A' },
  ],
};

describe('leadTakeoverSandbox/harmonicNoteMap', () => {
  it('uses reading-order 3x5 pad indices', () => {
    expect(takeoverPadIndex(0, 0)).toBe(0);
    expect(takeoverPadIndex(4, 0)).toBe(4);
    expect(takeoverPadIndex(0, 1)).toBe(5);
    expect(takeoverPadIndex(4, 2)).toBe(14);
    expect(takeoverPadCoord(13)).toEqual({ col: 3, row: 2 });
  });

  it('finds current and next chord by beat', () => {
    expect(findChordAtBeat(snapshot.chords, 0).current?.roman).toBe('ii');
    expect(findChordAtBeat(snapshot.chords, 4.5).current?.roman).toBe('V');
    expect(findChordAtBeat(snapshot.chords, 4.5).next?.roman).toBe('I');
  });

  it('builds 15 ascending safe lead notes from the orthogonal pitch pool', () => {
    const map = buildTakeoverPadMap(snapshot, 4.25);
    expect(map.source).toBe('orthogonal');
    expect(map.cells).toHaveLength(15);

    const midis = map.cells.map((c) => c.midi);
    expect(midis).toEqual([...midis].sort((a, b) => a - b));

    const allowedPcs = new Set(map.cells.map((c) => c.pc));
    // G7 in jazz should have the dominant identity present and no fully chromatic spill.
    expect(allowedPcs.has(7)).toBe(true);
    expect(allowedPcs.has(11)).toBe(true);
    expect(new Set(map.cells.map((c) => c.classRole)).has('fallback')).toBe(false);
  });

  it('uses KB tension filtering instead of fixed pentatonic deletion', () => {
    const cmaj: TakeoverMusicSnapshot = {
      ...snapshot,
      styleHint: 'pop',
      chords: [
        { rootPc: 0, quality: 'maj7', roman: 'I', startBeat: 0, durationBeats: 4, sectionId: 'A' },
      ],
    };
    const map = buildTakeoverPadMap(cmaj, 0);
    const pcs = new Set(map.cells.map((c) => c.pc));

    expect(pcs.has(11)).toBe(true); // B = maj7 color, not removed by "drop 7"
    expect(pcs.has(5)).toBe(false); // F = natural 11 avoid over Cmaj7
    expect(pcs.has(2)).toBe(true);  // D = 9, safe supplement
    expect(pcs.has(9)).toBe(true);  // A = 13, safe supplement
  });

  it('starts pad spreading in the C3-C5 register and labels tensions as 9/13', () => {
    const cmaj: TakeoverMusicSnapshot = {
      ...snapshot,
      styleHint: 'pop',
      chords: [
        { rootPc: 0, quality: 'maj7', roman: 'I', startBeat: 0, durationBeats: 4, sectionId: 'A' },
      ],
    };
    const map = buildTakeoverPadMap(cmaj, 0);
    const dCell = map.cells.find((c) => c.pc === 2);
    const aCell = map.cells.find((c) => c.pc === 9);
    const lowD = map.cells.find((c) => c.midi === 50);
    const lowA = map.cells.find((c) => c.midi === 57);

    expect(map.cells[0]?.midi).toBe(48); // C3
    expect(lowD).toBeUndefined();
    expect(lowA).toBeUndefined();
    expect(dCell?.midi).toBe(62); // D4 = 9 above C3
    expect(dCell?.degreeLabel).toBe('9');
    expect(aCell?.midi).toBe(69); // A4 = 13 above C3
    expect(aCell?.degreeLabel).toBe('13');
  });
});
