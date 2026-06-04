import { describe, it, expect } from 'vitest';
import { guideToneShell, voiceComp } from './voicings';

describe('knowledge/voicings · guideToneShell', () => {
  it('7 和弦 → [3 音, 7 音]', () => {
    expect(guideToneShell('maj7')).toEqual([4, 11]);
    expect(guideToneShell('m7')).toEqual([3, 10]);
    expect(guideToneShell('7')).toEqual([4, 10]);
  });
  it('三和弦无 7 → 只留 3 音', () => {
    expect(guideToneShell('maj')).toEqual([4]);
    expect(guideToneShell('min')).toEqual([3]);
  });
});

describe('knowledge/voicings · voiceComp (1.3)', () => {
  const CMAJ7 = [0, 4, 7, 11];
  const G7 = [7, 11, 2, 5];

  it('jazz:rootless — 去根音', () => {
    const v = voiceComp(CMAJ7, 'jazz', 67);
    expect(v.some((m) => m % 12 === 0)).toBe(false); // 无根音 C(0)
    expect(v.length).toBe(3); // E G B
  });

  it('pop:保留全部 chord tone', () => {
    const v = voiceComp(CMAJ7, 'pop', 67);
    expect(new Set(v.map((m) => m % 12))).toEqual(new Set(CMAJ7));
  });

  it('所有音都是 chord tone(Auditor safe)', () => {
    const v = voiceComp(G7, 'pop', 67);
    for (const m of v) expect(new Set(G7).has(m % 12)).toBe(true);
  });

  it('★ 顶音 voice-leading:顶音贴 prevTop(≤6 半音)', () => {
    const v1 = voiceComp(CMAJ7, 'jazz', 67);
    const top1 = v1[v1.length - 1];
    const v2 = voiceComp(G7, 'jazz', top1);
    const top2 = v2[v2.length - 1];
    expect(Math.abs(top2 - top1)).toBeLessThanOrEqual(6);
  });

  it('落 comp 区 [52,76];非簇(升序去重)', () => {
    const v = voiceComp(CMAJ7, 'pop', 67);
    for (const m of v) {
      expect(m).toBeGreaterThanOrEqual(52);
      expect(m).toBeLessThanOrEqual(76);
    }
    expect([...new Set(v)].sort((a, b) => a - b)).toEqual(v);
  });

  it('空输入 → []', () => {
    expect(voiceComp([], 'pop', 67)).toEqual([]);
  });
});
