import { describe, it, expect } from 'vitest';
import { guideToneShell } from './voicings';

describe('knowledge/voicings · guideToneShell', () => {
  it('7 和弦 → [3 音, 7 音]', () => {
    expect(guideToneShell('maj7')).toEqual([4, 11]); // C E..B
    expect(guideToneShell('m7')).toEqual([3, 10]);
    expect(guideToneShell('7')).toEqual([4, 10]);
    expect(guideToneShell('m7b5')).toEqual([3, 10]);
  });
  it('三和弦无 7 → 只留 3 音', () => {
    expect(guideToneShell('maj')).toEqual([4]);
    expect(guideToneShell('min')).toEqual([3]);
  });
});
