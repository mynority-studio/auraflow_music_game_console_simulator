// ============================================================
// newEngine · render · 鼓去死板 + 音色丰富(2026-06-09)
// ------------------------------------------------------------
// 用户:鼓节奏型死板 + 鼓种类调用不够丰富。联网研究 humanize(velocity 65-95/accent 100+/ghost 35-45,
//   ghost 在 a-before-2/4,fill 非每小节、build 85→115)+ genre 鼓色(clap/shaker/sidestick/ride-bell)。
// 结构性断言锁:① per-bar 变化(相邻小节不复读)② 力度跨度宽(ghost↔accent)③ 鬼音存在
//   ④ 扩库鼓色被用 ⑤ crash 落段界 ⑥ fill 用 tom ⑦ 确定性。
// ============================================================

import { describe, it, expect } from 'vitest';
import { traceGeneration } from '../generation/trace';
import { DRUM } from '../knowledge/grooves';

const drums = (seed: number, style: string) =>
  (traceGeneration({ seed, styleHint: style, mood: 'build', targetDuration: 120 } as never).ir.tracks.find((t) => t.role === 'drum')?.notes ?? [])
    .map((n) => ({ pitch: n.pitch as number, beat: (n.startTick as number) / 480, vel: n.velocity }));

describe('鼓去死板 + 音色丰富', () => {
  it('① per-bar 变化:鼓轨相邻小节不全复读(多种小节指纹)', () => {
    const ns = drums(633823, 'pop');
    const byBar: Record<number, string[]> = {};
    for (const n of ns) { const bar = Math.floor(n.beat / 4); (byBar[bar] ??= []).push(`${n.pitch}@${(n.beat % 4).toFixed(2)}`); }
    const fps = Object.values(byBar).map((hits) => hits.sort().join('|'));
    const distinct = new Set(fps).size;
    expect(distinct, `仅 ${distinct} 种小节指纹(死板)`).toBeGreaterThanOrEqual(4); // 多于 1-2 = 不复读
  });

  it('② 力度跨度宽:ghost(≤45)到 accent(≥100)都有,不是 ±3 一坨', () => {
    const vels = drums(633823, 'pop').map((n) => n.vel);
    expect(Math.min(...vels), 'ghost 太响').toBeLessThanOrEqual(45);
    expect(Math.max(...vels), 'accent 太弱').toBeGreaterThanOrEqual(100);
    expect(Math.max(...vels) - Math.min(...vels)).toBeGreaterThanOrEqual(55); // 宽动态
  });

  it('③ 鬼军鼓存在(低力度 snare,a-before-backbeat 的 bounce)', () => {
    const ns = drums(633823, 'pop');
    const ghosts = ns.filter((n) => n.pitch === DRUM.SNARE && n.vel <= 48);
    expect(ghosts.length, '无鬼音').toBeGreaterThan(0);
  });

  it('④ 扩库鼓色被实际调用(跨风格 union 含新打击)', () => {
    const all = new Set<number>();
    for (const [seed, style] of [[633823, 'pop'], [3, 'rnb'], [7, 'lofi'], [42, 'jazz'], [100, 'rnb'], [999, 'pop']] as const)
      for (const n of drums(seed, style)) all.add(n.pitch);
    // 至少用到这些新鼓色中的几种(clap/sidestick/tom/crash/ride-bell/shaker)
    const newKit = [DRUM.CLAP, DRUM.SIDESTICK, DRUM.TOM_LO, DRUM.TOM_MID, DRUM.TOM_HI, DRUM.CRASH, DRUM.RIDE_BELL, DRUM.SHAKER];
    const usedNew = newKit.filter((d) => all.has(d));
    expect(usedNew.length, `仅用到新鼓色 ${usedNew.length} 种`).toBeGreaterThanOrEqual(4);
    // 旧库只有 6 件;现在总鼓色数明显变多
    expect(all.size, '总鼓色种类').toBeGreaterThanOrEqual(9);
  });

  it('⑤ crash 落点存在(fill→新段下拍)', () => {
    // 多段 pop 歌应有 crash(段界 fill 后)
    let hasCrash = false;
    for (const seed of [633823, 396040, 163462, 100, 7]) if (drums(seed, 'pop').some((n) => n.pitch === DRUM.CRASH)) { hasCrash = true; break; }
    expect(hasCrash, '无 crash 落点').toBe(true);
  });

  it('⑥ fill 用 tom(段尾 roll 含嗵鼓,非只 snare)', () => {
    let hasTom = false;
    for (const seed of [633823, 396040, 163462, 100, 7]) if (drums(seed, 'pop').some((n) => [DRUM.TOM_LO, DRUM.TOM_MID, DRUM.TOM_HI].includes(n.pitch as never))) { hasTom = true; break; }
    expect(hasTom, 'fill 无 tom').toBe(true);
  });

  it('⑦ 确定性:同 seed 两次鼓轨一致', () => {
    expect(JSON.stringify(drums(633823, 'pop'))).toBe(JSON.stringify(drums(633823, 'pop')));
  });
});
