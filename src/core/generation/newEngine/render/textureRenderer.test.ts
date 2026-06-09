// ============================================================
// newEngine · render · TextureRenderer 测试(rich textureCase 渲染)
// ------------------------------------------------------------
// 锁:17 个 rich textureCase 各产出 chord hit、彼此 articulation 不同、确定性。
// ============================================================

import { describe, expect, it } from 'vitest';
import { renderTextureChordHits, hasTextureRenderer, RENDERED_TEXTURE_CASES } from './textureRenderer';
import { hasMgCompProfile } from './mgTextureCompDry';

const VOICED = [60, 64, 67, 71]; // Cmaj7 mid voicing
const DUR = 4;

describe('textureRenderer · 覆盖与基本不变量', () => {
  it('63 个 rich textureCase 全部有渲染实现(17 modern/lofi + 46 legacy,Loop 6)', () => {
    expect(RENDERED_TEXTURE_CASES).toHaveLength(63);
    for (const tc of RENDERED_TEXTURE_CASES) expect(hasTextureRenderer(tc)).toBe(true);
  });
  it('未知/generic textureCase 无渲染', () => {
    expect(hasTextureRenderer('active-comp')).toBe(false);
    expect(hasTextureRenderer('nope')).toBe(false);
    expect(renderTextureChordHits('nope', VOICED, DUR)).toEqual([]);
  });
  it('每个 rich case 都产出 ≥1 hit(bass-only legacy 除外=MG comp 0),且 tRel<dur、vel∈(0,1]、midis 非空', () => {
    for (const tc of RENDERED_TEXTURE_CASES) {
      const hits = renderTextureChordHits(tc, VOICED, DUR);
      // ★ Gap B:bass-only legacy 织体 comp 渲染为空(忠实 MG comp=0);modern/lofi+其余 legacy 有 profile → ≥1。
      if (!hasMgCompProfile(tc)) { expect(hits.length, `${tc} bass-only 应空`).toBe(0); continue; }
      expect(hits.length, tc).toBeGreaterThan(0);
      for (const h of hits) {
        expect(h.tRel, tc).toBeLessThan(DUR);
        expect(h.vel, tc).toBeGreaterThan(0);
        expect(h.vel, tc).toBeLessThanOrEqual(1);
        expect(h.midis.length, tc).toBeGreaterThan(0);
      }
    }
  });
  it('空 voicing → 空 hit(不崩)', () => {
    expect(renderTextureChordHits('Piano_Lofi_OneShot_Space', [], DUR)).toEqual([]);
  });
  it('确定性:同输入两次完全一致', () => {
    const a = JSON.stringify(renderTextureChordHits('Lyrical_10th_Broken', VOICED, DUR));
    const b = JSON.stringify(renderTextureChordHits('Lyrical_10th_Broken', VOICED, DUR));
    expect(a).toBe(b);
  });
});

describe('textureRenderer · articulation 各不相同(结构性)', () => {
  const n = (tc: string) => renderTextureChordHits(tc, VOICED, DUR).length;
  it('OneShot=1 hit(最稀)、Dusty=4 off-beat、10th-Broken=8 arp、CommonTone-roll 按声部展开', () => {
    expect(n('Piano_Lofi_OneShot_Space')).toBe(1);
    expect(n('Piano_Lofi_Dusty_Chops')).toBe(4);
    expect(n('Lyrical_10th_Broken')).toBe(8); // dur*2
    expect(n('Piano_CommonTone_Soft_Roll')).toBe(VOICED.length * 2); // 两个强拍各 roll 全声部
  });
  it('OneShot 单 hit 落 0.025、整块和弦;Dusty 落 MG off-beat 0.58 起', () => {
    const one = renderTextureChordHits('Piano_Lofi_OneShot_Space', VOICED, DUR);
    expect(one[0].tRel).toBeCloseTo(0.025);
    expect(one[0].midis).toEqual([...VOICED].sort((a, b) => a - b));
    const dusty = renderTextureChordHits('Piano_Lofi_Dusty_Chops', VOICED, DUR);
    expect(dusty[0].tRel).toBeCloseTo(0.58);
  });
  it('Tape_Wobble 交替力度 dip(偶 0.32 / 奇 0.24)', () => {
    const w = renderTextureChordHits('Piano_Lofi_Tape_Wobble_Arp', VOICED, DUR);
    expect(w[0].vel).toBeCloseTo(0.32);
    expect(w[1].vel).toBeCloseTo(0.24);
  });
  it('短 span(dur=2 split)hit 数随 dur 缩(arp = dur*2 = 4)', () => {
    expect(renderTextureChordHits('Lyrical_10th_Broken', VOICED, 2)).toHaveLength(4);
    expect(renderTextureChordHits('Piano_Lofi_OneShot_Space', VOICED, 2)).toHaveLength(1);
  });
});
