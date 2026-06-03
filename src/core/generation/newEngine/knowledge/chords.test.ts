import { describe, it, expect } from 'vitest';
import { chordToneIntervals, chordTones, type ChordQuality } from './chords';
import { pc } from '../foundation';

describe('knowledge/chords', () => {
  it('各品质和弦音程正确', () => {
    expect(chordToneIntervals('maj')).toEqual([0, 4, 7]);
    expect(chordToneIntervals('min')).toEqual([0, 3, 7]);
    expect(chordToneIntervals('maj7')).toEqual([0, 4, 7, 11]);
    expect(chordToneIntervals('m7')).toEqual([0, 3, 7, 10]);
    expect(chordToneIntervals('7')).toEqual([0, 4, 7, 10]);
    expect(chordToneIntervals('m7b5')).toEqual([0, 3, 6, 10]);
    expect(chordToneIntervals('dim7')).toEqual([0, 3, 6, 9]);
  });

  it('chordTones 按根音环绕到 pc', () => {
    // Cmaj7 → C E G B
    expect(chordTones(pc(0), 'maj7')).toEqual([0, 4, 7, 11]);
    // G7 → G B D F
    expect(chordTones(pc(7), '7')).toEqual([7, 11, 2, 5]);
    // Am7 → A C E G
    expect(chordTones(pc(9), 'm7')).toEqual([9, 0, 4, 7]);
  });

  it('返回副本(不可污染内部表)', () => {
    const a = chordToneIntervals('maj7');
    a.push(99);
    expect(chordToneIntervals('maj7')).toEqual([0, 4, 7, 11]);
  });

  it('未知 quality → 抛', () => {
    expect(() => chordToneIntervals('xyz' as ChordQuality)).toThrow(RangeError);
  });
});
