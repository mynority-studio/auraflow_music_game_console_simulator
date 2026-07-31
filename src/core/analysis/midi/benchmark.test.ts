import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeMidiBytes } from './analyzeMidi';
import {
  evaluateHarmonyTimeline,
  evaluateLaneRoles,
  type GroundTruthChordSpan,
} from './benchmark';

interface ChordSpec {
  rootPc: number;
  type: string;
  pitches: number[];
  bass: number;
}

interface CorpusCase {
  name: string;
  key: { tonicPc: number; mode: 'major' | 'minor'; sharpsFlats: number; modeByte: 0 | 1 };
  chords: ChordSpec[];
}

const CORPUS: CorpusCase[] = [
  {
    name: 'C major I-IV-V-I',
    key: { tonicPc: 0, mode: 'major', sharpsFlats: 0, modeByte: 0 },
    chords: [
      { rootPc: 0, type: 'maj', pitches: [60, 64, 67], bass: 36 },
      { rootPc: 5, type: 'maj', pitches: [65, 69, 72], bass: 41 },
      { rootPc: 7, type: 'maj', pitches: [55, 59, 62], bass: 43 },
      { rootPc: 0, type: 'maj', pitches: [60, 64, 67], bass: 36 },
    ],
  },
  {
    name: 'C major ii-V-I sevenths',
    key: { tonicPc: 0, mode: 'major', sharpsFlats: 0, modeByte: 0 },
    chords: [
      { rootPc: 2, type: 'm7', pitches: [62, 65, 69, 72], bass: 38 },
      { rootPc: 7, type: '7', pitches: [55, 59, 62, 65], bass: 43 },
      { rootPc: 0, type: 'maj7', pitches: [60, 64, 67, 71], bass: 36 },
    ],
  },
  {
    name: 'A minor i-iv-V-i',
    key: { tonicPc: 9, mode: 'minor', sharpsFlats: 0, modeByte: 1 },
    chords: [
      { rootPc: 9, type: 'min', pitches: [57, 60, 64], bass: 33 },
      { rootPc: 2, type: 'min', pitches: [62, 65, 69], bass: 38 },
      { rootPc: 4, type: '7', pitches: [52, 56, 59, 62], bass: 40 },
      { rootPc: 9, type: 'min', pitches: [57, 60, 64], bass: 33 },
    ],
  },
  {
    name: 'G major I-vi-IV-V-I',
    key: { tonicPc: 7, mode: 'major', sharpsFlats: 1, modeByte: 0 },
    chords: [
      { rootPc: 7, type: 'maj', pitches: [55, 59, 62], bass: 43 },
      { rootPc: 4, type: 'min', pitches: [52, 55, 59], bass: 40 },
      { rootPc: 0, type: 'maj', pitches: [60, 64, 67], bass: 36 },
      { rootPc: 2, type: '7', pitches: [50, 54, 57, 60], bass: 38 },
      { rootPc: 7, type: 'maj', pitches: [55, 59, 62], bass: 43 },
    ],
  },
  {
    name: 'C major applied V/ii',
    key: { tonicPc: 0, mode: 'major', sharpsFlats: 0, modeByte: 0 },
    chords: [
      { rootPc: 0, type: 'maj7', pitches: [60, 64, 67, 71], bass: 36 },
      { rootPc: 9, type: '7', pitches: [57, 61, 64, 67], bass: 45 },
      { rootPc: 2, type: 'm7', pitches: [62, 65, 69, 72], bass: 38 },
      { rootPc: 7, type: '7', pitches: [55, 59, 62, 65], bass: 43 },
      { rootPc: 0, type: 'maj7', pitches: [60, 64, 67, 71], bass: 36 },
    ],
  },
];

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

function track(events: Array<{ tick: number; order: number; bytes: number[] }>): number[] {
  const sorted = [...events].sort((a, b) => (a.tick - b.tick) || (a.order - b.order));
  const data: number[] = [];
  let previous = 0;
  for (const event of sorted) {
    data.push(...vlq(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(data.length), ...data];
}

function corpusMidi(item: CorpusCase): { bytes: Uint8Array; truth: GroundTruthChordSpan[] } {
  const conductor = track([
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, 0x07, 0xa1, 0x20] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] },
    {
      tick: 0,
      order: 0,
      bytes: [0xff, 0x59, 2, item.key.sharpsFlats < 0 ? item.key.sharpsFlats + 256 : item.key.sharpsFlats, item.key.modeByte],
    },
  ]);
  const bassEvents: Array<{ tick: number; order: number; bytes: number[] }> = [
    { tick: 0, order: 0, bytes: [0xc0, 32] },
  ];
  const compEvents: Array<{ tick: number; order: number; bytes: number[] }> = [
    { tick: 0, order: 0, bytes: [0xc1, 0] },
  ];
  const truth: GroundTruthChordSpan[] = [];
  for (let index = 0; index < item.chords.length; index++) {
    const chord = item.chords[index];
    const startTick = index * 1920;
    const endTick = startTick + 1920;
    truth.push({ startTick, endTick, rootPc: chord.rootPc, type: chord.type });
    bassEvents.push({ tick: startTick, order: 2, bytes: [0x90, chord.bass, 98] });
    bassEvents.push({ tick: endTick, order: 1, bytes: [0x80, chord.bass, 0] });
    for (const pitch of chord.pitches) {
      compEvents.push({ tick: startTick, order: 2, bytes: [0x91, pitch, 90] });
      compEvents.push({ tick: endTick, order: 1, bytes: [0x81, pitch, 0] });
    }
  }
  const tracks = [conductor, track(bassEvents), track(compEvents)];
  const header = [
    0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 1, 0, tracks.length, 0x01, 0xe0,
  ];
  return { bytes: new Uint8Array([...header, ...tracks.flat()]), truth };
}

function largeDeterministicMidi(noteCount: number): Uint8Array {
  const events: Array<{ tick: number; order: number; bytes: number[] }> = [
    { tick: 0, order: 0, bytes: [0xff, 0x51, 3, 0x07, 0xa1, 0x20] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] },
    { tick: 0, order: 0, bytes: [0xff, 0x59, 2, 0, 0] },
    { tick: 0, order: 1, bytes: [0xc0, 80] },
  ];
  for (let index = 0; index < noteCount; index++) {
    const tick = index * 120;
    const pitch = 60 + [0, 2, 4, 5, 7, 9, 11, 7][index % 8];
    events.push({ tick, order: 2, bytes: [0x90, pitch, 76 + index % 20] });
    events.push({ tick: tick + 90, order: 1, bytes: [0x80, pitch, 0] });
  }
  const body = track(events);
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, 0x01, 0xe0, ...body,
  ]);
}

describe('MIDI analysis Ground Truth release gates', () => {
  it('ignores predicted boundaries outside a partial truth evaluation range', () => {
    const truth: GroundTruthChordSpan[] = [
      { startTick: 100, endTick: 200, rootPc: 0, type: 'maj' },
      { startTick: 200, endTick: 300, rootPc: 7, type: '7' },
    ];
    const predicted = [
      { id: 'before', startTick: 0, endTick: 100, rootPc: 5, type: 'maj', bassPc: 5, label: 'F', confidence: 1, sourceWindowIds: [] },
      { id: 'one', startTick: 100, endTick: 200, rootPc: 0, type: 'maj', bassPc: 0, label: 'C', confidence: 1, sourceWindowIds: [] },
      { id: 'two', startTick: 200, endTick: 300, rootPc: 7, type: '7', bassPc: 7, label: 'G7', confidence: 1, sourceWindowIds: [] },
      { id: 'after', startTick: 300, endTick: 400, rootPc: 0, type: 'maj', bassPc: 0, label: 'C', confidence: 1, sourceWindowIds: [] },
    ];

    expect(evaluateHarmonyTimeline(truth, predicted, 0)).toMatchObject({
      rootAccuracy: 1,
      rootAndTypeAccuracy: 1,
      boundaryPrecision: 1,
      boundaryRecall: 1,
      boundaryF1: 1,
    });
  });

  it.each(CORPUS)('$name meets key, chord, boundary and role gates', (item) => {
    const fixture = corpusMidi(item);
    const report = analyzeMidiBytes(fixture.bytes);
    const harmony = evaluateHarmonyTimeline(fixture.truth, report.harmony.chordTimeline, 240);
    const roles = evaluateLaneRoles({ 't1:ch0': 'bass', 't2:ch1': 'comp' }, report.inventory);

    expect(report.document.tempoMap).toHaveLength(1);
    expect(report.document.timeSignatureMap[0]).toMatchObject({ numerator: 4, denominator: 4 });
    expect(report.document.keySignatureMap[0]).toMatchObject({
      sharpsFlats: item.key.sharpsFlats,
      mode: item.key.mode,
    });
    expect(report.key.candidates[0]).toMatchObject({ tonicPc: item.key.tonicPc, mode: item.key.mode });
    expect(harmony.rootAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(harmony.rootAndTypeAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(harmony.boundaryF1).toBeGreaterThanOrEqual(0.9);
    expect(roles.accuracy).toBe(1);
    expect(roles.macroF1).toBe(1);
  });

  it('is deterministic, does not mutate input bytes, and analyzes 5000 notes within the performance budget', () => {
    const bytes = largeDeterministicMidi(5000);
    const before = bytes.slice();
    const started = performance.now();
    const first = analyzeMidiBytes(bytes);
    const elapsedMs = performance.now() - started;
    const second = analyzeMidiBytes(bytes);

    expect(bytes).toEqual(before);
    expect({
      inventory: first.inventory,
      meter: first.meter,
      key: first.key,
      harmony: first.harmony,
    }).toEqual({
      inventory: second.inventory,
      meter: second.meter,
      key: second.key,
      harmony: second.harmony,
    });
    expect(first.noteSpans.notes).toHaveLength(5000);
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('keeps the real 5/4 fixture at its canonical 3+2 harmony boundary', () => {
    const bytes = readFileSync(new URL(
      '../../../../deliverables/netmusic-jazz-five-four/Night_Walk_in_Five.mid',
      import.meta.url,
    ));
    const report = analyzeMidiBytes(bytes);

    expect(report.meter.selected).toEqual({ numerator: 5, denominator: 4 });
    expect(report.harmony.boundaries
      .filter((boundary) => boundary.measureLabel === 'M1')
      .map((boundary) => boundary.tick)).toEqual([1440]);
    expect(report.harmony.chordTimeline.slice(0, 2)).toEqual([
      expect.objectContaining({
        startTick: 0,
        endTick: 1440,
        rootPc: 4,
        type: 'm7',
        label: 'Em7',
      }),
      expect.objectContaining({
        startTick: 1440,
        endTick: 2400,
        rootPc: 11,
        type: 'm7',
        label: 'Bm7',
      }),
    ]);
  });
});
