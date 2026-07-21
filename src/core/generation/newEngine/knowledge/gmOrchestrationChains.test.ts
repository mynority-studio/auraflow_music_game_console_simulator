import { describe, it, expect } from 'vitest';
import {
  CHAIN_PROFILES, chooseEnsembleWorld, chooseOrchestrationChain,
  deriveChainWorld, ensembleAllowsRoleProgram, orchestrateRolePrograms,
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

  it('五种 macro 会收敛到有现实依据的乐队编制模板，且选择不消耗额外 rng', () => {
    expect(chooseEnsembleWorld('pop', { comp: 5, bass: 38 })).toBe('cityPopElectricBand');
    expect(chooseEnsembleWorld('pop', { comp: 0, bass: 32 })).toBe('cityPopPianoBand');
    expect(chooseEnsembleWorld('jazz', { lead: 0 })).toBe('jazzPianoTrio');
    expect(chooseEnsembleWorld('jazz', { lead: 66 })).toBe('jazzSaxQuartet');
    expect(chooseEnsembleWorld('jazz', { lead: 0 }, 'jazz_smooth_backbeat')).toBe('smoothJazzQuartet');
    expect(chooseEnsembleWorld('lofi', { lead: 108, bass: 38 })).toBe('lofiBoomBap');
    expect(chooseEnsembleWorld('rnb', { lead: 0, bass: 32 })).toBe('rnbPocket');
    expect(chooseEnsembleWorld('acg', { lead: 5, comp: 5 })).toBe('acgPianoTrio');
  });
});

describe('knowledge/gmOrchestrationChains — orchestrate 协同', () => {
  it('electricKeys:默认 comp 使用 GU Electric Grand 槽位(GM5)', () => {
    const r = orchestrateRolePrograms({ style: 'rnb', lineup: ['comp', 'lead'], requestedWorld: 'electricKeys' });
    expect(CHAIN_PROFILES.electricKeys.compPriority[0]).toBe(5);
    expect(r.roleProgram.comp).toBe(5);
    expect(r.roleProgram.lead).toBe(5);
  });

  it('electricKeys:comp/lead 配对兼容', () => {
    const r = orchestrateRolePrograms({ style: 'rnb', lineup: ['comp', 'lead', 'bass'], requestedWorld: 'electricKeys', provisional: { comp: 4, lead: 11, bass: 33 } });
    // lead=vibe(11) 与 EP comp 跨族跨源 → 链改成兼容 lead
    expect(leadCompCompatible(r.roleProgram.lead, r.roleProgram.comp)).toBe(true);
  });

  it('acousticPianoBand:注入 GM11 lead 会改回当前安全 lead', () => {
    const r = orchestrateRolePrograms({ style: 'pop', lineup: ['comp', 'lead'], provisional: { comp: 0, lead: 11 } });
    expect(r.world).toBe('acousticPianoBand');
    expect(r.roleProgram.comp).toBe(0);
    expect(r.roleProgram.lead).not.toBe(11);
    expect(leadCompCompatible(r.roleProgram.lead, r.roleProgram.comp)).toBe(true);
  });

  it('acgKeyboardBand:ACG PIANOSONG 三轨统一为同一架原声钢琴', () => {
    const profile = chooseOrchestrationChain('acg', { next: () => 0, int: (_max: number) => 0, pick: <T>(xs: readonly T[]): T => xs[0] }, 'acousticPianoBand');
    expect(profile.id).toBe('acgKeyboardBand');
    expect(profile.compPriority).toEqual([0]);
    const r = orchestrateRolePrograms({ style: 'acg', lineup: ['comp', 'lead', 'bass'], provisional: { comp: 5, lead: 11, bass: 38 } });
    expect(r.profileId).toBe('acgKeyboardBand');
    expect(r.roleProgram).toMatchObject({ comp: 0, lead: 0, bass: 0 });
  });

  it('piano-led 编制允许 GM0 在 bass 轨承担左手 bassline，不扩散到爵士三重奏', () => {
    const acg = orchestrateRolePrograms({
      style: 'acg', ensembleWorld: 'acgPianoTrio', lineup: ['comp', 'lead', 'bass'],
      provisional: { comp: 0, lead: 0, bass: 0 },
    });
    expect(acg.roleProgram).toMatchObject({ comp: 0, lead: 0, bass: 0 });

    const cityPop = orchestrateRolePrograms({
      style: 'pop', ensembleWorld: 'cityPopPianoBand', lineup: ['comp', 'lead', 'bass'],
      provisional: { comp: 0, lead: 0, bass: 0 },
    });
    expect(cityPop.roleProgram.bass).toBe(0);

    const jazz = orchestrateRolePrograms({
      style: 'jazz', ensembleWorld: 'jazzPianoTrio', lineup: ['comp', 'lead', 'bass'],
      provisional: { comp: 0, lead: 0, bass: 0 },
    });
    expect(jazz.roleProgram.bass).toBe(32);
  });

  it('jazzCombo:绝不选合成贝斯(注入 synth bass → 改原声)', () => {
    const r = orchestrateRolePrograms({ style: 'jazz', lineup: ['comp', 'bass'], provisional: { comp: 0, bass: 38 } });
    expect([38, 39]).not.toContain(r.roleProgram.bass);
    expect(info(r.roleProgram.bass).family).toBe('bass');
    // 链表本身也不含合成贝斯
    expect(CHAIN_PROFILES.jazzCombo.bassPriority.some((b) => b === 38 || b === 39)).toBe(false);
  });

  it('jazzCombo:lead 链不含 GM26 jazz guitar 或 GM11 vibe', () => {
    const jazzLeads = Object.values(CHAIN_PROFILES.jazzCombo.leadByComp).flat();
    expect(jazzLeads).not.toContain(26);
    expect(jazzLeads).not.toContain(11);
  });

  it('syntheticSoft:合成贝斯 + 合成 pad 可选,且 lead 不刺耳', () => {
    const r = orchestrateRolePrograms({ style: 'pop', lineup: ['comp', 'bass', 'pad', 'lead'], requestedWorld: 'syntheticSoft', provisional: { comp: 5, bass: 38, pad: 98, lead: 5 } });
    expect(r.roleProgram.bass).toBe(38);
    expect(r.roleProgram.pad).toBe(89);
    expect(isHarshLead(r.roleProgram.lead)).toBe(false);
  });

  it('hard-reject:comp 不会变成管风琴/pad/弦/管乐(注入 organ → 改可 comp 乐器)', () => {
    for (const bad of [16, 89, 48, 75]) { // 管风琴 / pad / 弦 / 排箫
      const r = orchestrateRolePrograms({ style: 'rnb', lineup: ['comp'], requestedWorld: 'electricKeys', provisional: { comp: bad } });
      expect(canPlayComp(r.roleProgram.comp), `comp=GM${bad} 应被修`).toBe(true);
    }
  });

  it('drum kit 链权威:当前 Aura25 只下发 Room/TR-808/Brush 三套 bank128 kit', () => {
    expect(orchestrateRolePrograms({ style: 'jazz', lineup: ['drum'], provisional: { drum: 40 } }).roleProgram.drum).toBe(40);
    expect(orchestrateRolePrograms({ style: 'pop', lineup: ['drum'], requestedWorld: 'electricKeys', provisional: { drum: 25 } }).roleProgram.drum).toBe(8);
    expect(orchestrateRolePrograms({ style: 'lofi', lineup: ['drum'], provisional: { drum: 25 } }).roleProgram.drum).toBe(25);
    expect(orchestrateRolePrograms({ style: 'rnb', lineup: ['drum'], requestedWorld: 'electricKeys', provisional: { drum: 8 } }).roleProgram.drum).toBe(25);
    expect(orchestrateRolePrograms({ style: 'rnb', lineup: ['drum'], requestedWorld: 'electricKeys', drumKitProgram: 8, provisional: { drum: 25 } }).roleProgram.drum).toBe(8);
    expect(orchestrateRolePrograms({ style: 'pop', lineup: ['drum'], requestedWorld: 'electricKeys', drumKitProgram: 25, provisional: { drum: 8 } }).roleProgram.drum).toBe(25);
  });

  it('实战模板会拒绝不属于该乐队的主角音色，但保留 arranger 下发的鼓 kit', () => {
    const lofi = orchestrateRolePrograms({
      style: 'lofi', ensembleWorld: 'lofiBoomBap', lineup: ['comp', 'lead', 'bass', 'drum'],
      provisional: { comp: 5, lead: 108, bass: 38, drum: 25 }, drumKitProgram: 25,
    });
    expect(lofi.roleProgram).toMatchObject({ comp: 5, lead: 5, bass: 32, drum: 25 });

    const rnb = orchestrateRolePrograms({
      style: 'rnb', ensembleWorld: 'rnbPocket', lineup: ['comp', 'lead', 'bass', 'drum'],
      provisional: { comp: 0, lead: 25, bass: 32, drum: 8 }, drumKitProgram: 8,
    });
    expect(rnb.roleProgram).toMatchObject({ comp: 5, lead: 5, bass: 38, drum: 8 });

    const pianoTrio = orchestrateRolePrograms({
      style: 'jazz', ensembleWorld: 'jazzPianoTrio', lineup: ['comp', 'lead', 'bass'],
      provisional: { comp: 5, lead: 66, bass: 38 },
    });
    expect(pianoTrio.roleProgram).toMatchObject({ comp: 0, lead: 0, bass: 32 });
  });

  it('确定性:同 style/lineup/provisional → 同 roleProgram', () => {
    const args = { style: 'rnb' as const, lineup: ['bass', 'comp', 'lead', 'pad'] as InstrumentRoleName[], provisional: { bass: 35, comp: 4, lead: 4, pad: 89 } };
    const a = orchestrateRolePrograms(args), b = orchestrateRolePrograms(args);
    expect(a.roleProgram).toEqual(b.roleProgram);
  });
});

describe('knowledge/gmOrchestrationChains — 辅助', () => {
  it('isHarshLead:铜管/独奏小提琴/失真吉他/合唱/激进合成 lead = 刺耳;暖键盘/木琴/sax/排箫 = 否', () => {
    for (const p of [56, 60, 40, 30, 52, 81]) expect(isHarshLead(p), `GM${p}`).toBe(true);
    for (const p of [0, 4, 11, 12, 64, 65, 66, 67, 75, 77, 108]) expect(isHarshLead(p), `GM${p}`).toBe(false);
  });

  it('scoreProgramPair:同程序 > 跨族;刺耳 lead 重罚 < 0', () => {
    expect(scoreProgramPair(4, 4, 'lead-comp')).toBeGreaterThan(scoreProgramPair(12, 4, 'lead-comp'));
    expect(scoreProgramPair(60, 4, 'lead-comp')).toBeLessThan(0); // 小号 lead
    expect(scoreProgramPair(89, 4, 'pad-comp')).toBeGreaterThanOrEqual(0); // pad 合法(不罚)
    expect(scoreProgramPair(72, 4, 'pad-comp')).toBeLessThan(0);    // 长笛不能当 pad(重罚)
    expect(scoreProgramPair(89, 4, 'pad-comp')).toBeGreaterThan(scoreProgramPair(72, 4, 'pad-comp'));
  });
});
