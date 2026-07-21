import { describe, expect, it } from 'vitest';
import type { InstrumentRoleName } from '../band/BandSpec';
import { dream5504OrchestrationBank } from './instruments';

describe('Dream 5504 orchestration owns variation selection', () => {
  it('does not infer resonant, FX, pad or guitar variations from style plus Program alone', () => {
    const styles = ['pop', 'lofi', 'rnb', 'jazz'] as const;
    const roles: InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum'];

    for (const style of styles) {
      for (const role of roles) {
        for (let program = 0; program < 128; program++) {
          const bank = dream5504OrchestrationBank(style, role, program);
          const expected = role === 'drum'
            ? undefined
            : role === 'comp' && program === 5 && style !== 'jazz'
              ? 16
              : role === 'lead' && program === 66 && style === 'jazz'
                ? 8
                : 0;
          expect(bank, `${style}/${role}/PC${program}`).toBe(expected);
        }
      }
    }
  });
});
