import { describe, it, expect } from 'vitest';
import { buildBandSpec } from './bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { createRandomContext } from '../foundation';
import { getInstrumentCatalog } from '../knowledge/instruments';
import { JAZZ_4_4_ARCHETYPE_ID } from '../arranger/jazzArchetypePlanner';

// ★ jazz 乐器优先级:用户 2026-07-03 明确不要 GM26 jazz guitar。
//   Dream GM128 后 lead 聚焦 GM66 次中音/GM67 上低音萨克斯/钢琴;GM25 只在显式 guitarist fallback 兑现。

const leadPool = (): number[] => {
  const jazz = getInstrumentCatalog().find((c) => c.style === 'jazz')!;
  return jazz.roles.find((r) => r.role === 'lead')!.programs;
};
const dist = (role: 'lead' | 'bass', n = 32): Record<number, number> => {
  const h: Record<number, number> = {};
  for (let seed = 0; seed < n; seed++) {
    const b = buildBandSpec({ seed, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    const arr = buildArrangementPlan(b, {
      rng: createRandomContext(seed),
      jazzArchetypeId: JAZZ_4_4_ARCHETYPE_ID,
    });
    const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
    const p = ip.roleProgram[role];
    if (p !== undefined) h[p] = (h[p] ?? 0) + 1;
  }
  return h;
};
const finalLeadProgram = (styleHint: string, seed: number): number | undefined => {
  const b = buildBandSpec({ seed, styleHint, mood: 'x', targetDuration: 60 });
  const arr = buildArrangementPlan(b, { rng: createRandomContext(seed) });
  const ip = buildInstrumentationPlan(b, arr, createRandomContext(seed).substream('timbre'));
  return ip.roleProgram.lead;
};

describe('band/jazz 乐器优先级(无主动 guitar · 地道音色更高优先级)', () => {
  it('jazz lead 候选池只保留 sax/钢琴,不含 GM25/GM26/GM27 guitar/GM11 vibe', () => {
    const pool = leadPool();
    expect(pool).toEqual([66, 67, 0]);
    expect(pool).not.toContain(11);
    expect(pool).not.toContain(25);
    expect(pool).not.toContain(26);
    expect(pool).not.toContain(27);
  });

  it('更高优先级:lead 以上低音萨克斯/钢琴为主,且 guitar 不会被选中', () => {
    const h = dist('lead', 32);
    expect(h[25] ?? 0, 'GM25 folk guitar 不应主动出现').toBe(0);
    expect(h[26] ?? 0, 'GM26 jazz guitar 不应出现').toBe(0);
    expect(h[27] ?? 0, 'GM27 clean guitar 不应出现').toBe(0);
    expect(h[11] ?? 0, 'GM11 vibe 不应主动出现').toBe(0);
    expect((h[66] ?? 0) + (h[67] ?? 0) + (h[0] ?? 0), 'sax+钢琴 应覆盖 jazz lead').toBeGreaterThan(0);
  });

  it('★ sax 概率只在 jazz 主动提高;pop/rnb/lofi lead 不主动出 GM66/GM67', () => {
    const jazz = dist('lead', 64);
    expect((jazz[66] ?? 0) + (jazz[67] ?? 0), 'jazz sax 应高于 piano').toBeGreaterThanOrEqual(jazz[0] ?? 0);
    expect(jazz[11] ?? 0, 'jazz 不应主动选 GM11 vibe').toBe(0);

    for (const styleHint of ['pop', 'rnb', 'lofi'] as const) {
      const h: Record<number, number> = {};
      for (let seed = 0; seed < 64; seed++) {
        const p = finalLeadProgram(styleHint, seed);
        if (p !== undefined) h[p] = (h[p] ?? 0) + 1;
      }
      expect((h[66] ?? 0) + (h[67] ?? 0), `${styleHint} 不应主动选 sax`).toBe(0);
      expect((h[0] ?? 0) + (h[5] ?? 0), `${styleHint} lead 应以 piano/EP 为主体`).toBeGreaterThan(0);
    }
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
