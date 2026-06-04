// ============================================================
// newEngine · knowledge · BasslineRules 测试
// ------------------------------------------------------------
// 锁 §10 port:anchor 在 bass 区 · isLast/cadence 卡 root · pattern 事件结构 ·
// weighted picker 兜底 · resolveBassAnchorPc 转位。
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  BASSLINE_RULES, BASS_PATTERN_RULES, DEFAULT_BASSLINE_RULE,
  pickBasslineRule, resolveBassAnchorPc, clampPcToBassMidi,
  type BasslineContext, type BassPatternContext,
} from './basslineRules';

const rng = { next: () => 0.5 };
const baseCtx = (over: Partial<BasslineContext> = {}): BasslineContext => ({
  chordRootPc: 0, bassAnchorPc: 0, pitchClasses: [0, 4, 7], prevBassMidi: 48,
  isCadenceToTonic: false, isLast: false, barIndex: 1, random: rng, ...over,
});

describe('BASSLINE_RULES — anchor 规则', () => {
  it('注册 6 个 anchor 规则 + 3 个 pattern 规则', () => {
    expect(Object.keys(BASSLINE_RULES).sort()).toEqual(['boogie_root_fifth', 'fifth_drop', 'octave_alternate', 'root_lock', 'stepwise_descent', 'walking_bass']);
    expect(Object.keys(BASS_PATTERN_RULES).sort()).toEqual(['boogie_pattern', 'dilla_pocket', 'stride_pattern']);
  });

  it('每个 anchor 规则输出都在 bass 区 [36,55]', () => {
    for (const fn of Object.values(BASSLINE_RULES)) {
      const m = fn(baseCtx());
      expect(m).toBeGreaterThanOrEqual(36);
      expect(m).toBeLessThanOrEqual(55);
    }
  });

  it('isLast → walking/stepwise/fifth_drop/boogie 都卡 root', () => {
    const rootMidi = clampPcToBassMidi(0);
    for (const name of ['walking_bass', 'stepwise_descent', 'fifth_drop', 'boogie_root_fifth']) {
      expect(BASSLINE_RULES[name](baseCtx({ isLast: true }))).toBe(rootMidi);
    }
  });

  it('root_lock 恒为 root pc(任意 prev/bar)', () => {
    expect(BASSLINE_RULES.root_lock(baseCtx({ barIndex: 7, prevBassMidi: 50 }))).toBe(clampPcToBassMidi(0));
  });
});

describe('BASS_PATTERN_RULES — 小节律动', () => {
  const pctx = (over: Partial<BassPatternContext> = {}): BassPatternContext => ({
    chordRootPc: 0, bassPc: 0, pitchClasses: [0, 4, 7], prevBassMidi: null,
    isCadenceToTonic: false, isLast: false, barIndex: 0, random: rng, ...over,
  });

  it('boogie:常态 4 事件(root-5-6-5);末小节塌成 1 整音', () => {
    expect(BASS_PATTERN_RULES.boogie_pattern(pctx())).toHaveLength(4);
    const last = BASS_PATTERN_RULES.boogie_pattern(pctx({ isLast: true }));
    expect(last).toHaveLength(1);
    expect(last[0].duration).toBe(4);
  });

  it('所有 pattern 事件 midi 在 bass 区', () => {
    for (const fn of Object.values(BASS_PATTERN_RULES)) {
      for (const ev of fn(pctx())) {
        expect(ev.midi).toBeGreaterThanOrEqual(36);
        expect(ev.midi).toBeLessThanOrEqual(55);
      }
    }
  });
});

describe('pickBasslineRule + resolveBassAnchorPc', () => {
  it('无规则 / 未知 ref → 默认', () => {
    expect(pickBasslineRule(undefined, rng)).toBe(DEFAULT_BASSLINE_RULE);
    expect(pickBasslineRule([{ ref: 'nope', weight: 1 }], rng)).toBe(DEFAULT_BASSLINE_RULE);
  });

  it('weighted 命中已注册规则', () => {
    expect(pickBasslineRule([{ ref: 'walking_bass', weight: 1 }], { next: () => 0 })).toBe('walking_bass');
  });

  it('resolveBassAnchorPc:5th 转位 = root + intervals[2]', () => {
    expect(resolveBassAnchorPc('5th', 0, [0, 4, 7, 10])).toBe(7);
    expect(resolveBassAnchorPc('3rd', 0, [0, 3, 7])).toBe(3);
    expect(resolveBassAnchorPc('root', 5, [0, 4, 7])).toBe(5);
  });
});
