import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeMidiBytes } from './analyzeMidi';
import {
  clearMidiAnalysisSession,
  getMidiAnalysisSession,
  startMidiAnalysisSession,
  subscribeMidiAnalysisSession,
} from './midiAnalysisSession';

const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

function cleanCChordSmf(): Uint8Array {
  const trackData = [
    0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20,
    0, 0xff, 0x58, 4, 4, 2, 24, 8,
    0, 0xff, 0x59, 2, 0, 0,
    0, 0xc0, 0,
    0, 0x90, 60, 90,
    0, 0x90, 64, 90,
    0, 0x90, 67, 90,
    0x83, 0x60, 0x80, 60, 0,
    0, 0x80, 64, 0,
    0, 0x80, 67, 0,
    0, 0xff, 0x2f, 0,
  ];
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, ...u32(trackData.length), ...trackData,
  ]);
}

describe('analyzeMidiBytes report orchestration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearMidiAnalysisSession();
  });

  it('builds one read-only report across parse, structure, key and harmony stages', () => {
    const report = analyzeMidiBytes(cleanCChordSmf());

    expect(report.schemaVersion).toBe(5);
    expect(report.baseline.timeSignatureMap).toHaveLength(1);
    expect(report.document.analysisSupport.supported).toBe(true);
    expect(report.noteSpans.notes).toHaveLength(3);
    expect(report.inventory.lanes).toHaveLength(1);
    expect(report.meter.declared?.value).toEqual({ numerator: 4, denominator: 4 });
    expect(report.key.declared?.value).toBe('C major');
    expect(report.harmony.chordTimeline[0]).toMatchObject({ rootPc: 0, type: 'maj' });
    expect(report.noteLayers.measures[0].notes).toHaveLength(3);
  });

  it('publishes analyzing → ready session states and falls back off-main-thread API in Node', async () => {
    vi.stubGlobal('Worker', undefined);
    const statuses: string[] = [];
    const unsubscribe = subscribeMidiAnalysisSession((state) => statuses.push(state.status));

    const report = await startMidiAnalysisSession(cleanCChordSmf(), {
      name: 'clean-c.mid',
      size: cleanCChordSmf().byteLength,
    });
    unsubscribe();

    expect(report).not.toBeNull();
    expect(statuses).toEqual(expect.arrayContaining(['idle', 'analyzing', 'ready']));
    expect(getMidiAnalysisSession()).toMatchObject({
      status: 'ready',
      fileName: 'clean-c.mid',
      report: { schemaVersion: 5 },
    });
  });
});
