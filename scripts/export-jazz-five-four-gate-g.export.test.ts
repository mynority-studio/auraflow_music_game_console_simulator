import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertGateGMidiClock,
  exportJazzFiveFourGateG,
} from './export-jazz-five-four-gate-g';

describe('Jazz 5/4 Gate-G listening artifact exporter', () => {
  it('fails closed, passes Gate G and writes clock-correct FinalIR stems', () => {
    const manifest = exportJazzFiveFourGateG();

    expect(manifest).toMatchObject({
      outputDir: 'tmp/jazz-five-four-gate-g',
      requestedAuditionBars: 16,
      actualBars: 33,
      tempoUsPerQuarter: 359_281,
      meter: '5/4',
      ppq: 480,
      gatePass: true,
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
    expect(manifest.artifacts.find((artifact) => artifact.fileName === 'full.mid')?.roles)
      .toEqual(['bass', 'comp', 'drum', 'lead']);
    expect(manifest.artifacts.find((artifact) => artifact.fileName === 'full-no-lead.mid')?.roles)
      .toEqual(['bass', 'comp', 'drum']);
    expect(manifest.artifacts.slice(0, 6).every((artifact) => artifact.source === 'production-final-ir-filter')).toBe(true);
    expect(manifest.artifacts.at(-1)?.source).toBe('script-click-helper');

    for (const artifact of manifest.artifacts) {
      const bytes = new Uint8Array(readFileSync(resolve(artifact.relativePath)));
      expect(bytes.length).toBe(artifact.byteLength);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(() => assertGateGMidiClock(bytes)).not.toThrow();
    }
    const corruptedTempo = new Uint8Array(readFileSync(resolve(manifest.outputDir, 'bass.mid')));
    const tempoMetaIndex = corruptedTempo.findIndex((byte, index) =>
      byte === 0xff && corruptedTempo[index + 1] === 0x51 && corruptedTempo[index + 2] === 0x03,
    );
    expect(tempoMetaIndex).toBeGreaterThan(0);
    corruptedTempo[tempoMetaIndex + 5] ^= 0x01;
    expect(() => assertGateGMidiClock(corruptedTempo)).toThrow(/exact 359281 us\/qn tempo meta/);

    expect(existsSync(resolve(manifest.outputDir, 'gate-g-report.json'))).toBe(true);
    const report = JSON.parse(readFileSync(resolve(manifest.outputDir, 'gate-g-report.json'), 'utf8'));
    expect(report.gateG).toMatchObject({ pass: true, issues: [] });
    expect(report.gateL).toMatchObject({
      pass: true,
      hardViolations: [],
      traceMissingCount: 0,
      outOfRangeCount: 0,
      offLatticeCount: 0,
    });
    expect(report.production.stemPolicy).toContain('FinalIR');
    expect(readFileSync(resolve(manifest.outputDir, 'README.md'), 'utf8')).toContain('not engine music');
  });
});
