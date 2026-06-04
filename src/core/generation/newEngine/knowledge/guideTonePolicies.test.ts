import { describe, it, expect } from 'vitest';
import { guideTonePcs, guideToneMidi } from './guideTonePolicies';

describe('knowledge/guideTonePolicies (2.3)', () => {
  it('guideTonePcs:Cmaj7 → 3音E(4)/7音B(11);G7 → B(11)/F(5)', () => {
    expect(guideTonePcs(0, 'maj7')).toEqual({ third: 4, seventh: 11 });
    expect(guideTonePcs(7, '7')).toEqual({ third: 11, seventh: 5 });
  });
  it('三和弦无 7', () => {
    expect(guideTonePcs(0, 'maj').seventh).toBeUndefined();
  });

  it('guideToneMidi:返回 3 或 7 音(chord tone)', () => {
    const m = guideToneMidi(0, 'maj7', 67, 67, 84, false);
    expect([4, 11]).toContain(m % 12); // E 或 B
  });

  it('★ voice-leading:取离 prev 最近(≤6)', () => {
    const m = guideToneMidi(7, '7', 71, 67, 84, false); // prev=71(B);G7 导音 B(11)/F(5) → 选 B(71)
    expect(Math.abs(m - 71)).toBeLessThanOrEqual(6);
  });

  it('forceThird:强制 3 音(终止解决)', () => {
    const m = guideToneMidi(0, 'maj7', 71, 67, 84, true); // Cmaj7 强制 3 音 E
    expect(m % 12).toBe(4); // E
  });

  it('落 [low,high] 内', () => {
    const m = guideToneMidi(7, '7', 80, 67, 84, false);
    expect(m).toBeGreaterThanOrEqual(67);
    expect(m).toBeLessThanOrEqual(84);
  });
});
