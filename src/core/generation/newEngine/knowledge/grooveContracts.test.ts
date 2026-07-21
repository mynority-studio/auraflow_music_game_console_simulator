import { describe, it, expect } from 'vitest';
import {
  GROOVE_CONTRACT_POOL, grooveContractsForStyle, pickGrooveContract, grooveContractById,
  grooveTextureScore, pickGrooveTexture, rhythmSwingSourceForContract, type GrooveStyleName,
} from './grooveContracts';
import type { TextureProfile } from './textureProfiles';
import { POP_ROCK_FILL_VOCABULARY_ID } from './drumFillVocabulary';
import { drumPerformanceVariants } from './grooves';

const rng = (vals: number[]) => { let i = 0; return { next: () => vals[i++ % vals.length] }; };

describe('knowledge/grooveContracts(MG 升级 Phase 1)', () => {
  it('★ POP/JAZZ/LOFI/RNB/ACG 均有 pool', () => {
    for (const s of ['POP', 'JAZZ', 'LOFI', 'RNB', 'ACG'] as GrooveStyleName[]) {
      expect(grooveContractsForStyle(s).length, s).toBeGreaterThan(0);
      expect(grooveContractsForStyle(s).every((c) => c.style === s), `${s} 全同 style`).toBe(true);
    }
    expect(grooveContractsForStyle('BLUES').length).toBeGreaterThan(0); // 无独立 pool → 回退 POP
  });

  it('POP contracts carry the POP/Rock fill vocabulary inside the same GrooveContract', () => {
    expect(grooveContractsForStyle('POP').every((contract) =>
      contract.drum?.fillVocabulary === POP_ROCK_FILL_VOCABULARY_ID)).toBe(true);
    expect(grooveContractsForStyle('RNB').every((contract) =>
      contract.drum?.fillVocabulary === undefined)).toBe(true);
  });

  it('locks the production GrooveContract and concrete base-drum inventory by style', () => {
    const expected = {
      POP: { contracts: 4, families: 5, patterns: 15 },
      LOFI: { contracts: 3, families: 3, patterns: 9 },
      RNB: { contracts: 5, families: 5, patterns: 15 },
      JAZZ: { contracts: 1, families: 3, patterns: 8 },
    } as const;

    for (const [style, counts] of Object.entries(expected)) {
      const registered = grooveContractsForStyle(style as GrooveStyleName);
      // Jazz production currently starts from the generic 4/4 combo baseline;
      // the other registered Jazz contracts remain future KB material.
      const contracts = style === 'JAZZ'
        ? registered.filter((contract) => contract.id === 'jazz_combo_swing')
        : registered;
      const families = new Set(contracts.flatMap((contract) => {
        const drum = contract.drum;
        return drum ? [drum.timekeeperFamily, drum.liftFamily, drum.pickupFamily, drum.breakdownFamily] : [];
      }).filter((family): family is string => !!family));
      const patterns = [...families].reduce((sum, patternFamily) =>
        sum + drumPerformanceVariants({ patternFamily }).length, 0);

      expect({ contracts: contracts.length, families: families.size, patterns }, style).toEqual(counts);
    }
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

  it('★ 全 pool contract 字段完整(swing 0..1、pocket 二元组、accent 长度随 meter)', () => {
    for (const c of GROOVE_CONTRACT_POOL) {
      expect(c.compSwingRatio).toBeGreaterThanOrEqual(0.5); expect(c.compSwingRatio).toBeLessThanOrEqual(0.8);
      expect(c.melodySwingRatio).toBeGreaterThanOrEqual(0.5); expect(c.melodySwingRatio).toBeLessThanOrEqual(0.8);
      expect(c.bassPocketMs).toHaveLength(2);
      expect(c.accentPattern).toHaveLength(c.meter?.numerator ?? 4);
      if (c.beatGrouping) expect(c.beatGrouping.reduce((sum, beats) => sum + beats, 0)).toBe(c.meter?.numerator);
      expect(c.weight).toBeGreaterThan(0);
    }
  });

  it('swing source ownership: Dilla uses straight 16ths; authored triplets are not warped twice', () => {
    expect(rhythmSwingSourceForContract(grooveContractById('rnb_dilla_pocket')!)).toBe('straight-sixteenths');
    expect(rhythmSwingSourceForContract(grooveContractById('lofi_lazy_dilla')!)).toBe('straight-sixteenths');
    expect(rhythmSwingSourceForContract(grooveContractById('rnb_gospel_triplet')!)).toBe('authored');
    expect(rhythmSwingSourceForContract(grooveContractById('jazz_combo_swing')!)).toBe('straight-eighths');
  });

  it('Jazz 5/4 exposes an exact song-global lane vocabulary instead of overloading swing ratio', () => {
    const contract = grooveContractById('jazz_take_five_5_4')!;
    expect(contract.barOriginPolicy).toBe('song-global');
    expect(contract.rhythmSwingSource).toBe('authored');
    expect(contract.compSwingRatio).toBe(2 / 3);

    const ticksByLane = Object.fromEntries((contract.phaseLanes ?? []).map((lane) => [
      lane.id,
      lane.offset.numerator * 480 / lane.offset.denominator,
    ]));
    expect(ticksByLane).toEqual({
      quarter: 0,
      'triplet-late': 320,
      'authored-61-96': 305,
      'development-5-8': 300,
      'straight-sixteenth': 120,
      'lead-thirtieth-bar-cell': 80,
    });
    expect(contract.phaseLanes?.every((lane) => lane.postSwing === false)).toBe(true);
  });
});
