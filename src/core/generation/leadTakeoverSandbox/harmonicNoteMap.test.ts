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
});
