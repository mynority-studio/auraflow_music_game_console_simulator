// ============================================================
// newEngine · knowledge · VoicingStyles / VoicingPlacement 测试
// ------------------------------------------------------------
// 锁 §7 port:风格 pc 选择(rootless 去根补 9 / density 保 identity)·
// 撞音消解(AVOID 先掉 / 八度分隔保留)· 八度落点(在区/在 bass 上/无重复)·
// 排列变换(drop2 + bass 安全拒绝)。
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  assembleVoicing, resolveClash, applyArrangement,
  STYLE_SHELL, STYLE_ROOTLESS, STYLE_FULL,
} from './voicingStyles';
import { placeVoicingMidi } from './voicingPlacement';

describe('assembleVoicing — 风格 pc 选择', () => {
  it('rootless 风格:去根 + 补 9', () => {
    const pcs = assembleVoicing('m7', 0, STYLE_ROOTLESS); // C m7 → 去 root,补 9(pc2)
    expect(pcs).not.toContain(0);  // root 去掉
    expect(pcs).toContain(2);      // 补 9
  });

  it('shell 风格:含根 + 含 maj7 identity,声部 ≤ density', () => {
    const pcs = assembleVoicing('maj7', 0, STYLE_SHELL);
    expect(pcs).toContain(11);                       // maj7 导音(identity)
    expect(pcs.length).toBeLessThanOrEqual(STYLE_SHELL.density);
  });

  it('density 上限不能丢 identity(13 和弦仍保 3 + b7 定义性三全音)', () => {
    const pcs = assembleVoicing('13', 0, STYLE_FULL); // C13 = root/3/5/b7/9/13,density 5
    expect(pcs).toContain(4);   // 3
    expect(pcs).toContain(10);  // b7 —— 三全音不可丢
    expect(pcs.length).toBeLessThanOrEqual(STYLE_FULL.density);
  });

  it('输出升序', () => {
    const pcs = assembleVoicing('maj9', 0, STYLE_FULL);
    for (let i = 1; i < pcs.length; i++) expect(pcs[i]).toBeGreaterThan(pcs[i - 1]);
  });
});

describe('resolveClash — 小二度取舍', () => {
  it('AVOID 永远掉(maj 的 b9 = pc1)', () => {
    const res = resolveClash(0, 1, 'maj', 0); // root vs b9
    expect('drop' in res && res.drop).toBe(1);
  });

  it('其它 m2 对保留(maj7 的 root + maj7 八度分隔)', () => {
    const res = resolveClash(0, 11, 'maj7', 0);
    expect('keep' in res).toBe(true);
  });
});

describe('placeVoicingMidi — 八度落点', () => {
  it('升序无重复 · 全在 CHORD_RANGE · 全在 bass 上方', () => {
    const midi = placeVoicingMidi([0, 4, 7, 11], [], 36, 'maj7', 0);
    for (let i = 1; i < midi.length; i++) expect(midi[i]).toBeGreaterThan(midi[i - 1]); // 升序+无重复
    for (const m of midi) {
      expect(m).toBeGreaterThanOrEqual(48);
      expect(m).toBeLessThanOrEqual(81);
      expect(m - 36).toBeGreaterThanOrEqual(4); // bass 上方
    }
  });

  it('声部进行:有 prev 时顶音贴近 prev 顶音(不大跳)', () => {
    const prev = [60, 64, 67, 71];
    const midi = placeVoicingMidi([0, 4, 7, 11], prev, 36, 'maj7', 0);
    const top = Math.max(...midi);
    expect(Math.abs(top - 71)).toBeLessThanOrEqual(7); // 顶音连续(罚 >P4,搜索倾向贴近)
  });
});

describe('applyArrangement — 排列变换', () => {
  it('close = 升序原样', () => {
    expect(applyArrangement([67, 60, 64], 'close')).toEqual([60, 64, 67]);
  });

  it('drop2:第 2-from-top 下移八度(安全)', () => {
    const out = applyArrangement([60, 64, 67, 71], 'drop2', 36); // 67(2nd from top)→55
    expect(out).toContain(55);
    expect(out.length).toBe(4);
  });

  it('drop2 落点低于 bass+4 → 拒绝,回退 close', () => {
    const close = [62, 65, 69, 72];
    const out = applyArrangement(close, 'drop2', 60); // 69→57 < 64 → 拒绝
    expect(out).toEqual(close.slice().sort((a, b) => a - b));
  });
});
