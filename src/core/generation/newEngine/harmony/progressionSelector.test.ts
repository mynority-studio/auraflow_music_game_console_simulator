import { describe, it, expect } from 'vitest';
import { selectProgressionSlots } from './progressionSelector';
import { buildBandSpec } from '../band/bandEngine';
import { createRandomContext, pc } from '../foundation';
import type { Section } from '../arranger/ArrangementPlan';
import type { ProgressionSlot } from '../knowledge/progressions';

describe('harmony/progressionSelector · harmonyRole 消费 (T3)', () => {
  const band = buildBandSpec({ seed: 4, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
  const baseSection: Section = { id: 's0', role: 'verse', bars: 8, hookPolicy: 'light' };
  const sel = (section: Section) =>
    selectProgressionSlots({ band, section, hrng: createRandomContext(1).substream('harmony'), protoByGroup: new Map<string, ProgressionSlot[]>() });

  it('★ harmonyRole 优先于 role:POP 无 loop prototype → harmonyRole=loop 覆盖 verse → 返回 null', () => {
    expect(sel({ ...baseSection })).not.toBeNull(); // role=verse → POP verse prototype 存在
    expect(sel({ ...baseSection, harmonyRole: 'loop' })).toBeNull(); // harmonyRole=loop 覆盖 → POP 无 → null
  });

  it('lofi loop 段能命中 loop prototype(harmonyRole=loop 非 null)', () => {
    const lofiBand = buildBandSpec({ seed: 4, styleHint: 'lofi', mood: 'x', targetDuration: 120, key: pc(0) });
    const slots = selectProgressionSlots({
      band: lofiBand,
      section: { id: 'loopA', role: 'verse', harmonyRole: 'loop', bars: 8, hookPolicy: 'light' },
      hrng: createRandomContext(1).substream('harmony'),
      protoByGroup: new Map<string, ProgressionSlot[]>(),
    });
    expect(slots).not.toBeNull();
    expect(slots!.length).toBeGreaterThan(0);
  });
});
