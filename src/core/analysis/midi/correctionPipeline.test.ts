import { describe, expect, it } from 'vitest';
import { analyzeMidiBytes } from './analyzeMidi';
import { buildMidiMeasureMap } from './measureMap';
import { parseRichSMF } from './richSmfParser';
import type { MidiMeterAnalysis } from './types';

interface NoteSpec {
  start: number;
  duration: number;
  pitch: number;
  velocity?: number;
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
  meta(tick, type, Array.from(text, (character) => character.charCodeAt(0)), order);

function track(events: Array<{ tick: number; order: number; bytes: number[] }>): number[] {
  const sorted = [...events].sort((left, right) => (left.tick - right.tick) || (left.order - right.order));
  const body: number[] = [];
  let priorTick = 0;
  for (const event of sorted) {
    body.push(...vlq(event.tick - priorTick), ...event.bytes);
    priorTick = event.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
}

function noteTrack(
  channel: number,
  program: number,
  notes: ReadonlyArray<NoteSpec>,
  name = 'Part',
): number[] {
  const events: Array<{ tick: number; order: number; bytes: number[] }> = [
    textMeta(0, 0x03, name),
    { tick: 0, order: 1, bytes: [0xb0 | channel, 0, 2] },
    { tick: 0, order: 2, bytes: [0xb0 | channel, 32, 4] },
    { tick: 0, order: 3, bytes: [0xc0 | channel, program] },
  ];
  for (const note of notes) {
    events.push({
      tick: note.start,
      order: 5,
      bytes: [0x90 | channel, note.pitch, note.velocity ?? 90],
    });
    events.push({
      tick: note.start + note.duration,
      order: 4,
      bytes: [0x80 | channel, note.pitch, 0],
    });
  }
  return track(events);
}

function smf(tracks: number[][]): Uint8Array {
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, ...u32(6),
    0, 1,
    0, tracks.length,
    0x01, 0xe0,
    ...tracks.flat(),
  ]);
}

function conductor(extra: Array<{ tick: number; order: number; bytes: number[] }> = []): number[] {
  return track([
    meta(0, 0x51, [0x07, 0xa1, 0x20]),
    meta(0, 0x58, [4, 2, 24, 8], 1),
    meta(0, 0x59, [0, 0], 2),
    ...extra,
  ]);
}

function fiveFourConductor(): number[] {
  return track([
    meta(0, 0x51, [0x07, 0xa1, 0x20]),
    meta(0, 0x58, [5, 2, 24, 8], 1),
    meta(0, 0x59, [250, 1], 2),
  ]);
}

describe('declared MIDI baseline', () => {
  it('copies only byte-declared maps, names, bank/program and marker metadata', () => {
    const bytes = smf([
      conductor([
        textMeta(960, 0x06, 'Verse', 3),
        textMeta(1440, 0x07, 'Entry', 4),
        textMeta(1500, 0x05, 'la', 5),
      ]),
      noteTrack(1, 4, [{ start: 0, duration: 1920, pitch: 60 }], 'Electric Piano'),
    ]);
    const report = analyzeMidiBytes(bytes);

    expect(report.baseline).toMatchObject({
      format: 1,
      declaredTrackCount: 2,
      usedChannels: [1],
      markers: [{ tick: 960, text: 'Verse' }],
      cuePoints: [{ tick: 1440, text: 'Entry' }],
      lyrics: [{ tick: 1500, text: 'la' }],
    });
    expect(report.baseline.tempoMap[0]).toMatchObject({ tick: 0, bpm: 120 });
    expect(report.baseline.timeSignatureMap[0]).toMatchObject({ numerator: 4, denominator: 4 });
    expect(report.baseline.keySignatureMap[0]).toMatchObject({ sharpsFlats: 0, mode: 'major' });
    expect(report.baseline.programEvents[0]).toMatchObject({
      trackIndex: 1,
      channel: 1,
      program: 4,
      bankMsb: 2,
      bankLsb: 4,
    });
    expect(report.baseline.tracks[1]).toMatchObject({
      name: 'Electric Piano',
      channelNumbers: [1],
    });
  });

  it('keeps the full maps but selects the declaration covering the main performed section', () => {
    const setup = track([
      meta(0, 0x51, [0x07, 0xa1, 0x20]),
      meta(0, 0x58, [1, 2, 24, 8], 1),
      meta(0, 0x59, [0, 0], 2),
      meta(480, 0x58, [3, 2, 24, 8], 3),
      meta(480, 0x59, [254, 0], 4),
    ]);
    const notes = Array.from({ length: 8 }, (_, measure) =>
      [58, 62, 65].map((pitch) => ({
        start: 480 + measure * 1440,
        duration: 1320,
        pitch,
      }))).flat();
    const report = analyzeMidiBytes(smf([
      setup,
      noteTrack(1, 0, notes, 'Main Section'),
    ]));

    expect(report.baseline.timeSignatureMap).toHaveLength(2);
    expect(report.baseline.keySignatureMap).toHaveLength(2);
    expect(report.meter.declared).toMatchObject({
      value: { numerator: 3, denominator: 4 },
      evidence: expect.arrayContaining([expect.stringContaining('tick 480')]),
    });
    expect(report.meter.selected).toEqual({ numerator: 3, denominator: 4 });
    expect(report.key.declared).toMatchObject({
      value: 'B♭ major',
      evidence: expect.arrayContaining([expect.stringContaining('tick 480')]),
    });
    expect(report.measures.measures.slice(0, 2)).toEqual([
      expect.objectContaining({ startTick: 0, endTick: 480, meter: { numerator: 1, denominator: 4 } }),
      expect.objectContaining({ startTick: 480, endTick: 1920, meter: { numerator: 3, denominator: 4 } }),
    ]);
  });
});

describe('measure-aligned harmonic map', () => {
  it('creates exactly one harmonic window per declared 4/4 measure', () => {
    const notes = [0, 1920, 3840].flatMap((start) =>
      [60, 64, 67].map((pitch) => ({ start, duration: 1920, pitch })));
    const report = analyzeMidiBytes(smf([conductor(), noteTrack(1, 0, notes, 'Comp')]));

    expect(report.measures.measures.map((measure) => [
      measure.label,
      measure.startTick,
      measure.endTick,
    ])).toEqual([
      ['M1', 0, 1920],
      ['M2', 1920, 3840],
      ['M3', 3840, 5760],
    ]);
    expect(report.harmony.windows).toHaveLength(3);
    expect(report.harmony.chordTimeline).toHaveLength(3);
    expect(report.harmony.windows.map((window) => window.window.measureLabel)).toEqual(['M1', 'M2', 'M3']);
  });

  it('honors meter changes and marks an inferred pickup separately as M0', () => {
    const bytes = smf([
      conductor([meta(3840, 0x58, [3, 2, 24, 8], 3)]),
      noteTrack(1, 0, [{ start: 0, duration: 6720, pitch: 60 }]),
    ]);
    const declaredMap = analyzeMidiBytes(bytes).measures;
    expect(declaredMap.measures.map((measure) => [
      measure.startTick,
      measure.endTick,
      `${measure.meter.numerator}/${measure.meter.denominator}`,
    ])).toEqual([
      [0, 1920, '4/4'],
      [1920, 3840, '4/4'],
      [3840, 5280, '3/4'],
      [5280, 6720, '3/4'],
    ]);

    const document = parseRichSMF(smf([
      track([]),
      noteTrack(1, 0, [{ start: 0, duration: 4320, pitch: 60 }]),
    ]));
    const pickupMeter: MidiMeterAnalysis = {
      declared: null,
      inferred: null,
      selected: { numerator: 4, denominator: 4 },
      selectedSource: 'inferred',
      barPhaseTick: 480,
      beatGrouping: [2, 2],
      candidates: [],
      performedAccents: [],
      warnings: [],
    };
    const pickupMap = buildMidiMeasureMap(document, pickupMeter);
    expect(pickupMap.measures.slice(0, 3).map((measure) => ({
      label: measure.label,
      start: measure.startTick,
      end: measure.endTick,
      pickup: measure.isPickup,
    }))).toEqual([
      { label: 'M0', start: 0, end: 480, pickup: true },
      { label: 'M1', start: 480, end: 2400, pickup: false },
      { label: 'M2', start: 2400, end: 4320, pickup: false },
    ]);
  });

  it('does not create an empty pickup before the first performed note', () => {
    const notes: NoteSpec[] = [];
    for (let measure = 1; measure <= 8; measure++) {
      const start = measure * 2400;
      for (const pitch of [51, 54, 58]) {
        notes.push({ start, duration: 1320, pitch, velocity: 104 });
      }
      for (const pitch of [58, 61, 65, 68]) {
        notes.push({ start: start + 1440, duration: 900, pitch, velocity: 96 });
      }
    }
    const report = analyzeMidiBytes(smf([
      track([]),
      noteTrack(1, 0, notes, 'Five Four Comp'),
    ]));

    expect(report.meter.selected).toEqual({ numerator: 5, denominator: 4 });
    expect(report.meter.barPhaseTick).toBe(0);
    expect(report.measures.measures[0]).toMatchObject({
      label: 'M1',
      startTick: 0,
      endTick: 2400,
      isPickup: false,
    });
    expect(report.meter.warnings).toContainEqual(
      expect.stringContaining('该区间没有演奏音符'),
    );
  });
});

describe('register voice separation and accompaniment texture', () => {
  it('splits upper melody from lower block accompaniment inside one lane', () => {
    const lower = [0, 1920].flatMap((start) =>
      [48, 52, 55].map((pitch) => ({ start, duration: 1800, pitch })));
    const upper = [76, 78, 79, 81, 79, 78, 76, 74].map((pitch, index) => ({
      start: index * 480,
      duration: 360,
      pitch,
      velocity: 102,
    }));
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [...lower, ...upper], 'Piano Melody + Comp'),
    ]));
    const laneId = report.inventory.lanes[0].id;
    const melody = report.voices.parts.find((part) =>
      part.sourceLaneId === laneId && part.kind === 'melody');
    const accompaniment = report.voices.parts.find((part) =>
      part.sourceLaneId === laneId && part.kind === 'accompaniment');

    expect(melody).toMatchObject({ minPitch: 74, maxPitch: 81, noteCount: 8 });
    expect(accompaniment).toMatchObject({ minPitch: 48, maxPitch: 55, noteCount: 6 });
    expect(report.voices.laneTextures[0].texture).toBe('block');
    expect(report.harmony.chordTimeline.map((span) => span.rootPc)).toEqual([0, 0]);
  });

  it('recognizes repeated broken-chord accompaniment without inventing a melody split', () => {
    const notes: NoteSpec[] = [];
    for (let measure = 0; measure < 2; measure++) {
      [48, 52, 55, 60, 55, 52, 48, 52].forEach((pitch, step) => {
        notes.push({ start: measure * 1920 + step * 240, duration: 210, pitch });
      });
    }
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, notes, 'Broken Chords'),
    ]));

    expect(report.voices.laneTextures[0]).toMatchObject({ texture: 'arpeggio' });
    expect(report.voices.parts.filter((part) => part.kind === 'melody')).toHaveLength(0);
    expect(report.voices.parts[0].kind).toBe('accompaniment');
  });

  it('keeps a narrow block chord lane as accompaniment instead of extracting its top note', () => {
    const notes = [0, 1920].flatMap((start) =>
      [60, 64, 67].map((pitch) => ({ start, duration: 1680, pitch })));
    const report = analyzeMidiBytes(smf([conductor(), noteTrack(1, 0, notes, 'Chords')]));

    expect(report.voices.parts.filter((part) => part.kind === 'melody')).toHaveLength(0);
    expect(report.voices.parts[0]).toMatchObject({ kind: 'accompaniment', noteCount: 6 });
    expect(report.voices.laneTextures[0].texture).toBe('block');
  });

  it('extracts a low piano voice from a wide block-chord lane when no Bass Lane exists', () => {
    const chordPitches = [
      [36, 60, 64, 67],
      [41, 60, 65, 69],
      [43, 59, 62, 67],
      [36, 60, 64, 67],
    ];
    const notes = chordPitches.flatMap((pitches, measure) =>
      pitches.map((pitch) => ({
        start: measure * 1920,
        duration: 1800,
        pitch,
      })));
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, notes, 'Two-hand Piano'),
    ]));
    const laneId = report.inventory.lanes[0].id;

    expect(report.voices.parts.filter((part) =>
      part.sourceLaneId === laneId && part.kind === 'melody')).toHaveLength(0);
    expect(report.voices.parts.find((part) =>
      part.sourceLaneId === laneId && part.kind === 'bass')).toMatchObject({
      noteCount: 4,
      minPitch: 36,
      maxPitch: 43,
    });
    expect(report.voices.parts.find((part) =>
      part.sourceLaneId === laneId && part.kind === 'accompaniment')).toMatchObject({
      noteCount: 12,
      minPitch: 59,
      maxPitch: 69,
    });
    expect(report.harmony.chordTimeline.map((span) => span.rootPc)).toEqual([0, 5, 7, 0]);
  });
});

describe('measure-aware note layers and melodic function', () => {
  it('marks a downbeat chord tone as backbone and an offbeat step as a passing ornament', () => {
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [
        { start: 0, duration: 1800, pitch: 60 },
        { start: 0, duration: 1800, pitch: 64 },
        { start: 0, duration: 1800, pitch: 67 },
      ], 'Comp'),
      noteTrack(2, 80, [
        { start: 0, duration: 180, pitch: 72, velocity: 104 },
        { start: 240, duration: 180, pitch: 74, velocity: 82 },
        { start: 480, duration: 420, pitch: 76, velocity: 96 },
        { start: 960, duration: 420, pitch: 79, velocity: 94 },
      ], 'Lead'),
    ]));
    const layer = report.noteLayers.measures[0];
    const downbeat = layer.notes.find((note) => note.trackIndex === 2 && note.pitch === 72);
    const passing = layer.notes.find((note) => note.trackIndex === 2 && note.pitch === 74);

    expect(layer.measure.label).toBe('M1');
    expect(downbeat).toMatchObject({
      beatPosition: 1,
      metricLevel: 'downbeat',
      chordTone: true,
      melodicFunction: 'chordTone',
      structuralRole: 'backbone',
      voiceKind: 'melody',
    });
    expect(passing).toMatchObject({
      beatPosition: 1.5,
      metricLevel: 'subdivision',
      chordTone: false,
      melodicFunction: 'passingTone',
      structuralRole: 'ornament',
      voiceKind: 'melody',
    });
  });

  it('does not call a strong-beat appoggiatura a passing tone or certain backbone', () => {
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [0, 1920].flatMap((start) =>
        [60, 64, 67].map((pitch) => ({ start, duration: 1800, pitch }))), 'Comp'),
      noteTrack(2, 80, [
        { start: 1680, duration: 180, pitch: 79, velocity: 82 },
        { start: 1920, duration: 360, pitch: 74, velocity: 112 },
        { start: 2400, duration: 420, pitch: 72, velocity: 92 },
      ], 'Lead'),
    ]));
    const appoggiatura = report.noteLayers.measures[1].notes.find((note) =>
      note.trackIndex === 2 && note.pitch === 74);

    expect(appoggiatura).toMatchObject({
      beatPosition: 1,
      metricLevel: 'downbeat',
      chordTone: false,
      melodicFunction: 'appoggiatura',
      structuralRole: 'ambiguous',
    });
    expect(appoggiatura?.structuralScore).toBeGreaterThan(0.4);
    expect(appoggiatura?.structuralScore).toBeLessThan(0.62);
  });

  it('keeps mixed-track melody and accompaniment assignments inside each measure layer', () => {
    const lower = [0, 1920].flatMap((start) =>
      [48, 52, 55].map((pitch) => ({ start, duration: 1800, pitch })));
    const upper = [76, 78, 79, 81, 79, 78, 76, 74].map((pitch, index) => ({
      start: index * 480,
      duration: 360,
      pitch,
      velocity: 102,
    }));
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [...lower, ...upper], 'One-track Piano'),
    ]));

    expect(report.baseline.declaredTrackCount).toBe(2);
    expect(report.noteLayers.measures).toHaveLength(2);
    for (const layer of report.noteLayers.measures) {
      const onsetKinds = new Set(layer.notes.filter((note) => note.isOnset).map((note) => note.voiceKind));
      expect(onsetKinds).toEqual(new Set(['accompaniment', 'melody']));
      expect(layer.voices).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'melody', noteCount: 4 }),
        expect.objectContaining({ kind: 'accompaniment', noteCount: 3 }),
      ]));
    }
  });
});

describe('bass + accompaniment harmonic evidence and tonal refinement', () => {
  it('keeps the downbeat bass as harmonic bass over later bass passing notes', () => {
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [60, 64, 67].map((pitch) => ({
        start: 0,
        duration: 1800,
        pitch,
        velocity: 88,
      })), 'Comp'),
      noteTrack(0, 32, [
        { start: 0, duration: 360, pitch: 36, velocity: 105 },
        { start: 480, duration: 360, pitch: 38, velocity: 88 },
        { start: 960, duration: 360, pitch: 40, velocity: 88 },
        { start: 1440, duration: 360, pitch: 43, velocity: 88 },
      ], 'Bass passing line'),
    ]));
    const window = report.harmony.windows[0].window;

    expect(window.bassPc).toBe(0);
    expect(report.harmony.chordTimeline[0]).toMatchObject({
      rootPc: 0,
      type: 'maj',
      bassPc: 0,
    });
    expect(window.evidenceTotals.bass).toBeGreaterThan(0);
    expect(window.evidenceTotals.accompaniment).toBeGreaterThan(0);
    expect(window.evidenceTotals.strongBeat).toBeGreaterThan(0);
  });

  it('combines accompaniment quality with bass inversion instead of treating bass as the chord root', () => {
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [60, 64, 67].map((pitch) => ({
        start: 0,
        duration: 1800,
        pitch,
      })), 'Comp'),
      noteTrack(0, 32, [{ start: 0, duration: 1800, pitch: 40, velocity: 105 }], 'Bass'),
    ]));

    expect(report.harmony.chordTimeline[0]).toMatchObject({
      rootPc: 0,
      type: 'maj',
      bassPc: 4,
      label: 'C/E',
    });
  });

  it('identifies measure chords and separate four-measure local keys across a modulation', () => {
    const chordPitches = [
      [60, 64, 67], // C
      [65, 69, 72], // F
      [67, 71, 74], // G
      [60, 64, 67], // C
      [67, 71, 74], // G
      [60, 64, 67], // C (IV in G)
      [62, 66, 69], // D
      [67, 71, 74], // G
    ];
    const bassPitches = [36, 41, 43, 36, 43, 36, 38, 43];
    const comp = chordPitches.flatMap((pitches, index) =>
      pitches.map((pitch) => ({
        start: index * 1920,
        duration: 1800,
        pitch,
        velocity: 90,
      })));
    const bass = bassPitches.map((pitch, index) => ({
      start: index * 1920,
      duration: 1800,
      pitch,
      velocity: 100,
    }));
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, comp, 'Comp'),
      noteTrack(0, 32, bass, 'Bass'),
    ]));

    expect(report.harmony.chordTimeline.map((span) => span.rootPc)).toEqual([0, 5, 7, 0, 7, 0, 2, 7]);
    expect(report.key.localSegments).toHaveLength(2);
    expect(report.key.localSegments[0]).toMatchObject({
      startMeasureLabel: 'M1',
      endMeasureLabel: 'M4',
      selected: { tonicPc: 0, mode: 'major', label: 'C major' },
    });
    expect(report.key.localSegments[1]).toMatchObject({
      startMeasureLabel: 'M5',
      endMeasureLabel: 'M8',
      selected: { tonicPc: 7, mode: 'major', label: 'G major' },
    });
    expect(report.key.localSegments[0].confidence).toBeGreaterThan(0.5);
    expect(report.key.localSegments[1].confidence).toBeGreaterThan(0.5);
  });
});

describe('within-measure chord segmentation without progression priors', () => {
  it('merges a same-root partial voicing into its completed chord', () => {
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [
        ...[55, 62].map((pitch) => ({ start: 0, duration: 480, pitch })),
        ...[55, 58, 62, 65].map((pitch) => ({ start: 480, duration: 1440, pitch })),
      ], 'Completed Comp'),
      noteTrack(0, 32, [
        { start: 0, duration: 1920, pitch: 43, velocity: 104 },
      ], 'Bass'),
    ]));

    expect(report.harmony.boundaries).toEqual([]);
    expect(report.harmony.chordTimeline).toEqual([
      expect.objectContaining({
        startTick: 0,
        endTick: 1920,
        rootPc: 7,
        type: 'm7',
        label: 'Gm7',
        sourceWindowIds: expect.arrayContaining([
          'hw-hs-measure-1-0',
          'hw-hs-measure-1-1',
        ]),
      }),
    ]);
    expect(report.noteLayers.measures[0].chordLabel).toBe('Gm7');
  });

  it('keeps an incompatible same-root major-to-minor change', () => {
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [
        ...[60, 64, 67].map((pitch) => ({ start: 0, duration: 900, pitch })),
        ...[60, 63, 67].map((pitch) => ({ start: 960, duration: 960, pitch })),
      ], 'Quality Change'),
      noteTrack(0, 32, [
        { start: 0, duration: 1920, pitch: 36, velocity: 104 },
      ], 'Bass'),
    ]));

    expect(report.harmony.boundaries).toEqual([
      expect.objectContaining({ tick: 960 }),
    ]);
    expect(report.harmony.chordTimeline).toEqual([
      expect.objectContaining({ startTick: 0, endTick: 960, rootPc: 0, type: 'maj' }),
      expect.objectContaining({ startTick: 960, endTick: 1920, rootPc: 0, type: 'min' }),
    ]);
  });

  it('treats rolled chord completion and same-root revoicing as texture, not extra harmony', () => {
    const report = analyzeMidiBytes(smf([
      fiveFourConductor(),
      noteTrack(1, 0, [
        { start: 0, duration: 215, pitch: 52 },
        ...[55, 59, 62].map((pitch) => ({ start: 305, duration: 90, pitch })),
        { start: 785, duration: 150, pitch: 52 },
        ...[55, 59, 62].map((pitch) => ({ start: 960, duration: 90, pitch })),
        { start: 1440, duration: 695, pitch: 47 },
        ...[50, 54, 57].map((pitch) => ({ start: 1920, duration: 165, pitch })),
      ], 'Rolled Comp'),
      noteTrack(0, 32, [
        { start: 0, duration: 1170, pitch: 40, velocity: 100 },
        { start: 1440, duration: 365, pitch: 47, velocity: 96 },
        { start: 1920, duration: 480, pitch: 35, velocity: 88 },
      ], 'Bass'),
    ]));

    expect(report.harmony.boundaries.map((boundary) => boundary.tick)).toEqual([1440]);
    expect(report.harmony.chordTimeline).toEqual([
      expect.objectContaining({ startTick: 0, endTick: 1440, rootPc: 4, type: 'm7' }),
      expect.objectContaining({ startTick: 1440, endTick: 2400, rootPc: 11, type: 'm7' }),
    ]);
  });

  it('recognizes a Take Five-style 3+2 bar as two independent chord slices', () => {
    const report = analyzeMidiBytes(smf([
      fiveFourConductor(),
      noteTrack(1, 0, [
        ...[51, 54, 58].map((pitch) => ({ start: 0, duration: 1380, pitch })),
        ...[58, 61, 65, 68].map((pitch) => ({ start: 1440, duration: 960, pitch })),
      ], 'Comp'),
      noteTrack(0, 32, [
        { start: 0, duration: 1380, pitch: 39, velocity: 102 },
        { start: 1440, duration: 960, pitch: 46, velocity: 104 },
      ], 'Bass'),
    ]));

    expect(report.measures.measures).toEqual([
      expect.objectContaining({
        label: 'M1',
        startTick: 0,
        endTick: 2400,
        meter: { numerator: 5, denominator: 4 },
      }),
    ]);
    expect(report.harmony.boundaries).toEqual([
      expect.objectContaining({ measureLabel: 'M1', tick: 1440 }),
    ]);
    expect(report.harmony.windows.map((window) => window.window.segmentLabel)).toEqual(['M1.1', 'M1.2']);
    expect(report.harmony.chordTimeline).toEqual([
      expect.objectContaining({ startTick: 0, endTick: 1440, rootPc: 3, type: 'min' }),
      expect.objectContaining({ startTick: 1440, endTick: 2400, rootPc: 10, type: 'm7' }),
    ]);
  });

  it('splits two coordinated bass/comp harmonies inside one measure', () => {
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [
        ...[60, 64, 67].map((pitch) => ({ start: 0, duration: 900, pitch })),
        ...[55, 59, 62, 65].map((pitch) => ({ start: 960, duration: 960, pitch })),
      ], 'Comp'),
      noteTrack(0, 32, [
        { start: 0, duration: 900, pitch: 36, velocity: 102 },
        { start: 960, duration: 960, pitch: 43, velocity: 104 },
      ], 'Bass'),
    ]));

    expect(report.measures.measures).toHaveLength(1);
    expect(report.harmony.boundaries).toEqual([
      expect.objectContaining({
        measureLabel: 'M1',
        tick: 960,
        sources: expect.arrayContaining(['accompanimentAttack', 'bassAttack', 'pitchSetChange']),
      }),
    ]);
    expect(report.harmony.windows.map((window) => window.window.segmentLabel)).toEqual(['M1.1', 'M1.2']);
    expect(report.harmony.chordTimeline).toEqual([
      expect.objectContaining({ startTick: 0, endTick: 960, rootPc: 0, type: 'maj', label: 'C' }),
      expect.objectContaining({ startTick: 960, endTick: 1920, rootPc: 7, type: '7', label: 'G7' }),
    ]);
    expect(report.harmony.functions).toEqual([]);
    expect(report.harmony.patterns).toEqual([]);
    expect(report.noteLayers.measures[0].chordLabel).toBe('C → G7');
    expect(report.noteLayers.measures[0].notes.find((note) =>
      note.originalStartTick === 960 && note.pitch === 65)).toMatchObject({
      chordTone: true,
      melodicFunction: 'chordTone',
    });
  });

  it('does not split a repeated attack of the same chord', () => {
    const report = analyzeMidiBytes(smf([
      conductor(),
      noteTrack(1, 0, [
        ...[60, 64, 67].map((pitch) => ({ start: 0, duration: 900, pitch })),
        ...[60, 64, 67].map((pitch) => ({ start: 960, duration: 960, pitch })),
      ], 'Repeated Comp'),
      noteTrack(0, 32, [
        { start: 0, duration: 900, pitch: 36 },
        { start: 960, duration: 960, pitch: 36 },
      ], 'Bass'),
    ]));

    expect(report.harmony.boundaries).toEqual([]);
    expect(report.harmony.chordTimeline).toHaveLength(1);
    expect(report.harmony.chordTimeline[0]).toMatchObject({ rootPc: 0, type: 'maj' });
  });
});
