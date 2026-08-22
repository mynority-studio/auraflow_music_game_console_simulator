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
});
