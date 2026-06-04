import { describe, it, expect } from 'vitest';
import { normalizeChordType, getChordType, getChordPitchClasses, listChordTypes, chordToneIntervals } from './chords';
import { pc } from '../foundation';

describe('knowledge · ChordLibrary 宽和弦 (KB 移植 §2)', () => {
  it('normalizeChordType:别名归一化 + 大小写敏感(M7≠m7)', () => {
    expect(normalizeChordType('Maj7')).toBe('maj7');
    expect(normalizeChordType('M7')).toBe('maj7');   // 大写 M7 = maj7
    expect(normalizeChordType('m7')).toBe('m7');
    expect(normalizeChordType('-7')).toBe('m7');
    expect(normalizeChordType('ø')).toBe('m7b5');
    expect(normalizeChordType('Hendrix')).toBe('7#9');
    expect(normalizeChordType('MAJ7')).toBe('maj7'); // 全大写 → 小写兜底
    expect(normalizeChordType('M99')).toBeNull();     // M<digit> 未知不降级
    expect(normalizeChordType('zzz')).toBeNull();
  });

  it('listChordTypes:46 种', () => {
    expect(listChordTypes().length).toBe(46);
  });

  it('★ 张力保 compound 高位(9=14 不折成 2):maj9 intervals 含 14;pc 折成 2', () => {
    expect(getChordType('maj9').intervals).toEqual([0, 4, 7, 11, 14]); // 9 = +14
    expect(getChordType('add9').intervals).toContain(14);
    expect(getChordType('13').intervals).toContain(21); // 13 = +21
    expect(getChordPitchClasses(pc(0), 'maj9')).toEqual([0, 4, 7, 11, 2]); // pc 集合:9→pc2
  });

  it('快照:每个 id getChordPitchClasses 非空 + 首音=根音', () => {
    for (const id of listChordTypes()) {
      const pcs = getChordPitchClasses(pc(0), id);
      expect(pcs.length).toBeGreaterThan(0);
      expect(pcs[0]).toBe(0);
    }
  });

  it('narrow 兼容层不变:chordToneIntervals(7 品质)原样', () => {
    expect(chordToneIntervals('maj7')).toEqual([0, 4, 7, 11]);
    expect(chordToneIntervals('m7b5')).toEqual([0, 3, 6, 10]);
  });
});
