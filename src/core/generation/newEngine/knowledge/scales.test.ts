import { describe, it, expect } from 'vitest';
import { degreeToSemitone, scaleSemitones } from './scales';

describe('knowledge/scales', () => {
  it('大调音阶', () => {
    expect(scaleSemitones('major')).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });
  it('自然小调音阶', () => {
    expect(scaleSemitones('minor')).toEqual([0, 2, 3, 5, 7, 8, 10]);
  });
  it('degreeToSemitone', () => {
    expect(degreeToSemitone(1, 'major')).toBe(0); // I
    expect(degreeToSemitone(5, 'major')).toBe(7); // V
    expect(degreeToSemitone(6, 'major')).toBe(9); // vi
    expect(degreeToSemitone(3, 'minor')).toBe(3); // bIII
  });
  it('越界度数 → 抛', () => {
    expect(() => degreeToSemitone(0, 'major')).toThrow(RangeError);
    expect(() => degreeToSemitone(8, 'major')).toThrow(RangeError);
  });
});
