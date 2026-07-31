import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LOFI Hip Hop arrangement production audit', () => {
  it('passes all 200-seed gates and exports five layered MIDI review packs', async () => {
    await import('./audit-lofi-hiphop-arrangement');
    const jsonPath = resolve('docs/generated/lofi_hiphop_arrangement_audit.json');
    const reportPath = resolve('docs/generated/lofi_hiphop_arrangement_audit.md');
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
      hardGates: Record<string, boolean>;
      rows: unknown[];
    };
    expect(report.rows).toHaveLength(200);
    expect(Object.values(report.hardGates).every(Boolean)).toBe(true);
    for (const seed of [0, 2, 7, 42, 99]) {
      const dir = resolve('tmp/lofi-hiphop-arrangement', `seed-${seed}`);
      for (const name of ['drum.mid', 'drum+bass.mid', 'drum+bass+comp.mid', 'full.mid', 'arrangement-log.json']) {
        expect(existsSync(resolve(dir, name)), `${seed}/${name}`).toBe(true);
      }
    }
  }, 60_000);
});

