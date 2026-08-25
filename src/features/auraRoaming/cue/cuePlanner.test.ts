import { describe, expect, it } from 'vitest';
import { planCues } from './cuePlanner';
import type { AccentCandidate } from '../types';

const PPQ = 480;

/** 密集候选场:每 0.5 拍一个,分数偏爱正拍/小节头(接近真实 accent 分布)。 */
function denseCandidates(totalBeats: number): AccentCandidate[] {
  const out: AccentCandidate[] = [];
  let noteIndex = 0;
  for (let beat = 0; beat < totalBeats; beat += 0.5) {
    const isBarStart = beat % 4 === 0;
    const isInteger = beat % 1 === 0;
    out.push({
      noteIndex: noteIndex++,
      tick: Math.round(beat * PPQ),
      beat,
      pitch: 60 + (noteIndex % 12),
      durationBeats: isBarStart ? 2 : isInteger ? 1 : 0.5,
      velocity: 90,
      score: (isBarStart ? 5 : isInteger ? 3 : 1.2) + (noteIndex % 3) * 0.1,
    });
  }
  return out;
}

const CTX = { beatsPerBar: 4, totalBeats: 128, seed: 564417 };

describe('auraRoaming/cuePlanner — 提示选择与防节拍器', () => {
  const candidates = denseCandidates(128);

  it('确定性:同 seed 恒得同计划;不同 seed 产生不同计划', () => {
    expect(planCues(candidates, CTX)).toEqual(planCues(candidates, CTX));
    const signatures = new Set(
      [1, 2, 3, 4].map((seed) => planCues(candidates, { ...CTX, seed }).map((c) => c.beat).join(',')),
    );
    expect(signatures.size).toBeGreaterThanOrEqual(2);
  });

  it('密度下限:密集候选下平均每小节 ≥1.3 个提示(不再"久久亮一个")', () => {
    const barCount = CTX.totalBeats / CTX.beatsPerBar;
    for (const seed of [1, 7, 564417]) {
      const cues = planCues(candidates, { ...CTX, seed });
      expect(cues.length / barCount, `seed ${seed} 密度`).toBeGreaterThanOrEqual(1.3);
    }
  });

  it('提示间隔 ≥ 八分,且八分间隔占比受预算约束', () => {
    for (const seed of [1, 7, 564417]) {
      const cues = planCues(candidates, { ...CTX, seed });
      expect(cues.length).toBeGreaterThan(8);
      let eighthGaps = 0;
      for (let i = 1; i < cues.length; i++) {
        const interval = cues[i].beat - cues[i - 1].beat;
        expect(interval).toBeGreaterThanOrEqual(0.45);
        if (interval < 0.55) eighthGaps++;
      }
      expect(eighthGaps / cues.length).toBeLessThanOrEqual(0.2);
    }
  });

  it('防节拍器:不存在 4 个连续相同间隔', () => {
    for (const seed of [1, 7, 564417]) {
      const cues = planCues(candidates, { ...CTX, seed });
      for (let i = 4; i < cues.length; i++) {
        const intervals = [1, 2, 3, 4].map((k) => cues[i - k + 1].beat - cues[i - k].beat);
        const allEqual = intervals.every((v) => Math.abs(v - intervals[0]) < 0.02);
        expect(allEqual, `seed ${seed} 连续等间隔@${cues[i].beat}`).toBe(false);
      }
    }
  });

  it('时值档只含 全/二/四/八 分', () => {
    const cues = planCues(candidates, CTX);
    for (const cue of cues) expect(['whole', 'half', 'quarter', 'eighth']).toContain(cue.valueClass);
  });

  it('空候选/零时长 → 空计划', () => {
    expect(planCues([], CTX)).toEqual([]);
    expect(planCues(candidates, { ...CTX, totalBeats: 0 })).toEqual([]);
  });

  it('可按性网格:16 分位(+0.25/+0.75)音符永不提示,即便它是槽位附近唯一候选', () => {
    // 候选场:整数拍 + 大量 16 分位高分音符(模拟快线条 lead)
    const withSixteenths: AccentCandidate[] = [];
    let idx = 0;
    for (let beat = 0; beat < 64; beat++) {
      withSixteenths.push({ noteIndex: idx++, tick: beat * PPQ, beat, pitch: 60, durationBeats: 1, velocity: 90, score: 3 });
      for (const frac of [0.25, 0.75]) {
        const b = beat + frac;
        withSixteenths.push({ noteIndex: idx++, tick: Math.round(b * PPQ), beat: b, pitch: 64, durationBeats: 0.25, velocity: 95, score: 6 });
      }
    }
    for (const seed of [1, 7, 564417]) {
      const cues = planCues(withSixteenths, { beatsPerBar: 4, totalBeats: 64, seed });
      for (const cue of cues) {
        const frac = ((cue.beat % 1) + 1) % 1;
        const pressable = frac <= 0.13 || frac >= 0.87 || Math.abs(frac - 0.5) <= 0.13;
        expect(pressable, `seed ${seed} cue@${cue.beat}`).toBe(true);
      }
      expect(cues.length).toBeGreaterThan(10); // 过滤后仍有密度(整数拍候选在)
    }
  });

  it('4/4 层级:整数拍提示落强拍(0/2)的比例过半(accent 加权锚点)', () => {
    for (const seed of [1, 7, 564417]) {
      const cues = planCues(candidates, { ...CTX, seed, accentPattern: [1.0, 0.85, 0.95, 0.85] });
      const integers = cues.filter((c) => c.beat % 1 === 0);
      const strong = integers.filter((c) => c.beat % 4 === 0 || c.beat % 4 === 2);
      expect(integers.length).toBeGreaterThan(10);
      expect(strong.length / integers.length, `seed ${seed}`).toBeGreaterThan(0.5);
    }
  });

  it('swing 合同:八分槽吸附 +0.67 摆动位而非 +0.5 直八分', () => {
    // 候选场只在整数拍与 +2/3 摆动位有音符(模拟爵士 lead 实际落点)
    const swung: AccentCandidate[] = [];
    let idx = 0;
    for (let beat = 0; beat < 64; beat++) {
      swung.push({ noteIndex: idx++, tick: beat * PPQ, beat, pitch: 60, durationBeats: 1, velocity: 90, score: beat % 4 === 0 ? 5 : 3 });
      const off = beat + 2 / 3;
      swung.push({ noteIndex: idx++, tick: Math.round(off * PPQ), beat: off, pitch: 62, durationBeats: 0.3, velocity: 85, score: 1.5 });
    }
    const cues = planCues(swung, { beatsPerBar: 4, totalBeats: 64, seed: 9, swingRatio: 0.67 });
    const offbeats = cues.filter((c) => c.beat % 1 !== 0);
    for (const cue of offbeats) {
      expect(Math.abs((cue.beat % 1) - 2 / 3), `offbeat@${cue.beat}`).toBeLessThan(0.02);
    }
  });
});
