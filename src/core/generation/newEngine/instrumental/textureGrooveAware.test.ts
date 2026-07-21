import { describe, it, expect } from 'vitest';
import {
  grooveTextureScore, pickGrooveTexture, pickTextureForBarWithGroove,
  TEXTURE_POOL, type GrooveTextureContract,
} from '../knowledge/textureProfiles';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from './instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { isAcgTextureCase } from '../render/textureRenderer';
import { createRandomContext, pc } from '../foundation';
import { grooveContractsForStyle } from '../knowledge/grooveContracts';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';

// ============================================================
// MG full-parity Phase E(directive §3.7)— GrooveContract-aware texture 选择验收
// ------------------------------------------------------------
// ① forbidden case 被排除(score 0,选择永不命中)。
// ② preferred case 在其它 filter 都过时被强选(score +3 → 加权抽样占多数)。
// ③ ACG seed:选中 texture ∈ ACG spacious 集(不回退 generic dense comp)。
// ============================================================

const sweep = (n: number): { next: () => number } => {
  let i = 0;
  return { next: () => (i++ + 0.5) / n }; // 均匀扫 (0,1)
};
const acg = (tc: string) => TEXTURE_POOL.find((t) => t.textureCase === tc)!;

describe('instrumental/textureGrooveAware — Phase E §3.7', () => {
  it('① grooveTextureScore:非 allowed=0、forbidden=0、preferred=base+3、density/grid×mood +1', () => {
    const block = { textureCase: 'X', mood: 'block' as never };
    // 非 allowed
    expect(grooveTextureScore({ allowedTextureCases: ['Y'] }, block)).toBe(0);
    // forbidden(即便 allowed)
    expect(grooveTextureScore({ allowedTextureCases: ['X'], forbiddenTextureCases: ['X'] }, block)).toBe(0);
    // base
    expect(grooveTextureScore({}, block)).toBe(1);
    // preferred → +3
    expect(grooveTextureScore({ preferredTextureCases: ['X'] }, block)).toBe(4);
    // density×mood
    expect(grooveTextureScore({ density: 'sparse' }, { textureCase: 'X', mood: 'ambient' as never })).toBe(2);
    expect(grooveTextureScore({ density: 'active' }, { textureCase: 'X', mood: 'pocket' as never })).toBe(2);
    // grid×mood
    expect(grooveTextureScore({ grid: 'dilla' }, { textureCase: 'X', mood: 'pocket' as never })).toBe(2);
    expect(grooveTextureScore({ grid: 'rubato', preferredTextureCases: ['X'] }, { textureCase: 'X', mood: 'lyrical' as never })).toBe(5);
  });

  it('② pickGrooveTexture:forbidden 织体在任意 random 下都不被选中', () => {
    const pool = ['Piano_TopVoice_Planing', 'ACG_Quartal_Arp_Wave', 'ACG_Anthem_Block_Push'].map(acg);
    const contract: GrooveTextureContract = { allowedTextureCases: pool.map((p) => p.textureCase), forbiddenTextureCases: ['ACG_Anthem_Block_Push'] };
    const r = sweep(200);
    for (let i = 0; i < 200; i++) {
      const picked = pickGrooveTexture(pool, contract, r);
      expect(picked?.textureCase).not.toBe('ACG_Anthem_Block_Push');
    }
  });

  it('② preferred 织体在 filter 都过时被【强选】(占多数,~score 比例)', () => {
    const pool = ['ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th'].map(acg); // 都 lyrical,allowed
    const contract: GrooveTextureContract = { allowedTextureCases: pool.map((p) => p.textureCase), preferredTextureCases: ['ACG_Quartal_Arp_Wave'] };
    const N = 400; const r = sweep(N);
    let pref = 0;
    for (let i = 0; i < N; i++) if (pickGrooveTexture(pool, contract, r)?.textureCase === 'ACG_Quartal_Arp_Wave') pref++;
    // score 4 vs 1 → preferred ≈ 80%
    expect(pref / N, 'preferred 占多数').toBeGreaterThan(0.6);
  });

  it('② 无 contract → 退回 plain pickTextureForBar(向后兼容,不崩)', () => {
    const picked = pickTextureForBarWithGroove({ style: 'POP', phraseRole: 'establish', density: 0.3, energy: 0.3, isDominantChain: false, random: { next: () => 0.4, pick: <T,>(xs: readonly T[]) => xs[0] } });
    expect(picked).toBeTruthy();
  });

  it('③ ACG seed:richTextureBySection 全是 ACG spacious 织体(不回退 generic dense comp)', () => {
    for (const seed of [7, 42, 100, 2024]) {
      const band = buildBandSpec({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
      const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'), plan);
      const picked = Object.values(instr.richTextureBySection);
      expect(picked.length, `seed${seed} 有段级 texture`).toBeGreaterThan(0);
      for (const tc of picked) {
        expect(isAcgTextureCase(tc), `seed${seed} ${tc} 是 ACG spacious(非 generic dense)`).toBe(true);
      }
      // 必须在 ACG contract 的 allowed 集内(契合 groove,非随机越界)
      const allowed = new Set(arr.songGrooveContract.allowedTextureCases ?? []);
      if (allowed.size > 0) for (const tc of picked) expect(allowed.has(tc), `seed${seed} ${tc} ∈ contract.allowed`).toBe(true);
    }
  });

  it('③ ACG 确定性:同 seed 两次 richTextureBySection 一致', () => {
    const build = () => {
      const band = buildBandSpec({ seed: 7, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(7) });
      const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(7));
      return buildInstrumentationPlan(band, arr, createRandomContext(7).substream('timbre'), plan).richTextureBySection;
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('plans each section texture from grooveContractBySection instead of the song snapshot', () => {
    const seed = 19;
    const band = buildBandSpec({ seed, styleHint: 'pop', mood: 'build', targetDuration: 120, key: pc(0) });
    const base = buildArrangementPlan(band, { rng: createRandomContext(seed) });
    const contracts = grooveContractsForStyle('POP').slice(0, 2);
    const bySection = Object.fromEntries(base.sections.map((section, index) => [section.id, contracts[index % 2]]));
    const arrangement = { ...base, grooveContractBySection: bySection } as unknown as ArrangementPlan;
    const harmonic = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
    const instrumentation = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'), harmonic);
    for (const section of arrangement.sections) {
      const texture = instrumentation.richTextureBySection[section.id];
      if (!texture) continue;
      expect(bySection[section.id].allowedTextureCases, `${section.id}/${texture}`)
        .toContain(texture);
      expect(bySection[section.id].forbiddenTextureCases ?? [], `${section.id}/${texture}`)
        .not.toContain(texture);
    }
  });
});
