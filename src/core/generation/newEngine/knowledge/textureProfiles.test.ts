// ============================================================
// newEngine · knowledge · TextureProfiles 测试
// ------------------------------------------------------------
// 锁 §9 port:cell 角色密度曲线 · densityForCell 段落调制 · TEXTURE_POOL 只含
// modern+lofi(无 legacy)· pickTextureForBar 过滤 + dominant-chain 排除 + 兜底。
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  phraseCellRole, densityForCell, energyForCell, TEXTURE_POOL, pickTextureForBar,
} from './textureProfiles';

const picker = { pick: <T>(xs: readonly T[]): T => xs[0] };

describe('phraseCellRole — 密度曲线', () => {
  it('16 bar = 4×4 cell', () => {
    expect(phraseCellRole(0, 16)).toBe('establish');
    expect(phraseCellRole(4, 16)).toBe('develop');
    expect(phraseCellRole(8, 16)).toBe('lift');
    expect(phraseCellRole(12, 16)).toBe('cadence');
  });
  it('≤4 bar 全 cadence;8 bar = establish/cadence', () => {
    expect(phraseCellRole(2, 4)).toBe('cadence');
    expect(phraseCellRole(0, 8)).toBe('establish');
    expect(phraseCellRole(7, 8)).toBe('cadence');
  });
});

describe('densityForCell — 段落调制', () => {
  it('落在 [0.10,0.95]', () => {
    for (const role of ['establish', 'develop', 'lift', 'cadence'] as const) {
      for (const sec of ['INTRO', 'VERSE', 'CHORUS', 'BRIDGE', 'OUTRO'] as const) {
        const d = densityForCell(role, sec);
        expect(d).toBeGreaterThanOrEqual(0.10);
        expect(d).toBeLessThanOrEqual(0.95);
      }
    }
  });
  it('CHORUS 比 INTRO 密;energyForCell = densityForCell', () => {
    expect(densityForCell('develop', 'CHORUS')).toBeGreaterThan(densityForCell('develop', 'INTRO'));
    expect(energyForCell('lift', 'CHORUS')).toBe(densityForCell('lift', 'CHORUS'));
  });
});

describe('TEXTURE_POOL — 只含 modern + lofi(无 legacy)', () => {
  it('池大小 = 8 modern + 9 lofi = 17,且无 legacy 派生项', () => {
    expect(TEXTURE_POOL).toHaveLength(17);
    // 所有 profile 都有显式 mood + 非空 styles(legacy 派生项是 'groove' 兜底 + 宽匹配,这里全是显式作者元数据)
    for (const t of TEXTURE_POOL) {
      expect(t.styles.length).toBeGreaterThan(0);
      expect(t.densityRange[0]).toBeLessThanOrEqual(t.densityRange[1]);
    }
    // id 唯一
    expect(new Set(TEXTURE_POOL.map((t) => t.id)).size).toBe(17);
  });
});

describe('pickTextureForBar — 过滤选择', () => {
  it('命中 style+role+density+energy 的 profile', () => {
    const t = pickTextureForBar({ style: 'POP', phraseRole: 'establish', density: 0.30, energy: 0.30, isDominantChain: false, random: picker });
    expect(t).not.toBeNull();
    expect(t!.styles).toContain('POP');
    expect(t!.phraseRoles).toContain('establish');
  });

  it('avoidOnDominantChain 在属链上被排除', () => {
    // density 0.12 只匹配 avoid 类(ambient_pad_breath/low_pedal_wash);非属链 → 选到 avoid 类
    const off = pickTextureForBar({ style: 'POP', phraseRole: 'establish', density: 0.12, energy: 0.20, isDominantChain: false, random: picker });
    expect(off!.avoidOnDominantChain).toBe(true);
    // 属链 → avoid 类全被排除,候选空 → 回退同 style 池(首个非 avoid)
    const on = pickTextureForBar({ style: 'POP', phraseRole: 'establish', density: 0.12, energy: 0.20, isDominantChain: true, random: picker });
    expect(on!.avoidOnDominantChain).toBeFalsy();
  });

  it('无任何该 style → null', () => {
    expect(pickTextureForBar({ style: 'BLUES', phraseRole: 'establish', density: 0.3, energy: 0.3, isDominantChain: false, random: picker })).toBeNull();
  });
});
