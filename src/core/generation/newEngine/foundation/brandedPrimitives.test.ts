import { describe, it, expect } from 'vitest';
import { pc, mod12, midi, beats, ticks } from './brandedPrimitives';

describe('foundation/brandedPrimitives', () => {
  describe('pc', () => {
    it('接受 0..11 整数,运行期保留数值', () => {
      expect(pc(0)).toBe(0);
      expect(pc(7)).toBe(7);
      expect(pc(11)).toBe(11);
    });
    it('越界 / 非整数 / 非有限数 → RangeError', () => {
      expect(() => pc(-1)).toThrow(RangeError);
      expect(() => pc(12)).toThrow(RangeError);
      expect(() => pc(1.5)).toThrow(RangeError);
      expect(() => pc(NaN)).toThrow(RangeError);
      expect(() => pc(Infinity)).toThrow(RangeError);
    });
  });

  describe('mod12', () => {
    it('整数环绕到 0..11', () => {
      expect(mod12(12)).toBe(0);
      expect(mod12(-1)).toBe(11);
      expect(mod12(13)).toBe(1);
      expect(mod12(0)).toBe(0);
      expect(mod12(24)).toBe(0);
    });
    it('非整数 → 抛', () => {
      expect(() => mod12(1.5)).toThrow(RangeError);
      expect(() => mod12(NaN)).toThrow(RangeError);
    });
  });

  describe('midi', () => {
    it('接受 0..127 整数', () => {
      expect(midi(0)).toBe(0);
      expect(midi(60)).toBe(60);
      expect(midi(127)).toBe(127);
    });
    it('越界 / 非整数 → 抛', () => {
      expect(() => midi(-1)).toThrow(RangeError);
      expect(() => midi(128)).toThrow(RangeError);
      expect(() => midi(60.5)).toThrow(RangeError);
    });
  });

  describe('beats', () => {
    it('接受有限非负数(含分数)', () => {
      expect(beats(0)).toBe(0);
      expect(beats(1)).toBe(1);
      expect(beats(0.5)).toBe(0.5);
      expect(beats(1 / 3)).toBeCloseTo(0.3333, 4);
    });
    it('负数 / 非有限数 → 抛', () => {
      expect(() => beats(-1)).toThrow(RangeError);
      expect(() => beats(NaN)).toThrow(RangeError);
      expect(() => beats(Infinity)).toThrow(RangeError);
    });
  });

  describe('ticks', () => {
    it('接受非负整数', () => {
      expect(ticks(0)).toBe(0);
      expect(ticks(480)).toBe(480);
    });
    it('负数 / 非整数 → 抛', () => {
      expect(() => ticks(-1)).toThrow(RangeError);
      expect(() => ticks(1.5)).toThrow(RangeError);
    });
  });
});
