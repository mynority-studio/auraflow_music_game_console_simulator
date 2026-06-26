import { describe, it, expect } from 'vitest';
import {
  GROOVE_CONTRACT_POOL, grooveContractsForStyle, pickGrooveContract, grooveContractById,
  grooveTextureScore, pickGrooveTexture, type GrooveStyleName,
} from './grooveContracts';
import type { TextureProfile } from './textureProfiles';

const rng = (vals: number[]) => { let i = 0; return { next: () => vals[i++ % vals.length] }; };

describe('knowledge/grooveContracts(MG 升级 Phase 1)', () => {
  it('★ POP/JAZZ/LOFI/RNB/ACG 均有 pool', () => {
    for (const s of ['POP', 'JAZZ', 'LOFI', 'RNB', 'ACG'] as GrooveStyleName[]) {
      expect(grooveContractsForStyle(s).length, s).toBeGreaterThan(0);
      expect(grooveContractsForStyle(s).every((c) => c.style === s), `${s} 全同 style`).toBe(true);
    }
    expect(grooveContractsForStyle('BLUES').length).toBeGreaterThan(0); // 无独立 pool → 回退 POP
  });

  it('★ pick 不越界(任意 roll 都返回该 style 的合法 contract)', () => {
    for (const s of ['POP', 'JAZZ', 'LOFI', 'RNB', 'ACG'] as GrooveStyleName[]) {
      for (const r of [0, 0.01, 0.5, 0.99, 0.999]) {
        const c = pickGrooveContract(s, rng([r]));
        expect(grooveContractsForStyle(s).includes(c), `${s}@${r}`).toBe(true);
      }
    }
  });

  it('★ pick 确定性 + 加权(同 roll 同结果;低 roll → 高 weight 居前)', () => {
    expect(pickGrooveContract('POP', rng([0.0]))).toBe(pickGrooveContract('POP', rng([0.0])));
    expect(pickGrooveContract('POP', rng([0.0])).id).toBe('pop_radio_straight'); // weight 4 居首
  });

  it('★ allowed/preferred/forbidden texture cases 可查询(score)', () => {
    const acg = grooveContractById('acg_hisaishi_rubato_arp')!;
    expect(grooveTextureScore(acg, { textureCase: 'Piano_TopVoice_Planing', mood: 'lyrical' })).toBeGreaterThan(1); // preferred
    expect(grooveTextureScore(acg, { textureCase: 'NotAllowed_Case', mood: 'drive' })).toBe(0);                     // 不在 allowed
    const pop = grooveContractById('pop_radio_straight')!;
    expect(grooveTextureScore(pop, { textureCase: 'Ambient_Reverse_Swell', mood: 'ambient' })).toBe(0);             // forbidden
  });

  it('★ pickGrooveTexture:只从 score>0 选;无可用 → null', () => {
    const acg = grooveContractById('acg_hisaishi_rubato_arp')!;
    const tx = (textureCase: string, mood: TextureProfile['mood']): TextureProfile =>
      ({ id: textureCase, textureCase, styles: [], mood, phraseRoles: [], densityRange: [0, 1], energyRange: [0, 1], maxRepeatBars: 4 } as unknown as TextureProfile);
    const textures = [tx('Piano_TopVoice_Planing', 'lyrical'), tx('NotAllowed', 'drive')];
    expect(pickGrooveTexture(textures, acg, rng([0.0]))!.textureCase).toBe('Piano_TopVoice_Planing');
    expect(pickGrooveTexture([textures[1]], acg, rng([0.0]))).toBeNull(); // 唯一项不被允许 → null
  });

  it('★ 全 pool contract 字段完整(swing 0..1、pocket 二元组、accent 4 位)', () => {
    for (const c of GROOVE_CONTRACT_POOL) {
      expect(c.compSwingRatio).toBeGreaterThanOrEqual(0.5); expect(c.compSwingRatio).toBeLessThanOrEqual(0.8);
      expect(c.melodySwingRatio).toBeGreaterThanOrEqual(0.5); expect(c.melodySwingRatio).toBeLessThanOrEqual(0.8);
      expect(c.bassPocketMs).toHaveLength(2); expect(c.accentPattern).toHaveLength(4);
      expect(c.weight).toBeGreaterThan(0);
    }
  });
});
