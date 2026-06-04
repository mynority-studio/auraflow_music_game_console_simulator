import { describe, it, expect } from 'vitest';
import { developBar, pickGrammarName, GRAMMAR_NAMES, type DevNote } from './grammarLibrary';

const base: DevNote[] = [
  { scaleDegree: 1, timeOffset: 0, duration: 2 },
  { scaleDegree: 3, timeOffset: 2, duration: 1 },
  { scaleDegree: 5, timeOffset: 3, duration: 1 },
];

describe('knowledge/grammarLibrary (2.2)', () => {
  it('bar0 = identity(保动机原形/head)', () => {
    for (const g of GRAMMAR_NAMES) {
      expect(developBar(base, g, 0).map((n) => n.scaleDegree)).toEqual([1, 3, 5]);
    }
  });

  it('transpose:develop bar1 = +2(级进上移)', () => {
    expect(developBar(base, 'develop', 1).map((n) => n.scaleDegree)).toEqual([3, 5, 7]);
  });

  it('invert:develop bar2 = 绕 4 镜像(2*4-d)', () => {
    // 1→7, 3→5, 5→3
    expect(developBar(base, 'develop', 2).map((n) => n.scaleDegree)).toEqual([7, 5, 3]);
  });

  it('retrograde:answer bar1 = 度数倒序', () => {
    expect(developBar(base, 'answer', 1).map((n) => n.scaleDegree)).toEqual([5, 3, 1]);
  });

  it('divide:sequence bar3 = 最长音切两半(音数+1)', () => {
    const out = developBar(base, 'sequence', 3);
    expect(out.length).toBe(base.length + 1); // 最长音(duration2)分成两个
    expect(out[0].duration).toBe(1); // 切半
  });

  it('★ 不同 grammar → 不同发展', () => {
    const d1 = developBar(base, 'develop', 1).map((n) => n.scaleDegree);
    const d2 = developBar(base, 'answer', 1).map((n) => n.scaleDegree);
    expect(d1).not.toEqual(d2);
  });

  it('pickGrammarName:确定性 + 在 GRAMMAR_NAMES 内', () => {
    expect(pickGrammarName('m-V-0')).toBe(pickGrammarName('m-V-0'));
    expect(GRAMMAR_NAMES).toContain(pickGrammarName('m-C-0'));
  });
});
