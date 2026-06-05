// ============================================================
// newEngine · knowledge · tensionTableForChordType / Loop 6 测试
// ------------------------------------------------------------
// 锁:宽 chordType 权威化 —— stable=核心结构音(含 sus4,延伸进 color);13sus4 不含 3 音;
// 9/13 进 color(让渡旋律);窄 tensionTableFor 仍可用。
// ============================================================

import { describe, expect, it } from 'vitest';
import { tensionTableFor, tensionTableForChordType } from './tensionModel';
import { pc } from '../foundation';

describe('tensionTableForChordType — 宽和弦', () => {
  it('maj9:stable=核心 C/E/G/B(无 9);9 进 color', () => {
    const t = tensionTableForChordType(pc(0), 'maj9', 'maj7');
    expect([...t.stable].sort((a, b) => a - b)).toEqual([0, 4, 7, 11]); // C E G B(核心,无 D/9)
    expect(t.stable).not.toContain(2);    // 9 不在 stable(comp 不强 voice,守铁律)
    expect(t.acceptable).toContain(2);    // 9 在 color(让渡旋律)
  });

  it('13sus4:stable 含 sus4(F)、无 3 音(E);9/13 进 color;4 不算 avoid', () => {
    const t = tensionTableForChordType(pc(0), '13sus4', '7');
    expect(t.stable).toContain(5);        // sus 4 = F 在 stable
    expect(t.stable).not.toContain(4);    // ★ 无大三(修窄品质降级 bug)
    expect(t.stable).toContain(10);       // b7
    expect(t.acceptable).toContain(2);    // 9
    expect(t.acceptable).toContain(9);    // 13
    expect(t.avoid).not.toContain(5);     // sus 的 4 是和弦音,不是 avoid
  });

  it('m9:9 进 color 不进 stable', () => {
    const t = tensionTableForChordType(pc(0), 'm9', 'm7');
    expect([...t.stable].sort((a, b) => a - b)).toEqual([0, 3, 7, 10]); // C Eb G Bb
    expect(t.acceptable).toContain(2); // 9
  });

  it('三集互斥', () => {
    const t = tensionTableForChordType(pc(0), 'maj9', 'maj7');
    const s = new Set(t.stable);
    expect(t.acceptable.every((p) => !s.has(p))).toBe(true);
    const sa = new Set([...t.stable, ...t.acceptable]);
    expect(t.avoid.every((p) => !sa.has(p))).toBe(true);
  });

  it('窄 tensionTableFor 仍可用(兼容)', () => {
    const t = tensionTableFor(pc(0), 'maj7');
    expect([...t.stable].sort((a, b) => a - b)).toEqual([0, 4, 7, 11]);
    expect(t.acceptable).toContain(2);
    expect(t.avoid).toContain(5);
  });
});
