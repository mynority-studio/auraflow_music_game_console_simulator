import { describe, it, expect } from 'vitest';
import { getScaleType, listScaleTypes, getScalePitchClasses, MAJOR_SCALE, NATURAL_MINOR } from './scales';
import { pc } from '../foundation';

describe('knowledge · ScaleLibrary (KB 移植 §1)', () => {
  it('getScaleType:intervals + family 逐值忠实', () => {
    expect(getScaleType('Dorian').intervals).toEqual([0, 2, 3, 5, 7, 9, 10]);
    expect(getScaleType('Dorian').family).toBe('diatonic-mode');
    expect(getScaleType('Bebop Dominant').intervals).toEqual([0, 2, 4, 5, 7, 9, 10, 11]);
    expect(getScaleType('Bebop Dominant').family).toBe('bebop');
    expect(getScaleType('Blues').intervals).toEqual([0, 3, 5, 6, 7, 10]);
    expect(getScaleType('Altered').family).toBe('jazz-symmetric');
    expect(getScaleType('Chromatic').intervals.length).toBe(12);
  });

  it('listScaleTypes:全 36 种;family/source 过滤生效', () => {
    expect(listScaleTypes().length).toBe(36);
    expect(listScaleTypes({ family: 'diatonic-mode' }).length).toBe(7);
    expect(listScaleTypes({ family: 'bebop' }).length).toBe(4);
    // core = 调式(7) + 小调变体(2) = 9
    expect(listScaleTypes({ source: 'core' }).length).toBe(9);
    expect(listScaleTypes({ source: 'extended' }).length).toBe(36 - 9);
  });

  it('getScalePitchClasses:D Dorian = D E F G A B C', () => {
    expect(getScalePitchClasses(pc(2), 'Dorian')).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });

  it('快照完整性:每个 id 都有非空 intervals,且首音=0(主音)', () => {
    for (const d of listScaleTypes()) {
      expect(d.intervals.length).toBeGreaterThan(0);
      expect(d.intervals[0]).toBe(0);
    }
  });

  it('兼容层不变:MAJOR_SCALE / NATURAL_MINOR 与 Ionian/Aeolian 一致', () => {
    expect([...MAJOR_SCALE]).toEqual(getScaleType('Ionian').intervals as number[]);
    expect([...NATURAL_MINOR]).toEqual(getScaleType('Aeolian').intervals as number[]);
  });
});
