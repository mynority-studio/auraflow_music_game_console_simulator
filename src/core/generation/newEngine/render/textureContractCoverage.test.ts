import { describe, it, expect } from 'vitest';
import { GROOVE_CONTRACT_POOL } from '../knowledge/grooveContracts';
import { TEXTURE_POOL, TEXTURE_BEHAVIOR } from '../knowledge/textureProfiles';
import { renderTextureChordHits, renderTextureBassHits, hasTextureRenderer } from './textureRenderer';

// ============================================================
// MG full-parity Phase E(directive §3.6)— texture KB/render 覆盖 GrooveContract 引用的全部 case
// ------------------------------------------------------------
// 防回归:GrooveContract 的 preferred/allowed texture case 名只在 contract 里当字符串、却没有可选择/
//   可渲染 texture profile → 选中后 comp 落空(silent)。本测强制每个被引用的 case 都进 TEXTURE_POOL +
//   有 render 实现;并 dry-render 四个新增 POP/RNB 色彩 case(§3.6 验收)。
// ============================================================

const POOL_CASES = new Set(TEXTURE_POOL.map((p) => p.textureCase));
const referenced = (key: 'preferredTextureCases' | 'allowedTextureCases' | 'forbiddenTextureCases'): string[] => {
  const out = new Set<string>();
  for (const c of GROOVE_CONTRACT_POOL) for (const tc of (c[key] ?? [])) out.add(tc);
  return [...out].sort();
};

const NEW_RNB_CASES = ['Pop_Rnb_Expensive_Add9_Quartal', 'RnB_Drop2_Color_Answer', 'RnB_InnerTight_Wide_Color', 'RnB_Quartal_Breath_Roll'];

describe('render/textureContractCoverage — Phase E §3.6', () => {
  it('★ 每个 GrooveContract preferred/allowed texture case 都在 TEXTURE_POOL(无悬空引用 → 选中不落空)', () => {
    const need = new Set([...referenced('preferredTextureCases'), ...referenced('allowedTextureCases')]);
    const missing = [...need].filter((tc) => !POOL_CASES.has(tc));
    expect(missing, `TEXTURE_POOL 缺失被 contract 引用的 case:${missing.join(', ')}`).toEqual([]);
  });

  it('★ 被引用的每个 case 都有 render 实现(hasTextureRenderer)', () => {
    const need = new Set([...referenced('preferredTextureCases'), ...referenced('allowedTextureCases')]);
    const noRender = [...need].filter((tc) => !hasTextureRenderer(tc));
    expect(noRender, `无 render 实现:${noRender.join(', ')}`).toEqual([]);
  });

  it('★ forbidden case 也应是真实 case(在 pool 或有 render — 否则 forbidden 是死规则)', () => {
    const dangling = referenced('forbiddenTextureCases').filter((tc) => !POOL_CASES.has(tc) && !hasTextureRenderer(tc));
    expect(dangling, `forbidden 引用了不存在的 case:${dangling.join(', ')}`).toEqual([]);
  });

  it('★ 四个新增 POP/RNB 色彩 case 都在 pool + behavior + 非 delayed-entry', () => {
    for (const tc of NEW_RNB_CASES) {
      expect(POOL_CASES.has(tc), `${tc} ∈ TEXTURE_POOL`).toBe(true);
      expect(TEXTURE_BEHAVIOR[tc], `${tc} ∈ TEXTURE_BEHAVIOR`).toBeTruthy();
      expect(TEXTURE_BEHAVIOR[tc].firstOnsetBeat, `${tc} 非 delayed-entry`).toBeLessThanOrEqual(0.75);
    }
  });

  it('★ dry render:四个新 case 在多种 voicing/span 下产 chord+bass 事件(非空、合法、tRel<dur)', () => {
    const voicings = [[48, 55, 60, 64, 67], [50, 57, 60, 65], [52, 59, 67]]; // 5/4/3 声部
    for (const tc of NEW_RNB_CASES) {
      let anyChord = 0;
      for (const v of voicings) for (const dur of [2, 4]) {
        const chord = renderTextureChordHits(tc, v, dur);
        const bass = renderTextureBassHits(tc, dur);
        for (const h of chord) {
          expect(h.tRel, `${tc} chord tRel<dur`).toBeLessThan(dur);
          expect(h.midis.length, `${tc} chord 非空 voice`).toBeGreaterThan(0);
          expect(h.vel).toBeGreaterThan(0);
          expect(h.vel).toBeLessThanOrEqual(1);
        }
        for (const h of bass) {
          expect(h.tRel, `${tc} bass tRel<dur`).toBeLessThan(dur);
          expect(h.dur).toBeGreaterThan(0);
        }
        expect(bass.length, `${tc} 有 bass 事件`).toBeGreaterThan(0);
        anyChord += chord.length;
      }
      expect(anyChord, `${tc} 至少在某 voicing/span 产 chord 事件`).toBeGreaterThan(0);
    }
  });

  it('★ 四个新 case 确定性:同输入两次渲染逐字节一致', () => {
    const v = [48, 55, 60, 64, 67];
    for (const tc of NEW_RNB_CASES) {
      expect(JSON.stringify(renderTextureChordHits(tc, v, 4))).toBe(JSON.stringify(renderTextureChordHits(tc, v, 4)));
      expect(JSON.stringify(renderTextureBassHits(tc, 4))).toBe(JSON.stringify(renderTextureBassHits(tc, 4)));
    }
  });
});
