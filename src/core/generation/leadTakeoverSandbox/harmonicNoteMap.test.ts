import { describe, expect, it } from 'vitest';
import { buildAscendingTwoOctaveCells, buildTakeoverPadMap, findChordAtBeat } from './harmonicNoteMap';
import { TAKEOVER_ASCENDING_PAD_INDICES, takeoverPadCoord, takeoverPadIndex } from './padLayout';
import type { TakeoverMusicSnapshot } from './types';
import { listChordTypes, type ChordQuality } from '../newEngine/knowledge/chords';

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

function qForChordType(chordType: string): ChordQuality {
  if (chordType === 'm7b5' || chordType === 'm9b5') return 'm7b5';
  if (chordType === 'dim' || chordType === 'dim7') return 'dim7';
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) return 'm7';
  if (chordType.startsWith('maj') || chordType === '6' || chordType === '6/9' || chordType === 'add9') return 'maj7';
  if (chordType.includes('7') || chordType.includes('9') || chordType.includes('11') || chordType.includes('13') || chordType.includes('sus')) return '7';
  if (chordType === 'min') return 'min';
  return 'maj';
}

function intervalClass(a: number, b: number): number {
  const d = ((a - b) % 12 + 12) % 12;
  return Math.min(d, 12 - d);
}

describe('leadTakeoverSandbox/harmonicNoteMap', () => {
  it('uses reading-order 3x5 pad indices', () => {
    expect(takeoverPadIndex(0, 0)).toBe(0);
    expect(takeoverPadIndex(4, 0)).toBe(4);
    expect(takeoverPadIndex(0, 1)).toBe(5);
    expect(takeoverPadIndex(4, 2)).toBe(14);
    expect(takeoverPadCoord(13)).toEqual({ col: 3, row: 2 });
    expect(TAKEOVER_ASCENDING_PAD_INDICES).toEqual([
      0, 1, 2, 3, 4,
      5, 6, 7, 8, 9,
      10, 11, 12, 13, 14,
    ]);
  });

  it('finds current and next chord by beat', () => {
    expect(findChordAtBeat(snapshot.chords, 0).current?.roman).toBe('ii');
    expect(findChordAtBeat(snapshot.chords, 4.5).current?.roman).toBe('V');
    expect(findChordAtBeat(snapshot.chords, 4.5).next?.roman).toBe('I');
  });

  it('places safe notes from top-left to bottom-right without reversing repeated chord tones', () => {
    const cells = buildAscendingTwoOctaveCells([0, 2, 4, 5, 7], {
      chordPcs: new Set([0, 4, 7]),
      scalePcs: new Set([2, 5]),
      approachPcs: new Set(),
      rootPc: 0,
    });

    const ordered = TAKEOVER_ASCENDING_PAD_INDICES.map((idx) => cells[idx]?.midi ?? -1);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(cells[0]?.name).toBe('C4');
    expect(cells[14]?.name).toBe('C6');
  });

  it('builds 15 top-left-to-bottom-right safe lead notes from the orthogonal pitch pool', () => {
    const map = buildTakeoverPadMap(snapshot, 4.25);
    expect(map.source).toBe('orthogonal');
    expect(map.cells).toHaveLength(15);

    const midis = map.cells.map((c) => c.midi);
    const ordered = TAKEOVER_ASCENDING_PAD_INDICES.map((idx) => map.cells[idx]?.midi ?? -1);
    expect(Math.max(...midis) - Math.min(...midis)).toBeLessThanOrEqual(24);
    expect(ordered[0]).toBe(67); // G4 starts at top-left for G7.
    expect(Math.min(...midis)).toBeGreaterThanOrEqual(67);
    expect(Math.max(...midis)).toBeLessThanOrEqual(91);

    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));

    const allowedPcs = new Set(map.cells.map((c) => c.pc));
    // G7 in jazz should have the dominant identity present and no fully chromatic spill.
    expect(allowedPcs.has(7)).toBe(true);
    expect(allowedPcs.has(11)).toBe(true);
    expect(new Set(map.cells.map((c) => c.classRole)).has('fallback')).toBe(false);
  });

  it('uses analyzed current-measure notes when selection mode is active', () => {
    const map = buildTakeoverPadMap({
      ...snapshot,
      source: 'midi-analysis',
      layoutMode: 'measure-notes',
      measures: [{
        id: 'm1',
        label: 'M1',
        startBeat: 0,
        durationBeats: 4,
        notes: [{
          id: 'source-c3',
          sourceMidi: 48,
          priority: 400,
          structuralRole: 'backbone',
          metricLevel: 'downbeat',
          melodicFunction: 'chordTone',
        }, {
          id: 'source-d3',
          sourceMidi: 50,
          priority: 120,
          structuralRole: 'ornament',
          metricLevel: 'offbeat',
          melodicFunction: 'passingTone',
        }],
      }],
    }, 1);

    expect(map.source).toBe('midi-measure-notes');
    expect(map.measure?.label).toBe('M1');
    expect(new Set(map.cells.map((cell) => cell.midi)))
      .toEqual(new Set([60, 62, 72, 74, 84]));
    expect(map.cells.some((cell) =>
      cell.midi === 60 && cell.classRole === 'structural')).toBe(true);
    expect(map.cells.some((cell) =>
      cell.midi === 62 && cell.classRole === 'ornament')).toBe(true);
  });

  it('keeps generated music on the original harmonic takeover chain even if a MIDI layout flag is stale', () => {
    const map = buildTakeoverPadMap({
      ...snapshot,
      source: 'generated',
      layoutMode: 'measure-notes',
      measures: [{
        id: 'stale-midi',
        label: 'M1',
        startBeat: 0,
        durationBeats: 4,
        notes: [{
          id: 'should-not-drive-generated-mode',
          sourceMidi: 99,
          priority: 999,
          structuralRole: 'backbone',
          metricLevel: 'downbeat',
          melodicFunction: 'chordTone',
        }],
      }],
    }, 1);

    expect(map.source).toBe('orthogonal');
    expect(map.cells.some((cell) => cell.classRole === 'structural')).toBe(false);
  });

  it('keeps jazz takeover supplement tones free of half-step clashes for every chord macro', () => {
    for (const chordType of listChordTypes()) {
      const map = buildTakeoverPadMap({
        ...snapshot,
        chords: [{ rootPc: 0, quality: qForChordType(chordType), chordType, roman: 'I', startBeat: 0, durationBeats: 4, sectionId: 'A' }],
      }, 0);
      const structuralPcs = new Set(map.cells.filter((c) => c.classRole === 'chord').map((c) => c.pc));
      const supplementCells = map.cells.filter((c) => c.classRole === 'scale');

      for (const cell of supplementCells) {
        for (const structuralPc of structuralPcs) {
          expect(intervalClass(cell.pc, structuralPc), `${chordType} supplement ${cell.name} against pc${structuralPc}`).not.toBe(1);
        }
      }
    }
  });

  it('removes generic jazz colors that need melodic resolution from plain seventh chords', () => {
    const cases: Array<{ chordType: string; quality: ChordQuality; expected: number[]; absent: number[] }> = [
      { chordType: 'maj7', quality: 'maj7', expected: [0, 2, 4, 7, 9, 11], absent: [5, 6] },
      { chordType: 'm7', quality: 'm7', expected: [0, 3, 5, 7, 10], absent: [2, 9, 11] },
      { chordType: '7', quality: '7', expected: [0, 2, 4, 7, 10], absent: [1, 3, 5, 6, 8, 9, 11] },
      { chordType: 'm7b5', quality: 'm7b5', expected: [0, 3, 6, 8, 10], absent: [1, 5, 9] },
    ];

    for (const c of cases) {
      const map = buildTakeoverPadMap({
        ...snapshot,
        chords: [{ rootPc: 0, quality: c.quality, chordType: c.chordType, roman: 'I', startBeat: 0, durationBeats: 4, sectionId: 'A' }],
      }, 0);
      const pcs = new Set(map.cells.map((cell) => cell.pc));

      for (const pc of c.expected) expect(pcs.has(pc), `${c.chordType} expected pc${pc}`).toBe(true);
      for (const pc of c.absent) expect(pcs.has(pc), `${c.chordType} absent pc${pc}`).toBe(false);
    }
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

  it('starts the current root at the top-left pad and labels tensions as 9/13', () => {
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
    const midis = map.cells.map((c) => c.midi);

    expect(map.cells[TAKEOVER_ASCENDING_PAD_INDICES[0]]?.midi).toBe(60); // C4 top-left start.
    expect(Math.max(...midis)).toBeLessThanOrEqual(84);
    expect(Math.max(...midis) - Math.min(...midis)).toBeLessThanOrEqual(24);
    expect(Math.min(...midis)).toBeGreaterThanOrEqual(60);
    expect(dCell?.degreeLabel).toBe('9');
    expect(aCell?.degreeLabel).toBe('13');
  });

  it('places D4 at the top-left for D harmony and stays inside two octaves', () => {
    const dmaj: TakeoverMusicSnapshot = {
      ...snapshot,
      styleHint: 'pop',
      chords: [
        { rootPc: 2, quality: 'maj7', roman: 'I', startBeat: 0, durationBeats: 4, sectionId: 'A' },
      ],
    };
    const map = buildTakeoverPadMap(dmaj, 0);
    const midis = map.cells.map((c) => c.midi);
    const ordered = TAKEOVER_ASCENDING_PAD_INDICES.map((idx) => map.cells[idx]?.midi ?? -1);
    const pcs = new Set(map.cells.map((c) => c.pc));
    expect(map.cells[TAKEOVER_ASCENDING_PAD_INDICES[0]]?.midi).toBe(62); // D4 top-left.
    expect(Math.max(...midis)).toBeLessThanOrEqual(86);
    expect(Math.min(...midis)).toBeGreaterThanOrEqual(62);
    expect(Math.max(...midis) - Math.min(...midis)).toBeLessThanOrEqual(24);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    expect(pcs.has(2)).toBe(true);
    expect(pcs.has(6)).toBe(true);
    expect(pcs.has(7)).toBe(false); // Natural 11 is still avoided over Dmaj7.
  });
});
