import { describe, it, expect } from 'vitest';
import { auditHarmony } from './readOnlyHarmonyAuditor';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { createTimebase, midi, pc, ticks } from '../foundation';

describe('render/readOnlyHarmonyAuditor', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  // Cmaj7 一小节
  const plan = buildHarmonicPlan({
    key: pc(0),
    beatsPerBar: 4,
    progression: [{ degree: 1, quality: 'maj7', bars: 1 }],
  });

  it('纯和弦音伴奏 → 无 findings(pass)', () => {
    const tracks = renderAccompaniment(plan, timebase);
    const ir = freezeMusicalIR({ tracks, timebase, durationTicks: ticks(1920) });
    expect(auditHarmony(ir, plan, timebase).findings).toEqual([]);
  });

  it('avoid note(F,pc5)长时值暴露 → error', () => {
    const ir = freezeMusicalIR({
      tracks: [{ role: 'lead', notes: [{ pitch: midi(65), startTick: ticks(0), durationTicks: ticks(480), velocity: 80 }] }], // F4=65, pc5=Cmaj7 的 11(avoid)
      timebase,
      durationTicks: ticks(1920),
    });
    const report = auditHarmony(ir, plan, timebase);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0].ruleId).toBe('avoid-long-exposure');
    expect(report.findings[0].severity).toBe('error');
  });

  it('avoid note 但短时值(<1 拍)→ 不报', () => {
    const ir = freezeMusicalIR({
      tracks: [{ role: 'lead', notes: [{ pitch: midi(65), startTick: ticks(0), durationTicks: ticks(120), velocity: 80 }] }], // 1/4 拍
      timebase,
      durationTicks: ticks(1920),
    });
    expect(auditHarmony(ir, plan, timebase).findings).toEqual([]);
  });

  it('安全音(E=64)长时值 → 不报', () => {
    const ir = freezeMusicalIR({
      tracks: [{ role: 'lead', notes: [{ pitch: midi(64), startTick: ticks(0), durationTicks: ticks(480), velocity: 80 }] }], // E = 和弦音
      timebase,
      durationTicks: ticks(1920),
    });
    expect(auditHarmony(ir, plan, timebase).findings).toEqual([]);
  });
});
