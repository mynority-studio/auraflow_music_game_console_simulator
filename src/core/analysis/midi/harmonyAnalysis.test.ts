import { describe, expect, it } from 'vitest';
import { analyzeChordWindow } from './chordCandidates';
import { analyzeChordFunctions, detectProgressionPatterns } from './functionalHarmony';
import { analyzeMidiHarmony } from './harmonyAnalysis';
import { buildMidiInventory } from './inventory';
import { analyzeMidiKey } from './keyAnalysis';
import { buildMidiMeasureMap } from './measureMap';
import { analyzeMidiMeter } from './meterAnalysis';
import { buildMidiNoteSpans } from './noteSpans';
import { parseRichSMF } from './richSmfParser';
import { separateMidiVoices } from './voiceSeparation';
import type { DecodedChordSpan, HarmonicWindow, KeyCandidate } from './types';

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

function track(events: Array<{ tick: number; order: number; bytes: number[] }>): number[] {
  const sorted = [...events].sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
  const body: number[] = [];
  let previous = 0;
  for (const event of sorted) {
    body.push(...vlq(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
}

function noteTrack(channel: number, program: number, notes: NoteSpec[]): number[] {
  const events: Array<{ tick: number; order: number; bytes: number[] }> = [
    { tick: 0, order: 0, bytes: [0xc0 | channel, program] },
  ];
  for (const note of notes) {
    events.push({ tick: note.start, order: 2, bytes: [0x90 | channel, note.pitch, note.velocity] });
    events.push({ tick: note.start + note.duration, order: 1, bytes: [0x80 | channel, note.pitch, 0] });
  }
  return track(events);
}

function smf(tracks: number[][]): Uint8Array {
  const header = [
    0x4d, 0x54, 0x68, 0x64, ...u32(6),
    0, 1,
    0, tracks.length,
    0x01, 0xe0,
  ];
  return new Uint8Array([...header, ...tracks.flat()]);
}

function endToEnd(bytes: Uint8Array) {
  const document = parseRichSMF(bytes);
  const spans = buildMidiNoteSpans(document);
  const inventory = buildMidiInventory(document, spans.notes);
  const meter = analyzeMidiMeter(document, spans.notes, inventory);
  const measures = buildMidiMeasureMap(document, meter);
  const voices = separateMidiVoices(document, spans.notes, inventory, measures);
  const key = analyzeMidiKey(document, spans.notes, inventory, meter, voices);
  const harmony = analyzeMidiHarmony(
    document,
    spans.notes,
    inventory,
    measures,
    voices,
  );
  return { document, spans, inventory, meter, key, harmony };
}

function weightedWindow(
  pcs: number[],
  bassPc: number | null,
  id = 'w0',
): HarmonicWindow {
  const weights = new Array<number>(12).fill(0);
  for (const pitchClass of pcs) weights[pitchClass] += 1 / pcs.length;
  return {
    id,
    measureId: 'measure-1',
    measureLabel: 'M1',
    measureIndex: 1,
    segmentIndex: 0,
    segmentCount: 1,
    segmentLabel: 'M1',
    startTick: 0,
    endTick: 480,
    pitchClassWeights: weights,
    accompanimentPitchClassWeights: weights,
    bassPitchClassWeights: bassPc === null
      ? new Array<number>(12).fill(0)
      : new Array<number>(12).fill(0).map((_, pc) => pc === bassPc ? 1 : 0),
    strongBeatPitchClassWeights: weights,
    melodyPitchClassWeights: new Array<number>(12).fill(0),
    bassPc,
    bassConfidence: bassPc === null ? 0 : 0.9,
    evidenceTotals: {
      accompaniment: pcs.length,
      bass: bassPc === null ? 0 : 1,
      strongBeat: pcs.length,
      melody: 0,
      other: 0,
    },
    evidence: [],
    contributingNoteIds: pcs.map((_, index) => `n${index}`),
  };
}

describe('fuzzy chord candidates', () => {
  it('keeps literal diminished and missing-root dominant interpretations together', () => {
    const analysis = analyzeChordWindow(weightedWindow([11, 2, 5], 11), 24);

    expect(analysis.candidates[0]).toMatchObject({ rootPc: 11, type: 'dim', rootHeard: true });
    expect(analysis.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rootPc: 7,
        type: '7',
        rootHeard: false,
        missingPitchClasses: expect.arrayContaining([7]),
      }),
    ]));
  });

  it('recognizes inversion bass without turning the slash into an applied dominant', () => {
    const analysis = analyzeChordWindow(weightedWindow([0, 4, 7], 4));
    expect(analysis.candidates[0]).toMatchObject({ rootPc: 0, type: 'maj', bassPc: 4, label: 'C/E' });
  });

  it('returns unknown confidence for empty harmonic evidence', () => {
    const analysis = analyzeChordWindow(weightedWindow([], null));
    expect(analysis.candidates).toEqual([]);
    expect(analysis.unknownConfidence).toBe(1);
  });
});

describe('global chord decoding and functional progression', () => {
  it('decodes clean chord slices independently without emitting progression claims', () => {
    const starts = [0, 1920, 3840];
    const chords = [
      [62, 65, 69, 72], // Dm7
      [55, 59, 62, 65], // G7
      [60, 64, 67, 71], // Cmaj7
    ];
    const compNotes = starts.flatMap((start, index) =>
      chords[index].map((pitch) => ({ start, duration: 1800, pitch, velocity: 90 })));
    const bassNotes = starts.map((start, index) => ({
      start,
      duration: 1800,
      pitch: [38, 43, 36][index],
      velocity: 96,
    }));
    const result = endToEnd(smf([
      track([
        meta(0, 0x51, [0x07, 0xa1, 0x20]),
        meta(0, 0x58, [4, 2, 24, 8]),
        meta(0, 0x59, [0, 0]),
      ]),
      noteTrack(0, 32, bassNotes),
      noteTrack(1, 0, compNotes),
    ]));

    expect(result.key.candidates[0]).toMatchObject({ tonicPc: 0, mode: 'major' });
    expect(result.harmony.chordTimeline.map((span) => span.rootPc)).toEqual([2, 7, 0]);
    expect(result.harmony.chordTimeline.map((span) => span.type)).toEqual(['m7', '7', 'maj7']);
    expect(result.harmony.functions).toEqual([]);
    expect(result.harmony.patterns).toEqual([]);
    expect(result.harmony.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('和声走向分析已停用'),
    ]));
  });

  it('represents slash-bass inversion and V/ii as different structured fields', () => {
    const key: KeyCandidate = {
      tonicPc: 0,
      mode: 'major',
      label: 'C major',
      score: 1,
      confidence: 1,
    };
    const timeline: DecodedChordSpan[] = [
      {
        id: 'c0', startTick: 0, endTick: 480, rootPc: 0, type: 'maj',
        bassPc: 4, label: 'C/E', confidence: 1, sourceWindowIds: ['w0'],
      },
      {
        id: 'c1', startTick: 480, endTick: 960, rootPc: 9, type: '7',
        bassPc: 9, label: 'A7', confidence: 1, sourceWindowIds: ['w1'],
      },
      {
        id: 'c2', startTick: 960, endTick: 1440, rootPc: 2, type: 'm7',
        bassPc: 2, label: 'Dm7', confidence: 1, sourceWindowIds: ['w2'],
      },
    ];
    const functions = analyzeChordFunctions(timeline, key);

    expect(functions[0]).toMatchObject({
      roman: 'I',
      inversionBassPc: 4,
    });
    expect(functions[0].appliedTarget).toBeUndefined();
    expect(functions[1]).toMatchObject({
      roman: 'V7/ii',
      function: 'D',
      inversionBassPc: null,
      appliedTarget: { degree: 2, accidental: 0 },
    });
  });

  it('detects progression changes across repeated measure-aligned chords', () => {
    const key: KeyCandidate = {
      tonicPc: 0,
      mode: 'major',
      label: 'C major',
      score: 1,
      confidence: 1,
    };
    const timeline: DecodedChordSpan[] = [
      { id: 'm1', startTick: 0, endTick: 1920, rootPc: 2, type: 'm7', bassPc: 2, label: 'Dm7', confidence: 1, sourceWindowIds: ['w1'] },
      { id: 'm2', startTick: 1920, endTick: 3840, rootPc: 2, type: 'm7', bassPc: 2, label: 'Dm7', confidence: 1, sourceWindowIds: ['w2'] },
      { id: 'm3', startTick: 3840, endTick: 5760, rootPc: 7, type: '7', bassPc: 7, label: 'G7', confidence: 1, sourceWindowIds: ['w3'] },
      { id: 'm4', startTick: 5760, endTick: 7680, rootPc: 0, type: 'maj7', bassPc: 0, label: 'Cmaj7', confidence: 1, sourceWindowIds: ['w4'] },
    ];

    const patterns = detectProgressionPatterns(analyzeChordFunctions(timeline, key));
    expect(patterns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'ii-V-I',
        startChordIndex: 0,
        endChordIndex: 3,
      }),
    ]));
  });
});
