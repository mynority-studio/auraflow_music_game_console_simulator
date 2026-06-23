import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from './bandEngine';
import { getInstrumentCatalog } from '../knowledge/instruments';

// ★ jazz 乐器优先级(2026-06-23,用户:整编"是乐器问题,不要缩,做更高优先级")。
//   不缩=候选池全保留;做更高优先级=地道音色更高【选中权重】(钢琴三重奏 lead + upright bass)。

const leadPool = (): number[] => {
  const jazz = getInstrumentCatalog().find((c) => c.style === 'jazz')!;
  return jazz.roles.find((r) => r.role === 'lead')!.programs;
};
const dist = (role: 'lead' | 'bass', n = 32): Record<number, number> => {
  const h: Record<number, number> = {};
  for (let seed = 0; seed < n; seed++) {
    const t = generateSong({ seed, styleHint: 'jazz', mood: 'x', targetDuration: 60 }).ir!.tracks.find((x) => x.role === role);
    if (t) h[t.program] = (h[t.program] ?? 0) + 1;
  }
  return h;
};

describe('band/jazz 乐器优先级(不缩池 · 地道音色更高优先级)', () => {
  it('★ 不缩:jazz lead 候选池保留 vibe/Rhodes/marimba/harpsi,并新增 大钢琴(0)+爵士吉他(26)', () => {
    const pool = leadPool();
    for (const gm of [0, 4, 26, 11, 12, 6]) expect(pool, `lead 池含 gm${gm}`).toContain(gm);
  });

  it('★ 更高优先级:lead 钢琴(gm0)最高频,且 ≫ marimba(12)+harpsi(6) 之和', () => {
    const h = dist('lead');
    const top = Object.entries(h).sort((a, b) => b[1] - a[1])[0][0];
    expect(top, 'lead 最高频 = 钢琴').toBe('0');
    expect(h[0] ?? 0, '钢琴 ≫ marimba+harpsi').toBeGreaterThan((h[12] ?? 0) + (h[6] ?? 0));
  });

  it('★ 更高优先级:bass 原声 upright(gm32)为主、fretless(gm35)保留但更少', () => {
    const h = dist('bass');
    expect(h[32] ?? 0, 'upright 多于 fretless').toBeGreaterThan(h[35] ?? 0);
    expect(h[35] ?? 0, '不缩:fretless 仍出现').toBeGreaterThan(0);
  });

  it('★ 确定性:同 seed 同 jazz roleProgram', () => {
    const a = buildBandSpec({ seed: 5, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    const b = buildBandSpec({ seed: 5, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    expect(a.roleProgram).toEqual(b.roleProgram);
  });
});
