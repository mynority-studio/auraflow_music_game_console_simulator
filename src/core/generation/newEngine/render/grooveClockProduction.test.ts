import { describe, expect, it } from 'vitest';
import { pc } from '../foundation';
import { buildSongBundle, generateSongFromBundle } from '../generation/GenerationController';

function activeBodyBar(bundle: ReturnType<typeof buildSongBundle>): number {
  let startBar = 0;
  for (const section of bundle.arrangement.sections) {
    const bassActive = bundle.instrumentation.activeRolesBySection[section.id]?.includes('bass') ?? false;
    if (bassActive && section.role !== 'intro' && section.role !== 'outro' && section.bars >= 2) return startBar + 1;
    startBar += section.bars;
  }
  throw new Error('no active two-bar bass section');
}

function bassPhases(style: string, seed: number): {
  contractId: string;
  phases: number[];
} {
  const bundle = buildSongBundle({ seed, styleHint: style, mood: 'build', targetDuration: 120, key: pc(0) });
  const result = generateSongFromBundle(bundle);
  expect(result.status, result.report.findings.map((finding) => finding.ruleId).join(',')).not.toBe('failed');
  const bass = result.ir!.tracks.find((track) => track.role === 'bass');
  expect(bass).toBeDefined();
  const beatsPerBar = bundle.arrangement.meter.numerator * (4 / bundle.arrangement.meter.denominator);
  const bar = activeBodyBar(bundle);
  const barStart = bar * beatsPerBar;
  const phases = bass!.notes
    .map((note) => (note.startTick as number) / bundle.timebase.ppq - barStart)
    .filter((beat) => beat >= -0.02 && beat < beatsPerBar - 0.02);
  return { contractId: bundle.arrangement.songGrooveContract.id, phases };
}

const nearestError = (values: readonly number[], target: number): number =>
  Math.min(...values.map((value) => Math.abs(value - target)));

describe('production GrooveContract clock ownership', () => {
  it('R&B Gospel keeps authored 2/3 triplets instead of applying swing twice', () => {
    const { contractId, phases } = bassPhases('rnb', 7);
    expect(contractId).toBe('rnb_gospel_triplet');
    expect(nearestError(phases, 2 / 3)).toBeLessThanOrEqual(0.02);
  });

  it('R&B Dilla swings sixteenth pairs without moving the eighth boundary at 1.5', () => {
    const { contractId, phases } = bassPhases('rnb', 15);
    expect(contractId).toBe('rnb_dilla_pocket');
    expect(nearestError(phases, 1.5)).toBeLessThanOrEqual(0.025);
  });
});
