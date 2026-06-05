import { describe, it, expect } from 'vitest';
import { makeSeededRng, hashString } from './mgRng';
import { scheduleTokens, scheduleBrickExpansions } from './mgTokenScheduler';
import type { AbstractMelodyToken } from '../knowledge/melodyGrammarTypes';

// ============================================================
// MG strict 移植 Loop 3 — RNG + 调度机器单元锁
// ============================================================

describe('render/mgRng · mulberry32 (Loop 3)', () => {
  it('hashString 稳定值', () => {
    expect(hashString('pop_cztjju')).toBe(-308376346);
  });

  it('makeSeededRng 复现已知序列(string seed)', () => {
    const r = makeSeededRng('pop_cztjju');
    expect(r()).toBeCloseTo(0.914246765431, 10);
    expect(r()).toBeCloseTo(0.482484894339, 10);
    expect(r()).toBeCloseTo(0.041573390597, 10);
  });

  it('makeSeededRng 复现已知序列(number seed)', () => {
    const r = makeSeededRng(42);
    expect(r()).toBeCloseTo(0.601103751920, 10);
    expect(r()).toBeCloseTo(0.448290558998, 10);
  });

  it('输出落在 [0,1);确定性', () => {
    const r = makeSeededRng('x');
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const a = makeSeededRng('same'); const b = makeSeededRng('same');
    expect(Array.from({ length: 8 }, () => a())).toEqual(Array.from({ length: 8 }, () => b()));
  });
});

describe('render/mgTokenScheduler · scheduleTokens (Loop 3)', () => {
  const C = (d: number): AbstractMelodyToken => ({ kind: 'C', duration: d });

  it('连续落拍:cursor 按 token duration 推进', () => {
    const out = scheduleTokens([C(0.5), C(0.5), C(1.0)], 0);
    expect(out.map((o) => o.startBeat)).toEqual([0, 0.5, 1.0]);
  });

  it('★ 超界末 token 裁剪保留(landing pitch 仍触发),非丢弃', () => {
    // room=2;第三个 token 想要 1.0 但只剩 0.5 → 裁成 0.5 并 break
    const out = scheduleTokens([C(1.0), C(0.5), C(1.0), C(1.0)], 0, 2.0);
    expect(out.length).toBe(3);
    expect(out[2].token.duration).toBeCloseTo(0.5, 10); // 裁剪
    expect(out[2].startBeat).toBeCloseTo(1.5, 10);
  });

  it('★ 零时长 marker(SlopeEnter/SlopeExit)透传、不移 cursor', () => {
    const enter: AbstractMelodyToken = { kind: 'SlopeEnter', dirMin: -2, dirMax: 2, duration: 0 };
    const exit: AbstractMelodyToken = { kind: 'SlopeExit', duration: 0 };
    const out = scheduleTokens([enter, C(0.5), exit, C(0.5)], 0);
    expect(out.map((o) => o.startBeat)).toEqual([0, 0, 0.5, 0.5]);
    expect(out.map((o) => o.token.kind)).toEqual(['SlopeEnter', 'C', 'SlopeExit', 'C']);
  });

  it('★ slope 深度平衡:破 slope(SlopeEnter 无配对 Exit)→ 补合成 SlopeExit', () => {
    const enter: AbstractMelodyToken = { kind: 'SlopeEnter', dirMin: -2, dirMax: 2, duration: 0 };
    // maxDuration=1 容不下 enter 后的两个 0.5+0.5 + 第三个 → 但 enter 无 exit;末尾应补 1 个合成 SlopeExit
    const out = scheduleTokens([enter, C(0.5), C(0.5), C(0.5)], 0, 1.0);
    const enters = out.filter((o) => o.token.kind === 'SlopeEnter').length;
    const exits = out.filter((o) => o.token.kind === 'SlopeExit').length;
    expect(enters).toBe(1);
    expect(exits).toBe(1); // 合成补平
    expect(out[out.length - 1].token.kind).toBe('SlopeExit');
  });

  it('scheduleBrickExpansions:多 brick 各自按 startBeat + durationBeats 落拍', () => {
    const out = scheduleBrickExpansions([
      { brickIndex: 0, brick: { startBeat: 0, durationBeats: 2 }, tokens: [C(1), C(1), C(1)] }, // 第三个超界裁
      { brickIndex: 1, brick: { startBeat: 2, durationBeats: 2 }, tokens: [C(1), C(1)] },
    ]);
    // brick0 贡献 2 个(第二个裁到 1.0,第三个起拍 1 → 但 room 用尽 break);brick1 贡献 2 个
    expect(out[0].startBeat).toBe(0);
    expect(out.every((o) => o.startBeat < 4)).toBe(true);
    // brick1 的 token 从 startBeat=2 开始
    const brick1Starts = out.filter((o) => o.startBeat >= 2).map((o) => o.startBeat);
    expect(brick1Starts).toEqual([2, 3]);
  });
});
