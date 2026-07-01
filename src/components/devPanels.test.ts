import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_PANELS } from './devPanels';

describe('components/devPanels — Q+H/Q+N ingress consolidation', () => {
  it('exposes Q+H as the only full-song generation entry in DevDock', () => {
    expect(DEV_PANELS.some((p) => p.id === 'pipeline' && p.combo === 'Q+H')).toBe(true);
    expect(DEV_PANELS.some((p) => p.id === 'newengine')).toBe(false);
    expect(DEV_PANELS.some((p) => p.combo === 'Q+N')).toBe(false);
  });

  it('does not mount the legacy NewEnginePanel in App', () => {
    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(appSource).not.toContain('NewEnginePanel');
  });
});
