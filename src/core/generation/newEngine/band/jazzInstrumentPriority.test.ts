import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from './bandEngine';
import { getInstrumentCatalog } from '../knowledge/instruments';

// ★ jazz 乐器优先级:用户 2026-07-03 明确不要 jazz guitar。
//   lead 聚焦 Tenor Sax/钢琴/电钢/颤音琴;地道音色更高【选中权重】(sax/钢琴 + upright bass)。

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

describe('band/jazz 乐器优先级(无 jazz guitar · 地道音色更高优先级)', () => {
  it('jazz lead 候选池只保留 sax/钢琴/Rhodes/颤音琴,不含 GM26 jazz guitar', () => {
    const pool = leadPool();
    expect(pool).toEqual([66, 0, 4, 11]);
    expect(pool).not.toContain(26);
  });

  it('更高优先级:lead 以 Tenor Sax/钢琴为主,且 GM26 不会被选中', () => {
    const h = dist('lead', 64);
    expect(h[26] ?? 0, 'GM26 jazz guitar 不应出现').toBe(0);
    expect((h[66] ?? 0) + (h[0] ?? 0), 'sax+钢琴 应多于 Rhodes+vibe').toBeGreaterThan((h[4] ?? 0) + (h[11] ?? 0));
  });

  it('bass 使用原声 upright(gm32),不走合成/无品贝斯', () => {
    const h = dist('bass');
    expect(h[32] ?? 0).toBeGreaterThan(0);
    expect(Object.keys(h)).toEqual(['32']);
  });

  it('★ 确定性:同 seed 同 jazz roleProgram', () => {
    const a = buildBandSpec({ seed: 5, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    const b = buildBandSpec({ seed: 5, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    expect(a.roleProgram).toEqual(b.roleProgram);
  });
});
