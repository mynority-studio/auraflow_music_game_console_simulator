import { describe, expect, it } from 'vitest';
import type { MgNoteEvent } from './mgMelodyRealizer';
import { shapeMelodyHarmony, type ShaperChord } from './mgMelodyShaper';

const C_MAJOR: ShaperChord = {
  root: 'C',
  rootMidi: 60,
  bassMidi: 48,
  type: 'maj',
  roman: 'I',
  duration: 4,
  effectiveFunc: 'T',
  notesMidi: [60, 64, 67],
  notes: ['C4', 'E4', 'G4'],
  chordSymbol: 'C',
};

function slopeNote(
  noteNumber: number,
  time: number,
  duration: number,
  grammarSlopeRole: 'inside' | 'last' = 'inside',
): MgNoteEvent {
  return {
    noteNumber,
    time,
    duration,
    velocity: 92,
    part: 'melody',
    origin: 'develop',
    brickIndex: 0,
    brickStartBeat: 0,
    brickEndBeat: 4,
    grammarTokenKind: 'S',
    grammarSlopeRole,
  };
}

function shaped(notes: MgNoteEvent[]): MgNoteEvent[] {
  return shapeMelodyHarmony('POP', notes, [C_MAJOR], 'C', 'Ionian', 'tonal', false)
    .filter(event => event.part === 'melody')
    .sort((a, b) => a.time - b.time || a.noteNumber - b.noteNumber);
}

describe('render/mgMelodyShaper · slope body harmony protection', () => {
  it('keeps a weak chromatic slope body when it is a short, clearly resolving passing line', () => {
    const input = [
      slopeNote(60, 0, 0.25),
      slopeNote(61, 0.5, 0.25),
      slopeNote(62, 1, 0.25),
      slopeNote(64, 1.5, 0.25, 'last'),
    ];

    expect(shaped(input).map(event => event.noteNumber)).toEqual([60, 61, 62, 64]);
  });

  it.each([
    { label: 'ascending', pitches: [60, 62, 67], expectedMiddle: 64 },
    { label: 'descending', pitches: [67, 62, 60], expectedMiddle: 64 },
  ])('snaps an illegal structural inside note without flattening or reversing a $label slope', ({ pitches, expectedMiddle }) => {
    const output = shaped([
      slopeNote(pitches[0], 0, 0.25),
      slopeNote(pitches[1], 0.5, 0.75),
      slopeNote(pitches[2], 1.25, 0.25, 'last'),
    ]);
    const [prev, middle, next] = output;

    expect(middle.noteNumber).toBe(expectedMiddle);
    expect(Math.sign(middle.noteNumber - prev.noteNumber)).toBe(Math.sign(pitches[1] - pitches[0]));
    expect(Math.sign(next.noteNumber - middle.noteNumber)).toBe(Math.sign(pitches[2] - pitches[1]));
  });
});
