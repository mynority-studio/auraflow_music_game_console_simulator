import { describe, expect, it } from 'vitest';
import { buildMidiInventory } from './inventory';
import { analyzeMidiKey } from './keyAnalysis';
import { analyzeMidiMeter } from './meterAnalysis';
import { buildMidiNoteSpans } from './noteSpans';
import { parseRichSMF } from './richSmfParser';

interface NoteSpec {
  start: number;
  duration: number;
  pitch: number;
  velocity: number;
}

const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const vlq = (value: number): number[] => {
  const result = [value & 0x7f];
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) result.unshift((rest & 0x7f) | 0x80);
  return result;
};

const meta = (tick: number, type: number, data: number[], order = 0) => ({
  tick,
  order,
  bytes: [0xff, type, ...vlq(data.length), ...data],
});

const textMeta = (tick: number, type: number, text: string, order = 0) =>
  meta(tick, type, Array.from(text, (char) => char.charCodeAt(0)), order);

function trackFromTimed(events: Array<{ tick: number; order: number; bytes: number[] }>): number[] {
  const sorted = [...events].sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
  const body: number[] = [];
  let previous = 0;
  for (const event of sorted) {
    body.push(...vlq(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  body.push(...vlq(0), 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
}

function noteTrack(
  name: string,
  channel: number,
  program: number,
  notes: NoteSpec[],
): number[] {
  const events: Array<{ tick: number; order: number; bytes: number[] }> = [
    textMeta(0, 0x03, name, 0),
    { tick: 0, order: 1, bytes: [0xc0 | channel, program] },
  ];
  for (const note of notes) {
    events.push({
      tick: note.start,
      order: 3,
      bytes: [0x90 | channel, note.pitch, note.velocity],
    });
    events.push({
      tick: note.start + note.duration,
      order: 2,
      bytes: [0x80 | channel, note.pitch, 0],
    });
  }
  return trackFromTimed(events);
}

function makeSmf(format: number, division: number, tracks: number[][]): Uint8Array {
  const header = [
    0x4d, 0x54, 0x68, 0x64, ...u32(6),
    0, format,
    (tracks.length >>> 8) & 0xff, tracks.length & 0xff,
    (division >>> 8) & 0xff, division & 0xff,
  ];
  return new Uint8Array([...header, ...tracks.flat()]);
}

function analyze(bytes: Uint8Array) {
  const document = parseRichSMF(bytes);
  const spans = buildMidiNoteSpans(document);
  const inventory = buildMidiInventory(document, spans.notes);
  const meter = analyzeMidiMeter(document, spans.notes, inventory);
  const key = analyzeMidiKey(document, spans.notes, inventory, meter);
  return { document, spans, inventory, meter, key };
}

const chordNotes = (
  starts: number[],
  pitches: number[],
  duration = 420,
  velocity = 88,
): NoteSpec[] => starts.flatMap((start) =>
  pitches.map((pitch) => ({ start, duration, pitch, velocity })));

describe('MIDI lane inventory and role classification', () => {
  it('separates physical tracks, channels and five clean GM role lanes', () => {
    const starts = [0, 480, 960, 1440];
    const bytes = makeSmf(1, 480, [
      trackFromTimed([
        meta(0, 0x51, [0x07, 0xa1, 0x20]),
        meta(0, 0x58, [4, 2, 24, 8]),
      ]),
      noteTrack('Bass', 0, 32, starts.map((start, index) => ({
        start,
        duration: 420,
        pitch: [36, 38, 43, 36][index],
        velocity: 92,
      }))),
      noteTrack('Comp', 1, 0, chordNotes([0, 960], [60, 64, 67])),
      noteTrack('Pad', 2, 88, chordNotes([0], [48, 55, 60], 1920, 72)),
      noteTrack('Lead', 3, 80, starts.map((start, index) => ({
        start,
        duration: 240,
        pitch: [72, 74, 76, 79][index],
        velocity: 96,
      }))),
      noteTrack('Drums', 9, 0, starts.map((start, index) => ({
        start,
        duration: 90,
        pitch: index % 2 === 0 ? 36 : 38,
        velocity: 105,
      }))),
    ]);
    const result = analyze(bytes);
    const roles = Object.fromEntries(result.inventory.lanes.map((lane) => [lane.trackName, lane.role]));

    expect(result.inventory.physicalTrackCount).toBe(6);
    expect(result.inventory.usedChannels).toEqual([0, 1, 2, 3, 9]);
    expect(roles).toMatchObject({
      Bass: 'bass',
      Comp: 'comp',
      Pad: 'pad',
      Lead: 'lead',
      Drums: 'drum',
    });
    expect(result.inventory.lanes.find((lane) => lane.trackName === 'Comp')).toMatchObject({
      maxSimultaneousNotes: 3,
      onsetClusterRatio: 1,
    });
  });
});

describe('MIDI meter analysis', () => {
  it('keeps declared 6/8 separate from inferred performed accents and derives 3+3 only with compound-click evidence', () => {
    const bytes = makeSmf(1, 480, [
      trackFromTimed([
        meta(0, 0x58, [6, 3, 36, 8]),
        meta(0, 0x59, [0, 0]),
      ]),
      noteTrack('Drums', 9, 0, [
        { start: 0, duration: 60, pitch: 36, velocity: 120 },
        { start: 240, duration: 60, pitch: 42, velocity: 55 },
        { start: 480, duration: 60, pitch: 42, velocity: 55 },
        { start: 720, duration: 60, pitch: 38, velocity: 100 },
        { start: 960, duration: 60, pitch: 42, velocity: 55 },
        { start: 1200, duration: 60, pitch: 42, velocity: 55 },
      ]),
    ]);
    const result = analyze(bytes);

    expect(result.meter.declared?.value).toEqual({ numerator: 6, denominator: 8 });
    expect(result.meter.selectedSource).toBe('declared');
    expect(result.meter.beatGrouping).toEqual([3, 3]);
    expect(result.meter.performedAccents[0]).toMatchObject({ tick: 0, performedAccent: 1 });
  });

  it('infers 4/4 and bar phase 0 from an undeclared repeated 4-beat accent hierarchy', () => {
    const notes: NoteSpec[] = [];
    const velocities = [120, 58, 92, 58];
    for (let bar = 0; bar < 8; bar++) {
      for (let beat = 0; beat < 4; beat++) {
        notes.push({
          start: (bar * 4 + beat) * 480,
          duration: 60,
          pitch: beat === 0 ? 36 : beat === 2 ? 38 : 42,
          velocity: velocities[beat],
        });
      }
    }
    const result = analyze(makeSmf(0, 480, [noteTrack('Drums', 9, 0, notes)]));

    expect(result.meter.declared).toBeNull();
    expect(result.meter.candidates[0]).toMatchObject({
      numerator: 4,
      denominator: 4,
      barPhaseTick: 0,
    });
    expect(result.meter.inferred?.value).toEqual({ numerator: 4, denominator: 4 });
  });
});

describe('MIDI key analysis', () => {
  it('decodes signed declared key signatures and independently infers tonal content', () => {
    const progression = [
      ...chordNotes([0, 3840], [60, 64, 67], 900), // C
      ...chordNotes([960], [65, 69, 72], 900),      // F
      ...chordNotes([1920], [67, 71, 74], 900),     // G
      ...chordNotes([2880], [60, 64, 67], 900),     // C
    ];
    const bytes = makeSmf(1, 480, [
      trackFromTimed([
        meta(0, 0x58, [4, 2, 24, 8]),
        meta(0, 0x59, [0xfd, 1]), // declared C minor
      ]),
      noteTrack('Comp', 1, 0, progression),
      noteTrack('Bass', 0, 32, [
        { start: 0, duration: 900, pitch: 36, velocity: 92 },
        { start: 960, duration: 900, pitch: 41, velocity: 90 },
        { start: 1920, duration: 900, pitch: 43, velocity: 94 },
        { start: 2880, duration: 900, pitch: 36, velocity: 96 },
        { start: 3840, duration: 900, pitch: 36, velocity: 98 },
      ]),
    ]);
    const result = analyze(bytes);

    expect(result.key.declared?.value).toBe('C minor');
    expect(result.key.candidates[0]).toMatchObject({ tonicPc: 0, mode: 'major', label: 'C major' });
    expect(result.key.inferred?.value).toBe('C major');
    expect(result.key.warnings.some((warning) => warning.includes('不一致'))).toBe(true);
    expect(result.key.pitchClassHistogram[0]).toBeGreaterThan(result.key.pitchClassHistogram[1]);
  });
});

