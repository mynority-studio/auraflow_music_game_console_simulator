import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LOFI Musical Foundation V2 production audit', () => {
  it('passes the 500-seed arrangement gates and exports a stratified review pack', async () => {
    await import('./audit-lofi-musical-foundation');
    const afterPath = resolve('docs/generated/lofi_musical_foundation_after.json');
    const reportPath = resolve('docs/generated/lofi_musical_foundation_comparison.md');
    const referencePath = resolve('docs/generated/lofi_reference_arrangement_envelope.json');
    const beforePath = resolve('docs/generated/lofi_musical_foundation_before.json');
    for (const path of [afterPath, reportPath, referencePath, beforePath]) {
      expect(existsSync(path), path).toBe(true);
    }
    const report = JSON.parse(readFileSync(afterPath, 'utf8')) as {
      seedCount: number;
      hardGates: Record<string, boolean>;
      reviewSeeds: number[];
    };
    expect(report.seedCount).toBe(500);
    expect(Object.values(report.hardGates).every(Boolean)).toBe(true);
    expect(report.reviewSeeds).toHaveLength(16);
    for (const seed of report.reviewSeeds) {
      const dir = resolve('tmp/lofi-musical-foundation-review', `seed-${seed}`);
      for (const name of [
        'drum.mid',
        'drum+top.mid',
        'foundation.mid',
        'full.mid',
        'foundation-log.json',
        'arrangement-log.json',
        'feature-comparison.json',
        'review.md',
      ]) {
        expect(existsSync(resolve(dir, name)), `${seed}/${name}`).toBe(true);
      }
    }
  }, 180_000);
});
