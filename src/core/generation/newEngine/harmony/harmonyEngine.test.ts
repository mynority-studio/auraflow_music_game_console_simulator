import { describe, it, expect } from 'vitest';
import { buildHarmonicPlan } from './harmonyEngine';
import { pc } from '../foundation';

describe('harmony/harmonyEngine', () => {
  // C 大调 I-vi-IV-V,每和弦 1 小节 4 拍
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

  it('根音按大调度数解析', () => {
    const roots = plan.chordTimeline.map((c) => c.rootPc);
    expect(roots).toEqual([0, 9, 5, 7]); // C A F G
  });

  it('功能时间线 T-T-S-D', () => {
    expect(plan.chordFunctionTimeline).toEqual(['T', 'T', 'S', 'D']);
  });

  it('和弦起点/时长按拍累加', () => {
    expect(plan.chordTimeline.map((c) => c.startBeat)).toEqual([0, 4, 8, 12]);
    expect(plan.chordTimeline.map((c) => c.durationBeats)).toEqual([4, 4, 4, 4]);
  });

  it('逐和弦张力表填好(G7 的 avoid 含 C)', () => {
    const g7 = plan.chordTimeline[3].id;
    expect(plan.avoidNoteMap[g7]).toContain(0);
    expect(plan.stableToneMap[g7]).toEqual(expect.arrayContaining([7, 11, 2, 5]));
  });

  it('返回的 HarmonicPlan 深不可变(改 timeline / map 都抛)', () => {
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.chordTimeline)).toBe(true);
    expect(() => { (plan as unknown as { chordTimeline: unknown[] }).chordTimeline.push({}); }).toThrow(TypeError);
    const id = plan.chordTimeline[0].id;
    expect(() => { (plan.tensionMap[id].stable as unknown as number[]).push(99); }).toThrow(TypeError);
  });

  it('确定性:同输入 → 同根音序列', () => {
    const again = buildHarmonicPlan({
      key: pc(0),
      beatsPerBar: 4,
      progression: [
        { degree: 1, quality: 'maj7', bars: 1 },
        { degree: 6, quality: 'm7', bars: 1 },
        { degree: 4, quality: 'maj7', bars: 1 },
        { degree: 5, quality: '7', bars: 1 },
      ],
    });
    expect(again.chordTimeline.map((c) => c.rootPc)).toEqual(plan.chordTimeline.map((c) => c.rootPc));
  });

  it('空进行 → 抛', () => {
    expect(() => buildHarmonicPlan({ key: pc(0), beatsPerBar: 4, progression: [] })).toThrow(RangeError);
  });
});
