import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LOFI full-note log exporter', () => {
  it('exports complete readable, TSV and JSON logs for four archetypes', async () => {
    await import('./export-lofi-full-note-logs');
    const root = resolve('tmp/lofi-full-note-logs');
    const expected = [
      'seed-0-slow-soul-boombap',
      'seed-1-slow-soul-halftime',
      'seed-3-ambient-study-boombap',
      'seed-4-dusty-dilla-boombap',
      'seed-3600133724-slow-soul-halftime',
    ];
    expect(existsSync(resolve(root, 'README.md'))).toBe(true);
    for (const dir of expected) {
      for (const name of [
        'summary.json',
        'full-note-log.json',
        'full-note-log.tsv',
        'full-note.log',
        'full.mid',
        'comp.mid',
      ]) {
        expect(existsSync(resolve(root, dir, name)), `${dir}/${name}`).toBe(true);
      }
      const log = JSON.parse(readFileSync(resolve(root, dir, 'full-note-log.json'), 'utf8')) as {
        summary: { totalNotes: number };
        notes: unknown[];
      };
      expect(log.notes).toHaveLength(log.summary.totalNotes);
      expect(log.notes.length).toBeGreaterThan(0);
    }
  }, 30_000);
});
