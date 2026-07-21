import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('drum humanity production baseline', () => {
  it('exports the four-style tempo/seed matrix and report', async () => {
    await import('./audit-drum-humanity');
    expect(existsSync(resolve('docs/generated/drum_humanity_baseline.md'))).toBe(true);
    expect(existsSync(resolve('docs/generated/drum_humanity_baseline.json'))).toBe(true);
    expect(existsSync(resolve('tmp/drum-humanity-baseline/pop-120-7.drums.mid'))).toBe(true);

    const rows = JSON.parse(readFileSync(resolve('docs/generated/drum_humanity_baseline.json'), 'utf8')) as Array<{
      style: 'pop' | 'rnb' | 'lofi' | 'jazz';
      audit: {
        noteCount: number;
        snareAccentGhostSeparation: number | null;
        voices: Record<string, { count: number; velocityStdDev: number; timingOffsetStdDevMs: number; exactGridRatio: number }>;
      };
    }>;
    expect(rows).toHaveLength(36);
    for (const style of ['pop', 'rnb', 'lofi', 'jazz'] as const) {
      const selected = rows.filter((row) => row.style === style);
      expect(selected).toHaveLength(9);
      expect(selected.every((row) => row.audit.noteCount > 100)).toBe(true);
      const averageExact = selected.reduce((sum, row) => {
        const voices = Object.values(row.audit.voices);
        return sum + voices.reduce((voiceSum, entry) => voiceSum + entry.exactGridRatio, 0) / voices.length;
      }, 0) / selected.length;
      expect(averageExact, `${style} must not collapse onto the exact grid`).toBeLessThan(0.7);
    }
    for (const style of ['pop', 'rnb', 'lofi'] as const) {
      const separation = rows
        .filter((row) => row.style === style && row.audit.snareAccentGhostSeparation !== null)
        .map((row) => row.audit.snareAccentGhostSeparation!);
      expect(Math.min(...separation), `${style} accent/ghost hierarchy`).toBeGreaterThan(20);
    }
    const report = readFileSync(resolve('docs/generated/drum_humanity_baseline.md'), 'utf8');
    expect(report).toContain('| POP | 4 | 5 | 15 |');
    expect(report).toContain('| JAZZ | 6 | 5 | 13 |');
  }, 120_000);
});
