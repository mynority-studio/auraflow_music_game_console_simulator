import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  exportJazzFiveFourGenerative,
  JAZZ_FIVE_FOUR_GENERATIVE_SEED,
} from './export-jazz-five-four-generative';
import { assertGateGMidiClock } from './export-jazz-five-four-gate-g';

describe('Jazz 5/4 generative production exporter', () => {
  it('writes audited FinalIR stems and a complete per-note score log', () => {
    const manifest = exportJazzFiveFourGenerative();
    expect(manifest).toMatchObject({
      outputDir: `tmp/jazz-five-four-generative/seed-${JAZZ_FIVE_FOUR_GENERATIVE_SEED}`,
      seed: JAZZ_FIVE_FOUR_GENERATIVE_SEED,
      actualBars: 33,
      meter: '5/4',
      ppq: 480,
      groovePass: true,
      leadPass: true,
    });
    expect(manifest.artifacts.map((artifact) => artifact.fileName)).toEqual([
      'full.mid',
      'full-no-lead.mid',
      'bass.mid',
      'comp.mid',
      'lead.mid',
      'drum.mid',
      'click.mid',
    ]);
    for (const artifact of manifest.artifacts) {
      const bytes = new Uint8Array(readFileSync(resolve(artifact.relativePath)));
      expect(bytes).toHaveLength(artifact.byteLength);
      expect(() => assertGateGMidiClock(bytes)).not.toThrow();
    }

    const log = JSON.parse(readFileSync(resolve(manifest.scoreLogRelativePath), 'utf8'));
    expect(log.events).toHaveLength(manifest.scoreEventCount);
    expect(log.events.every((event: Record<string, unknown>) =>
      Number.isInteger(event.nominalTick)
      && Number.isInteger(event.performedTick)
      && typeof event.pitchName === 'string'
      && typeof event.provenance === 'object')).toBe(true);
    expect(log.events.filter((event: { role: string }) => event.role === 'bass')
      .every((event: { absoluteBar: number }) => event.absoluteBar <= 8)).toBe(true);
    expect(log.events.filter((event: { role: string }) => event.role === 'comp')
      .every((event: { absoluteBar: number }) => event.absoluteBar >= 9)).toBe(true);

    const report = JSON.parse(readFileSync(resolve(manifest.reportRelativePath), 'utf8'));
    expect(report.scoreValidationIssues).toEqual([]);
    expect(report.gateG).toMatchObject({ pass: true, issues: [] });
    expect(report.gateL).toMatchObject({ pass: true, hardViolations: [] });
    expect(existsSync(resolve(manifest.outputDir, 'README.md'))).toBe(true);
  });
});
