import { describe, expect, it } from 'vitest';
import {
  buildMeasureNoteCells,
  foldMidiIntoTakeoverRange,
  selectMeasureNotesForPads,
  TAKEOVER_CHROMATIC_PASSING_CAP,
  TAKEOVER_STRUCTURAL_CORE_CAP,
} from './measureNoteMap';
import type { TakeoverMeasureSource, TakeoverMusicSnapshot } from './types';

function note(
  id: string,
  sourceMidi: number,
  priority: number,
  structuralRole: 'backbone' | 'ambiguous' | 'ornament' = 'ornament',
  voiceKind: 'melody' | 'bass' | 'accompaniment' = 'accompaniment',
) {
  return {
    id,
    sourceMidi,
    priority,
    voiceKind,
    structuralRole,
    metricLevel: structuralRole === 'backbone' ? 'strongBeat' as const : 'offbeat' as const,
    melodicFunction: structuralRole === 'ornament' ? 'passingTone' : 'chordTone',
  };
}

describe('leadTakeoverSandbox/measureNoteMap', () => {
  it('folds source notes by octaves into the existing C4-C6 takeover range', () => {
    expect(foldMidiIntoTakeoverRange(36)).toBe(60);
    expect(foldMidiIntoTakeoverRange(59)).toBe(71);
    expect(foldMidiIntoTakeoverRange(72)).toBe(72);
    expect(foldMidiIntoTakeoverRange(96)).toBe(84);
  });

  it('keeps every folded unique note when capacity allows and merges octave collisions', () => {
    const measure: TakeoverMeasureSource = {
      id: 'm1',
      label: 'M1',
      startBeat: 0,
      durationBeats: 4,
      notes: [
        note('c2', 36, 300, 'backbone'),
        note('c3', 48, 200, 'ambiguous'),
        note('c4', 60, 100),
        note('e4', 64, 90),
        note('g4', 67, 80),
      ],
    };

    expect(selectMeasureNotesForPads(measure).map((selection) => selection.midi))
      .toEqual([60, 64, 67]);
  });

  it('uses structural priority only when more than 15 folded notes compete', () => {
    const measure: TakeoverMeasureSource = {
      id: 'm1',
      label: 'M1',
      startBeat: 0,
      durationBeats: 4,
      notes: Array.from({ length: 20 }, (_, index) =>
        note(
          `n${index}`,
          60 + index,
          index === 19 ? 1000 : index,
          index === 19 ? 'backbone' : 'ornament',
        )),
    };

    const selected = selectMeasureNotesForPads(measure);
    expect(selected).toHaveLength(15);
    expect(selected.map((entry) => entry.midi)).toContain(79);
    expect(selected.map((entry) => entry.midi)).not.toContain(60);
  });

  it('spreads the selected pitch classes across available octaves before balanced repetition', () => {
    const measure: TakeoverMeasureSource = {
      id: 'm1',
      label: 'M1',
      startBeat: 0,
      durationBeats: 4,
      notes: [
        note('root', 48, 400, 'backbone'),
        note('passing', 50, 120, 'ornament', 'melody'),
        note('third', 52, 350, 'backbone'),
      ],
    };
    const snapshot: TakeoverMusicSnapshot = {
      styleHint: 'pop',
      key: 'C',
      tonality: 'major',
      bpm: 120,
      timeSignature: [4, 4],
      chords: [],
      layoutMode: 'measure-notes',
      measures: [measure],
    };
    const result = buildMeasureNoteCells(snapshot, 1);

    expect(result?.measure.label).toBe('M1');
    expect(result?.cells).toHaveLength(15);
    expect(new Set(result?.cells.map((cell) => cell.midi)))
      .toEqual(new Set([60, 62, 64, 72, 74, 76, 84]));
    expect(result?.cells.map((cell) => cell.midi))
      .toEqual([...(result?.cells.map((cell) => cell.midi) ?? [])].sort((a, b) => a - b));
    expect(result?.cells[0]?.midi).toBe(60);
    expect(result?.cells[14]?.midi).toBe(84);
    expect(result?.cells.filter((cell) => cell.classRole === 'structural')).toHaveLength(5);
    const frequencies = result?.cells.reduce((counts, cell) => {
      counts.set(cell.midi, (counts.get(cell.midi) ?? 0) + 1);
      return counts;
    }, new Map<number, number>());
    expect(Math.max(...(frequencies?.values() ?? []))).toBeLessThanOrEqual(4);
    expect(result?.cells.some((cell) => cell.degreeLabel.includes('旋律'))).toBe(true);
  });

  it('keeps the real Take Five M13 Lead pitches visible and removes the one-note fill flood', () => {
    const measure: TakeoverMeasureSource = {
      id: 'take-five-m13',
      label: 'M13',
      startBeat: 60,
      durationBeats: 5,
      notes: [
        note('bass-eb', 39, 423.4, 'backbone', 'bass'),
        note('comp-eb', 39, 419.4, 'backbone'),
        note('comp-fs', 54, 379.3, 'backbone'),
        note('comp-bb', 58, 378.1, 'backbone'),
        note('comp-eb5', 63, 373.9, 'backbone'),
        note('bass-bb', 46, 401.3, 'backbone', 'bass'),
        note('lead-bb', 58, 397.4, 'backbone', 'melody'),
        note('lead-eb', 63, 123.4, 'ornament', 'melody'),
        note('bass-bb-low', 34, 376.2, 'backbone', 'bass'),
        note('comp-f', 53, 376.7, 'backbone'),
        note('comp-ab', 56, 382.4, 'backbone'),
        note('comp-db', 61, 381.4, 'backbone'),
        note('lead-fs', 66, 160.8, 'ornament', 'melody'),
        note('lead-ab', 68, 244.2, 'ambiguous', 'melody'),
      ],
    };
    const snapshot: TakeoverMusicSnapshot = {
      styleHint: 'jazz',
      key: 'Eb',
      tonality: 'minor',
      bpm: 120,
      timeSignature: [5, 4],
      source: 'midi-analysis',
      chords: [],
      layoutMode: 'measure-notes',
      measures: [measure],
    };

    const selected = selectMeasureNotesForPads(measure);
    const result = buildMeasureNoteCells(snapshot, 61)!;
    const foldedLead = [58, 63, 66, 68].map(foldMidiIntoTakeoverRange);
    const frequencies = result.cells.reduce((counts, cell) => {
      counts.set(cell.midi, (counts.get(cell.midi) ?? 0) + 1);
      return counts;
    }, new Map<number, number>());

    for (const midi of foldedLead) {
      expect(selected.find((entry) => entry.midi === midi)?.sourceKinds.has('melody'), `Lead ${midi}`).toBe(true);
      expect(result.cells.some((cell) => cell.midi === midi && cell.degreeLabel.includes('旋律')), `Lead cell ${midi}`).toBe(true);
    }
    expect(result.cells).toHaveLength(15);
    expect(new Set(result.cells.map((cell) => cell.midi)).size).toBeGreaterThanOrEqual(12);
    expect(Math.max(...frequencies.values())).toBeLessThanOrEqual(2);
  });

  it('caps backbone core notes and lets semitone passing notes occupy at most 30 percent', () => {
    const backbone = [60, 64, 67, 72, 76, 79].map((midi, index) =>
      note(`backbone-${index}`, midi, 500 - index, 'backbone'));
    const chromatic = [61, 63, 65, 66, 68, 70].map((midi, index) => ({
      ...note(`chromatic-${index}`, midi, 400 - index, 'ornament'),
      melodicFunction: 'passingTone',
    }));
    const context = [62, 69, 71, 73, 74, 75, 77, 78].map((midi, index) => ({
      ...note(`context-${index}`, midi, 300 - index, 'ambiguous'),
      melodicFunction: 'chordTone',
    }));
    const measure: TakeoverMeasureSource = {
      id: 'quota',
      label: 'M2',
      startBeat: 0,
      durationBeats: 4,
      notes: [...backbone, ...chromatic, ...context],
    };

    const selected = selectMeasureNotesForPads(measure);
    const structuralCount = selected.filter((entry) => entry.isCore).length;
    const structuralPcs = new Set(backbone.map((entry) => entry.sourceMidi % 12));
    const chromaticCount = selected.filter((entry) =>
      entry.isChromaticPassing
      && entry.note.melodicFunction === 'passingTone'
      && [...structuralPcs].some((pc) => {
        const distance = Math.abs(entry.midi % 12 - pc);
        return Math.min(distance, 12 - distance) === 1;
      })).length;

    expect(selected).toHaveLength(15);
    expect(structuralCount).toBe(TAKEOVER_STRUCTURAL_CORE_CAP);
    expect(chromaticCount).toBe(TAKEOVER_CHROMATIC_PASSING_CAP);
    expect(selected.map((entry) => entry.midi))
      .toEqual([...selected.map((entry) => entry.midi)].sort((a, b) => a - b));
  });

  it('places the five highlighted backbone cores nearest the center of an ascending layout', () => {
    const measure: TakeoverMeasureSource = {
      id: 'all-backbone',
      label: 'M3',
      startBeat: 0,
      durationBeats: 4,
      notes: Array.from({ length: 15 }, (_, index) =>
        note(`backbone-${index}`, 60 + index, 500 - index, 'backbone')),
    };
    const snapshot: TakeoverMusicSnapshot = {
      styleHint: 'pop',
      key: 'C',
      tonality: 'major',
      bpm: 120,
      timeSignature: [4, 4],
      chords: [],
      layoutMode: 'measure-notes',
      measures: [measure],
    };

    const result = buildMeasureNoteCells(snapshot, 1);

    expect(result?.cells.map((cell) => cell.midi))
      .toEqual(Array.from({ length: 15 }, (_, index) => 60 + index));
    expect(result?.cells
      .filter((cell) => cell.classRole === 'structural')
      .map((cell) => cell.index))
      .toEqual([5, 6, 7, 8, 9]);
  });
});
