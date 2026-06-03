import { describe, it, expect } from 'vitest';
import { renderSong } from './renderCoordinator';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { isPass } from '../ir/AuditReport';
import { createTimebase, pc } from '../foundation';

describe('render/renderCoordinator', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [
      { degree: 1, quality: 'maj7', bars: 1 },
      { degree: 6, quality: 'm7', bars: 1 },
      { degree: 4, quality: 'maj7', bars: 1 },
      { degree: 5, quality: '7', bars: 1 },
    ],
  });
  const { ir, audit } = renderSong(plan, timebase);

  it('产出 bass / comp / lead 三轨(lead 占位空)', () => {
    expect(ir.tracks.map((t) => t.role)).toEqual(['bass', 'comp', 'lead']);
    expect(ir.tracks.find((t) => t.role === 'lead')!.notes).toEqual([]);
  });

  it('durationTicks = 4 小节 = 4*1920 = 7680', () => {
    expect(ir.durationTicks).toBe(7680);
  });

  it('Slice 0 伴奏全是和弦音 → Auditor pass', () => {
    expect(isPass(audit)).toBe(true);
  });

  it('IR 深不可变', () => {
    expect(Object.isFrozen(ir)).toBe(true);
    expect(Object.isFrozen(ir.tracks)).toBe(true);
  });

  it('确定性:同 plan+timebase → 同音符序列', () => {
    const again = renderSong(plan, timebase);
    const pitches = (r: typeof again) => r.ir.tracks.flatMap((t) => t.notes.map((n) => n.pitch));
    expect(pitches(again)).toEqual(pitches({ ir, audit }));
  });
});
