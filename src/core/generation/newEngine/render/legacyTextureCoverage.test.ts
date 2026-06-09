// ============================================================
// newEngine · render · Legacy texture coverage(Loop 6,2026-06-09)
// ------------------------------------------------------------
// CODEX Loop 6 验收:① TEXTURE_POOL 含 modern + LOFI + legacy(strict MG 全量进可选择池);
//   ② 每个 MG legacy texture case 都能在 KB 查到 / 有 renderer;③ 每个可选 textureCase 都有 renderer。
//   ④ family interpreter 对全部 legacy case 出 chord+bass 事件(无静默漏渲染);⑤ 确定性。
// ============================================================

import { describe, it, expect } from 'vitest';
import { TEXTURE_POOL, TEXTURE_BEHAVIOR } from '../knowledge/textureProfiles';
import {
  hasTextureRenderer,
  RENDERED_TEXTURE_CASES,
  LEGACY_RENDERED_TEXTURE_CASES,
  renderTextureChordHits,
  renderTextureBassHits,
} from './textureRenderer';

// 源 styleDictionary._legacyTexturesAsPool() 产出(POP/JAZZ/LOFI/RNB primaryTextures 的 legacy,non-modern)。
const POOL_LEGACY = [
  'Pop_Alberti_Lyrical', 'Pop_Anthem_Pulse', 'Pop_Ballad_158_Sweep', 'Pop_Broken_8ths_Sync',
  'Pop_Half_Arp_Sweep', 'Pop_Piano_Arp_16ths', 'Pop_Wave_16ths', 'Block_Chord', 'Broken_Chord', 'Arpeggio_Flow',
  'Jazz_Charleston_Comp', 'Jazz_Drop_2_Comp', 'Jazz_Red_Garland_Block', 'Jazz_Waltz_Hemiola', 'Bossa_Piano_Arp',
  'RnB_16th_Funk_Stabs', 'RnB_Classic_Soul_Arp', 'RnB_Gospel_Triplets', 'RnB_Laid_Back_Groove', 'RnB_Neo_Soul_Roll',
];

// 源 musicEngine.applyTexture 的全部 legacy case(render 必须覆盖,含不进池的 BLUES + bass/stab)。
const ALL_MG_LEGACY = [
  ...POOL_LEGACY,
  'Blues_Boogie_Woogie', 'Blues_Chicago_Shuffle', 'Blues_Shuffle_Bass', 'Blues_Slow_12_8_Arp',
  'Blues_Slow_Chops', 'Blues_Stabs', 'Blues_Tremolo_Comp',
  'Arp_Seq', 'Block_Chord_Staccato', 'Bossa_Clave_Comping', 'Call_And_Response', 'Funk_Guitar_Scratch',
  'Jazz_Comping', 'Jazz_Walking_Bass', 'Ostinato_16s', 'Pop_Ostinato_Rock',
  'Root_5_7_5', 'Root_5_8', 'Root_7_5_8', 'Root_Fifth_Bass', 'Root_Octave_Pulse', 'Root_Octave',
  'Single_Root', 'Slap_Bass_Line', 'Stabs', 'Syncopated_Stabs',
];

const SAMPLE_VOICED = [48, 52, 55, 59]; // Cmaj7 区
const DUR = 4;

describe('Loop 6 — legacy texture coverage', () => {
  it('① TEXTURE_POOL 现含全部 20 个 pool legacy texture(strict MG 进可选择池)', () => {
    const poolCases = new Set(TEXTURE_POOL.map((p) => p.textureCase));
    for (const tc of POOL_LEGACY) expect(poolCases.has(tc), `pool 缺 legacy ${tc}`).toBe(true);
    // 仍保留 modern + lofi(未被替换)
    expect(poolCases.has('Lyrical_Felt_Piano_Sparse')).toBe(true);
    expect(poolCases.has('Piano_Lofi_OneShot_Space')).toBe(true);
  });

  it('① legacy 各属唯一 macro,且 broad metadata(任意 phraseRole / density[0,1] / energy[0,1])', () => {
    for (const tc of POOL_LEGACY) {
      const prof = TEXTURE_POOL.find((p) => p.textureCase === tc)!;
      expect(prof.styles.length, `${tc} 应单一 macro`).toBe(1);
      expect(prof.phraseRoles).toEqual(['establish', 'develop', 'lift', 'cadence']);
      expect(prof.densityRange).toEqual([0, 1]);
      expect(prof.energyRange).toEqual([0, 1]);
      expect(prof.id).toBe(`legacy_${tc.toLowerCase()}`);
    }
  });

  it('② 每个 MG legacy texture case 都能在 KB(LEGACY_RENDERED)查到', () => {
    const known = new Set(LEGACY_RENDERED_TEXTURE_CASES);
    for (const tc of ALL_MG_LEGACY) expect(known.has(tc), `LEGACY_RENDERED 缺 ${tc}`).toBe(true);
    expect(LEGACY_RENDERED_TEXTURE_CASES.length).toBe(ALL_MG_LEGACY.length);
  });

  it('③ 每个可选 textureCase(TEXTURE_POOL,非 generic)都有 renderer', () => {
    for (const p of TEXTURE_POOL) {
      expect(hasTextureRenderer(p.textureCase), `${p.textureCase} 无 renderer`).toBe(true);
    }
  });

  it('③ 每个 MG legacy case hasTextureRenderer = true', () => {
    for (const tc of ALL_MG_LEGACY) expect(hasTextureRenderer(tc), `${tc} 无 renderer`).toBe(true);
  });

  it('④ family interpreter:每个 legacy case 出 ≥1 chord hit + ≥1 bass hit(无静默漏渲染)', () => {
    for (const tc of ALL_MG_LEGACY) {
      const chords = renderTextureChordHits(tc, SAMPLE_VOICED, DUR);
      const basses = renderTextureBassHits(tc, DUR);
      expect(chords.length, `${tc} chord 漏渲染`).toBeGreaterThan(0);
      expect(basses.length, `${tc} bass 漏渲染`).toBeGreaterThan(0);
      // 所有 hit 在 span 内、力度归一
      for (const h of chords) { expect(h.tRel).toBeLessThan(DUR); expect(h.vel).toBeGreaterThan(0); expect(h.vel).toBeLessThanOrEqual(1); }
      for (const h of basses) { expect(h.tRel).toBeLessThan(DUR); expect(h.dur).toBeGreaterThan(0); }
    }
  });

  it('④ bass-pattern 织体的 bass 起音锁强拍(对拍:整拍上有起音)', () => {
    for (const tc of ['Root_Octave', 'Jazz_Walking_Bass', 'Slap_Bass_Line', 'Single_Root']) {
      const basses = renderTextureBassHits(tc, DUR);
      expect(basses.some((h) => Math.abs(h.tRel - Math.round(h.tRel)) < 1e-6), `${tc} bass 不在整拍`).toBe(true);
    }
  });

  it('⑤ 确定性:同输入同输出', () => {
    for (const tc of ['Pop_Anthem_Pulse', 'Jazz_Charleston_Comp', 'RnB_Neo_Soul_Roll', 'Blues_Boogie_Woogie']) {
      expect(renderTextureChordHits(tc, SAMPLE_VOICED, DUR)).toEqual(renderTextureChordHits(tc, SAMPLE_VOICED, DUR));
      expect(renderTextureBassHits(tc, DUR)).toEqual(renderTextureBassHits(tc, DUR));
    }
  });

  it('TEXTURE_BEHAVIOR 覆盖 20 个 pool legacy(首击 ≤ 0.5 拍,非 delayed-entry → 段级常驻不留洞)', () => {
    for (const tc of POOL_LEGACY) {
      const beh = TEXTURE_BEHAVIOR[tc];
      expect(beh, `${tc} 缺 behavior`).toBeTruthy();
      expect(beh.firstOnsetBeat, `${tc} 首击应 ≤ 0.5`).toBeLessThanOrEqual(0.5);
    }
  });
});
