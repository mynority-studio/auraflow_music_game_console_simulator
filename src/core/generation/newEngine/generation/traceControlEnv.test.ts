import { describe, it, expect } from 'vitest';
import { traceGeneration } from './trace';
import { generateSong } from './GenerationController';
import { pc } from '../foundation';

describe('generation · traceGeneration 走真实控制环 (P1-1)', () => {
  it('★ 返回控制环真实 status/attempts(非硬编码),RENDER 行标注控制环', () => {
    const t = traceGeneration({ seed: 7, styleHint: 'jazz', mood: 'x', targetDuration: 120, key: pc(0) });
    expect(['pass', 'warning', 'failed']).toContain(t.status);
    expect(t.attempts).toBeGreaterThanOrEqual(1);
    expect(t.lines.some((l) => l.includes('控制环') && l.includes(String(t.attempts)))).toBe(true);
  });

  it('trace 与 generateSong 同路径:同 request → 同 status/attempts + IR 逐音一致', () => {
    const req = { seed: 13, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) };
    const t = traceGeneration(req);
    const g = generateSong(req);
    expect(t.status).toBe(g.status);
    expect(t.attempts).toBe(g.attempts);
    if (g.ir) expect(t.ir.tracks).toEqual(g.ir.tracks); // 控制环同款渲染 → 逐音一致
  });

  it('ACG trace 复用 production PianoScorePlan/RoadMap:同 request → 同最终 IR', () => {
    const req = { seed: 13, styleHint: 'acg', mood: 'lyrical', targetDuration: 90, key: pc(0) } as const;
    const t = traceGeneration(req);
    const g = generateSong(req);
    expect(t.status).toBe(g.status);
    expect(t.attempts).toBe(g.attempts);
    expect(g.ir, 'production generation should deliver an IR for this ACG seed').toBeDefined();
    expect(t.ir.tracks).toEqual(g.ir!.tracks);
  });

  it('多 seed 端到端:trace 不崩,status 非 failed(自愈渲染本就过)', () => {
    for (let seed = 0; seed < 8; seed++) {
      const t = traceGeneration({ seed, styleHint: 'lofi', mood: 'x', targetDuration: 120, key: pc(0) });
      expect(t.ir.tracks.length).toBeGreaterThan(0);
      expect(t.status).not.toBe('failed');
    }
  });
});
