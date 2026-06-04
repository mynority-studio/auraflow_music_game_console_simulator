import { describe, it, expect } from 'vitest';
import { chordIntervalRole, pickColorTones } from './chordIntervalRoles';
import { pc } from '../foundation';

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
  // 注:pickColorTones 是给【旋律/上层结构 + 宽和弦 producer】参考用的可用张力筛选器,
  //   不再给 comp 加色(色彩走旋律的上层结构,comp 守内层骨干;9 不折成 2 防摩擦)。
});
