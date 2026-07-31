import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LOFI phrase interaction V3 local harmony production audit', () => {
  it('keeps Clark harmony pooled and passes grammar/texture local-harmony gates', async () => {
    await import('./audit-lofi-phrase-interaction');
    const jsonPath = resolve('docs/generated/lofi_phrase_interaction_local_harmony_audit.json');
    const markdownPath = resolve('docs/generated/lofi_phrase_interaction_local_harmony_audit.md');
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
      seedCount: number;
      hardGates: Record<string, boolean>;
      selectedClarkIds: string[];
    };
    expect(report.seedCount).toBe(Number(process.env.LOFI_PHRASE_AUDIT_SEEDS ?? 200));
    expect(report.selectedClarkIds.length).toBeGreaterThan(0);
    expect(Object.values(report.hardGates).every(Boolean)).toBe(true);
  }, 120_000);
});
