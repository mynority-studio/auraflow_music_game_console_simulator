import { describe, expect, it } from 'vitest';
import { buildMidiNoteSpans } from './noteSpans';
import { parseRichSMF } from './richSmfParser';

const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const vlq = (value: number): number[] => {
  const result = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    result.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return result;
};

const header = (format: number, trackCount: number, division: number): number[] => [
  0x4d, 0x54, 0x68, 0x64,
  ...u32(6),
  (format >>> 8) & 0xff, format & 0xff,
  (trackCount >>> 8) & 0xff, trackCount & 0xff,
  (division >>> 8) & 0xff, division & 0xff,
];

const track = (...events: number[][]): number[] => {
  const body = events.flat();
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body];
};

const meta = (delta: number, type: number, data: number[]): number[] => [
  ...vlq(delta), 0xff, type, ...vlq(data.length), ...data,
];

const textMeta = (delta: number, type: number, text: string): number[] =>
  meta(delta, type, Array.from(text, (char) => char.charCodeAt(0)));

const smf = (format: number, division: number, ...tracks: number[][]): Uint8Array =>
  new Uint8Array([...header(format, tracks.length, division), ...tracks.flat()]);

describe('parseRichSMF', () => {
  it('retains physical tracks, text, complete tempo/meter/key maps and original PPQ ticks', () => {
    const bytes = smf(
      1,
      960,
      track(
        textMeta(0, 0x03, 'Conductor'),
        meta(0, 0x51, [0x07, 0xa1, 0x20]),
        meta(0, 0x58, [4, 2, 24, 8]),
        meta(0, 0x59, [0xfd, 1]), // -3 flats, minor
        textMeta(480, 0x06, 'Verse'),
        meta(480, 0x51, [0x06, 0x1a, 0x80]), // 150 BPM
        meta(0, 0x58, [6, 3, 36, 8]),
        meta(0, 0x2f, []),
      ),
      track(
        textMeta(0, 0x03, 'Piano'),
        textMeta(0, 0x04, 'Grand Piano'),
        [0x00, 0xc0, 0x00],
        [0x00, 0x90, 60, 100],
        [...vlq(960), 0x80, 60, 32],
        meta(0, 0x2f, []),
      ),
    );

    const document = parseRichSMF(bytes);

    expect(document.analysisSupport).toEqual({ supported: true, scope: 'smf-format-0-1-ppq' });
    expect(document.timeDivision).toEqual({ kind: 'ppq', ppq: 960 });
    expect(document.tracks.map((item) => item.name)).toEqual(['Conductor', 'Piano']);
    expect(document.tracks[1].instrumentName).toBe('Grand Piano');
    expect(document.tempoMap.map((item) => [item.tick, Math.round(item.bpm)])).toEqual([
      [0, 120],
      [960, 150],
    ]);
    expect(document.timeSignatureMap).toMatchObject([
      {
        tick: 0,
        numerator: 4,
        denominator: 4,
        midiClocksPerMetronomeClick: 24,
      },
      {
        tick: 960,
        numerator: 6,
        denominator: 8,
        midiClocksPerMetronomeClick: 36,
      },
    ]);
    expect(document.keySignatureMap).toEqual([
      {
        tick: 0,
        trackIndex: 0,
        sharpsFlats: -3,
        modeByte: 1,
        mode: 'minor',
        valid: true,
      },
    ]);
    expect(document.textEvents.some((item) => item.metaType === 0x06 && item.text === 'Verse')).toBe(true);
    expect(document.events.some((event) => event.kind === 'channel' && event.trackIndex === 1)).toBe(true);
    expect(document.durationTicks).toBe(960);
  });

  it('retains malformed declarations with validity flags and actionable warnings', () => {
    const bytes = smf(
      0,
      480,
      track(
        meta(0, 0x58, [0, 31, 24, 8]),
        meta(0, 0x59, [8, 7]),
        meta(0, 0x51, [0x01, 0x02]),
        meta(0, 0x2f, []),
      ),
    );
    const document = parseRichSMF(bytes);

    expect(document.timeSignatureMap[0].valid).toBe(false);
    expect(document.keySignatureMap[0].valid).toBe(false);
    expect(document.tempoMap).toEqual([]);
    expect(document.warnings.some((warning) => warning.includes('Time Signature'))).toBe(true);
    expect(document.warnings.some((warning) => warning.includes('Key Signature'))).toBe(true);
    expect(document.warnings.some((warning) => warning.includes('Tempo Meta 长度'))).toBe(true);
  });

  it('parses format 2 and SMPTE documents for diagnostics but fails harmonic support closed', () => {
    const format2 = parseRichSMF(smf(2, 480, track(meta(0, 0x2f, []))));
    expect(format2.analysisSupport).toEqual({
      supported: false,
      reason: 'format-2-independent-sequences',
    });

    const smpte = parseRichSMF(smf(0, 0xe728, track(meta(0, 0x2f, []))));
    expect(smpte.timeDivision).toEqual({ kind: 'smpte', framesPerSecond: 25, ticksPerFrame: 40 });
    expect(smpte.analysisSupport).toEqual({ supported: false, reason: 'smpte-time-division' });
  });
});

describe('buildMidiNoteSpans', () => {
  it('pairs same-pitch overlaps FIFO and keeps key-down and pedal-extended durations separate', () => {
    const bytes = smf(
      0,
      480,
      track(
        [0x00, 0x90, 60, 100],
        [...vlq(120), 0x90, 60, 90],
        [...vlq(120), 0xb0, 64, 127],
        [...vlq(120), 0x80, 60, 31],
        [...vlq(120), 0x90, 60, 0], // velocity-zero Note On = Note Off
        [...vlq(120), 0xb0, 64, 0],
        [0x00, 0x80, 64, 0], // unmatched
        [...vlq(120), 0x90, 67, 80],
        [...vlq(120), 0xff, 0x2f, 0x00],
      ),
    );
    const result = buildMidiNoteSpans(parseRichSMF(bytes));

    expect(result.notes).toHaveLength(3);
    expect(result.notes[0]).toMatchObject({
      pitch: 60,
      startTick: 0,
      keyDownEndTick: 360,
      soundingEndTick: 600,
      noteOffVelocity: 31,
      pedalExtended: true,
      inferredEnd: false,
    });
    expect(result.notes[1]).toMatchObject({
      pitch: 60,
      startTick: 120,
      keyDownEndTick: 480,
      soundingEndTick: 600,
      pedalExtended: true,
      inferredEnd: false,
    });
    expect(result.notes[2]).toMatchObject({
      pitch: 67,
      startTick: 720,
      keyDownEndTick: 840,
      soundingEndTick: 840,
      releaseReason: 'endOfFile',
      inferredEnd: true,
    });
    expect(result.warnings.some((warning) => warning.includes('FIFO'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('无匹配 Note On'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('文件结束前无 Note Off'))).toBe(true);
  });

  it('distinguishes All Notes Off from immediate All Sound Off', () => {
    const bytes = smf(
      0,
      480,
      track(
        [0x00, 0xb0, 64, 127],
        [0x00, 0x90, 60, 100],
        [...vlq(120), 0xb0, 123, 0],
        [...vlq(120), 0x90, 64, 100],
        [...vlq(120), 0xb0, 120, 0],
        [...vlq(120), 0xff, 0x2f, 0x00],
      ),
    );
    const result = buildMidiNoteSpans(parseRichSMF(bytes));

    expect(result.notes[0]).toMatchObject({
      keyDownEndTick: 120,
      soundingEndTick: 360,
      releaseReason: 'allSoundOff',
      pedalExtended: true,
    });
    expect(result.notes[1]).toMatchObject({
      keyDownEndTick: 360,
      soundingEndTick: 360,
      releaseReason: 'allSoundOff',
    });
  });
});
