import { describe, it, expect } from 'vitest';
import { auditHarmony } from './readOnlyHarmonyAuditor';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { freezeMusicalIR } from '../ir/MusicalIR';
import { createTimebase, midi, pc, ticks } from '../foundation';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';

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

  it('avoid note 只有在弱拍且短时值时可作为经过音', () => {
    const ir = freezeMusicalIR({
      tracks: [{ role: 'lead', notes: [{ pitch: midi(65), startTick: ticks(240), durationTicks: ticks(120), velocity: 80 }] }], // 弱拍 1/4 拍
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

  it('声明过的 bass pedal 本音即使在 avoid map 内也不触发 R1 error', () => {
    const span = plan.chordTimeline[0];
    const pedalPlan = {
      ...plan,
      chordTimeline: [
        {
          ...span,
          bassRole: 'pedal',
          bassPedalPc: pc(5),
        },
      ],
      avoidNoteMap: {
        ...plan.avoidNoteMap,
        [span.id]: [pc(5)],
      },
    } as HarmonicPlan;
    const ir = freezeMusicalIR({
      tracks: [{ role: 'bass', notes: [{ pitch: midi(53), startTick: ticks(0), durationTicks: ticks(1920), velocity: 80 }] }],
      timebase,
      durationTicks: ticks(1920),
    });

    expect(auditHarmony(ir, pedalPlan, timebase).findings).toEqual([]);
  });

  it('持续音进入多个后续和弦且成为 avoid → 在首个违规边界只报一次 error', () => {
    const multiChordPlan = buildHarmonicPlan({
      key: pc(0),
      beatsPerBar: 4,
      progression: [
        { degree: 1, quality: 'maj7', bars: 1 },
        { degree: 5, quality: '7', bars: 1 },
        { degree: 4, quality: 'maj7', bars: 1 },
      ],
    });
    const [first, second, third] = multiChordPlan.chordTimeline;
    const crossingPlan = {
      ...multiChordPlan,
      avoidNoteMap: {
        ...multiChordPlan.avoidNoteMap,
        [first.id]: [],
        [second.id]: [pc(0)],
        [third.id]: [pc(0)],
      },
    } as HarmonicPlan;
    const ir = freezeMusicalIR({
      // beat3→9:在第二和弦暴露 4 拍、第三和弦暴露 1 拍；同一个待修音不得重复报两次。
      tracks: [{ role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(1440), durationTicks: ticks(2880), velocity: 80 }] }],
      timebase,
      durationTicks: ticks(5760),
    });

    const report = auditHarmony(ir, crossingPlan, timebase);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'avoid-long-exposure',
      severity: 'error',
      location: { trackRole: 'lead', startTick: 1920 },
    });
    expect(report.findings[0].reason).toContain(second.id);
  });

  it('持续音进入后续和弦满 2 拍且离调 → 按后续 span 暴露报一次 warning', () => {
    const twoChordPlan = buildHarmonicPlan({
      key: pc(0),
      beatsPerBar: 4,
      progression: [
        { degree: 1, quality: 'maj7', bars: 1 },
        { degree: 5, quality: '7', bars: 1 },
      ],
    });
    const [first, second] = twoChordPlan.chordTimeline;
    const crossingPlan = {
      ...twoChordPlan,
      avoidNoteMap: { ...twoChordPlan.avoidNoteMap, [first.id]: [], [second.id]: [] },
      chordScaleMap: {
        ...twoChordPlan.chordScaleMap,
        [first.id]: [pc(1)],
        [second.id]: [pc(0), pc(2), pc(4), pc(5), pc(7), pc(9), pc(11)],
      },
    } as HarmonicPlan;
    const ir = freezeMusicalIR({
      tracks: [{ role: 'comp', notes: [{ pitch: midi(73), startTick: ticks(1440), durationTicks: ticks(1440), velocity: 80 }] }],
      timebase,
      durationTicks: ticks(3840),
    });

    const report = auditHarmony(ir, crossingPlan, timebase);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      ruleId: 'chromatic-exposure',
      severity: 'warning',
      location: { trackRole: 'comp', startTick: 1920 },
    });
    expect(report.findings[0].reason).toContain(second.id);
  });
});
