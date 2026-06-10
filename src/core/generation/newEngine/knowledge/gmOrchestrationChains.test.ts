import { describe, it, expect } from 'vitest';
import {
  CHAIN_PROFILES, chooseOrchestrationChain, deriveChainWorld, orchestrateRolePrograms,
  scoreProgramPair, isHarshLead, type ChainProfile,
} from './gmOrchestrationChains';
import { instrumentInfo, gmName, canPlayComp, leadCompCompatible, instrumentInfo as info } from './instruments';
import type { InstrumentRoleName } from '../band/BandSpec';

const ALL: ChainProfile[] = Object.values(CHAIN_PROFILES);

describe('knowledge/gmOrchestrationChains — 链表结构', () => {
  it('每条链 profile 有 comp/lead/bass/pad/drum 优先序(非空)', () => {
    for (const p of ALL) {
      expect(p.compPriority.length, `${p.id} comp`).toBeGreaterThan(0);
      expect(Object.keys(p.leadByComp).length, `${p.id} lead`).toBeGreaterThan(0);
      expect(p.bassPriority.length, `${p.id} bass`).toBeGreaterThan(0);
      expect(p.padPriority.length, `${p.id} pad`).toBeGreaterThan(0);
      expect(p.drumPriority.length, `${p.id} drum`).toBeGreaterThan(0);
    }
  });

  it('链里每个 comp/lead/bass/pad 程序都有 instrumentInfo 元数据 + gmName(drum kit 除外)', () => {
    for (const p of ALL) {
      const progs = new Set<number>([...p.compPriority, ...p.bassPriority, ...p.padPriority, ...Object.values(p.leadByComp).flat()]);
      for (const prog of progs) {
        expect(info(prog).family, `${p.id} GM${prog} family`).not.toBe('other');
        expect(gmName(prog), `${p.id} GM${prog} name`).not.toMatch(/^GM \d+$/);
      }
    }
  });
});

describe('knowledge/gmOrchestrationChains — 世界选择', () => {
  it('deriveChainWorld:style 优先(jazz/lofi/rnb/modal),pop 由 provisional comp/bass 源推导', () => {
    expect(deriveChainWorld('jazz', {})).toBe('jazzCombo');
    expect(deriveChainWorld('lofi', {})).toBe('lofiTapeKeys');
    expect(deriveChainWorld('rnb', { bass: 33 })).toBe('electricKeys');
    expect(deriveChainWorld('rnb', { bass: 39 })).toBe('syntheticSoft'); // 合成贝斯 → synth 世界
    expect(deriveChainWorld('modal', { bass: 33 })).toBe('modalAmbient');
    expect(deriveChainWorld('pop', { comp: 0 })).toBe('acousticPianoBand'); // 原声 comp
    expect(deriveChainWorld('pop', { comp: 4 })).toBe('electricKeys');       // 电钢 comp
    expect(deriveChainWorld('pop', { comp: 4, bass: 38 })).toBe('syntheticSoft'); // 合成贝斯
  });

  it('lofi 一律 lofiTapeKeys(避免亮钢琴 comp:不在其 compPriority)', () => {
    expect(deriveChainWorld('lofi', { comp: 1 })).toBe('lofiTapeKeys');
    expect(CHAIN_PROFILES.lofiTapeKeys.compPriority).not.toContain(1);
    // 注入亮钢琴 comp(GM1)→ 链不保留,改链首 EP
    const r = orchestrateRolePrograms({ style: 'lofi', lineup: ['comp', 'lead'], provisional: { comp: 1, lead: 4 } });
    expect(r.roleProgram.comp).not.toBe(1);
    expect(canPlayComp(r.roleProgram.comp)).toBe(true);
  });
});

describe('knowledge/gmOrchestrationChains — orchestrate 协同', () => {
  it('electricKeys:comp/lead 配对兼容', () => {
    const r = orchestrateRolePrograms({ style: 'rnb', lineup: ['comp', 'lead', 'bass'], requestedWorld: 'electricKeys', provisional: { comp: 4, lead: 11, bass: 33 } });
    // lead=vibe(11) 与 EP comp 跨族跨源 → 链改成兼容 lead
    expect(leadCompCompatible(r.roleProgram.lead, r.roleProgram.comp)).toBe(true);
  });

  it('acousticPianoBand:原声钢琴 comp + 木琴 lead(百搭)保留', () => {
    const r = orchestrateRolePrograms({ style: 'pop', lineup: ['comp', 'lead'], provisional: { comp: 0, lead: 11 } });
    expect(r.world).toBe('acousticPianoBand');
    expect(r.roleProgram.comp).toBe(0);
    expect(r.roleProgram.lead).toBe(11); // 木琴 over 原声钢琴 = 兼容,保留
  });

  it('jazzCombo:绝不选合成贝斯(注入 synth bass → 改原声)', () => {
    const r = orchestrateRolePrograms({ style: 'jazz', lineup: ['comp', 'bass'], provisional: { comp: 0, bass: 38 } });
    expect([38, 39]).not.toContain(r.roleProgram.bass);
    expect(info(r.roleProgram.bass).family).toBe('bass');
    // 链表本身也不含合成贝斯
    expect(CHAIN_PROFILES.jazzCombo.bassPriority.some((b) => b === 38 || b === 39)).toBe(false);
  });

  it('syntheticSoft:合成贝斯 + 合成 pad 可选,且 lead 不刺耳', () => {
    const r = orchestrateRolePrograms({ style: 'pop', lineup: ['comp', 'bass', 'pad', 'lead'], requestedWorld: 'syntheticSoft', provisional: { comp: 5, bass: 38, pad: 88, lead: 5 } });
    expect(r.roleProgram.bass).toBe(38);
    expect(r.roleProgram.pad).toBe(88);
    expect(isHarshLead(r.roleProgram.lead)).toBe(false);
  });

  it('hard-reject:comp 不会变成管风琴/pad/弦/管乐(注入 organ → 改可 comp 乐器)', () => {
    for (const bad of [16, 89, 48, 75]) { // 管风琴 / pad / 弦 / 排箫
      const r = orchestrateRolePrograms({ style: 'rnb', lineup: ['comp'], requestedWorld: 'electricKeys', provisional: { comp: bad } });
      expect(canPlayComp(r.roleProgram.comp), `comp=GM${bad} 应被修`).toBe(true);
    }
  });

  it('drum:保 provisional(标准 0),无则链首(jazz=brush 40)', () => {
    const kept = orchestrateRolePrograms({ style: 'jazz', lineup: ['drum'], provisional: { drum: 0 } });
    expect(kept.roleProgram.drum).toBe(0);
    const chain = orchestrateRolePrograms({ style: 'jazz', lineup: ['drum'], provisional: {} });
    expect(chain.roleProgram.drum).toBe(40); // jazzCombo drumPriority[0]=brush
  });

  it('确定性:同 style/lineup/provisional → 同 roleProgram', () => {
    const args = { style: 'rnb' as const, lineup: ['bass', 'comp', 'lead', 'pad'] as InstrumentRoleName[], provisional: { bass: 35, comp: 4, lead: 4, pad: 89 } };
    const a = orchestrateRolePrograms(args), b = orchestrateRolePrograms(args);
    expect(a.roleProgram).toEqual(b.roleProgram);
  });
});

describe('knowledge/gmOrchestrationChains — 辅助', () => {
  it('isHarshLead:铜管/萨克斯/独奏小提琴/失真吉他/合唱/合成 lead = 刺耳;暖键盘/木琴/排箫 = 否', () => {
    for (const p of [56, 60, 64, 40, 30, 52, 81]) expect(isHarshLead(p), `GM${p}`).toBe(true);
    for (const p of [0, 4, 11, 12, 75, 77, 108]) expect(isHarshLead(p), `GM${p}`).toBe(false);
  });

  it('scoreProgramPair:同程序 > 跨族;刺耳 lead 重罚 < 0', () => {
    expect(scoreProgramPair(4, 4, 'lead-comp')).toBeGreaterThan(scoreProgramPair(12, 4, 'lead-comp'));
    expect(scoreProgramPair(60, 4, 'lead-comp')).toBeLessThan(0); // 小号 lead
    expect(scoreProgramPair(89, 4, 'pad-comp')).toBeGreaterThanOrEqual(0); // pad 合法(不罚)
    expect(scoreProgramPair(72, 4, 'pad-comp')).toBeLessThan(0);    // 长笛不能当 pad(重罚)
    expect(scoreProgramPair(89, 4, 'pad-comp')).toBeGreaterThan(scoreProgramPair(72, 4, 'pad-comp'));
  });
});
