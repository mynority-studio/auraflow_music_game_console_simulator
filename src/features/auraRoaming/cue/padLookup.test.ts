import { describe, expect, it } from 'vitest';
import { padIndexForPitch, type PadLookupCell } from './padLookup';

function cell(index: number, midi: number): PadLookupCell {
  return { index, midi, pc: ((midi % 12) + 12) % 12 };
}

describe('auraRoaming/padLookup — lead 音高反查键位', () => {
  const cells = [cell(0, 60), cell(1, 62), cell(2, 64), cell(7, 67), cell(14, 72)];

  it('精确 midi 命中', () => {
    expect(padIndexForPitch(cells, 64)).toBe(2);
  });

  it('round-robin 重复 cell → 取离中心 7 最近的', () => {
    const dup = [cell(0, 60), cell(6, 60), cell(14, 60)];
    expect(padIndexForPitch(dup, 60)).toBe(6);
  });

  it('布局无该 midi → 同 pitch-class 八度折叠', () => {
    expect(padIndexForPitch(cells, 48)).toBe(0);  // C3 → C4 cell
    expect(padIndexForPitch(cells, 79)).toBe(7);  // G5 → G4 cell
  });

  it('完全不在布局 → null(该提示跳过)', () => {
    expect(padIndexForPitch(cells, 61)).toBeNull();
  });
});
