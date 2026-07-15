// ============================================================
// newEngine · knowledge · 暖路线调色板扩充 + lead↔comp 配对一致性(2026-06-09)
// ------------------------------------------------------------
// 锁:① 暖 GM 乐器进池(吉他/哈蒙德/大提琴/暖 pad/古筝/卡林巴)+ 有 INFO/NAME/SOURCE;
//   ② coherentLeadComp 修不搭对(马林巴+电钢→电钢配电钢 / 解绑),已和谐保留;③ 不破坏风格世界守卫。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  instrumentInfo, gmName, timbreSource, leadCompCompatible, coherentLeadComp,
  getInstrumentCatalog, worldMismatches, classifyTimbreWorld, playableRangeForRole, fitMidiToProgramRange, preferredRegisterForRole,
} from './instruments';

const WARM_META = [16, 24, 25, 26, 27, 42, 66, 67, 88, 94, 107, 108]; // 全部新增暖乐器(有元数据)
const ACTIVE_24K_PROGRAMS = [0, 5, 24, 25, 32, 38, 66, 67, 89, 108];
const WARM_ADDED = WARM_META;

describe('暖路线 GM 调色板扩充', () => {
  it('新增暖乐器都有 family/range + 中文名 + 音色来源(无 GM n 兜底)', () => {
    for (const p of WARM_ADDED) {
      expect(instrumentInfo(p).family, `${p} family`).not.toBe('other');
      expect(gmName(p), `${p} name`).not.toMatch(/^GM /);
      expect(['acoustic', 'electric', 'synth']).toContain(timbreSource(p));
    }
  });

  it('family 分类正确(吉他=guitar / 哈蒙德=keyboard / 大提琴=strings / 卡林巴&古筝=mallet / 暖pad=pad)', () => {
    expect(instrumentInfo(24).family).toBe('guitar');
    expect(instrumentInfo(26).family).toBe('guitar');
    expect(instrumentInfo(16).family).toBe('keyboard'); // 管风琴可 voice 和弦色彩
    expect(instrumentInfo(42).family).toBe('strings');
    expect(instrumentInfo(108).family).toBe('mallet');
    expect(instrumentInfo(107).family).toBe('mallet');
    expect(instrumentInfo(88).family).toBe('pad');
    expect(instrumentInfo(94).family).toBe('pad');
  });

  it('Baritone Sax 使用真实 sounding lead 硬音域,不再人为压低八度', () => {
    expect(instrumentInfo(66).range).toEqual([44, 76]);
    expect(playableRangeForRole('lead', 66)).toEqual([44, 76]);
    expect(instrumentInfo(67).range).toEqual([36, 72]);
    expect(playableRangeForRole('lead', 67)).toEqual([36, 72]);
    expect(fitMidiToProgramRange(82, 'lead', 67)).toBe(70);
    expect(fitMidiToProgramRange(38, 'lead', 67)).toBe(38);
  });

  it('角色推荐音区:lead 更宽并包含 comp,comp 更窄给 lead 留空间', () => {
    for (const program of [0, 5, 24, 25, 108]) {
      const lead = preferredRegisterForRole('lead', program);
      const comp = preferredRegisterForRole('comp', program);
      const hard = playableRangeForRole('lead', program);
      expect(lead[0], `GM${program} lead low`).toBeLessThanOrEqual(comp[0]);
      expect(lead[1], `GM${program} lead high`).toBeGreaterThanOrEqual(comp[1]);
      expect(comp[1] - comp[0], `GM${program} comp span`).toBeLessThanOrEqual(lead[1] - lead[0]);
      expect(lead[0]).toBeGreaterThanOrEqual(hard[0]);
      expect(lead[1]).toBeLessThanOrEqual(hard[1]);
    }
    expect(preferredRegisterForRole('lead', 67)).toEqual([36, 72]);
    expect(preferredRegisterForRole('lead', 25)).toEqual([40, 69]);
    expect(fitMidiToProgramRange(88, 'lead', 25)).toBe(64);
    expect(preferredRegisterForRole('lead', 108)).toEqual([60, 81]);
    expect(fitMidiToProgramRange(86, 'lead', 108)).toBe(74);
    expect(preferredRegisterForRole('bass', 0)).toEqual([28, 55]);
    expect(fitMidiToProgramRange(60, 'bass', 0)).toBe(48);
    expect(fitMidiToProgramRange(24, 'bass', 0)).toBe(36);
  });

  it('调色板对齐 24k 11-preset 包:活跃 GM program 只使用保留清单', () => {
    const used = new Set<number>();
    for (const s of getInstrumentCatalog()) for (const r of s.roles) for (const p of r.programs) used.add(p);
    expect([...used].sort((a, b) => a - b)).toEqual(ACTIVE_24K_PROGRAMS);
    expect(used.has(26), 'GM26 jazz guitar 不应进主动器配池').toBe(false);
    expect(used.has(25), 'GM25 民谣木吉他应入池').toBe(true);
    expect(used.has(27), 'GM27 clean guitar 已替换,不应入池').toBe(false);
    for (const deleted of [1, 4, 7, 16, 27, 33, 34, 39, 48, 49, 80, 81, 98]) {
      expect(used.has(deleted), `GM${deleted} 已删,不应进主动器配池`).toBe(false);
    }
  });

  it('不加铜管/长笛/高频合成 lead,但允许低音区 Sax', () => {
    const used = new Set<number>();
    for (const s of getInstrumentCatalog()) for (const r of s.roles) for (const p of r.programs) used.add(p);
    for (const harsh of [56, 57, 60, 61, 64, 65, 80, 82]) expect(used.has(harsh), `${harsh} 不应入池`).toBe(false);
    expect(used.has(66), 'Tenor Sax 应入池').toBe(true);
    expect(used.has(67), 'Baritone Sax 应保留为备选').toBe(true);
  });
});

describe('leadCompCompatible — 配对判据', () => {
  it('同族相配(电钢 lead + 电钢 comp / 木琴+木琴 / 吉他+吉他)', () => {
    expect(leadCompCompatible(4, 5)).toBe(true);   // Rhodes + FM-EP(keyboard)
    expect(leadCompCompatible(11, 12)).toBe(true); // 颤音+马林巴(mallet)
    expect(leadCompCompatible(24, 26)).toBe(true); // 尼龙+爵士(guitar)
  });
  it('原声钢琴 comp = 百搭(马林巴/吉他 lead 在其上 OK)', () => {
    expect(leadCompCompatible(12, 0)).toBe(true);  // 马林巴 + 大钢琴
    expect(leadCompCompatible(24, 1)).toBe(true);  // 吉他 + 亮钢琴
  });
  it('同音色来源相配(都 acoustic:马林巴+尼龙吉他)', () => {
    expect(leadCompCompatible(12, 24)).toBe(true); // 木琴(acoustic) + 尼龙(acoustic)
  });
  it('★ 跨族跨源不搭:马林巴(acoustic) lead + 电钢(electric) comp', () => {
    expect(leadCompCompatible(12, 4)).toBe(false); // 用户抱怨的"死绑"组合
    expect(leadCompCompatible(12, 5)).toBe(false);
  });
});

describe('coherentLeadComp — 器配层修不搭对', () => {
  it('★ 电钢 comp 配电钢 lead:lofi 马林巴 lead + DX7 comp → DX7 lead + DX7 comp', () => {
    const out = coherentLeadComp({ lead: 12, comp: 5, bass: 33, pad: 89, drum: 0 }, 'lofi');
    expect(out.lead).toBe(5);  // 改成 CityPop DX7 EP(池里有 5)→ 电钢配电钢
    expect(out.comp).toBe(5);  // comp 不动
    expect(leadCompCompatible(out.lead, out.comp)).toBe(true);
  });
  it('★ 马林巴 + 尼龙吉他(同 acoustic)→ 保留(本就搭,不乱改)', () => {
    const rp = { lead: 12, comp: 24, bass: 33, pad: 89, drum: 0 };
    expect(coherentLeadComp(rp, 'lofi')).toBe(rp); // 同对象返回(已和谐)
  });
  it('已和谐对(电钢 lead + 电钢 comp)→ 原样', () => {
    const rp = { lead: 5, comp: 5, bass: 33, pad: 89, drum: 0 };
    expect(coherentLeadComp(rp, 'rnb')).toBe(rp);
  });
  it('modal 马林巴 lead + Rhodes comp → 修成相配(键盘 lead 或保马林巴换暖 comp)', () => {
    const out = coherentLeadComp({ lead: 12, comp: 5, bass: 32, pad: 89, drum: 0 }, 'modal');
    expect(leadCompCompatible(out.lead, out.comp), `${out.lead}+${out.comp}`).toBe(true);
  });
  it('缺 lead 或 comp → 原样(fail-open)', () => {
    const rp = { lead: 4, bass: 33, pad: 89, drum: 0 } as never;
    expect(coherentLeadComp(rp, 'pop')).toBe(rp);
  });
  it('确定性:同输入两次同结果', () => {
    const a = coherentLeadComp({ lead: 12, comp: 5, bass: 33, pad: 89, drum: 0 }, 'lofi');
    const b = coherentLeadComp({ lead: 12, comp: 5, bass: 33, pad: 89, drum: 0 }, 'lofi');
    expect(a).toEqual(b);
  });
});

describe('风格世界守卫无回归(暖扩后)', () => {
  it('新增乐器不触发 worldMismatch(jazz/lofi 池仍守住)', () => {
    expect(worldMismatches({ comp: 16, bass: 32, pad: 89 }, 'jazz')).toEqual([]);
    expect(worldMismatches({ comp: 24, bass: 33, pad: 89 }, 'lofi')).toEqual([]); // 尼龙 comp OK
    expect(classifyTimbreWorld({ comp: 16, bass: 32 }, 'jazz')).toBe('jazzCombo');
  });
});
