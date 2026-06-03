import { describe, it, expect } from 'vitest';
import { freezeMusicalIR } from './MusicalIR';
import { isPass, type AuditReport } from './AuditReport';
import { createTimebase, midi, ticks } from '../foundation';

describe('ir/MusicalIR', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });

  it('freezeMusicalIR 深不可变(改 notes 抛)', () => {
    const ir = freezeMusicalIR({
      tracks: [{ role: 'bass', notes: [{ pitch: midi(36), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }] }],
      timebase,
      durationTicks: ticks(480),
    });
    expect(Object.isFrozen(ir)).toBe(true);
    expect(Object.isFrozen(ir.tracks)).toBe(true);
    expect(Object.isFrozen(ir.tracks[0].notes)).toBe(true);
    expect(() => { (ir.tracks[0].notes as unknown as unknown[]).push({}); }).toThrow(TypeError);
  });

  it('timebase 方法穿透 deepFreeze 仍可调用(DeepReadonly Function leaf)', () => {
    const ir = freezeMusicalIR({ tracks: [], timebase, durationTicks: ticks(0) });
    expect(ir.timebase.beatToTick(timebase.barToBeat(1))).toBe(1920); // 4 拍 * 480
  });
});

describe('ir/AuditReport', () => {
  it('isPass:空 findings = pass', () => {
    expect(isPass({ findings: [] })).toBe(true);
    const bad: AuditReport = {
      findings: [{ severity: 'error', location: { trackRole: 'lead', startTick: 0 }, ruleId: 'x', reason: 'y', suggestedReturnPoint: 'rewind-melody' }],
    };
    expect(isPass(bad)).toBe(false);
  });
});
