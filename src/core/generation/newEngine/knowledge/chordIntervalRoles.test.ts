import { describe, it, expect } from 'vitest';
import { chordIntervalRole, pickColorTones } from './chordIntervalRoles';
import { renderAccompaniment } from '../render/accompanimentRenderer';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { createTimebase, mod12, pc } from '../foundation';

describe('knowledge · chordIntervalRoles (KB 港:和弦内音程角色)', () => {
  it('maj:9(2)=可用张力 / 4 度(5)=avoid / b3(3)=avoid / 13(9)=可用张力', () => {
    expect(chordIntervalRole('maj7', 2).role).toBe('AVAILABLE_TENSION'); // 9
    expect(chordIntervalRole('maj7', 5).role).toBe('AVOID_NOTE');        // 4 度
    expect(chordIntervalRole('maj7', 3).role).toBe('AVOID_NOTE');        // b3
    expect(chordIntervalRole('maj7', 9).role).toBe('AVAILABLE_TENSION'); // 13
  });

  it('dom:b9(1)/#9(3)=改变张力 / 11(5)=avoid / maj7(11)=avoid / 9(2)=可用张力', () => {
    expect(chordIntervalRole('7', 1).role).toBe('ALTERED_TENSION');
    expect(chordIntervalRole('7', 3).role).toBe('ALTERED_TENSION');
    expect(chordIntervalRole('7', 5).role).toBe('AVOID_NOTE');
    expect(chordIntervalRole('7', 11).role).toBe('AVOID_NOTE');
    expect(chordIntervalRole('7', 2).role).toBe('AVAILABLE_TENSION');
  });

  it('pickColorTones:只取可用张力,按 tensionLevel 升序(温和优先),取前 count', () => {
    // Cmaj7 候选 9(D=2,t0.3)/ #11(F#=6,t0.6)/ 13(A=9,t0.4) → 升序 9,13,#11
    const cands = [6, 9, 2]; // 乱序
    expect(pickColorTones('maj7', pc(0), cands, 2)).toEqual([2, 9]); // 9 再 13
    expect(pickColorTones('maj7', pc(0), cands, 1)).toEqual([2]);    // 只 9
    expect(pickColorTones('maj7', pc(0), cands, 0)).toEqual([]);     // 预算 0=纯净
    // avoid 候选(4度=5)被滤掉
    expect(pickColorTones('maj7', pc(0), [5], 2)).toEqual([]);
  });
});

describe('render · comp 彩色 voicing(消费者:accompanimentRenderer 接 colorToneMap)', () => {
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const plan = buildHarmonicPlan({ key: pc(0), beatsPerBar: 4, progression: [{ degree: 1, quality: 'maj7', bars: 1 }] });

  it('★ colorCount>0 → comp 含可用张力(超出骨干 0/4/7/11);colorCount=0 → 纯骨干', () => {
    const chordTones = new Set([0, 4, 7, 11]);
    const colored = renderAccompaniment(plan, timebase, { style: 'jazz', colorCount: 2 })[0].notes.map((n) => mod12(n.pitch));
    const plain = renderAccompaniment(plan, timebase, { style: 'jazz', colorCount: 0 })[0].notes.map((n) => mod12(n.pitch));
    expect(colored.some((p) => !chordTones.has(p))).toBe(true);  // 出现张力色彩音
    expect(plain.every((p) => chordTones.has(p))).toBe(true);    // 纯净=只骨干
  });
});
