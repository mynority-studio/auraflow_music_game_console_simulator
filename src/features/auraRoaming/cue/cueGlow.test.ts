import { describe, expect, it } from 'vitest';
import { cueGlowIntensity, snuffGlow, type AuraCueGlowSpec } from './cueGlow';

const GLOW: AuraCueGlowSpec = {
  cueId: 1, col: 2, row: 1, hue: 272,
  peakAtMs: 1000, riseMs: 400, holdMs: 320, fadeMs: 260,
};

describe('auraRoaming/cueGlow — 呼吸包络', () => {
  it('灭 → 缓升 → 峰值 → 保持 → 渐灭 → 移除', () => {
    expect(cueGlowIntensity(599, GLOW)).toBe(0);            // rise 前
    expect(cueGlowIntensity(800, GLOW)).toBeCloseTo(0.5, 5); // 余弦中点
    expect(cueGlowIntensity(1000, GLOW)).toBe(1);            // 峰值(音符发声前 50~100ms 由调用方保证)
    expect(cueGlowIntensity(1300, GLOW)).toBe(1);            // 保持窗内
    const fading = cueGlowIntensity(1450, GLOW);             // 渐灭中
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    expect(cueGlowIntensity(1581, GLOW)).toBe(-1);           // 结束
  });

  it('缓升单调不减', () => {
    let prev = -1;
    for (let t = 600; t <= 1000; t += 40) {
      const v = cueGlowIntensity(t, GLOW);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('snuffGlow:峰值后命中 → 立即进入快速渐灭', () => {
    const snuffed = snuffGlow(GLOW, 1100, 140);
    expect(cueGlowIntensity(1100, snuffed)).toBe(1);
    expect(cueGlowIntensity(1239, snuffed)).toBeGreaterThan(0);
    expect(cueGlowIntensity(1241, snuffed)).toBe(-1);
  });

  it('snuffGlow:峰值前早按 → 峰值截断到当下再快灭', () => {
    const snuffed = snuffGlow(GLOW, 900, 140);
    expect(snuffed.peakAtMs).toBe(900);
    expect(cueGlowIntensity(900, snuffed)).toBe(1);
    expect(cueGlowIntensity(1041, snuffed)).toBe(-1);
  });
});
