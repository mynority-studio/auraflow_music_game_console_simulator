import { describe, it, expect } from 'vitest';
import { makeSeededRng, hashString } from './mgRng';
import {
  reserveScheduledTokensForAuthoredSpans,
  scheduleTokens,
  scheduleBrickExpansions,
  scheduleFamilyPhraseToBrick,
  applyTerminalCadence,
} from './mgTokenScheduler';
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

  it('family phrase fit repeats a short slope across a long brick', () => {
    const tokens: AbstractMelodyToken[] = [
      { kind: 'SlopeEnter', dirMin: -2, dirMax: 2, duration: 0 },
      C(1),
      { kind: 'G', duration: 1 },
      { kind: 'SlopeExit', duration: 0 },
    ];
    const out = scheduleFamilyPhraseToBrick(tokens, 0, 8);
    expect(out.filter(entry => entry.token.kind === 'G').map(entry => entry.startBeat)).toEqual([1, 3, 5, 7]);
    expect(out.filter(entry => entry.token.kind === 'SlopeEnter')).toHaveLength(4);
    expect(out.filter(entry => entry.token.kind === 'SlopeExit')).toHaveLength(4);
  });

  it('family phrase fit rest-fills a tail too short for a useful answer', () => {
    const out = scheduleFamilyPhraseToBrick([C(1), { kind: 'G', duration: 1 }], 0, 4.5);
    expect(out.at(-1)).toMatchObject({ startBeat: 4, token: { kind: 'R', duration: 0.5 } });
  });

  it('family phrase fit preserves a stable landing when a long slope is clipped', () => {
    const out = scheduleFamilyPhraseToBrick([
      { kind: 'SlopeEnter', dirMin: 1, dirMax: 3, duration: 0 },
      { kind: 'L', duration: 1 },
      { kind: 'A', duration: 1 },
      { kind: 'L', duration: 1 },
      { kind: 'A', duration: 1 },
      { kind: 'G', duration: 1 },
      { kind: 'SlopeExit', duration: 0 },
    ], 0, 2);
    expect(out.at(-1)).toMatchObject({ startBeat: 1.5, token: { kind: 'G', duration: 0.5 } });
    expect(out.filter(entry => entry.token.kind === 'SlopeEnter')).toHaveLength(1);
    expect(out.filter(entry => entry.token.kind === 'SlopeExit')).toHaveLength(1);
  });

  it('family phrase fit restarts at arranger section boundaries', () => {
    const out = scheduleBrickExpansions([
      {
        brickIndex: 0,
        brick: { startBeat: 0, durationBeats: 8, family: 'Turnaround' },
        tokens: [C(3), { kind: 'G', duration: 1 }],
      },
    ], { fitMode: 'family-phrase', fitGridBeats: 0.5, phraseBoundaries: [6] });
    expect(out.some(entry => entry.startBeat < 6
      && entry.startBeat + entry.token.duration > 6 + 1e-6)).toBe(false);
    expect(out.some(entry => entry.startBeat === 6 && entry.token.kind === 'C')).toBe(true);
  });

  it('authored brick 在 token 阶段接管区间,跨界音与 ACG return 都变成 rest', () => {
    const scheduled = scheduleTokens([C(1), C(2), C(1), C(1)], 0).map((entry, index) => ({
      ...entry,
      ...(index === 1 ? { acgReturn: { role: 'arrival' } as never } : {}),
    }));
    const reserved = reserveScheduledTokensForAuthoredSpans(scheduled, [{ startBeat: 1.5, endBeat: 3.5 }]);
    const audibleOverlap = reserved.filter((entry) => entry.token.duration > 0 && entry.token.kind !== 'R')
      .filter((entry) => entry.startBeat < 3.5 && entry.startBeat + entry.token.duration > 1.5);
    expect(audibleOverlap).toEqual([]);
    expect(reserved.filter((entry) => entry.token.kind === 'R').every((entry) => entry.acgReturn === undefined)).toBe(true);
    expect(reserved.some((entry) => entry.startBeat === 1.5 && entry.token.kind === 'SlopeExit')).toBe(true);
  });
});

describe('mgTokenScheduler · applyTerminalCadence(lead 上游终止区)', () => {
  const tok = (kind: 'C' | 'S' | 'R' | 'G', duration: number, startBeat: number) => ({
    token: { kind, duration },
    startBeat,
    brickIndex: 0, brickStartBeat: 0, brickEndBeat: 16, brickName: 'on', brickFamily: 'Major-On',
  }) as unknown as import('./mgTokenScheduler').ScheduledToken;

  it('末 audible → G 落点并延到终点;末小节下拍+1 后不起新句;终止区弱位短音 liquidation', () => {
    const out = applyTerminalCadence([
      tok('C', 1, 0),          // 区外不动
      tok('S', 0.25, 8.5),     // 终止区([8,16))弱位短音 → R
      tok('C', 1, 12),         // 末小节 downbeat 保留
      tok('S', 0.5, 14.5),     // 末小节 downbeat+1 后晚起 → R
      tok('C', 0.5, 15),       // 最后一个 audible(按 startBeat)→ G 延到终点
    ], 16, 4);
    expect(out[0].token.kind).toBe('C');                       // 区外原样
    expect(out[1].token.kind).toBe('R');                       // liquidation
    expect(out[2].token.kind).toBe('C');                       // 末小节下拍保留
    expect(out[3].token.kind).toBe('R');                       // 晚起新句 → R
    const last = out[4];
    expect(last.token.kind).toBe('C'); // 落点=和弦音(非 G:导音 7 度不满足终止统计)
    expect(last.token.duration).toBeCloseTo(16 - 15 - 0.06, 6); // 延到终点留 release
  });

  it('R/marker 原样;全 R 输入原样返回;短歌(≤2 bar)不处理', () => {
    const rests = [tok('R', 4, 0), tok('R', 4, 4)];
    expect(applyTerminalCadence(rests, 8, 4).map((e) => e.token.kind)).toEqual(['R', 'R']);
    const short = [tok('C', 1, 0)];
    expect(applyTerminalCadence(short, 8, 4)[0].token.kind).toBe('C');
  });
});
