import { describe, it, expect } from 'vitest';
import { renderTextureChordHits, renderTextureBassHits, hasTextureRenderer, ACG_RENDERED_TEXTURE_CASES } from './textureRenderer';
import { pickTextureForBar, TEXTURE_BEHAVIOR, isDelayedEntryTexture } from '../knowledge/textureProfiles';

// ============================================================
// MG 升级 Phase 2b — 10 个 ACG 钢琴手势 texture 渲染验收
// ============================================================

const VOICED = [55, 59, 62, 66, 69, 73]; // Cmaj9-ish 宽 voicing(含色音)
const DUR = 4;
const picker = (() => {
  let i = 0; const seq = [0.1, 0.4, 0.7, 0.2, 0.9, 0.5];
  const next = () => seq[i++ % seq.length];
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] };
})();

describe('render/acgTexture(MG 升级 Phase 2b)', () => {
  it('★ 10 个 ACG case 都有渲染实现', () => {
    expect(ACG_RENDERED_TEXTURE_CASES).toHaveLength(10);
    for (const tc of ACG_RENDERED_TEXTURE_CASES) expect(hasTextureRenderer(tc), tc).toBe(true);
  });

  it('★ 每个 ACG case 产 chord hits + bass hits,且 hit 合法(tRel<dur·vel∈(0,1]·midis 非空)', () => {
    for (const tc of ACG_RENDERED_TEXTURE_CASES) {
      const chord = renderTextureChordHits(tc, VOICED, DUR);
      const bass = renderTextureBassHits(tc, DUR);
      expect(chord.length, `${tc} chord`).toBeGreaterThan(0);
      expect(bass.length, `${tc} bass`).toBeGreaterThan(0);
      for (const h of chord) {
        expect(h.tRel, tc).toBeGreaterThanOrEqual(0);
        expect(h.tRel, tc).toBeLessThan(DUR);
        expect(h.vel, tc).toBeGreaterThan(0);
        expect(h.vel, tc).toBeLessThanOrEqual(1);
        expect(h.midis.length, tc).toBeGreaterThan(0);
        expect(h.midis.every((m) => Number.isFinite(m)), `${tc} finite`).toBe(true);
      }
      for (const b of bass) {
        expect(b.tRel, tc).toBeLessThan(DUR);
        expect(['root', 'fifth', 'tenth'], tc).toContain(b.voice);
      }
    }
  });

  it('★ 10 个手势【彼此不同】(timing/voicing 指纹各异)', () => {
    const prints = ACG_RENDERED_TEXTURE_CASES.map((tc) =>
      renderTextureChordHits(tc, VOICED, DUR).map((h) => `${h.tRel.toFixed(2)}:${h.midis.length}`).join('|'));
    expect(new Set(prints).size).toBeGreaterThanOrEqual(8); // 允许极个别相近,但绝大多数指纹不同
  });

  it('★ 全 ACG case 有 TEXTURE_BEHAVIOR 且非 delayed-entry(bass 从 0 起,段级常驻不留洞)', () => {
    for (const tc of ACG_RENDERED_TEXTURE_CASES) {
      expect(TEXTURE_BEHAVIOR[tc], tc).toBeTruthy();
      expect(isDelayedEntryTexture(tc), `${tc} 不应 delayed-entry`).toBe(false);
    }
  });

  it('★ pickTextureForBar(style=ACG) 选到 ACG texture', () => {
    const seen = new Set<string>();
    for (const role of ['establish', 'develop', 'lift', 'cadence'] as const) {
      for (const d of [0.2, 0.5, 0.8]) {
        const t = pickTextureForBar({ style: 'ACG', phraseRole: role, density: d, energy: d, isDominantChain: false, random: picker });
        if (t) seen.add(t.textureCase);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const tc of seen) expect(ACG_RENDERED_TEXTURE_CASES).toContain(tc);
  });

  it('★ 确定性:同输入两次完全一致', () => {
    const gen = (tc: string) => JSON.stringify(renderTextureChordHits(tc, VOICED, DUR)) + JSON.stringify(renderTextureBassHits(tc, DUR));
    for (const tc of ACG_RENDERED_TEXTURE_CASES) expect(gen(tc)).toBe(gen(tc));
  });

  it('★ 空 voicing 不崩(返回空 chord hits)', () => {
    for (const tc of ACG_RENDERED_TEXTURE_CASES) expect(renderTextureChordHits(tc, [], DUR)).toEqual([]);
  });
});
